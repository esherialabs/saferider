import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scriptPath = path.join(repoRoot, 'scripts/saferide-gemma4-litertlm-preseed.mjs');

test('prints the exact v0.5.8 app-internal target from structured JSON', () => {
  const output = execFileSync(process.execPath, [scriptPath, '--print-target'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.match(output, /esherialabs\/saferide-gemma-4-e2b-v058-original-419806-litertlm/);
  assert.match(output, /saferide-gemma4-e2b-v058-original-419806-runtime-compatible\.litertlm/);
  assert.match(output, /5071837136 bytes/);
});

test('rejects a manifest that has no produced artifact', () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'config/ai/manifests/saferide-v058-original-419806.artifact-produced.json'),
    'utf8',
  ));
  manifest.status = 'export-blocked';
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'saferide-preseed-'));
  const manifestPath = path.join(temporary, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));

  assert.throws(
    () => execFileSync(process.execPath, [scriptPath, '--manifest', manifestPath, '--print-target'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    }),
    /does not contain a produced artifact/,
  );
});
