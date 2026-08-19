#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateDependencyPolicy } from './lib/saferide-dependency-policy.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = validateDependencyPolicy({ rootDir });

if (!result.ok) {
  console.error('Dependency policy check failed:');
  result.errors.forEach(error => console.error(`- ${error}`));
  process.exit(1);
}

console.log(
  `Dependency policy check passed (${result.summary.map(item => `${item.workspace}=${item.packages}`).join(', ')}; `
  + `${result.reviewedLicenseCount} manually verified; ${result.unknownLicenseCount} blocked for legal review).`,
);
