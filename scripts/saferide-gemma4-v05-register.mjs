#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  DATASET_ID,
  REPO_ROOT,
  compileV05Schemas,
  fileSha256,
  readJson,
  readJsonl,
  schemaErrors,
  sha256,
} from './lib/saferide-gemma4-v05.mjs';
import { validatePolicyAndPrompt } from './saferide-gemma4-v05-build.mjs';
import {
  artifactPath,
  assertPrivateFile,
  atomicWritePrivate,
  enforcePrivateUmask,
  secureArtifactRoot,
} from './lib/saferide-artifact-security.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const readinessPath = path.join(REPO_ROOT, 'scripts/saferide-gemma4-v05-readiness.mjs');
const EXPECTED_GATES = Object.freeze([
  'policy', 'system-prompt', 'scenario-matrix', 'reviewer-roster', 'row-reviews',
  'kiswahili-language', 'legal-derivative-use', 'clinical', 'privacy', 'safeguarding',
  'independent-ml-data', 'holdout-custody', 'semantic-leakage', 'prohibited-data',
  'organization-storage', 'unicef-workbook', 'gpu-colab',
]);
const ARTIFACT_POLICY = Object.freeze({
  scenarioSpecs: ['controlled', 'dataset-ml-owner'],
  splitManifest: ['controlled', 'dataset-ml-owner'],
  candidates: ['restricted', 'dataset-ml-owner'],
  reviewLedger: ['restricted', 'review-evidence-owner'],
  reviewSummary: ['restricted', 'review-evidence-owner'],
  datasetManifest: ['public-safe', 'dataset-ml-owner'],
  pilotSelection: ['controlled', 'dataset-ml-owner'],
  train: ['controlled', 'dataset-ml-owner'],
  dev: ['controlled', 'dataset-ml-owner'],
  qualityHoldout: ['restricted', 'independent-evaluation-custodian'],
  safetyHoldout: ['restricted', 'independent-evaluation-custodian'],
  semanticLeakageReport: ['public-safe', 'independent-ml-data-reviewer'],
  semanticLeakageDetails: ['restricted', 'independent-ml-data-reviewer'],
  auditReport: ['public-safe', 'independent-ml-data-reviewer'],
  auditDetails: ['restricted', 'independent-ml-data-reviewer'],
  blindEvaluation: ['restricted', 'independent-evaluation-custodian'],
});
const UPSTREAMS = Object.freeze({
  scenarioSpecs: ['plan', 'policy'],
  splitManifest: ['plan', 'scenarioSpecs'],
  candidates: ['scenarioSpecs', 'splitManifest', 'policy', 'systemPrompt'],
  reviewLedger: ['candidates', 'systemPrompt'],
  reviewSummary: ['reviewLedger', 'candidates'],
  datasetManifest: ['plan', 'scenarioSpecs', 'splitManifest', 'candidates', 'reviewLedger', 'policy', 'systemPrompt'],
  pilotSelection: ['datasetManifest', 'train'],
  train: ['datasetManifest'], dev: ['datasetManifest'], qualityHoldout: ['datasetManifest'], safetyHoldout: ['datasetManifest'],
  semanticLeakageReport: ['datasetManifest', 'splitManifest'], semanticLeakageDetails: ['semanticLeakageReport'],
  auditReport: ['datasetManifest', 'reviewSummary', 'semanticLeakageReport'], auditDetails: ['auditReport'],
  blindEvaluation: ['splitManifest'],
});

function usage() {
  return [
    'Usage: node scripts/saferide-gemma4-v05-register.mjs',
    '  --artifact-root <absolute-dir> --evidence-config <run/register-evidence.json>',
    '  --output <register/input-register.json>',
    '  [--validate-strict] [--contract-check]',
    '',
    'The builder hashes actual bytes. It cannot invent approvals or turn a smoke root into production evidence.',
  ].join('\n');
}

function parseArgs(argv) {
  if (argv.some(argument => ['--help', '-h'].includes(argument))) {
    console.log(usage());
    process.exit(0);
  }
  if (argv.length === 1 && argv[0] === '--contract-check') return { contractCheck: true };
  const args = { validateStrict: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--artifact-root') args.artifactRoot = argv[++index];
    else if (argument === '--evidence-config') args.evidenceConfig = argv[++index];
    else if (argument === '--output') args.output = argv[++index];
    else if (argument === '--validate-strict') args.validateStrict = true;
    else throw new Error(`Unknown or incomplete argument: ${argument}\n\n${usage()}`);
  }
  for (const field of ['artifactRoot', 'evidenceConfig', 'output']) {
    if (!args[field]) throw new Error(`--${field.replace(/[A-Z]/g, value => `-${value.toLowerCase()}`)} is required`);
  }
  return args;
}

function repositoryFile(relativePath) {
  const resolved = path.resolve(REPO_ROOT, relativePath);
  const relative = path.relative(REPO_ROOT, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Repository binding escapes the repository');
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error('Repository binding is unavailable');
  return resolved;
}

function currentCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8', shell: false });
  if (result.status !== 0) throw new Error('Unable to resolve the repository source commit');
  return result.stdout.trim();
}

function jsonlMetadata(filePath) {
  const rows = readJsonl(filePath);
  const first = rows[0] ?? null;
  return { recordCount: rows.length, schema: first?.schema ?? null, schemaVersion: first?.schemaVersion ?? null };
}

function jsonMetadata(filePath) {
  const value = readJson(filePath);
  const recordCount = Number.isInteger(value.rowCount) ? value.rowCount
    : Number.isInteger(value.candidateCount) ? value.candidateCount
      : Number.isInteger(value.familyCount) ? value.familyCount
        : Number.isInteger(value.promptCount) ? value.promptCount
          : Number.isInteger(value.counts?.rows) ? value.counts.rows
            : 1;
  return { recordCount, schema: value.schema ?? null, schemaVersion: value.schemaVersion ?? null };
}

function artifactMetadata(filePath) {
  return filePath.endsWith('.jsonl') ? jsonlMetadata(filePath) : jsonMetadata(filePath);
}

function binding(relativePath) {
  const filePath = repositoryFile(relativePath);
  return { path: relativePath, sha256: fileSha256(filePath) };
}

function validateEvidenceSemantics(evidence) {
  const errors = [];
  const gateIds = evidence.gates.map(gate => gate.gateId);
  if (new Set(gateIds).size !== gateIds.length
    || gateIds.length !== EXPECTED_GATES.length
    || EXPECTED_GATES.some(gateId => !gateIds.includes(gateId))) errors.push('every gate must appear exactly once');
  if (evidence.sourceCommit !== currentCommit()) errors.push('evidence sourceCommit must equal repository HEAD');
  if (evidence.desiredStatus === 'training-ready') {
    if (evidence.gates.some(gate => !['approved', 'passed'].includes(gate.status) || !gate.evidenceRef)) errors.push('training-ready gates require passing status and evidence');
    if (Object.values(evidence.artifacts).some(artifact => !['frozen', 'passed'].includes(artifact.status))) errors.push('training-ready artifacts must be frozen or passed');
    if (evidence.bindingApprovals.policy.status !== 'approved' || !evidence.bindingApprovals.policy.approvalEvidenceRef) errors.push('policy approval evidence is incomplete');
    if (evidence.bindingApprovals.systemPrompt.status !== 'approved' || !evidence.bindingApprovals.systemPrompt.approvalEvidenceRef) errors.push('system-prompt approval evidence is incomplete');
    if (!evidence.holdoutControls.custodianIdentityRef || !evidence.holdoutControls.segregatedAccessEvidenceRef || !evidence.holdoutControls.accessLogEvidenceRef) errors.push('holdout custody evidence is incomplete');
  }
  return errors;
}

function artifactEntries(root, evidence, bindingHashes) {
  const preliminary = {};
  for (const [name, [classification, ownerRole]] of Object.entries(ARTIFACT_POLICY)) {
    const declared = evidence.artifacts[name];
    const resolved = artifactPath(root, declared.path);
    const exists = fs.existsSync(resolved) && fs.statSync(resolved).isFile();
    if (['frozen', 'passed'].includes(declared.status) && !exists) throw new Error(`Required ${name} artifact is unavailable`);
    if (!exists) {
      preliminary[name] = {
        classification, status: declared.status, path: null, sha256: null, sizeBytes: null, ownerRole,
        recordCount: null, schema: null, schemaVersion: null, upstreamSha256: [],
      };
      continue;
    }
    assertPrivateFile(resolved, root);
    const metadata = artifactMetadata(resolved);
    preliminary[name] = {
      classification,
      status: declared.status,
      path: path.relative(root, resolved).split(path.sep).join('/'),
      sha256: fileSha256(resolved),
      sizeBytes: fs.statSync(resolved).size,
      ownerRole,
      ...metadata,
      upstreamSha256: [],
    };
  }
  for (const [name, entry] of Object.entries(preliminary)) {
    entry.upstreamSha256 = [...new Set((UPSTREAMS[name] ?? []).map(upstream => (
      preliminary[upstream]?.sha256 ?? bindingHashes[upstream] ?? null
    )).filter(Boolean))].sort();
  }
  return preliminary;
}

export function buildDatasetRegister({ root, evidence, schemas = compileV05Schemas() }) {
  const evidenceErrors = [
    ...schemaErrors('registerEvidenceConfig', schemas.registerEvidenceConfig, evidence),
    ...validateEvidenceSemantics(evidence),
  ];
  if (evidenceErrors.length) throw new Error(`Register evidence is invalid (${evidenceErrors.length} findings)`);
  const repositoryBindings = Object.fromEntries(Object.entries(evidence.repositoryBindings).map(([name, relativePath]) => [name, binding(relativePath)]));
  const policyPath = repositoryFile(evidence.repositoryBindings.policy);
  const promptPath = repositoryFile(evidence.repositoryBindings.systemPrompt);
  const policy = readJson(policyPath);
  const prompt = readJson(promptPath);
  const policyAndPromptErrors = validatePolicyAndPrompt(policy, prompt);
  if (evidence.desiredStatus === 'training-ready' && policyAndPromptErrors.length) {
    throw new Error(`Training-ready register policy/prompt validation failed (${policyAndPromptErrors.length} findings)`);
  }
  const bindingHashes = {
    plan: repositoryBindings.plan.sha256,
    policy: repositoryBindings.policy.sha256,
    systemPrompt: repositoryBindings.systemPrompt.sha256,
  };
  const artifacts = artifactEntries(root, evidence, bindingHashes);
  if (evidence.desiredStatus === 'training-ready') {
    const incompleteMetadata = Object.values(artifacts).filter(artifact => (
      artifact.path === null || !Number.isInteger(artifact.recordCount) || !artifact.schema || !Number.isInteger(artifact.schemaVersion)
    ));
    if (incompleteMetadata.length) throw new Error(`Training-ready artifact metadata is incomplete (${incompleteMetadata.length} artifacts)`);
  }
  const ready = evidence.desiredStatus === 'training-ready';
  const register = {
    schema: 'com.saferide.ai.v05-dataset-register',
    schemaVersion: 1,
    registerId: evidence.registerId,
    datasetId: DATASET_ID,
    status: ready ? 'training-ready' : 'blocked',
    createdAt: evidence.createdAt,
    sourceCommit: evidence.sourceCommit,
    packageLockSha256: fileSha256(path.join(REPO_ROOT, 'package-lock.json')),
    model: {
      trainBaseModel: 'google/gemma-4-E2B-it',
      immutableBaseRevision: evidence.modelBaseRevision,
      runtimeTargetModel: 'litert-community/gemma-4-E2B-it-litert-lm',
      runtimeTargetFile: 'gemma-4-E2B-it.litertlm',
    },
    bindings: {
      plan: repositoryBindings.plan,
      policy: { ...repositoryBindings.policy, ...evidence.bindingApprovals.policy },
      systemPrompt: {
        ...repositoryBindings.systemPrompt,
        textSha256: prompt.textSha256,
        ...evidence.bindingApprovals.systemPrompt,
      },
      buildImplementation: repositoryBindings.buildImplementation,
      reviewImplementation: repositoryBindings.reviewImplementation,
      auditImplementation: repositoryBindings.auditImplementation,
    },
    artifacts,
    gates: [...evidence.gates].sort((left, right) => EXPECTED_GATES.indexOf(left.gateId) - EXPECTED_GATES.indexOf(right.gateId)),
    holdoutControls: evidence.holdoutControls,
    trainingReadiness: {
      status: ready ? 'training-ready' : 'blocked',
      strictGatePassed: ready,
      trainRows: 1600, devRows: 300, qualityHoldoutRows: 300, safetyHoldoutRows: 400,
      families: 1300, candidateSeeds: [419805, 419806], pilotRows: 320,
      blockers: ready ? [] : evidence.trainingBlockers,
    },
    publication: evidence.publication,
    limitations: evidence.limitations,
  };
  const registerErrors = schemaErrors('register', schemas.register, register);
  if (registerErrors.length) throw new Error(`Generated register is invalid (${registerErrors.length} findings)`);
  return register;
}

function validateStrictCandidate(root, registerPath, register) {
  const args = [
    readinessPath, '--register', registerPath, '--artifact-root', root,
    '--train-data', artifactPath(root, register.artifacts.train.path),
    '--dev-data', artifactPath(root, register.artifacts.dev.path),
  ];
  for (const mode of ['--strict', '--training-strict']) {
    const result = spawnSync(process.execPath, [...args, mode], {
      cwd: REPO_ROOT, encoding: 'utf8', shell: false, maxBuffer: 2 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error(`Generated register failed ${mode} readiness (${result.status ?? 'process-error'})`);
  }
}

function main() {
  enforcePrivateUmask();
  const args = parseArgs(process.argv.slice(2));
  if (args.contractCheck) {
    compileV05Schemas();
    console.log('SafeRide v0.5 register-builder contracts PASS.');
    return 0;
  }
  const root = secureArtifactRoot(args.artifactRoot, { create: false });
  if (fs.existsSync(path.join(root, '.saferide-v05-smoke.json'))) throw new Error('Smoke roots cannot produce a production dataset register');
  const evidencePath = assertPrivateFile(artifactPath(root, args.evidenceConfig, { requiredPrefix: 'run' }), root);
  const output = artifactPath(root, args.output, { requiredPrefix: 'register', classification: 'controlled' });
  const register = buildDatasetRegister({ root, evidence: readJson(evidencePath) });
  const text = `${JSON.stringify(register, null, 2)}\n`;
  if (register.status === 'training-ready' || args.validateStrict) {
    if (register.status !== 'training-ready') throw new Error('--validate-strict requires desiredStatus=training-ready');
    const candidatePath = artifactPath(root, `register/.validation-${sha256(text).slice(0, 16)}.json`);
    atomicWritePrivate(candidatePath, text, { rootPath: root, verifyIdentical: true });
    try {
      validateStrictCandidate(root, candidatePath, register);
    } finally {
      if (fs.existsSync(candidatePath)) fs.unlinkSync(candidatePath);
    }
  }
  const result = atomicWritePrivate(output, text, { rootPath: root, verifyIdentical: true });
  console.log(`Dataset register ${register.status === 'training-ready' ? 'READY' : 'BLOCKED'} (${Object.values(register.artifacts).filter(artifact => artifact.path).length}/${Object.keys(register.artifacts).length} artifacts present).`);
  console.log(`Register SHA-256: ${result.sha256}`);
  return register.status === 'training-ready' || !args.validateStrict ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
