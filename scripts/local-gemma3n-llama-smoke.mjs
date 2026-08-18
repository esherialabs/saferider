#!/usr/bin/env node
// Legacy Gemma 3n GGUF dev-smoke helper. The active SafeRide target is
// litert-community/gemma-4-E2B-it-litert-lm via LiteRT-LM; do not use this for
// release-like builds, UNICEF evidence, or current model-readiness claims.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const MODEL_ID = 'base-gemma-3n-e4b-it-ud-iq2-xxs-gguf';
const MODEL_FILE = 'gemma-3n-E4B-it-UD-IQ2_XXS.gguf';
const modelPath = path.resolve('.models', MODEL_ID, MODEL_FILE);
const timeoutMs = Number(process.env.SAFERIDE_LLAMA_SMOKE_TIMEOUT_MS ?? '300000');
const prompt = process.argv.slice(2).join(' ').trim() ||
  'In two short sentences, explain what a survivor should do first after harassment on public transport.';

function findCommand(command) {
  const result = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? null;
}

const llamaCli = process.env.LLAMA_CLI || findCommand('llama-cli') || findCommand('llama-cli.exe');

if (!existsSync(modelPath)) {
  console.error(`Missing model: ${modelPath}`);
  console.error('Run: npm run ai:legacy-gemma3n:download');
  process.exit(2);
}

if (!llamaCli) {
  console.error('Missing llama.cpp CLI. Install llama.cpp and set LLAMA_CLI to the llama-cli executable path.');
  console.error('The model download is ready for smoke testing once llama-cli is available.');
  process.exit(2);
}

const args = [
  '-m', modelPath,
  '-p', prompt,
  '-n', process.env.SAFERIDE_LLAMA_SMOKE_TOKENS ?? '16',
  '--ctx-size', process.env.SAFERIDE_LLAMA_SMOKE_CTX ?? '512',
  '--batch-size', '64',
  '--ubatch-size', '64',
  '--threads', process.env.SAFERIDE_LLAMA_SMOKE_THREADS ?? '4',
  '--gpu-layers', '0',
  '--temp', '0.2',
  '--no-warmup',
  '--no-display-prompt',
];

console.log(`Running ${llamaCli}`);
console.log(`Model: ${modelPath}`);
console.log(`Timeout: ${Math.round(timeoutMs / 1000)}s`);
const result = spawnSync(llamaCli, args, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  timeout: timeoutMs,
});

if (result.stdout.trim()) console.log(result.stdout.trim());
if (result.stderr.trim()) console.error(result.stderr.trim());
if (result.error) {
  console.error(`llama-cli failed: ${result.error.name}: ${result.error.message}`);
}
if (result.signal) {
  console.error(`llama-cli signal: ${result.signal}`);
}
if (typeof result.status === 'number' && result.status !== 0) {
  console.error(`llama-cli exited with status ${result.status}`);
}
process.exit(result.status ?? 1);
