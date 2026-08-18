#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const candidates = process.platform === 'win32'
  ? [['py', ['-3.12']], ['python', []], ['python3', []]]
  : [['python3', []], ['python', []]];

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/run-python.mjs <script.py> [...args]');
  process.exit(2);
}

for (const [command, prefix] of candidates) {
  const probe = spawnSync(command, [...prefix, '--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) continue;

  const result = spawnSync(command, [...prefix, ...args], {
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`Unable to start ${command}: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

console.error('Python 3 is required but no supported interpreter was found.');
process.exit(1);
