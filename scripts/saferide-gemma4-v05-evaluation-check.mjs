#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import { canonicalSha256, compileV05Schemas, fileSha256, readJsonl, schemaErrors as v05SchemaErrors } from './lib/saferide-gemma4-v05.mjs';
import {
  artifactFileManifestSha256,
  canonicalArtifactFiles,
  compileEvaluationSchemas,
  parsePromptSuite,
  scanPublicSafe,
  schemaErrors,
  validateComparatorPlan,
} from './lib/saferide-gemma4-evaluation.mjs';
import { validateV05TrainingSelection } from './saferide-gemma4-v05-training-check.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultPlan = path.join(repoRoot, 'config/ai/evaluation/evaluation-plan.v0.5.json');
const REQUIRED_SUITES = new Set(['development', 'quality-holdout', 'safety-holdout', 'historical-regression', 'blind-evaluation', 'exported-artifact']);
const DATASET_SUITE_SPLITS = Object.freeze({
  development: 'dev',
  'quality-holdout': 'quality-holdout',
  'safety-holdout': 'safety-holdout',
});
const REGISTER_SPLIT_ARTIFACTS = Object.freeze({
  development: 'dev',
  'quality-holdout': 'qualityHoldout',
  'safety-holdout': 'safetyHoldout',
});

function resolve(input) {
  return path.isAbsolute(input) ? input : path.join(repoRoot, input);
}

function planValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, strictTypes: false });
  return ajv.compile(JSON.parse(fs.readFileSync(path.join(repoRoot, 'schemas/ai-v05-evaluation-plan.schema.json'), 'utf8')));
}

function strictExternalPath(relativePath, label, artifactRoot, errors) {
  if (!artifactRoot) {
    errors.push(`${label} strict verification requires an external artifact root`);
    return null;
  }
  const root = path.resolve(artifactRoot);
  const rootRelativeToRepository = path.relative(repoRoot, root);
  if (!rootRelativeToRepository.startsWith('..') && !path.isAbsolute(rootRelativeToRepository)) {
    errors.push('strict evaluation artifact root must be outside the repository checkout');
    return null;
  }
  const file = path.resolve(root, relativePath);
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    errors.push(`${label} path escapes the strict artifact root`);
    return null;
  }
  return file;
}

function strictArtifactPath(suite, artifactRoot, errors) {
  if (suite.suiteId === 'historical-regression') return resolve(suite.artifact.path);
  return strictExternalPath(suite.artifact.path, `${suite.suiteId} artifact`, artifactRoot, errors);
}

function readStrictBoundJson(reference, label, artifactRoot, errors) {
  if (!reference?.path || !reference?.sha256) {
    errors.push(`${label} is not path- and hash-bound`);
    return null;
  }
  const file = strictExternalPath(reference.path, label, artifactRoot, errors);
  if (!file) return null;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    errors.push(`${label} is unavailable`);
    return null;
  }
  if (fileSha256(file) !== reference.sha256) {
    errors.push(`${label} SHA-256 is stale`);
    return null;
  }
  try {
    return { file, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    errors.push(`${label} is not valid JSON`);
    return null;
  }
}

function validateStrictSuiteArtifact(suite, file, schemas, errors) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    errors.push(`${suite.suiteId} artifact is unavailable`);
    return;
  }
  if (fileSha256(file) !== suite.artifact.sha256) {
    errors.push(`${suite.suiteId} artifact SHA-256 is stale`);
    return;
  }
  if (suite.suiteId === 'historical-regression') {
    if (parsePromptSuite(fs.readFileSync(file, 'utf8')).length !== suite.requiredCount) {
      errors.push('historical-regression artifact does not contain the exact prompt inventory');
    }
    return;
  }
  if (suite.suiteId === 'exported-artifact') return;
  let rows;
  try {
    rows = readJsonl(file);
  } catch {
    errors.push(`${suite.suiteId} artifact is not valid JSONL`);
    return;
  }
  if (rows.length !== suite.requiredCount) errors.push(`${suite.suiteId} artifact has ${rows.length}/${suite.requiredCount} rows`);
  if (suite.suiteId === 'blind-evaluation') {
    rows.forEach((row, index) => errors.push(...v05SchemaErrors(`blind-evaluation[${index}]`, schemas.blindPrompt, row)));
    return;
  }
  const expectedSplit = suite.suiteId === 'development' ? 'dev' : suite.suiteId;
  rows.forEach((row, index) => {
    errors.push(...v05SchemaErrors(`${suite.suiteId}[${index}]`, schemas.example, row));
    if (row.split !== expectedSplit) errors.push(`${suite.suiteId} artifact contains a row from another split`);
  });
}

function readRepositoryBoundJson(reference, label, errors) {
  if (!reference?.path || !reference?.sha256) {
    errors.push(`${label} is not path- and hash-bound`);
    return null;
  }
  const file = resolve(reference.path);
  const relative = path.relative(repoRoot, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    errors.push(`${label} path escapes the repository`);
    return null;
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fileSha256(file) !== reference.sha256) {
    errors.push(`${label} is unavailable or hash-mismatched`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    errors.push(`${label} is not valid JSON`);
    return null;
  }
}

function normalizeRunAdapterFiles(run, errors) {
  const files = run?.outputs?.adapterFiles;
  if (!Array.isArray(files) || files.length === 0) {
    errors.push('selected training run has no adapter file inventory');
    return [];
  }
  const adapterDir = run.outputs?.adapterDir;
  const normalizedRoot = typeof adapterDir === 'string' ? adapterDir.replaceAll('\\', '/').replace(/\/$/, '') : null;
  const rootPath = normalizedRoot ? resolve(adapterDir) : null;
  const normalized = [];
  for (const entry of files) {
    const rawPath = typeof entry?.path === 'string' ? entry.path.replaceAll('\\', '/') : '';
    let relativePath = rawPath;
    const pathIsRooted = Boolean(
      rootPath
      && (path.isAbsolute(entry?.path ?? '') || rawPath.startsWith(`${normalizedRoot}/`)),
    );
    if (pathIsRooted) relativePath = path.relative(rootPath, resolve(entry.path)).split(path.sep).join('/');
    if (!relativePath || path.isAbsolute(relativePath) || relativePath.split('/').includes('..')) {
      errors.push('selected training run adapter inventory contains an unsafe path');
      continue;
    }
    if (!/^[a-f0-9]{64}$/.test(entry?.sha256 ?? '') || !Number.isInteger(entry?.sizeBytes) || entry.sizeBytes < 1) {
      errors.push(`selected training run adapter inventory has invalid hash or size for ${relativePath}`);
      continue;
    }
    normalized.push({ path: relativePath, sha256: entry.sha256, sizeBytes: entry.sizeBytes });
  }
  if (new Set(normalized.map(entry => entry.path)).size !== normalized.length) {
    errors.push('selected training run adapter inventory contains duplicate paths');
  }
  return canonicalArtifactFiles(normalized);
}

function validateSelectedAdapterInventory(selection, selectedSeedArtifact, errors) {
  const selectedRun = (selection.candidateRuns ?? []).find(run => (
    run.runId === selection.selected?.runId && run.seed === selection.selected?.seed
  ));
  if (!selectedRun?.manifestPath || !selectedRun?.manifestSha256) {
    errors.push('selected training run manifest is unavailable for adapter lineage validation');
    return;
  }
  const runFile = resolve(selectedRun.manifestPath);
  if (!fs.existsSync(runFile) || !fs.statSync(runFile).isFile() || fileSha256(runFile) !== selectedRun.manifestSha256) {
    errors.push('selected training run manifest is unavailable or hash-mismatched');
    return;
  }
  let run;
  try {
    run = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  } catch {
    errors.push('selected training run manifest is not valid JSON');
    return;
  }
  const seedInventory = readRepositoryBoundJson(selectedSeedArtifact?.fileInventory, 'selected seed file inventory', errors);
  if (!seedInventory) return;
  const runFiles = normalizeRunAdapterFiles(run, errors);
  const seedFiles = canonicalArtifactFiles(seedInventory.files ?? []);
  if (seedFiles.some(file => !Number.isInteger(file.sizeBytes) || file.sizeBytes < 1)) {
    errors.push('selected seed file inventory lacks exact positive file sizes');
  }
  if (JSON.stringify(runFiles) !== JSON.stringify(seedFiles)) {
    errors.push('selected training run adapter files differ from the selected comparator seed inventory');
  }
  const runManifestSha256 = artifactFileManifestSha256(runFiles);
  if (runManifestSha256 !== selectedSeedArtifact?.fileManifestSha256
    || runManifestSha256 !== seedInventory.fileManifestSha256) {
    errors.push('selected training run adapter file-manifest hash differs from the selected comparator seed');
  }
}

function validateFrozenDatasetLineage({
  plan,
  suites,
  selection,
  comparatorPlan,
  artifactRoot,
  schemas,
  errors,
}) {
  const registerBinding = plan.sharedBindings?.datasetRegister;
  const manifestBinding = plan.sharedBindings?.datasetManifest;
  const registerDocument = readStrictBoundJson(registerBinding, 'frozen dataset register', artifactRoot, errors);
  const manifestDocument = readStrictBoundJson(manifestBinding, 'frozen dataset manifest', artifactRoot, errors);
  if (!registerDocument || !manifestDocument) return;

  const register = registerDocument.value;
  const manifest = manifestDocument.value;
  errors.push(...v05SchemaErrors('dataset register', schemas.register, register));
  errors.push(...v05SchemaErrors('dataset manifest', schemas.datasetManifest, manifest));
  if (register.datasetId !== plan.datasetId || manifest.datasetId !== plan.datasetId) {
    errors.push('frozen dataset lineage does not identify the evaluation dataset');
  }
  if (register.status !== 'training-ready'
    || register.trainingReadiness?.status !== 'training-ready'
    || register.trainingReadiness?.strictGatePassed !== true
    || (register.trainingReadiness?.blockers ?? []).length > 0) {
    errors.push('frozen dataset register is not training-ready under its strict gate');
  }
  if (manifest.status !== 'audited') errors.push('frozen dataset manifest is not audited');
  if (register.artifacts?.datasetManifest?.status !== 'frozen'
    || register.artifacts?.datasetManifest?.path !== manifestBinding.path
    || register.artifacts?.datasetManifest?.sha256 !== manifestBinding.sha256
    || register.artifacts?.datasetManifest?.sizeBytes !== fs.statSync(manifestDocument.file).size) {
    errors.push('dataset-register binding to the audited dataset manifest is stale');
  }
  const expectedSelectionBindings = {
    registerSha256: registerBinding.sha256,
    datasetManifestSha256: manifestBinding.sha256,
    auditSha256: register.artifacts?.auditReport?.sha256,
    planSha256: register.bindings?.plan?.sha256,
    policySha256: register.bindings?.policy?.sha256,
    systemPromptTextSha256: register.bindings?.systemPrompt?.textSha256,
    splitManifestSha256: register.artifacts?.splitManifest?.sha256,
    reviewLedgerSha256: register.artifacts?.reviewLedger?.sha256,
  };
  for (const [field, expected] of Object.entries(expectedSelectionBindings)) {
    if (!expected || selection?.bindings?.[field] !== expected) {
      errors.push(`training selection ${field} differs from the frozen dataset lineage`);
    }
  }
  const registerManifestBindings = {
    planSha256: register.bindings?.plan?.sha256,
    policySha256: register.bindings?.policy?.sha256,
    systemPromptTextSha256: register.bindings?.systemPrompt?.textSha256,
    splitManifestSha256: register.artifacts?.splitManifest?.sha256,
    reviewLedgerSha256: register.artifacts?.reviewLedger?.sha256,
  };
  for (const [field, expected] of Object.entries(registerManifestBindings)) {
    if (!expected || manifest.bindings?.[field] !== expected) {
      errors.push(`frozen dataset manifest ${field} differs from the dataset register`);
    }
  }
  if (selection?.baseRevision !== register.model?.immutableBaseRevision) {
    errors.push('training selection base revision differs from the frozen dataset register');
  }
  if (comparatorPlan) {
    if (register.bindings?.policy?.sha256 !== comparatorPlan.policy?.sha256
      || manifest.bindings?.policySha256 !== comparatorPlan.policy?.sha256) {
      errors.push('frozen dataset policy lineage differs from the comparator');
    }
    if (register.bindings?.systemPrompt?.textSha256 !== comparatorPlan.systemPrompt?.textSha256
      || manifest.bindings?.systemPromptTextSha256 !== comparatorPlan.systemPrompt?.textSha256) {
      errors.push('frozen dataset system-prompt lineage differs from the comparator');
    }
  }

  const manifestSplitIds = (manifest.files ?? []).map(entry => entry.split);
  if (new Set(manifestSplitIds).size !== manifestSplitIds.length) {
    errors.push('frozen dataset manifest contains duplicate split entries');
  }
  for (const [suiteId, split] of Object.entries(DATASET_SUITE_SPLITS)) {
    const suite = suites.get(suiteId);
    const entry = (manifest.files ?? []).find(file => file.split === split);
    const registerArtifact = register.artifacts?.[REGISTER_SPLIT_ARTIFACTS[suiteId]];
    if (!entry
      || entry.path !== suite?.artifact?.path
      || entry.sha256 !== suite?.artifact?.sha256
      || entry.rowCount !== suite?.requiredCount) {
      errors.push(`${suiteId} suite differs from the frozen dataset manifest`);
    }
    if (!registerArtifact
      || registerArtifact.status !== 'frozen'
      || registerArtifact.path !== entry?.path
      || registerArtifact.sha256 !== entry?.sha256
      || registerArtifact.sizeBytes !== entry?.sizeBytes) {
      errors.push(`${suiteId} dataset-register artifact differs from the frozen dataset manifest`);
    }
  }

  const blindSuite = suites.get('blind-evaluation');
  const blindArtifact = register.artifacts?.blindEvaluation;
  if (!blindArtifact
    || blindArtifact.status !== 'frozen'
    || blindArtifact.path !== blindSuite?.artifact?.path
    || blindArtifact.sha256 !== blindSuite?.artifact?.sha256) {
    errors.push('blind-evaluation suite differs from the frozen dataset register');
  }
  const historicalSuite = suites.get('historical-regression');
  if (historicalSuite?.artifact?.path !== comparatorPlan?.promptSuite?.path
    || historicalSuite?.artifact?.sha256 !== comparatorPlan?.promptSuite?.sha256) {
    errors.push('historical-regression suite differs from the frozen comparator prompt suite');
  }
}

export function validateV05EvaluationPlan(plan, {
  strict = false,
  artifactRoot = null,
  trainingSelectionPath = null,
} = {}) {
  const errors = [];
  const validator = planValidator();
  if (!validator(plan)) errors.push(...(validator.errors ?? []).map(error => `plan${error.instancePath || '/'}: ${error.message}`));
  errors.push(...scanPublicSafe(plan, 'evaluation plan'));
  const suites = new Map((plan.suites ?? []).map(suite => [suite.suiteId, suite]));
  if (suites.size !== REQUIRED_SUITES.size || [...REQUIRED_SUITES].some(id => !suites.has(id))) errors.push('evaluation plan must define each required layer exactly once');
  const expected = { development: 300, 'quality-holdout': 300, 'safety-holdout': 400, 'historical-regression': 120, 'blind-evaluation': 240 };
  for (const [id, count] of Object.entries(expected)) if (suites.get(id)?.requiredCount !== count) errors.push(`${id} count must be ${count}`);
  if (suites.get('development')?.mayInfluenceTraining !== true) errors.push('development must be the only layer allowed to influence selection');
  for (const id of [...REQUIRED_SUITES].filter(value => value !== 'development')) if (suites.get(id)?.mayInfluenceTraining !== false) errors.push(`${id} must not influence training`);
  if (suites.get('blind-evaluation')?.minimumMultiTurnCount !== 96 || suites.get('blind-evaluation')?.minimumHighOrCriticalCount !== 120) errors.push('blind suite must enforce 40% multi-turn and 50% high/critical minimums');
  if (suites.get('safety-holdout')?.minimumHighOrCriticalCount !== 280) errors.push('safety holdout must enforce 70% high/critical minimum');
  for (const suite of suites.values()) if (suite.optimizerAccess !== false) errors.push(`${suite.suiteId} cannot be optimizer data`);
  const rubric = plan.sharedBindings?.rubric;
  if (rubric?.path) {
    const file = resolve(rubric.path);
    if (!fs.existsSync(file) || fileSha256(file) !== rubric.sha256) errors.push('rubric binding is missing or stale');
  }
  const comparator = plan.sharedBindings?.comparatorPlan;
  let comparatorPlan = null;
  if (comparator?.path) {
    const file = resolve(comparator.path);
    if (!fs.existsSync(file)) errors.push('v0.5 comparator plan is missing');
    else {
      if (comparator.sha256 && fileSha256(file) !== comparator.sha256) errors.push('v0.5 comparator-plan hash is stale');
      comparatorPlan = JSON.parse(fs.readFileSync(file, 'utf8'));
      const schemas = compileEvaluationSchemas(repoRoot);
      errors.push(...validateComparatorPlan(comparatorPlan, schemas.plan, repoRoot, schemas.systemPrompt, schemas.artifactInventory));
      if (comparatorPlan.targetSlot !== 'v05') errors.push('evaluation comparator target must be v05');
      if (plan.sharedBindings?.policySha256 !== comparatorPlan.policy?.sha256
        || plan.sharedBindings?.systemPromptTextSha256 !== comparatorPlan.systemPrompt?.textSha256
        || plan.sharedBindings?.generationConfigSha256 !== canonicalSha256(comparatorPlan.generationConfig)) {
        errors.push('evaluation policy, prompt, or generation configuration differs from the comparator plan');
      }
    }
  }
  if (strict) {
    if (!['ready-for-protected-evaluation', 'complete'].includes(plan.status)) errors.push('strict evaluation gate requires ready or complete status');
    if (plan.blockers?.length) errors.push('strict evaluation gate cannot retain blockers');
    if (!plan.selectedAdapter?.artifactId || !plan.selectedAdapter?.immutableRevision || !plan.selectedAdapter?.fileManifestSha256 || !plan.selectedAdapter?.trainingSelectionSha256) errors.push('strict evaluation gate requires selected immutable adapter lineage');
    const schemas = compileV05Schemas();
    let trainingSelection = null;
    for (const suite of suites.values()) {
      if (suite.suiteId === 'exported-artifact' && plan.status !== 'complete') continue;
      if (!['frozen', 'complete'].includes(suite.artifact?.status) || !suite.artifact?.path || !suite.artifact?.sha256 || !suite.artifact?.evidenceRef) {
        errors.push(`${suite.suiteId} is not frozen and hash-bound under custody`);
        continue;
      }
      const file = strictArtifactPath(suite, artifactRoot, errors);
      if (file) validateStrictSuiteArtifact(suite, file, schemas, errors);
    }
    if (!plan.sharedBindings?.generationConfigSha256) errors.push('strict evaluation gate requires frozen generation configuration');
    if (!comparator?.sha256) errors.push('strict evaluation gate requires comparator-plan hash binding');
    if (!comparatorPlan || !['ready-for-private-generation', 'generated'].includes(comparatorPlan.status)
      || (comparatorPlan.blockers ?? []).length
      || (comparatorPlan.artifacts ?? []).some(artifact => artifact.status === 'blocked')) {
      errors.push('strict evaluation gate requires an unblocked comparator ready for private generation');
    }
    const selectedComparatorArtifact = comparatorPlan?.artifacts?.find(artifact => artifact.slot === 'v05');
    for (const field of ['artifactId', 'immutableRevision', 'fileManifestSha256']) {
      if (selectedComparatorArtifact?.[field] !== plan.selectedAdapter?.[field]) {
        errors.push(`selected adapter ${field} differs from the comparator v05 artifact`);
      }
    }
    if (!trainingSelectionPath) {
      errors.push('strict evaluation gate requires the exact training-selection artifact');
    } else {
      const file = resolve(trainingSelectionPath);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        errors.push('training-selection artifact is unavailable');
      } else if (fileSha256(file) !== plan.selectedAdapter?.trainingSelectionSha256) {
        errors.push('training-selection artifact SHA-256 differs from selected adapter lineage');
      } else {
        const selection = JSON.parse(fs.readFileSync(file, 'utf8'));
        trainingSelection = selection;
        errors.push(...validateV05TrainingSelection(selection, { verifyFiles: true })
          .map(error => `training selection: ${error}`));
        if (selection.status !== 'selected' || !selection.selected) {
          errors.push('training selection has not selected a usable candidate');
        } else {
          const selectedSeedSlot = selection.selected.seed === 419805 ? 'v05-seed-a' : 'v05-seed-b';
          const selectedSeedArtifact = comparatorPlan?.artifacts?.find(artifact => artifact.slot === selectedSeedSlot);
          if (selectedComparatorArtifact?.selectedFromSlot !== selectedSeedSlot) {
            errors.push('comparator v05 alias does not identify the training-selected seed slot');
          }
          if (selection.baseModelId !== selectedComparatorArtifact?.baseModelId
            || selection.baseRevision !== selectedComparatorArtifact?.baseRevision) {
            errors.push('training selection base lineage differs from the comparator v05 artifact');
          }
          for (const field of ['artifactId', 'immutableRevision', 'fileManifestSha256']) {
            if (selectedSeedArtifact?.[field] !== selectedComparatorArtifact?.[field]) {
              errors.push(`comparator selected v05 ${field} does not match the chosen seed artifact`);
            }
          }
          validateSelectedAdapterInventory(selection, selectedSeedArtifact, errors);
        }
      }
    }
    validateFrozenDatasetLineage({
      plan,
      suites,
      selection: trainingSelection,
      comparatorPlan,
      artifactRoot,
      schemas,
      errors,
    });
  }
  return errors;
}

function parseArgs(argv) {
  const args = { plan: defaultPlan, strict: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--plan') args.plan = argv[++index];
    else if (argument === '--strict') args.strict = true;
    else if (argument === '--artifact-root') args.artifactRoot = argv[++index];
    else if (argument === '--training-selection') args.trainingSelectionPath = argv[++index];
    else if (!argument.startsWith('-') && argument.endsWith('.json') && args.plan === defaultPlan) args.plan = argument;
    else if (['--help', '-h'].includes(argument)) {
      console.log('Usage: node scripts/saferide-gemma4-v05-evaluation-check.mjs [--plan <json>] [--strict --artifact-root <dir> --training-selection <json>]');
      process.exit(0);
    } else throw new Error(`Unknown or incomplete argument: ${argument}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = JSON.parse(fs.readFileSync(resolve(args.plan), 'utf8'));
  const errors = validateV05EvaluationPlan(plan, args);
  console.log('SafeRide v0.5 protected evaluation plan check');
  console.log(`Status: ${plan.status}`);
  if (errors.length) {
    errors.forEach(error => console.error(`- ${error}`));
    return 1;
  }
  console.log(plan.status === 'blocked'
    ? `PASS (truthfully blocked; ${plan.blockers.length} blocker groups remain).`
    : 'PASS (protected evaluation controls are hash-bound; no release claim implied).');
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
