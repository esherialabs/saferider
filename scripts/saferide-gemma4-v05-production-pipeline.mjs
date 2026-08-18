#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  DATASET_ID,
  DEFAULT_PLAN_PATH,
  REPO_ROOT,
  canonicalSha256,
  compileV05Schemas,
  fileSha256,
  jsonlText,
  readJson,
  readJsonl,
  schemaErrors,
  sha256,
} from './lib/saferide-gemma4-v05.mjs';
import {
  artifactPath,
  assertPrivateFile,
  atomicWritePrivate,
  enforcePrivateUmask,
  inspectArtifactPermissions,
  secureArtifactRoot,
} from './lib/saferide-artifact-security.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const SCENARIO_SCRIPT = path.join(REPO_ROOT, 'scripts/saferide-gemma4-v05-scenario-matrix.mjs');
const BUILD_SCRIPT = path.join(REPO_ROOT, 'scripts/saferide-gemma4-v05-build.mjs');
const GENERATOR_SCRIPT = path.join(REPO_ROOT, 'scripts/saferide-gemma4-v05-generate-candidates.mjs');
const SCREEN_SCRIPT = path.join(REPO_ROOT, 'scripts/saferide-gemma4-v05-candidate-screen.mjs');
const REVIEW_SCRIPT = path.join(REPO_ROOT, 'scripts/saferide-gemma4-v05-review-check.mjs');
const SEMANTIC_SCRIPT = path.join(REPO_ROOT, 'scripts/saferide-gemma4-v05-semantic-check.mjs');
const AUDIT_SCRIPT = path.join(REPO_ROOT, 'scripts/saferide-gemma4-v05-audit.mjs');
const BLIND_SCRIPT = path.join(REPO_ROOT, 'scripts/saferide-gemma4-v05-blind-check.mjs');
const REGISTER_SCRIPT = path.join(REPO_ROOT, 'scripts/saferide-gemma4-v05-register.mjs');
const READINESS_SCRIPT = path.join(REPO_ROOT, 'scripts/saferide-gemma4-v05-readiness.mjs');
const TARGETS_PATH = path.join(REPO_ROOT, 'config/ai/datasets/saferide-gemma4-v05-scenario-targets.json');
const PACKAGE_LOCK_PATH = path.join(REPO_ROOT, 'package-lock.json');
const SMOKE_DATASET_ID = 'saferide-v05-mechanical-smoke-fixture';
const PRODUCTION_STATES = Object.freeze([
  'initialized',
  'scenario-draft',
  'scenario-metrics-passed',
  'split-draft',
  'scenario-approved-external-input',
  'scenario-and-split-frozen',
  'authoring-pack-frozen',
  'candidates-imported',
  'candidates-screened',
  'review-ready',
  'reviews-complete-external-input',
  'dataset-frozen-pending-audit',
  'dataset-audited',
  'register-frozen',
  'strict-ready',
  'training-handoff',
]);
const LAYOUT = Object.freeze({
  config: 'run/pipeline-config.json',
  state: 'run/pipeline-state.json',
  ledger: 'run/command-ledger.jsonl',
  manifest: 'public-safe/pipeline-run-manifest.json',
  registerEvidence: 'run/register-evidence.json',
  blueprints: 'matrix/scenario-blueprints.jsonl',
  content: 'matrix/scenario-content.draft.jsonl',
  scenarioDraft: 'matrix/scenarios.draft.jsonl',
  scenarioMetrics: 'public-safe/scenario-metrics.json',
  splitDraft: 'splits/split-manifest.draft.json',
  splitReproducibility: 'public-safe/split-reproducibility.json',
  freezeDiff: 'public-safe/scenario-freeze-diff.json',
  splitFrozen: 'splits/split-manifest.frozen.json',
  splitFreezeReproducibility: 'public-safe/split-freeze-reproducibility.json',
  authoringPack: 'authoring/authoring-pack.jsonl',
  candidateImportInventory: 'run/candidate-import-inventory.json',
  candidateMergedSource: 'candidates/imported/candidates.merged-source.jsonl',
  candidates: 'candidates/imported/candidates.jsonl',
  candidateIndex: 'candidates/imported/candidate-index.json',
  candidateSemanticRequest: 'screening/candidate-semantic-request.json',
  screenDetails: 'screening/candidate-screen-details.jsonl',
  shortlist: 'screening/shortlist.jsonl',
  screenReport: 'public-safe/candidate-screen-report.json',
  reviewSummary: 'reviews/review-summary.json',
  datasetManifest: 'dataset/public-safe/dataset-manifest.json',
  datasetReviewSummary: 'dataset/restricted/review-summary.json',
  train: 'dataset/controlled/train.jsonl',
  dev: 'dataset/controlled/dev.jsonl',
  qualityHoldout: 'dataset/restricted/quality-holdout.jsonl',
  safetyHoldout: 'dataset/restricted/safety-holdout.jsonl',
  pilot: 'dataset/controlled/pilot-row-manifest.json',
  audit: 'audit/dataset-audit.json',
  auditDetails: 'audit/dataset-audit-details.json',
  blindResult: 'blind/blind-check-result.txt',
  register: 'register/input-register.json',
});
const GATE_OWNERS = Object.freeze({
  policy: 'product-safeguarding-and-policy-owners', 'system-prompt': 'product-safeguarding-legal-privacy',
  'scenario-matrix': 'safeguarding-product-and-ml-data', 'reviewer-roster': 'project-lead',
  'row-reviews': 'review-evidence-owner', 'kiswahili-language': 'native-or-fluent-kiswahili-reviewer',
  'legal-derivative-use': 'legal-owner', clinical: 'clinical-medical-reviewer', privacy: 'privacy-security-reviewer',
  safeguarding: 'product-safeguarding-reviewer', 'independent-ml-data': 'independent-ml-data-reviewer',
  'holdout-custody': 'independent-evaluation-custodian', 'semantic-leakage': 'independent-ml-data-reviewer',
  'prohibited-data': 'privacy-security-reviewer', 'organization-storage': 'project-and-data-owner',
  'unicef-workbook': 'unicef-evidence-owner', 'gpu-colab': 'ml-colab-owner',
});

function usage() {
  return [
    'Usage:',
    '  node scripts/saferide-gemma4-v05-production-pipeline.mjs contract-check',
    '  node scripts/saferide-gemma4-v05-production-pipeline.mjs init --artifact-root <absolute-dir> [--run-id <id>]',
    '  node scripts/saferide-gemma4-v05-production-pipeline.mjs run --artifact-root <absolute-dir> [--resume]',
    '  node scripts/saferide-gemma4-v05-production-pipeline.mjs verify --artifact-root <absolute-dir>',
    '  node scripts/saferide-gemma4-v05-production-pipeline.mjs status --artifact-root <absolute-dir>',
    '  node scripts/saferide-gemma4-v05-production-pipeline.mjs smoke --artifact-root <absolute-dir> [--resume]',
    '',
    'Production runs stop at genuine external gates. Smoke artifacts use a non-production dataset ID and can never pass readiness.',
  ].join('\n');
}

function parseArgs(argv) {
  const command = argv[0];
  if (!command || ['--help', '-h'].includes(command)) {
    console.log(usage());
    process.exit(command ? 0 : 1);
  }
  const args = { command, resume: false };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--artifact-root') args.artifactRoot = argv[++index];
    else if (argument === '--run-id') args.runId = argv[++index];
    else if (argument === '--resume') args.resume = true;
    else throw new Error(`Unknown or incomplete argument: ${argument}\n\n${usage()}`);
  }
  if (command !== 'contract-check' && !args.artifactRoot) throw new Error('--artifact-root is required');
  return args;
}

function gitValue(args) {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', shell: false });
  if (result.status !== 0) throw new Error('Unable to resolve repository lineage');
  return result.stdout.trim();
}

function currentCommit() {
  return gitValue(['rev-parse', 'HEAD']);
}

function currentCommitDate() {
  return new Date(gitValue(['show', '-s', '--format=%cI', 'HEAD'])).toISOString();
}

function classificationFor(relativePath) {
  if (relativePath.startsWith('public-safe/') || relativePath.includes('/public-safe/')) return 'public-safe';
  if (relativePath.startsWith('screening/') || relativePath.startsWith('reviews/') || relativePath.startsWith('blind/')
    || relativePath.startsWith('semantic/') || relativePath.includes('/restricted/')
    || relativePath.startsWith('candidates/incoming/') || relativePath.startsWith('candidates/imported/')) return 'restricted';
  return 'controlled';
}

function relativeArtifact(root, filePath) {
  const relative = path.relative(root, filePath).split(path.sep).join('/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('Pipeline artifact escapes its root');
  return relative;
}

function fileEvidence(root, value, classification = null) {
  const filePath = typeof value === 'string' ? value : value.filePath;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error('Pipeline evidence file is unavailable');
  const insideRoot = path.relative(root, filePath);
  const relative = !insideRoot.startsWith('..') && !path.isAbsolute(insideRoot)
    ? relativeArtifact(root, filePath)
    : `repo:${path.relative(REPO_ROOT, filePath).split(path.sep).join('/')}`;
  return {
    path: relative,
    classification: classification ?? (relative.startsWith('repo:') ? 'public-safe' : classificationFor(relative)),
    sha256: fileSha256(filePath),
    sizeBytes: fs.statSync(filePath).size,
  };
}

function evidencePath(root, entry) {
  if (entry.path.startsWith('repo:')) return path.join(REPO_ROOT, entry.path.slice(5));
  return artifactPath(root, entry.path);
}

function inventory(root, paths) {
  const entries = paths.map(value => fileEvidence(
    root,
    value,
    typeof value === 'object' && value !== null ? value.classification ?? null : null,
  )).sort((left, right) => left.path.localeCompare(right.path));
  return { entries, sha256: canonicalSha256(entries) };
}

function commandArgumentNames(args) {
  return [...new Set(args.map(argument => String(argument)).filter(argument => argument.startsWith('--') || /^[a-z][a-z0-9-]*$/.test(argument)))]
    .sort();
}

function pendingRegisterEvidence(sourceCommit, createdAt) {
  const artifactPaths = {
    scenarioSpecs: 'matrix/scenarios.frozen.jsonl', splitManifest: LAYOUT.splitFrozen, candidates: LAYOUT.shortlist,
    reviewLedger: 'reviews/review-ledger.jsonl', reviewSummary: LAYOUT.datasetReviewSummary,
    datasetManifest: LAYOUT.datasetManifest, pilotSelection: LAYOUT.pilot, train: LAYOUT.train, dev: LAYOUT.dev,
    qualityHoldout: LAYOUT.qualityHoldout, safetyHoldout: LAYOUT.safetyHoldout,
    semanticLeakageReport: 'semantic/semantic-report.json', semanticLeakageDetails: 'semantic/semantic-details.json',
    auditReport: LAYOUT.audit, auditDetails: LAYOUT.auditDetails, blindEvaluation: 'blind/blind-prompts.jsonl',
  };
  return {
    schema: 'com.saferide.ai.v05-register-evidence-config', schemaVersion: 1,
    configId: `v05-register-evidence-${sourceCommit.slice(0, 12)}`,
    registerId: `saferide-gemma4-v05-register-${sourceCommit.slice(0, 12)}`,
    datasetId: DATASET_ID, desiredStatus: 'blocked', createdAt, sourceCommit, modelBaseRevision: null,
    repositoryBindings: {
      plan: 'config/ai/datasets/saferide-gemma4-v05-plan.json', policy: 'config/ai/safe-assistant-policy.json',
      systemPrompt: 'config/ai/safe-assistant-system-prompt.json', buildImplementation: 'scripts/saferide-gemma4-v05-build.mjs',
      reviewImplementation: 'scripts/saferide-gemma4-v05-review-check.mjs', auditImplementation: 'scripts/saferide-gemma4-v05-audit.mjs',
    },
    bindingApprovals: { policy: { status: 'pending', approvalEvidenceRef: null }, systemPrompt: { status: 'pending', approvalEvidenceRef: null } },
    artifacts: Object.fromEntries(Object.entries(artifactPaths).map(([name, artifactPathValue]) => [name, { path: artifactPathValue, status: 'pending' }])),
    gates: Object.entries(GATE_OWNERS).map(([gateId, ownerRole]) => ({ gateId, status: 'pending', ownerRole, evidenceRef: null })),
    holdoutControls: {
      trainingAccessAllowed: false, routinePromptIterationAllowed: false, custodianRole: 'independent-evaluation-custodian',
      custodianIdentityRef: null, segregatedAccessEvidenceRef: null, accessLogEvidenceRef: null, blindSuiteTrainingAccessAllowed: false,
    },
    publication: { defaultDatasetAccess: 'restricted', trainPublicationStatus: 'blocked', holdoutPublicationAllowed: false, blindSuitePublicationAllowed: false, approvalEvidenceRef: null },
    trainingBlockers: ['External approvals, candidate authoring, human review, semantic evidence, holdout custody, and strict readiness remain incomplete.'],
    limitations: ['This external run configuration contains no approval claims, reviewer identities, candidate content, holdouts, model runs, or release claims.'],
    privacy: { containsArtifactContent: false, containsReviewerIdentities: false, containsCredentials: false },
  };
}

function productionConfig(sourceCommit, runCreatedAt, runId) {
  return {
    schema: 'com.saferide.ai.v05-production-pipeline-config', schemaVersion: 1,
    runId: runId ?? `v05-production-esh4198-${sourceCommit.slice(0, 12)}`,
    datasetId: DATASET_ID, mode: 'production', runCreatedAt, sourceCommit,
    generation: { enabled: false, configurationPath: 'run/generator-config.json' },
    paths: {
      scenarioFrozen: 'matrix/scenarios.frozen.jsonl', splitApprovals: 'splits/split-approvals.json',
      policy: 'policy/approved-policy.json', systemPrompt: 'policy/approved-system-prompt.json',
      tokenizationReport: 'screening/tokenization-report.json', candidateSemanticReport: 'screening/candidate-semantic-report.json',
      reviewLedger: 'reviews/review-ledger.jsonl', finalSemanticReport: 'semantic/semantic-report.json',
      finalSemanticDetails: 'semantic/semantic-details.json', blindPrompts: 'blind/blind-prompts.jsonl',
      registerEvidence: LAYOUT.registerEvidence,
    },
    handoff: { authorized: false, evidenceRef: null },
    forbiddenActions: { modelDownloads: false, colabTraining: false, deployments: false, easBuilds: false, awsOperations: false, dockerResets: false },
    privacy: { syntheticOnly: true, contentLoggingAllowed: false, holdoutLoggingAllowed: false, environmentLoggingAllowed: false },
  };
}

function initializeProductionRoot(root, runId, schemas) {
  const configPath = artifactPath(root, LAYOUT.config);
  if (fs.existsSync(configPath)) throw new Error('Pipeline configuration already exists; use a new root or run --resume');
  const sourceCommit = currentCommit();
  const runCreatedAt = currentCommitDate();
  const config = productionConfig(sourceCommit, runCreatedAt, runId);
  const configErrors = schemaErrors('pipelineConfig', schemas.pipelineConfig, config);
  if (configErrors.length) throw new Error(`Pipeline configuration failed (${configErrors.length} findings)`);
  const evidence = pendingRegisterEvidence(sourceCommit, runCreatedAt);
  const evidenceErrors = schemaErrors('registerEvidenceConfig', schemas.registerEvidenceConfig, evidence);
  if (evidenceErrors.length) throw new Error(`Register evidence template failed (${evidenceErrors.length} findings)`);
  atomicWritePrivate(configPath, `${JSON.stringify(config, null, 2)}\n`, { rootPath: root });
  atomicWritePrivate(artifactPath(root, LAYOUT.registerEvidence), `${JSON.stringify(evidence, null, 2)}\n`, { rootPath: root });
  for (const [source, target] of [
    [path.join(REPO_ROOT, 'config/ai/safe-assistant-policy.json'), config.paths.policy],
    [path.join(REPO_ROOT, 'config/ai/safe-assistant-system-prompt.json'), config.paths.systemPrompt],
  ]) atomicWritePrivate(artifactPath(root, target), fs.readFileSync(source), { rootPath: root });
  return config;
}

function emptyLedgerText() {
  return jsonlText([]);
}

function initialState(config, configurationSha256) {
  return {
    schema: 'com.saferide.ai.v05-pipeline-state', schemaVersion: 1,
    runId: config.runId, datasetId: DATASET_ID, mode: 'production', sourceCommit: config.sourceCommit,
    configurationSha256, currentState: 'initialized', status: 'active', transitions: [], blockers: [],
    commandLedgerSha256: sha256(emptyLedgerText()), invalidated: false,
    privacy: { containsArtifactContent: false, containsArguments: false, containsEnvironment: false, containsCredentials: false },
  };
}

function runtimeManifest(runtime, stateText, ledgerText) {
  const smoke = runtime.state.mode === 'mechanical-smoke';
  return {
    schema: 'com.saferide.ai.v05-pipeline-run-manifest', schemaVersion: 1,
    runId: runtime.state.runId, datasetId: runtime.state.datasetId, mode: runtime.state.mode,
    sourceCommit: runtime.state.sourceCommit, packageLockSha256: fileSha256(PACKAGE_LOCK_PATH), nodeVersion: process.version,
    configurationSha256: runtime.state.configurationSha256, currentState: runtime.state.currentState, status: runtime.state.status,
    transitionCount: runtime.state.transitions.length, commandCount: runtime.ledger.length,
    stateSha256: sha256(stateText), commandLedgerSha256: sha256(ledgerText), blockers: [...runtime.state.blockers].sort(),
    strictReady: !smoke && PRODUCTION_STATES.indexOf(runtime.state.currentState) >= PRODUCTION_STATES.indexOf('strict-ready'),
    trainingHandoffComplete: !smoke && runtime.state.currentState === 'training-handoff' && runtime.state.status === 'complete',
    productionReadinessProhibited: smoke,
    privacy: {
      containsArtifactContent: false, containsPrivatePaths: false, containsArguments: false,
      containsEnvironment: false, containsCredentials: false, classification: 'public-safe-aggregate',
    },
  };
}

function validateRuntime(runtime) {
  const errors = [
    ...schemaErrors('pipelineState', runtime.schemas.pipelineState, runtime.state),
    ...runtime.ledger.flatMap((entry, index) => schemaErrors(`commandLedger[${index}]`, runtime.schemas.pipelineCommandLedger, entry)),
  ];
  const sequences = runtime.ledger.map(entry => entry.sequence);
  if (sequences.some((sequence, index) => sequence !== index + 1)) errors.push('command ledger sequence is not contiguous');
  if (runtime.state.transitions.some((transition, index) => transition.sequence !== index + 1)) errors.push('transition sequence is not contiguous');
  if (runtime.state.commandLedgerSha256 !== sha256(jsonlText(runtime.ledger))) errors.push('command ledger hash differs from pipeline state');
  if (errors.length) throw new Error(`Pipeline runtime contract failed (${errors.length} findings)`);
}

function saveRuntime(runtime) {
  const ledgerText = jsonlText(runtime.ledger);
  runtime.state.commandLedgerSha256 = sha256(ledgerText);
  validateRuntime(runtime);
  const stateText = `${JSON.stringify(runtime.state, null, 2)}\n`;
  const manifest = runtimeManifest(runtime, stateText, ledgerText);
  const manifestErrors = schemaErrors('pipelineRunManifest', runtime.schemas.pipelineRunManifest, manifest);
  if (manifestErrors.length) throw new Error(`Pipeline run manifest failed (${manifestErrors.length} findings)`);
  atomicWritePrivate(artifactPath(runtime.root, LAYOUT.ledger), ledgerText, { rootPath: runtime.root, overwrite: true });
  atomicWritePrivate(artifactPath(runtime.root, LAYOUT.state), stateText, { rootPath: runtime.root, overwrite: true });
  atomicWritePrivate(artifactPath(runtime.root, LAYOUT.manifest), `${JSON.stringify(manifest, null, 2)}\n`, { rootPath: runtime.root, overwrite: true });
  return manifest;
}

function verifyEvidenceEntry(root, entry) {
  const filePath = evidencePath(root, entry);
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile()
    && fileSha256(filePath) === entry.sha256 && fs.statSync(filePath).size === entry.sizeBytes;
}

function verifyRecordedRuntime(runtime) {
  let expectedFrom = 'initialized';
  for (const transition of runtime.state.transitions) {
    if (transition.from !== expectedFrom || transition.to === transition.from) return false;
    if (![...transition.inputs, ...transition.outputs].every(entry => verifyEvidenceEntry(runtime.root, entry))) return false;
    if (canonicalSha256(transition.inputs) !== transition.inputInventorySha256
      || canonicalSha256(transition.outputs) !== transition.outputInventorySha256) return false;
    expectedFrom = transition.to;
  }
  if (runtime.state.currentState !== expectedFrom) return false;
  for (const entry of runtime.ledger.filter(item => item.status === 'passed')) {
    if (entry.implementation.path.startsWith('scripts/')
      && fileSha256(path.join(REPO_ROOT, entry.implementation.path)) !== entry.implementation.sha256) return false;
  }
  return true;
}

function verifyPersistedManifest(runtime) {
  const manifestPath = artifactPath(runtime.root, LAYOUT.manifest);
  const statePath = artifactPath(runtime.root, LAYOUT.state);
  const ledgerPath = artifactPath(runtime.root, LAYOUT.ledger);
  if (!fs.existsSync(manifestPath)) return !fs.existsSync(statePath) && !fs.existsSync(ledgerPath);
  const manifest = readJson(assertPrivateFile(manifestPath, runtime.root));
  if (schemaErrors('pipelineRunManifest', runtime.schemas.pipelineRunManifest, manifest).length) return false;
  return manifest.runId === runtime.state.runId
    && manifest.configurationSha256 === runtime.state.configurationSha256
    && manifest.packageLockSha256 === fileSha256(PACKAGE_LOCK_PATH)
    && manifest.nodeVersion === process.version
    && manifest.currentState === runtime.state.currentState
    && manifest.status === runtime.state.status
    && manifest.stateSha256 === fileSha256(assertPrivateFile(statePath, runtime.root))
    && manifest.commandLedgerSha256 === fileSha256(assertPrivateFile(ledgerPath, runtime.root));
}

function loadProductionRuntime(root, resume, schemas, { activate = true } = {}) {
  if (fs.existsSync(path.join(root, '.saferide-v05-smoke.json'))) throw new Error('Smoke roots cannot run the production pipeline');
  const configPath = assertPrivateFile(artifactPath(root, LAYOUT.config), root);
  const config = readJson(configPath);
  const configErrors = schemaErrors('pipelineConfig', schemas.pipelineConfig, config);
  if (configErrors.length) throw new Error(`Pipeline configuration is invalid (${configErrors.length} findings)`);
  if (config.sourceCommit !== currentCommit()) throw new Error('Pipeline source commit differs from repository HEAD; create a new immutable run');
  const configurationSha256 = fileSha256(configPath);
  const statePath = artifactPath(root, LAYOUT.state);
  const ledgerPath = artifactPath(root, LAYOUT.ledger);
  if (fs.existsSync(statePath) && !resume) throw new Error('Existing pipeline state requires --resume');
  const state = fs.existsSync(statePath) ? readJson(assertPrivateFile(statePath, root)) : initialState(config, configurationSha256);
  const ledger = fs.existsSync(ledgerPath) ? readJsonl(assertPrivateFile(ledgerPath, root)) : [];
  const runtime = { root, config, state, ledger, schemas };
  if (state.configurationSha256 !== configurationSha256 || state.sourceCommit !== config.sourceCommit || state.runId !== config.runId) {
    throw new Error('Pipeline state is bound to a different immutable configuration');
  }
  validateRuntime(runtime);
  if (!verifyRecordedRuntime(runtime) || (fs.existsSync(statePath) && !verifyPersistedManifest(runtime))) {
    runtime.state.invalidated = true;
    runtime.state.status = 'invalidated';
    runtime.state.blockers = ['RECORDED_ARTIFACT_HASH_DRIFT'];
    saveRuntime(runtime);
    throw new Error('Recorded pipeline artifact drift invalidated the run');
  }
  if (runtime.state.invalidated) throw new Error('Pipeline run is invalidated and cannot resume');
  if (activate) {
    runtime.state.status = 'active';
    runtime.state.blockers = [];
    saveRuntime(runtime);
  }
  return runtime;
}

function normalizedArguments(root, args) {
  return args.map(argument => {
    const value = String(argument);
    if (!path.isAbsolute(value)) return value;
    const artifactRelative = path.relative(root, value);
    if (artifactRelative && !artifactRelative.startsWith('..') && !path.isAbsolute(artifactRelative)) {
      return `$ARTIFACT_ROOT/${artifactRelative.split(path.sep).join('/')}`;
    }
    const repoRelative = path.relative(REPO_ROOT, value);
    if (repoRelative && !repoRelative.startsWith('..') && !path.isAbsolute(repoRelative)) {
      return `$REPO_ROOT/${repoRelative.split(path.sep).join('/')}`;
    }
    return '$EXTERNAL_PATH';
  });
}

function implementationEvidence(implementation) {
  const relative = path.relative(REPO_ROOT, implementation).split(path.sep).join('/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('Pipeline implementation must be repository-bound');
  return { path: relative, sha256: fileSha256(implementation) };
}

function existingFiles(paths) {
  return paths.filter(filePath => fs.existsSync(filePath) && fs.statSync(filePath).isFile());
}

function executeNodeCommand(runtime, {
  commandId,
  stage,
  implementation,
  args,
  inputs = [],
  outputs = [],
  stdoutArtifact = null,
}) {
  const inputInventory = inventory(runtime.root, inputs);
  const argumentDigest = canonicalSha256(normalizedArguments(runtime.root, args));
  const implementationEntry = implementationEvidence(implementation);
  const prior = [...runtime.ledger].reverse().find(entry => (
    entry.commandId === commandId
    && entry.status === 'passed'
    && entry.implementation.sha256 === implementationEntry.sha256
    && entry.argumentsSha256 === argumentDigest
    && entry.inputInventorySha256 === inputInventory.sha256
  ));
  if (prior && existingFiles(outputs).length === outputs.length
    && inventory(runtime.root, outputs).sha256 === prior.outputInventorySha256) {
    return { passed: true, skipped: true, exitCode: 0, stdout: '' };
  }

  const result = spawnSync(process.execPath, [implementation, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 16 * 1024 * 1024,
  });
  const exitCode = Number.isInteger(result.status) ? result.status : 255;
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (stdoutArtifact && exitCode === 0) {
    atomicWritePrivate(stdoutArtifact, stdout, { rootPath: runtime.root, verifyIdentical: true });
  }
  const outputInventory = inventory(runtime.root, existingFiles(outputs));
  runtime.ledger.push({
    schema: 'com.saferide.ai.v05-pipeline-command-ledger', schemaVersion: 1,
    sequence: runtime.ledger.length + 1, commandId, stage, implementation: implementationEntry,
    argumentNames: commandArgumentNames(args), argumentsSha256: argumentDigest,
    inputInventorySha256: inputInventory.sha256, outputInventorySha256: outputInventory.sha256,
    exitCode, status: exitCode === 0 ? 'passed' : 'blocked',
    stdoutSha256: sha256(stdout), stdoutBytes: Buffer.byteLength(stdout),
    stderrSha256: sha256(stderr), stderrBytes: Buffer.byteLength(stderr),
    privacy: { containsArguments: false, containsArtifactContent: false, containsEnvironment: false, containsCredentials: false },
  });
  saveRuntime(runtime);
  return { passed: exitCode === 0, skipped: false, exitCode, stdout };
}

function allowedTransition(from, to, mode) {
  const states = mode === 'mechanical-smoke' ? [...PRODUCTION_STATES, 'smoke-complete'] : PRODUCTION_STATES;
  return states.indexOf(to) === states.indexOf(from) + 1;
}

function transition(runtime, to, inputs, outputs, evidenceKind = 'production-technical') {
  const from = runtime.state.currentState;
  if (!allowedTransition(from, to, runtime.state.mode)) throw new Error(`Invalid pipeline transition ${from} -> ${to}`);
  const inputInventory = inventory(runtime.root, inputs);
  const outputInventory = inventory(runtime.root, outputs);
  runtime.state.transitions.push({
    sequence: runtime.state.transitions.length + 1,
    from,
    to,
    inputInventorySha256: inputInventory.sha256,
    outputInventorySha256: outputInventory.sha256,
    commandLedgerSha256: sha256(jsonlText(runtime.ledger)),
    inputs: inputInventory.entries,
    outputs: outputInventory.entries,
    evidenceKind,
  });
  runtime.state.currentState = to;
  runtime.state.status = 'active';
  runtime.state.blockers = [];
  saveRuntime(runtime);
}

function block(runtime, codes) {
  runtime.state.status = 'blocked';
  runtime.state.blockers = [...new Set(codes)].sort();
  saveRuntime(runtime);
  console.log(`BLOCKED (${runtime.state.currentState}): ${runtime.state.blockers.join(', ')}`);
  return 1;
}

function writeJsonArtifact(root, relativePath, value, options = {}) {
  return atomicWritePrivate(
    artifactPath(root, relativePath),
    `${JSON.stringify(value, null, 2)}\n`,
    { rootPath: root, verifyIdentical: options.verifyIdentical !== false, overwrite: options.overwrite === true },
  );
}

function copyImmutable(root, source, relativeTarget) {
  const target = artifactPath(root, relativeTarget);
  return atomicWritePrivate(target, fs.readFileSync(assertPrivateFile(source, root)), { rootPath: root, verifyIdentical: true });
}

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const output = [];
  const visit = current => {
    for (const name of fs.readdirSync(current).sort()) {
      const candidate = path.join(current, name);
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) throw new Error('Pipeline artifact directories may not contain symbolic links');
      if (stat.isDirectory()) visit(candidate);
      else if (stat.isFile()) output.push(candidate);
    }
  };
  visit(directory);
  return output;
}

function compareFileTrees(leftRoot, rightRoot, relativePaths) {
  return relativePaths.every(relative => {
    const left = path.join(leftRoot, relative);
    const right = path.join(rightRoot, relative);
    return fs.existsSync(left) && fs.existsSync(right)
      && fs.statSync(left).size === fs.statSync(right).size
      && fileSha256(left) === fileSha256(right);
  });
}

function runCommandOrBlock(runtime, specification, blockerCode) {
  const result = executeNodeCommand(runtime, specification);
  if (!result.passed) {
    block(runtime, [blockerCode]);
    return false;
  }
  return true;
}

function stageScenarioDraft(runtime) {
  const root = runtime.root;
  const commands = [
    {
      commandId: 'scenario-scaffold-v1', stage: 'scenario-draft', implementation: SCENARIO_SCRIPT,
      args: ['scaffold', '--artifact-root', root, '--output', LAYOUT.blueprints],
      inputs: [DEFAULT_PLAN_PATH, TARGETS_PATH], outputs: [artifactPath(root, LAYOUT.blueprints)],
    },
    {
      commandId: 'scenario-content-scaffold-v1', stage: 'scenario-draft', implementation: SCENARIO_SCRIPT,
      args: ['content-scaffold', '--artifact-root', root, '--blueprints', LAYOUT.blueprints, '--output', LAYOUT.content],
      inputs: [artifactPath(root, LAYOUT.blueprints), TARGETS_PATH], outputs: [artifactPath(root, LAYOUT.content)],
    },
    {
      commandId: 'scenario-assemble-v1', stage: 'scenario-draft', implementation: SCENARIO_SCRIPT,
      args: ['assemble', '--artifact-root', root, '--blueprints', LAYOUT.blueprints, '--content', LAYOUT.content, '--output', LAYOUT.scenarioDraft],
      inputs: [artifactPath(root, LAYOUT.blueprints), artifactPath(root, LAYOUT.content)], outputs: [artifactPath(root, LAYOUT.scenarioDraft)],
    },
  ];
  for (const command of commands) if (!runCommandOrBlock(runtime, command, 'SCENARIO_DRAFT_FAILED')) return 1;
  transition(runtime, 'scenario-draft', [DEFAULT_PLAN_PATH, TARGETS_PATH], commands.flatMap(command => command.outputs));
  return 0;
}

function stageScenarioMetrics(runtime) {
  const root = runtime.root;
  const output = artifactPath(root, LAYOUT.scenarioMetrics);
  if (!runCommandOrBlock(runtime, {
    commandId: 'scenario-metrics-strict-v1', stage: 'scenario-metrics-passed', implementation: SCENARIO_SCRIPT,
    args: ['metrics', '--artifact-root', root, '--scenarios', LAYOUT.scenarioDraft, '--output', LAYOUT.scenarioMetrics, '--strict'],
    inputs: [artifactPath(root, LAYOUT.scenarioDraft), DEFAULT_PLAN_PATH, TARGETS_PATH], outputs: [output],
  }, 'SCENARIO_METRICS_FAILED')) return 1;
  if (readJson(output).passed !== true) return block(runtime, ['SCENARIO_METRICS_FAILED']);
  transition(runtime, 'scenario-metrics-passed', [artifactPath(root, LAYOUT.scenarioDraft), DEFAULT_PLAN_PATH, TARGETS_PATH], [output]);
  return 0;
}

function reproducibilityEvidence(kind, sourceCommit, canonicalPath, reproductionPath, extra = {}) {
  const canonicalHash = fileSha256(canonicalPath);
  const reproductionHash = fileSha256(reproductionPath);
  if (canonicalHash !== reproductionHash || fs.statSync(canonicalPath).size !== fs.statSync(reproductionPath).size) {
    throw new Error(`${kind} output is not byte reproducible`);
  }
  return {
    schema: 'com.saferide.ai.v05-byte-reproducibility', schemaVersion: 1,
    kind, sourceCommit, identical: true, canonicalSha256: canonicalHash,
    reproductionSha256: reproductionHash, sizeBytes: fs.statSync(canonicalPath).size,
    ...extra,
    privacy: { containsArtifactContent: false, containsPrivatePaths: false },
  };
}

function stageSplitDraft(runtime) {
  const root = runtime.root;
  const draft = artifactPath(root, LAYOUT.splitDraft);
  const reproduction = artifactPath(root, 'run/split-manifest.draft.reproduction.json');
  const base = ['assign', '--scenarios', artifactPath(root, LAYOUT.scenarioDraft), '--status', 'draft'];
  for (const [commandId, output] of [['split-draft-canonical-v1', draft], ['split-draft-reproduction-v1', reproduction]]) {
    if (!runCommandOrBlock(runtime, {
      commandId, stage: 'split-draft', implementation: BUILD_SCRIPT,
      args: [...base, '--output', output], inputs: [artifactPath(root, LAYOUT.scenarioDraft), DEFAULT_PLAN_PATH], outputs: [output],
    }, 'SPLIT_DRAFT_FAILED')) return 1;
  }
  let evidence;
  try {
    const manifest = readJson(draft);
    evidence = reproducibilityEvidence('draft-split-assignment', runtime.state.sourceCommit, draft, reproduction, {
      familyCount: manifest.counts?.families ?? 0,
      rowCount: manifest.counts?.rows ?? 0,
      assignmentInventorySha256: manifest.assignmentInventorySha256,
    });
    if (schemaErrors('byteReproducibility', runtime.schemas.byteReproducibility, evidence).length) throw new Error('Evidence schema failed');
  } catch {
    return block(runtime, ['SPLIT_REPRODUCIBILITY_FAILED']);
  }
  const evidencePathValue = artifactPath(root, LAYOUT.splitReproducibility);
  writeJsonArtifact(root, LAYOUT.splitReproducibility, evidence);
  fs.unlinkSync(reproduction);
  transition(runtime, 'split-draft', [artifactPath(root, LAYOUT.scenarioDraft), DEFAULT_PLAN_PATH], [draft, evidencePathValue]);
  return 0;
}

function stageScenarioApproval(runtime) {
  const root = runtime.root;
  const frozen = artifactPath(root, runtime.config.paths.scenarioFrozen);
  if (!fs.existsSync(frozen)) return block(runtime, ['SCENARIO_APPROVAL_REQUIRED']);
  assertPrivateFile(frozen, root);
  const diff = artifactPath(root, LAYOUT.freezeDiff);
  if (!runCommandOrBlock(runtime, {
    commandId: `scenario-freeze-diff-${fileSha256(frozen).slice(0, 16)}`,
    stage: 'scenario-approved-external-input', implementation: SCENARIO_SCRIPT,
    args: ['freeze-diff', '--artifact-root', root, '--draft', LAYOUT.scenarioDraft, '--frozen', runtime.config.paths.scenarioFrozen, '--output', LAYOUT.freezeDiff],
    inputs: [artifactPath(root, LAYOUT.scenarioDraft), frozen], outputs: [diff],
  }, 'SCENARIO_APPROVAL_INVALID')) return 1;
  if (!runCommandOrBlock(runtime, {
    commandId: `scenario-frozen-validate-${fileSha256(frozen).slice(0, 16)}`,
    stage: 'scenario-approved-external-input', implementation: SCENARIO_SCRIPT,
    args: ['validate', '--artifact-root', root, '--scenarios', runtime.config.paths.scenarioFrozen, '--strict'],
    inputs: [frozen, DEFAULT_PLAN_PATH, TARGETS_PATH], outputs: [],
  }, 'SCENARIO_APPROVAL_INVALID')) return 1;
  transition(runtime, 'scenario-approved-external-input', [artifactPath(root, LAYOUT.scenarioDraft), frozen], [diff], 'external-input-verified');
  return 0;
}

function stageScenarioAndSplitFrozen(runtime) {
  const root = runtime.root;
  const frozenScenarios = artifactPath(root, runtime.config.paths.scenarioFrozen);
  const approvals = artifactPath(root, runtime.config.paths.splitApprovals);
  if (!fs.existsSync(approvals)) return block(runtime, ['SPLIT_APPROVAL_REQUIRED']);
  assertPrivateFile(approvals, root);
  const frozenSplit = artifactPath(root, LAYOUT.splitFrozen);
  const reproduction = artifactPath(root, 'run/split-manifest.frozen.reproduction.json');
  const base = ['assign', '--scenarios', frozenScenarios, '--status', 'frozen', '--approvals', approvals];
  for (const [commandId, output] of [['split-frozen-canonical-v1', frozenSplit], ['split-frozen-reproduction-v1', reproduction]]) {
    if (!runCommandOrBlock(runtime, {
      commandId, stage: 'scenario-and-split-frozen', implementation: BUILD_SCRIPT,
      args: [...base, '--output', output], inputs: [frozenScenarios, approvals, DEFAULT_PLAN_PATH], outputs: [output],
    }, 'SPLIT_FREEZE_FAILED')) return 1;
  }
  let evidence;
  try {
    const manifest = readJson(frozenSplit);
    const draftManifest = readJson(artifactPath(root, LAYOUT.splitDraft));
    if (draftManifest.assignmentInventorySha256 !== manifest.assignmentInventorySha256) throw new Error('Assignment changed');
    evidence = reproducibilityEvidence('frozen-split-assignment', runtime.state.sourceCommit, frozenSplit, reproduction, {
      familyCount: manifest.counts?.families ?? 0,
      rowCount: manifest.counts?.rows ?? 0,
      assignmentInventorySha256: manifest.assignmentInventorySha256,
      draftAssignmentInventorySha256: draftManifest.assignmentInventorySha256,
    });
    if (schemaErrors('byteReproducibility', runtime.schemas.byteReproducibility, evidence).length) throw new Error('Evidence schema failed');
  } catch {
    return block(runtime, ['SPLIT_REPRODUCIBILITY_FAILED']);
  }
  const evidencePathValue = artifactPath(root, LAYOUT.splitFreezeReproducibility);
  writeJsonArtifact(root, LAYOUT.splitFreezeReproducibility, evidence);
  fs.unlinkSync(reproduction);
  transition(runtime, 'scenario-and-split-frozen', [frozenScenarios, approvals, artifactPath(root, LAYOUT.splitDraft)], [frozenSplit, evidencePathValue], 'external-input-verified');
  return 0;
}

function stageAuthoringPack(runtime) {
  const root = runtime.root;
  const output = artifactPath(root, LAYOUT.authoringPack);
  if (!runCommandOrBlock(runtime, {
    commandId: 'authoring-pack-frozen-v1', stage: 'authoring-pack-frozen', implementation: BUILD_SCRIPT,
    args: ['authoring-pack', '--scenarios', artifactPath(root, runtime.config.paths.scenarioFrozen), '--split-manifest', artifactPath(root, LAYOUT.splitFrozen), '--output', output],
    inputs: [artifactPath(root, runtime.config.paths.scenarioFrozen), artifactPath(root, LAYOUT.splitFrozen), DEFAULT_PLAN_PATH], outputs: [output],
  }, 'AUTHORING_PACK_FAILED')) return 1;
  if (readJsonl(output).length !== 2600) return block(runtime, ['AUTHORING_PACK_COVERAGE_FAILED']);
  transition(runtime, 'authoring-pack-frozen', [artifactPath(root, runtime.config.paths.scenarioFrozen), artifactPath(root, LAYOUT.splitFrozen)], [output]);
  return 0;
}

function incomingCandidateFiles(root) {
  const directory = artifactPath(root, 'candidates/incoming');
  return walkFiles(directory)
    .filter(filePath => filePath.endsWith('.jsonl'))
    .map(filePath => assertPrivateFile(filePath, root))
    .sort((left, right) => relativeArtifact(root, left).localeCompare(relativeArtifact(root, right)));
}

function candidateCoverage(rows, splitManifest) {
  const knownSlots = new Set((splitManifest.assignments ?? []).flatMap(assignment => Object.values(assignment.rowIds ?? {})));
  const counts = new Map();
  for (const row of rows) counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
  const unknownSlots = [...counts.keys()].filter(rowId => !knownSlots.has(rowId)).length;
  const representedSlots = [...knownSlots].filter(rowId => counts.has(rowId)).length;
  const maximumPerSlot = Math.max(0, ...counts.values());
  return { knownSlots: knownSlots.size, representedSlots, unknownSlots, maximumPerSlot };
}

function stageCandidateImport(runtime) {
  const root = runtime.root;
  const authoringPack = artifactPath(root, LAYOUT.authoringPack);
  if (runtime.config.generation.enabled) {
    const generatorConfig = artifactPath(root, runtime.config.generation.configurationPath);
    if (!fs.existsSync(generatorConfig)) return block(runtime, ['GENERATOR_CONFIGURATION_REQUIRED']);
    const generator = readJson(assertPrivateFile(generatorConfig, root));
    const generatorBindingsValid = generator.status === 'approved-controlled'
      && generator.sourceCommit === runtime.state.sourceCommit
      && generator.bindings?.authoringPackSha256 === fileSha256(authoringPack)
      && generator.bindings?.scenarioMatrixSha256 === fileSha256(artifactPath(root, runtime.config.paths.scenarioFrozen))
      && generator.bindings?.splitManifestSha256 === fileSha256(artifactPath(root, LAYOUT.splitFrozen))
      && generator.authoring?.policySha256 === fileSha256(artifactPath(root, runtime.config.paths.policy))
      && generator.authoring?.systemPromptConfigSha256 === fileSha256(artifactPath(root, runtime.config.paths.systemPrompt));
    if (!generatorBindingsValid) return block(runtime, ['GENERATOR_CONFIGURATION_INVALID']);
    if (!runCommandOrBlock(runtime, {
      commandId: `candidate-generation-${fileSha256(generatorConfig).slice(0, 16)}`,
      stage: 'candidates-imported', implementation: GENERATOR_SCRIPT,
      args: ['--artifact-root', root, '--authoring-pack', LAYOUT.authoringPack, '--output-dir', 'candidates/incoming', '--generator-config', runtime.config.generation.configurationPath, '--resume'],
      inputs: [authoringPack, generatorConfig], outputs: [artifactPath(root, 'candidates/candidate-index.json')],
    }, 'CANDIDATE_GENERATION_INCOMPLETE')) return 1;
  }

  const inputs = incomingCandidateFiles(root);
  if (!inputs.length) return block(runtime, ['CANDIDATE_INPUT_REQUIRED']);
  const inputInventory = inventory(root, inputs);
  const attemptId = inputInventory.sha256.slice(0, 20);
  const attemptBase = `candidates/imported/attempts/${attemptId}`;
  const mergedRelative = `${attemptBase}/merged-source.jsonl`;
  const importedRelative = `${attemptBase}/candidates.jsonl`;
  const mergedPath = artifactPath(root, mergedRelative);
  const importedPath = artifactPath(root, importedRelative);
  let rows;
  try {
    rows = inputs.flatMap(filePath => readJsonl(filePath));
    atomicWritePrivate(mergedPath, jsonlText(rows), { rootPath: root, verifyIdentical: true });
  } catch {
    return block(runtime, ['CANDIDATE_INPUT_INVALID']);
  }
  if (!runCommandOrBlock(runtime, {
    commandId: `candidate-import-${attemptId}`, stage: 'candidates-imported', implementation: BUILD_SCRIPT,
    args: ['import-candidates', '--scenarios', artifactPath(root, runtime.config.paths.scenarioFrozen), '--split-manifest', artifactPath(root, LAYOUT.splitFrozen), '--input', mergedPath, '--output', importedPath],
    inputs: [artifactPath(root, runtime.config.paths.scenarioFrozen), artifactPath(root, LAYOUT.splitFrozen), ...inputs, DEFAULT_PLAN_PATH], outputs: [importedPath],
  }, 'CANDIDATE_IMPORT_FAILED')) return 1;

  const importedRows = readJsonl(importedPath);
  const coverage = candidateCoverage(importedRows, readJson(artifactPath(root, LAYOUT.splitFrozen)));
  const report = {
    schema: 'com.saferide.ai.v05-candidate-import-inventory', schemaVersion: 1,
    datasetId: DATASET_ID, sourceCommit: runtime.state.sourceCommit,
    inputFileCount: inputs.length, candidateCount: importedRows.length,
    knownSlots: coverage.knownSlots, representedSlots: coverage.representedSlots,
    unknownSlots: coverage.unknownSlots, maximumCandidatesPerSlot: coverage.maximumPerSlot,
    candidateFileInventorySha256: inputInventory.sha256,
    candidateFiles: inputs.map(filePath => ({ sha256: fileSha256(filePath), sizeBytes: fs.statSync(filePath).size, recordCount: readJsonl(filePath).length })),
    complete: coverage.knownSlots === 2600 && coverage.representedSlots === 2600 && coverage.unknownSlots === 0 && coverage.maximumPerSlot <= 3,
    privacy: { containsCandidateContent: false, containsPrivatePaths: false, containsCredentials: false },
  };
  writeJsonArtifact(root, `run/candidate-import-attempt-${attemptId}.json`, report);
  if (!report.complete) return block(runtime, ['CANDIDATE_COVERAGE_INCOMPLETE']);
  copyImmutable(root, importedPath, LAYOUT.candidates);
  writeJsonArtifact(root, LAYOUT.candidateImportInventory, report);
  transition(runtime, 'candidates-imported', [authoringPack, artifactPath(root, LAYOUT.splitFrozen), ...inputs], [artifactPath(root, LAYOUT.candidates), artifactPath(root, LAYOUT.candidateImportInventory)]);
  return 0;
}

function optionalPrivateInput(runtime, relativePath, requiredPrefix = null) {
  const filePath = artifactPath(runtime.root, relativePath, { requiredPrefix });
  return fs.existsSync(filePath) ? assertPrivateFile(filePath, runtime.root) : null;
}

function screenAttempt(runtime) {
  const root = runtime.root;
  const candidates = artifactPath(root, LAYOUT.candidates);
  const scenarios = artifactPath(root, runtime.config.paths.scenarioFrozen);
  const split = artifactPath(root, LAYOUT.splitFrozen);
  const policy = artifactPath(root, runtime.config.paths.policy);
  const prompt = artifactPath(root, runtime.config.paths.systemPrompt);
  const tokenReport = optionalPrivateInput(runtime, runtime.config.paths.tokenizationReport, 'screening');
  const semanticReport = optionalPrivateInput(runtime, runtime.config.paths.candidateSemanticReport, 'screening');
  const boundInputs = [candidates, scenarios, split, policy, prompt, ...[tokenReport, semanticReport].filter(Boolean)];
  const attemptId = inventory(root, boundInputs).sha256.slice(0, 20);
  const paths = {
    candidateIndex: `candidates/imported/screen-attempts/${attemptId}/candidate-index.json`,
    semanticRequest: `screening/attempts/${attemptId}/candidate-semantic-request.json`,
    report: `public-safe/screen-attempts/${attemptId}/candidate-screen-report.json`,
    details: `screening/attempts/${attemptId}/candidate-screen-details.jsonl`,
    shortlist: `screening/attempts/${attemptId}/shortlist.jsonl`,
  };
  const args = [
    '--artifact-root', root, '--scenarios', runtime.config.paths.scenarioFrozen,
    '--split-manifest', LAYOUT.splitFrozen, '--candidate', LAYOUT.candidates,
    '--policy', runtime.config.paths.policy, '--system-prompt', runtime.config.paths.systemPrompt,
    '--candidate-index', paths.candidateIndex, '--semantic-request', paths.semanticRequest,
    '--report', paths.report, '--details', paths.details, '--shortlist', paths.shortlist,
  ];
  if (tokenReport) args.push('--token-report', runtime.config.paths.tokenizationReport);
  if (semanticReport) args.push('--semantic-report', runtime.config.paths.candidateSemanticReport);
  const outputFiles = Object.values(paths).map(relative => artifactPath(root, relative));
  const result = executeNodeCommand(runtime, {
    commandId: `candidate-screen-${attemptId}`, stage: 'candidates-screened', implementation: SCREEN_SCRIPT,
    args, inputs: [...boundInputs, DEFAULT_PLAN_PATH], outputs: outputFiles,
  });
  return { result, paths, outputFiles, boundInputs, report: result.passed ? readJson(artifactPath(root, paths.report)) : null };
}

function stageCandidateScreen(runtime) {
  const attempt = screenAttempt(runtime);
  if (!attempt.result.passed) return block(runtime, ['CANDIDATE_SCREEN_FAILED']);
  if (runtime.state.currentState === 'candidates-imported') {
    transition(runtime, 'candidates-screened', attempt.boundInputs, attempt.outputFiles);
  }
  if (attempt.report?.strictReady !== true) {
    const blockers = ['CANDIDATE_SCREEN_NOT_READY'];
    if (!optionalPrivateInput(runtime, runtime.config.paths.tokenizationReport, 'screening')) blockers.push('TOKENIZATION_REPORT_REQUIRED');
    if (!optionalPrivateInput(runtime, runtime.config.paths.candidateSemanticReport, 'screening')) blockers.push('CANDIDATE_SEMANTIC_REPORT_REQUIRED');
    return block(runtime, blockers);
  }
  const canonical = {
    candidateIndex: LAYOUT.candidateIndex, semanticRequest: LAYOUT.candidateSemanticRequest,
    report: LAYOUT.screenReport, details: LAYOUT.screenDetails, shortlist: LAYOUT.shortlist,
  };
  for (const key of Object.keys(canonical)) copyImmutable(runtime.root, artifactPath(runtime.root, attempt.paths[key]), canonical[key]);
  const outputs = Object.values(canonical).map(relative => artifactPath(runtime.root, relative));
  transition(runtime, 'review-ready', attempt.boundInputs, outputs);
  return 0;
}

function stageReviews(runtime) {
  const root = runtime.root;
  const reviewLedger = artifactPath(root, runtime.config.paths.reviewLedger);
  if (!fs.existsSync(reviewLedger)) return block(runtime, ['HUMAN_REVIEW_REQUIRED']);
  assertPrivateFile(reviewLedger, root);
  const output = artifactPath(root, LAYOUT.reviewSummary);
  if (!runCommandOrBlock(runtime, {
    commandId: `review-validation-${fileSha256(reviewLedger).slice(0, 16)}`,
    stage: 'reviews-complete-external-input', implementation: REVIEW_SCRIPT,
    args: [
      '--plan', DEFAULT_PLAN_PATH, '--scenarios', artifactPath(root, runtime.config.paths.scenarioFrozen),
      '--split-manifest', artifactPath(root, LAYOUT.splitFrozen), '--candidates', artifactPath(root, LAYOUT.shortlist),
      '--reviews', reviewLedger, '--system-prompt', artifactPath(root, runtime.config.paths.systemPrompt), '--output', output,
    ],
    inputs: [DEFAULT_PLAN_PATH, artifactPath(root, runtime.config.paths.scenarioFrozen), artifactPath(root, LAYOUT.splitFrozen), artifactPath(root, LAYOUT.shortlist), reviewLedger, artifactPath(root, runtime.config.paths.systemPrompt)],
    outputs: [output],
  }, 'HUMAN_REVIEW_INVALID')) return 1;
  if (readJson(output).passed !== true) return block(runtime, ['HUMAN_REVIEW_INVALID']);
  transition(runtime, 'reviews-complete-external-input', [artifactPath(root, LAYOUT.shortlist), reviewLedger], [output], 'external-input-verified');
  return 0;
}

const BUILD_RELATIVE_FILES = Object.freeze([
  'controlled/train.jsonl', 'controlled/dev.jsonl', 'controlled/pilot-row-manifest.json',
  'restricted/quality-holdout.jsonl', 'restricted/safety-holdout.jsonl', 'restricted/review-summary.json',
  'public-safe/dataset-manifest.json',
]);

function buildOutputFiles(directory) {
  return BUILD_RELATIVE_FILES.map(relative => path.join(directory, relative));
}

function stageDatasetBuild(runtime) {
  const root = runtime.root;
  const first = artifactPath(root, 'run/build-attempt-a');
  const second = artifactPath(root, 'run/build-attempt-b');
  const common = [
    'build', '--scenarios', artifactPath(root, runtime.config.paths.scenarioFrozen),
    '--split-manifest', artifactPath(root, LAYOUT.splitFrozen), '--candidates', artifactPath(root, LAYOUT.shortlist),
    '--reviews', artifactPath(root, runtime.config.paths.reviewLedger), '--policy', artifactPath(root, runtime.config.paths.policy),
    '--system-prompt', artifactPath(root, runtime.config.paths.systemPrompt),
  ];
  const inputs = [
    DEFAULT_PLAN_PATH, artifactPath(root, runtime.config.paths.scenarioFrozen), artifactPath(root, LAYOUT.splitFrozen),
    artifactPath(root, LAYOUT.shortlist), artifactPath(root, runtime.config.paths.reviewLedger),
    artifactPath(root, runtime.config.paths.policy), artifactPath(root, runtime.config.paths.systemPrompt),
  ];
  for (const [commandId, outputDirectory] of [['dataset-build-a-v1', first], ['dataset-build-b-v1', second]]) {
    if (!runCommandOrBlock(runtime, {
      commandId, stage: 'dataset-frozen-pending-audit', implementation: BUILD_SCRIPT,
      args: [...common, '--output-dir', outputDirectory], inputs, outputs: buildOutputFiles(outputDirectory),
    }, 'FINAL_DATASET_BUILD_FAILED')) return 1;
  }
  const firstFiles = walkFiles(first).map(filePath => path.relative(first, filePath).split(path.sep).join('/')).sort();
  const secondFiles = walkFiles(second).map(filePath => path.relative(second, filePath).split(path.sep).join('/')).sort();
  const expectedFiles = [...BUILD_RELATIVE_FILES].sort();
  if (canonicalSha256(firstFiles) !== canonicalSha256(expectedFiles)
    || canonicalSha256(secondFiles) !== canonicalSha256(expectedFiles)
    || !compareFileTrees(first, second, BUILD_RELATIVE_FILES)) {
    return block(runtime, ['FINAL_DATASET_REPRODUCIBILITY_FAILED']);
  }
  const targets = {
    'controlled/train.jsonl': LAYOUT.train,
    'controlled/dev.jsonl': LAYOUT.dev,
    'controlled/pilot-row-manifest.json': LAYOUT.pilot,
    'restricted/quality-holdout.jsonl': LAYOUT.qualityHoldout,
    'restricted/safety-holdout.jsonl': LAYOUT.safetyHoldout,
    'restricted/review-summary.json': LAYOUT.datasetReviewSummary,
    'public-safe/dataset-manifest.json': LAYOUT.datasetManifest,
  };
  for (const [relative, target] of Object.entries(targets)) copyImmutable(root, path.join(first, relative), target);
  if (fileSha256(artifactPath(root, LAYOUT.reviewSummary)) !== fileSha256(artifactPath(root, LAYOUT.datasetReviewSummary))) {
    return block(runtime, ['REVIEW_SUMMARY_BUILD_MISMATCH']);
  }
  const outputs = Object.values(targets).map(relative => artifactPath(root, relative));
  transition(runtime, 'dataset-frozen-pending-audit', inputs, outputs);
  return 0;
}

function stageDatasetAudit(runtime) {
  const root = runtime.root;
  const semanticReport = artifactPath(root, runtime.config.paths.finalSemanticReport);
  const semanticDetails = artifactPath(root, runtime.config.paths.finalSemanticDetails);
  const blindPrompts = artifactPath(root, runtime.config.paths.blindPrompts);
  const missing = [semanticReport, semanticDetails, blindPrompts].filter(filePath => !fs.existsSync(filePath));
  if (missing.length) {
    const blockers = [];
    if (!fs.existsSync(semanticReport) || !fs.existsSync(semanticDetails)) blockers.push('FINAL_SEMANTIC_EVIDENCE_REQUIRED');
    if (!fs.existsSync(blindPrompts)) blockers.push('BLIND_HOLDOUT_REQUIRED');
    return block(runtime, blockers);
  }
  [semanticReport, semanticDetails, blindPrompts].forEach(filePath => assertPrivateFile(filePath, root));
  if (!runCommandOrBlock(runtime, {
    commandId: `final-semantic-check-${fileSha256(semanticReport).slice(0, 16)}`,
    stage: 'dataset-audited', implementation: SEMANTIC_SCRIPT,
    args: ['--report', semanticReport, '--details', semanticDetails, '--dataset-manifest', artifactPath(root, LAYOUT.datasetManifest), '--split-manifest', artifactPath(root, LAYOUT.splitFrozen)],
    inputs: [semanticReport, semanticDetails, artifactPath(root, LAYOUT.datasetManifest), artifactPath(root, LAYOUT.splitFrozen)], outputs: [],
  }, 'FINAL_SEMANTIC_EVIDENCE_INVALID')) return 1;

  const audit = artifactPath(root, LAYOUT.audit);
  const auditDetails = artifactPath(root, LAYOUT.auditDetails);
  if (!runCommandOrBlock(runtime, {
    commandId: `dataset-audit-${fileSha256(artifactPath(root, LAYOUT.datasetManifest)).slice(0, 16)}`,
    stage: 'dataset-audited', implementation: AUDIT_SCRIPT,
    args: [
      '--plan', DEFAULT_PLAN_PATH, '--artifact-root', artifactPath(root, 'dataset'),
      '--dataset-manifest', artifactPath(root, LAYOUT.datasetManifest), '--split-manifest', artifactPath(root, LAYOUT.splitFrozen),
      '--scenarios', artifactPath(root, runtime.config.paths.scenarioFrozen), '--review-summary', artifactPath(root, LAYOUT.reviewSummary),
      '--semantic-report', semanticReport, '--semantic-details', semanticDetails, '--output', audit, '--details-output', auditDetails,
    ],
    inputs: [DEFAULT_PLAN_PATH, artifactPath(root, LAYOUT.datasetManifest), artifactPath(root, LAYOUT.splitFrozen), artifactPath(root, runtime.config.paths.scenarioFrozen), artifactPath(root, LAYOUT.reviewSummary), semanticReport, semanticDetails, artifactPath(root, LAYOUT.train), artifactPath(root, LAYOUT.dev), artifactPath(root, LAYOUT.qualityHoldout), artifactPath(root, LAYOUT.safetyHoldout)],
    outputs: [audit, auditDetails],
  }, 'DATASET_AUDIT_FAILED')) return 1;

  const blindResult = artifactPath(root, LAYOUT.blindResult);
  if (!runCommandOrBlock(runtime, {
    commandId: `blind-check-${fileSha256(blindPrompts).slice(0, 16)}`,
    stage: 'dataset-audited', implementation: BLIND_SCRIPT,
    args: [
      '--split-manifest', artifactPath(root, LAYOUT.splitFrozen), '--blind-prompts', blindPrompts,
      '--corpus', artifactPath(root, LAYOUT.train), '--corpus', artifactPath(root, LAYOUT.dev),
      '--corpus', artifactPath(root, LAYOUT.qualityHoldout), '--corpus', artifactPath(root, LAYOUT.safetyHoldout), '--plan', DEFAULT_PLAN_PATH,
    ],
    inputs: [artifactPath(root, LAYOUT.splitFrozen), blindPrompts, artifactPath(root, LAYOUT.train), artifactPath(root, LAYOUT.dev), artifactPath(root, LAYOUT.qualityHoldout), artifactPath(root, LAYOUT.safetyHoldout), DEFAULT_PLAN_PATH],
    outputs: [blindResult], stdoutArtifact: blindResult,
  }, 'BLIND_CONTAMINATION_CHECK_FAILED')) return 1;
  transition(runtime, 'dataset-audited', [artifactPath(root, LAYOUT.datasetManifest), semanticReport, semanticDetails, blindPrompts], [audit, auditDetails, blindResult], 'external-input-verified');
  return 0;
}

function stageRegister(runtime) {
  const root = runtime.root;
  const evidence = artifactPath(root, runtime.config.paths.registerEvidence);
  assertPrivateFile(evidence, root);
  const attemptId = fileSha256(evidence).slice(0, 20);
  const attemptRelative = `register/attempts/input-register-${attemptId}.json`;
  const attempt = artifactPath(root, attemptRelative);
  if (!runCommandOrBlock(runtime, {
    commandId: `register-build-${attemptId}`, stage: 'register-frozen', implementation: REGISTER_SCRIPT,
    args: ['--artifact-root', root, '--evidence-config', runtime.config.paths.registerEvidence, '--output', attemptRelative],
    inputs: [evidence, PACKAGE_LOCK_PATH, DEFAULT_PLAN_PATH], outputs: [attempt],
  }, 'REGISTER_BUILD_FAILED')) return 1;
  const register = readJson(attempt);
  if (register.status !== 'training-ready' || register.trainingReadiness?.strictGatePassed !== true) {
    return block(runtime, ['REGISTER_EVIDENCE_REQUIRED']);
  }
  copyImmutable(root, attempt, LAYOUT.register);
  transition(runtime, 'register-frozen', [evidence, ...Object.values(register.artifacts).filter(entry => entry.path).map(entry => artifactPath(root, entry.path))], [artifactPath(root, LAYOUT.register)], 'external-input-verified');
  return 0;
}

function registerArtifactFiles(root, register, { trainingOnly = false } = {}) {
  return Object.values(register.artifacts ?? {})
    .filter(entry => entry.path && (!trainingOnly || entry.classification !== 'restricted'))
    .map(entry => artifactPath(root, entry.path));
}

function stageStrictReadiness(runtime) {
  const root = runtime.root;
  const registerPath = artifactPath(root, LAYOUT.register);
  const register = readJson(registerPath);
  const base = [
    '--register', registerPath, '--artifact-root', root,
    '--train-data', artifactPath(root, LAYOUT.train), '--dev-data', artifactPath(root, LAYOUT.dev),
  ];
  if (!runCommandOrBlock(runtime, {
    commandId: `readiness-full-strict-${fileSha256(registerPath).slice(0, 16)}`,
    stage: 'strict-ready', implementation: READINESS_SCRIPT,
    args: [...base, '--strict'], inputs: [registerPath, ...registerArtifactFiles(root, register)], outputs: [],
  }, 'FULL_STRICT_READINESS_FAILED')) return 1;
  if (!runCommandOrBlock(runtime, {
    commandId: `readiness-training-strict-${fileSha256(registerPath).slice(0, 16)}`,
    stage: 'strict-ready', implementation: READINESS_SCRIPT,
    args: [...base, '--training-strict'], inputs: [registerPath, ...registerArtifactFiles(root, register, { trainingOnly: true })], outputs: [],
  }, 'TRAINING_STRICT_READINESS_FAILED')) return 1;
  transition(runtime, 'strict-ready', [registerPath, artifactPath(root, LAYOUT.train), artifactPath(root, LAYOUT.dev)], [], 'external-input-verified');
  return 0;
}

function runProduction(runtime) {
  while (true) {
    const state = runtime.state.currentState;
    let result;
    if (state === 'initialized') result = stageScenarioDraft(runtime);
    else if (state === 'scenario-draft') result = stageScenarioMetrics(runtime);
    else if (state === 'scenario-metrics-passed') result = stageSplitDraft(runtime);
    else if (state === 'split-draft') result = stageScenarioApproval(runtime);
    else if (state === 'scenario-approved-external-input') result = stageScenarioAndSplitFrozen(runtime);
    else if (state === 'scenario-and-split-frozen') result = stageAuthoringPack(runtime);
    else if (state === 'authoring-pack-frozen') result = stageCandidateImport(runtime);
    else if (state === 'candidates-imported' || state === 'candidates-screened') result = stageCandidateScreen(runtime);
    else if (state === 'review-ready') result = stageReviews(runtime);
    else if (state === 'reviews-complete-external-input') result = stageDatasetBuild(runtime);
    else if (state === 'dataset-frozen-pending-audit') result = stageDatasetAudit(runtime);
    else if (state === 'dataset-audited') result = stageRegister(runtime);
    else if (state === 'register-frozen') result = stageStrictReadiness(runtime);
    else if (state === 'strict-ready') return block(runtime, ['TRAINING_HANDOFF_NOT_AUTHORIZED']);
    else if (state === 'training-handoff') {
      runtime.state.status = 'complete';
      runtime.state.blockers = [];
      saveRuntime(runtime);
      return 0;
    } else throw new Error(`Unsupported production pipeline state: ${state}`);
    if (result !== 0) return result;
  }
}

function smokeRoot(requested, create) {
  const resolved = path.resolve(requested);
  const relative = path.relative(REPO_ROOT, resolved);
  const insideRepository = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  if (insideRepository && relative.split(path.sep)[0] !== '.ai-smoke') {
    throw new Error('Repository-local smoke roots must remain under ignored .ai-smoke/');
  }
  return secureArtifactRoot(resolved, { create, allowRepositoryTestRoot: insideRepository });
}

function smokeArtifact(state, sequence, sourceCommit, previousArtifactSha256) {
  return {
    schema: 'com.saferide.ai.v05-pipeline-smoke-artifact', schemaVersion: 1,
    artifactId: `v05-smoke-${String(sequence).padStart(2, '0')}-${state}`,
    datasetId: SMOKE_DATASET_ID, state, sequence, sourceCommit, previousArtifactSha256,
    strictReady: false, productionDatasetIdAllowed: false, classification: 'smoke-only',
    privacy: { containsCandidateText: false, containsHoldouts: false, containsReviews: false, containsCredentials: false },
  };
}

function initializeSmokeRuntime(root, schemas) {
  if (fs.readdirSync(root).length) throw new Error('A new smoke run requires an empty artifact root');
  const sourceCommit = currentCommit();
  const sentinel = smokeArtifact('initialized', 0, sourceCommit, null);
  const sentinelErrors = schemaErrors('pipelineSmokeArtifact', schemas.pipelineSmokeArtifact, sentinel);
  if (sentinelErrors.length) throw new Error(`Smoke sentinel contract failed (${sentinelErrors.length} findings)`);
  const sentinelPath = path.join(root, '.saferide-v05-smoke.json');
  atomicWritePrivate(sentinelPath, `${JSON.stringify(sentinel, null, 2)}\n`, { rootPath: root });
  const configurationSha256 = fileSha256(sentinelPath);
  const state = {
    schema: 'com.saferide.ai.v05-pipeline-state', schemaVersion: 1,
    runId: `v05-smoke-${sourceCommit.slice(0, 16)}`, datasetId: SMOKE_DATASET_ID, mode: 'mechanical-smoke',
    sourceCommit, configurationSha256, currentState: 'initialized', status: 'active', transitions: [], blockers: [],
    commandLedgerSha256: sha256(emptyLedgerText()), invalidated: false,
    privacy: { containsArtifactContent: false, containsArguments: false, containsEnvironment: false, containsCredentials: false },
  };
  const runtime = { root, config: sentinel, state, ledger: [], schemas };
  saveRuntime(runtime);
  return runtime;
}

function loadSmokeRuntime(root, resume, schemas) {
  const sentinelPath = assertPrivateFile(path.join(root, '.saferide-v05-smoke.json'), root);
  const sentinel = readJson(sentinelPath);
  if (schemaErrors('pipelineSmokeArtifact', schemas.pipelineSmokeArtifact, sentinel).length) throw new Error('Smoke sentinel is invalid');
  if (sentinel.sourceCommit !== currentCommit()) throw new Error('Smoke source commit differs from repository HEAD; create a new smoke run');
  const statePath = assertPrivateFile(artifactPath(root, LAYOUT.state), root);
  const ledgerPath = assertPrivateFile(artifactPath(root, LAYOUT.ledger), root);
  if (!resume) throw new Error('Existing smoke state requires --resume');
  const runtime = {
    root, config: sentinel, state: readJson(statePath), ledger: readJsonl(ledgerPath), schemas,
  };
  validateRuntime(runtime);
  if (!verifyRecordedRuntime(runtime) || !verifyPersistedManifest(runtime)) {
    runtime.state.invalidated = true;
    runtime.state.status = 'invalidated';
    runtime.state.blockers = ['RECORDED_ARTIFACT_HASH_DRIFT'];
    saveRuntime(runtime);
    throw new Error('Recorded smoke artifact drift invalidated the run');
  }
  if (runtime.state.invalidated) throw new Error('Smoke run is invalidated and cannot resume');
  return runtime;
}

function smokeCommandsForState(state) {
  const one = (name, implementation, args, inputs = []) => ({ name, implementation, args, inputs });
  const map = {
    'scenario-draft': [one('scenario-contract', SCENARIO_SCRIPT, ['contract-check'])],
    'scenario-metrics-passed': [one('scenario-metrics-contract', SCENARIO_SCRIPT, ['contract-check'])],
    'split-draft': [one('split-contract', BUILD_SCRIPT, ['plan-check'])],
    'scenario-approved-external-input': [one('freeze-contract', SCENARIO_SCRIPT, ['contract-check'])],
    'scenario-and-split-frozen': [one('frozen-split-contract', BUILD_SCRIPT, ['plan-check'])],
    'authoring-pack-frozen': [one('authoring-contract', BUILD_SCRIPT, ['plan-check'])],
    'candidates-imported': [one('generator-interface', GENERATOR_SCRIPT, ['--help'])],
    'candidates-screened': [one('screen-contract', SCREEN_SCRIPT, ['--contract-check'])],
    'review-ready': [one('review-interface', REVIEW_SCRIPT, ['--contract-check'])],
    'reviews-complete-external-input': [one('review-contract', REVIEW_SCRIPT, ['--contract-check'])],
    'dataset-frozen-pending-audit': [one('build-contract', BUILD_SCRIPT, ['plan-check'])],
    'dataset-audited': [
      one('semantic-contract', SEMANTIC_SCRIPT, ['--contract-check']),
      one('audit-contract', AUDIT_SCRIPT, ['--contract-check']),
      one('blind-interface', BLIND_SCRIPT, ['--help']),
    ],
    'register-frozen': [one('register-contract', REGISTER_SCRIPT, ['--contract-check'])],
    'strict-ready': [one('readiness-interface', READINESS_SCRIPT, ['--help'])],
    'training-handoff': [one('handoff-boundary', scriptPath, ['contract-check'])],
    'smoke-complete': [one('completion-contract', scriptPath, ['contract-check'])],
  };
  return map[state] ?? [];
}

function runSmoke(runtime) {
  if (runtime.state.currentState === 'smoke-complete') {
    console.log('SafeRide v0.5 mechanical smoke: PASS (unchanged completed run).');
    return 0;
  }
  const targetStates = [...PRODUCTION_STATES.slice(1), 'smoke-complete'];
  let previousPath = runtime.state.transitions.length
    ? evidencePath(runtime.root, runtime.state.transitions.at(-1).outputs[0])
    : path.join(runtime.root, '.saferide-v05-smoke.json');
  for (const target of targetStates.slice(targetStates.indexOf(runtime.state.currentState) + 1)) {
    for (const command of smokeCommandsForState(target)) {
      const result = executeNodeCommand(runtime, {
        commandId: `smoke-${target}-${command.name}`, stage: target,
        implementation: command.implementation, args: command.args,
        inputs: command.inputs, outputs: [],
      });
      if (!result.passed) return block(runtime, ['MECHANICAL_SMOKE_INTERFACE_FAILED']);
    }
    const sequence = runtime.state.transitions.length + 1;
    const artifact = smokeArtifact(target, sequence, runtime.state.sourceCommit, fileSha256(previousPath));
    const errors = schemaErrors('pipelineSmokeArtifact', runtime.schemas.pipelineSmokeArtifact, artifact);
    if (errors.length) throw new Error(`Smoke artifact contract failed (${errors.length} findings)`);
    const relative = `smoke/${String(sequence).padStart(2, '0')}-${target}.json`;
    const output = artifactPath(runtime.root, relative);
    writeJsonArtifact(runtime.root, relative, artifact);
    transition(
      runtime,
      target,
      [{ filePath: previousPath, classification: 'smoke-only' }],
      [{ filePath: output, classification: 'smoke-only' }],
      'mechanical-smoke-only',
    );
    previousPath = output;
  }
  runtime.state.status = 'complete';
  runtime.state.blockers = [];
  saveRuntime(runtime);
  console.log(`SafeRide v0.5 mechanical smoke: PASS (${runtime.state.transitions.length} non-production transitions).`);
  return 0;
}

function verifiedRuntime(root, schemas) {
  const smoke = fs.existsSync(path.join(root, '.saferide-v05-smoke.json'));
  const runtime = smoke
    ? loadSmokeRuntime(root, true, schemas)
    : loadProductionRuntime(root, true, schemas, { activate: false });
  const permissionFailures = inspectArtifactPermissions(root);
  if (permissionFailures.length) throw new Error(`Artifact permission verification failed (${permissionFailures.length} findings)`);
  return runtime;
}

function contractCheck(schemas) {
  const requiredScripts = [SCENARIO_SCRIPT, BUILD_SCRIPT, GENERATOR_SCRIPT, SCREEN_SCRIPT, REVIEW_SCRIPT, SEMANTIC_SCRIPT, AUDIT_SCRIPT, BLIND_SCRIPT, REGISTER_SCRIPT, READINESS_SCRIPT];
  if (requiredScripts.some(filePath => !fs.existsSync(filePath))) throw new Error('A required pipeline implementation is unavailable');
  for (let index = 0; index < PRODUCTION_STATES.length - 1; index += 1) {
    if (!allowedTransition(PRODUCTION_STATES[index], PRODUCTION_STATES[index + 1], 'production')) throw new Error('Production state order is invalid');
  }
  if (!schemas.pipelineConfig || !schemas.pipelineState || !schemas.pipelineCommandLedger
    || !schemas.pipelineRunManifest || !schemas.pipelineSmokeArtifact || !schemas.registerEvidenceConfig
    || !schemas.byteReproducibility) {
    throw new Error('Pipeline schemas did not compile');
  }
  console.log('SafeRide v0.5 production-pipeline contracts PASS.');
  console.log('Mechanical smoke evidence is permanently non-production; external approvals and controlled artifacts remain fail-closed.');
  return 0;
}

function main() {
  enforcePrivateUmask();
  const args = parseArgs(process.argv.slice(2));
  const schemas = compileV05Schemas();
  if (args.command === 'contract-check') return contractCheck(schemas);
  if (!path.isAbsolute(args.artifactRoot)) throw new Error('--artifact-root must be an explicit absolute path');

  if (args.command === 'init') {
    const root = secureArtifactRoot(args.artifactRoot, { create: true });
    if (fs.readdirSync(root).length) throw new Error('A new production run requires an empty artifact root');
    const config = initializeProductionRoot(root, args.runId, schemas);
    if (inspectArtifactPermissions(root).length) throw new Error('Production artifact permissions are invalid after initialization');
    console.log(`SafeRide v0.5 production pipeline initialized (${config.runId}); external artifact content was not logged.`);
    return 0;
  }
  if (args.command === 'run') {
    const root = secureArtifactRoot(args.artifactRoot, { create: false });
    const result = runProduction(loadProductionRuntime(root, args.resume, schemas));
    if (inspectArtifactPermissions(root).length) throw new Error('Production artifact permissions are invalid');
    return result;
  }
  if (args.command === 'smoke') {
    const exists = fs.existsSync(args.artifactRoot);
    const root = smokeRoot(args.artifactRoot, true);
    const runtime = exists && fs.existsSync(path.join(root, '.saferide-v05-smoke.json'))
      ? loadSmokeRuntime(root, args.resume, schemas)
      : initializeSmokeRuntime(root, schemas);
    const result = runSmoke(runtime);
    if (inspectArtifactPermissions(root).length) throw new Error('Smoke artifact permissions are invalid');
    return result;
  }
  if (args.command === 'verify' || args.command === 'status') {
    const root = fs.existsSync(path.join(args.artifactRoot, '.saferide-v05-smoke.json'))
      ? smokeRoot(args.artifactRoot, false)
      : secureArtifactRoot(args.artifactRoot, { create: false });
    const runtime = verifiedRuntime(root, schemas);
    if (args.command === 'status') {
      console.log(`SafeRide v0.5 pipeline status: ${runtime.state.status}; state=${runtime.state.currentState}; mode=${runtime.state.mode}; transitions=${runtime.state.transitions.length}; commands=${runtime.ledger.length}.`);
      if (runtime.state.blockers.length) console.log(`Blockers: ${runtime.state.blockers.join(', ')}`);
    } else console.log(`SafeRide v0.5 pipeline verification PASS (${runtime.state.mode}; ${runtime.state.transitions.length} transitions; no artifact content logged).`);
    return 0;
  }
  throw new Error(`Unknown command: ${args.command}\n\n${usage()}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
