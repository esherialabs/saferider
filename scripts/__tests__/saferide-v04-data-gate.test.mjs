import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const checker = path.join(repoRoot, 'scripts/saferide-gemma4-finetune-data-check.mjs');
const register = path.join(repoRoot, 'docs/security/saferide-gemma4-colab-input-register.synthetic-v0.4.candidate.json');
const data = path.join(repoRoot, 'data/ai/gemma4/saferide-synthetic-guidance-v0.4.jsonl');
const audit = path.join(repoRoot, 'docs/security/saferide-gemma4-v04-dataset-audit.json');

function run(extra = []) {
  return spawnSync(process.execPath, [checker, '--register', register, '--data', data, ...extra], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

test('the draft pack passes preparation with its exact content-free audit', () => {
  const result = run(['--audit', audit]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('an audit with a stale data hash fails closed', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'saferide-v04-audit-'));
  try {
    const changed = JSON.parse(fs.readFileSync(audit, 'utf8'));
    changed.dataSha256 = '0'.repeat(64);
    const changedPath = path.join(tempDir, 'audit.json');
    fs.writeFileSync(changedPath, `${JSON.stringify(changed)}\n`);
    const result = run(['--audit', changedPath]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /audit\.dataSha256 does not match data bytes/);
  } finally {
    fs.rmSync(tempDir, { recursive: true });
  }
});

test('strict mode blocks pending reviews and non-segregated holdouts', () => {
  const result = run(['--audit', audit, '--for-finetuning']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /languageReviews\.sw\.status=approved/);
  assert.match(result.stderr, /promotionReviews\.safeguarding/);
  assert.match(result.stderr, /segregated-access evidence/);
  assert.doesNotMatch(result.stderr, /approved effective safe-assistant policy/);
  assert.match(result.stderr, /pipeline-only data cannot train/);
  assert.match(result.stderr, /independently approved minimum training-row count/);
  assert.match(result.stderr, /independent scale and template-diversity review/);
});

test('strict mode rejects a declared audit policy without the audit artifact', () => {
  const result = run(['--for-finetuning']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--audit <json> was not supplied/);
});
