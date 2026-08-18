import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  summarizeStructuredEvidence,
  validateStructuredEvidenceRepository,
} from './saferide-structured-evidence.mjs';

const scriptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function runStructuredEvidenceCli({ title, argv = process.argv.slice(2), rootDir = scriptsDir }) {
  let json = false;
  let asOfDate;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      json = true;
    } else if (argument === '--as-of') {
      asOfDate = argv[index + 1];
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      console.log(`Usage: node <script> [--json] [--as-of YYYY-MM-DD]\n\n${title}`);
      return 0;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (asOfDate && !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    throw new Error('--as-of must use YYYY-MM-DD');
  }

  const result = validateStructuredEvidenceRepository({ rootDir, asOfDate });
  const summary = summarizeStructuredEvidence(result);
  if (json) {
    console.log(JSON.stringify({ ...summary, errors: result.errors }, null, 2));
  } else {
    console.log(title);
    console.log(`As of: ${result.asOfDate}`);
    console.log(`Result: ${result.ok ? 'PASS' : 'BLOCKED'}`);
    console.log(`Base runtime: ${summary.baseRuntime.status}; ${summary.baseRuntime.downloadMode}`);
    console.log(`Adapter safety: ${summary.adapter.decision}; ${summary.adapter.completedResponses}/${summary.adapter.requiredPrompts} complete; ${summary.adapter.reviewerCount} reviewer`);
    console.log(`Tuned mobile artifact: ${summary.tunedMobileArtifact.status}`);
    for (const error of result.errors) console.log(`- ${error}`);
  }
  return result.ok ? 0 : 1;
}
