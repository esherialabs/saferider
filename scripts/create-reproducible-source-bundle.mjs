#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function sha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

const ref = option('--ref', 'HEAD');
const output = path.resolve(option('--out', path.join(root, 'dist', 'public-source')));
const commit = git(['rev-parse', `${ref}^{commit}`]);
const shortCommit = commit.slice(0, 12);
const commitTime = git(['show', '-s', '--format=%cI', commit]);
const sourceDateEpoch = git(['show', '-s', '--format=%ct', commit]);
const described = (() => {
  try {
    return git(['describe', '--tags', '--exact-match', commit]);
  } catch {
    return `commit-${shortCommit}`;
  }
})();
const safeVersion = described.replace(/[^A-Za-z0-9._-]+/g, '-');
const archiveName = `saferide-${safeVersion}-source.tar`;
const archivePath = path.join(output, archiveName);

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true, mode: 0o755 });

execFileSync('git', [
  'archive',
  '--format=tar',
  `--prefix=saferide-${safeVersion}/`,
  `--output=${archivePath}`,
  commit,
], { cwd: root, stdio: 'inherit' });

const archiveSha256 = sha256(archivePath);
const archiveBytes = fs.statSync(archivePath).size;
const provenance = {
  schemaVersion: 1,
  artifact: archiveName,
  repository: 'https://github.com/esherialabs/saferide',
  sourceRef: ref,
  sourceCommit: commit,
  sourceCommitTime: commitTime,
  sourceDateEpoch,
  archiveFormat: 'git-archive-tar',
  archivePrefix: `saferide-${safeVersion}/`,
  archiveBytes,
  sha256: archiveSha256,
  buildCommand: `git archive --format=tar --prefix=saferide-${safeVersion}/ --output=${archiveName} ${commit}`,
  toolchain: {
    git: execFileSync('git', ['--version'], { encoding: 'utf8' }).trim(),
    node: process.version,
    npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
  },
};

fs.writeFileSync(
  path.join(output, 'reproducible-source-build.json'),
  `${JSON.stringify(provenance, null, 2)}\n`,
  { mode: 0o644 },
);
fs.writeFileSync(
  path.join(output, 'SHA256SUMS.txt'),
  `${archiveSha256}  ${archiveName}\n`,
  { mode: 0o644 },
);

console.log(`Created ${archivePath} (${archiveBytes} bytes; sha256 ${archiveSha256}).`);
