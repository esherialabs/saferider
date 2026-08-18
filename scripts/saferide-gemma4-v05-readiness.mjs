#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_PLAN_PATH,
  REPO_ROOT,
  canonicalSha256,
  compileV05Schemas,
  fileSha256,
  readJson,
  readJsonl,
  schemaErrors,
  sha256,
  stableJson,
  validateBlindEvaluation,
  validatePlanSemantics,
} from './lib/saferide-gemma4-v05.mjs';
import { validateSemanticLeakageArtifacts } from './saferide-gemma4-v05-semantic-check.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultRegister = path.join(
  repoRoot,
  'docs/security/saferide-gemma4-colab-input-register.synthetic-v0.5.candidate.json',
);
const EXPECTED_GATES = new Set([
  'policy', 'system-prompt', 'scenario-matrix', 'reviewer-roster', 'row-reviews',
  'kiswahili-language', 'legal-derivative-use', 'clinical', 'privacy',
  'safeguarding', 'independent-ml-data', 'holdout-custody', 'semantic-leakage',
  'prohibited-data', 'organization-storage', 'unicef-workbook', 'gpu-colab',
]);
const EXPECTED_CLASSIFICATIONS = Object.freeze({
  scenarioSpecs: 'controlled',
  splitManifest: 'controlled',
  candidates: 'restricted',
  reviewLedger: 'restricted',
  reviewSummary: 'restricted',
  datasetManifest: 'public-safe',
  pilotSelection: 'controlled',
  train: 'controlled',
  dev: 'controlled',
  qualityHoldout: 'restricted',
  safetyHoldout: 'restricted',
  semanticLeakageReport: 'public-safe',
  semanticLeakageDetails: 'restricted',
  auditReport: 'public-safe',
  auditDetails: 'restricted',
  blindEvaluation: 'restricted',
});

function usage() {
  return [
    'Usage: node scripts/saferide-gemma4-v05-readiness.mjs [--register <json>] [--strict|--training-strict]',
    '       [--artifact-root <dir>] [--train-data <jsonl>] [--dev-data <jsonl>]',
    '',
    'Full strict mode is for the data/evaluation custodian. Training-strict never opens restricted artifacts.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { register: defaultRegister, strict: false, trainingStrict: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--register') args.register = argv[++index];
    else if (argument === '--strict') args.strict = true;
    else if (argument === '--training-strict') args.trainingStrict = true;
    else if (argument === '--artifact-root') args.artifactRoot = argv[++index];
    else if (argument === '--train-data') args.trainData = argv[++index];
    else if (argument === '--dev-data') args.devData = argv[++index];
    else if (['--help', '-h'].includes(argument)) {
      console.log(usage());
      process.exit(0);
    } else throw new Error(`Unknown or incomplete argument: ${argument}\n\n${usage()}`);
  }
  if (args.strict && args.trainingStrict) throw new Error('--strict and --training-strict are mutually exclusive');
  return args;
}

function resolve(input) {
  return path.isAbsolute(input) ? input : path.join(repoRoot, input);
}

function verifyRepositoryBinding(binding, label, errors, strict) {
  if (!binding?.path) {
    errors.push(`${label} path is missing`);
    return;
  }
  const fullPath = resolve(binding.path);
  const relative = path.relative(repoRoot, fullPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    errors.push(`${label} path must be inside the repository`);
    return;
  }
  if (!fs.existsSync(fullPath)) {
    errors.push(`${label} path is missing`);
    return;
  }
  if (binding.sha256 === null) {
    if (strict) errors.push(`${label} SHA-256 is missing`);
  } else if (binding.sha256 !== fileSha256(fullPath)) errors.push(`${label} SHA-256 is stale`);
}

function preparationErrors(register, plan, schemas) {
  const errors = [
    ...schemaErrors('register', schemas.register, register),
    ...schemaErrors('plan', schemas.plan, plan),
    ...validatePlanSemantics(plan),
  ];
  const gateIds = (register.gates ?? []).map(gate => gate.gateId);
  if (new Set(gateIds).size !== gateIds.length) errors.push('register gate IDs must be unique');
  if (gateIds.length !== EXPECTED_GATES.size || [...EXPECTED_GATES].some(id => !gateIds.includes(id))) {
    errors.push('register must represent every required human and technical gate exactly once');
  }
  for (const [name, expected] of Object.entries(EXPECTED_CLASSIFICATIONS)) {
    if (register.artifacts?.[name]?.classification !== expected) errors.push(`${name} must be classified ${expected}`);
  }
  if (register.holdoutControls?.trainingAccessAllowed !== false
    || register.holdoutControls?.routinePromptIterationAllowed !== false
    || register.holdoutControls?.blindSuiteTrainingAccessAllowed !== false) {
    errors.push('holdout and blind-suite controls must fail closed');
  }
  return errors;
}

function strictErrors(register, args, schemas) {
  const errors = [];
  const trainingOnly = args.trainingStrict === true;
  if (register.packageLockSha256 !== fileSha256(path.join(repoRoot, 'package-lock.json'))) errors.push('package-lock SHA-256 differs from the register');
  if (register.status !== 'training-ready') errors.push('register.status must be training-ready');
  if (register.trainingReadiness?.status !== 'training-ready' || register.trainingReadiness?.strictGatePassed !== true) {
    errors.push('trainingReadiness must be training-ready with strictGatePassed=true');
  }
  if ((register.trainingReadiness?.blockers ?? []).length) errors.push('trainingReadiness.blockers must be empty');
  if (!register.model?.immutableBaseRevision) errors.push('immutable base-model revision is missing');
  for (const gate of register.gates ?? []) {
    if (!['approved', 'passed'].includes(gate.status) || !gate.evidenceRef) {
      errors.push(`gate ${gate.gateId} lacks a passing status and attributable evidence reference`);
    }
  }
  for (const [name, artifact] of Object.entries(register.artifacts ?? {})) {
    if (!['frozen', 'passed'].includes(artifact.status) || !artifact.path || !artifact.sha256 || !Number.isInteger(artifact.sizeBytes)) {
      errors.push(`artifact ${name} lacks frozen/passed path, SHA-256, or size evidence`);
    }
    if (!Number.isInteger(artifact.recordCount) || !artifact.schema || !Number.isInteger(artifact.schemaVersion)
      || !Array.isArray(artifact.upstreamSha256)) {
      errors.push(`artifact ${name} lacks record count, schema version, or upstream hash evidence`);
    }
  }
  if (register.bindings?.policy?.status !== 'approved' || !register.bindings.policy.approvalEvidenceRef) errors.push('policy binding is not approved');
  if (register.bindings?.systemPrompt?.status !== 'approved' || !register.bindings.systemPrompt.approvalEvidenceRef) errors.push('system-prompt binding is not approved');
  const policy = readJson(resolve(register.bindings.policy.path));
  const prompt = readJson(resolve(register.bindings.systemPrompt.path));
  if (policy.status !== 'approved' || !policy.effectiveDate) errors.push('bound policy file is not approved and effective');
  if (prompt.status !== 'approved' || sha256(prompt.text ?? '') !== register.bindings.systemPrompt.textSha256) errors.push('bound system prompt is not approved or text hash is stale');
  const policyApprovals = new Map((policy.approvals ?? []).map(approval => [approval.role, approval]));
  for (const role of ['product-safeguarding', 'technical-ml', 'privacy', 'legal', 'kiswahili']) {
    const approval = policyApprovals.get(role);
    if (approval?.status !== 'approved' || !approval.reviewerIdentity || !approval.reviewedAt || !approval.artifactRef) {
      errors.push(`bound policy lacks attributable approved ${role} evidence`);
    }
  }
  const promptApprovals = new Map((prompt.approvals ?? []).map(approval => [approval.role, approval]));
  for (const role of ['product-safeguarding', 'legal', 'privacy']) {
    const approval = promptApprovals.get(role);
    if (approval?.status !== 'approved' || !approval.evidenceRef) errors.push(`bound system prompt lacks attributable approved ${role} evidence`);
  }
  if (!register.holdoutControls?.custodianIdentityRef
    || !register.holdoutControls?.segregatedAccessEvidenceRef
    || !register.holdoutControls?.accessLogEvidenceRef) {
    errors.push('protected holdout custody and access evidence are incomplete');
  }
  if (register.publication?.trainPublicationStatus === 'approved' && !register.publication.approvalEvidenceRef) {
    errors.push('training-split publication cannot be approved without evidence');
  }
  if (!args.artifactRoot) {
    errors.push(trainingOnly
      ? 'training-only strict gate requires --artifact-root for public-safe and permitted controlled artifacts'
      : 'custodian full strict gate requires --artifact-root for every controlled and restricted artifact');
    return errors;
  }
  const artifactRoot = resolve(args.artifactRoot);
  if (!fs.existsSync(artifactRoot) || !fs.statSync(artifactRoot).isDirectory()) {
    errors.push('artifact root is unavailable or is not a directory');
    return errors;
  }
  if (fs.existsSync(path.join(artifactRoot, '.saferide-v05-smoke.json'))) {
    errors.push('mechanical smoke roots can never satisfy production strict readiness');
    return errors;
  }
  const artifactRootRelative = path.relative(REPO_ROOT, artifactRoot);
  if (!artifactRootRelative.startsWith('..') && !path.isAbsolute(artifactRootRelative)) {
    errors.push('strict artifact root must be outside the public repository checkout');
    return errors;
  }
  const artifactFiles = new Map();
  const artifactPaths = new Set();
  for (const [name, artifact] of Object.entries(register.artifacts ?? {})) {
    if (trainingOnly && artifact.classification === 'restricted') continue;
    if (!artifact?.path) continue;
    const file = path.resolve(artifactRoot, artifact.path);
    const relative = path.relative(artifactRoot, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      errors.push(`artifact ${name} path escapes the artifact root`);
      continue;
    }
    if (artifactPaths.has(relative)) errors.push(`artifact ${name} reuses another artifact path`);
    artifactPaths.add(relative);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      errors.push(`artifact ${name} is unavailable under artifact root`);
      continue;
    }
    if (fileSha256(file) !== artifact.sha256 || fs.statSync(file).size !== artifact.sizeBytes) {
      errors.push(`artifact ${name} hash or size does not match register`);
      continue;
    }
    artifactFiles.set(name, file);
  }

  const datasetManifestPath = artifactFiles.get('datasetManifest');
  const datasetManifest = datasetManifestPath ? readJson(datasetManifestPath) : null;
  if (datasetManifest) {
    errors.push(...schemaErrors('datasetManifest', schemas.datasetManifest, datasetManifest));
    const expectedBindings = {
      planSha256: register.bindings.plan.sha256,
      scenarioSpecSha256: register.artifacts.scenarioSpecs.sha256,
      splitManifestSha256: register.artifacts.splitManifest.sha256,
      candidateFileSha256: register.artifacts.candidates.sha256,
      reviewLedgerSha256: register.artifacts.reviewLedger.sha256,
      systemPromptConfigSha256: register.bindings.systemPrompt.sha256,
      systemPromptTextSha256: register.bindings.systemPrompt.textSha256,
      policySha256: register.bindings.policy.sha256,
    };
    for (const [field, expected] of Object.entries(expectedBindings)) {
      if (datasetManifest.bindings?.[field] !== expected) errors.push(`dataset manifest ${field} differs from the register`);
    }
    if (datasetManifest.buildImplementation?.sha256 !== register.bindings.buildImplementation.sha256) errors.push('dataset manifest build-implementation hash is stale');
    if (datasetManifest.datasetInventorySha256 !== sha256(stableJson(datasetManifest.files ?? []))) errors.push('dataset manifest file inventory hash is stale');
    const splitArtifacts = { train: 'train', dev: 'dev', 'quality-holdout': 'qualityHoldout', 'safety-holdout': 'safetyHoldout' };
    for (const [split, artifactName] of Object.entries(splitArtifacts)) {
      const entry = (datasetManifest.files ?? []).find(file => file.split === split);
      const artifact = register.artifacts[artifactName];
      if (!entry || entry.sha256 !== artifact.sha256 || entry.sizeBytes !== artifact.sizeBytes || entry.classification !== artifact.classification) {
        errors.push(`dataset manifest ${split} inventory differs from the register`);
      }
    }
    const pilot = register.artifacts.pilotSelection;
    if (datasetManifest.pilotSelection?.sha256 !== pilot.sha256
      || datasetManifest.pilotSelection?.sizeBytes !== pilot.sizeBytes
      || datasetManifest.pilotSelection?.rowCount !== 320) {
      errors.push('dataset manifest pilot selection differs from the register');
    }
  }

  const reviewSummaryPath = artifactFiles.get('reviewSummary');
  const reviewSummary = reviewSummaryPath ? readJson(reviewSummaryPath) : null;
  if (reviewSummary) {
    errors.push(...schemaErrors('reviewSummary', schemas.reviewSummary, reviewSummary));
    const assessed = (reviewSummary.languageAssessment?.agreed ?? 0)
      + (reviewSummary.languageAssessment?.adjudicatedMismatch ?? 0)
      + (reviewSummary.languageAssessment?.adjudicatedUndetermined ?? 0);
    if (reviewSummary.passed !== true || reviewSummary.finalRowCount !== 2600
      || reviewSummary.primaryReviewCount !== 2600 || reviewSummary.safetyDomainReviewCount < 2600
      || reviewSummary.specialistDomainReviewCount < 1820
      || assessed !== 2600 || reviewSummary.languageAssessment?.blocked !== 0) {
      errors.push('review summary lacks complete passing row, safety, specialist, or language coverage');
    }
    if (reviewSummary.selectionInventorySha256 !== sha256(stableJson(reviewSummary.selections ?? []))) errors.push('review summary selection inventory hash is stale');
    if (reviewSummary.implementation?.sha256 !== register.bindings.reviewImplementation.sha256) errors.push('review summary implementation hash is stale');
  }

  const pilotPath = artifactFiles.get('pilotSelection');
  if (pilotPath) {
    const pilot = readJson(pilotPath);
    errors.push(...schemaErrors('pilotManifest', schemas.pilotManifest, pilot));
    if (pilot.rowIdInventorySha256 !== sha256((pilot.rowIds ?? []).join('\n'))) errors.push('pilot row inventory hash is stale');
    const trainPath = artifactFiles.get('train');
    if (trainPath) {
      const trainIds = new Set(readJsonl(trainPath).map(row => row.id));
      if ((pilot.rowIds ?? []).some(rowId => !trainIds.has(rowId))) errors.push('pilot selection contains a row outside the training artifact');
    }
  }

  const semanticPath = artifactFiles.get('semanticLeakageReport');
  const semantic = semanticPath ? readJson(semanticPath) : null;
  if (semantic) {
    errors.push(...schemaErrors('semanticReport', schemas.semanticReport, semantic));
    if (semantic.status !== 'passed' || semantic.unresolvedPairCount !== 0 || semantic.review?.status !== 'approved') {
      errors.push('semantic leakage report is not independently approved with zero unresolved pairs');
    }
    if (datasetManifestPath && semantic.datasetArtifactManifestSha256 !== fileSha256(datasetManifestPath)) errors.push('semantic report dataset-manifest hash is stale');
    if (semantic.splitManifestSha256 !== register.artifacts.splitManifest.sha256) errors.push('semantic report split-manifest hash is stale');
    if (semantic.restrictedDetails?.sha256 !== register.artifacts.semanticLeakageDetails.sha256) errors.push('semantic restricted-detail hash differs from the register');
  }
  const semanticDetailsPath = artifactFiles.get('semanticLeakageDetails');
  const semanticSplitManifestPath = artifactFiles.get('splitManifest');
  if (semantic && semanticDetailsPath && semanticSplitManifestPath && datasetManifestPath) {
    errors.push(...validateSemanticLeakageArtifacts({
      report: semantic,
      details: readJson(semanticDetailsPath),
      splitManifest: readJson(semanticSplitManifestPath),
      datasetManifestSha256: fileSha256(datasetManifestPath),
      splitManifestSha256: fileSha256(semanticSplitManifestPath),
      detailsSha256: fileSha256(semanticDetailsPath),
      schemas,
    }));
  }

  const auditPath = artifactFiles.get('auditReport');
  const audit = auditPath ? readJson(auditPath) : null;
  if (audit) {
    errors.push(...schemaErrors('audit', schemas.audit, audit));
    if (audit.passed !== true || audit.failures?.length !== 0) errors.push('dataset audit is not passed without findings');
    if (audit.counts?.rows !== 2600 || audit.counts?.families !== 1300) errors.push('dataset audit has incorrect fixed counts');
    const expectedAuditBindings = {
      planSha256: register.bindings.plan.sha256,
      scenarioSpecSha256: register.artifacts.scenarioSpecs.sha256,
      splitManifestSha256: register.artifacts.splitManifest.sha256,
      datasetManifestSha256: register.artifacts.datasetManifest.sha256,
      reviewSummarySha256: register.artifacts.reviewSummary.sha256,
      semanticReportSha256: register.artifacts.semanticLeakageReport.sha256,
      policySha256: register.bindings.policy.sha256,
      systemPromptTextSha256: register.bindings.systemPrompt.textSha256,
    };
    for (const [field, expected] of Object.entries(expectedAuditBindings)) {
      if (audit.bindings?.[field] !== expected) errors.push(`dataset audit ${field} differs from the register`);
    }
    if (audit.implementation?.sha256 !== register.bindings.auditImplementation.sha256) errors.push('dataset audit implementation hash is stale');
  }
  const auditDetailsPath = artifactFiles.get('auditDetails');
  if (auditDetailsPath) {
    const details = readJson(auditDetailsPath);
    errors.push(...schemaErrors('auditDetails', schemas.auditDetails, details));
    if (audit?.restrictedDetails?.findingInventorySha256 !== details.findingInventorySha256) errors.push('audit restricted-detail inventory is stale');
    if (details.findingInventorySha256 !== canonicalSha256(details.findings)) errors.push('audit restricted-detail findings hash is stale');
  }

  const splitManifestPath = artifactFiles.get('splitManifest');
  const blindPath = artifactFiles.get('blindEvaluation');
  if (splitManifestPath && blindPath) {
    const corpusArtifactNames = ['train', 'dev', 'qualityHoldout', 'safetyHoldout'];
    const corpusRows = corpusArtifactNames.flatMap(name => {
      const file = artifactFiles.get(name);
      return file ? readJsonl(file) : [];
    });
    const blind = validateBlindEvaluation(
      readJsonl(blindPath),
      readJson(splitManifestPath),
      readJson(resolve(register.bindings.plan.path)),
      { schemas, corpusRows },
    );
    if (blind.errors.length) errors.push(`restricted blind evaluation has ${blind.errors.length} structural, quota, privacy, language, or isolation findings`);
  }

  for (const [argument, artifactName] of [['trainData', 'train'], ['devData', 'dev']]) {
    if (!args[argument]) {
      errors.push(`strict training gate requires --${argument === 'trainData' ? 'train-data' : 'dev-data'}`);
      continue;
    }
    const file = resolve(args[argument]);
    const artifact = register.artifacts[artifactName];
    if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fileSha256(file) !== artifact.sha256 || fs.statSync(file).size !== artifact.sizeBytes) {
      errors.push(`${artifactName} training input hash or size does not match register`);
    }
  }
  return errors;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const schemas = compileV05Schemas();
  const registerPath = resolve(args.register);
  const register = readJson(registerPath);
  const plan = readJson(resolve(register.bindings?.plan?.path ?? DEFAULT_PLAN_PATH));
  const errors = preparationErrors(register, plan, schemas);
  for (const [name, binding] of Object.entries(register.bindings ?? {})) {
    verifyRepositoryBinding(binding, `bindings.${name}`, errors, args.strict || args.trainingStrict);
  }
  if (args.strict || args.trainingStrict) errors.push(...strictErrors(register, args, schemas));

  console.log('SafeRide Gemma 4 v0.5 readiness gate');
  console.log(`Mode: ${args.trainingStrict ? 'training-only strict input pack' : args.strict ? 'custodian full strict freeze' : 'preparation/template'}`);
  console.log(`Register status: ${register.status}`);
  if (errors.length) {
    errors.forEach(error => console.error(`- ${error}`));
    return 1;
  }
  if (!args.strict && !args.trainingStrict) {
    if (register.status !== 'blocked' || register.trainingReadiness?.strictGatePassed !== false || !(register.trainingReadiness?.blockers?.length > 0)) {
      console.error('- preparation register must truthfully remain blocked until genuine evidence is supplied');
      return 1;
    }
    console.log(`PASS (contract valid; ${register.trainingReadiness.blockers.length} truthful blocker groups remain).`);
    return 0;
  }
  console.log(args.trainingStrict
    ? 'PASS (training-only strict gate; restricted holdout/blind/candidate/review bytes were not opened).'
    : 'PASS (custodian full strict freeze/readiness gate; no training, promotion, or release claim).');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
