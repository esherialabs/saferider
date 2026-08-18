#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const forbiddenOutputKeys = new Set([
  'content', 'messages', 'prompt', 'prompts', 'completion', 'completions', 'response', 'responses',
  'narrative', 'transcript', 'location', 'latitude', 'longitude', 'evidence', 'credential', 'token',
]);
const secretPatterns = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)?PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
];

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function scanContentFree(value, location = 'manifest', errors = []) {
  if (typeof value === 'string') {
    for (const pattern of secretPatterns) {
      if (pattern.test(value)) errors.push(`${location} contains secret-like material`);
    }
    return errors;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanContentFree(entry, `${location}[${index}]`, errors));
    return errors;
  }
  if (!value || typeof value !== 'object') return errors;
  for (const [key, entry] of Object.entries(value)) {
    if (location.startsWith('manifest.outputs') && forbiddenOutputKeys.has(key)) {
      errors.push(`${location}.${key} is forbidden in a content-free run manifest`);
    }
    scanContentFree(entry, `${location}.${key}`, errors);
  }
  return errors;
}

function validateReferencedFile(manifestPath, expectedHash, label, errors, { allowExternal = false } = {}) {
  if (manifestPath === null && expectedHash === null) return;
  if (typeof manifestPath !== 'string' || typeof expectedHash !== 'string') {
    errors.push(`${label} path/hash must both be set or both be null`);
    return;
  }
  const fullPath = path.resolve(repoRoot, manifestPath);
  const relative = path.relative(repoRoot, fullPath);
  if ((!relative || relative.startsWith('..') || path.isAbsolute(relative)) && !allowExternal) {
    errors.push(`${label} path escapes the repository`);
  } else if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    errors.push(`${label} file is unavailable: ${manifestPath}`);
  } else if (sha256File(fullPath) !== expectedHash) {
    errors.push(`${label} SHA-256 does not match current bytes`);
  }
}

export function validateTrainingRun(manifest, validator, { verifyFiles = true } = {}) {
  const errors = [];
  if (!validator(manifest)) {
    for (const error of validator.errors ?? []) {
      errors.push(`${error.instancePath || '/'}: ${error.message ?? error.keyword}`);
    }
  }
  scanContentFree(manifest, 'manifest', errors);
  if (manifest.promotionEligible !== false) errors.push('promotionEligible must remain false; downstream safety/export/device gates decide promotion');
  if (manifest.dataGate?.passed !== true || manifest.dataGate?.exitCode !== 0) errors.push('data gate must pass before a run manifest can be accepted');
  if (manifest.runArguments?.effectiveBatchSize !== (
    manifest.runArguments?.trainBatchSize * manifest.runArguments?.gradientAccumulationSteps
  )) errors.push('effective batch size is inconsistent');
  if (manifest.runArguments?.saveSteps % manifest.runArguments?.evalSteps !== 0) {
    errors.push('saveSteps must be a multiple of evalSteps');
  }
  if (manifest.datasetProfile === 'v05' && ['pilot', 'candidate'].includes(manifest.runKind)) {
    if (manifest.data !== null || manifest.dataSha256 !== null) {
      errors.push('v0.5 manifest must use access-separated dataFiles rather than combined data');
    }
    if (!manifest.dataFiles?.train || !manifest.dataFiles?.dev) errors.push('v0.5 manifest requires train and dev file bindings');
    if (!manifest.datasetManifest || !manifest.datasetManifestSha256) errors.push('v0.5 manifest requires the content-free dataset manifest binding');
    if (!manifest.datasetBindings) errors.push('v0.5 manifest requires plan, policy, prompt, scenario, split, and review hashes');
    if (manifest.dataSummary?.rowCount !== 1900
      || manifest.dataSummary?.splitCounts?.train !== 1600
      || manifest.dataSummary?.splitCounts?.dev !== 300
      || Object.keys(manifest.dataSummary?.splitCounts ?? {}).some(split => !['train', 'dev'].includes(split))) {
      errors.push('v0.5 process input summary must contain exactly 1,600 train and 300 development rows only');
    }
    if (manifest.baseModelId !== 'google/gemma-4-E2B-it' || !/^[a-f0-9]{40,64}$/.test(manifest.baseRevision ?? '')) {
      errors.push('v0.5 pilot/candidate requires the canonical base model and immutable revision');
    }
    if (manifest.privacy?.classification !== 'controlled-content-free' || manifest.privacy?.containsExactRowIds !== true) {
      errors.push('v0.5 full run manifest must be classified controlled because it contains exact row inventories');
    }
    if (![419805, 419806].includes(manifest.runArguments?.seed)) {
      errors.push('v0.5 pilot/candidate seed must be 419805 or 419806');
    }
    if (manifest.runKind === 'candidate' && (manifest.runArguments?.evalSteps !== 25 || manifest.runArguments?.saveSteps !== 25)) {
      errors.push('v0.5 candidate evaluation/save cadence must be 25 steps');
    }
    if (manifest.runArguments?.maxSteps !== null || ![0.00001, 0.00002].includes(manifest.runArguments?.learningRate)) {
      errors.push('v0.5 pilot/candidate requires a complete epoch and an approved pilot learning rate');
    }
    if (manifest.runArguments?.maxSequenceLength !== 1024
      || manifest.runArguments?.trainBatchSize !== 1
      || manifest.runArguments?.gradientAccumulationSteps !== 8
      || manifest.runArguments?.effectiveBatchSize !== 8
      || manifest.runArguments?.warmupRatio !== 0.03
      || manifest.runArguments?.scheduler !== 'cosine'
      || manifest.runArguments?.earlyStoppingPatience !== 3
      || manifest.runArguments?.evalSteps !== 25
      || manifest.runArguments?.saveSteps !== 25) {
      errors.push('v0.5 run differs from the fixed sequence, batch, scheduler, warmup, cadence, or early-stopping configuration');
    }
    if (manifest.runArguments?.loraRank !== 8 && manifest.runArguments?.loraRank !== 16) {
      errors.push('v0.5 run manifest lacks its LoRA rank');
    }
    if (manifest.runArguments?.loraAlpha !== 16 || manifest.runArguments?.loraDropout !== 0.05) {
      errors.push('v0.5 run manifest differs from the fixed LoRA alpha/dropout configuration');
    }
    if (!manifest.runArguments?.loraRankApprovalRef && manifest.runArguments?.loraRank === 16) {
      errors.push('v0.5 rank 16 lacks its approved pilot underfitting evidence reference');
    }
  } else if (manifest.runKind === 'candidate' && (!manifest.data || !manifest.dataSha256)) {
    errors.push('pre-v0.5 candidate requires a combined data path and hash');
  }
  if (['pilot', 'candidate'].includes(manifest.runKind) && manifest.status === 'completed') {
    const outputs = manifest.outputs ?? {};
    if (manifest.environment?.dependencyConstraintsSatisfied !== true) {
      errors.push('completed candidate requires exact dependency-constraint verification');
    }
    if (!/^[a-f0-9]{64}$/.test(manifest.environment?.requirementsSha256 ?? '')) {
      errors.push('completed candidate requires the exact direct-requirements hash');
    }
    if (!/^[a-f0-9]{64}$/.test(manifest.environment?.constraintsSha256 ?? '')) {
      errors.push('completed candidate requires the exact dependency-constraint hash');
    }
    if (outputs.runKind !== manifest.runKind) errors.push('completed run outputs must retain the declared runKind');
    if ((outputs.epochsCompleted ?? 0) < 1) errors.push('completed pilot/candidate must cover at least one epoch');
    if (!Array.isArray(outputs.sampleOrder) || outputs.sampleOrder.length === 0) errors.push('completed pilot/candidate requires exact sample order');
    if (!outputs.sampleOrderSha256) errors.push('completed pilot/candidate requires sample-order hash');
    if (!Number.isInteger(outputs.rowsSeen) || outputs.rowsSeen < outputs.sampleOrder?.length) {
      errors.push('completed pilot/candidate requires rows-seen evidence covering at least one complete sample order');
    }
    if (outputs.selectionMetric !== 'eval_loss' || outputs.bestMetric === null || outputs.bestMetric === undefined) {
      errors.push('completed pilot/candidate requires dev-loss best-checkpoint selection evidence');
    }
    if (!outputs.chatTemplateSha256 || !outputs.tokenizerRevision) errors.push('completed pilot/candidate requires tokenizer revision and chat-template hash');
    if (!Array.isArray(outputs.adapterFiles) || outputs.adapterFiles.length === 0) errors.push('completed pilot/candidate requires hashed adapter inventory');
    if (manifest.datasetProfile === 'v05') {
      if (outputs.holdoutRowsRead !== 0) errors.push('v0.5 training must read zero quality/safety holdout rows');
      const expectedTrainRows = manifest.runKind === 'pilot' ? 320 : 1600;
      if (!Array.isArray(outputs.trainRowIds) || outputs.trainRowIds.length !== expectedTrainRows) errors.push(`v0.5 ${manifest.runKind} requires exact ${expectedTrainRows} train row IDs`);
      if (!Array.isArray(outputs.developmentRowIds) || outputs.developmentRowIds.length !== 300) errors.push('v0.5 candidate requires exact 300 development row IDs');
      if (!outputs.trainRowIdSha256 || !outputs.developmentRowIdSha256) errors.push('v0.5 candidate requires train/dev row inventory hashes');
      if (new Set(outputs.trainRowIds ?? []).size !== expectedTrainRows || new Set(outputs.developmentRowIds ?? []).size !== 300) {
        errors.push('v0.5 train/development row inventories must be unique');
      }
      if ((outputs.trainRowIds ?? []).some(id => new Set(outputs.developmentRowIds ?? []).has(id))) {
        errors.push('v0.5 train and development row inventories overlap');
      }
      if (outputs.trainRowIdSha256 !== sha256Text((outputs.trainRowIds ?? []).join('\n'))
        || outputs.developmentRowIdSha256 !== sha256Text((outputs.developmentRowIds ?? []).join('\n'))) {
        errors.push('v0.5 train/development row inventory hash is stale');
      }
      if (outputs.sampleOrderSha256 !== sha256Text((outputs.sampleOrder ?? []).join('\n'))
        || new Set(outputs.sampleOrder ?? []).size !== expectedTrainRows
        || (outputs.sampleOrder ?? []).some(id => !(outputs.trainRowIds ?? []).includes(id))) {
        errors.push('v0.5 sample order is stale, duplicated, or differs from the train inventory');
      }
    }
  }
  if (verifyFiles) {
    const allowV05External = manifest.datasetProfile === 'v05';
    validateReferencedFile(manifest.register, manifest.registerSha256, 'register', errors, { allowExternal: allowV05External });
    validateReferencedFile(manifest.data, manifest.dataSha256, 'data', errors);
    validateReferencedFile(manifest.audit, manifest.auditSha256, 'audit', errors, { allowExternal: allowV05External });
    if (manifest.datasetProfile === 'v05') {
      if (manifest.dataFiles !== null && manifest.dataFiles !== undefined) {
        validateReferencedFile(manifest.dataFiles?.train?.path, manifest.dataFiles?.train?.sha256, 'train data', errors, { allowExternal: true });
        validateReferencedFile(manifest.dataFiles?.dev?.path, manifest.dataFiles?.dev?.sha256, 'dev data', errors, { allowExternal: true });
      }
      if ((manifest.datasetManifest !== null && manifest.datasetManifest !== undefined)
        || (manifest.datasetManifestSha256 !== null && manifest.datasetManifestSha256 !== undefined)) {
        validateReferencedFile(manifest.datasetManifest, manifest.datasetManifestSha256, 'dataset manifest', errors, { allowExternal: true });
      }
      if (manifest.datasetBindings?.pilotRowManifest || manifest.datasetBindings?.pilotRowManifestSha256) {
        validateReferencedFile(
          manifest.datasetBindings?.pilotRowManifest,
          manifest.datasetBindings?.pilotRowManifestSha256,
          'pilot row manifest',
          errors,
          { allowExternal: true },
        );
      }
    }
    if (manifest.environment?.requirements || manifest.environment?.requirementsSha256) {
      validateReferencedFile(
        manifest.environment.requirements,
        manifest.environment.requirementsSha256,
        'training requirements',
        errors,
      );
    }
    if (manifest.environment?.constraints || manifest.environment?.constraintsSha256) {
      validateReferencedFile(
        manifest.environment.constraints,
        manifest.environment.constraintsSha256,
        'training constraints',
        errors,
      );
    }
  }
  return errors;
}

function main() {
  const manifestArgument = process.argv[2];
  if (!manifestArgument || ['--help', '-h'].includes(manifestArgument)) {
    console.log('Usage: node scripts/saferide-ai-training-run-check.mjs <metadata.json>');
    return manifestArgument ? 0 : 1;
  }
  const manifestPath = path.resolve(manifestArgument);
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'schemas/ai-training-run.schema.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, strictTypes: false });
  const errors = validateTrainingRun(manifest, ajv.compile(schema));
  console.log('SafeRide content-free training-run manifest check');
  console.log(`Manifest: ${path.relative(repoRoot, manifestPath) || manifestPath}`);
  if (errors.length > 0) {
    errors.forEach(error => console.error(`- ${error}`));
    return 1;
  }
  console.log(`PASS (${manifest.runKind}; ${manifest.status}; promotionEligible=false)`);
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
