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
  SPLITS,
  canonicalSha256,
  compileV05Schemas,
  fileSha256,
  lexicalLanguageAssessment,
  normalizeLf,
  privacyFindings,
  readJson,
  readJsonl,
  schemaErrors,
  sha256,
  stableJson,
  validateSplitManifestSemantics,
  validatePlanSemantics,
  validatePrivateOutputRoot,
} from './lib/saferide-gemma4-v05.mjs';
import { normalizeText } from './saferide-gemma4-dataset-audit.mjs';
import { validateBuiltRows, validateScenarioMatrix } from './saferide-gemma4-v05-build.mjs';
import { validateSemanticLeakageArtifacts } from './saferide-gemma4-v05-semantic-check.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditScriptPath = fileURLToPath(import.meta.url);
const FINDING_SAMPLE_LIMIT = 100;

function usage() {
  return [
    'Usage: node scripts/saferide-gemma4-v05-audit.mjs --contract-check [--plan <json>]',
    '   or: --plan <json> --artifact-root <dir> --dataset-manifest <json>',
    '       --split-manifest <json> --scenarios <jsonl> --review-summary <json>',
    '       --semantic-report <json> --semantic-details <restricted-json>',
    '       --output <json> --details-output <restricted-json>',
    '',
    'The report is content-free: only counts, hashes, IDs, classifications, and similarity scores are emitted.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { plan: DEFAULT_PLAN_PATH, contractCheck: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--contract-check') args.contractCheck = true;
    else if (argument === '--plan') args.plan = argv[++index];
    else if (argument === '--artifact-root') args.artifactRoot = argv[++index];
    else if (argument === '--dataset-manifest') args.datasetManifest = argv[++index];
    else if (argument === '--split-manifest') args.splitManifest = argv[++index];
    else if (argument === '--scenarios') args.scenarios = argv[++index];
    else if (argument === '--review-summary') args.reviewSummary = argv[++index];
    else if (argument === '--semantic-report') args.semanticReport = argv[++index];
    else if (argument === '--semantic-details') args.semanticDetails = argv[++index];
    else if (argument === '--output') args.output = argv[++index];
    else if (argument === '--details-output') args.detailsOutput = argv[++index];
    else if (['--help', '-h'].includes(argument)) {
      console.log(usage());
      process.exit(0);
    } else throw new Error(`Unknown or incomplete argument: ${argument}\n\n${usage()}`);
  }
  return args;
}

function resolve(input) {
  return path.isAbsolute(input) ? input : path.join(repoRoot, input);
}

function words(value) {
  return normalizeText(value).split(' ').filter(Boolean);
}

function ngrams(tokens, size) {
  const result = new Set();
  for (let index = 0; index <= tokens.length - size; index += 1) {
    result.add(tokens.slice(index, index + size).join(' '));
  }
  return result;
}

function jaccard(left, right) {
  if (left.size === 0 && right.size === 0) return 1;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / Math.max(1, left.size + right.size - intersection);
}

function frequencies(tokens) {
  const result = new Map();
  for (const token of tokens) result.set(token, (result.get(token) ?? 0) + 1);
  return result;
}

function cosine(left, right) {
  let dot = 0;
  let leftSquare = 0;
  let rightSquare = 0;
  for (const value of left.values()) leftSquare += value * value;
  for (const value of right.values()) rightSquare += value * value;
  for (const [key, value] of left) dot += value * (right.get(key) ?? 0);
  if (leftSquare === 0 || rightSquare === 0) return 0;
  return dot / Math.sqrt(leftSquare * rightSquare);
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}

function turnDocuments(rows) {
  return rows.flatMap(row => row.messages.flatMap((message, turnIndex) => {
    if (!['user', 'assistant'].includes(message.role)) return [];
    const tokens = words(message.content);
    return [{
      rowId: row.id,
      split: row.split,
      language: row.metadata.language,
      role: message.role,
      turnIndex,
      exactHash: sha256(message.content),
      normalizedHash: sha256(normalizeText(message.content)),
      tokens,
      ngrams: ngrams(tokens, 3),
      frequencies: frequencies(tokens),
    }];
  }));
}

function conversationDocuments(rows) {
  return rows.map(row => {
    const messages = row.messages.filter(message => message.role !== 'system');
    return {
      rowId: row.id,
      split: row.split,
      exactHash: sha256(JSON.stringify(messages)),
      normalizedHash: sha256(messages.map(message => `${message.role}:${normalizeText(message.content)}`).join('\n')),
    };
  });
}

function collisions(documents, hashField) {
  const groups = new Map();
  for (const document of documents) {
    const entries = groups.get(document[hashField]) ?? [];
    entries.push(document);
    groups.set(document[hashField], entries);
  }
  return [...groups.entries()].flatMap(([hash, entries]) => {
    const splits = [...new Set(entries.map(entry => entry.split))].sort();
    if (splits.length < 2) return [];
    return [{
      hash,
      role: entries[0].role ?? 'conversation',
      splits,
      rowIds: [...new Set(entries.map(entry => entry.rowId))].sort(),
    }];
  });
}

export function analyzeCrossSplitSimilarity(documents, policy) {
  let pairCount = 0;
  let maximumNgramSimilarity = 0;
  let maximumLexicalSemanticProxy = 0;
  const samples = [];
  for (let leftIndex = 0; leftIndex < documents.length; leftIndex += 1) {
    const left = documents[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < documents.length; rightIndex += 1) {
      const right = documents[rightIndex];
      if (left.split === right.split || left.role !== right.role) continue;
      const ngramSimilarity = jaccard(left.ngrams, right.ngrams);
      const lexicalSimilarity = cosine(left.frequencies, right.frequencies);
      maximumNgramSimilarity = Math.max(maximumNgramSimilarity, ngramSimilarity);
      maximumLexicalSemanticProxy = Math.max(maximumLexicalSemanticProxy, lexicalSimilarity);
      if (ngramSimilarity < policy.ngramJaccardThreshold && lexicalSimilarity < policy.lexicalSemanticProxyThreshold) continue;
      pairCount += 1;
      if (samples.length < FINDING_SAMPLE_LIMIT) {
        samples.push({
          leftRowId: left.rowId,
          leftSplit: left.split,
          rightRowId: right.rowId,
          rightSplit: right.split,
          role: left.role,
          ngramSimilarity: Number(ngramSimilarity.toFixed(6)),
          lexicalSemanticProxy: Number(lexicalSimilarity.toFixed(6)),
        });
      }
    }
  }
  return {
    pairCount,
    maximumNgramSimilarity: Number(maximumNgramSimilarity.toFixed(6)),
    maximumLexicalSemanticProxy: Number(maximumLexicalSemanticProxy.toFixed(6)),
    samples,
    samplesTruncated: pairCount > samples.length,
  };
}

function distinctMetric(documents, size) {
  let total = 0;
  const distinct = new Set();
  for (const document of documents) {
    for (let index = 0; index <= document.tokens.length - size; index += 1) {
      distinct.add(document.tokens.slice(index, index + size).join(' '));
      total += 1;
    }
  }
  return total ? distinct.size / total : 0;
}

function ratioByHash(documents) {
  return new Set(documents.map(document => document.normalizedHash)).size / Math.max(1, documents.length);
}

function responseDiversity(rows, assistantDocuments) {
  const openings = new Map();
  for (const document of assistantDocuments) {
    const opening = document.tokens.slice(0, 6).join(' ');
    openings.set(opening, (openings.get(opening) ?? 0) + 1);
  }
  const skeletons = new Map();
  for (const row of rows) {
    const id = row.metadata.responseSkeletonId;
    skeletons.set(id, (skeletons.get(id) ?? 0) + row.messages.filter(message => message.role === 'assistant').length);
  }
  const lengths = assistantDocuments.map(document => document.tokens.length);
  const assistantCount = Math.max(1, assistantDocuments.length);
  return {
    assistantTurnCount: assistantDocuments.length,
    uniqueAssistantTargetCount: new Set(assistantDocuments.map(document => document.normalizedHash)).size,
    uniqueAssistantTargetRatio: ratioByHash(assistantDocuments),
    distinct1: distinctMetric(assistantDocuments, 1),
    distinct2: distinctMetric(assistantDocuments, 2),
    distinct3: distinctMetric(assistantDocuments, 3),
    highestSixWordOpeningShare: Math.max(0, ...openings.values()) / assistantCount,
    largestResponseSkeletonShare: Math.max(0, ...skeletons.values()) / assistantCount,
    responseLengthWords: {
      min: lengths.length ? Math.min(...lengths) : 0,
      p50: percentile(lengths, 0.5),
      p95: percentile(lengths, 0.95),
      max: Math.max(0, ...lengths),
    },
  };
}

function responseLengthByCell(rows) {
  const cells = [];
  for (const split of SPLITS) {
    for (const language of LANGUAGES) {
      for (const category of CATEGORIES) {
        const lengths = rows
          .filter(row => row.split === split
            && row.metadata.language === language
            && row.metadata.primaryCategory === category)
          .flatMap(row => row.messages.filter(message => message.role === 'assistant'))
          .map(message => words(message.content).length);
        cells.push({
          split,
          language,
          category,
          assistantTurns: lengths.length,
          min: lengths.length ? Math.min(...lengths) : 0,
          p50: percentile(lengths, 0.5),
          p95: percentile(lengths, 0.95),
          max: Math.max(0, ...lengths),
        });
      }
    }
  }
  return cells;
}

function exactDistribution(rows) {
  const bySplit = Object.fromEntries(SPLITS.map(split => [split, rows.filter(row => row.split === split).length]));
  const byLanguage = Object.fromEntries(LANGUAGES.map(language => [language, rows.filter(row => row.metadata.language === language).length]));
  const byCategory = Object.fromEntries(CATEGORIES.map(category => [category, rows.filter(row => row.metadata.primaryCategory === category).length]));
  const byForm = Object.fromEntries(['single-turn', 'multi-turn'].map(form => [form, rows.filter(row => row.metadata.conversationForm === form).length]));
  return { bySplit, byLanguage, byCategory, byForm };
}

function behaviorDistribution(specs, manifest) {
  const specById = new Map(specs.map(spec => [spec.scenarioFamilyId, spec]));
  const result = {
    safeNextStep: 0,
    pureRefusal: 0,
    explicitUncertainty: 0,
    stateDistinction: 0,
    counterfactual: 0,
    benignHardNegative: 0,
    adversarialPressure: 0,
    safetyHighOrCritical: 0,
  };
  for (const assignment of manifest.assignments ?? []) {
    const spec = specById.get(assignment.scenarioFamilyId);
    for (const [key, enabled] of Object.entries(spec?.behaviorFlags ?? {})) if (enabled) result[key] += LANGUAGES.length;
    if (assignment.split === 'safety-holdout' && ['high', 'critical'].includes(spec?.riskLevel)) result.safetyHighOrCritical += LANGUAGES.length;
  }
  return result;
}

function validateBehaviorDistribution(distribution, plan) {
  const failures = [];
  const quota = plan.behaviorQuotas;
  for (const [key, expected] of Object.entries({
    safeNextStep: quota.minimumSafeNextStepRows,
    explicitUncertainty: quota.minimumExplicitUncertaintyRows,
    stateDistinction: quota.minimumStateDistinctionRows,
    counterfactual: quota.minimumCounterfactualRows,
    benignHardNegative: quota.minimumBenignHardNegativeRows,
    adversarialPressure: quota.minimumAdversarialPressureRows,
    safetyHighOrCritical: quota.minimumSafetyHoldoutHighOrCriticalRows,
  })) if (distribution[key] < expected) failures.push(`${key} ${distribution[key]} is below ${expected}`);
  if (distribution.pureRefusal > quota.maximumPureRefusalRows) failures.push(`pureRefusal ${distribution.pureRefusal} exceeds ${quota.maximumPureRefusalRows}`);
  return failures;
}

function validateArtifactFiles(datasetManifest, artifactRoot) {
  const errors = [];
  const rows = [];
  const expectedRows = { train: 1600, dev: 300, 'quality-holdout': 300, 'safety-holdout': 400 };
  const seenSplits = new Set();
  for (const entry of datasetManifest.files ?? []) {
    if (seenSplits.has(entry.split)) errors.push(`${entry.split} appears more than once in the artifact manifest`);
    seenSplits.add(entry.split);
    const expectedClass = ['train', 'dev'].includes(entry.split) ? 'controlled' : 'restricted';
    if (entry.classification !== expectedClass) errors.push(`${entry.split} classification must be ${expectedClass}`);
    if (entry.rowCount !== expectedRows[entry.split]) errors.push(`${entry.split} artifact row count quota is incorrect`);
    const fullPath = path.resolve(artifactRoot, entry.path);
    const relative = path.relative(artifactRoot, fullPath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      errors.push(`${entry.split} path escapes artifact root`);
      continue;
    }
    if (!fs.existsSync(fullPath)) {
      errors.push(`${entry.split} artifact is missing`);
      continue;
    }
    const text = fs.readFileSync(fullPath, 'utf8');
    if (sha256(text) !== entry.sha256) errors.push(`${entry.split} artifact hash does not match manifest`);
    if (Buffer.byteLength(text) !== entry.sizeBytes) errors.push(`${entry.split} artifact size does not match manifest`);
    const splitRows = readJsonl(fullPath);
    if (splitRows.length !== entry.rowCount) errors.push(`${entry.split} artifact row count does not match manifest`);
    if (splitRows.some(row => row.split !== entry.split)) errors.push(`${entry.split} artifact contains a different split`);
    if (sha256(splitRows.map(row => row.id).join('\n')) !== entry.rowIdInventorySha256) errors.push(`${entry.split} row-ID inventory hash is stale`);
    rows.push(...splitRows);
  }
  if (seenSplits.size !== SPLITS.length || SPLITS.some(split => !seenSplits.has(split))) {
    errors.push('artifact manifest must contain each split exactly once');
  }
  if (datasetManifest.datasetInventorySha256 !== sha256(stableJson(datasetManifest.files ?? []))) {
    errors.push('dataset artifact inventory hash is stale');
  }
  return { errors, rows };
}

function checkReviewSummary(rows, reviewSummary) {
  const findings = [];
  if (reviewSummary.passed !== true || reviewSummary.finalRowCount !== rows.length) findings.push('review summary does not pass or cover every row');
  if (reviewSummary.primaryReviewCount !== rows.length || reviewSummary.safetyDomainReviewCount < rows.length) {
    findings.push('review summary lacks primary and safeguarding coverage for every selected row');
  }
  if ((reviewSummary.specialistDomainReviewCount ?? 0) < 1820) findings.push('review summary lacks required specialist-domain coverage');
  const selectionByRow = new Map((reviewSummary.selections ?? []).map(selection => [selection.rowId, selection]));
  for (const row of rows) {
    const selection = selectionByRow.get(row.id);
    if (!selection) {
      findings.push(`${row.id} is missing from review selection inventory`);
      continue;
    }
    if (selection.candidateId !== row.candidateId
      || selection.reviewableContentSha256 !== row.metadata.reviewableContentSha256
      || stableJson(selection.reviewRefs) !== stableJson(row.metadata.reviewLedgerRefs)) {
      findings.push(`${row.id} review summary binding differs from final row metadata`);
    }
  }
  return findings;
}

export function auditV05Dataset({ rows, plan, specs, splitManifest, datasetManifest, semanticReport, reviewSummary, bindings = {}, detailsOutput = null }) {
  const failures = [];
  const structuralFindings = [
    ...validateScenarioMatrix(specs, plan),
    ...validateSplitManifestSemantics(splitManifest, plan, specs),
    ...validateBuiltRows(rows, plan, datasetManifest.bindings.systemPromptTextSha256),
  ];
  if (structuralFindings.length) failures.push(`structural: ${structuralFindings.length} mandatory findings`);

  const privateFindings = rows.flatMap(row => privacyFindings(row.messages, `row ${row.id}.messages`));
  if (privateFindings.length) failures.push(`privacy: ${privateFindings.length} prohibited-pattern findings`);

  const provenanceFindings = [];
  for (const row of rows) {
    if (row.metadata.sourceKind !== 'repository-authored-synthetic' || row.authoring.syntheticOnlyAttested !== true) {
      provenanceFindings.push(`${row.id} is not attested synthetic`);
    }
    for (const field of ['toolId', 'toolRevision', 'configurationSha256', 'authoringPromptSha256', 'termsAssessmentRef']) {
      if (!row.authoring[field]) provenanceFindings.push(`${row.id} lacks authoring.${field}`);
    }
  }
  if (provenanceFindings.length) failures.push(`provenance: ${provenanceFindings.length} incomplete or non-synthetic records`);

  const languageMismatches = [];
  let languageUndetermined = 0;
  for (const row of rows) {
    const assessment = lexicalLanguageAssessment(row.messages.filter(message => message.role !== 'system'));
    if (assessment.predicted === 'undetermined') languageUndetermined += 1;
    else if (assessment.predicted !== row.metadata.language) languageMismatches.push({ rowId: row.id, expected: row.metadata.language, ...assessment });
  }
  const languageReview = reviewSummary.languageAssessment ?? {};
  const reviewedLanguageCount = (languageReview.agreed ?? 0)
    + (languageReview.adjudicatedMismatch ?? 0)
    + (languageReview.adjudicatedUndetermined ?? 0);
  const languageReviewFailures = [];
  if (reviewedLanguageCount !== rows.length || (languageReview.blocked ?? 0) !== 0) {
    languageReviewFailures.push('primary language assessment coverage is incomplete or blocked');
  }
  if ((languageReview.adjudicatedMismatch ?? 0) !== languageMismatches.length) {
    languageReviewFailures.push('language proxy mismatch count is not fully adjudicated');
  }
  if ((languageReview.adjudicatedUndetermined ?? 0) !== languageUndetermined) {
    languageReviewFailures.push('undetermined language proxy count is not fully adjudicated');
  }
  if (languageReviewFailures.length) failures.push(`language: ${languageReviewFailures.length} mandatory findings`);

  const turns = turnDocuments(rows);
  const conversations = conversationDocuments(rows);
  const exactTurn = collisions(turns, 'exactHash');
  const normalizedTurn = collisions(turns, 'normalizedHash');
  const exactConversation = collisions(conversations, 'exactHash');
  const normalizedConversation = collisions(conversations, 'normalizedHash');
  const nearDuplicates = analyzeCrossSplitSimilarity(turns, plan.auditPolicy);
  for (const [name, values] of Object.entries({ exactTurn, normalizedTurn, exactConversation, normalizedConversation })) {
    if (values.length) failures.push(`overlap: ${name} has ${values.length} cross-split collisions`);
  }
  if (nearDuplicates.pairCount > plan.auditPolicy.maximumUnresolvedNearDuplicatePairs) {
    failures.push(`overlap: ${nearDuplicates.pairCount} n-gram or lexical-semantic cross-split pairs exceed policy`);
  }

  const assistants = turns.filter(document => document.role === 'assistant');
  const users = turns.filter(document => document.role === 'user');
  const diversity = responseDiversity(rows, assistants);
  diversity.responseLengthBySplitLanguageCategory = responseLengthByCell(rows);
  diversity.uniqueUserTurnCount = new Set(users.map(document => document.normalizedHash)).size;
  diversity.uniqueUserTurnRatio = ratioByHash(users);
  if (diversity.uniqueAssistantTargetRatio < plan.auditPolicy.minimumUniqueAssistantTargetRatio) failures.push('diversity: unique assistant-target ratio is below policy');
  if (diversity.uniqueUserTurnRatio < plan.auditPolicy.minimumUniqueUserTurnRatio) failures.push('diversity: unique user-turn ratio is below policy');
  if (diversity.highestSixWordOpeningShare > plan.auditPolicy.maximumSixWordOpeningShare) failures.push('diversity: repeated six-word opening share exceeds policy');
  if (diversity.largestResponseSkeletonShare > plan.auditPolicy.maximumResponseSkeletonShare) failures.push('diversity: response-skeleton share exceeds policy');
  let outOfRangeResponses = 0;
  for (const row of rows) {
    for (const message of row.messages.filter(item => item.role === 'assistant')) {
      const length = words(message.content).length;
      if ((length < plan.auditPolicy.normalResponseWordMinimum || length > plan.auditPolicy.normalResponseWordMaximum)
        && !row.metadata.longResponseReason) outOfRangeResponses += 1;
    }
  }
  if (outOfRangeResponses) failures.push(`diversity: ${outOfRangeResponses} assistant responses are outside normal length without a reason`);

  const distribution = exactDistribution(rows);
  distribution.behavior = behaviorDistribution(specs, splitManifest);
  const behaviorFailures = validateBehaviorDistribution(distribution.behavior, plan);
  if (behaviorFailures.length) failures.push(`distribution: ${behaviorFailures.length} behavior quota findings`);

  const semanticErrors = [];
  if (semanticReport.status !== 'passed') semanticErrors.push('external semantic report is not passed');
  if (semanticReport.unresolvedPairCount !== 0) semanticErrors.push('external semantic report has unresolved pairs');
  if (semanticReport.rowCount !== rows.length) semanticErrors.push('external semantic report row count differs from dataset');
  if (semanticReport.threshold !== plan.auditPolicy.externalEmbeddingThreshold) semanticErrors.push('external semantic threshold differs from plan');
  if (semanticReport.datasetArtifactManifestSha256 !== bindings.datasetManifestSha256) semanticErrors.push('external semantic report dataset-manifest hash mismatch');
  if (semanticReport.splitManifestSha256 !== bindings.splitManifestSha256) semanticErrors.push('external semantic report split-manifest hash mismatch');
  if (semanticReport.review?.status !== 'approved') semanticErrors.push('external semantic report lacks independent ML/data approval');
  if (!semanticReport.restrictedDetails?.sha256 || semanticReport.restrictedDetails?.classification !== 'restricted') semanticErrors.push('external semantic row details are not hash-bound and restricted');
  if (!semanticReport.clusterDistribution?.distributionSha256) semanticErrors.push('external semantic cluster distribution is missing');
  if (semanticErrors.length) failures.push(`semantic: ${semanticErrors.length} mandatory findings`);

  const reviewFindings = checkReviewSummary(rows, reviewSummary);
  if (reviewFindings.length) failures.push(`reviews: ${reviewFindings.length} row-selection binding findings`);

  const uniqueFailures = [...new Set(failures)];
  const detailFindings = {
    structural: structuralFindings,
    privacy: privateFindings,
    provenance: provenanceFindings,
    language: [...languageMismatches, ...languageReviewFailures],
    exactTurn,
    normalizedTurn,
    exactConversation,
    normalizedConversation,
    nearDuplicate: nearDuplicates.samples,
    distribution: behaviorFailures,
    semantic: semanticErrors,
    reviews: reviewFindings,
  };
  const findingInventorySha256 = canonicalSha256(detailFindings);
  if (detailsOutput) {
    Object.assign(detailsOutput, {
      schema: 'com.saferide.ai.v05-dataset-audit-details',
      schemaVersion: 1,
      datasetId: DATASET_ID,
      classification: 'restricted',
      containsRawText: false,
      bindings: {
        planSha256: bindings.planSha256,
        scenarioSpecSha256: bindings.scenarioSpecSha256,
        splitManifestSha256: bindings.splitManifestSha256,
        datasetManifestSha256: bindings.datasetManifestSha256,
        reviewSummarySha256: bindings.reviewSummarySha256,
        semanticReportSha256: bindings.semanticReportSha256,
      },
      findings: detailFindings,
      findingInventorySha256,
    });
  }
  return {
    schema: 'com.saferide.ai.v05-dataset-audit',
    schemaVersion: 1,
    datasetId: DATASET_ID,
    auditId: 'saferide-gemma4-v05-dataset-audit-candidate.1',
    bindings: {
      planSha256: bindings.planSha256,
      scenarioSpecSha256: bindings.scenarioSpecSha256,
      splitManifestSha256: bindings.splitManifestSha256,
      datasetManifestSha256: bindings.datasetManifestSha256,
      reviewSummarySha256: bindings.reviewSummarySha256,
      semanticReportSha256: bindings.semanticReportSha256,
      datasetInventorySha256: datasetManifest.datasetInventorySha256,
      policySha256: datasetManifest.bindings.policySha256,
      systemPromptTextSha256: datasetManifest.bindings.systemPromptTextSha256,
    },
    counts: {
      rows: rows.length,
      families: new Set(rows.map(row => row.metadata.scenarioFamilyId)).size,
      assistantTurns: assistants.length,
      userTurns: users.length,
    },
    structural: { passed: structuralFindings.length === 0, findingCount: structuralFindings.length },
    privacy: { passed: privateFindings.length === 0, findingCount: privateFindings.length, detectorCount: 13 },
    provenance: { passed: provenanceFindings.length === 0, findingCount: provenanceFindings.length },
    language: {
      passed: languageReviewFailures.length === 0,
      findingCount: languageReviewFailures.length,
      lexicalProxyMismatchCount: languageMismatches.length,
      lexicalProxyUndeterminedCount: languageUndetermined,
      humanNativeOrFluentReviewRequired: true,
      reviewedCount: reviewedLanguageCount,
      adjudicatedMismatchCount: languageReview.adjudicatedMismatch ?? 0,
      adjudicatedUndeterminedCount: languageReview.adjudicatedUndetermined ?? 0,
    },
    distribution: {
      passed: behaviorFailures.length === 0 && structuralFindings.length === 0,
      findingCount: behaviorFailures.length,
      ...distribution,
    },
    overlap: {
      exactTurnCount: exactTurn.length,
      normalizedTurnCount: normalizedTurn.length,
      exactConversationCount: exactConversation.length,
      normalizedConversationCount: normalizedConversation.length,
      nearDuplicatePairCount: nearDuplicates.pairCount,
      maximumNgramSimilarity: nearDuplicates.maximumNgramSimilarity,
      maximumLexicalSemanticProxy: nearDuplicates.maximumLexicalSemanticProxy,
      samplesTruncated: nearDuplicates.samplesTruncated,
    },
    diversity: { ...diversity, outOfRangeResponses },
    semanticLeakage: {
      status: semanticReport.status,
      method: semanticReport.method,
      threshold: semanticReport.threshold,
      crossSplitPairCount: semanticReport.crossSplitPairCount,
      unresolvedPairCount: semanticReport.unresolvedPairCount,
      maximumSimilarity: semanticReport.maximumSimilarity,
      clusterDistribution: semanticReport.clusterDistribution,
      reportSha256: bindings.semanticReportSha256,
      humanAdjudicationRequired: true,
    },
    reviewCoverage: {
      passed: reviewFindings.length === 0,
      findingCount: reviewFindings.length,
      approvedRows: reviewSummary.finalRowCount,
      primaryReviews: reviewSummary.primaryReviewCount,
      safetyDomainReviews: reviewSummary.safetyDomainReviewCount,
      specialistDomainReviews: reviewSummary.specialistDomainReviewCount,
      adjudications: reviewSummary.adjudicationRecordCount,
    },
    restrictedDetails: {
      classification: 'restricted',
      containsRawText: false,
      rowIdentifiersPublic: false,
      findingCount: Object.values(detailFindings).reduce((total, entries) => total + entries.length, 0),
      findingInventorySha256,
    },
    implementation: {
      path: 'scripts/saferide-gemma4-v05-audit.mjs',
      sha256: fileSha256(auditScriptPath),
    },
    passed: uniqueFailures.length === 0,
    failures: uniqueFailures,
  };
}

function contractCheck(planPath) {
  const schemas = compileV05Schemas();
  const plan = readJson(planPath);
  const errors = [...schemaErrors('plan', schemas.plan, plan), ...validatePlanSemantics(plan)];
  if (plan.auditPolicy.maximumUnresolvedNearDuplicatePairs !== 0) errors.push('near-duplicate policy must fail closed at zero unresolved pairs');
  if (errors.length) {
    errors.forEach(error => console.error(`- ${error}`));
    return 1;
  }
  console.log('SafeRide v0.5 audit contract: PASS.');
  console.log('External embedding analysis and independent adjudication remain mandatory for a real corpus.');
  return 0;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const planPath = resolve(args.plan);
  if (args.contractCheck) return contractCheck(planPath);
  for (const field of ['artifactRoot', 'datasetManifest', 'splitManifest', 'scenarios', 'reviewSummary', 'semanticReport', 'semanticDetails', 'output', 'detailsOutput']) {
    if (!args[field]) throw new Error(`--${field.replace(/[A-Z]/g, value => `-${value.toLowerCase()}`)} is required`);
  }
  const paths = Object.fromEntries(['datasetManifest', 'splitManifest', 'scenarios', 'reviewSummary', 'semanticReport', 'semanticDetails']
    .map(field => [field, resolve(args[field])]));
  paths.semanticDetails = validatePrivateOutputRoot(paths.semanticDetails);
  const artifactRoot = validatePrivateOutputRoot(resolve(args.artifactRoot));
  const schemas = compileV05Schemas();
  const plan = readJson(planPath);
  const datasetManifest = readJson(paths.datasetManifest);
  const splitManifest = readJson(paths.splitManifest);
  const specs = readJsonl(paths.scenarios);
  const reviewSummary = readJson(paths.reviewSummary);
  const semanticReport = readJson(paths.semanticReport);
  const semanticDetails = readJson(paths.semanticDetails);
  const errors = [
    ...schemaErrors('plan', schemas.plan, plan),
    ...schemaErrors('datasetManifest', schemas.datasetManifest, datasetManifest),
    ...schemaErrors('splitManifest', schemas.splitManifest, splitManifest),
    ...schemaErrors('semanticReport', schemas.semanticReport, semanticReport),
    ...validateSemanticLeakageArtifacts({
      report: semanticReport,
      details: semanticDetails,
      splitManifest,
      datasetManifestSha256: fileSha256(paths.datasetManifest),
      splitManifestSha256: fileSha256(paths.splitManifest),
      detailsSha256: fileSha256(paths.semanticDetails),
      schemas,
    }),
  ];
  if (datasetManifest.bindings.planSha256 !== fileSha256(planPath)) errors.push('dataset manifest plan hash is stale');
  if (datasetManifest.bindings.scenarioSpecSha256 !== fileSha256(paths.scenarios)) errors.push('dataset manifest scenario hash is stale');
  if (datasetManifest.bindings.splitManifestSha256 !== fileSha256(paths.splitManifest)) errors.push('dataset manifest split hash is stale');
  const artifacts = validateArtifactFiles(datasetManifest, artifactRoot);
  errors.push(...artifacts.errors);
  if (errors.length) throw new Error(`Dataset audit inputs failed:\n- ${errors.join('\n- ')}`);
  const details = {};
  const report = auditV05Dataset({
    rows: artifacts.rows,
    plan,
    specs,
    splitManifest,
    datasetManifest,
    semanticReport,
    reviewSummary,
    bindings: {
      planSha256: fileSha256(planPath),
      scenarioSpecSha256: fileSha256(paths.scenarios),
      splitManifestSha256: fileSha256(paths.splitManifest),
      datasetManifestSha256: fileSha256(paths.datasetManifest),
      reviewSummarySha256: fileSha256(paths.reviewSummary),
      semanticReportSha256: fileSha256(paths.semanticReport),
    },
    detailsOutput: details,
  });
  const reportErrors = schemaErrors('audit', schemas.audit, report);
  if (reportErrors.length) throw new Error(`Generated audit schema failed:\n- ${reportErrors.join('\n- ')}`);
  const detailErrors = schemaErrors('auditDetails', schemas.auditDetails, details);
  if (detailErrors.length) throw new Error(`Generated restricted audit details failed:\n- ${detailErrors.join('\n- ')}`);
  const detailsPath = validatePrivateOutputRoot(resolve(args.detailsOutput));
  fs.mkdirSync(path.dirname(detailsPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(detailsPath, `${JSON.stringify(details, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(detailsPath, 0o600);
  const output = resolve(args.output);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`SafeRide v0.5 dataset audit: ${report.passed ? 'PASS' : 'BLOCKED'}`);
  console.log(`Rows: ${report.counts.rows}; families: ${report.counts.families}; findings: ${report.failures.length}`);
  console.log(`Audit SHA-256: ${fileSha256(output)}`);
  console.log(`Restricted detail SHA-256: ${fileSha256(detailsPath)} (row identifiers only; no raw text).`);
  if (!report.passed) {
    report.failures.forEach(failure => console.error(`- ${failure}`));
    return 1;
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
