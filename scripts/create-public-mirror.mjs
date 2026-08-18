#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policyPath = path.join(root, 'config/release/public-mirror.v1.json');
const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
const outArg = process.argv.find((value, index, args) => args[index - 1] === '--out');

if (!outArg) {
  console.error('Usage: node scripts/create-public-mirror.mjs --out /tmp/saferide-public-mirror');
  process.exit(2);
}

const output = path.resolve(outArg);
if (output === root || output.startsWith(`${root}${path.sep}`)) {
  console.error('Public mirror output must remain outside the private repository.');
  process.exit(1);
}
if (!path.basename(output).includes('saferide-public')) {
  console.error('Public mirror output directory must contain "saferide-public".');
  process.exit(1);
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function sha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function included(relativePath) {
  if (policy.excludeFiles.includes(relativePath)) return false;
  if (policy.excludePrefixes.some(prefix => relativePath.startsWith(prefix))) return false;
  if (policy.forbiddenExtensions.includes(path.extname(relativePath).toLowerCase())) return false;
  return policy.includeFiles.includes(relativePath)
    || policy.includePrefixes.some(prefix => relativePath.startsWith(prefix));
}

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root })
  .toString('utf8')
  .split('\0')
  .filter(Boolean);
const selected = tracked.filter(included).sort();

if (selected.length < 100) {
  console.error(`Mirror allowlist selected too few files: ${selected.length}`);
  process.exit(1);
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true, mode: 0o755 });

let totalBytes = 0;
const ledger = [];

for (const relativePath of selected) {
  const source = path.join(root, relativePath);
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    console.error(`Refusing symlink in public mirror: ${relativePath}`);
    process.exit(1);
  }
  if (!stat.isFile()) continue;

  const destination = path.join(output, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, stat.mode & 0o777);
  totalBytes += stat.size;
  ledger.push(`${sha256(destination)}  ${relativePath}`);
}

const sourceCommit = git(['rev-parse', 'HEAD']);
const sourceCommittedAt = git(['show', '-s', '--format=%cI', 'HEAD']);
const provenance = {
  schemaVersion: 1,
  mirrorPolicyId: policy.policyId,
  repositoryUrl: policy.repositoryUrl,
  sourceRepository: 'esherialabs/saferide',
  sourceBranch: policy.sourceBranch,
  sourceCommit,
  sourceCommittedAt,
  publicationModel: policy.publicationModel,
  fileCount: selected.length,
  totalBytes,
  licenseBoundary: policy.licenseBoundary,
  releaseMetadata: 'web/public/releases/saferide-v0.5.8-android.json',
};

fs.writeFileSync(
  path.join(output, 'PUBLIC_MIRROR_PROVENANCE.json'),
  `${JSON.stringify(provenance, null, 2)}\n`,
  { mode: 0o644 },
);
ledger.push(`${sha256(path.join(output, 'PUBLIC_MIRROR_PROVENANCE.json'))}  PUBLIC_MIRROR_PROVENANCE.json`);
fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), `${ledger.join('\n')}\n`, { mode: 0o644 });

console.log(
  `Created SafeRide public mirror at ${output} (${selected.length} source files; ${totalBytes} bytes; ${sourceCommit}).`,
);
