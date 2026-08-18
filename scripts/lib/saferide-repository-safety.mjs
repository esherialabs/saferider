import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const POLICY_PATH = 'config/release/repository-safety-policy.v1.json';

function readJson(rootDir, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), 'utf8'));
}

function runGit(rootDir, args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || '').trim() || `exit ${result.status}`}`);
  }
  return result.stdout;
}

function normalizedExtension(filePath) {
  return path.extname(filePath).toLowerCase();
}

function isForbiddenPath(filePath, policy) {
  const base = path.basename(filePath).toLowerCase();
  const extension = normalizedExtension(filePath);
  return policy.forbiddenBasenames.includes(base) || policy.forbiddenExtensions.includes(extension);
}

function fileIsLfsPointer(fullPath) {
  const descriptor = fs.openSync(fullPath, 'r');
  try {
    const buffer = Buffer.alloc(128);
    const bytes = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytes).toString('utf8').startsWith('version https://git-lfs.github.com/spec/v1');
  } finally {
    fs.closeSync(descriptor);
  }
}

function sha256File(fullPath) {
  return createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
}

function currentException(relativePath, fullPath, stat, policy) {
  const exception = policy.allowedCurrentFiles.find(item => item.path === relativePath);
  if (!exception) return false;
  return exception.sizeBytes === stat.size && exception.sha256 === sha256File(fullPath);
}

function inspectCurrentTree(rootDir, policy) {
  const errors = [];
  const tracked = runGit(rootDir, ['ls-files', '-z']).split('\0').filter(Boolean);
  let lfsPointers = 0;
  let binaryFiles = 0;
  for (const relativePath of tracked) {
    const fullPath = path.join(rootDir, relativePath);
    const stat = fs.lstatSync(fullPath);
    const excepted = stat.isFile() && currentException(relativePath, fullPath, stat, policy);
    if (isForbiddenPath(relativePath, policy) && !excepted) {
      errors.push(`current tree contains forbidden artifact or credential file class: ${relativePath}`);
      continue;
    }
    if (stat.isSymbolicLink()) {
      const target = path.resolve(path.dirname(fullPath), fs.readlinkSync(fullPath));
      const relativeTarget = path.relative(rootDir, target);
      if (!relativeTarget || relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
        errors.push(`tracked symlink escapes the repository: ${relativePath}`);
      }
      continue;
    }
    if (!stat.isFile()) continue;
    const extension = normalizedExtension(relativePath);
    if (policy.allowedLargeExtensions.includes(extension)) binaryFiles += 1;
    if (stat.size > policy.maxTrackedFileBytes && !policy.allowedLargeExtensions.includes(extension) && !excepted) {
      errors.push(`tracked file exceeds the non-media size limit: ${relativePath} (${stat.size} bytes)`);
    }
    if (stat.size > 0 && fileIsLfsPointer(fullPath)) lfsPointers += 1;
  }
  return { errors, trackedFiles: tracked.length, binaryFiles, lfsPointers };
}

function inspectHistory(rootDir, policy) {
  const errors = [];
  const blockers = [];
  const objects = runGit(rootDir, ['rev-list', '--objects', '--all'])
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const separator = line.indexOf(' ');
      return {
        object: separator < 0 ? line : line.slice(0, separator),
        filePath: separator < 0 ? '' : line.slice(separator + 1),
      };
    });
  const byObject = new Map(objects.map(item => [item.object, item.filePath]));
  const batch = runGit(rootDir, ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], {
    input: `${objects.map(item => item.object).join('\n')}\n`,
  });
  let blobs = 0;
  let largeBlobs = 0;
  for (const line of batch.split(/\r?\n/).filter(Boolean)) {
    const [object, type, sizeText] = line.split(' ');
    if (type !== 'blob') continue;
    blobs += 1;
    const filePath = byObject.get(object) ?? '';
    const size = Number(sizeText);
    const known = policy.knownHistoricalObjects.find(item => (
      item.objectId === object && item.path === filePath && item.sizeBytes === size
    ));
    const forbidden = filePath && isForbiddenPath(filePath, policy);
    const oversized = size > policy.maxHistoricalBlobBytes
      && !policy.allowedLargeExtensions.includes(normalizedExtension(filePath));
    if ((forbidden || oversized) && known?.disposition === 'blocks-publication') {
      blockers.push(`reachable history contains registered publication blocker: ${filePath} (${size} bytes, ${object.slice(0, 12)})`);
    } else if ((forbidden || oversized) && known?.disposition !== 'allowed-non-production') {
      errors.push(`reachable history contains unregistered forbidden/oversized blob: ${filePath || '<path unavailable>'} (${size} bytes, ${object.slice(0, 12)})`);
    }
    if (size > policy.maxHistoricalBlobBytes) {
      largeBlobs += 1;
    }
  }
  return { errors, blockers, objects: objects.length, blobs, largeBlobs };
}

export function validateRepositorySafety({
  rootDir,
  release = false,
  policy = readJson(rootDir, POLICY_PATH),
  review = readJson(rootDir, policy.publicReviewEvidence),
} = {}) {
  const current = inspectCurrentTree(rootDir, policy);
  const history = inspectHistory(rootDir, policy);
  const errors = [...current.errors, ...history.errors];
  const blockers = [...history.blockers];

  if (current.lfsPointers > 0) {
    blockers.push(`tracked tree contains ${current.lfsPointers} Git LFS pointer(s) requiring object and access review`);
  }
  if (release) {
    if (review.status !== 'passed') blockers.push(`repository publication review is ${review.status}`);
    if (!review.sourceCommit) blockers.push('repository publication review is not bound to a source commit');
    if (!review.reviewedAt || !review.reviewerRole) blockers.push('repository publication review has no dated independent reviewer');
    for (const [name, status] of Object.entries(review.checks)) {
      if (status !== 'passed') blockers.push(`repository publication check ${name} is ${status}`);
    }
    if (review.blockers.length > 0) blockers.push(...review.blockers.map(item => `publication review blocker: ${item}`));
  }

  return {
    ok: errors.length === 0 && (!release || blockers.length === 0),
    structurallyValid: errors.length === 0,
    errors,
    blockers,
    summary: { current, history },
  };
}
