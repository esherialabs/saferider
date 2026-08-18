import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import { validateTrainingRun } from '../saferide-ai-training-run-check.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'schemas/ai-training-run.schema.json'), 'utf8'));

function validator() {
  return new Ajv2020({ allErrors: true, strict: true, strictRequired: false, strictTypes: false }).compile(schema);
}

function fixture() {
  return {
    schema: 'com.saferide.ai.training-run',
    schemaVersion: 1,
    runId: 'saferide-preflight-test',
    createdAt: '2026-07-30T00:00:00.000Z',
    issue: 'ESH-4198',
    mode: 'dry-run',
    runKind: 'preflight',
    candidateRun: false,
    promotionEligible: false,
    status: 'preflight-complete',
    baseModelId: 'google/gemma-4-E2B-it',
    baseRevision: 'unresolved',
    baseModelSource: 'hugging-face-hub',
    register: 'register.json',
    registerSha256: 'a'.repeat(64),
    data: null,
    dataSha256: null,
    audit: null,
    auditSha256: null,
    dataGate: { command: 'content-free data check', exitCode: 0, passed: true },
    dataSummary: { rowCount: 0 },
    environment: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 },
    packageVersions: {
      torch: 'not-installed', transformers: 'not-installed', datasets: 'not-installed',
      peft: 'not-installed', accelerate: 'not-installed', safetensors: 'not-installed',
    },
    runArguments: {
      seed: 419804,
      epochs: 1,
      maxSteps: null,
      maxSequenceLength: 1024,
      trainBatchSize: 1,
      evalBatchSize: 1,
      gradientAccumulationSteps: 8,
      effectiveBatchSize: 8,
      learningRate: 0.00002,
      warmupRatio: 0.03,
      scheduler: 'cosine',
      loggingSteps: 5,
      evalSteps: 5,
      saveSteps: 5,
      earlyStoppingPatience: 3,
      selectionMetric: 'eval_loss',
    },
    repeatability: { required: false, secondSeedRunId: null, status: 'not-applicable-to-non-candidate' },
    privacy: {
      rawPromptLogging: 'forbidden', rawCompletionLogging: 'forbidden',
      survivorDataUsed: false, metadataOnly: true,
    },
    failure: null,
    outputs: {},
  };
}

const hashIds = ids => crypto.createHash('sha256').update(ids.join('\n')).digest('hex');

function v05CompletedFixture(runKind = 'candidate') {
  const value = fixture();
  const trainCount = runKind === 'pilot' ? 320 : 1600;
  const trainRowIds = Array.from({ length: trainCount }, (_, index) => `v05-train-row-${String(index).padStart(4, '0')}`);
  const developmentRowIds = Array.from({ length: 300 }, (_, index) => `v05-dev-row-${String(index).padStart(4, '0')}`);
  Object.assign(value, {
    datasetProfile: 'v05', runKind, candidateRun: runKind === 'candidate',
    status: 'completed', mode: 'prototype-finetune', baseRevision: 'b'.repeat(40),
    dataFiles: {
      train: { path: '/controlled/train.jsonl', sha256: 'c'.repeat(64) },
      dev: { path: '/controlled/dev.jsonl', sha256: 'd'.repeat(64) },
    },
    audit: '/controlled/audit.json', auditSha256: 'e'.repeat(64),
    datasetManifest: '/controlled/dataset-manifest.json', datasetManifestSha256: 'f'.repeat(64),
    datasetBindings: {
      datasetId: 'saferide-synthetic-guidance-v0.5.0', planSha256: '1'.repeat(64),
      policySha256: '2'.repeat(64), systemPromptConfigSha256: '3'.repeat(64), systemPromptTextSha256: '4'.repeat(64),
      scenarioSpecSha256: '5'.repeat(64), splitManifestSha256: '6'.repeat(64), reviewLedgerSha256: '7'.repeat(64),
      pilotRowManifest: runKind === 'pilot' ? '/controlled/pilot.json' : null,
      pilotRowManifestSha256: runKind === 'pilot' ? '8'.repeat(64) : null,
    },
  });
  value.runArguments = {
    ...value.runArguments, seed: 419805, evalSteps: 25, saveSteps: 25,
    loraRank: 8, loraAlpha: 16, loraDropout: 0.05, loraRankApprovalRef: null,
  };
  value.repeatability = runKind === 'candidate'
    ? { required: true, secondSeedRunId: 'saferide-v05-seed-b', status: 'pending' }
    : { required: false, secondSeedRunId: null, status: 'not-applicable-to-non-candidate' };
  value.privacy = {
    ...value.privacy, classification: 'controlled-content-free', containsExactRowIds: true,
  };
  value.dataSummary = {
    rowCount: 1900,
    datasetIds: ['saferide-synthetic-guidance-v0.5.0'],
    splitCounts: { train: 1600, dev: 300 },
    rowIdSha256: 'e'.repeat(64),
  };
  value.environment = {
    ...value.environment, dependencyConstraintsSatisfied: true,
    requirementsSha256: '9'.repeat(64), constraintsSha256: 'a'.repeat(64),
  };
  value.outputs = {
    runKind, epochsCompleted: 1, sampleOrder: [...trainRowIds], sampleOrderSha256: hashIds(trainRowIds),
    rowsSeen: trainCount, selectionMetric: 'eval_loss', bestMetric: 0.5,
    chatTemplateSha256: 'b'.repeat(64), tokenizerRevision: 'c'.repeat(40),
    adapterFiles: [{ path: 'adapter.safetensors', sizeBytes: 1, sha256: 'd'.repeat(64) }],
    holdoutRowsRead: 0, trainRowIds, trainRowIdSha256: hashIds(trainRowIds),
    developmentRowIds, developmentRowIdSha256: hashIds(developmentRowIds),
  };
  return value;
}

test('a content-free preflight manifest passes schema and semantic gates', () => {
  assert.deepEqual(validateTrainingRun(fixture(), validator(), { verifyFiles: false }), []);
});

test('promotion eligibility cannot be asserted by the training runner', () => {
  const value = fixture();
  value.promotionEligible = true;
  assert.ok(validateTrainingRun(value, validator(), { verifyFiles: false }).some(error => error.includes('promotionEligible')));
});

test('raw output fields are rejected from content-free evidence', () => {
  const value = fixture();
  value.outputs = { prompt: 'synthetic but still private output' };
  assert.ok(validateTrainingRun(value, validator(), { verifyFiles: false }).some(error => error.includes('forbidden')));
});

test('a completed candidate without full lineage and training evidence fails closed', () => {
  const value = fixture();
  Object.assign(value, {
    runKind: 'candidate', candidateRun: true, status: 'completed', mode: 'prototype-finetune',
    baseRevision: 'b'.repeat(40), data: 'data.jsonl', dataSha256: 'c'.repeat(64),
    audit: 'audit.json', auditSha256: 'd'.repeat(64),
  });
  value.repeatability = { required: true, secondSeedRunId: null, status: 'pending' };
  const errors = validateTrainingRun(value, validator(), { verifyFiles: false });
  assert.ok(errors.some(error => error.includes('exact sample order')));
  assert.ok(errors.some(error => error.includes('best-checkpoint')));
  assert.ok(errors.some(error => error.includes('hashed adapter inventory')));
});

test('a complete v0.5 candidate manifest binds separate train/dev inputs and exact row inventories', () => {
  assert.deepEqual(validateTrainingRun(v05CompletedFixture(), validator(), { verifyFiles: false }), []);
});

test('a complete v0.5 pilot requires exactly the deterministic 320-row inventory', () => {
  assert.deepEqual(validateTrainingRun(v05CompletedFixture('pilot'), validator(), { verifyFiles: false }), []);
});

test('v0.5 manifest rejects holdout access, stale sample order, wrong seed, and unapproved rank 16', () => {
  const value = v05CompletedFixture();
  value.outputs.holdoutRowsRead = 1;
  value.outputs.sampleOrder[0] = 'different-row';
  value.runArguments.seed = 1;
  value.runArguments.loraRank = 16;
  const errors = validateTrainingRun(value, validator(), { verifyFiles: false }).join('\n');
  assert.match(errors, /holdout rows/);
  assert.match(errors, /sample order/);
  assert.match(errors, /seed/);
  assert.match(errors, /rank 16/);
});
