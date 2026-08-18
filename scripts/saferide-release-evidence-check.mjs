#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateReleaseEvidenceRepository } from './lib/saferide-release-evidence.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = process.argv.includes('--release');
const allowBlocked = process.argv.includes('--allow-blocked');

if (release === allowBlocked) {
  console.error('Choose exactly one of --release or --allow-blocked.');
  process.exit(2);
}

const result = validateReleaseEvidenceRepository({ rootDir, release });
if (!result.structurallyValid) {
  console.error('Release evidence validation failed:');
  result.errors.forEach(error => console.error(`- ${error}`));
  process.exit(1);
}
if (release && result.blockers.length > 0) {
  console.error(`Release is blocked by ${result.blockers.length} fail-closed gate(s):`);
  result.blockers.forEach(blocker => console.error(`- ${blocker}`));
  process.exit(1);
}

console.log(
  release
    ? 'Release evidence check passed for the exact candidate.'
    : `Release evidence structure passed; ${result.blockers.length} explicit blocker(s) keep all release actions disabled.`,
);
