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
  fileSha256,
  schemaErrors,
  sha256,
  stableJson,
} from '../lib/saferide-gemma4-v05.mjs';
import { compileEvaluationSchemas, validateComparatorPlan } from '../lib/saferide-gemma4-evaluation.mjs';
import { validateV05EvaluationPlan } from '../saferide-gemma4-v05-evaluation-check.mjs';
import { developmentPanelEligibilityErrors, validateSelectedRunConsistency, validateV05TrainingSelection } from '../saferide-gemma4-v05-training-check.mjs';
import {
  approvedPolicy,
  approvedSystemPrompt,
  makeApprovedFixture,
  makeBlindPrompts,
} from './helpers/saferide-v05-fixtures.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = relative => JSON.parse(fs.readFileSync(path.join(repoRoot, relative), 'utf8'));

function writeFixtureFile(root, relative, bytes) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, bytes, { mode: 0o600 });
  return {
    file,
    path: relative.split(path.sep).join('/'),
    sha256: fileSha256(file),
    sizeBytes: fs.statSync(file).size,
  };
}

function rewriteFixtureJson(file, value) {
  fs.writeFileSync(file.file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  return { ...file, sha256: fileSha256(file.file), sizeBytes: fs.statSync(file.file).size };
}

function jsonl(rows) {
  return `${rows.map(row => JSON.stringify(row)).join('\n')}\n`;
}

function makeAdapterInventory(artifactId, immutableRevision, file) {
  const files = [{ path: 'adapter_model.safetensors', sha256: file.sha256, sizeBytes: file.sizeBytes }];
  return {
    schema: 'com.saferide.ai.artifact-file-inventory',
    schemaVersion: 1,
    artifactId,
    immutableRevision,
    fileManifestSha256: canonicalSha256(files),
    files,
  };
}

function makeCompletedTrainingRun({
  seed,
  runId,
  otherRunId,
  trainRows,
  devRows,
  sampleOrder,
  files,
  bindings,
  baseRevision,
  bestCheckpoint,
  bestMetric,
  adapterDir,
  adapterFiles,
}) {
  const trainRowIds = trainRows.map(row => row.id);
  const developmentRowIds = devRows.map(row => row.id);
  return {
    schema: 'com.saferide.ai.training-run',
    schemaVersion: 1,
    runId,
    createdAt: '2026-08-01T00:00:00.000Z',
    issue: 'ESH-4198',
    datasetProfile: 'v05',
    mode: 'prototype-finetune',
    runKind: 'candidate',
    candidateRun: true,
    promotionEligible: false,
    status: 'completed',
    baseModelId: 'google/gemma-4-E2B-it',
    baseRevision,
    baseModelSource: 'staged-offline-snapshot',
    register: files.register.file,
    registerSha256: files.register.sha256,
    data: null,
    dataSha256: null,
    dataFiles: {
      train: { path: files.train.file, sha256: files.train.sha256 },
      dev: { path: files.dev.file, sha256: files.dev.sha256 },
    },
    audit: files.audit.file,
    auditSha256: files.audit.sha256,
    datasetManifest: files.datasetManifest.file,
    datasetManifestSha256: files.datasetManifest.sha256,
    datasetBindings: {
      datasetId: 'saferide-synthetic-guidance-v0.5.0',
      planSha256: bindings.planSha256,
      policySha256: bindings.policySha256,
      systemPromptConfigSha256: bindings.systemPromptConfigSha256,
      systemPromptTextSha256: bindings.systemPromptTextSha256,
      scenarioSpecSha256: bindings.scenarioSpecSha256,
      splitManifestSha256: bindings.splitManifestSha256,
      reviewLedgerSha256: bindings.reviewLedgerSha256,
      pilotRowManifest: null,
      pilotRowManifestSha256: null,
    },
    dataGate: { command: 'fixture content-free strict data gate', exitCode: 0, passed: true },
    dataSummary: {
      rowCount: 1900,
      datasetIds: ['saferide-synthetic-guidance-v0.5.0'],
      splitCounts: { train: 1600, dev: 300 },
      rowIdSha256: sha256([...trainRowIds, ...developmentRowIds].join('\n')),
    },
    environment: {
      python: '3.12.0', platform: 'fixture', accelerator: 'fixture', dependencyConstraintsSatisfied: true,
      requirements: 'requirements-ai-smoke.txt',
      requirementsSha256: fileSha256(path.join(repoRoot, 'requirements-ai-smoke.txt')),
      constraints: 'constraints-ai-training.txt',
      constraintsSha256: fileSha256(path.join(repoRoot, 'constraints-ai-training.txt')),
    },
    packageVersions: {
      torch: 'fixture', transformers: 'fixture', datasets: 'fixture', peft: 'fixture',
      accelerate: 'fixture', safetensors: 'fixture',
    },
    runArguments: {
      seed, epochs: 1, maxSteps: null, maxSequenceLength: 1024,
      trainBatchSize: 1, evalBatchSize: 1, gradientAccumulationSteps: 8, effectiveBatchSize: 8,
      learningRate: 0.00001, warmupRatio: 0.03, scheduler: 'cosine', loggingSteps: 5,
      evalSteps: 25, saveSteps: 25, earlyStoppingPatience: 3, selectionMetric: 'eval_loss',
      loraRank: 8, loraAlpha: 16, loraDropout: 0.05, loraRankApprovalRef: null,
    },
    repeatability: { required: true, secondSeedRunId: otherRunId, status: 'passed' },
    privacy: {
      rawPromptLogging: 'forbidden', rawCompletionLogging: 'forbidden', survivorDataUsed: false,
      metadataOnly: true, classification: 'controlled-content-free', containsExactRowIds: true,
    },
    failure: null,
    outputs: {
      runKind: 'candidate', epochsCompleted: 1, sampleOrder,
      sampleOrderSha256: sha256(sampleOrder.join('\n')), rowsSeen: 1600,
      selectionMetric: 'eval_loss', bestMetric, bestCheckpoint,
      chatTemplateSha256: 'b'.repeat(64), tokenizerRevision: 'c'.repeat(40),
      adapterDir, adapterFiles, holdoutRowsRead: 0, trainRowIds,
      trainRowIdSha256: sha256(trainRowIds.join('\n')), developmentRowIds,
      developmentRowIdSha256: sha256(developmentRowIds.join('\n')),
    },
  };
}

function makeStrictEvaluationFixture() {
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'saferide-v05-strict-evaluation-'));
  fs.mkdirSync(path.join(repoRoot, '.ai-smoke'), { recursive: true, mode: 0o700 });
  const repositoryFixtureRoot = fs.mkdtempSync(path.join(repoRoot, '.ai-smoke', 'strict-evaluation-test-'));
  const repositoryPath = file => path.relative(repoRoot, file).split(path.sep).join('/');
  const writeRepositoryJson = (name, value) => {
    const file = path.join(repositoryFixtureRoot, name);
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    return { file, path: repositoryPath(file), sha256: fileSha256(file) };
  };

  const fixture = makeApprovedFixture();
  const rowsBySplit = new Map(['train', 'dev', 'quality-holdout', 'safety-holdout']
    .map(split => [split, fixture.rows.filter(row => row.split === split)]));
  const splitFiles = new Map();
  for (const [split, rows] of rowsBySplit) {
    const prefix = ['train', 'dev'].includes(split) ? 'controlled' : 'restricted';
    splitFiles.set(split, writeFixtureFile(externalRoot, `${prefix}/${split}.jsonl`, jsonl(rows)));
  }
  const blindFile = writeFixtureFile(externalRoot, 'restricted/blind-evaluation.jsonl', jsonl(makeBlindPrompts()));
  const pilot = {
    schema: 'com.saferide.ai.v05-pilot-row-manifest', schemaVersion: 1,
    datasetId: 'saferide-synthetic-guidance-v0.5.0', seed: 419805,
    rowsPerCategoryLanguage: 16, rowCount: 320,
    rowIdInventorySha256: sha256(fixture.pilotRowIds.join('\n')), rowIds: fixture.pilotRowIds,
  };
  const pilotFile = writeFixtureFile(externalRoot, 'controlled/pilot-row-manifest.json', `${JSON.stringify(pilot, null, 2)}\n`);

  const policyFile = writeRepositoryJson('approved-policy.fixture.json', approvedPolicy());
  const systemPrompt = approvedSystemPrompt();
  const systemPromptFile = writeRepositoryJson('approved-system-prompt.fixture.json', systemPrompt);
  const register = json('docs/security/saferide-gemma4-colab-input-register.synthetic-v0.5.candidate.json');
  register.status = 'training-ready';
  register.model.immutableBaseRevision = '7'.repeat(40);
  register.bindings.policy = {
    path: policyFile.path, sha256: policyFile.sha256, status: 'approved', approvalEvidenceRef: 'fixture:policy-approval',
  };
  register.bindings.systemPrompt = {
    path: systemPromptFile.path, sha256: systemPromptFile.sha256, textSha256: systemPrompt.textSha256,
    status: 'approved', approvalEvidenceRef: 'fixture:system-prompt-approval',
  };
  register.gates = register.gates.map(gate => ({ ...gate, status: 'passed', evidenceRef: `fixture:${gate.gateId}` }));
  Object.assign(register.holdoutControls, {
    custodianIdentityRef: 'fixture:independent-custodian',
    segregatedAccessEvidenceRef: 'fixture:segregated-access',
    accessLogEvidenceRef: 'fixture:access-log',
  });
  register.trainingReadiness = { ...register.trainingReadiness, status: 'training-ready', strictGatePassed: true, blockers: [] };

  for (const [name, artifact] of Object.entries(register.artifacts)) {
    const dummy = writeFixtureFile(externalRoot, `${artifact.classification}/metadata-${name}.json`, `${JSON.stringify({ fixture: name })}\n`);
    register.artifacts[name] = { ...artifact, status: 'frozen', path: dummy.path, sha256: dummy.sha256, sizeBytes: dummy.sizeBytes };
  }
  const artifactFor = (name, file) => {
    register.artifacts[name] = {
      ...register.artifacts[name], status: 'frozen', path: file.path, sha256: file.sha256, sizeBytes: file.sizeBytes,
    };
  };
  artifactFor('train', splitFiles.get('train'));
  artifactFor('dev', splitFiles.get('dev'));
  artifactFor('qualityHoldout', splitFiles.get('quality-holdout'));
  artifactFor('safetyHoldout', splitFiles.get('safety-holdout'));
  artifactFor('blindEvaluation', blindFile);
  artifactFor('pilotSelection', pilotFile);

  const planSha256 = fileSha256(path.join(repoRoot, 'config/ai/datasets/saferide-gemma4-v05-plan.json'));
  register.bindings.plan.sha256 = planSha256;
  const datasetFiles = [...rowsBySplit].map(([split, rows]) => {
    const file = splitFiles.get(split);
    return {
      split, path: file.path, classification: ['train', 'dev'].includes(split) ? 'controlled' : 'restricted',
      rowCount: rows.length, sizeBytes: file.sizeBytes, sha256: file.sha256,
      rowIdInventorySha256: sha256(rows.map(row => row.id).join('\n')),
    };
  });
  const datasetManifest = {
    schema: 'com.saferide.ai.v05-dataset-artifact-manifest', schemaVersion: 1,
    manifestId: 'saferide-gemma4-v05-artifacts-strict-evaluation-fixture.1',
    datasetId: 'saferide-synthetic-guidance-v0.5.0', status: 'audited',
    buildImplementation: {
      path: 'scripts/saferide-gemma4-v05-build.mjs',
      sha256: fileSha256(path.join(repoRoot, 'scripts/saferide-gemma4-v05-build.mjs')),
    },
    bindings: {
      planSha256,
      scenarioSpecSha256: register.artifacts.scenarioSpecs.sha256,
      splitManifestSha256: register.artifacts.splitManifest.sha256,
      candidateFileSha256: register.artifacts.candidates.sha256,
      reviewLedgerSha256: register.artifacts.reviewLedger.sha256,
      systemPromptConfigSha256: systemPromptFile.sha256,
      systemPromptTextSha256: systemPrompt.textSha256,
      policySha256: policyFile.sha256,
    },
    files: datasetFiles,
    pilotSelection: {
      path: pilotFile.path, rowCount: 320, seed: 419805, rowsPerCategoryLanguage: 16,
      sizeBytes: pilotFile.sizeBytes, sha256: pilotFile.sha256,
      rowIdInventorySha256: pilot.rowIdInventorySha256,
    },
    datasetInventorySha256: sha256(stableJson(datasetFiles)),
    privacy: {
      containsSurvivorData: false, containsEvidence: false, containsRawProductionLogs: false,
      rawContentLogged: false, holdoutsCommittedToPublicRepository: false,
    },
  };
  const datasetManifestFile = writeFixtureFile(
    externalRoot,
    'public-safe/dataset-manifest.json',
    `${JSON.stringify(datasetManifest, null, 2)}\n`,
  );
  artifactFor('datasetManifest', datasetManifestFile);
  const registerFile = writeFixtureFile(externalRoot, 'public-safe/dataset-register.json', `${JSON.stringify(register, null, 2)}\n`);
  const auditFile = {
    ...register.artifacts.auditReport,
    file: path.join(externalRoot, register.artifacts.auditReport.path),
  };

  const seedAAdapterFile = writeFixtureFile(
    externalRoot,
    'controlled/adapters/seed-a/adapter_model.safetensors',
    'fixture adapter seed a\n',
  );
  const seedBAdapterFile = writeFixtureFile(
    externalRoot,
    'controlled/adapters/seed-b/adapter_model.safetensors',
    'fixture adapter seed b\n',
  );
  const seedAInventory = makeAdapterInventory('fixture/v05-seed-a', '1'.repeat(40), seedAAdapterFile);
  const seedBInventory = makeAdapterInventory('fixture/v05-seed-b', '2'.repeat(40), seedBAdapterFile);
  const seedAInventoryFile = writeRepositoryJson('seed-a-inventory.fixture.json', seedAInventory);
  const seedBInventoryFile = writeRepositoryJson('seed-b-inventory.fixture.json', seedBInventory);
  const comparatorPlan = json('config/ai/evaluation/comparator-plan.v0.5.json');
  comparatorPlan.status = 'ready-for-private-generation';
  comparatorPlan.blockers = [];
  comparatorPlan.policy = { path: policyFile.path, sha256: policyFile.sha256 };
  comparatorPlan.systemPrompt = {
    path: systemPromptFile.path, sha256: systemPromptFile.sha256, textSha256: systemPrompt.textSha256,
  };
  const seedArtifact = (slot, inventory, inventoryFile) => ({
    slot, artifactClass: 'adapter', artifactId: inventory.artifactId,
    immutableRevision: inventory.immutableRevision, baseModelId: 'google/gemma-4-E2B-it',
    baseRevision: register.model.immutableBaseRevision, fileManifestSha256: inventory.fileManifestSha256,
    fileInventory: { path: inventoryFile.path, sha256: inventoryFile.sha256 }, status: 'ready', blocker: null,
  });
  const seedAArtifact = seedArtifact('v05-seed-a', seedAInventory, seedAInventoryFile);
  const seedBArtifact = seedArtifact('v05-seed-b', seedBInventory, seedBInventoryFile);
  const baseArtifact = { ...comparatorPlan.artifacts.find(artifact => artifact.slot === 'base'), baseRevision: register.model.immutableBaseRevision };
  baseArtifact.immutableRevision = register.model.immutableBaseRevision;
  const v03Artifact = { ...comparatorPlan.artifacts.find(artifact => artifact.slot === 'v03'), baseRevision: register.model.immutableBaseRevision };
  const selectedAlias = { ...structuredClone(seedAArtifact), slot: 'v05', selectedFromSlot: 'v05-seed-a' };
  comparatorPlan.artifacts = [baseArtifact, v03Artifact, seedAArtifact, seedBArtifact, selectedAlias];
  const comparatorFile = writeRepositoryJson('comparator-plan.fixture.json', comparatorPlan);

  const trainRows = rowsBySplit.get('train');
  const devRows = rowsBySplit.get('dev');
  const trainIds = trainRows.map(row => row.id);
  const adapterFilesA = seedAInventory.files.map(file => ({ ...file, path: seedAAdapterFile.file }));
  const adapterFilesB = seedBInventory.files.map(file => ({ ...file, path: seedBAdapterFile.file }));
  const runBindings = {
    ...datasetManifest.bindings,
    registerSha256: registerFile.sha256,
    datasetManifestSha256: datasetManifestFile.sha256,
    auditSha256: auditFile.sha256,
  };
  const commonRunFiles = {
    register: registerFile, datasetManifest: datasetManifestFile, audit: auditFile,
    train: splitFiles.get('train'), dev: splitFiles.get('dev'),
  };
  const runA = makeCompletedTrainingRun({
    seed: 419805, runId: 'fixture-v05-seed-a', otherRunId: 'fixture-v05-seed-b',
    trainRows, devRows, sampleOrder: trainIds, files: commonRunFiles, bindings: runBindings,
    baseRevision: register.model.immutableBaseRevision, bestCheckpoint: 'checkpoint-100', bestMetric: 0.4,
    adapterDir: path.dirname(seedAAdapterFile.file), adapterFiles: adapterFilesA,
  });
  const runB = makeCompletedTrainingRun({
    seed: 419806, runId: 'fixture-v05-seed-b', otherRunId: 'fixture-v05-seed-a',
    trainRows, devRows, sampleOrder: [...trainIds].reverse(), files: commonRunFiles, bindings: runBindings,
    baseRevision: register.model.immutableBaseRevision, bestCheckpoint: 'checkpoint-125', bestMetric: 0.5,
    adapterDir: path.dirname(seedBAdapterFile.file), adapterFiles: adapterFilesB,
  });
  const runAFile = writeFixtureFile(externalRoot, 'controlled/run-a.json', `${JSON.stringify(runA, null, 2)}\n`);
  const runBFile = writeFixtureFile(externalRoot, 'controlled/run-b.json', `${JSON.stringify(runB, null, 2)}\n`);
  const panelAFile = writeFixtureFile(externalRoot, 'controlled/panel-a.json', '{"fixture":"panel-a"}\n');
  const panelBFile = writeFixtureFile(externalRoot, 'controlled/panel-b.json', '{"fixture":"panel-b"}\n');
  const selectionTemplate = json('config/ai/training/saferide-gemma4-v05-training-selection.candidate.json');
  const panel = (file, values = {}) => ({
    status: 'passed', summaryRef: file.file, summarySha256: file.sha256, criticalFailures: 0,
    overRefusalRate: 0.05, usefulnessAverage: 2.9, baseOverRefusalRate: 0.05,
    baseUsefulnessAverage: 2.9, ...values,
  });
  const selection = {
    ...selectionTemplate,
    status: 'selected',
    baseRevision: register.model.immutableBaseRevision,
    bindings: {
      registerSha256: registerFile.sha256, datasetManifestSha256: datasetManifestFile.sha256,
      auditSha256: auditFile.sha256, planSha256,
      policySha256: policyFile.sha256, systemPromptTextSha256: systemPrompt.textSha256,
      splitManifestSha256: datasetManifest.bindings.splitManifestSha256,
      reviewLedgerSha256: datasetManifest.bindings.reviewLedgerSha256,
    },
    candidateRuns: [
      {
        seed: 419805, runId: runA.runId, manifestPath: runAFile.file, manifestSha256: runAFile.sha256,
        status: 'completed', bestCheckpoint: 'checkpoint-100', developmentAssistantTokenLoss: 0.4,
        developmentPanel: panel(panelAFile),
      },
      {
        seed: 419806, runId: runB.runId, manifestPath: runBFile.file, manifestSha256: runBFile.sha256,
        status: 'completed', bestCheckpoint: 'checkpoint-125', developmentAssistantTokenLoss: 0.5,
        developmentPanel: panel(panelBFile),
      },
    ],
    selected: {
      runId: runA.runId, seed: 419805, checkpoint: 'checkpoint-100',
      decisionEvidenceRef: 'fixture:development-only-selection',
    },
    repeatability: { status: 'passed', evidenceRef: 'fixture:two-seed-repeatability' },
    blockers: [],
  };
  const selectionFile = writeFixtureFile(externalRoot, 'controlled/training-selection.json', `${JSON.stringify(selection, null, 2)}\n`);

  const evaluationPlan = json('config/ai/evaluation/evaluation-plan.v0.5.json');
  evaluationPlan.status = 'ready-for-protected-evaluation';
  evaluationPlan.blockers = [];
  evaluationPlan.selectedAdapter = {
    artifactId: selectedAlias.artifactId,
    immutableRevision: selectedAlias.immutableRevision,
    fileManifestSha256: selectedAlias.fileManifestSha256,
    trainingSelectionSha256: selectionFile.sha256,
  };
  evaluationPlan.sharedBindings = {
    ...evaluationPlan.sharedBindings,
    policySha256: policyFile.sha256,
    systemPromptTextSha256: systemPrompt.textSha256,
    comparatorPlan: { path: comparatorFile.path, sha256: comparatorFile.sha256 },
    datasetRegister: { path: registerFile.path, sha256: registerFile.sha256 },
    datasetManifest: { path: datasetManifestFile.path, sha256: datasetManifestFile.sha256 },
  };
  const suiteFiles = {
    development: splitFiles.get('dev'),
    'quality-holdout': splitFiles.get('quality-holdout'),
    'safety-holdout': splitFiles.get('safety-holdout'),
    'blind-evaluation': blindFile,
  };
  evaluationPlan.suites = evaluationPlan.suites.map(suite => {
    const file = suiteFiles[suite.suiteId];
    if (!file) return suite;
    return {
      ...suite,
      artifact: { status: 'frozen', path: file.path, sha256: file.sha256, evidenceRef: `fixture:${suite.suiteId}` },
    };
  });
  const evaluationPlanFile = writeFixtureFile(
    externalRoot,
    'public-safe/evaluation-plan.json',
    `${JSON.stringify(evaluationPlan, null, 2)}\n`,
  );
  return {
    externalRoot,
    repositoryFixtureRoot,
    comparatorPlan,
    evaluationPlan,
    evaluationPlanFile,
    selection,
    selectionFile,
    runA,
    runAFile,
    runB,
    runBFile,
    qualityRows: rowsBySplit.get('quality-holdout'),
    cleanup() {
      fs.rmSync(externalRoot, { recursive: true, force: true });
      fs.rmSync(repositoryFixtureRoot, { recursive: true, force: true });
    },
  };
}

test('blocked dataset register is schema-valid, classified, and cannot pass the strict gate', () => {
  const schemas = compileV05Schemas();
  const register = json('docs/security/saferide-gemma4-colab-input-register.synthetic-v0.5.candidate.json');
  assert.deepEqual(schemaErrors('register', schemas.register, register), []);
  assert.equal(register.status, 'blocked');
  assert.equal(register.trainingReadiness.strictGatePassed, false);
  assert.equal(register.artifacts.train.classification, 'controlled');
  assert.equal(register.artifacts.qualityHoldout.classification, 'restricted');
  assert.equal(register.artifacts.auditReport.classification, 'public-safe');
  assert.equal(register.artifacts.auditDetails.classification, 'restricted');
  const result = spawnSync(process.execPath, ['scripts/saferide-gemma4-v05-readiness.mjs', '--strict'], {
    cwd: repoRoot, encoding: 'utf8', env: { ...process.env },
  });
  assert.equal(result.status, 1);
  assert.match(`${result.stdout}\n${result.stderr}`, /register\.status must be training-ready|lacks a passing status/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /from_pretrained|model download|CUDA/);
});

test('blocked two-seed selection is truthful and strict selection cannot claim a checkpoint', () => {
  const selection = json('config/ai/training/saferide-gemma4-v05-training-selection.candidate.json');
  assert.deepEqual(validateV05TrainingSelection(selection, { verifyFiles: false }), []);
  assert.equal(selection.selected, null);
  assert.deepEqual(selection.selectionPolicy.requiredSeeds, [419805, 419806]);
  assert.equal(selection.selectionPolicy.holdoutsUsedForSelection, false);
});

test('two-seed development selection binds identical data and hyperparameters while requiring distinct sample order', () => {
  const bindings = {
    registerSha256: '1'.repeat(64), datasetManifestSha256: '2'.repeat(64), auditSha256: '3'.repeat(64),
    planSha256: '4'.repeat(64), policySha256: '5'.repeat(64), systemPromptTextSha256: '6'.repeat(64),
    splitManifestSha256: '7'.repeat(64), reviewLedgerSha256: '8'.repeat(64),
  };
  const first = {
    baseModelId: 'google/gemma-4-E2B-it', baseRevision: 'a'.repeat(40),
    registerSha256: bindings.registerSha256, datasetManifestSha256: bindings.datasetManifestSha256,
    auditSha256: bindings.auditSha256,
    dataFiles: { train: { sha256: '9'.repeat(64) }, dev: { sha256: 'a'.repeat(64) } },
    datasetBindings: {
      planSha256: bindings.planSha256, policySha256: bindings.policySha256,
      systemPromptTextSha256: bindings.systemPromptTextSha256,
      splitManifestSha256: bindings.splitManifestSha256, reviewLedgerSha256: bindings.reviewLedgerSha256,
    },
    runArguments: { seed: 419805, epochs: 1, learningRate: 0.00001, loraRank: 8 },
    outputs: { trainRowIdSha256: 'b'.repeat(64), developmentRowIdSha256: 'c'.repeat(64), sampleOrderSha256: 'd'.repeat(64) },
  };
  const second = structuredClone(first);
  second.runArguments.seed = 419806;
  second.outputs.sampleOrderSha256 = 'e'.repeat(64);
  assert.deepEqual(validateSelectedRunConsistency({ bindings }, [first, second]), []);
  second.dataFiles.train.sha256 = 'f'.repeat(64);
  second.runArguments.epochs = 2;
  second.outputs.sampleOrderSha256 = first.outputs.sampleOrderSha256;
  const errors = validateSelectedRunConsistency({ bindings }, [first, second]).join('\n');
  assert.match(errors, /same exact train\/development bytes/);
  assert.match(errors, /hyperparameter other than seed/);
  assert.match(errors, /same shuffled sample order/);
});

test('development loss cannot make an over-refusing and useless candidate selectable', () => {
  const selection = json('config/ai/training/saferide-gemma4-v05-training-selection.candidate.json');
  const run = {
    status: 'completed',
    developmentPanel: {
      status: 'passed', criticalFailures: 0,
      overRefusalRate: 1, usefulnessAverage: 0,
      baseOverRefusalRate: 0.05, baseUsefulnessAverage: 2.9,
    },
  };
  const errors = developmentPanelEligibilityErrors(run, selection.selectionPolicy).join('\n');
  assert.match(errors, /over-refusal rate exceeds/);
  assert.match(errors, /usefulness average is below/);
  assert.match(errors, /regresses over-refusal/);
  assert.match(errors, /regresses usefulness/);
});

test('protected evaluation plan represents all six layers and remains blocked without artifacts or reviews', () => {
  const plan = json('config/ai/evaluation/evaluation-plan.v0.5.json');
  assert.deepEqual(validateV05EvaluationPlan(plan), []);
  assert.equal(plan.suites.find(suite => suite.suiteId === 'blind-evaluation').requiredCount, 240);
  assert.equal(plan.suites.find(suite => suite.suiteId === 'safety-holdout').requiredCount, 400);
  assert.ok(validateV05EvaluationPlan(plan, { strict: true }).length > 0);
  const drifted = structuredClone(plan);
  drifted.sharedBindings.generationConfigSha256 = '0'.repeat(64);
  assert.match(validateV05EvaluationPlan(drifted).join('\n'), /generation configuration differs/);
});

test('strict evaluation rejects fake artifact references and a blocked comparator', () => {
  const plan = json('config/ai/evaluation/evaluation-plan.v0.5.json');
  plan.status = 'ready-for-protected-evaluation';
  plan.blockers = [];
  plan.selectedAdapter = {
    artifactId: 'fake-v05-adapter', immutableRevision: 'a'.repeat(40),
    fileManifestSha256: 'b'.repeat(64), trainingSelectionSha256: 'c'.repeat(64),
  };
  for (const suite of plan.suites.filter(entry => entry.suiteId !== 'exported-artifact')) {
    suite.artifact = {
      status: 'frozen', path: `missing/${suite.suiteId}.jsonl`,
      sha256: 'd'.repeat(64), evidenceRef: `fake:${suite.suiteId}`,
    };
  }
  const errors = validateV05EvaluationPlan(plan, {
    strict: true,
    artifactRoot: os.tmpdir(),
    trainingSelectionPath: 'config/ai/training/saferide-gemma4-v05-training-selection.candidate.json',
  }).join('\n');
  assert.match(errors, /artifact is unavailable/);
  assert.match(errors, /unblocked comparator ready for private generation/);
  assert.match(errors, /training-selection artifact SHA-256 differs|training selection has not selected/);
});

test('a legitimate unblocked strict-evaluation package passes end to end and rejects substitute holdout bytes', () => {
  const fixture = makeStrictEvaluationFixture();
  try {
    const options = {
      strict: true,
      artifactRoot: fixture.externalRoot,
      trainingSelectionPath: fixture.selectionFile.file,
    };
    assert.deepEqual(validateV05EvaluationPlan(fixture.evaluationPlan, options), []);
    const cli = spawnSync(process.execPath, [
      'scripts/saferide-gemma4-v05-evaluation-check.mjs',
      '--plan', fixture.evaluationPlanFile.file,
      '--strict',
      '--artifact-root', fixture.externalRoot,
      '--training-selection', fixture.selectionFile.file,
    ], { cwd: repoRoot, encoding: 'utf8', env: { ...process.env } });
    assert.equal(cli.status, 0, `${cli.stdout}\n${cli.stderr}`);
    assert.match(cli.stdout, /PASS \(protected evaluation controls are hash-bound/);

    const comparatorWithoutAlias = structuredClone(fixture.comparatorPlan);
    delete comparatorWithoutAlias.artifacts.find(artifact => artifact.slot === 'v05').selectedFromSlot;
    const schemas = compileEvaluationSchemas(repoRoot);
    const comparatorErrors = validateComparatorPlan(
      comparatorWithoutAlias,
      schemas.plan,
      repoRoot,
      schemas.systemPrompt,
      schemas.artifactInventory,
    ).join('\n');
    assert.match(comparatorErrors, /explicit selected-seed alias/);
    assert.match(comparatorErrors, /cannot reuse the same artifact revision/);

    const substitute = writeFixtureFile(
      fixture.externalRoot,
      'restricted/substitute-quality-holdout.jsonl',
      jsonl([...fixture.qualityRows].reverse()),
    );
    const substitutedPlan = structuredClone(fixture.evaluationPlan);
    substitutedPlan.suites.find(suite => suite.suiteId === 'quality-holdout').artifact = {
      status: 'frozen', path: substitute.path, sha256: substitute.sha256,
      evidenceRef: 'fixture:substitute-quality-holdout',
    };
    const substitutionErrors = validateV05EvaluationPlan(substitutedPlan, options).join('\n');
    assert.match(substitutionErrors, /quality-holdout suite differs from the frozen dataset manifest/);
  } finally {
    fixture.cleanup();
  }
});

test('strict evaluation rejects an internally rehashed selected-run adapter inventory substitution', () => {
  const fixture = makeStrictEvaluationFixture();
  try {
    const changedRun = structuredClone(fixture.runA);
    changedRun.outputs.adapterFiles = [{
      path: path.join(changedRun.outputs.adapterDir, 'unrelated-adapter.safetensors'),
      sha256: 'f'.repeat(64),
      sizeBytes: 17,
    }];
    const changedRunFile = rewriteFixtureJson(fixture.runAFile, changedRun);
    const changedSelection = structuredClone(fixture.selection);
    changedSelection.candidateRuns.find(run => run.seed === 419805).manifestSha256 = changedRunFile.sha256;
    const changedSelectionFile = rewriteFixtureJson(fixture.selectionFile, changedSelection);
    const changedPlan = structuredClone(fixture.evaluationPlan);
    changedPlan.selectedAdapter.trainingSelectionSha256 = changedSelectionFile.sha256;
    const errors = validateV05EvaluationPlan(changedPlan, {
      strict: true,
      artifactRoot: fixture.externalRoot,
      trainingSelectionPath: changedSelectionFile.file,
    }).join('\n');
    assert.doesNotMatch(errors, /training selection:/);
    assert.match(errors, /selected training run adapter files differ from the selected comparator seed inventory/);
    assert.match(errors, /selected training run adapter file-manifest hash differs from the selected comparator seed/);

    const sizeChangedRun = structuredClone(fixture.runA);
    sizeChangedRun.outputs.adapterFiles[0].sizeBytes += 1;
    const sizeChangedRunFile = rewriteFixtureJson(fixture.runAFile, sizeChangedRun);
    const sizeChangedSelection = structuredClone(fixture.selection);
    sizeChangedSelection.candidateRuns.find(run => run.seed === 419805).manifestSha256 = sizeChangedRunFile.sha256;
    const sizeChangedSelectionFile = rewriteFixtureJson(fixture.selectionFile, sizeChangedSelection);
    const sizeChangedPlan = structuredClone(fixture.evaluationPlan);
    sizeChangedPlan.selectedAdapter.trainingSelectionSha256 = sizeChangedSelectionFile.sha256;
    const sizeErrors = validateV05EvaluationPlan(sizeChangedPlan, {
      strict: true,
      artifactRoot: fixture.externalRoot,
      trainingSelectionPath: sizeChangedSelectionFile.file,
    }).join('\n');
    assert.match(sizeErrors, /selected training run adapter files differ from the selected comparator seed inventory/);
    assert.match(sizeErrors, /selected training run adapter file-manifest hash differs from the selected comparator seed/);
  } finally {
    fixture.cleanup();
  }
});

test('strict evaluation rejects internally consistent policy drift from the frozen dataset lineage', () => {
  const fixture = makeStrictEvaluationFixture();
  try {
    const substitutedPolicySha256 = 'f'.repeat(64);
    const changedRunA = structuredClone(fixture.runA);
    const changedRunB = structuredClone(fixture.runB);
    changedRunA.datasetBindings.policySha256 = substitutedPolicySha256;
    changedRunB.datasetBindings.policySha256 = substitutedPolicySha256;
    const changedRunAFile = rewriteFixtureJson(fixture.runAFile, changedRunA);
    const changedRunBFile = rewriteFixtureJson(fixture.runBFile, changedRunB);
    const changedSelection = structuredClone(fixture.selection);
    changedSelection.bindings.policySha256 = substitutedPolicySha256;
    changedSelection.candidateRuns.find(run => run.seed === 419805).manifestSha256 = changedRunAFile.sha256;
    changedSelection.candidateRuns.find(run => run.seed === 419806).manifestSha256 = changedRunBFile.sha256;
    const changedSelectionFile = rewriteFixtureJson(fixture.selectionFile, changedSelection);
    const changedPlan = structuredClone(fixture.evaluationPlan);
    changedPlan.selectedAdapter.trainingSelectionSha256 = changedSelectionFile.sha256;
    const errors = validateV05EvaluationPlan(changedPlan, {
      strict: true,
      artifactRoot: fixture.externalRoot,
      trainingSelectionPath: changedSelectionFile.file,
    }).join('\n');
    assert.doesNotMatch(errors, /training selection:/);
    assert.match(errors, /training selection policySha256 differs from the frozen dataset lineage/);
  } finally {
    fixture.cleanup();
  }
});

test('v0.5 comparator extends the shared evaluator without weakening v0.4 defaults', () => {
  const schemas = compileEvaluationSchemas(repoRoot);
  const v05 = json('config/ai/evaluation/comparator-plan.v0.5.json');
  assert.deepEqual(validateComparatorPlan(v05, schemas.plan, repoRoot, schemas.systemPrompt, schemas.artifactInventory), []);
  assert.equal(v05.targetSlot, 'v05');
  const v04 = json('config/ai/evaluation/comparator-plan.v0.4.json');
  assert.equal(v04.targetSlot, undefined);
  assert.deepEqual(validateComparatorPlan(v04, schemas.plan, repoRoot, schemas.systemPrompt, schemas.artifactInventory), []);
});

test('retired v0.5 Colab notebook is absent from the active training path', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'notebooks/saferide-gemma4-e2b-colab-v05-candidate.ipynb')), false);
});
