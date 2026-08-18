#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { normalizeText } from './saferide-gemma4-dataset-audit.mjs';
import {
  CATEGORIES,
  DATASET_ID,
  DEFAULT_PLAN_PATH,
  LANGUAGES,
  SPLITS,
  assignScenarioFamilies,
  canonicalSha256,
  compileV05Schemas,
  fileSha256,
  jsonlText,
  privacyFindings,
  readJson,
  readJsonl,
  schemaErrors,
  sha256,
  stableJson,
  validatePlanSemantics,
} from './lib/saferide-gemma4-v05.mjs';
import {
  artifactPath,
  assertPrivateFile,
  atomicWritePrivate,
  enforcePrivateUmask,
  secureArtifactRoot,
} from './lib/saferide-artifact-security.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_TARGETS_PATH = path.join(
  repoRoot,
  'config/ai/datasets/saferide-gemma4-v05-scenario-targets.json',
);
const BEHAVIOR_KEYS = Object.freeze([
  'safeNextStep',
  'pureRefusal',
  'explicitUncertainty',
  'stateDistinction',
  'counterfactual',
  'benignHardNegative',
  'adversarialPressure',
]);
const STRUCTURED_BLUEPRINT_FIELDS = Object.freeze([
  'scenarioFamilyId', 'primaryCategory', 'secondaryTags', 'semanticClusterId',
  'riskLevel', 'urgency', 'emotionalState', 'appState', 'informationState',
  'policyRefs', 'behaviorFlags', 'minorSpecific',
]);

function usage() {
  return [
    'Usage:',
    '  node scripts/saferide-gemma4-v05-scenario-matrix.mjs contract-check [--plan <json>] [--targets <json>]',
    '  node scripts/saferide-gemma4-v05-scenario-matrix.mjs scaffold --artifact-root <absolute-dir> --output <path> [--plan <json>] [--targets <json>]',
    '  node scripts/saferide-gemma4-v05-scenario-matrix.mjs content-scaffold --artifact-root <absolute-dir> --blueprints <jsonl> --output <path> [--targets <json>]',
    '  node scripts/saferide-gemma4-v05-scenario-matrix.mjs assemble --artifact-root <absolute-dir> --blueprints <jsonl> --content <jsonl> --output <path>',
    '  node scripts/saferide-gemma4-v05-scenario-matrix.mjs metrics --artifact-root <absolute-dir> --scenarios <jsonl> --output <path> [--strict]',
    '  node scripts/saferide-gemma4-v05-scenario-matrix.mjs validate --artifact-root <absolute-dir> --scenarios <jsonl> [--strict]',
    '  node scripts/saferide-gemma4-v05-scenario-matrix.mjs freeze-diff --artifact-root <absolute-dir> --draft <jsonl> --frozen <jsonl> --output <path>',
    '',
    'Defaults use the canonical v0.5 plan and scenario targets. No command calls a model or logs scenario content.',
  ].join('\n');
}

function parseArgs(argv) {
  const command = argv[0];
  if (!command || ['--help', '-h'].includes(command)) {
    console.log(usage());
    process.exit(command ? 0 : 1);
  }
  const args = {
    command,
    plan: DEFAULT_PLAN_PATH,
    targets: DEFAULT_TARGETS_PATH,
    strict: false,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--artifact-root') args.artifactRoot = argv[++index];
    else if (argument === '--plan') args.plan = argv[++index];
    else if (argument === '--targets') args.targets = argv[++index];
    else if (argument === '--blueprints') args.blueprints = argv[++index];
    else if (argument === '--content') args.content = argv[++index];
    else if (argument === '--scenarios') args.scenarios = argv[++index];
    else if (argument === '--draft') args.draft = argv[++index];
    else if (argument === '--frozen') args.frozen = argv[++index];
    else if (argument === '--output') args.output = argv[++index];
    else if (argument === '--strict') args.strict = true;
    else throw new Error(`Unknown or incomplete argument: ${argument}\n\n${usage()}`);
  }
  return args;
}

function requireArgs(args, fields) {
  for (const field of fields) {
    if (!args[field]) throw new Error(`--${field.replace(/[A-Z]/g, value => `-${value.toLowerCase()}`)} is required`);
  }
}

function repoInput(input) {
  return path.isAbsolute(input) ? input : path.join(repoRoot, input);
}

function slug(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function compareFamily(left, right) {
  return CATEGORIES.indexOf(left.primaryCategory) - CATEGORIES.indexOf(right.primaryCategory)
    || left.scenarioFamilyId.localeCompare(right.scenarioFamilyId);
}

function ranked(values, seed, purpose, category = '') {
  return [...values].sort((left, right) => (
    sha256(`${seed}:${purpose}:${category}:${left.scenarioFamilyId}`)
      .localeCompare(sha256(`${seed}:${purpose}:${category}:${right.scenarioFamilyId}`))
    || left.scenarioFamilyId.localeCompare(right.scenarioFamilyId)
  ));
}

function allocateCounts(values, counts) {
  const result = new Map();
  let offset = 0;
  for (const [value, count] of Object.entries(counts)) {
    for (const entry of values.slice(offset, offset + count)) result.set(entry.scenarioFamilyId, value);
    offset += count;
  }
  if (offset !== values.length) throw new Error(`Allocation count ${offset} does not cover ${values.length} values`);
  return result;
}

function allocateCycle(values, choices, seed, purpose, category = '') {
  const result = new Map();
  ranked(values, seed, purpose, category).forEach((entry, index) => {
    result.set(entry.scenarioFamilyId, choices[index % choices.length]);
  });
  return result;
}

function canonicalTargetErrors(plan, targets, schemas = compileV05Schemas()) {
  const errors = [
    ...schemaErrors('plan', schemas.plan, plan),
    ...validatePlanSemantics(plan),
    ...schemaErrors('scenarioTargets', schemas.scenarioTargets, targets),
  ];
  if (targets.planId !== plan.planId) errors.push('scenario targets planId differs from the canonical plan');
  if (targets.splitSeed !== plan.splitSeed) errors.push('scenario targets seed differs from the canonical plan');
  if (targets.familiesPerCategory * CATEGORIES.length !== plan.totals.families) errors.push('scenario target family total differs from the canonical plan');
  const designCategories = (targets.categoryDesign ?? []).map(entry => entry.category);
  if (stableJson(designCategories) !== stableJson(CATEGORIES) || new Set(designCategories).size !== CATEGORIES.length) {
    errors.push('scenario category design must contain the canonical categories in canonical order');
  }
  const allowedPolicyRefs = targets.allowedPolicyRefs ?? [];
  for (const design of targets.categoryDesign ?? []) {
    if ((design.policyRefs ?? []).some(policyRef => !allowedPolicyRefs.includes(policyRef))) {
      errors.push(`${design.category} uses a policy reference outside allowedPolicyRefs`);
    }
  }
  const safetyFamiliesPerCategory = plan.splits.find(split => split.name === 'safety-holdout')?.familiesPerCategory ?? 0;
  const nonSafetyRiskCount = Object.values(targets.dimensions?.risk?.nonSafetyFamiliesPerCategory ?? {})
    .reduce((total, value) => total + value, 0);
  if (nonSafetyRiskCount + safetyFamiliesPerCategory !== targets.familiesPerCategory) {
    errors.push('risk allocation does not cover non-safety and safety-holdout families exactly');
  }
  const counterfactualCount = Object.values(targets.counterfactualFamiliesPerCategoryBySplit ?? {})
    .reduce((total, value) => total + value, 0);
  if (counterfactualCount !== targets.behaviorFamilyTargets?.counterfactual) {
    errors.push('counterfactual split targets do not equal the category behavior target');
  }
  if ((targets.behaviorFamilyTargets?.safeNextStep ?? 0) + (targets.behaviorFamilyTargets?.pureRefusal ?? 0) > targets.familiesPerCategory) {
    errors.push('safe-next-step and pure-refusal targets cannot be allocated disjointly');
  }
  const behaviorRows = {
    safeNextStep: plan.behaviorQuotas.minimumSafeNextStepRows,
    explicitUncertainty: plan.behaviorQuotas.minimumExplicitUncertaintyRows,
    stateDistinction: plan.behaviorQuotas.minimumStateDistinctionRows,
    counterfactual: plan.behaviorQuotas.minimumCounterfactualRows,
    benignHardNegative: plan.behaviorQuotas.minimumBenignHardNegativeRows,
    adversarialPressure: plan.behaviorQuotas.minimumAdversarialPressureRows,
  };
  for (const [key, minimumRows] of Object.entries(behaviorRows)) {
    const projectedRows = (targets.behaviorFamilyTargets?.[key] ?? 0) * CATEGORIES.length * LANGUAGES.length;
    if (projectedRows < minimumRows) errors.push(`${key} scenario target cannot meet the canonical row minimum`);
  }
  const projectedPureRefusalRows = (targets.behaviorFamilyTargets?.pureRefusal ?? 0) * CATEGORIES.length * LANGUAGES.length;
  if (projectedPureRefusalRows > plan.behaviorQuotas.maximumPureRefusalRows) errors.push('pure-refusal scenario target exceeds the canonical row maximum');
  return errors;
}

function provisionalScenario(entry) {
  return {
    schema: 'com.saferide.ai.scenario-spec',
    schemaVersion: 1,
    scenarioFamilyId: entry.scenarioFamilyId,
    primaryCategory: entry.primaryCategory,
    secondaryTags: [],
    semanticClusterId: entry.semanticClusterId,
    riskLevel: 'high',
    userGoal: `Synthetic design cell ${entry.scenarioFamilyId}`,
    urgency: 'uncertain-danger',
    emotionalState: 'uncertain',
    appState: 'not-applicable',
    informationState: 'unknown',
    unsafePressure: 'Synthetic design pressure without conversation prose',
    requiredBehavior: ['Preserve agency and verified information boundaries'],
    prohibitedBehavior: ['Do not invent facts or authority'],
    responseStrategy: 'boundary-with-alternative',
    policyRefs: entry.policyRefs,
    behaviorFlags: Object.fromEntries(BEHAVIOR_KEYS.map(key => [key, false])),
    sourceKind: 'repository-authored-synthetic-scenario',
    minorSpecific: false,
    matrixReview: { status: 'draft', evidenceRef: null },
  };
}

export function createScenarioBlueprints(plan, targets, schemas = compileV05Schemas()) {
  const targetErrors = canonicalTargetErrors(plan, targets, schemas);
  if (targetErrors.length) throw new Error(`Scenario target contract failed:\n- ${targetErrors.join('\n- ')}`);
  const designByCategory = new Map(targets.categoryDesign.map(entry => [entry.category, entry]));
  const base = CATEGORIES.flatMap(category => Array.from({ length: targets.familiesPerCategory }, (_, index) => {
    const number = String(index + 1).padStart(4, '0');
    return {
      scenarioFamilyId: `v05-${category}-family-${number}`,
      primaryCategory: category,
      semanticClusterId: `v05-cluster-${category.toLowerCase()}-${number}`,
      policyRefs: designByCategory.get(category).policyRefs,
      offset: index,
    };
  }));
  const projection = assignScenarioFamilies(base.map(provisionalScenario), plan);
  const assignmentById = new Map(projection.assignments.map(entry => [entry.scenarioFamilyId, entry]));
  const riskById = new Map();
  const emotionById = new Map();
  const appStateById = new Map();
  const informationById = new Map();
  const strategyById = new Map();
  const flagsById = new Map();
  const pairById = new Map();

  for (const category of CATEGORIES) {
    const categoryRows = base.filter(entry => entry.primaryCategory === category);
    const safety = categoryRows.filter(entry => assignmentById.get(entry.scenarioFamilyId).split === 'safety-holdout');
    const nonSafety = categoryRows.filter(entry => assignmentById.get(entry.scenarioFamilyId).split !== 'safety-holdout');
    const nonSafetyRisk = allocateCounts(
      ranked(nonSafety, plan.splitSeed, 'risk-non-safety', category),
      targets.dimensions.risk.nonSafetyFamiliesPerCategory,
    );
    for (const [id, value] of nonSafetyRisk) riskById.set(id, value);
    ranked(safety, plan.splitSeed, 'risk-safety', category).forEach((entry, index) => {
      riskById.set(entry.scenarioFamilyId, targets.dimensions.risk.safetyHoldoutSequence[index % targets.dimensions.risk.safetyHoldoutSequence.length]);
    });
    for (const [id, value] of allocateCycle(categoryRows, targets.dimensions.emotionalState.values, plan.splitSeed, 'emotion', category)) emotionById.set(id, value);
    for (const [id, value] of allocateCycle(categoryRows, targets.dimensions.appState.values, plan.splitSeed, 'app-state', category)) appStateById.set(id, value);
    for (const [id, value] of allocateCycle(categoryRows, targets.dimensions.informationState.values, plan.splitSeed, 'information-state', category)) informationById.set(id, value);
    for (const [id, value] of allocateCycle(categoryRows, targets.dimensions.responseStrategies.values, plan.splitSeed, 'response-strategy', category)) strategyById.set(id, value);

    const pure = new Set(ranked(categoryRows, plan.splitSeed, 'behavior:pureRefusal', category)
      .slice(0, targets.behaviorFamilyTargets.pureRefusal).map(entry => entry.scenarioFamilyId));
    const nonPure = categoryRows.filter(entry => !pure.has(entry.scenarioFamilyId));
    const benign = new Set(ranked(nonPure, plan.splitSeed, 'behavior:benignHardNegative', category)
      .slice(0, targets.behaviorFamilyTargets.benignHardNegative).map(entry => entry.scenarioFamilyId));
    const safeRanked = ranked(nonPure, plan.splitSeed, 'behavior:safeNextStep', category);
    const safe = new Set([...new Set([
      ...benign,
      ...safeRanked.map(entry => entry.scenarioFamilyId),
    ])].slice(0, targets.behaviorFamilyTargets.safeNextStep));
    const independentFlags = {};
    for (const key of ['explicitUncertainty', 'stateDistinction', 'adversarialPressure']) {
      independentFlags[key] = new Set(ranked(categoryRows, plan.splitSeed, `behavior:${key}`, category)
        .slice(0, targets.behaviorFamilyTargets[key]).map(entry => entry.scenarioFamilyId));
    }
    const counterfactual = new Set();
    for (const split of SPLITS) {
      const splitRows = categoryRows.filter(entry => assignmentById.get(entry.scenarioFamilyId).split === split);
      const selected = ranked(splitRows, plan.splitSeed, `behavior:counterfactual:${split}`, category)
        .slice(0, targets.counterfactualFamiliesPerCategoryBySplit[split]);
      selected.forEach((entry, index) => {
        counterfactual.add(entry.scenarioFamilyId);
        const pairIndex = String(Math.floor(index / 2) + 1).padStart(2, '0');
        pairById.set(entry.scenarioFamilyId, `counterfactual:v05:${category}:${split}:${pairIndex}`);
      });
    }
    for (const entry of categoryRows) {
      const id = entry.scenarioFamilyId;
      flagsById.set(id, {
        safeNextStep: safe.has(id),
        pureRefusal: pure.has(id),
        explicitUncertainty: independentFlags.explicitUncertainty.has(id),
        stateDistinction: independentFlags.stateDistinction.has(id),
        counterfactual: counterfactual.has(id),
        benignHardNegative: benign.has(id),
        adversarialPressure: independentFlags.adversarialPressure.has(id),
      });
    }
  }

  const pressureById = new Map();
  for (const form of ['single-turn', 'multi-turn']) {
    const formRows = base.filter(entry => assignmentById.get(entry.scenarioFamilyId).conversationForm === form);
    for (const [id, value] of allocateCycle(formRows, targets.dimensions.pressurePatterns.values, plan.splitSeed, `pressure:${form}`)) pressureById.set(id, value);
  }

  const blueprints = base.map(entry => {
    const assignment = assignmentById.get(entry.scenarioFamilyId);
    const design = designByCategory.get(entry.primaryCategory);
    const goalAction = targets.dimensions.goalActions.values[Math.floor(entry.offset / design.goalObjects.length)];
    const goalObject = design.goalObjects[entry.offset % design.goalObjects.length];
    const nextCategory = CATEGORIES[(CATEGORIES.indexOf(entry.primaryCategory) + 1) % CATEGORIES.length];
    const secondaryTags = entry.offset % 3 === 0 && nextCategory !== entry.primaryCategory ? [nextCategory] : [];
    return {
      schema: 'com.saferide.ai.v05-scenario-blueprint',
      schemaVersion: 1,
      blueprintId: `blueprint:${entry.scenarioFamilyId}`,
      scenarioFamilyId: entry.scenarioFamilyId,
      primaryCategory: entry.primaryCategory,
      secondaryTags,
      semanticClusterId: entry.semanticClusterId,
      riskLevel: riskById.get(entry.scenarioFamilyId),
      urgency: targets.dimensions.urgencyByRisk[riskById.get(entry.scenarioFamilyId)],
      emotionalState: emotionById.get(entry.scenarioFamilyId),
      appState: appStateById.get(entry.scenarioFamilyId),
      informationState: informationById.get(entry.scenarioFamilyId),
      goalActionCode: slug(goalAction),
      goalObjectCode: slug(goalObject),
      pressurePatternCode: slug(pressureById.get(entry.scenarioFamilyId)),
      responseStrategyTarget: strategyById.get(entry.scenarioFamilyId),
      policyRefs: [...design.policyRefs],
      behaviorFlags: flagsById.get(entry.scenarioFamilyId),
      counterfactualPairId: pairById.get(entry.scenarioFamilyId) ?? null,
      projectedAssignment: {
        split: assignment.split,
        conversationForm: assignment.conversationForm,
      },
      sourceKind: 'deterministic-v05-scenario-blueprint',
      minorSpecific: false,
    };
  });
  const errors = blueprints.flatMap((blueprint, index) => schemaErrors(`blueprint[${index}]`, schemas.scenarioBlueprint, blueprint));
  if (errors.length) throw new Error(`Generated scenario blueprints failed:\n- ${errors.join('\n- ')}`);
  return blueprints;
}

function findBySlug(values, code, label) {
  const value = values.find(entry => slug(entry) === code);
  if (!value) throw new Error(`Blueprint uses unknown ${label} code`);
  return value;
}

function contentHygieneFindings(record, targets) {
  const findings = [];
  const content = {
    userGoal: record.userGoal,
    unsafePressure: record.unsafePressure,
    requiredBehavior: record.requiredBehavior,
    prohibitedBehavior: record.prohibitedBehavior,
  };
  for (const finding of privacyFindings(content, `scenario-content ${record.scenarioFamilyId}`)) findings.push(finding.code);
  const strings = [record.userGoal, record.unsafePressure, ...(record.requiredBehavior ?? []), ...(record.prohibitedBehavior ?? [])];
  for (const value of strings) {
    if (value.length < targets.textHygiene.minimumLength || value.length > targets.textHygiene.maximumLength) findings.push('length-bound');
    if (targets.textHygiene.forbidNewlines && /[\r\n]/.test(value)) findings.push('newline');
    if (targets.textHygiene.forbidDialogueMarkup && /(?:^|\s)(?:system|user|assistant)\s*:/i.test(value)) findings.push('dialogue-markup');
    if (/["“”][^"“”]{3,}["“”]/.test(value) || /\b(?:my name is|i live at|this happened to me)\b/i.test(value)) findings.push('narrative-or-dialogue');
    if (/\b\d{1,5}\s+[A-Z][A-Za-z-]+\s+(?:Street|Road|Lane|Avenue)\b/.test(value)) findings.push('precise-address');
  }
  return [...new Set(findings)].sort();
}

export function createDraftScenarioContent(blueprints, targets, schemas = compileV05Schemas()) {
  const designByCategory = new Map(targets.categoryDesign.map(entry => [entry.category, entry]));
  const content = [...blueprints].sort(compareFamily).map(blueprint => {
    const design = designByCategory.get(blueprint.primaryCategory);
    if (!design) throw new Error('Blueprint category has no target design');
    const goalAction = findBySlug(targets.dimensions.goalActions.values, blueprint.goalActionCode, 'goal action');
    const goalObject = findBySlug(design.goalObjects, blueprint.goalObjectCode, 'goal object');
    const pressure = findBySlug(targets.dimensions.pressurePatterns.values, blueprint.pressurePatternCode, 'pressure pattern');
    const strategyWords = blueprint.responseStrategyTarget.replaceAll('-', ' ');
    const informationWords = blueprint.informationState.replaceAll('-', ' ');
    const appStateWords = blueprint.appState.replaceAll('-', ' ');
    return {
      schema: 'com.saferide.ai.v05-scenario-content',
      schemaVersion: 1,
      scenarioFamilyId: blueprint.scenarioFamilyId,
      blueprintSha256: canonicalSha256(blueprint),
      userGoal: `${goalAction} the ${blueprint.primaryCategory} boundary for ${goalObject}`,
      unsafePressure: `${pressure} while trying to ${goalAction} ${goalObject} with ${informationWords} information`,
      requiredBehavior: [
        design.requiredCore,
        `Apply ${strategyWords} to ${goalAction} ${goalObject} while preserving ${informationWords} boundaries`,
      ],
      prohibitedBehavior: [
        design.prohibitedCore,
        `Do not overstate ${appStateWords} state or ${blueprint.riskLevel} certainty while trying to ${goalAction} ${goalObject}`,
      ],
      responseStrategy: blueprint.responseStrategyTarget,
      sourceKind: 'repository-authored-synthetic-scenario-content',
      status: 'draft',
    };
  });
  const errors = [];
  content.forEach((record, index) => {
    errors.push(...schemaErrors(`scenarioContent[${index}]`, schemas.scenarioContent, record));
    const hygiene = contentHygieneFindings(record, targets);
    if (hygiene.length) errors.push(`scenarioContent[${index}] failed ${hygiene.join(',')}`);
  });
  if (new Set(content.map(record => record.scenarioFamilyId)).size !== content.length) errors.push('scenario content family IDs must be unique');
  if (errors.length) throw new Error(`Generated scenario content failed:\n- ${errors.join('\n- ')}`);
  return content;
}

export function assembleScenarioMatrix(blueprints, content, targets, schemas = compileV05Schemas()) {
  const errors = [];
  blueprints.forEach((blueprint, index) => errors.push(...schemaErrors(`blueprint[${index}]`, schemas.scenarioBlueprint, blueprint)));
  content.forEach((record, index) => errors.push(...schemaErrors(`scenarioContent[${index}]`, schemas.scenarioContent, record)));
  const blueprintById = new Map(blueprints.map(entry => [entry.scenarioFamilyId, entry]));
  const contentById = new Map(content.map(entry => [entry.scenarioFamilyId, entry]));
  if (blueprintById.size !== blueprints.length) errors.push('scenario blueprint IDs must be unique');
  if (contentById.size !== content.length) errors.push('scenario content IDs must be unique');
  if (blueprints.length !== content.length) errors.push('scenario content must contain exactly one record per blueprint');
  for (const blueprint of blueprints) {
    const record = contentById.get(blueprint.scenarioFamilyId);
    if (!record) {
      errors.push('scenario content is missing a blueprint family');
      continue;
    }
    if (record.blueprintSha256 !== canonicalSha256(blueprint)) errors.push('scenario content blueprint hash is stale');
    const hygiene = contentHygieneFindings(record, targets);
    if (hygiene.length) errors.push(`scenario content failed ${hygiene.join(',')}`);
  }
  if ([...contentById.keys()].some(id => !blueprintById.has(id))) errors.push('scenario content contains an unknown blueprint family');
  if (errors.length) throw new Error(`Scenario assembly blocked:\n- ${errors.join('\n- ')}`);
  const scenarios = [...blueprints].sort(compareFamily).map(blueprint => {
    const record = contentById.get(blueprint.scenarioFamilyId);
    return {
      schema: 'com.saferide.ai.scenario-spec',
      schemaVersion: 1,
      scenarioFamilyId: blueprint.scenarioFamilyId,
      primaryCategory: blueprint.primaryCategory,
      secondaryTags: blueprint.secondaryTags,
      semanticClusterId: blueprint.semanticClusterId,
      riskLevel: blueprint.riskLevel,
      userGoal: record.userGoal,
      urgency: blueprint.urgency,
      emotionalState: blueprint.emotionalState,
      appState: blueprint.appState,
      informationState: blueprint.informationState,
      unsafePressure: record.unsafePressure,
      requiredBehavior: record.requiredBehavior,
      prohibitedBehavior: record.prohibitedBehavior,
      responseStrategy: record.responseStrategy,
      policyRefs: blueprint.policyRefs,
      behaviorFlags: blueprint.behaviorFlags,
      sourceKind: 'repository-authored-synthetic-scenario',
      minorSpecific: false,
      matrixReview: { status: 'draft', evidenceRef: null },
    };
  });
  scenarios.forEach((scenario, index) => errors.push(...schemaErrors(`scenario[${index}]`, schemas.scenario, scenario)));
  if (errors.length) throw new Error(`Assembled scenarios failed:\n- ${errors.join('\n- ')}`);
  return scenarios;
}

function countBy(values, selector) {
  const counts = new Map();
  for (const value of values) {
    const key = selector(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function heatmap(values, rowSelector, columnSelector) {
  const result = {};
  for (const value of values) {
    const row = rowSelector(value);
    const column = columnSelector(value);
    result[row] ??= {};
    result[row][column] = (result[row][column] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)).map(([row, columns]) => [
    row,
    Object.fromEntries(Object.entries(columns).sort(([left], [right]) => left.localeCompare(right))),
  ]));
}

function duplicateCount(values) {
  const counts = countBy(values, value => normalizeText(value));
  return Object.values(counts).filter(count => count > 1).reduce((total, count) => total + count, 0);
}

function maximumShare(counts, total) {
  return Math.max(0, ...Object.values(counts)) / Math.max(1, total);
}

function structuredScenarioMatchesBlueprint(scenario, blueprint) {
  const expected = Object.fromEntries(STRUCTURED_BLUEPRINT_FIELDS.map(field => [field, blueprint[field]]));
  const actual = Object.fromEntries(STRUCTURED_BLUEPRINT_FIELDS.map(field => [field, scenario[field]]));
  expected.responseStrategy = blueprint.responseStrategyTarget;
  actual.responseStrategy = scenario.responseStrategy;
  return stableJson(expected) === stableJson(actual);
}

export function scenarioMetrics({
  plan,
  targets,
  scenarios,
  scenarioSha256,
  planSha256 = canonicalSha256(plan),
  targetsSha256 = canonicalSha256(targets),
  schemas = compileV05Schemas(),
}) {
  const failures = [...canonicalTargetErrors(plan, targets, schemas).map(() => 'target-contract')];
  const schemaFailures = scenarios.flatMap((scenario, index) => schemaErrors(`scenario[${index}]`, schemas.scenario, scenario));
  if (schemaFailures.length) failures.push(`scenario-schema:${schemaFailures.length}`);
  if (scenarios.length !== plan.totals.families) failures.push(`family-count:${scenarios.length}`);
  const blueprints = createScenarioBlueprints(plan, targets, schemas);
  const blueprintById = new Map(blueprints.map(entry => [entry.scenarioFamilyId, entry]));
  const assignment = assignScenarioFamilies(scenarios, plan);
  const assignmentById = new Map(assignment.assignments.map(entry => [entry.scenarioFamilyId, entry]));
  const idCounts = countBy(scenarios, scenario => scenario.scenarioFamilyId);
  const clusterCounts = countBy(scenarios, scenario => scenario.semanticClusterId);
  const duplicateIds = Object.values(idCounts).filter(count => count > 1).length;
  const duplicateClusters = Object.values(clusterCounts).filter(count => count > 1).length;
  if (duplicateIds) failures.push(`duplicate-family-ids:${duplicateIds}`);
  if (duplicateClusters) failures.push(`duplicate-clusters:${duplicateClusters}`);
  let structuredDrift = 0;
  for (const scenario of scenarios) {
    const blueprint = blueprintById.get(scenario.scenarioFamilyId);
    if (!blueprint || !structuredScenarioMatchesBlueprint(scenario, blueprint)) structuredDrift += 1;
  }
  if (structuredDrift) failures.push(`blueprint-drift:${structuredDrift}`);

  const categoryCounts = countBy(scenarios, scenario => scenario.primaryCategory);
  for (const category of CATEGORIES) {
    if ((categoryCounts[category] ?? 0) !== targets.familiesPerCategory) failures.push(`category:${category}:count`);
  }
  for (const [dimension, values, minimum, maximum] of [
    ['risk', ['low', 'medium', 'high', 'critical'], targets.dimensions.risk.minimumPerCategory, targets.dimensions.risk.maximumSharePerCategory],
    ['emotionalState', targets.dimensions.emotionalState.values, targets.dimensions.emotionalState.minimumPerCategory, targets.dimensions.emotionalState.maximumSharePerCategory],
    ['appState', targets.dimensions.appState.values, targets.dimensions.appState.minimumPerCategory, targets.dimensions.appState.maximumSharePerCategory],
    ['informationState', targets.dimensions.informationState.values, targets.dimensions.informationState.minimumPerCategory, targets.dimensions.informationState.maximumSharePerCategory],
  ]) {
    for (const category of CATEGORIES) {
      const cell = scenarios.filter(scenario => scenario.primaryCategory === category);
      const counts = countBy(cell, scenario => scenario[dimension === 'risk' ? 'riskLevel' : dimension]);
      for (const value of values) if ((counts[value] ?? 0) < minimum) failures.push(`${dimension}:${category}:${value}:minimum`);
      if (maximumShare(counts, cell.length) > maximum) failures.push(`${dimension}:${category}:concentration`);
    }
  }
  const strategyCounts = countBy(scenarios, scenario => scenario.responseStrategy);
  for (const category of CATEGORIES) {
    const cell = scenarios.filter(scenario => scenario.primaryCategory === category);
    if (maximumShare(countBy(cell, scenario => scenario.responseStrategy), cell.length) > targets.dimensions.responseStrategies.maximumSharePerCategory) {
      failures.push(`strategy:${category}:concentration`);
    }
  }
  const unknownPolicyRefs = [...new Set(scenarios.flatMap(scenario => scenario.policyRefs)
    .filter(policyRef => !targets.allowedPolicyRefs.includes(policyRef)))].sort();
  if (unknownPolicyRefs.length) failures.push(`policy:unknown:${unknownPolicyRefs.length}`);
  const behaviorFamilies = Object.fromEntries(BEHAVIOR_KEYS.map(key => [key, scenarios.filter(scenario => scenario.behaviorFlags?.[key]).length]));
  const behaviorRows = Object.fromEntries(BEHAVIOR_KEYS.map(key => [key, behaviorFamilies[key] * LANGUAGES.length]));
  for (const key of BEHAVIOR_KEYS) {
    const expectedFamilies = targets.behaviorFamilyTargets[key];
    if (behaviorFamilies[key] !== expectedFamilies * CATEGORIES.length) failures.push(`behavior:${key}:target`);
  }
  for (const [key, minimum] of Object.entries({
    safeNextStep: plan.behaviorQuotas.minimumSafeNextStepRows,
    explicitUncertainty: plan.behaviorQuotas.minimumExplicitUncertaintyRows,
    stateDistinction: plan.behaviorQuotas.minimumStateDistinctionRows,
    counterfactual: plan.behaviorQuotas.minimumCounterfactualRows,
    benignHardNegative: plan.behaviorQuotas.minimumBenignHardNegativeRows,
    adversarialPressure: plan.behaviorQuotas.minimumAdversarialPressureRows,
  })) if (behaviorRows[key] < minimum) failures.push(`behavior:${key}:minimum`);
  if (behaviorRows.pureRefusal > plan.behaviorQuotas.maximumPureRefusalRows) failures.push('behavior:pureRefusal:maximum');

  const safetyHighOrCriticalFamilies = scenarios.filter(scenario => (
    assignmentById.get(scenario.scenarioFamilyId)?.split === 'safety-holdout'
      && ['high', 'critical'].includes(scenario.riskLevel)
  )).length;
  const safetyHighOrCriticalRows = safetyHighOrCriticalFamilies * LANGUAGES.length;
  if (safetyHighOrCriticalRows < plan.behaviorQuotas.minimumSafetyHoldoutHighOrCriticalRows) failures.push('safety-holdout:high-critical-minimum');
  const pairCounts = countBy(blueprints.filter(entry => entry.counterfactualPairId), entry => entry.counterfactualPairId);
  if (Object.values(pairCounts).some(count => count !== 2)) failures.push('counterfactual:pair-integrity');

  const hygiene = { prohibitedPatternCount: 0, dialogueMarkupCount: 0, newlineCount: 0, lengthViolationCount: 0, minorSpecificCount: 0 };
  for (const scenario of scenarios) {
    hygiene.prohibitedPatternCount += privacyFindings(scenario, 'scenario').length;
    const strings = [scenario.userGoal, scenario.unsafePressure, ...(scenario.requiredBehavior ?? []), ...(scenario.prohibitedBehavior ?? [])];
    for (const value of strings) {
      if (/(?:^|\s)(?:system|user|assistant)\s*:/i.test(value)) hygiene.dialogueMarkupCount += 1;
      if (/[\r\n]/.test(value)) hygiene.newlineCount += 1;
      if (value.length < targets.textHygiene.minimumLength || value.length > targets.textHygiene.maximumLength) hygiene.lengthViolationCount += 1;
    }
    if (scenario.minorSpecific !== false) hygiene.minorSpecificCount += 1;
  }
  for (const [key, count] of Object.entries(hygiene)) if (count) failures.push(`text-hygiene:${key}:${count}`);

  const redundancy = {
    duplicateNormalizedUserGoals: duplicateCount(scenarios.map(scenario => scenario.userGoal)),
    duplicateNormalizedUnsafePressure: duplicateCount(scenarios.map(scenario => scenario.unsafePressure)),
    duplicateRequiredBehaviorSets: duplicateCount(scenarios.map(scenario => [...scenario.requiredBehavior].sort().join('|'))),
    duplicateProhibitedBehaviorSets: duplicateCount(scenarios.map(scenario => [...scenario.prohibitedBehavior].sort().join('|'))),
    duplicateSemanticClusters: duplicateClusters,
    largestSemanticClusterShare: maximumShare(clusterCounts, scenarios.length),
  };
  for (const [key, count] of Object.entries(redundancy)) {
    if (key !== 'largestSemanticClusterShare' && count) failures.push(`redundancy:${key}:${count}`);
  }
  if (redundancy.largestSemanticClusterShare > 1 / plan.totals.families) failures.push('redundancy:semantic-cluster-concentration');

  const reviewState = {
    draft: scenarios.filter(scenario => scenario.matrixReview?.status === 'draft').length,
    approved: scenarios.filter(scenario => scenario.matrixReview?.status === 'approved').length,
    blocked: scenarios.filter(scenario => scenario.matrixReview?.status === 'blocked').length,
    missingEvidence: scenarios.filter(scenario => scenario.matrixReview?.status === 'approved' && !scenario.matrixReview?.evidenceRef).length,
  };
  if (reviewState.missingEvidence) failures.push(`review:missing-evidence:${reviewState.missingEvidence}`);

  const pressureBlueprints = blueprints.map(blueprint => ({
    ...blueprint,
    pressurePattern: blueprint.pressurePatternCode,
    split: blueprint.projectedAssignment.split,
    conversationForm: blueprint.projectedAssignment.conversationForm,
  }));
  const pressureFormCounts = heatmap(pressureBlueprints, entry => entry.conversationForm, entry => entry.pressurePattern);
  for (const form of ['single-turn', 'multi-turn']) {
    for (const pressure of targets.dimensions.pressurePatterns.values.map(slug)) {
      if ((pressureFormCounts[form]?.[pressure] ?? 0) < targets.dimensions.pressurePatterns.minimumPerConversationForm) {
        failures.push(`pressure:${form}:${pressure}:minimum`);
      }
    }
  }
  const uniqueFailures = [...new Set(failures)].sort();
  const scenarioInventory = scenarios.map(scenario => ({
    scenarioFamilyId: scenario.scenarioFamilyId,
    canonicalSha256: canonicalSha256(scenario),
  })).sort((left, right) => left.scenarioFamilyId.localeCompare(right.scenarioFamilyId));
  const bindings = {
    planSha256,
    targetsSha256,
    scenarioSha256,
    scenarioInventorySha256: canonicalSha256(scenarioInventory),
  };
  const passed = uniqueFailures.length === 0;
  return {
    schema: 'com.saferide.ai.v05-scenario-metrics',
    schemaVersion: 1,
    metricsId: `saferide-gemma4-v05-scenario-metrics-${canonicalSha256(bindings).slice(0, 16)}`,
    datasetId: DATASET_ID,
    status: passed ? 'technical-draft-passed' : 'blocked',
    classification: 'public-safe-aggregate',
    bindings,
    integrity: { canonicalRecordCount: scenarios.length, schemaVersion: 1, planId: plan.planId, targetId: targets.targetId },
    ids: { uniqueFamilyIds: Object.keys(idCounts).length, uniqueSemanticClusterIds: Object.keys(clusterCounts).length, duplicateFamilyIds: duplicateIds, duplicateSemanticClusterIds: duplicateClusters },
    heatmaps: {
      categoryRisk: heatmap(scenarios, entry => entry.primaryCategory, entry => entry.riskLevel),
      categoryUrgency: heatmap(scenarios, entry => entry.primaryCategory, entry => entry.urgency),
      categoryEmotionalState: heatmap(scenarios, entry => entry.primaryCategory, entry => entry.emotionalState),
      categoryAppState: heatmap(scenarios, entry => entry.primaryCategory, entry => entry.appState),
      categoryInformationState: heatmap(scenarios, entry => entry.primaryCategory, entry => entry.informationState),
      categoryResponseStrategy: heatmap(scenarios, entry => entry.primaryCategory, entry => entry.responseStrategy),
      splitRisk: heatmap(scenarios, entry => assignmentById.get(entry.scenarioFamilyId)?.split ?? 'missing', entry => entry.riskLevel),
      splitBehaviorFlag: heatmap(scenarios.flatMap(scenario => BEHAVIOR_KEYS.filter(key => scenario.behaviorFlags[key]).map(key => ({ scenario, key }))), entry => assignmentById.get(entry.scenario.scenarioFamilyId)?.split ?? 'missing', entry => entry.key),
      conversationFormPressurePattern: pressureFormCounts,
      policyReferenceCategory: heatmap(scenarios.flatMap(scenario => scenario.policyRefs.map(policyRef => ({ scenario, policyRef }))), entry => entry.policyRef, entry => entry.scenario.primaryCategory),
    },
    strategies: { counts: strategyCounts, largestShare: maximumShare(strategyCounts, scenarios.length), maximumAllowedPerCategory: targets.dimensions.responseStrategies.maximumSharePerCategory },
    policyCoverage: { counts: countBy(scenarios.flatMap(scenario => scenario.policyRefs), value => value), unknownPolicyRefCount: unknownPolicyRefs.length, allowedPolicyRefCount: targets.allowedPolicyRefs.length },
    behaviors: { ...behaviorRows, safetyHighOrCritical: safetyHighOrCriticalRows },
    safetyHoldoutFeasibility: { projectedFamilies: safetyHighOrCriticalFamilies, projectedRows: safetyHighOrCriticalRows, requiredRows: plan.behaviorQuotas.minimumSafetyHoldoutHighOrCriticalRows, passed: safetyHighOrCriticalRows >= plan.behaviorQuotas.minimumSafetyHoldoutHighOrCriticalRows },
    textHygiene: hygiene,
    redundancy,
    reviewState,
    failedCells: uniqueFailures,
    externalApprovalBlocked: true,
    passed,
  };
}

function meaningOnly(scenario) {
  const { matrixReview: _matrixReview, ...meaning } = scenario;
  return meaning;
}

export function freezeDiff(draft, frozen, draftSha256, frozenSha256, schemas = compileV05Schemas()) {
  const failures = [];
  if (draft.length !== 1300 || frozen.length !== 1300) failures.push('freeze inputs must each contain exactly 1300 families');
  const draftById = new Map(draft.map(entry => [entry.scenarioFamilyId, entry]));
  const frozenById = new Map(frozen.map(entry => [entry.scenarioFamilyId, entry]));
  if (draftById.size !== draft.length || frozenById.size !== frozen.length) failures.push('freeze inputs contain duplicate family IDs');
  let meaningChangeCount = 0;
  let approvalOnlyChangeCount = 0;
  let missingApprovalCount = 0;
  let invalidDraftReviewCount = 0;
  for (const [id, draftScenario] of draftById) {
    const frozenScenario = frozenById.get(id);
    if (draftScenario.matrixReview?.status !== 'draft' || draftScenario.matrixReview?.evidenceRef !== null) {
      invalidDraftReviewCount += 1;
    }
    if (!frozenScenario || canonicalSha256(meaningOnly(draftScenario)) !== canonicalSha256(meaningOnly(frozenScenario))) {
      meaningChangeCount += 1;
      continue;
    }
    if (stableJson(draftScenario.matrixReview) !== stableJson(frozenScenario.matrixReview)) approvalOnlyChangeCount += 1;
    if (frozenScenario.matrixReview?.status !== 'approved' || !frozenScenario.matrixReview?.evidenceRef) missingApprovalCount += 1;
  }
  if ([...frozenById.keys()].some(id => !draftById.has(id))) meaningChangeCount += 1;
  const schemaFailureCount = [...draft, ...frozen].flatMap((entry, index) => schemaErrors(`scenario[${index}]`, schemas.scenario, entry)).length;
  if (schemaFailureCount) failures.push(`scenario schema failures: ${schemaFailureCount}`);
  if (invalidDraftReviewCount) failures.push(`invalid draft review states: ${invalidDraftReviewCount}`);
  if (meaningChangeCount) failures.push(`scenario meaning changes: ${meaningChangeCount}`);
  if (missingApprovalCount) failures.push(`missing frozen approvals: ${missingApprovalCount}`);
  const meaningInventory = [...draftById.entries()].map(([scenarioFamilyId, scenario]) => ({ scenarioFamilyId, sha256: canonicalSha256(meaningOnly(scenario)) }))
    .sort((left, right) => left.scenarioFamilyId.localeCompare(right.scenarioFamilyId));
  const report = {
    schema: 'com.saferide.ai.v05-scenario-freeze-diff',
    schemaVersion: 1,
    datasetId: DATASET_ID,
    classification: 'public-safe-aggregate',
    draftSha256,
    frozenSha256,
    familyCount: draft.length,
    meaningChangeCount,
    approvalOnlyChangeCount,
    missingApprovalCount,
    meaningInventorySha256: canonicalSha256(meaningInventory),
    passed: failures.length === 0,
    failures,
  };
  const reportErrors = schemaErrors('freezeDiff', schemas.scenarioFreezeDiff, report);
  if (reportErrors.length) throw new Error(`Freeze-diff report schema failed:\n- ${reportErrors.join('\n- ')}`);
  return report;
}

function writeJsonl(root, output, rows) {
  const destination = artifactPath(root, output, { classification: 'controlled' });
  return atomicWritePrivate(destination, jsonlText(rows), { rootPath: root, verifyIdentical: true });
}

function writeJson(root, output, value, classification = 'public-safe') {
  const destination = artifactPath(root, output, { classification });
  return atomicWritePrivate(destination, `${JSON.stringify(value, null, 2)}\n`, { rootPath: root, verifyIdentical: true });
}

function loadArtifactJsonl(root, requestedPath) {
  return readJsonl(assertPrivateFile(artifactPath(root, requestedPath), root));
}

function main() {
  enforcePrivateUmask();
  const args = parseArgs(process.argv.slice(2));
  const planPath = repoInput(args.plan);
  const targetsPath = repoInput(args.targets);
  const plan = readJson(planPath);
  const targets = readJson(targetsPath);
  const schemas = compileV05Schemas();
  const targetErrors = canonicalTargetErrors(plan, targets, schemas);
  if (targetErrors.length) throw new Error(`Scenario target contract failed:\n- ${targetErrors.join('\n- ')}`);

  if (args.command === 'contract-check') {
    const contractBlueprints = createScenarioBlueprints(plan, targets, schemas);
    console.log(`SafeRide v0.5 scenario-production contract: PASS (${contractBlueprints.length} deterministic blueprint cells).`);
    console.log('No scenario content, approval, or production readiness is inferred.');
    return 0;
  }

  requireArgs(args, ['artifactRoot']);
  const root = secureArtifactRoot(args.artifactRoot, { create: true });

  if (args.command === 'scaffold') {
    requireArgs(args, ['output']);
    const blueprints = createScenarioBlueprints(plan, targets, schemas);
    const result = writeJsonl(root, args.output, blueprints);
    console.log(`Wrote ${blueprints.length} deterministic scenario blueprints; content was not logged.`);
    console.log(`Blueprint SHA-256: ${result.sha256}`);
  } else if (args.command === 'content-scaffold') {
    requireArgs(args, ['blueprints', 'output']);
    const blueprints = loadArtifactJsonl(root, args.blueprints);
    const content = createDraftScenarioContent(blueprints, targets, schemas);
    const result = writeJsonl(root, args.output, content);
    console.log(`Wrote ${content.length} content-minimized draft records; content was not logged.`);
    console.log(`Scenario-content SHA-256: ${result.sha256}`);
  } else if (args.command === 'assemble') {
    requireArgs(args, ['blueprints', 'content', 'output']);
    const blueprints = loadArtifactJsonl(root, args.blueprints);
    const content = loadArtifactJsonl(root, args.content);
    const scenarios = assembleScenarioMatrix(blueprints, content, targets, schemas);
    const result = writeJsonl(root, args.output, scenarios);
    console.log(`Assembled ${scenarios.length} schema-valid draft scenario specifications; content was not logged.`);
    console.log(`Scenario SHA-256: ${result.sha256}`);
  } else if (['metrics', 'validate'].includes(args.command)) {
    requireArgs(args, ['scenarios']);
    if (args.command === 'metrics') requireArgs(args, ['output']);
    const scenarioPath = assertPrivateFile(artifactPath(root, args.scenarios), root);
    const scenarios = readJsonl(scenarioPath);
    const report = scenarioMetrics({
      plan,
      targets,
      scenarios,
      scenarioSha256: fileSha256(scenarioPath),
      planSha256: fileSha256(planPath),
      targetsSha256: fileSha256(targetsPath),
      schemas,
    });
    const reportErrors = schemaErrors('scenarioMetrics', schemas.scenarioMetrics, report);
    if (reportErrors.length) throw new Error(`Scenario metrics schema failed:\n- ${reportErrors.join('\n- ')}`);
    if (args.command === 'metrics') {
      const result = writeJson(root, args.output, report);
      console.log(`Scenario metrics ${report.passed ? 'PASS' : 'BLOCKED'} (${report.integrity.canonicalRecordCount} families; ${report.failedCells.length} failed cells).`);
      console.log(`Scenario-metrics SHA-256: ${result.sha256}`);
    } else {
      console.log(`Scenario validation ${report.passed ? 'PASS' : 'BLOCKED'} (${report.integrity.canonicalRecordCount} families; ${report.failedCells.length} failed cells).`);
    }
    if (args.strict && !report.passed) return 1;
  } else if (['freeze-diff', 'freeze-check'].includes(args.command)) {
    requireArgs(args, ['draft', 'frozen', 'output']);
    const draftPath = assertPrivateFile(artifactPath(root, args.draft), root);
    const frozenPath = assertPrivateFile(artifactPath(root, args.frozen), root);
    const report = freezeDiff(readJsonl(draftPath), readJsonl(frozenPath), fileSha256(draftPath), fileSha256(frozenPath), schemas);
    const result = writeJson(root, args.output, report);
    console.log(`Scenario freeze diff ${report.passed ? 'PASS' : 'BLOCKED'} (${report.meaningChangeCount} meaning changes; ${report.missingApprovalCount} missing approvals).`);
    console.log(`Freeze-diff SHA-256: ${result.sha256}`);
    if (!report.passed) return 1;
  } else {
    throw new Error(`Unknown command: ${args.command}\n\n${usage()}`);
  }
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
