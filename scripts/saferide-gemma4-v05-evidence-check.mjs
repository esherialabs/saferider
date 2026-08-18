#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { compileV05Schemas, fileSha256, schemaErrors } from './lib/saferide-gemma4-v05.mjs';
import { scanPublicSafe } from './lib/saferide-gemma4-evaluation.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultIndex = path.join(repoRoot, 'docs/qa/saferide-gemma4-v05-evidence-index.candidate.json');

function main() {
  const input = process.argv[2] && !process.argv[2].startsWith('-') ? path.resolve(process.argv[2]) : defaultIndex;
  const strict = process.argv.includes('--strict');
  const index = JSON.parse(fs.readFileSync(input, 'utf8'));
  const schemas = compileV05Schemas();
  const errors = [...schemaErrors('evidenceIndex', schemas.evidenceIndex, index), ...scanPublicSafe(index, 'evidenceIndex')];
  const ids = (index.records ?? []).map(record => record.evidenceId);
  const expected = Array.from({ length: 18 }, (_, offset) => `V05-EVIDENCE-${String(offset + 1).padStart(2, '0')}`);
  if (new Set(ids).size !== 18 || expected.some(id => !ids.includes(id))) errors.push('evidence index must contain each of the 18 required records exactly once');
  for (const record of index.records ?? []) {
    if (record.artifactRef && !record.sha256) errors.push(`${record.evidenceId} artifact reference is not hash-bound`);
    if (record.artifactRef && record.sha256 && !record.artifactRef.includes(':') && !path.isAbsolute(record.artifactRef)) {
      const artifact = path.resolve(repoRoot, record.artifactRef);
      const relative = path.relative(repoRoot, artifact);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)
        || !fs.existsSync(artifact) || !fs.statSync(artifact).isFile()
        || fileSha256(artifact) !== record.sha256) {
        errors.push(`${record.evidenceId} repository artifact is missing or hash-mismatched`);
      }
    }
  }
  if (strict && (index.status !== 'complete' || index.records.some(record => record.status !== 'available' || !record.artifactRef || !record.sha256))) {
    errors.push('strict evidence gate requires a complete index with every artifact available and hash-bound');
  }
  console.log('SafeRide v0.5 public-safe evidence-index check');
  console.log(`Status: ${index.status}`);
  if (errors.length) {
    errors.forEach(error => console.error(`- ${error}`));
    return 1;
  }
  console.log(index.status === 'blocked' ? 'PASS (truthful blocked template; no approval inferred).' : 'PASS.');
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
