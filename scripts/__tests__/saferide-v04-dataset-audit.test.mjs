import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { auditDataset } from '../saferide-gemma4-dataset-audit.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataPath = path.join(repoRoot, 'data/ai/gemma4/saferide-synthetic-guidance-v0.4.jsonl');
const registerPath = path.join(
  repoRoot,
  'docs/security/saferide-gemma4-colab-input-register.synthetic-v0.4.candidate.json',
);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function loadFixture() {
  const dataText = fs.readFileSync(dataPath, 'utf8').replace(/\r\n/g, '\n');
  const registerText = fs.readFileSync(registerPath, 'utf8').replace(/\r\n/g, '\n');
  return {
    rows: dataText.trim().split('\n').map(line => JSON.parse(line)),
    register: JSON.parse(registerText),
    dataSha256: sha256(dataText),
    registerSha256: sha256(registerText),
  };
}

function audit(mutator) {
  const fixture = structuredClone(loadFixture());
  mutator?.(fixture);
  return auditDataset(fixture);
}

test('the deterministic v0.4 candidate passes every mechanical dataset gate', () => {
  const report = audit();
  assert.equal(report.passed, true, report.failures.join('; '));
  assert.equal(report.rowCount, 320);
  assert.equal(report.overlap.exactTurn.length, 0);
  assert.equal(report.overlap.normalizedTurn.length, 0);
  assert.equal(report.overlap.nearDuplicates.length, 0);
  assert.equal(report.overlap.holdoutAssistantCopies.length, 0);
  assert.equal(report.protectedHoldouts.configured, true);
});

test('an exact or normalized turn collision across splits fails closed', () => {
  const report = audit(({ rows }) => {
    const train = rows.find(row => row.split === 'train');
    const dev = rows.find(row => row.split === 'dev');
    dev.messages[1].content = `  ${train.messages[1].content.toUpperCase()}  `;
  });
  assert.equal(report.passed, false);
  assert.ok(report.failures.some(failure => failure.startsWith('normalized turn overlap')));
});

test('a scenario family assigned to more than one split fails closed', () => {
  const report = audit(({ rows }) => {
    const train = rows.find(row => row.split === 'train');
    const dev = rows.find(row => row.split === 'dev');
    dev.metadata.scenarioFamily = train.metadata.scenarioFamily;
  });
  assert.equal(report.passed, false);
  assert.ok(report.failures.some(failure => failure.includes('scenario families cross splits')));
});

test('a copied assistant holdout target fails closed', () => {
  const report = audit(({ rows }) => {
    const train = rows.find(row => row.split === 'train');
    const holdout = rows.find(row => row.split === 'quality-holdout');
    holdout.messages[2].content = train.messages[2].content;
  });
  assert.equal(report.passed, false);
  assert.ok(report.failures.some(failure => failure.includes('holdout assistant-copy pairs')));
});

test('a register that exposes protected holdouts to training fails closed', () => {
  const report = audit(({ register }) => {
    register.protectedSplits.trainingAllowed = true;
  });
  assert.equal(report.passed, false);
  assert.ok(report.failures.some(failure => failure.includes('holdouts are not fail-closed')));
});

test('a diversity regression fails closed', () => {
  const report = audit(({ register }) => {
    register.auditPolicy.minDistinct3 = 1;
  });
  assert.equal(report.passed, false);
  assert.ok(report.failures.includes('distinct-3 is below policy'));
});

test('a repeated-opening concentration regression fails closed', () => {
  const report = audit(({ register }) => {
    register.auditPolicy.maxRepeatedOpeningShare = 0;
  });
  assert.equal(report.passed, false);
  assert.ok(report.failures.includes('highest repeated-opening share exceeds policy'));
});
