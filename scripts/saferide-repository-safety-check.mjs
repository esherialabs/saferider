#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateRepositorySafety } from './lib/saferide-repository-safety.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = process.argv.includes('--release');
const allowBlocked = process.argv.includes('--allow-blocked');

if (release === allowBlocked) {
  console.error('Choose exactly one of --release or --allow-blocked.');
  process.exit(2);
}
const result = validateRepositorySafety({ rootDir, release });

if (!result.structurallyValid || (release && result.blockers.length > 0)) {
  console.error(`Repository safety ${release ? 'release ' : ''}check failed:`);
  [...result.errors, ...result.blockers].forEach(error => console.error(`- ${error}`));
  process.exit(1);
}

const { current, history } = result.summary;
console.log(
  `Repository safety check passed (${current.trackedFiles} tracked files; `
  + `${history.blobs} reachable blobs inspected as metadata; ${current.lfsPointers} LFS pointers; `
  + `${result.blockers.length} explicit publication blocker(s)).`,
);
