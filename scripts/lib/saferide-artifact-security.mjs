import fs from 'node:fs';
import path from 'node:path';

import { REPO_ROOT, sha256 } from './saferide-gemma4-v05.mjs';

export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;
export const PRIVATE_UMASK = 0o077;

export function enforcePrivateUmask() {
  process.umask(PRIVATE_UMASK);
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertNoSymlink(targetPath, label) {
  if (!fs.existsSync(targetPath)) return;
  if (fs.lstatSync(targetPath).isSymbolicLink()) {
    throw new Error(`${label} may not be a symbolic link`);
  }
}

function assertMode(targetPath, expected, label) {
  if (process.platform === 'win32') return;
  const actual = fs.statSync(targetPath).mode & 0o777;
  if (actual !== expected) {
    throw new Error(`${label} permissions must be ${expected.toString(8).padStart(4, '0')}; found ${actual.toString(8).padStart(4, '0')}`);
  }
}

export function secureArtifactRoot(rootPath, {
  create = false,
  allowRepositoryTestRoot = false,
  repoRoot = REPO_ROOT,
} = {}) {
  if (typeof rootPath !== 'string' || !path.isAbsolute(rootPath)) {
    throw new Error('Artifact root must be an explicit absolute path');
  }
  const resolved = path.resolve(rootPath);
  if (resolved === path.parse(resolved).root) throw new Error('Filesystem root cannot be an artifact root');
  if (isInside(path.resolve(repoRoot), resolved) && !allowRepositoryTestRoot) {
    throw new Error('Production artifact root must be outside the repository checkout');
  }
  assertNoSymlink(resolved, 'Artifact root');
  if (!fs.existsSync(resolved)) {
    if (!create) throw new Error('Artifact root does not exist');
    fs.mkdirSync(resolved, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  }
  if (!fs.statSync(resolved).isDirectory()) throw new Error('Artifact root must be a directory');
  fs.chmodSync(resolved, PRIVATE_DIRECTORY_MODE);
  assertMode(resolved, PRIVATE_DIRECTORY_MODE, 'Artifact root');
  const real = fs.realpathSync(resolved);
  if (isInside(fs.realpathSync(path.resolve(repoRoot)), real) && !allowRepositoryTestRoot) {
    throw new Error('Resolved production artifact root must be outside the repository checkout');
  }
  return real;
}

export function artifactPath(rootPath, requestedPath, {
  classification = null,
  requiredPrefix = null,
} = {}) {
  const root = path.resolve(rootPath);
  if (typeof requestedPath !== 'string' || !requestedPath) throw new Error('Artifact path is required');
  const resolved = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(root, requestedPath);
  if (!isInside(root, resolved) || resolved === root) throw new Error('Artifact path must remain below the artifact root');
  const relative = path.relative(root, resolved).split(path.sep).join('/');
  if (requiredPrefix && relative !== requiredPrefix && !relative.startsWith(`${requiredPrefix}/`)) {
    throw new Error(`Artifact path must remain in ${requiredPrefix}/`);
  }
  if (classification === 'restricted' && relative.startsWith('public-safe/')) {
    throw new Error('Restricted artifacts may not be written under public-safe/');
  }
  if (classification === 'controlled' && relative.startsWith('public-safe/')) {
    throw new Error('Controlled artifacts may not be written under public-safe/');
  }
  return resolved;
}

export function ensurePrivateDirectory(directoryPath, rootPath) {
  const root = path.resolve(rootPath);
  const resolved = path.resolve(directoryPath);
  if (!isInside(root, resolved) && resolved !== root) throw new Error('Private directory escapes artifact root');
  const relativeParts = path.relative(root, resolved).split(path.sep).filter(Boolean);
  let cursor = root;
  for (const part of relativeParts) {
    cursor = path.join(cursor, part);
    assertNoSymlink(cursor, 'Artifact directory');
    if (!fs.existsSync(cursor)) fs.mkdirSync(cursor, { mode: PRIVATE_DIRECTORY_MODE });
    if (!fs.statSync(cursor).isDirectory()) throw new Error('Artifact path component is not a directory');
    fs.chmodSync(cursor, PRIVATE_DIRECTORY_MODE);
    assertMode(cursor, PRIVATE_DIRECTORY_MODE, 'Artifact directory');
  }
  return resolved;
}

export function assertPrivateFile(filePath, rootPath) {
  const resolved = artifactPath(rootPath, filePath);
  assertNoSymlink(resolved, 'Artifact file');
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error('Required artifact file is unavailable');
  assertMode(resolved, PRIVATE_FILE_MODE, 'Artifact file');
  return resolved;
}

export function atomicWritePrivate(filePath, data, {
  rootPath,
  overwrite = false,
  verifyIdentical = false,
} = {}) {
  if (!rootPath) throw new Error('rootPath is required for private artifact writes');
  const resolved = artifactPath(rootPath, filePath);
  ensurePrivateDirectory(path.dirname(resolved), rootPath);
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  if (fs.existsSync(resolved)) {
    assertNoSymlink(resolved, 'Artifact file');
    const existing = fs.readFileSync(resolved);
    if (verifyIdentical && existing.equals(bytes)) {
      fs.chmodSync(resolved, PRIVATE_FILE_MODE);
      assertMode(resolved, PRIVATE_FILE_MODE, 'Artifact file');
      return { path: resolved, sha256: sha256(existing), sizeBytes: existing.length, unchanged: true };
    }
    if (!overwrite) throw new Error('Refusing to overwrite an existing immutable artifact');
  }
  const temporary = path.join(
    path.dirname(resolved),
    `.${path.basename(resolved)}.${process.pid}.${sha256(`${resolved}:${bytes.length}`).slice(0, 12)}.tmp`,
  );
  if (fs.existsSync(temporary)) throw new Error('Atomic-write temporary path already exists');
  try {
    fs.writeFileSync(temporary, bytes, { mode: PRIVATE_FILE_MODE, flag: 'wx' });
    fs.chmodSync(temporary, PRIVATE_FILE_MODE);
    if (overwrite && fs.existsSync(resolved)) fs.renameSync(temporary, resolved);
    else fs.renameSync(temporary, resolved);
    fs.chmodSync(resolved, PRIVATE_FILE_MODE);
    assertMode(resolved, PRIVATE_FILE_MODE, 'Artifact file');
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return { path: resolved, sha256: sha256(bytes), sizeBytes: bytes.length, unchanged: false };
}

export function inspectArtifactPermissions(rootPath) {
  const root = path.resolve(rootPath);
  const failures = [];
  const visit = current => {
    const stat = fs.lstatSync(current);
    const relative = path.relative(root, current) || '.';
    if (stat.isSymbolicLink()) {
      failures.push(`${relative}:symlink`);
      return;
    }
    if (process.platform !== 'win32') {
      const mode = stat.mode & 0o777;
      const expected = stat.isDirectory() ? PRIVATE_DIRECTORY_MODE : PRIVATE_FILE_MODE;
      if (mode !== expected) failures.push(`${relative}:mode-${mode.toString(8)}`);
    }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(current).sort()) visit(path.join(current, name));
    }
  };
  visit(root);
  return failures;
}
