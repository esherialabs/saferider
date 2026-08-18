#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SBOM_PATH,
  buildSourceSbom,
  serializeSbom,
  validateSourceSbom,
} from './lib/saferide-sbom.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(rootDir, SBOM_PATH);
const generate = process.argv.includes('--generate');
const check = process.argv.includes('--check');

if (generate === check) {
  console.error('Choose exactly one of --generate or --check.');
  process.exit(2);
}

let sbom;
try {
  sbom = buildSourceSbom(rootDir);
} catch (error) {
  console.error(`SBOM generation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const errors = validateSourceSbom(sbom);
if (errors.length > 0) {
  console.error('SBOM validation failed:');
  errors.forEach(error => console.error(`- ${error}`));
  process.exit(1);
}

const serialized = serializeSbom(sbom);
if (generate) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized, { encoding: 'utf8', mode: 0o644 });
  console.log(`Generated deterministic public-safe SBOM: ${SBOM_PATH} (${sbom.components.length} components)`);
} else {
  if (!fs.existsSync(outputPath)) {
    console.error(`SBOM is missing: ${SBOM_PATH}`);
    process.exit(1);
  }
  const checkedIn = fs.readFileSync(outputPath, 'utf8');
  if (checkedIn !== serialized) {
    console.error('SBOM is stale. Run npm run sbom:generate and review the dependency change.');
    process.exit(1);
  }
  console.log(`SBOM check passed: ${SBOM_PATH} (${sbom.components.length} components)`);
}
