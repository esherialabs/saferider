import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  compileV05Schemas,
  fileSha256,
  readJson,
  schemaErrors,
} from '../lib/saferide-gemma4-v05.mjs';
import { inspectArtifactPermissions } from '../lib/saferide-artifact-security.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pipelinePath = path.join(repoRoot, 'scripts/saferide-gemma4-v05-production-pipeline.mjs');
const registerPath = path.join(repoRoot, 'scripts/saferide-gemma4-v05-register.mjs');
const readinessPath = path.join(repoRoot, 'scripts/saferide-gemma4-v05-readiness.mjs');
const schemas = compileV05Schemas();

function run(script, args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd ?? os.tmpdir(),
    encoding: 'utf8',
    env: { ...process.env, SAFERIDE_PIPELINE_TEST_SENTINEL: 'private-test-sentinel-must-not-appear' },
    maxBuffer: 16 * 1024 * 1024,
  });
}

function combined(result) {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

function assertPrivateTree(root) {
  if (process.platform !== 'win32') assert.deepEqual(inspectArtifactPermissions(root), []);
}

test('pipeline and register CLI contracts are cwd-portable and reject a production root inside the repository', () => {
  const contract = run(pipelinePath, ['contract-check']);
  assert.equal(contract.status, 0, combined(contract));
  assert.match(contract.stdout, /contracts PASS/);

  const help = run(pipelinePath, ['--help']);
  assert.equal(help.status, 0, combined(help));
  for (const command of ['init', 'run', 'verify', 'status', 'smoke']) assert.match(help.stdout, new RegExp(command));

  const registerContract = run(registerPath, ['--contract-check']);
  assert.equal(registerContract.status, 0, combined(registerContract));

  const rejected = run(pipelinePath, ['init', '--artifact-root', path.join(repoRoot, '.ai-smoke', 'production-must-be-rejected')]);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /outside the repository/);
});

test('mechanical smoke traverses every state without becoming production evidence and invalidates on byte drift', { timeout: 30_000 }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'saferide-v05-pipeline-smoke-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const first = run(pipelinePath, ['smoke', '--artifact-root', root]);
  assert.equal(first.status, 0, combined(first));
  assert.match(first.stdout, /16 non-production transitions/);
  assert.doesNotMatch(combined(first), /private-test-sentinel|candidate text|reviewer note/i);

  const statePath = path.join(root, 'run/pipeline-state.json');
  const ledgerPath = path.join(root, 'run/command-ledger.jsonl');
  const manifestPath = path.join(root, 'public-safe/pipeline-run-manifest.json');
  const hashesBeforeResume = [statePath, ledgerPath, manifestPath].map(fileSha256);
  const second = run(pipelinePath, ['smoke', '--artifact-root', root, '--resume']);
  assert.equal(second.status, 0, combined(second));
  assert.deepEqual([statePath, ledgerPath, manifestPath].map(fileSha256), hashesBeforeResume);

  const state = readJson(statePath);
  const manifest = readJson(manifestPath);
  assert.deepEqual(schemaErrors('pipelineState', schemas.pipelineState, state), []);
  assert.deepEqual(schemaErrors('pipelineRunManifest', schemas.pipelineRunManifest, manifest), []);
  assert.equal(state.datasetId, 'saferide-v05-mechanical-smoke-fixture');
  assert.equal(state.currentState, 'smoke-complete');
  assert.equal(state.status, 'complete');
  assert.equal(state.transitions.length, 16);
  assert.equal(manifest.strictReady, false);
  assert.equal(manifest.trainingHandoffComplete, false);
  assert.equal(manifest.productionReadinessProhibited, true);
  assert.equal(JSON.stringify({ state, manifest }).includes(root), false);
  assertPrivateTree(root);

  const registerRefusal = run(registerPath, [
    '--artifact-root', root, '--evidence-config', 'run/missing.json', '--output', 'register/input-register.json',
  ]);
  assert.equal(registerRefusal.status, 1);
  assert.match(registerRefusal.stderr, /Smoke roots cannot produce/);

  const readinessRefusal = run(readinessPath, [
    '--strict', '--artifact-root', root,
    '--train-data', path.join(root, 'missing-train.jsonl'), '--dev-data', path.join(root, 'missing-dev.jsonl'),
  ]);
  assert.equal(readinessRefusal.status, 1);
  assert.match(readinessRefusal.stderr, /mechanical smoke roots can never satisfy/);

  const finalSmokeArtifact = state.transitions.at(-1).outputs[0].path;
  fs.appendFileSync(path.join(root, finalSmokeArtifact), '\n', { mode: 0o600 });
  const drift = run(pipelinePath, ['verify', '--artifact-root', root]);
  assert.equal(drift.status, 1);
  assert.match(drift.stderr, /drift invalidated/);
  const invalidated = readJson(statePath);
  assert.equal(invalidated.invalidated, true);
  assert.equal(invalidated.status, 'invalidated');
  assert.deepEqual(invalidated.blockers, ['RECORDED_ARTIFACT_HASH_DRIFT']);
});

test('production pipeline creates exact draft evidence, resumes byte-stably, and builds a truthful actual-byte blocked register', { timeout: 30_000 }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'saferide-v05-pipeline-production-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const init = run(pipelinePath, ['init', '--artifact-root', root, '--run-id', 'v05-production-esh4198-test-fixture']);
  assert.equal(init.status, 0, combined(init));
  const attempt = run(pipelinePath, ['run', '--artifact-root', root]);
  assert.equal(attempt.status, 1, combined(attempt));
  assert.match(attempt.stdout, /SCENARIO_APPROVAL_REQUIRED/);
  assert.doesNotMatch(combined(attempt), /private-test-sentinel|unsafePressure|userGoal|synthetic design cell/i);

  const statePath = path.join(root, 'run/pipeline-state.json');
  const ledgerPath = path.join(root, 'run/command-ledger.jsonl');
  const manifestPath = path.join(root, 'public-safe/pipeline-run-manifest.json');
  const metricsPath = path.join(root, 'public-safe/scenario-metrics.json');
  const splitEvidencePath = path.join(root, 'public-safe/split-reproducibility.json');
  const state = readJson(statePath);
  const metrics = readJson(metricsPath);
  const splitEvidence = readJson(splitEvidencePath);
  assert.equal(state.currentState, 'split-draft');
  assert.equal(state.status, 'blocked');
  assert.deepEqual(state.blockers, ['SCENARIO_APPROVAL_REQUIRED']);
  assert.equal(state.transitions.length, 3);
  assert.equal(metrics.passed, true);
  assert.equal(metrics.integrity.canonicalRecordCount, 1300);
  assert.equal(metrics.failedCells.length, 0);
  assert.equal(splitEvidence.identical, true);
  assert.equal(splitEvidence.familyCount, 1300);
  assert.equal(splitEvidence.rowCount, 2600);
  assert.equal(splitEvidence.canonicalSha256, splitEvidence.reproductionSha256);

  const beforeResume = [statePath, ledgerPath, manifestPath, metricsPath, splitEvidencePath].map(fileSha256);
  const resume = run(pipelinePath, ['run', '--artifact-root', root, '--resume']);
  assert.equal(resume.status, 1, combined(resume));
  assert.deepEqual([statePath, ledgerPath, manifestPath, metricsPath, splitEvidencePath].map(fileSha256), beforeResume);
  const verify = run(pipelinePath, ['verify', '--artifact-root', root]);
  assert.equal(verify.status, 0, combined(verify));
  assertPrivateTree(root);

  const draft = path.join(root, 'matrix/scenarios.draft.jsonl');
  const pendingFrozen = path.join(root, 'matrix/scenarios.frozen.jsonl');
  fs.copyFileSync(draft, pendingFrozen);
  fs.chmodSync(pendingFrozen, 0o600);
  const registerOutput = 'register/blocked-input-register.json';
  const register = run(registerPath, [
    '--artifact-root', root, '--evidence-config', 'run/register-evidence.json', '--output', registerOutput,
  ]);
  assert.equal(register.status, 0, combined(register));
  assert.match(register.stdout, /Dataset register BLOCKED/);
  assert.doesNotMatch(combined(register), /private-test-sentinel|userGoal|unsafePressure/i);
  const builtRegister = readJson(path.join(root, registerOutput));
  assert.deepEqual(schemaErrors('register', schemas.register, builtRegister), []);
  assert.equal(builtRegister.status, 'blocked');
  assert.equal(builtRegister.trainingReadiness.strictGatePassed, false);
  assert.equal(builtRegister.artifacts.scenarioSpecs.sha256, fileSha256(pendingFrozen));
  assert.equal(builtRegister.artifacts.scenarioSpecs.sizeBytes, fs.statSync(pendingFrozen).size);
  assert.equal(builtRegister.artifacts.scenarioSpecs.recordCount, 1300);
  assert.equal(builtRegister.artifacts.scenarioSpecs.schema, 'com.saferide.ai.scenario-spec');
  assert.ok(builtRegister.artifacts.scenarioSpecs.upstreamSha256.length >= 2);

  const strictBlocked = run(registerPath, [
    '--artifact-root', root, '--evidence-config', 'run/register-evidence.json',
    '--output', 'register/must-not-pass.json', '--validate-strict',
  ]);
  assert.equal(strictBlocked.status, 1);
  assert.match(strictBlocked.stderr, /requires desiredStatus=training-ready/);
});
