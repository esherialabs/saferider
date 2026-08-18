import fs from 'node:fs';

import {
  CATEGORIES,
  DATASET_ID,
  LANGUAGES,
  assignScenarioFamilies,
  canonicalSha256,
  candidateContentHash,
  expectedReviewStatus,
  lexicalLanguageAssessment,
  readJson,
  responseSkeletonId,
  sha256,
} from '../../lib/saferide-gemma4-v05.mjs';
import { buildFinalDataset } from '../../saferide-gemma4-v05-build.mjs';

const SPECIALISTS = Object.freeze({
  privacy: ['privacy-security'], legal: ['legal'], medical: ['clinical-medical'],
  emergency: ['clinical-medical'], tone: [], coercion: [], fabrication: [],
  product: ['product-mobile-api'], jailbreak: ['technical-ml', 'privacy-security'], noNewFacts: [],
});

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);

export function v05Plan() {
  return readJson(new URL('../../../config/ai/datasets/saferide-gemma4-v05-plan.json', import.meta.url));
}

export function makeScenarioSpecs(plan = v05Plan()) {
  return CATEGORIES.flatMap(category => Array.from({ length: 130 }, (_, offset) => {
    const number = String(offset + 1).padStart(4, '0');
    const categoryCode = category.toLowerCase();
    return {
      schema: 'com.saferide.ai.scenario-spec',
      schemaVersion: 1,
      scenarioFamilyId: `v05-${category}-family-${number}`,
      primaryCategory: category,
      secondaryTags: [],
      semanticClusterId: `v05-cluster-${categoryCode}-${number}`,
      riskLevel: 'high',
      userGoal: `synthetic ${categoryCode} test intent ${number}`,
      urgency: 'uncertain-danger',
      emotionalState: 'uncertain',
      appState: 'local-draft',
      informationState: 'unknown',
      unsafePressure: 'synthetic pressure pattern only',
      requiredBehavior: ['preserve agency and verified state'],
      prohibitedBehavior: ['invent facts or authority'],
      responseStrategy: `strategy-${categoryCode}`,
      policyRefs: ['POLICY-TEST-BOUNDARY'],
      behaviorFlags: {
        safeNextStep: offset < 80,
        pureRefusal: false,
        explicitUncertainty: offset < 26,
        stateDistinction: offset < 26,
        counterfactual: offset < 26,
        benignHardNegative: offset < 20,
        adversarialPressure: offset < 26,
      },
      sourceKind: 'repository-authored-synthetic-scenario',
      minorSpecific: false,
      matrixReview: { status: 'approved', evidenceRef: `fixture:matrix:${categoryCode}:${number}` },
    };
  }));
}

export function makeSplitManifest(specs, plan = v05Plan()) {
  return assignScenarioFamilies(specs, plan, {
    status: 'frozen',
    manifestId: 'saferide-gemma4-v05-splits-test.1',
    planSha256: canonicalSha256(plan),
    scenarioSpecSha256: canonicalSha256(specs),
    approvals: {
      safeguardingProduct: { status: 'approved', evidenceRef: 'fixture:split:safeguarding' },
      independentMlData: { status: 'approved', evidenceRef: 'fixture:split:ml-data' },
    },
  });
}

function uniqueTokens(prefix, count) {
  return Array.from({ length: count }, (_, index) => `${prefix}word${String(index + 1).padStart(2, '0')}`);
}

function messagesFor(assignment, language) {
  const base = `${assignment.scenarioFamilyId.toLowerCase().replaceAll('-', '')}${language}`;
  const compactBase = sha256(base).slice(0, 12);
  const familyNumber = Number(assignment.scenarioFamilyId.match(/([0-9]{4})$/)?.[1] ?? 1);
  const targetAssistantWords = 25 + ((familyNumber - 1) % 96);
  const userMarkers = language === 'en' ? ['the', 'and', 'this', 'safe'] : ['na', 'ni', 'hii', 'salama'];
  const assistantMarkers = language === 'en' ? ['you', 'can', 'keep', 'your'] : ['unaweza', 'kwa', 'usalama', 'yako'];
  const user = turn => ({ role: 'user', content: [...userMarkers, ...uniqueTokens(`${compactBase}u${turn}`, 10)].join(' ') });
  const assistant = turn => ({
    role: 'assistant',
    content: [
      assistantMarkers[0], assistantMarkers[1], `${compactBase}opening${turn}`, ...assistantMarkers.slice(2),
      ...uniqueTokens(`${compactBase}a${turn}`, targetAssistantWords - assistantMarkers.length - 1),
    ].join(' '),
  });
  return assignment.conversationForm === 'single-turn'
    ? [user(1), assistant(1)]
    : [user(1), assistant(1), user(2), assistant(2)];
}

export function makeCandidates(specs, manifest) {
  const specById = new Map(specs.map(spec => [spec.scenarioFamilyId, spec]));
  return manifest.assignments.flatMap(assignment => LANGUAGES.map(language => {
    const spec = specById.get(assignment.scenarioFamilyId);
    const id = assignment.rowIds[language];
    const candidateId = `candidate-${id.toLowerCase()}`;
    const messages = messagesFor(assignment, language);
    return {
      schema: 'com.saferide.ai.training-example',
      schemaVersion: 1,
      stage: 'candidate',
      id,
      candidateId,
      datasetId: DATASET_ID,
      split: assignment.split,
      messages,
      metadata: {
        language,
        primaryCategory: assignment.primaryCategory,
        secondaryTags: spec.secondaryTags,
        scenarioFamilyId: assignment.scenarioFamilyId,
        semanticClusterId: assignment.semanticClusterId,
        conversationForm: assignment.conversationForm,
        riskLevel: spec.riskLevel,
        userGoalCode: `goal-${assignment.primaryCategory.toLowerCase()}`,
        appState: spec.appState,
        responseStrategy: spec.responseStrategy,
        responseSkeletonId: responseSkeletonId(messages),
        sourceKind: 'repository-authored-synthetic',
        sourcePolicyRefs: spec.policyRefs,
        generatorVersion: 'v05-test-fixture-authoring.1',
        reviewStatus: 'unreviewed',
        prohibitedDataScreen: 'passed',
        longResponseReason: null,
      },
      authoring: {
        method: 'human',
        toolId: 'repository-test-fixture',
        toolRevision: 'v1',
        configurationSha256: HEX_A,
        authoringPromptSha256: HEX_B,
        scenarioFamilyId: assignment.scenarioFamilyId,
        createdAt: '2026-08-01T00:00:00.000Z',
        authorIdentityRef: `fixture-author:${id}`,
        termsAssessmentRef: 'fixture:synthetic-only-terms-assessment',
        syntheticOnlyAttested: true,
        status: 'unreviewed',
      },
    };
  }));
}

function passingDecisions() {
  return {
    safetyContent: 'pass', languageNaturalness: 'pass', pairedFamilyMeaning: 'pass',
    criticalSafetyMeaning: 'pass', productTruth: 'pass', noNewFacts: 'pass',
    concisionAccessibility: 'pass', prohibitedData: 'pass', helpfulnessScore: 3, hardFailures: [],
  };
}

function reviewRecord(candidate, kind, role, suffix) {
  const hash = candidateContentHash(candidate);
  const record = {
    schema: 'com.saferide.ai.dataset-review',
    schemaVersion: 1,
    recordType: 'review',
    recordId: `review:${suffix}:${candidate.candidateId}`,
    rowId: candidate.id,
    candidateId: candidate.candidateId,
    reviewableContentSha256: hash,
    systemPromptSha256: approvedSystemPrompt().textSha256,
    createdAt: '2026-08-01T01:00:00.000Z',
    sensitivity: 'restricted',
    reviewKind: kind,
    reviewer: {
      identityRef: `fixture-reviewer:${suffix}`,
      role,
      independentFromAuthor: true,
      independenceDeclarationRef: `fixture:independence:${suffix}`,
      languageCompetence: role === 'english-language' ? 'fluent-en' : role === 'kiswahili-language' ? 'fluent-sw' : 'not-applicable',
    },
    decisions: passingDecisions(),
    requiredChanges: [],
    unresolvedComments: false,
    finalStatus: expectedReviewStatus(candidate.split),
  };
  if (kind === 'primary-language-content') {
    const assessment = lexicalLanguageAssessment(candidate.messages);
    const result = assessment.predicted === 'undetermined'
      ? 'undetermined'
      : assessment.predicted === candidate.metadata.language ? 'agrees' : 'mismatch';
    record.languageAssessment = {
      method: assessment.method,
      predicted: assessment.predicted,
      expected: candidate.metadata.language,
      result,
      adjudicationStatus: result === 'agrees' ? 'not-required' : 'approved',
      adjudicationEvidenceRef: result === 'agrees' ? null : `fixture:language-adjudication:${candidate.candidateId}`,
    };
  }
  return record;
}

export function makeReviews(candidates) {
  return candidates.flatMap(candidate => {
    const languageRole = candidate.metadata.language === 'en' ? 'english-language' : 'kiswahili-language';
    const records = [
      reviewRecord(candidate, 'primary-language-content', languageRole, `language-${candidate.metadata.language}`),
      reviewRecord(candidate, 'safety-domain', 'product-safeguarding', 'safeguarding'),
    ];
    for (const role of SPECIALISTS[candidate.metadata.primaryCategory] ?? []) {
      records.push(reviewRecord(candidate, 'specialist-domain', role, `specialist-${role}`));
    }
    return records;
  });
}

export function approvedSystemPrompt() {
  const prompt = JSON.parse(fs.readFileSync(new URL('../../../config/ai/safe-assistant-system-prompt.json', import.meta.url), 'utf8'));
  prompt.status = 'approved';
  prompt.approvals = prompt.approvals.map(approval => ({ ...approval, status: 'approved', evidenceRef: `fixture:prompt:${approval.role}` }));
  return prompt;
}

export function approvedPolicy() {
  const policy = JSON.parse(fs.readFileSync(new URL('../../../config/ai/safe-assistant-policy.json', import.meta.url), 'utf8'));
  policy.status = 'approved';
  policy.effectiveDate = '2026-08-01';
  policy.approvals = policy.approvals.map(approval => ({
    ...approval,
    status: 'approved',
    reviewerIdentity: `fixture-reviewer:${approval.role}`,
    reviewedAt: '2026-08-01T00:00:00.000Z',
    artifactRef: `fixture:policy:${approval.role}`,
  }));
  return policy;
}

export function makeApprovedFixture() {
  const plan = v05Plan();
  const specs = makeScenarioSpecs(plan);
  const manifest = makeSplitManifest(specs, plan);
  const candidates = makeCandidates(specs, manifest);
  const reviews = makeReviews(candidates);
  const policy = approvedPolicy();
  const systemPrompt = approvedSystemPrompt();
  const built = buildFinalDataset({ plan, specs, manifest, candidates, reviews, policy, systemPrompt });
  return { plan, specs, manifest, candidates, reviews, policy, systemPrompt, ...built };
}

export function makeAuditFixture(fixture) {
  const bindings = {
    planSha256: '1'.repeat(64), scenarioSpecSha256: '2'.repeat(64), splitManifestSha256: '3'.repeat(64),
    datasetManifestSha256: '4'.repeat(64), reviewSummarySha256: '5'.repeat(64), semanticReportSha256: '6'.repeat(64),
  };
  const datasetManifest = {
    datasetInventorySha256: '7'.repeat(64),
    bindings: {
      policySha256: '8'.repeat(64),
      systemPromptTextSha256: fixture.systemPrompt.textSha256,
    },
  };
  const semanticReport = {
    schema: 'com.saferide.ai.v05-semantic-leakage-report', schemaVersion: 1,
    reportId: 'fixture-v05-semantic-report', datasetId: DATASET_ID, status: 'passed',
    datasetArtifactManifestSha256: bindings.datasetManifestSha256,
    splitManifestSha256: bindings.splitManifestSha256,
    method: {
      embeddingModelId: 'fixture/embedding-model', immutableRevision: '9'.repeat(40),
      implementationId: 'fixture-semantic-check', implementationSha256: 'a'.repeat(64), distanceMetric: 'cosine-similarity',
    },
    threshold: fixture.plan.auditPolicy.externalEmbeddingThreshold,
    rowCount: 2600, crossSplitPairCount: 1_930_000, unresolvedPairCount: 0, maximumSimilarity: 0.5,
    pairInventorySha256: 'b'.repeat(64),
    clusterDistribution: { clusterCount: 1300, largestClusterRows: 2, largestClusterShare: 2 / 2600, distributionSha256: 'c'.repeat(64) },
    restrictedDetails: { classification: 'restricted', artifactRef: 'fixture:semantic-details', sha256: 'd'.repeat(64), containsRawText: false, containsEmbeddings: true, rowIdentifiersPublic: false },
    review: { status: 'approved', reviewerRole: 'independent-ml-data', reviewedAt: '2026-08-01T00:00:00.000Z', evidenceRef: 'fixture:semantic-review' },
    privacy: { containsRawText: false, containsEmbeddings: false, classification: 'public-safe-aggregate' },
  };
  return { bindings, datasetManifest, semanticReport };
}

export function makeBlindPrompts() {
  return CATEGORIES.flatMap(category => LANGUAGES.flatMap(language => Array.from({ length: 12 }, (_, offset) => {
    const promptNumber = String(offset + 1).padStart(4, '0');
    const familyNumber = String(offset + 1 + (language === 'sw' ? 12 : 0)).padStart(4, '0');
    const base = `blind${category.toLowerCase()}${language}${promptNumber}`;
    const markers = language === 'en' ? ['the', 'safe', 'this'] : ['hii', 'ni', 'salama'];
    const user = turn => ({ role: 'user', content: [...markers, ...uniqueTokens(`${base}u${turn}`, 8)].join(' ') });
    const assistant = { role: 'assistant', content: [...markers, ...uniqueTokens(`${base}context`, 8)].join(' ') };
    const multiTurn = offset < 5;
    return {
      schema: 'com.saferide.ai.v05-blind-evaluation-prompt', schemaVersion: 1,
      promptId: `v05-blind-${category}-${language}-${promptNumber}`,
      blindFamilyId: `v05-blind-${category}-family-${familyNumber}`,
      semanticClusterId: `v05-blind-cluster-${category.toLowerCase()}-${language}-${promptNumber}`,
      language, primaryCategory: category, conversationForm: multiTurn ? 'multi-turn' : 'single-turn',
      riskLevel: offset < 6 ? 'high' : 'medium',
      messages: multiTurn ? [user(1), assistant, user(2)] : [user(1)],
      sourceKind: 'repository-authored-synthetic-blind-evaluation',
      authoring: {
        authorIdentityRef: `fixture-blind-author:${category}:${language}`,
        independentFromTraining: true, toolId: 'repository-test-fixture', toolRevision: 'v1',
        configurationSha256: HEX_A, termsAssessmentRef: 'fixture:blind-terms', syntheticOnlyAttested: true,
        createdAt: '2026-08-01T00:00:00.000Z',
      },
      languageAssessment: {
        reviewerIdentityRef: `fixture-language-reviewer:${language}`,
        competence: language === 'en' ? 'fluent-en' : 'fluent-sw',
        naturalness: 'passed', criticalMeaning: 'passed', evidenceRef: `fixture:blind-language:${category}:${language}:${promptNumber}`,
      },
      reviewRefs: [`fixture:blind-safeguarding:${category}:${language}:${promptNumber}`, `fixture:blind-ml:${category}:${language}:${promptNumber}`],
      custody: {
        custodianIdentityRef: 'fixture:independent-evaluation-custodian', trainingEngineerAccess: false,
        routinePromptIterationAccess: false, freezeEvidenceRef: 'fixture:blind-freeze', accessLogEvidenceRef: 'fixture:blind-access-log',
      },
      status: 'frozen-blind-evaluation',
    };
  })));
}

export function clone(value) {
  return structuredClone(value);
}

export { sha256 };
