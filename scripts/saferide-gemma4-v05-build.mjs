#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  CATEGORIES,
  DATASET_ID,
  DEFAULT_PLAN_PATH,
  LANGUAGES,
  REPO_ROOT,
  SPLITS,
  SPLIT_ORDER,
  assignScenarioFamilies,
  candidateContentHash,
  compareAssignments,
  compareCandidates,
  compileV05Schemas,
  contentFreeInventory,
  createAuthoringJobs,
  expectedReviewStatus,
  fileSha256,
  jsonlText,
  privacyFindings,
  readJson,
  readJsonl,
  schemaErrors,
  sha256,
  stableJson,
  validateCandidateSet,
  validatePlanSemantics,
  validatePrivateOutputRoot,
  validateSplitManifestSemantics,
} from './lib/saferide-gemma4-v05.mjs';
import { validateReviewLedger } from './saferide-gemma4-v05-review-check.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builderPath = fileURLToPath(import.meta.url);

function usage() {
  return [
    'Usage:',
    '  node scripts/saferide-gemma4-v05-build.mjs plan-check [--plan <json>]',
    '  node scripts/saferide-gemma4-v05-build.mjs assign --scenarios <jsonl> --output <json> [--status draft|frozen] [--approvals <json>]',
    '  node scripts/saferide-gemma4-v05-build.mjs authoring-pack --scenarios <jsonl> --split-manifest <json> --output <jsonl>',
    '  node scripts/saferide-gemma4-v05-build.mjs import-candidates --scenarios <jsonl> --split-manifest <json> --input <jsonl> --output <jsonl>',
    '  node scripts/saferide-gemma4-v05-build.mjs build --scenarios <jsonl> --split-manifest <json> --candidates <jsonl> --reviews <jsonl> --policy <json> --system-prompt <json> --output-dir <dir>',
    '',
    'All commands are local and deterministic. No command calls a model or prints candidate/review content.',
  ].join('\n');
}

function parseArgs(argv) {
  const command = argv[0];
  if (!command || ['--help', '-h'].includes(command)) {
    console.log(usage());
    process.exit(command ? 0 : 1);
  }
  const args = { command, plan: DEFAULT_PLAN_PATH, status: 'draft' };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--plan') args.plan = argv[++index];
    else if (argument === '--scenarios') args.scenarios = argv[++index];
    else if (argument === '--split-manifest') args.splitManifest = argv[++index];
    else if (argument === '--input') args.input = argv[++index];
    else if (argument === '--output') args.output = argv[++index];
    else if (argument === '--output-dir') args.outputDir = argv[++index];
    else if (argument === '--status') args.status = argv[++index];
    else if (argument === '--approvals') args.approvals = argv[++index];
    else if (argument === '--candidates') args.candidates = argv[++index];
    else if (argument === '--reviews') args.reviews = argv[++index];
    else if (argument === '--policy') args.policy = argv[++index];
    else if (argument === '--system-prompt') args.systemPrompt = argv[++index];
    else throw new Error(`Unknown or incomplete argument: ${argument}\n\n${usage()}`);
  }
  return args;
}

function resolve(input) {
  return path.isAbsolute(input) ? input : path.join(repoRoot, input);
}

function requireArgs(args, fields) {
  for (const field of fields) {
    if (!args[field]) throw new Error(`--${field.replace(/[A-Z]/g, value => `-${value.toLowerCase()}`)} is required`);
  }
}

function writePrivate(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(filePath), 0o700);
  fs.writeFileSync(filePath, text, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

export function validateScenarioMatrix(specs, plan, schemas = compileV05Schemas()) {
  const errors = [];
  specs.forEach((spec, index) => errors.push(...schemaErrors(`scenario[${index}]`, schemas.scenario, spec)));
  if (specs.length !== plan.totals.families) errors.push(`scenario matrix has ${specs.length}/${plan.totals.families} families`);
  const ids = specs.map(spec => spec.scenarioFamilyId);
  if (new Set(ids).size !== ids.length) errors.push('scenario family IDs are not unique');
  for (const spec of specs) {
    for (const finding of privacyFindings(spec, `scenario ${spec.scenarioFamilyId}`)) {
      errors.push(`${finding.location} contains prohibited ${finding.code} material`);
    }
  }
  for (const category of CATEGORIES) {
    const count = specs.filter(spec => spec.primaryCategory === category).length;
    const expected = plan.categoryQuotas.find(entry => entry.category === category)?.families;
    if (count !== expected) errors.push(`${category} has ${count}/${expected} families`);
  }
  return errors;
}

function assertFrozenInputs(specs, manifest) {
  const errors = [];
  if (manifest.status !== 'frozen') errors.push('final build requires split manifest status=frozen');
  for (const [name, approval] of Object.entries(manifest.approvals ?? {})) {
    if (approval.status !== 'approved' || !approval.evidenceRef) errors.push(`split manifest ${name} approval is incomplete`);
  }
  const unapproved = specs.filter(spec => spec.matrixReview?.status !== 'approved' || !spec.matrixReview?.evidenceRef);
  if (unapproved.length) errors.push(`${unapproved.length} scenario specifications lack matrix approval evidence`);
  return errors;
}

export function validatePolicyAndPrompt(policy, prompt) {
  const errors = [];
  if (prompt.policyId !== policy.policyId) errors.push('system prompt policyId does not match policy');
  if (sha256(prompt.text ?? '') !== prompt.textSha256) errors.push('system prompt text SHA-256 is stale');
  if (policy.status !== 'approved' || !policy.effectiveDate) errors.push('final build requires an approved effective policy');
  if (prompt.status !== 'approved') errors.push('final build requires an approved system prompt');
  const policyRoles = new Map((policy.approvals ?? []).map(entry => [entry.role, entry]));
  for (const role of ['product-safeguarding', 'technical-ml', 'privacy', 'legal', 'kiswahili']) {
    const approval = policyRoles.get(role);
    if (approval?.status !== 'approved' || !approval.reviewerIdentity || !approval.reviewedAt || !approval.artifactRef) {
      errors.push(`policy lacks attributable approved ${role} evidence`);
    }
  }
  const promptRoles = new Map((prompt.approvals ?? []).map(entry => [entry.role, entry]));
  for (const role of ['product-safeguarding', 'legal', 'privacy']) {
    const approval = promptRoles.get(role);
    if (approval?.status !== 'approved' || !approval.evidenceRef) errors.push(`system prompt lacks approved ${role} evidence`);
  }
  return errors;
}

function behaviorCounts(specs) {
  const counts = {
    safeNextStep: 0,
    pureRefusal: 0,
    explicitUncertainty: 0,
    stateDistinction: 0,
    counterfactual: 0,
    benignHardNegative: 0,
    adversarialPressure: 0,
    safetyHighOrCritical: 0,
  };
  for (const spec of specs) {
    for (const key of Object.keys(spec.behaviorFlags ?? {})) {
      if (spec.behaviorFlags[key]) counts[key] += LANGUAGES.length;
    }
  }
  return counts;
}

function validateBehaviorQuotas(specs, manifest, plan) {
  const errors = [];
  const counts = behaviorCounts(specs);
  const quotas = plan.behaviorQuotas;
  const minimums = {
    safeNextStep: quotas.minimumSafeNextStepRows,
    explicitUncertainty: quotas.minimumExplicitUncertaintyRows,
    stateDistinction: quotas.minimumStateDistinctionRows,
    counterfactual: quotas.minimumCounterfactualRows,
    benignHardNegative: quotas.minimumBenignHardNegativeRows,
    adversarialPressure: quotas.minimumAdversarialPressureRows,
  };
  for (const [key, minimum] of Object.entries(minimums)) {
    if (counts[key] < minimum) errors.push(`${key} quota has ${counts[key]}/${minimum} rows`);
  }
  if (counts.pureRefusal > quotas.maximumPureRefusalRows) {
    errors.push(`pureRefusal quota has ${counts.pureRefusal}/${quotas.maximumPureRefusalRows} maximum rows`);
  }
  const specById = new Map(specs.map(spec => [spec.scenarioFamilyId, spec]));
  counts.safetyHighOrCritical = (manifest.assignments ?? [])
    .filter(entry => entry.split === 'safety-holdout' && ['high', 'critical'].includes(specById.get(entry.scenarioFamilyId)?.riskLevel))
    .length * LANGUAGES.length;
  if (counts.safetyHighOrCritical < quotas.minimumSafetyHoldoutHighOrCriticalRows) {
    errors.push(`safety high/critical quota has ${counts.safetyHighOrCritical}/${quotas.minimumSafetyHoldoutHighOrCriticalRows} rows`);
  }
  return { errors, counts };
}

export function validateBuiltRows(rows, plan, promptTextSha256) {
  const errors = [];
  const schemas = compileV05Schemas();
  rows.forEach((row, index) => errors.push(...schemaErrors(`finalRow[${index}]`, schemas.example, row)));
  if (rows.length !== plan.totals.rows) errors.push(`final corpus has ${rows.length}/${plan.totals.rows} rows`);
  const ids = rows.map(row => row.id);
  if (new Set(ids).size !== ids.length) errors.push('final row IDs must be unique');
  for (const splitQuota of plan.splits) {
    const splitRows = rows.filter(row => row.split === splitQuota.name);
    if (splitRows.length !== splitQuota.rows) errors.push(`${splitQuota.name} has ${splitRows.length}/${splitQuota.rows} rows`);
    for (const category of CATEGORIES) {
      const cell = splitRows.filter(row => row.metadata.primaryCategory === category);
      if (cell.length !== splitQuota.rowsPerCategory) errors.push(`${splitQuota.name}/${category} has ${cell.length}/${splitQuota.rowsPerCategory} rows`);
      for (const language of LANGUAGES) {
        const languageCell = cell.filter(row => row.metadata.language === language);
        if (languageCell.length !== splitQuota.rowsPerCategoryLanguage) {
          errors.push(`${splitQuota.name}/${category}/${language} has ${languageCell.length}/${splitQuota.rowsPerCategoryLanguage} rows`);
        }
        for (const form of ['single-turn', 'multi-turn']) {
          const count = languageCell.filter(row => row.metadata.conversationForm === form).length;
          const expected = splitQuota.conversationFormRowsPerCategoryLanguage[form];
          if (count !== expected) errors.push(`${splitQuota.name}/${category}/${language}/${form} has ${count}/${expected} rows`);
        }
      }
    }
  }
  const familyRows = new Map();
  for (const row of rows) {
    const entries = familyRows.get(row.metadata.scenarioFamilyId) ?? [];
    entries.push(row);
    familyRows.set(row.metadata.scenarioFamilyId, entries);
    if (row.messages[0]?.role !== 'system' || sha256(row.messages[0]?.content ?? '') !== promptTextSha256) {
      errors.push(`${row.id} is not bound to the canonical system prompt`);
    }
    if (row.metadata.systemPromptSha256 !== promptTextSha256) errors.push(`${row.id} system-prompt metadata hash is stale`);
    if (row.metadata.reviewableContentSha256 !== candidateContentHash(row)) errors.push(`${row.id} reviewed-content hash is stale`);
    if (row.metadata.reviewStatus !== expectedReviewStatus(row.split)) errors.push(`${row.id} review status differs from its split`);
    for (const finding of privacyFindings(row.messages, `finalRow ${row.id}.messages`)) {
      errors.push(`${finding.location} contains prohibited ${finding.code} material`);
    }
  }
  if (familyRows.size !== plan.totals.families) errors.push(`final corpus has ${familyRows.size}/${plan.totals.families} families`);
  for (const [family, entries] of familyRows) {
    if (entries.length !== 2 || new Set(entries.map(row => row.metadata.language)).size !== 2) {
      errors.push(`${family} must contain exactly one English and one Kiswahili row`);
    }
    if (new Set(entries.map(row => row.split)).size !== 1) errors.push(`${family} crosses splits`);
  }
  return errors;
}

function finalRow(candidate, selection, systemPrompt) {
  return {
    ...candidate,
    stage: 'final',
    messages: [{ role: 'system', content: systemPrompt.text }, ...candidate.messages],
    metadata: {
      ...candidate.metadata,
      reviewLedgerRefs: selection.reviewRefs,
      reviewableContentSha256: selection.reviewableContentSha256,
      systemPromptSha256: systemPrompt.textSha256,
      reviewStatus: expectedReviewStatus(candidate.split),
      prohibitedDataScreen: 'passed',
    },
    authoring: { ...candidate.authoring, status: 'selected' },
  };
}

export function selectPilotRows(rows, plan) {
  const selected = [];
  for (const category of CATEGORIES) {
    for (const language of LANGUAGES) {
      const cell = rows
        .filter(row => row.split === 'train' && row.metadata.primaryCategory === category && row.metadata.language === language)
        .sort((left, right) => sha256(`${plan.splitSeed}:pilot:${left.id}`).localeCompare(sha256(`${plan.splitSeed}:pilot:${right.id}`)) || left.id.localeCompare(right.id));
      selected.push(...cell.slice(0, plan.training.pilotRowsPerCategoryLanguage).map(row => row.id));
    }
  }
  return selected.sort();
}

export function buildFinalDataset({ plan, specs, manifest, candidates, reviews, policy, systemPrompt, schemas }) {
  const validators = schemas ?? compileV05Schemas();
  const errors = [
    ...schemaErrors('plan', validators.plan, plan),
    ...validatePlanSemantics(plan),
    ...validateScenarioMatrix(specs, plan, validators),
    ...schemaErrors('splitManifest', validators.splitManifest, manifest),
    ...validateSplitManifestSemantics(manifest, plan, specs),
    ...assertFrozenInputs(specs, manifest),
    ...validatePolicyAndPrompt(policy, systemPrompt),
  ];
  const reviewResult = validateReviewLedger({ candidates, reviews, specs, manifest, plan, systemPrompt, schemas: validators });
  errors.push(...reviewResult.errors);
  const behavior = validateBehaviorQuotas(specs, manifest, plan);
  errors.push(...behavior.errors);
  if (errors.length) throw new Error(`Final dataset build blocked:\n- ${errors.join('\n- ')}`);
  const candidateById = new Map(candidates.map(candidate => [candidate.candidateId, candidate]));
  const rows = reviewResult.selections.map(selection => finalRow(
    candidateById.get(selection.candidateId),
    selection,
    systemPrompt,
  ));
  rows.sort((left, right) => (SPLIT_ORDER.get(left.split) - SPLIT_ORDER.get(right.split))
    || CATEGORIES.indexOf(left.metadata.primaryCategory) - CATEGORIES.indexOf(right.metadata.primaryCategory)
    || left.metadata.scenarioFamilyId.localeCompare(right.metadata.scenarioFamilyId)
    || LANGUAGES.indexOf(left.metadata.language) - LANGUAGES.indexOf(right.metadata.language));
  const rowErrors = validateBuiltRows(rows, plan, systemPrompt.textSha256);
  if (rowErrors.length) throw new Error(`Final dataset rows are invalid:\n- ${rowErrors.join('\n- ')}`);
  const pilotRowIds = selectPilotRows(rows, plan);
  if (pilotRowIds.length !== plan.training.pilotRows) throw new Error('Pilot selection did not produce exactly 320 rows');
  return { rows, reviewSummary: reviewResult.summary, behaviorCounts: behavior.counts, pilotRowIds };
}

function planCheck(planPath) {
  const schemas = compileV05Schemas();
  const plan = readJson(planPath);
  const errors = [...schemaErrors('plan', schemas.plan, plan), ...validatePlanSemantics(plan)];
  console.log('SafeRide Gemma 4 v0.5 machine-readable plan check');
  if (errors.length) {
    errors.forEach(error => console.error(`- ${error}`));
    return 1;
  }
  console.log(`PASS (${plan.totals.rows} rows; ${plan.totals.families} families; ${plan.totals.blindEvaluationPrompts} restricted blind prompts).`);
  console.log('Status remains implementation-ready-human-gates-blocked.');
  return 0;
}

function assignCommand(args, plan, planPath) {
  requireArgs(args, ['scenarios', 'output']);
  const scenarioPath = resolve(args.scenarios);
  const outputPath = validatePrivateOutputRoot(resolve(args.output));
  const specs = readJsonl(scenarioPath);
  const schemas = compileV05Schemas();
  const matrixErrors = validateScenarioMatrix(specs, plan, schemas);
  if (matrixErrors.length) throw new Error(`Scenario matrix failed:\n- ${matrixErrors.join('\n- ')}`);
  let approvals;
  if (args.status === 'frozen') {
    if (!args.approvals) throw new Error('--status frozen requires --approvals <json> with attributable human evidence references');
    approvals = readJson(resolve(args.approvals));
    for (const [name, approval] of Object.entries(approvals)) {
      if (approval?.status !== 'approved' || !approval.evidenceRef) throw new Error(`${name} is not an attributable approved split decision`);
    }
    const unapproved = specs.filter(spec => spec.matrixReview?.status !== 'approved' || !spec.matrixReview?.evidenceRef);
    if (unapproved.length) throw new Error(`${unapproved.length} scenario specifications are not approved for split freeze`);
  } else if (args.status !== 'draft') throw new Error('--status must be draft or frozen');
  const manifest = assignScenarioFamilies(specs, plan, {
    status: args.status,
    planSha256: fileSha256(planPath),
    scenarioSpecSha256: fileSha256(scenarioPath),
    approvals,
  });
  const errors = [
    ...schemaErrors('splitManifest', schemas.splitManifest, manifest),
    ...validateSplitManifestSemantics(manifest, plan, specs),
  ];
  if (errors.length) throw new Error(`Split manifest failed:\n- ${errors.join('\n- ')}`);
  writePrivate(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${manifest.status} family assignment (${manifest.counts.families} families; no conversation text logged).`);
}

function authoringPackCommand(args, plan) {
  requireArgs(args, ['scenarios', 'splitManifest', 'output']);
  const specs = readJsonl(resolve(args.scenarios));
  const manifest = readJson(resolve(args.splitManifest));
  const errors = validateSplitManifestSemantics(manifest, plan, specs);
  if (errors.length) throw new Error(`Authoring pack blocked:\n- ${errors.join('\n- ')}`);
  const jobs = createAuthoringJobs(specs, manifest);
  const output = validatePrivateOutputRoot(resolve(args.output));
  writePrivate(output, jsonlText(jobs));
  console.log(`Wrote ${jobs.length} controlled authoring slots; all require unreviewed candidate status.`);
}

function importCandidatesCommand(args, plan) {
  requireArgs(args, ['scenarios', 'splitManifest', 'input', 'output']);
  const specs = readJsonl(resolve(args.scenarios));
  const manifest = readJson(resolve(args.splitManifest));
  const candidates = readJsonl(resolve(args.input));
  const validation = validateCandidateSet(candidates, specs, manifest, plan, { schemas: compileV05Schemas() });
  if (validation.errors.length) throw new Error(`Candidate import blocked:\n- ${validation.errors.join('\n- ')}`);
  candidates.sort(compareCandidates);
  const output = validatePrivateOutputRoot(resolve(args.output));
  writePrivate(output, jsonlText(candidates));
  console.log(`Imported ${candidates.length} synthetic candidate drafts (status=unreviewed; content not logged).`);
  console.log(`Candidate-file SHA-256: ${fileSha256(output)}`);
}

function buildCommand(args, plan, planPath) {
  requireArgs(args, ['scenarios', 'splitManifest', 'candidates', 'reviews', 'policy', 'systemPrompt', 'outputDir']);
  const inputPaths = Object.fromEntries(['scenarios', 'splitManifest', 'candidates', 'reviews', 'policy', 'systemPrompt']
    .map(field => [field, resolve(args[field])]));
  const outputDir = validatePrivateOutputRoot(resolve(args.outputDir));
  const specs = readJsonl(inputPaths.scenarios);
  const manifest = readJson(inputPaths.splitManifest);
  const candidates = readJsonl(inputPaths.candidates);
  const reviews = readJsonl(inputPaths.reviews);
  const policy = readJson(inputPaths.policy);
  const systemPrompt = readJson(inputPaths.systemPrompt);
  const result = buildFinalDataset({ plan, specs, manifest, candidates, reviews, policy, systemPrompt });
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(outputDir, 0o700);
  const files = [];
  for (const split of SPLITS) {
    const splitRows = result.rows.filter(row => row.split === split);
    const text = jsonlText(splitRows);
    const name = `${split}.jsonl`;
    const relativePath = `${['train', 'dev'].includes(split) ? 'controlled' : 'restricted'}/${name}`;
    writePrivate(path.join(outputDir, relativePath), text);
    files.push({
      split,
      path: relativePath,
      classification: ['train', 'dev'].includes(split) ? 'controlled' : 'restricted',
      rowCount: splitRows.length,
      sizeBytes: Buffer.byteLength(text),
      sha256: sha256(text),
      rowIdInventorySha256: sha256(splitRows.map(row => row.id).join('\n')),
    });
  }
  const pilotManifest = {
    schema: 'com.saferide.ai.v05-pilot-row-manifest',
    schemaVersion: 1,
    datasetId: DATASET_ID,
    seed: plan.splitSeed,
    rowsPerCategoryLanguage: plan.training.pilotRowsPerCategoryLanguage,
    rowCount: result.pilotRowIds.length,
    rowIdInventorySha256: sha256(result.pilotRowIds.join('\n')),
    rowIds: result.pilotRowIds,
  };
  const pilotErrors = schemaErrors('pilotManifest', compileV05Schemas().pilotManifest, pilotManifest);
  if (pilotErrors.length) throw new Error(`Generated pilot manifest failed:\n- ${pilotErrors.join('\n- ')}`);
  const pilotManifestText = `${JSON.stringify(pilotManifest, null, 2)}\n`;
  writePrivate(path.join(outputDir, 'controlled/pilot-row-manifest.json'), pilotManifestText);
  const inventory = contentFreeInventory(files);
  const datasetManifest = {
    schema: 'com.saferide.ai.v05-dataset-artifact-manifest',
    schemaVersion: 1,
    manifestId: 'saferide-gemma4-v05-artifacts-candidate.1',
    datasetId: DATASET_ID,
    status: 'frozen-pending-audit',
    buildImplementation: {
      path: 'scripts/saferide-gemma4-v05-build.mjs',
      sha256: fileSha256(builderPath),
    },
    bindings: {
      planSha256: fileSha256(planPath),
      scenarioSpecSha256: fileSha256(inputPaths.scenarios),
      splitManifestSha256: fileSha256(inputPaths.splitManifest),
      candidateFileSha256: fileSha256(inputPaths.candidates),
      reviewLedgerSha256: fileSha256(inputPaths.reviews),
      systemPromptConfigSha256: fileSha256(inputPaths.systemPrompt),
      systemPromptTextSha256: systemPrompt.textSha256,
      policySha256: fileSha256(inputPaths.policy),
    },
    files: inventory,
    pilotSelection: {
      path: 'controlled/pilot-row-manifest.json',
      rowCount: result.pilotRowIds.length,
      seed: plan.splitSeed,
      rowsPerCategoryLanguage: plan.training.pilotRowsPerCategoryLanguage,
      sizeBytes: Buffer.byteLength(pilotManifestText),
      sha256: sha256(pilotManifestText),
      rowIdInventorySha256: pilotManifest.rowIdInventorySha256,
    },
    datasetInventorySha256: sha256(stableJson(inventory)),
    privacy: {
      containsSurvivorData: false,
      containsEvidence: false,
      containsRawProductionLogs: false,
      rawContentLogged: false,
      holdoutsCommittedToPublicRepository: false,
    },
  };
  const schemas = compileV05Schemas();
  const manifestErrors = schemaErrors('datasetManifest', schemas.datasetManifest, datasetManifest);
  if (manifestErrors.length) throw new Error(`Generated dataset manifest failed:\n- ${manifestErrors.join('\n- ')}`);
  const reviewSummaryErrors = schemaErrors('reviewSummary', schemas.reviewSummary, result.reviewSummary);
  if (reviewSummaryErrors.length) throw new Error(`Generated review summary failed:\n- ${reviewSummaryErrors.join('\n- ')}`);
  writePrivate(path.join(outputDir, 'public-safe/dataset-manifest.json'), `${JSON.stringify(datasetManifest, null, 2)}\n`);
  writePrivate(path.join(outputDir, 'restricted/review-summary.json'), `${JSON.stringify(result.reviewSummary, null, 2)}\n`);
  console.log(`Built ${result.rows.length} final synthetic rows into four access-separated split files.`);
  console.log(`Dataset inventory SHA-256: ${datasetManifest.datasetInventorySha256}`);
  console.log('Status: frozen-pending-audit; no training readiness or approval is inferred.');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const planPath = resolve(args.plan);
  const plan = readJson(planPath);
  const planStatus = planCheck(planPath);
  if (planStatus !== 0) return planStatus;
  if (args.command === 'plan-check') return 0;
  if (args.command === 'assign') assignCommand(args, plan, planPath);
  else if (args.command === 'authoring-pack') authoringPackCommand(args, plan);
  else if (args.command === 'import-candidates') importCandidatesCommand(args, plan);
  else if (args.command === 'build') buildCommand(args, plan, planPath);
  else throw new Error(`Unknown command: ${args.command}\n\n${usage()}`);
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
