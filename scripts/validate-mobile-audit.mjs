#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inputIndex = process.argv.indexOf('--input');
let inputPath = inputIndex >= 0 ? path.resolve(process.argv[inputIndex + 1] ?? '') : null;
const policy = JSON.parse(fs.readFileSync(path.join(root, 'config/release/mobile-audit-exceptions.v1.json'), 'utf8'));

if (!inputPath) {
  const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (![0, 1].includes(result.status)) {
    console.error(result.stderr || `npm audit failed with exit ${result.status}`);
    process.exit(result.status ?? 2);
  }
  const coverageDir = path.join(root, 'coverage');
  fs.mkdirSync(coverageDir, { recursive: true });
  inputPath = path.join(coverageDir, 'mobile-dependency-audit.json');
  fs.writeFileSync(inputPath, result.stdout, { mode: 0o644 });
}

if (!fs.existsSync(inputPath)) {
  console.error(`Mobile npm audit report is unavailable: ${inputPath}`);
  process.exit(2);
}

const report = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const errors = [];
const allowedAdvisoryIds = new Set(policy.allowedAdvisoryIds);
const observedAdvisoryIds = new Set();
const observedRootPackages = new Set();

if (policy.status !== 'approved-public-source-ci-only') {
  errors.push(`mobile audit exception status is ${policy.status}`);
}
if (new Date().toISOString().slice(0, 10) > policy.expiresOn) {
  errors.push(`mobile audit exception expired on ${policy.expiresOn}`);
}
if ((report.metadata?.vulnerabilities?.critical ?? 0) > 0) {
  errors.push('mobile dependency audit contains a critical finding');
}

for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
  for (const cause of vulnerability.via ?? []) {
    if (cause && typeof cause === 'object' && Number.isInteger(cause.source)) {
      observedAdvisoryIds.add(cause.source);
      observedRootPackages.add(cause.name);
    }
  }
}

for (const advisoryId of observedAdvisoryIds) {
  if (!allowedAdvisoryIds.has(advisoryId)) {
    errors.push(`unreviewed mobile advisory ${advisoryId}`);
  }
}
for (const advisoryId of allowedAdvisoryIds) {
  if (!observedAdvisoryIds.has(advisoryId)) {
    errors.push(`stale mobile advisory exception ${advisoryId}`);
  }
}
for (const packageName of observedRootPackages) {
  if (!policy.allowedPackages.includes(packageName)) {
    errors.push(`unreviewed mobile advisory package ${packageName}`);
  }
}

if (errors.length > 0) {
  console.error('Mobile dependency audit exception validation failed:');
  errors.forEach(error => console.error(`- ${error}`));
  process.exit(1);
}

console.log(
  `Mobile audit reviewed for public-source CI only: ${observedAdvisoryIds.size} known advisory IDs; `
  + `${report.metadata.vulnerabilities.high} high, ${report.metadata.vulnerabilities.moderate} moderate, `
  + `${report.metadata.vulnerabilities.critical} critical; expires ${policy.expiresOn}.`,
);
