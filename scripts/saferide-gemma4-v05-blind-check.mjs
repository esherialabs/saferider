#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_PLAN_PATH,
  compileV05Schemas,
  fileSha256,
  readJson,
  readJsonl,
  validateBlindEvaluation,
} from './lib/saferide-gemma4-v05.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resolve = input => path.isAbsolute(input) ? input : path.join(repoRoot, input);

function main() {
  const args = { corpus: [] };
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--plan') args.plan = argv[++index];
    else if (argv[index] === '--split-manifest') args.splitManifest = argv[++index];
    else if (argv[index] === '--blind-prompts') args.blindPrompts = argv[++index];
    else if (argv[index] === '--corpus') args.corpus.push(argv[++index]);
    else if (['--help', '-h'].includes(argv[index])) {
      console.log('Usage: node scripts/saferide-gemma4-v05-blind-check.mjs --split-manifest <json> --blind-prompts <restricted-jsonl> --corpus <jsonl> [--corpus <jsonl> ...] [--plan <json>]');
      return 0;
    } else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  if (!args.splitManifest || !args.blindPrompts || args.corpus.length === 0) {
    throw new Error('--split-manifest, --blind-prompts, and all frozen split files via --corpus are required');
  }
  const plan = readJson(resolve(args.plan ?? DEFAULT_PLAN_PATH));
  const splitManifest = readJson(resolve(args.splitManifest));
  const promptsPath = resolve(args.blindPrompts);
  const corpusRows = args.corpus.flatMap(input => readJsonl(resolve(input)));
  const result = validateBlindEvaluation(readJsonl(promptsPath), splitManifest, plan, {
    schemas: compileV05Schemas(),
    corpusRows,
  });
  console.log('SafeRide v0.5 restricted blind-evaluation check');
  console.log(`Prompt file SHA-256: ${fileSha256(promptsPath)}`);
  console.log(`Counts: ${result.counts.prompts} prompts; ${result.counts.multiTurn} multi-turn; ${result.counts.highOrCritical} high/critical.`);
  if (result.errors.length) {
    result.errors.forEach(error => console.error(`- ${error}`));
    return 1;
  }
  console.log(`PASS (inventory ${result.inventorySha256}; raw prompts not printed).`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
