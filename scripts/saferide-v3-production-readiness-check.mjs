#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  summarizeStructuredEvidence,
  validateStructuredEvidenceRepository,
} from './lib/saferide-structured-evidence.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const currentRegisterPath = 'docs/security/saferide-gemma4-colab-input-register.synthetic-v0.4.candidate.json';
const currentDataPath = 'data/ai/gemma4/saferide-synthetic-guidance-v0.4.jsonl';
const currentAuditPath = 'docs/security/saferide-gemma4-v04-dataset-audit.json';

const goals = {
  'production-finetuning': 'Production fine-tuning',
  'unicef-readiness': 'UNICEF/readiness claims',
  'tuned-mobile-release': 'Tuned mobile release',
  'survivor-data-training': 'Survivor-data training',
};

function usage() {
  return [
    'Usage: node scripts/saferide-v3-production-readiness-check.mjs [--goal <name>|all] [--json] [--allow-blocked] [--as-of YYYY-MM-DD]',
    '',
    'Goals:',
    ...Object.keys(goals).map(goal => `  - ${goal}`),
    '',
    'Structured evidence errors always fail. --allow-blocked only permits truthful readiness blockers for reporting.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { goal: 'all', json: false, allowBlocked: false, asOfDate: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      console.log(usage());
      process.exit(0);
    } else if (argument === '--json') {
      args.json = true;
    } else if (argument === '--allow-blocked') {
      args.allowBlocked = true;
    } else if (argument === '--goal') {
      args.goal = argv[index + 1];
      index += 1;
    } else if (argument === '--as-of') {
      args.asOfDate = argv[index + 1];
      index += 1;
    } else if (!argument.startsWith('-') && goals[argument] && args.goal === 'all') {
      args.goal = argument;
    } else {
      throw new Error(`Unknown argument: ${argument}\n\n${usage()}`);
    }
  }
  if (args.goal !== 'all' && !goals[args.goal]) throw new Error(`Unknown goal: ${args.goal}\n\n${usage()}`);
  if (args.asOfDate && !/^\d{4}-\d{2}-\d{2}$/.test(args.asOfDate)) throw new Error('--as-of must use YYYY-MM-DD');
  return args;
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), 'utf8'));
}

function runStrictDataGate() {
  const result = spawnSync(process.execPath, [
    path.join(rootDir, 'scripts/saferide-gemma4-finetune-data-check.mjs'),
    '--register',
    path.join(rootDir, currentRegisterPath),
    '--data',
    path.join(rootDir, currentDataPath),
    '--audit',
    path.join(rootDir, currentAuditPath),
    '--for-finetuning',
  ], { cwd: rootDir, encoding: 'utf8', windowsHide: true });
  return { passed: result.status === 0, status: result.status };
}

function addIf(condition, blockers, message) {
  if (condition) blockers.push(message);
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function evidenceByClaim(documents, claimId) {
  return documents.claimRegister.claims.find(claim => claim.claimId === claimId);
}

function evaluateProductionFineTuning({ register, strictDataGate, structured }) {
  const blockers = [];
  const sources = Array.isArray(register.sources) ? register.sources : [];
  const approvals = Object.entries(register.legalApproval ?? {})
    .filter(([key]) => key !== 'reference')
    .map(([, value]) => value);
  addIf(!structured.ok, blockers, 'structured evidence validation failed');
  addIf(!/v0\.4/i.test(register.registerId ?? ''), blockers, 'the registered dataset is not the corrected v0.4 pipeline');
  addIf(register.status !== 'approved-production', blockers, `register.status is ${register.status}; production requires approved-production`);
  addIf(approvals.some(value => value !== 'approved'), blockers, 'not all legal approval fields are approved');
  addIf(register.runtimeGate?.baseRuntimeProof !== 'passed', blockers, `runtimeGate.baseRuntimeProof is ${register.runtimeGate?.baseRuntimeProof}; production requires passed`);
  addIf(!strictDataGate.passed, blockers, 'strict structural data gate did not pass');
  addIf(sources.length === 0, blockers, 'register has no sources');
  for (const source of sources) {
    addIf(source.status !== 'approved-production', blockers, `${source.datasetId} is not approved-production`);
    addIf(source.reviewerSignoff?.status !== 'approved', blockers, `${source.datasetId} reviewer signoff is not approved`);
    addIf(source.privacyClass === 'sensitive-internal' || source.privacyClass === 'prohibited', blockers, `${source.datasetId} privacy class is not eligible without explicit governance`);
  }
  return { ready: blockers.length === 0, blockers };
}

function evaluateUnicefReadiness({ structured }) {
  const blockers = [];
  const { baseManifest, safetySummary, tunedManifest, tunedControls, tunedDeviceEvidence } = structured.documents;
  const checkpointClaim = evidenceByClaim(structured.documents, 'UNICEF-CHECKPOINT-001');
  addIf(!structured.ok, blockers, 'structured evidence validation failed');
  addIf(checkpointClaim?.status !== 'checkpoint-candidate', blockers, `checkpoint claim status is ${checkpointClaim?.status ?? 'missing'}`);
  addIf(baseManifest.license.legalStatus !== 'approved', blockers, `base runtime legal status is ${baseManifest.license.legalStatus}`);
  addIf(safetySummary.decision !== 'checkpoint-candidate', blockers, `adapter safety decision is ${safetySummary.decision}`);
  addIf(safetySummary.counts.criticalFailures !== 0, blockers, `critical safety failures are ${safetySummary.counts.criticalFailures}`);
  addIf(safetySummary.counts.completedResponses !== safetySummary.counts.requiredPrompts, blockers, `only ${safetySummary.counts.completedResponses}/${safetySummary.counts.requiredPrompts} responses are complete`);
  addIf(safetySummary.review.independentReviewerCount < 2, blockers, `only ${safetySummary.review.independentReviewerCount} independent reviewer is evidenced`);
  addIf(tunedManifest.status !== 'release-ready', blockers, `tuned mobile artifact status is ${tunedManifest.status}; release-ready is required`);
  addIf(!tunedManifest.androidProof.tunedArtifactPhysicalDeviceProof, blockers, 'tuned mobile physical Android proof is false');
  addIf(!tunedControls.activation.enabled, blockers, `tuned activation is disabled: ${tunedControls.activation.reasonCode}`);
  addIf(tunedDeviceEvidence.status !== 'approved', blockers, `tuned device evidence is ${tunedDeviceEvidence.status}`);
  addIf(baseManifest.rollout.downloadMode !== 'disabled' && baseManifest.status === 'revoked', blockers, 'revoked runtime is not disabled');
  return { ready: blockers.length === 0, blockers };
}

function evaluateTunedMobileRelease({ structured }) {
  const blockers = [];
  const { tunedManifest, safetySummary, tunedControls, tunedDeviceEvidence } = structured.documents;
  const claim = evidenceByClaim(structured.documents, 'AI-TUNED-MOBILE-001');
  addIf(!structured.ok, blockers, 'structured evidence validation failed');
  addIf(tunedManifest.status !== 'release-ready', blockers, `tuned manifest status is ${tunedManifest.status}; release-ready is required`);
  addIf(!tunedManifest.artifact.sha256, blockers, 'tuned artifact SHA-256 is missing');
  addIf(!tunedManifest.artifact.sizeBytes, blockers, 'tuned artifact byte size is missing');
  addIf(!tunedManifest.androidProof.tunedArtifactPhysicalDeviceProof, blockers, 'tuned artifact physical Android proof is false');
  addIf(tunedManifest.attestation.status !== 'approved', blockers, `tuned artifact attestation is ${tunedManifest.attestation.status}`);
  addIf(!tunedControls.activation.enabled, blockers, `tuned activation is disabled: ${tunedControls.activation.reasonCode}`);
  addIf(tunedControls.activation.rolloutPercent <= 0, blockers, 'tuned rollout percent is zero');
  addIf(tunedDeviceEvidence.status !== 'approved', blockers, `tuned device evidence is ${tunedDeviceEvidence.status}`);
  addIf(safetySummary.artifactClass !== 'tuned-mobile-artifact', blockers, `safety summary covers ${safetySummary.artifactClass}, not the tuned mobile artifact`);
  addIf(safetySummary.decision !== 'release-candidate', blockers, `safety summary decision is ${safetySummary.decision}`);
  addIf(claim?.status !== 'checkpoint-candidate', blockers, `tuned mobile claim status is ${claim?.status ?? 'missing'}`);
  return { ready: blockers.length === 0, blockers };
}

function evaluateSurvivorDataTraining({ register, structured }) {
  const blockers = [];
  const sources = Array.isArray(register.sources) ? register.sources : [];
  const survivorSources = sources.filter(source => source.sourceType !== 'synthetic');
  addIf(!structured.ok, blockers, 'structured evidence validation failed');
  addIf(register.status !== 'approved-production', blockers, `register.status is ${register.status}; survivor-data training requires approved-production`);
  addIf(survivorSources.length === 0, blockers, 'no non-synthetic source is approved for training');
  for (const source of survivorSources) {
    const screen = source.prohibitedDataScreen ?? {};
    addIf(source.status !== 'approved-production', blockers, `${source.datasetId} is not approved-production`);
    addIf(source.reviewerSignoff?.status !== 'approved', blockers, `${source.datasetId} reviewer signoff is not approved`);
    addIf(!hasText(source.consentBasis) || source.consentBasis === 'synthetic', blockers, `${source.datasetId} has no survivor-data consent basis`);
    addIf(!hasText(source.deidentificationMethod) || /not applicable/i.test(source.deidentificationMethod), blockers, `${source.datasetId} has no approved de-identification method`);
    addIf(Object.values(screen).some(Boolean), blockers, `${source.datasetId} prohibited-data screen is not clean`);
  }
  return { ready: blockers.length === 0, blockers };
}

function buildReport(args) {
  const structured = validateStructuredEvidenceRepository({ rootDir, asOfDate: args.asOfDate });
  const register = readJson(currentRegisterPath);
  const audit = readJson(currentAuditPath);
  const strictDataGate = runStrictDataGate();
  const requestedGoals = args.goal === 'all' ? Object.keys(goals) : [args.goal];
  const context = { structured, register, strictDataGate };
  const checks = {
    'production-finetuning': evaluateProductionFineTuning(context),
    'unicef-readiness': evaluateUnicefReadiness(context),
    'tuned-mobile-release': evaluateTunedMobileRelease(context),
    'survivor-data-training': evaluateSurvivorDataTraining(context),
  };
  return {
    schema: 'com.saferide.program-readiness-report',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    asOfDate: structured.asOfDate,
    structuredEvidence: {
      ...summarizeStructuredEvidence(structured),
      errors: structured.errors,
    },
    data: {
      registerId: register.registerId,
      registerStatus: register.status,
      strictV04TrainingGatePassed: strictDataGate.passed,
      correctedV04RegisterPresent: /v0\.4/i.test(register.registerId ?? ''),
      auditPassed: audit.passed === true,
      policyStatus: register.policyBinding?.status ?? 'missing',
    },
    goals: Object.fromEntries(requestedGoals.map(goal => [goal, checks[goal]])),
  };
}

function printTextReport(report) {
  console.log('SafeRide structured program readiness gate');
  console.log('');
  console.log(`Structured evidence: ${report.structuredEvidence.valid ? 'PASS' : 'INVALID'}`);
  console.log(`Base runtime: ${report.structuredEvidence.baseRuntime.status}; ${report.structuredEvidence.baseRuntime.downloadMode}`);
  console.log(`Adapter safety: ${report.structuredEvidence.adapter.decision}; ${report.structuredEvidence.adapter.completedResponses}/${report.structuredEvidence.adapter.requiredPrompts} complete`);
  console.log(`Tuned mobile artifact: ${report.structuredEvidence.tunedMobileArtifact.status}`);
  console.log(`Dataset: ${report.data.registerId} (${report.data.registerStatus})`);
  console.log('');
  for (const [goal, result] of Object.entries(report.goals)) {
    console.log(`${goals[goal]}: ${result.ready ? 'READY' : 'BLOCKED'}`);
    for (const blocker of result.blockers) console.log(`- ${blocker}`);
    console.log('');
  }
}

try {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReport(args);
  const blocked = Object.values(report.goals).some(result => !result.ready);
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printTextReport(report);
  if (!report.structuredEvidence.valid || (blocked && !args.allowBlocked)) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
