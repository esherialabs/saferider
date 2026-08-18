import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  canonicalSha256,
  compileV05Schemas,
  createAuthoringJobs,
  fileSha256,
  jsonlText,
  readJson,
  readJsonl,
  schemaErrors,
  sha256,
  validateCandidateSet,
} from '../lib/saferide-gemma4-v05.mjs';
import { inspectArtifactPermissions } from '../lib/saferide-artifact-security.mjs';
import {
  contentBoundCandidateId,
  generateCandidateBatches,
  validateAuthoringPack,
  validateGeneratorConfiguration,
} from '../saferide-gemma4-v05-generate-candidates.mjs';
import { makeScenarioSpecs, makeSplitManifest, v05Plan } from './helpers/saferide-v05-fixtures.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scriptPath = path.join(repoRoot, 'scripts/saferide-gemma4-v05-generate-candidates.mjs');
const schemas = compileV05Schemas();
const plan = v05Plan();
const specs = makeScenarioSpecs(plan);
const manifest = makeSplitManifest(specs, plan);
const allJobs = createAuthoringJobs(specs, manifest);
const jobs = [
  allJobs.find(job => job.language === 'en' && job.conversationForm === 'single-turn'),
  allJobs.find(job => job.language === 'sw' && job.conversationForm === 'single-turn'),
  allJobs.find(job => job.language === 'en' && job.conversationForm === 'multi-turn'),
  allJobs.find(job => job.language === 'sw' && job.conversationForm === 'multi-turn'),
].sort((left, right) => left.jobId.localeCompare(right.jobId));

function testConfig(packSha256, overrides = {}) {
  const candidateOrdinals = overrides.candidateOrdinals ?? [1, 2];
  return {
    schema: 'com.saferide.ai.v05-generator-config',
    schemaVersion: 1,
    configId: overrides.configId ?? `test-v05-generator-${candidateOrdinals.join('-')}`,
    datasetId: 'saferide-synthetic-guidance-v0.5.0',
    status: 'test-only',
    runId: overrides.runId ?? 'test-v05-generation-run',
    runCreatedAt: '2026-08-01T00:00:00.000Z',
    sourceCommit: '1'.repeat(40),
    bindings: {
      authoringPackSha256: packSha256,
      scenarioMatrixSha256: '2'.repeat(64),
      splitManifestSha256: '3'.repeat(64),
    },
    provider: {
      protocol: 'mock-v1', providerId: 'saferide-deterministic-mock', immutableRevision: 'mock-v1',
      remote: false, timeoutMs: 1000, executablePath: null, executableSha256: null,
      arguments: [], credentialEnvironmentVariable: null, allowedEnvironmentVariables: [],
    },
    model: { modelId: 'fixture/deterministic-author', immutableRevision: 'fixture-v1' },
    generation: {
      candidateOrdinals,
      batchSize: overrides.batchSize ?? 2,
      maximumRetries: overrides.maximumRetries ?? 2,
      maxOutputTokens: 256,
      temperature: 0,
      topP: 1,
    },
    authoring: {
      method: 'deterministic-mock', toolId: 'repository-deterministic-mock', toolRevision: 'v1',
      authoringPromptId: 'fixture-independent-authoring-v1', authoringPromptSha256: '4'.repeat(64),
      policySha256: '5'.repeat(64), systemPromptConfigSha256: '6'.repeat(64),
      authorIdentityRef: 'fixture:deterministic-mock', termsAssessmentRef: 'fixture:test-only-no-production-use',
      languageMode: 'independent-from-shared-scenario', systemMessageInCandidate: false, syntheticOnlyAttested: true,
    },
    scope: { mode: 'explicit', jobIds: jobs.map(job => job.jobId) },
    approval: { remoteGenerationApproved: false, configurationOwnerRef: null, approvalEvidenceRef: null },
    privacy: {
      sourceBoundary: 'synthetic-only', rawContentLoggingAllowed: false, requestResponseLoggingAllowed: false,
      holdoutsAllowed: false, blindPromptsAllowed: false, survivorDataAllowed: false, productionLogsAllowed: false,
    },
    mock: { seed: 419805, failurePlan: overrides.failurePlan ?? [] },
  };
}

function withRoot(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'saferide-v05-generator-test-'));
  fs.chmodSync(root, 0o700);
  try {
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runDirect(root, config, { resume = false } = {}) {
  const packText = jsonlText(jobs);
  const packSha256 = sha256(packText);
  assert.equal(config.bindings.authoringPackSha256, packSha256);
  return generateCandidateBatches({
    root,
    jobs,
    config,
    configurationSha256: canonicalSha256(config),
    authoringPackSha256: packSha256,
    outputDir: path.join(root, 'candidates/incoming'),
    resume,
    schemas,
  });
}

function generatedCandidates(root) {
  const incoming = path.join(root, 'candidates/incoming');
  return fs.readdirSync(incoming).filter(name => name.endsWith('.jsonl')).sort()
    .flatMap(name => readJsonl(path.join(incoming, name)));
}

test('generator config and four-language/form authoring jobs validate without production approval claims', () => {
  const packSha256 = sha256(jsonlText(jobs));
  const config = testConfig(packSha256);
  assert.deepEqual(validateGeneratorConfiguration(config, schemas), []);
  assert.deepEqual(validateAuthoringPack(jobs, config, schemas), []);
  assert.deepEqual(new Set(jobs.map(job => job.language)), new Set(['en', 'sw']));
  assert.deepEqual(new Set(jobs.map(job => job.conversationForm)), new Set(['single-turn', 'multi-turn']));
});

test('deterministic mock creates content-bound candidates, atomic batches, and content-free manifests', () => withRoot(root => {
  const packSha256 = sha256(jsonlText(jobs));
  const config = testConfig(packSha256);
  const index = runDirect(root, config);
  assert.equal(index.status, 'complete');
  assert.equal(index.candidateCount, 8);
  assert.equal(index.coveredSlotCount, 4);
  assert.equal(index.batchCount, 2);
  assert.deepEqual(schemaErrors('index', schemas.generationIndex, index), []);
  const candidates = generatedCandidates(root);
  assert.equal(candidates.length, 8);
  assert.equal(new Set(candidates.map(candidate => candidate.candidateId)).size, 8);
  for (const candidate of candidates) {
    assert.equal(candidate.messages.some(message => message.role === 'system'), false);
    assert.equal(candidate.authoring.method, 'deterministic-mock');
    assert.equal(candidate.authoring.syntheticOnlyAttested, true);
    assert.equal(candidate.metadata.reviewStatus, 'unreviewed');
    assert.deepEqual(schemaErrors('candidate', schemas.example, candidate), []);
  }
  const manifestFiles = fs.readdirSync(path.join(root, 'candidates/incoming')).filter(name => name.endsWith('.manifest.json'));
  for (const name of manifestFiles) {
    const manifestText = fs.readFileSync(path.join(root, 'candidates/incoming', name), 'utf8');
    const batch = JSON.parse(manifestText);
    assert.deepEqual(schemaErrors('batch', schemas.generationBatch, batch), []);
    assert.equal(batch.completedSlots.length, batch.counts.completed);
    assert.equal(batch.privacy.containsPrompts, false);
    assert.doesNotMatch(manifestText, /This is a synthetic|Hii ni hali|assistant|messages/);
  }
  assert.deepEqual(inspectArtifactPermissions(root), []);
}));

test('resume is idempotent and targeted third variants never exceed three candidates per slot', () => withRoot(root => {
  const packSha256 = sha256(jsonlText(jobs));
  const initial = testConfig(packSha256, { candidateOrdinals: [1, 2], configId: 'test-v05-generator-initial' });
  const first = runDirect(root, initial);
  const indexBytes = fs.readFileSync(path.join(root, 'candidates/candidate-index.json'));
  const second = runDirect(root, initial, { resume: true });
  assert.equal(second.batchCount, first.batchCount);
  assert.equal(second.candidateCount, first.candidateCount);
  assert.deepEqual(fs.readFileSync(path.join(root, 'candidates/candidate-index.json')), indexBytes);

  const third = testConfig(packSha256, { candidateOrdinals: [3], configId: 'test-v05-generator-third' });
  const thirdIndex = runDirect(root, third, { resume: true });
  assert.equal(thirdIndex.candidateCount, 12);
  assert.equal(generatedCandidates(root).length, 12);
  const afterRepeat = runDirect(root, third, { resume: true });
  assert.equal(afterRepeat.candidateCount, 12);
  const counts = new Map();
  for (const candidate of generatedCandidates(root)) counts.set(candidate.id, (counts.get(candidate.id) ?? 0) + 1);
  assert.equal(Math.max(...counts.values()), 3);
}));

test('transient failures retry at most twice while deterministic or malformed failures do not retry', () => {
  const packSha256 = sha256(jsonlText(jobs));
  const first = jobs[0];
  withRoot(root => {
    const config = testConfig(packSha256, {
      candidateOrdinals: [1], maximumRetries: 2,
      failurePlan: [{ jobId: first.jobId, ordinal: 1, outcomes: ['transient-timeout', 'success'] }],
    });
    const index = runDirect(root, config);
    assert.equal(index.status, 'complete');
    const batch = readJson(path.join(root, index.batches[0].manifestPath));
    assert.equal(batch.retryCountsByReason.TRANSIENT_TIMEOUT, 1);
    assert.equal(batch.failures.length, 0);
  });
  withRoot(root => {
    const config = testConfig(packSha256, {
      candidateOrdinals: [1], maximumRetries: 2,
      failurePlan: [
        { jobId: first.jobId, ordinal: 1, outcomes: ['transient-rate-limit'] },
        { jobId: jobs[1].jobId, ordinal: 1, outcomes: ['malformed-output'] },
        { jobId: jobs[2].jobId, ordinal: 1, outcomes: ['deterministic-rejection'] },
      ],
    });
    const index = runDirect(root, config);
    assert.equal(index.status, 'partial-with-failures');
    const batches = index.batches.map(entry => readJson(path.join(root, entry.manifestPath)));
    const failures = batches.flatMap(batch => batch.failures);
    assert.equal(failures.find(failure => failure.jobId === first.jobId).attempts, 3);
    assert.equal(failures.find(failure => failure.jobId === jobs[1].jobId).attempts, 1);
    assert.equal(failures.find(failure => failure.jobId === jobs[2].jobId).attempts, 1);
  });
});

test('candidate identifiers change with row, ordinal, configuration, or canonical message content', () => {
  const messages = [{ role: 'user', content: 'synthetic request' }, { role: 'assistant', content: 'synthetic response' }];
  const base = contentBoundCandidateId('v05-privacy-family-0001-en', 1, 'a'.repeat(64), messages);
  const variants = [
    contentBoundCandidateId('v05-privacy-family-0002-en', 1, 'a'.repeat(64), messages),
    contentBoundCandidateId('v05-privacy-family-0001-en', 2, 'a'.repeat(64), messages),
    contentBoundCandidateId('v05-privacy-family-0001-en', 1, 'b'.repeat(64), messages),
    contentBoundCandidateId('v05-privacy-family-0001-en', 1, 'a'.repeat(64), [{ ...messages[0] }, { role: 'assistant', content: 'different response' }]),
  ];
  assert.equal(new Set([base, ...variants]).size, 5);
});

test('resume rejects a batch whose candidate identifiers collide even when its file hash is updated', () => withRoot(root => {
  const packSha256 = sha256(jsonlText(jobs));
  const config = testConfig(packSha256, { candidateOrdinals: [1] });
  const index = runDirect(root, config);
  const manifestPath = path.join(root, index.batches[0].manifestPath);
  const manifest = readJson(manifestPath);
  const candidatePath = path.join(root, manifest.candidateFile.path);
  const candidates = readJsonl(candidatePath);
  assert.equal(candidates.length, 2);
  candidates[1].candidateId = candidates[0].candidateId;
  const tampered = jsonlText(candidates);
  fs.writeFileSync(candidatePath, tampered, { mode: 0o600 });
  manifest.candidateFile.sha256 = sha256(tampered);
  manifest.candidateFile.sizeBytes = Buffer.byteLength(tampered);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  assert.throws(() => runDirect(root, config, { resume: true }), /repeats a candidate ID/);
}));

test('deterministic mock candidates are schema-valid fixtures but fail a production import', () => withRoot(root => {
  const packSha256 = sha256(jsonlText(jobs));
  runDirect(root, testConfig(packSha256, { candidateOrdinals: [1] }));
  const candidates = generatedCandidates(root);
  const blocked = validateCandidateSet(candidates, specs, manifest, plan, { schemas });
  assert.match(blocked.errors.join('\n'), /test fixtures.*cannot enter a production import/);
  const fixtureAllowed = validateCandidateSet(candidates, specs, manifest, plan, { schemas, allowTestFixtures: true });
  assert.deepEqual(fixtureAllowed.errors, []);
}));

test('CLI is portable, preserves content-free stdout, and refuses non-resume mutation', { timeout: 30_000 }, () => withRoot(root => {
  const localJobs = structuredClone(jobs);
  const packText = jsonlText(localJobs);
  const packPath = path.join(root, 'authoring/authoring-pack.jsonl');
  fs.mkdirSync(path.dirname(packPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(packPath, packText, { mode: 0o600 });
  const config = testConfig(sha256(packText));
  config.scope.jobIds = localJobs.map(job => job.jobId);
  const configPath = path.join(root, 'run/generator-config.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  const args = [
    scriptPath, '--artifact-root', root, '--authoring-pack', 'authoring/authoring-pack.jsonl',
    '--output-dir', 'candidates/incoming', '--generator-config', 'run/generator-config.json',
    '--batch-size', '2', '--candidates-per-job', '2',
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: os.tmpdir(), encoding: 'utf8', env: { ...process.env, SAFE_GENERATOR_TEST_SECRET: 'DO_NOT_LOG_SECRET_SENTINEL' },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /DO_NOT_LOG_SECRET_SENTINEL|This is a synthetic|Hii ni hali/);
  const mutation = spawnSync(process.execPath, args, { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(mutation.status, 1);
  assert.match(mutation.stderr, /--resume/);
  const resume = spawnSync(process.execPath, [...args, '--resume'], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(resume.status, 0, `${resume.stdout}\n${resume.stderr}`);
  assert.equal(fileSha256(path.join(root, 'candidates/candidate-index.json')).length, 64);
}));
