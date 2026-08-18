import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import { normalizeText } from '../saferide-gemma4-dataset-audit.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_PLAN_PATH = path.join(
  REPO_ROOT,
  'config/ai/datasets/saferide-gemma4-v05-plan.json',
);
export const DATASET_ID = 'saferide-synthetic-guidance-v0.5.0';
export const CATEGORIES = Object.freeze([
  'privacy',
  'legal',
  'medical',
  'emergency',
  'tone',
  'coercion',
  'fabrication',
  'product',
  'jailbreak',
  'noNewFacts',
]);
export const LANGUAGES = Object.freeze(['en', 'sw']);
export const SPLITS = Object.freeze(['train', 'dev', 'quality-holdout', 'safety-holdout']);
export const SPLIT_ORDER = new Map(SPLITS.map((split, index) => [split, index]));

const APPROVED_STATUS_BY_SPLIT = Object.freeze({
  train: 'approved-train',
  dev: 'approved-dev',
  'quality-holdout': 'approved-quality-holdout',
  'safety-holdout': 'approved-safety-holdout',
});

const SCHEMA_FILES = Object.freeze({
  plan: 'ai-v05-dataset-plan.schema.json',
  scenarioTargets: 'ai-v05-scenario-targets.schema.json',
  scenarioBlueprint: 'ai-v05-scenario-blueprint.schema.json',
  scenarioContent: 'ai-v05-scenario-content.schema.json',
  scenarioMetrics: 'ai-v05-scenario-metrics.schema.json',
  scenarioFreezeDiff: 'ai-v05-scenario-freeze-diff.schema.json',
  authoringJob: 'ai-v05-authoring-job.schema.json',
  generatorConfig: 'ai-v05-generator-config.schema.json',
  generationBatch: 'ai-v05-candidate-generation-batch.schema.json',
  generationIndex: 'ai-v05-candidate-generation-index.schema.json',
  tokenizationReport: 'ai-v05-tokenization-report.schema.json',
  candidateSemanticRequest: 'ai-v05-candidate-semantic-request.schema.json',
  candidateSemanticReport: 'ai-v05-candidate-semantic-report.schema.json',
  candidateScreenDetail: 'ai-v05-candidate-screen-detail.schema.json',
  candidateScreenReport: 'ai-v05-candidate-screen-report.schema.json',
  importedCandidateIndex: 'ai-v05-imported-candidate-index.schema.json',
  registerEvidenceConfig: 'ai-v05-register-evidence-config.schema.json',
  pipelineConfig: 'ai-v05-production-pipeline-config.schema.json',
  pipelineCommandLedger: 'ai-v05-pipeline-command-ledger.schema.json',
  pipelineState: 'ai-v05-pipeline-state.schema.json',
  pipelineRunManifest: 'ai-v05-pipeline-run-manifest.schema.json',
  pipelineSmokeArtifact: 'ai-v05-pipeline-smoke-artifact.schema.json',
  byteReproducibility: 'ai-v05-byte-reproducibility.schema.json',
  scenario: 'ai-scenario-spec.schema.json',
  example: 'ai-training-example.schema.json',
  review: 'ai-dataset-review.schema.json',
  reviewSummary: 'ai-v05-review-summary.schema.json',
  splitManifest: 'ai-dataset-split-manifest.schema.json',
  pilotManifest: 'ai-v05-pilot-row-manifest.schema.json',
  datasetManifest: 'ai-v05-dataset-artifact-manifest.schema.json',
  semanticReport: 'ai-v05-semantic-leakage-report.schema.json',
  semanticDetails: 'ai-v05-semantic-leakage-details.schema.json',
  audit: 'ai-v05-dataset-audit.schema.json',
  auditDetails: 'ai-v05-dataset-audit-details.schema.json',
  blindPrompt: 'ai-v05-blind-evaluation-prompt.schema.json',
  evidenceIndex: 'ai-v05-evidence-index.schema.json',
  register: 'ai-v05-dataset-register.schema.json',
});

const SECRET_AND_PRIVATE_PATTERNS = Object.freeze([
  ['api-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)?PRIVATE KEY-----/],
  ['signed-url', /\b(?:X-Amz-Signature|X-Goog-Signature|access_token|signature|token|sig)=/i],
  ['url', /\bhttps?:\/\/[^\s]+/i],
  ['email-address', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ['phone-number', /(?:\+?254|0)7\d{8}\b/],
  ['coordinate-pair', /[-+]?(?:[1-8]?\d(?:\.\d+)?|90(?:\.0+)?)\s*,\s*[-+]?(?:1[0-7]\d|\d?\d)(?:\.\d+)?/],
  ['official-identifier', /\b(?:national\s+id|passport\s+number|case\s+(?:id|number)|account\s+(?:id|number))\b/i],
  ['law-citation', /\b(?:section|article|act|statute)\s+\d+[A-Za-z.-]*\b/i],
  ['medication-dose', /\b\d+(?:\.\d+)?\s*(?:mg|mcg|ml|tablets?)\b/i],
  ['fee-or-price', /(?:\bKES\s*\d+|\bKSh\s*\d+|\$\s*\d+)/i],
]);

const ENGLISH_MARKERS = new Set([
  'a', 'and', 'are', 'can', 'do', 'for', 'i', 'if', 'is', 'it', 'my', 'not', 'of',
  'or', 'safe', 'that', 'the', 'this', 'to', 'what', 'you', 'your',
]);
const KISWAHILI_MARKERS = new Set([
  'au', 'hii', 'hilo', 'ikiwa', 'kwa', 'lakini', 'na', 'ni', 'nina', 'salama', 'si',
  'taarifa', 'unaweza', 'usalama', 'ya', 'yako', 'je', 'kwamba',
]);

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function stableJson(value) {
  const stable = input => {
    if (Array.isArray(input)) return input.map(stable);
    if (!input || typeof input !== 'object') return input;
    return Object.fromEntries(Object.keys(input).sort().map(key => [key, stable(input[key])]));
  };
  return JSON.stringify(stable(value));
}

export function canonicalSha256(value) {
  return sha256(stableJson(value));
}

export function normalizeLf(value) {
  return String(value).replace(/\r\n/g, '\n');
}

export function fileSha256(filePath) {
  return sha256(fs.readFileSync(filePath));
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function parseJsonlText(text, label = 'JSONL') {
  return normalizeLf(text)
    .split('\n')
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(entry => entry.line)
    .map(entry => {
      try {
        return JSON.parse(entry.line);
      } catch (error) {
        throw new Error(`${label} line ${entry.lineNumber} is invalid JSON`);
      }
    });
}

export function readJsonl(filePath) {
  return parseJsonlText(fs.readFileSync(filePath, 'utf8'), path.basename(filePath));
}

export function jsonlText(rows) {
  return `${rows.map(row => JSON.stringify(row)).join('\n')}\n`;
}

export function compileV05Schemas(rootDir = REPO_ROOT) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    strictTypes: false,
    formats: { 'date-time': true },
  });
  return Object.fromEntries(Object.entries(SCHEMA_FILES).map(([key, name]) => {
    const schema = readJson(path.join(rootDir, 'schemas', name));
    return [key, ajv.compile(schema)];
  }));
}

export function schemaErrors(label, validator, value) {
  if (validator(value)) return [];
  return (validator.errors ?? []).map(error => (
    `${label}${error.instancePath || '/'}: ${error.message ?? error.keyword}`
  ));
}

function unique(values) {
  return new Set(values).size === values.length;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

export function validatePlanSemantics(plan) {
  const errors = [];
  if (!unique(plan.categories ?? []) || stableJson(plan.categories) !== stableJson(CATEGORIES)) {
    errors.push('plan categories must contain the canonical ten categories in canonical order');
  }
  if (stableJson(plan.languages) !== stableJson(LANGUAGES)) {
    errors.push('plan languages must be exactly en and sw');
  }
  const splitByName = new Map((plan.splits ?? []).map(split => [split.name, split]));
  if (!unique((plan.splits ?? []).map(split => split.name)) || SPLITS.some(split => !splitByName.has(split))) {
    errors.push('plan must define every split exactly once');
  }
  for (const splitName of SPLITS) {
    const split = splitByName.get(splitName);
    if (!split) continue;
    if (split.rows !== split.rowsPerCategory * CATEGORIES.length) {
      errors.push(`${splitName} rows do not equal rowsPerCategory x categories`);
    }
    if (split.families !== split.familiesPerCategory * CATEGORIES.length) {
      errors.push(`${splitName} families do not equal familiesPerCategory x categories`);
    }
    if (split.rowsPerCategory !== split.rowsPerCategoryLanguage * LANGUAGES.length) {
      errors.push(`${splitName} category-language quota does not sum to category rows`);
    }
    if (split.rowsPerCategoryLanguage !== split.familiesPerCategory) {
      errors.push(`${splitName} must provide one row per language for every family`);
    }
    const form = split.conversationFormRowsPerCategoryLanguage ?? {};
    if ((form['single-turn'] ?? 0) + (form['multi-turn'] ?? 0) !== split.rowsPerCategoryLanguage) {
      errors.push(`${splitName} conversation-form cell quota is inconsistent`);
    }
  }
  const fixedSplits = {
    train: { rows: 1600, families: 800, rowsPerCategory: 160, familiesPerCategory: 80, rowsPerCategoryLanguage: 80, forms: { 'single-turn': 56, 'multi-turn': 24 }, optimizerAccess: 'weight-updates-after-strict-gate' },
    dev: { rows: 300, families: 150, rowsPerCategory: 30, familiesPerCategory: 15, rowsPerCategoryLanguage: 15, forms: { 'single-turn': 9, 'multi-turn': 6 }, optimizerAccess: 'never' },
    'quality-holdout': { rows: 300, families: 150, rowsPerCategory: 30, familiesPerCategory: 15, rowsPerCategoryLanguage: 15, forms: { 'single-turn': 9, 'multi-turn': 6 }, optimizerAccess: 'never' },
    'safety-holdout': { rows: 400, families: 200, rowsPerCategory: 40, familiesPerCategory: 20, rowsPerCategoryLanguage: 20, forms: { 'single-turn': 10, 'multi-turn': 10 }, optimizerAccess: 'never' },
  };
  for (const [name, expected] of Object.entries(fixedSplits)) {
    const actual = splitByName.get(name);
    if (!actual) continue;
    if (actual.rows !== expected.rows || actual.families !== expected.families
      || actual.rowsPerCategory !== expected.rowsPerCategory || actual.familiesPerCategory !== expected.familiesPerCategory
      || actual.rowsPerCategoryLanguage !== expected.rowsPerCategoryLanguage
      || stableJson(actual.conversationFormRowsPerCategoryLanguage) !== stableJson(expected.forms)
      || actual.optimizerAccess !== expected.optimizerAccess) errors.push(`${name} differs from the fixed v0.5 quota cell`);
  }
  if (sum((plan.splits ?? []).map(split => split.rows)) !== plan.totals?.rows) {
    errors.push('split row quotas do not sum to total rows');
  }
  if (sum((plan.splits ?? []).map(split => split.families)) !== plan.totals?.families) {
    errors.push('split family quotas do not sum to total families');
  }
  const formTotals = (plan.splits ?? []).reduce((result, split) => ({
    single: result.single + split.conversationFormRowsPerCategoryLanguage['single-turn'] * CATEGORIES.length * LANGUAGES.length,
    multi: result.multi + split.conversationFormRowsPerCategoryLanguage['multi-turn'] * CATEGORIES.length * LANGUAGES.length,
  }), { single: 0, multi: 0 });
  if (formTotals.single !== plan.totals?.singleTurnRows || formTotals.multi !== plan.totals?.multiTurnRows) {
    errors.push('conversation-form cells do not sum to fixed corpus totals');
  }
  const categoryRows = plan.categoryQuotas ?? [];
  if (!unique(categoryRows.map(entry => entry.category)) || categoryRows.length !== CATEGORIES.length) {
    errors.push('category quota matrix must define every category exactly once');
  }
  for (const entry of categoryRows) {
    if (sum(Object.values(entry.splitRows ?? {})) !== entry.rows) errors.push(`${entry.category} split quota does not sum`);
    if (entry.rows !== entry.rowsPerLanguage * LANGUAGES.length) errors.push(`${entry.category} language quota does not sum`);
  }
  const languageRows = plan.languageQuotas ?? [];
  if (!unique(languageRows.map(entry => entry.language)) || languageRows.length !== LANGUAGES.length) {
    errors.push('language quota matrix must define en and sw exactly once');
  }
  for (const entry of languageRows) {
    if (sum(Object.values(entry.splitRows ?? {})) !== entry.rows) errors.push(`${entry.language} split quota does not sum`);
  }
  if (plan.totals?.blindEvaluationPrompts !== CATEGORIES.length * LANGUAGES.length * plan.totals?.blindPromptsPerCategoryLanguage) {
    errors.push('blind-evaluation quota is inconsistent');
  }
  if (plan.training?.pilotRows !== CATEGORIES.length * LANGUAGES.length * plan.training?.pilotRowsPerCategoryLanguage) {
    errors.push('pilot quota is inconsistent');
  }
  if (stableJson(plan.training?.candidateSeeds) !== stableJson([419805, 419806])) {
    errors.push('candidate seeds must be exactly 419805 and 419806');
  }
  const fixedAuditPolicy = {
    exactCrossSplitMaximum: 0, normalizedCrossSplitMaximum: 0, ngramSize: 3,
    ngramJaccardThreshold: 0.8, lexicalSemanticProxyThreshold: 0.92,
    externalEmbeddingThreshold: 0.92, maximumUnresolvedNearDuplicatePairs: 0,
    minimumUniqueAssistantTargetRatio: 0.98, minimumUniqueUserTurnRatio: 0.95,
    maximumSixWordOpeningShare: 0.05, maximumResponseSkeletonShare: 0.03,
    normalResponseWordMinimum: 25, normalResponseWordMaximum: 120,
    thresholdApprovalStatus: 'pending-independent-ml-review',
  };
  if (stableJson(plan.auditPolicy) !== stableJson(fixedAuditPolicy)) errors.push('audit policy differs from the fixed v0.5 fail-closed thresholds');
  const fixedAuthoring = {
    maximumCandidatesPerFamilyLanguage: 3, sourceBoundary: 'synthetic-only', initialStatus: 'unreviewed',
    remoteGenerationEnabledByRepository: false, rawContentLoggingAllowed: false,
  };
  if (stableJson(plan.candidateAuthoring) !== stableJson(fixedAuthoring)) errors.push('candidate-authoring controls differ from the fixed synthetic-only interface');
  const fixedTraining = {
    method: 'peft-lora', objective: 'assistant-only-next-token-loss', baseModelId: 'google/gemma-4-E2B-it',
    maxSequenceLength: 1024, rejectTruncation: true, pilotRows: 320, pilotRowsPerCategoryLanguage: 16,
    pilotLearningRates: [0.00001, 0.00002], candidateSeeds: [419805, 419806], epochs: { minimum: 1, maximum: 3 },
    trainBatchSize: 1, gradientAccumulationSteps: 8, effectiveBatchSize: 8, loraRank: 8, loraAlpha: 16,
    loraDropout: 0.05, scheduler: 'cosine', warmupRatio: 0.03, evaluationSteps: 25, saveSteps: 25,
    earlyStoppingPatience: 3, selectionMetric: 'development-assistant-token-loss', maxStepsAllowedForCandidate: false,
  };
  if (stableJson(plan.training) !== stableJson(fixedTraining)) errors.push('training plan differs from the fixed v0.5 pilot/candidate strategy');
  const artifactClasses = Object.values(plan.artifactPolicy ?? {}).flat();
  if (!unique(artifactClasses)) errors.push('artifact classifications must not overlap');
  const requiredArtifacts = [
    'schemas', 'machine-readable-plan', 'sanitized-register', 'dataset-card', 'aggregate-audit',
    'sanitized-run-summaries', 'aggregate-evaluation', 'scenario-specifications', 'split-manifest',
    'train-rows', 'development-rows', 'candidate-provenance', 'training-selection-records', 'content-free-run-manifests',
    'candidate-conversations', 'review-ledger',
    'reviewer-identities', 'quality-holdout', 'safety-holdout', 'blind-evaluation-prompts', 'raw-model-completions',
    'exploit-sensitive-prompts', 'private-reviewer-notes', 'row-selection-inventory',
    'semantic-leakage-row-details', 'dataset-audit-row-details',
  ];
  if (artifactClasses.length !== requiredArtifacts.length || requiredArtifacts.some(entry => !artifactClasses.includes(entry))) {
    errors.push('artifact policy does not classify every fixed public-safe, controlled, and restricted artifact exactly once');
  }
  const requiredGates = [
    'approved-policy-and-system-prompt', 'scenario-matrix-approval', 'named-reviewer-roster',
    'row-level-primary-and-safety-review', 'native-or-fluent-kiswahili-review', 'legal-and-derivative-use-approval',
    'clinical-legal-privacy-safeguarding-domain-decisions', 'holdout-custody-evidence',
    'semantic-leakage-adjudication', 'organization-owned-controlled-storage',
    'unicef-workbook-reconciliation', 'gpu-colab-authorization',
  ];
  if (!unique(plan.requiredHumanGates ?? []) || plan.requiredHumanGates?.length !== requiredGates.length
    || requiredGates.some(gate => !plan.requiredHumanGates.includes(gate))) errors.push('required human gates differ from the fixed v0.5 gate set');
  return errors;
}

export function expectedReviewStatus(split) {
  return APPROVED_STATUS_BY_SPLIT[split];
}

export function scenarioCategoryFromId(id) {
  return CATEGORIES.find(category => id?.startsWith(`v05-${category}-family-`)) ?? null;
}

function rank(seed, purpose, category, id) {
  return sha256(`${seed}:${purpose}:${category}:${id}`);
}

export function assignScenarioFamilies(specs, plan, options = {}) {
  const errors = [];
  const schemas = options.schemas ?? compileV05Schemas();
  specs.forEach((spec, index) => errors.push(...schemaErrors(`scenario[${index}]`, schemas.scenario, spec)));
  const ids = specs.map(spec => spec.scenarioFamilyId);
  if (!unique(ids)) errors.push('scenario family IDs must be unique');
  const clusters = specs.map(spec => spec.semanticClusterId);
  if (!unique(clusters)) {
    errors.push('semanticClusterId must be unique per family; counterfactuals belong inside one isolated family');
  }
  for (const spec of specs) {
    if (scenarioCategoryFromId(spec.scenarioFamilyId) !== spec.primaryCategory) {
      errors.push(`${spec.scenarioFamilyId} category does not match its ID`);
    }
    if (spec.secondaryTags?.includes(spec.primaryCategory)) {
      errors.push(`${spec.scenarioFamilyId} repeats its primary category as a secondary tag`);
    }
  }
  const assignments = [];
  for (const category of CATEGORIES) {
    const categorySpecs = specs.filter(spec => spec.primaryCategory === category);
    const expected = sum(plan.splits.map(split => split.familiesPerCategory));
    if (categorySpecs.length !== expected) {
      errors.push(`${category} has ${categorySpecs.length}/${expected} scenario families`);
      continue;
    }
    const ranked = [...categorySpecs].sort((left, right) => (
      rank(plan.splitSeed, 'split', category, left.scenarioFamilyId)
        .localeCompare(rank(plan.splitSeed, 'split', category, right.scenarioFamilyId))
      || left.scenarioFamilyId.localeCompare(right.scenarioFamilyId)
    ));
    let offset = 0;
    for (const splitQuota of plan.splits) {
      const assigned = ranked.slice(offset, offset + splitQuota.familiesPerCategory);
      offset += splitQuota.familiesPerCategory;
      const formRanked = [...assigned].sort((left, right) => (
        rank(plan.splitSeed, `form:${splitQuota.name}`, category, left.scenarioFamilyId)
          .localeCompare(rank(plan.splitSeed, `form:${splitQuota.name}`, category, right.scenarioFamilyId))
        || left.scenarioFamilyId.localeCompare(right.scenarioFamilyId)
      ));
      const singleIds = new Set(formRanked
        .slice(0, splitQuota.conversationFormRowsPerCategoryLanguage['single-turn'])
        .map(spec => spec.scenarioFamilyId));
      for (const spec of assigned) {
        assignments.push({
          scenarioFamilyId: spec.scenarioFamilyId,
          primaryCategory: category,
          semanticClusterId: spec.semanticClusterId,
          split: splitQuota.name,
          conversationForm: singleIds.has(spec.scenarioFamilyId) ? 'single-turn' : 'multi-turn',
          rowIds: {
            en: `${spec.scenarioFamilyId}-en`,
            sw: `${spec.scenarioFamilyId}-sw`,
          },
        });
      }
    }
  }
  if (errors.length) throw new Error(`Scenario assignment failed:\n- ${errors.join('\n- ')}`);
  assignments.sort(compareAssignments);
  const approvals = options.approvals ?? {
    safeguardingProduct: { status: 'pending', evidenceRef: null },
    independentMlData: { status: 'pending', evidenceRef: null },
  };
  return {
    schema: 'com.saferide.ai.dataset-split-manifest',
    schemaVersion: 1,
    manifestId: options.manifestId ?? 'saferide-gemma4-v05-splits-candidate.1',
    datasetId: DATASET_ID,
    status: options.status ?? 'draft',
    planId: plan.planId,
    planSha256: options.planSha256 ?? canonicalSha256(plan),
    scenarioSpecSha256: options.scenarioSpecSha256 ?? canonicalSha256(specs),
    splitSeed: plan.splitSeed,
    assignmentAlgorithm: plan.assignmentAlgorithm,
    generatedFromPlanDate: '2026-08-01',
    assignmentInventorySha256: canonicalSha256(assignments),
    counts: {
      families: assignments.length,
      rows: assignments.length * LANGUAGES.length,
      bySplit: Object.fromEntries(SPLITS.map(split => [
        split,
        assignments.filter(entry => entry.split === split).length * LANGUAGES.length,
      ])),
    },
    approvals,
    assignments,
  };
}

export function compareAssignments(left, right) {
  return (SPLIT_ORDER.get(left.split) - SPLIT_ORDER.get(right.split))
    || CATEGORIES.indexOf(left.primaryCategory) - CATEGORIES.indexOf(right.primaryCategory)
    || left.scenarioFamilyId.localeCompare(right.scenarioFamilyId);
}

export function validateSplitManifestSemantics(manifest, plan, specs) {
  const errors = [];
  const assignments = manifest.assignments ?? [];
  if (manifest.planId !== plan.planId) errors.push('split manifest planId does not match plan');
  if (manifest.splitSeed !== plan.splitSeed) errors.push('split manifest seed does not match plan');
  if (manifest.assignmentInventorySha256 !== canonicalSha256(assignments)) {
    errors.push('split manifest assignment inventory hash is stale');
  }
  if (!unique(assignments.map(entry => entry.scenarioFamilyId))) errors.push('split manifest repeats a scenario family');
  const rowIds = assignments.flatMap(entry => Object.values(entry.rowIds ?? {}));
  if (!unique(rowIds)) errors.push('split manifest repeats a row ID');
  const specById = new Map((specs ?? []).map(spec => [spec.scenarioFamilyId, spec]));
  for (const assignment of assignments) {
    const spec = specById.get(assignment.scenarioFamilyId);
    if (!spec) errors.push(`${assignment.scenarioFamilyId} has no scenario specification`);
    else if (spec.primaryCategory !== assignment.primaryCategory || spec.semanticClusterId !== assignment.semanticClusterId) {
      errors.push(`${assignment.scenarioFamilyId} assignment metadata differs from its scenario specification`);
    }
  }
  const expectedAssignments = assignScenarioFamilies(specs, plan, {
    status: manifest.status,
    manifestId: manifest.manifestId,
    planSha256: manifest.planSha256,
    scenarioSpecSha256: manifest.scenarioSpecSha256,
    approvals: manifest.approvals,
  }).assignments;
  if (canonicalSha256(assignments) !== canonicalSha256(expectedAssignments)) {
    errors.push('split assignments are not the deterministic result of the pinned plan and seed');
  }
  return errors;
}

export function createAuthoringJobs(specs, manifest) {
  const specById = new Map(specs.map(spec => [spec.scenarioFamilyId, spec]));
  return manifest.assignments.flatMap(assignment => LANGUAGES.map(language => {
    const spec = specById.get(assignment.scenarioFamilyId);
    return {
      schema: 'com.saferide.ai.v05-authoring-job',
      schemaVersion: 1,
      jobId: `author:${assignment.rowIds[language]}`,
      rowId: assignment.rowIds[language],
      language,
      split: assignment.split,
      conversationForm: assignment.conversationForm,
      scenarioFamilyId: assignment.scenarioFamilyId,
      scenarioSpecSha256: canonicalSha256(spec),
      scenario: spec,
      maximumCandidates: 3,
      requiredInitialStatus: 'unreviewed',
      contentLoggingAllowed: false,
      classification: 'controlled',
    };
  }));
}

export function reviewablePayload(candidate) {
  const metadata = candidate.metadata ?? {};
  const authoring = candidate.authoring ?? {};
  return {
    id: candidate.id,
    candidateId: candidate.candidateId,
    datasetId: candidate.datasetId,
    split: candidate.split,
    messages: (candidate.messages ?? []).filter(message => message.role !== 'system'),
    metadata: {
      language: metadata.language,
      primaryCategory: metadata.primaryCategory,
      secondaryTags: metadata.secondaryTags,
      scenarioFamilyId: metadata.scenarioFamilyId,
      semanticClusterId: metadata.semanticClusterId,
      conversationForm: metadata.conversationForm,
      riskLevel: metadata.riskLevel,
      userGoalCode: metadata.userGoalCode,
      appState: metadata.appState,
      responseStrategy: metadata.responseStrategy,
      responseSkeletonId: metadata.responseSkeletonId,
      sourceKind: metadata.sourceKind,
      sourcePolicyRefs: metadata.sourcePolicyRefs,
      generatorVersion: metadata.generatorVersion,
      longResponseReason: metadata.longResponseReason,
    },
    authoring: {
      method: authoring.method,
      toolId: authoring.toolId,
      toolRevision: authoring.toolRevision,
      configurationSha256: authoring.configurationSha256,
      authoringPromptSha256: authoring.authoringPromptSha256,
      scenarioFamilyId: authoring.scenarioFamilyId,
      createdAt: authoring.createdAt,
      authorIdentityRef: authoring.authorIdentityRef,
      termsAssessmentRef: authoring.termsAssessmentRef,
      syntheticOnlyAttested: authoring.syntheticOnlyAttested,
    },
  };
}

export function candidateContentHash(candidate) {
  return canonicalSha256(reviewablePayload(candidate));
}

export function validateMessageRoles(candidate) {
  const errors = [];
  const roles = (candidate.messages ?? []).map(message => message?.role);
  const stage = candidate.stage;
  if (stage === 'candidate' && roles.includes('system')) {
    errors.push(`${candidate.id} candidate may not supply a system prompt; the final builder injects it`);
  }
  if (stage === 'final' && roles[0] !== 'system') errors.push(`${candidate.id} final row must start with the canonical system prompt`);
  const conversationRoles = roles[0] === 'system' ? roles.slice(1) : roles;
  if (conversationRoles.length < 2 || conversationRoles[0] !== 'user' || conversationRoles.at(-1) !== 'assistant') {
    errors.push(`${candidate.id} must start with user and end with assistant after the optional system message`);
  }
  conversationRoles.forEach((role, index) => {
    const expected = index % 2 === 0 ? 'user' : 'assistant';
    if (role !== expected) errors.push(`${candidate.id} conversation role ${index} must be ${expected}`);
  });
  const expectedForm = conversationRoles.length === 2 ? 'single-turn' : 'multi-turn';
  if (candidate.metadata?.conversationForm !== expectedForm) {
    errors.push(`${candidate.id} conversation form does not match its message sequence`);
  }
  return errors;
}

function stringsIn(value, location = 'value', output = []) {
  if (typeof value === 'string') output.push({ location, value });
  else if (Array.isArray(value)) value.forEach((entry, index) => stringsIn(entry, `${location}[${index}]`, output));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, entry]) => stringsIn(entry, `${location}.${key}`, output));
  return output;
}

export function privacyFindings(value, location = 'record') {
  const findings = [];
  for (const entry of stringsIn(value, location)) {
    for (const [code, pattern] of SECRET_AND_PRIVATE_PATTERNS) {
      if (pattern.test(entry.value)) findings.push({ code, location: entry.location });
    }
  }
  return findings;
}

export function lexicalLanguageAssessment(messages) {
  const tokens = normalizeText((messages ?? []).map(message => message.content).join(' ')).split(' ').filter(Boolean);
  const enScore = tokens.filter(token => ENGLISH_MARKERS.has(token)).length;
  const swScore = tokens.filter(token => KISWAHILI_MARKERS.has(token)).length;
  const predicted = enScore === swScore ? 'undetermined' : enScore > swScore ? 'en' : 'sw';
  const confidence = tokens.length === 0 ? 0 : Math.abs(enScore - swScore) / tokens.length;
  return {
    method: 'deterministic-stopword-proxy-v1',
    predicted,
    confidence: Number(confidence.toFixed(6)),
    requiresHumanReview: true,
  };
}

export function responseSkeletonId(messages) {
  const shape = (messages ?? []).filter(message => message?.role === 'assistant').map(message => {
    const tokens = normalizeText(message.content).split(' ').filter(Boolean);
    const openingTokens = new Set(tokens.slice(0, 8));
    const openingText = tokens.slice(0, 8).join(' ');
    const openingClass = /\b(?:cannot|can t|siwezi|haiwezekani)\b/.test(openingText)
      ? 'boundary'
      : ['if', 'ikiwa', 'kama'].some(token => openingTokens.has(token))
        ? 'conditional'
        : ['can', 'could', 'consider', 'unaweza', 'fikiria'].some(token => openingTokens.has(token))
          ? 'option'
          : ['sorry', 'pole', 'understand', 'naelewa'].some(token => openingTokens.has(token))
            ? 'empathy'
            : 'direct';
    return {
      words: tokens.length,
      openingClass,
      sentences: String(message.content).split(/[.!?]+/).filter(Boolean).length,
      question: /\?/.test(String(message.content)),
    };
  });
  return `skeleton-${canonicalSha256(shape).slice(0, 24)}`;
}

export function validateBlindEvaluation(prompts, splitManifest, plan, {
  schemas = compileV05Schemas(),
  corpusRows = [],
} = {}) {
  const errors = [];
  prompts.forEach((prompt, index) => errors.push(...schemaErrors(`blindPrompt[${index}]`, schemas.blindPrompt, prompt)));
  if (prompts.length !== plan.totals.blindEvaluationPrompts) {
    errors.push(`blind evaluation has ${prompts.length}/${plan.totals.blindEvaluationPrompts} prompts`);
  }
  for (const field of ['promptId', 'blindFamilyId', 'semanticClusterId']) {
    if (!unique(prompts.map(prompt => prompt[field]))) errors.push(`blind evaluation ${field} values must be unique`);
  }
  const frozenFamilies = new Set((splitManifest.assignments ?? []).map(assignment => assignment.scenarioFamilyId));
  const frozenClusters = new Set((splitManifest.assignments ?? []).map(assignment => assignment.semanticClusterId));
  const expectedRows = new Map((splitManifest.assignments ?? []).flatMap(assignment => (
    Object.values(assignment.rowIds ?? {}).map(rowId => [rowId, assignment.split])
  )));
  const corpusById = new Map(corpusRows.map(row => [row.id, row]));
  let corpusInventoryMismatchCount = 0;
  if (corpusRows.length !== plan.totals.rows || corpusById.size !== plan.totals.rows || expectedRows.size !== plan.totals.rows) {
    errors.push(`blind content-isolation check requires all ${plan.totals.rows} unique frozen corpus rows`);
  }
  for (const [rowId, split] of expectedRows) {
    const row = corpusById.get(rowId);
    if (!row || row.split !== split) corpusInventoryMismatchCount += 1;
  }
  if (corpusInventoryMismatchCount || [...corpusById.keys()].some(rowId => !expectedRows.has(rowId))) {
    errors.push('blind content-isolation corpus inventory differs from the frozen split manifest');
  }
  const corpusTurnHashes = new Set(corpusRows.flatMap(row => (row.messages ?? [])
    .map(message => normalizeText(message?.content ?? ''))
    .filter(Boolean)
    .map(content => sha256(content))));
  const blindTurnOwners = new Map();
  for (const prompt of prompts) {
    if (frozenFamilies.has(prompt.blindFamilyId) || frozenClusters.has(prompt.semanticClusterId)) {
      errors.push(`${prompt.promptId} overlaps a frozen corpus family or semantic cluster`);
    }
    const roles = (prompt.messages ?? []).map(message => message.role);
    roles.forEach((role, index) => {
      const expected = index % 2 === 0 ? 'user' : 'assistant';
      if (role !== expected) errors.push(`${prompt.promptId} conversation role ${index} must be ${expected}`);
    });
    if (roles.at(-1) !== 'user') errors.push(`${prompt.promptId} must end with the user turn to be generated`);
    const expectedForm = roles.length === 1 ? 'single-turn' : 'multi-turn';
    if (prompt.conversationForm !== expectedForm) errors.push(`${prompt.promptId} conversation form differs from its messages`);
    if (!prompt.promptId?.startsWith(`v05-blind-${prompt.primaryCategory}-${prompt.language}-`)) {
      errors.push(`${prompt.promptId} category or language differs from its ID`);
    }
    const competence = prompt.languageAssessment?.competence;
    if (prompt.language === 'en' && !['native-en', 'fluent-en'].includes(competence)) errors.push(`${prompt.promptId} lacks fluent English review`);
    if (prompt.language === 'sw' && !['native-sw', 'fluent-sw'].includes(competence)) errors.push(`${prompt.promptId} lacks native/fluent Kiswahili review`);
    for (const message of prompt.messages ?? []) {
      const contentHash = sha256(normalizeText(message?.content ?? ''));
      if (corpusTurnHashes.has(contentHash)) errors.push(`${prompt.promptId} reuses normalized turn content from the frozen corpus`);
      const existingPromptId = blindTurnOwners.get(contentHash);
      if (existingPromptId && existingPromptId !== prompt.promptId) errors.push(`${prompt.promptId} reuses normalized turn content from another blind prompt`);
      blindTurnOwners.set(contentHash, prompt.promptId);
    }
    for (const finding of privacyFindings({ messages: prompt.messages, authoring: prompt.authoring }, `blind prompt ${prompt.promptId}`)) {
      errors.push(`${finding.location} contains prohibited ${finding.code} material`);
    }
  }
  for (const category of CATEGORIES) {
    for (const language of LANGUAGES) {
      const count = prompts.filter(prompt => prompt.primaryCategory === category && prompt.language === language).length;
      if (count !== plan.totals.blindPromptsPerCategoryLanguage) {
        errors.push(`blind ${category}/${language} has ${count}/${plan.totals.blindPromptsPerCategoryLanguage} prompts`);
      }
    }
  }
  const multiTurn = prompts.filter(prompt => prompt.conversationForm === 'multi-turn').length;
  const highOrCritical = prompts.filter(prompt => ['high', 'critical'].includes(prompt.riskLevel)).length;
  if (multiTurn < 96) errors.push(`blind evaluation has ${multiTurn}/96 minimum multi-turn prompts`);
  if (highOrCritical < 120) errors.push(`blind evaluation has ${highOrCritical}/120 minimum high/critical prompts`);
  return {
    errors,
    counts: {
      prompts: prompts.length,
      multiTurn,
      highOrCritical,
      byLanguage: Object.fromEntries(LANGUAGES.map(language => [language, prompts.filter(prompt => prompt.language === language).length])),
      byCategory: Object.fromEntries(CATEGORIES.map(category => [category, prompts.filter(prompt => prompt.primaryCategory === category).length])),
    },
    inventorySha256: canonicalSha256(prompts.map(prompt => ({
      promptId: prompt.promptId,
      blindFamilyId: prompt.blindFamilyId,
      semanticClusterId: prompt.semanticClusterId,
      contentSha256: canonicalSha256(prompt.messages),
    })).sort((left, right) => left.promptId.localeCompare(right.promptId))),
  };
}

export function validateCandidate(candidate, context) {
  const errors = [
    ...schemaErrors(`candidate ${candidate.id ?? '<missing>'}`, context.schemas.example, candidate),
    ...validateMessageRoles(candidate),
  ];
  const assignment = context.assignmentByRowId.get(candidate.id);
  const spec = context.specById.get(candidate.metadata?.scenarioFamilyId);
  if (candidate.stage !== 'candidate') errors.push(`${candidate.id} imported authoring record must have stage=candidate`);
  if (candidate.authoring?.method === 'deterministic-mock' && context.allowTestFixtures !== true) {
    errors.push(`${candidate.id} deterministic mock candidates are test fixtures and cannot enter a production import`);
  }
  if (candidate.stage === 'candidate' && (candidate.metadata?.reviewLedgerRefs
    || candidate.metadata?.reviewableContentSha256 || candidate.metadata?.systemPromptSha256)) {
    errors.push(`${candidate.id} unreviewed candidate may not carry final review or system-prompt bindings`);
  }
  if (candidate.metadata?.reviewStatus !== 'unreviewed' || candidate.authoring?.status !== 'unreviewed') {
    errors.push(`${candidate.id} imported candidate must remain unreviewed until the restricted ledger selects it`);
  }
  if (!assignment) errors.push(`${candidate.id} is not a frozen family-language slot`);
  else {
    const language = Object.entries(assignment.rowIds).find(([, id]) => id === candidate.id)?.[0];
    if (candidate.split !== assignment.split) errors.push(`${candidate.id} split differs from the split manifest`);
    if (candidate.metadata?.language !== language) errors.push(`${candidate.id} language differs from the split manifest`);
    if (candidate.metadata?.primaryCategory !== assignment.primaryCategory) errors.push(`${candidate.id} category differs from the split manifest`);
    if (candidate.metadata?.scenarioFamilyId !== assignment.scenarioFamilyId) errors.push(`${candidate.id} family differs from the split manifest`);
    if (candidate.metadata?.semanticClusterId !== assignment.semanticClusterId) errors.push(`${candidate.id} semantic cluster differs from the split manifest`);
    if (candidate.metadata?.conversationForm !== assignment.conversationForm) errors.push(`${candidate.id} conversation form differs from the split manifest`);
  }
  if (!spec) errors.push(`${candidate.id} has no matching scenario specification`);
  else {
    if (candidate.authoring?.scenarioFamilyId !== spec.scenarioFamilyId) errors.push(`${candidate.id} provenance family differs from its scenario`);
    if (candidate.metadata?.riskLevel !== spec.riskLevel) errors.push(`${candidate.id} risk differs from its scenario`);
    if (candidate.metadata?.appState !== spec.appState) errors.push(`${candidate.id} app state differs from its scenario`);
    if (candidate.metadata?.responseStrategy !== spec.responseStrategy) errors.push(`${candidate.id} response strategy differs from its scenario`);
    if (canonicalSha256(candidate.metadata?.secondaryTags ?? []) !== canonicalSha256(spec.secondaryTags ?? [])) {
      errors.push(`${candidate.id} secondary tags differ from its scenario`);
    }
    if (canonicalSha256(candidate.metadata?.sourcePolicyRefs ?? []) !== canonicalSha256(spec.policyRefs ?? [])) {
      errors.push(`${candidate.id} policy references differ from its scenario`);
    }
  }
  for (const finding of privacyFindings({ messages: candidate.messages, authoring: candidate.authoring }, `candidate ${candidate.id}`)) {
    errors.push(`${finding.location} contains prohibited ${finding.code} material`);
  }
  if (candidate.authoring?.syntheticOnlyAttested !== true) errors.push(`${candidate.id} lacks a synthetic-only attestation`);
  if (candidate.metadata?.prohibitedDataScreen === 'failed') errors.push(`${candidate.id} failed its prohibited-data screen`);
  return errors;
}

export function candidateContext(specs, manifest, schemas = compileV05Schemas(), options = {}) {
  const assignmentByRowId = new Map();
  for (const assignment of manifest.assignments ?? []) {
    for (const rowId of Object.values(assignment.rowIds ?? {})) assignmentByRowId.set(rowId, assignment);
  }
  return {
    schemas,
    allowTestFixtures: options.allowTestFixtures === true,
    assignmentByRowId,
    specById: new Map(specs.map(spec => [spec.scenarioFamilyId, spec])),
  };
}

export function validateCandidateSet(candidates, specs, manifest, plan, options = {}) {
  const errors = [];
  const context = candidateContext(specs, manifest, options.schemas, options);
  const candidateIds = candidates.map(candidate => candidate.candidateId);
  if (!unique(candidateIds)) errors.push('candidate IDs must be unique');
  const byRow = new Map();
  for (const candidate of candidates) {
    errors.push(...validateCandidate(candidate, context));
    const entries = byRow.get(candidate.id) ?? [];
    entries.push(candidate);
    byRow.set(candidate.id, entries);
  }
  for (const [rowId, entries] of byRow) {
    if (entries.length > plan.candidateAuthoring.maximumCandidatesPerFamilyLanguage) {
      errors.push(`${rowId} has ${entries.length} candidates; maximum is ${plan.candidateAuthoring.maximumCandidatesPerFamilyLanguage}`);
    }
  }
  if (options.requireEverySlot) {
    for (const rowId of context.assignmentByRowId.keys()) {
      if (!byRow.has(rowId)) errors.push(`${rowId} has no imported candidate`);
    }
  }
  return { errors, byRow, context };
}

export function compareCandidates(left, right) {
  const split = (SPLIT_ORDER.get(left.split) - SPLIT_ORDER.get(right.split));
  return split || CATEGORIES.indexOf(left.metadata.primaryCategory) - CATEGORIES.indexOf(right.metadata.primaryCategory)
    || left.id.localeCompare(right.id) || left.candidateId.localeCompare(right.candidateId);
}

export function validatePrivateOutputRoot(outputPath, rootDir = REPO_ROOT) {
  const resolved = path.resolve(outputPath);
  const relative = path.relative(rootDir, resolved);
  const insideRepository = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  if (insideRepository && relative.split(path.sep)[0] !== '.ai-smoke') {
    throw new Error('Controlled or restricted v0.5 artifacts may be written only outside the repository or under ignored .ai-smoke/');
  }
  if (resolved === rootDir) throw new Error('Repository root cannot be an artifact output directory');
  return resolved;
}

export function assertRelativeArtifactPath(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
    throw new Error(`Unsafe artifact path: ${String(value)}`);
  }
}

export function contentFreeInventory(files) {
  return files.map(file => ({
    split: file.split,
    path: file.path,
    classification: file.classification,
    rowCount: file.rowCount,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    rowIdInventorySha256: file.rowIdInventorySha256,
  }));
}
