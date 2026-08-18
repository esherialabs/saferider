import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  candidateContentHash,
  canonicalSha256,
  jsonlText,
  responseSkeletonId,
  sha256,
} from '../lib/saferide-gemma4-v05.mjs';
import { inspectArtifactPermissions } from '../lib/saferide-artifact-security.mjs';
import {
  candidateTokenInventory,
  screenCandidateCorpus,
} from '../saferide-gemma4-v05-candidate-screen.mjs';
import {
  approvedPolicy,
  approvedSystemPrompt,
  clone,
  makeCandidates,
  makeScenarioSpecs,
  makeSplitManifest,
  v05Plan,
} from './helpers/saferide-v05-fixtures.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scriptPath = path.join(repoRoot, 'scripts/saferide-gemma4-v05-candidate-screen.mjs');
const plan = v05Plan();
const specs = makeScenarioSpecs(plan);
const manifest = makeSplitManifest(specs, plan);
const specById = new Map(specs.map(spec => [spec.scenarioFamilyId, spec]));
const allSafeFixtureCandidates = makeCandidates(specs, manifest).filter(candidate => {
  const spec = specById.get(candidate.metadata.scenarioFamilyId);
  return spec.primaryCategory === 'tone' && Object.values(spec.behaviorFlags).every(value => value === false);
});
const fixtureCandidates = allSafeFixtureCandidates.slice(0, 6);
const policy = approvedPolicy();
const systemPrompt = approvedSystemPrompt();

function hashesFor(candidates, tokenReport = null, semanticReport = null, candidateFiles = null) {
  const candidateText = jsonlText(candidates);
  return {
    planSha256: canonicalSha256(plan),
    scenarioMatrixSha256: canonicalSha256(specs),
    splitManifestSha256: canonicalSha256(manifest),
    candidateFiles: candidateFiles ?? [{ sha256: sha256(candidateText), sizeBytes: Buffer.byteLength(candidateText) }],
    policySha256: canonicalSha256(policy),
    systemPromptConfigSha256: canonicalSha256(systemPrompt),
    tokenizationReportSha256: tokenReport ? canonicalSha256(tokenReport) : null,
    semanticReportSha256: semanticReport ? canonicalSha256(semanticReport) : null,
  };
}

function tokenReportFor(candidates, hashes, overrides = {}) {
  const { inventorySha256 } = candidateTokenInventory(candidates);
  const records = candidates.map((candidate, index) => ({
    candidateId: candidate.candidateId,
    candidateContentSha256: candidateContentHash(candidate),
    renderedSequenceSha256: sha256(`fixture-rendered-sequence:${candidate.candidateId}`),
    totalTokens: overrides.totalTokensByIndex?.[index] ?? 128,
    assistantTokens: 64,
    truncated: false,
  })).sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  return {
    schema: 'com.saferide.ai.v05-tokenization-report',
    schemaVersion: 1,
    reportId: 'test-v05-tokenization-report',
    datasetId: 'saferide-synthetic-guidance-v0.5.0',
    status: 'test-only',
    classification: 'restricted-content-free-identifiers',
    bindings: {
      planSha256: hashes.planSha256,
      candidateInventorySha256: inventorySha256,
      policySha256: hashes.policySha256,
      systemPromptConfigSha256: hashes.systemPromptConfigSha256,
      systemPromptTextSha256: systemPrompt.textSha256,
    },
    method: {
      tokenizerId: 'fixture/gemma-tokenizer', immutableRevision: 'fixture-revision-v1',
      implementationId: 'fixture-canonical-chat-template', implementationSha256: '1'.repeat(64),
      chatTemplateSha256: '2'.repeat(64), canonicalApplyChatTemplate: true,
      maximumSequenceLength: 1024, rejectTruncation: true,
    },
    recordCount: records.length,
    records,
    approval: { status: 'test-only', reviewerRole: 'fixture', evidenceRef: null },
    privacy: { containsRawText: false, containsTokenIds: false, containsPrompts: false, containsCompletions: false },
  };
}

function withinPairCount(records) {
  const counts = new Map();
  for (const record of records) counts.set(record.split, (counts.get(record.split) ?? 0) + 1);
  return [...counts.values()].reduce((total, count) => total + (count * (count - 1)) / 2, 0);
}

function semanticReportFor(request, findings = []) {
  const clusterAssignments = request.candidates.map(candidate => ({
    candidateId: candidate.candidateId,
    clusterIdHash: sha256(`fixture-cluster:${candidate.candidateId}`),
  }));
  const distribution = clusterAssignments.map(assignment => ({ clusterIdHash: assignment.clusterIdHash, count: 1 }))
    .sort((left, right) => left.clusterIdHash.localeCompare(right.clusterIdHash));
  const requestText = `${JSON.stringify(request, null, 2)}\n`;
  return {
    schema: 'com.saferide.ai.v05-candidate-semantic-report',
    schemaVersion: 1,
    reportId: 'test-v05-candidate-semantic-report',
    datasetId: 'saferide-synthetic-guidance-v0.5.0',
    status: 'test-only',
    classification: 'restricted-content-free-identifiers',
    bindings: {
      semanticRequestSha256: sha256(requestText),
      candidateInventorySha256: request.candidateInventorySha256,
      planSha256: request.bindings.planSha256,
    },
    method: {
      embeddingModelId: 'fixture/local-embedding-model', immutableRevision: 'fixture-revision-v1',
      implementationId: 'fixture-semantic-interface', implementationSha256: '3'.repeat(64),
      distanceMetric: 'cosine-similarity', remote: false, complete: true,
    },
    threshold: 0.92,
    comparisonScope: {
      candidateCount: request.candidateCount,
      crossSplitPairCount: request.crossSplitPairCount,
      withinSplitPairCount: withinPairCount(request.candidates),
      allCrossSplitPairsCompared: true,
    },
    maximumSimilarity: findings.length ? Math.max(...findings.map(finding => finding.similarity)) : 0.5,
    findings,
    clusterAssignments,
    clusterDistribution: {
      clusterCount: distribution.length,
      largestClusterCandidates: distribution.length ? 1 : 0,
      largestClusterShare: distribution.length ? Number((1 / distribution.length).toFixed(6)) : 0,
      distributionSha256: canonicalSha256(distribution),
    },
    approval: { status: 'test-only', reviewerRole: 'fixture', thresholdEvidenceRef: null, reportEvidenceRef: null },
    privacy: { containsRawText: false, containsEmbeddings: false, containsHoldouts: false },
  };
}

function runScreen(candidates, { tokenOverrides = {}, semanticFactory = semanticReportFor, candidateSources = null, candidateFiles = null } = {}) {
  let hashes = hashesFor(candidates, null, null, candidateFiles);
  const tokenReport = tokenReportFor(candidates, hashes, tokenOverrides);
  hashes = hashesFor(candidates, tokenReport, null, candidateFiles);
  const first = screenCandidateCorpus({
    plan, specs, manifest, candidates, candidateSources, policy, systemPrompt, tokenReport, hashes, allowTestFixtures: true,
  });
  const semanticReport = semanticFactory ? semanticFactory(first.semanticRequest) : null;
  hashes = hashesFor(candidates, tokenReport, semanticReport, candidateFiles);
  return screenCandidateCorpus({
    plan, specs, manifest, candidates, candidateSources, policy, systemPrompt, tokenReport, semanticReport, hashes, allowTestFixtures: true,
  });
}

function withRoot(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'saferide-v05-screen-test-'));
  fs.chmodSync(root, 0o700);
  try {
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writePrivate(root, relative, value, jsonl = false) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(target), 0o700);
  const text = jsonl ? jsonlText(value) : `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(target, text, { mode: 0o600 });
  fs.chmodSync(target, 0o600);
  return target;
}

test('safe candidates become a deterministic review shortlist while incomplete production coverage stays fail-closed', () => {
  const candidates = clone(fixtureCandidates.slice(0, 4));
  const first = runScreen(candidates);
  const second = runScreen(candidates);
  assert.equal(first.report.counts.shortlistedCandidates, 0);
  assert.equal(first.report.outcomes.eligible, candidates.length);
  assert.equal(first.report.strictReady, false);
  assert(first.report.blockers.includes('INCOMPLETE_SLOT_COVERAGE'));
  assert(first.report.blockers.includes('SLOTS_WITHOUT_ELIGIBLE_CANDIDATE'));
  assert.equal(first.report.privacy.containsCandidateText, false);
  assert.equal(first.text.shortlist, '\n');
  assert.equal(first.details.filter(detail => detail.state === 'generation-failed').length, 2600 - candidates.length);
  assert.equal(first.text.report, second.text.report);
  assert.equal(first.text.details, second.text.details);
  assert.equal(first.text.shortlist, second.text.shortlist);
  assert.equal(first.text.candidateIndex, second.text.candidateIndex);
  assert.equal(first.text.semanticRequest, second.text.semanticRequest);
});

test('privacy, precise identifier, product-state, and token gates quarantine or reject without raw matches in details', () => {
  const privateCandidate = clone(fixtureCandidates[0]);
  privateCandidate.messages[0].content += ' synthetic.person@example.test';
  privateCandidate.metadata.responseSkeletonId = responseSkeletonId(privateCandidate.messages);
  const privateResult = runScreen([privateCandidate], { semanticFactory: null });
  const privateDetail = privateResult.details.find(detail => detail.candidateId === privateCandidate.candidateId);
  assert.equal(privateDetail.state, 'quarantined');
  assert(privateDetail.findings.some(finding => finding.ruleId === 'PRIVATE_EMAIL_ADDRESS'));
  assert.doesNotMatch(JSON.stringify(privateDetail), /synthetic\.person@example\.test/);

  const secretCandidate = clone(fixtureCandidates[0]);
  const syntheticSecret = ['sk', 'proj', 'x'.repeat(24)].join('-');
  secretCandidate.messages[0].content += ` ${syntheticSecret}`;
  secretCandidate.metadata.responseSkeletonId = responseSkeletonId(secretCandidate.messages);
  const secretResult = runScreen([secretCandidate], { semanticFactory: null });
  const secretDetail = secretResult.details.find(detail => detail.candidateId === secretCandidate.candidateId);
  assert.equal(secretDetail.state, 'quarantined');
  assert(secretDetail.findings.some(finding => finding.ruleId === 'PRIVATE_API_KEY'));
  assert.doesNotMatch(JSON.stringify(secretDetail), new RegExp(syntheticSecret));

  const productCandidate = clone(fixtureCandidates[1]);
  productCandidate.messages.at(-1).content = 'UNICEF has received this report and will act on it immediately with certainty.';
  productCandidate.metadata.responseSkeletonId = responseSkeletonId(productCandidate.messages);
  const productResult = runScreen([productCandidate], { semanticFactory: null });
  const productDetail = productResult.details.find(detail => detail.candidateId === productCandidate.candidateId);
  assert.equal(productDetail.state, 'rejected');
  assert(productDetail.findings.some(finding => finding.ruleId === 'PRODUCT_STATE_CONTRADICTION'));

  const tokenResult = runScreen([clone(fixtureCandidates[2])], { tokenOverrides: { totalTokensByIndex: [1025] } });
  const tokenDetail = tokenResult.details.find(detail => detail.candidateId === fixtureCandidates[2].candidateId);
  assert.equal(tokenDetail.state, 'rejected');
  assert(tokenDetail.findings.some(finding => finding.ruleId === 'TOKEN_LIMIT_OR_TRUNCATION'));
});

test('language, code-switch, and per-slot maximum signals remain fail-closed', () => {
  const languageCandidate = clone(fixtureCandidates.find(candidate => candidate.metadata.language === 'sw'));
  languageCandidate.messages = [
    { role: 'user', content: 'the and this safe request is for my private synthetic situation' },
    { role: 'assistant', content: 'you can keep your options open and use this safe synthetic next step while the unknown state is not confirmed by anyone' },
  ];
  languageCandidate.metadata.conversationForm = 'single-turn';
  languageCandidate.metadata.responseSkeletonId = responseSkeletonId(languageCandidate.messages);
  const languageResult = runScreen([languageCandidate], { semanticFactory: null });
  const languageDetail = languageResult.details.find(detail => detail.candidateId === languageCandidate.candidateId);
  assert(languageDetail.findings.some(finding => finding.ruleId === 'LANGUAGE_ID_MISMATCH'));
  assert(languageDetail.findings.some(finding => finding.ruleId === 'EXCESSIVE_CODE_SWITCH'));

  const variants = Array.from({ length: 4 }, (_, index) => {
    const candidate = clone(fixtureCandidates[0]);
    candidate.candidateId = `candidate-slot-limit-${index + 1}`;
    candidate.messages[0].content += ` uniquelimitvariant${index + 1}`;
    candidate.metadata.responseSkeletonId = responseSkeletonId(candidate.messages);
    return candidate;
  });
  const limitResult = runScreen(variants, { semanticFactory: null });
  assert.equal(limitResult.report.coverage.slotsOverMaximum, 1);
  assert.equal(limitResult.report.outcomes.rejected, 4);
  assert(limitResult.details.filter(detail => detail.recordType === 'candidate').every(detail => (
    detail.findings.some(finding => finding.ruleId === 'CANDIDATE_SLOT_MAXIMUM')
  )));
});

test('malformed candidate values produce restricted rejection records instead of crashing the screen', () => {
  const candidates = [null, { candidateId: 'invalid-shape-candidate', id: 'invalid-shape-row', messages: 'not-an-array' }];
  const hashes = hashesFor(candidates);
  const result = screenCandidateCorpus({
    plan, specs, manifest, candidates, policy, systemPrompt, hashes, allowTestFixtures: true,
  });
  const records = result.details.filter(detail => detail.recordType === 'candidate');
  assert.equal(records.length, 2);
  assert(records.every(detail => detail.state === 'rejected'));
  assert(records.every(detail => detail.findings.some(finding => finding.ruleId === 'STRUCTURAL_CONTRACT')));
});

test('exact, normalized, n-gram, and lexical comparisons deterministically reject redundant later candidates', () => {
  const first = allSafeFixtureCandidates[0];
  const crossSplit = allSafeFixtureCandidates.find(candidate => (
    candidate.split !== first.split && candidate.metadata.language === first.metadata.language
  ));
  assert(crossSplit);
  const candidates = clone([first, crossSplit]);
  candidates[1].messages = clone(candidates[0].messages);
  candidates[1].metadata.responseSkeletonId = responseSkeletonId(candidates[1].messages);
  const candidateFiles = candidates.map(candidate => {
    const text = jsonlText([candidate]);
    return { sha256: sha256(text), sizeBytes: Buffer.byteLength(text) };
  });
  const result = runScreen(candidates, {
    semanticFactory: null,
    candidateFiles,
    candidateSources: [{ sourceFileOrdinal: 0, sourceRecordOrdinal: 0 }, { sourceFileOrdinal: 1, sourceRecordOrdinal: 0 }],
  });
  assert(result.report.duplicateSummary.exactConversation >= 1);
  assert(result.report.duplicateSummary.normalizedAssistantTarget >= 1);
  assert.equal(result.report.outcomes.rejected, 1);
  const rejected = result.details.find(detail => detail.state === 'rejected');
  assert(rejected.findings.some(finding => finding.stage === 'exact-duplicate' && finding.otherCandidateId));
  assert(rejected.findings.some(finding => finding.otherSplit && finding.otherSplit !== rejected.split));
  assert.deepEqual(result.importedCandidateIndex.candidates.map(candidate => candidate.sourceFileOrdinal).sort(), [0, 1]);
});

test('semantic interface enforces exact request bindings and preserves unresolved high-similarity pairs', () => {
  const candidates = clone(fixtureCandidates.slice(0, 2));
  const result = runScreen(candidates, {
    semanticFactory(request) {
      const [left, right] = request.candidates;
      return semanticReportFor(request, [{
        leftCandidateId: left.candidateId,
        rightCandidateId: right.candidateId,
        leftSplit: left.split,
        rightSplit: right.split,
        similarity: 0.96,
        scope: left.split === right.split ? 'within-split' : 'cross-split',
        disposition: 'needs-adjudication',
        adjudicationEvidenceRef: null,
      }]);
    },
  });
  assert.equal(result.report.duplicateSummary.semantic, 1);
  assert.equal(result.report.duplicateSummary.unresolved, 1);
  assert(result.report.blockers.includes('UNRESOLVED_SEMANTIC_PAIRS'));
  assert.equal(result.report.outcomes.needsAdjudication, 2);
  assert(result.details.filter(detail => detail.recordType === 'candidate').every(detail => (
    detail.findings.some(finding => finding.ruleId === 'SEMANTIC_NEAR_DUPLICATE' && finding.similarity === 0.96)
  )));
});

test('screening CLI is cwd-portable, emits content-free logs, uses private permissions, and strict mode fails closed', { timeout: 30_000 }, () => withRoot(root => {
  const candidates = clone(fixtureCandidates.slice(0, 2));
  candidates[0].messages[0].content += ' DO_NOT_LOG_CANDIDATE_SENTINEL';
  candidates[0].metadata.responseSkeletonId = responseSkeletonId(candidates[0].messages);
  const baseHashes = hashesFor(candidates);
  const tokenReport = tokenReportFor(candidates, baseHashes);
  writePrivate(root, 'matrix/scenarios.frozen.jsonl', specs, true);
  writePrivate(root, 'splits/split-manifest.frozen.json', manifest);
  writePrivate(root, 'candidates/imported/batch-0001.jsonl', candidates, true);
  writePrivate(root, 'policy/policy.json', policy);
  writePrivate(root, 'policy/system-prompt.json', systemPrompt);
  writePrivate(root, 'screening/token-report.json', tokenReport);
  const args = [
    scriptPath, '--artifact-root', root,
    '--scenarios', 'matrix/scenarios.frozen.jsonl', '--split-manifest', 'splits/split-manifest.frozen.json',
    '--candidate', 'candidates/imported/batch-0001.jsonl', '--policy', 'policy/policy.json',
    '--system-prompt', 'policy/system-prompt.json', '--token-report', 'screening/token-report.json',
    '--candidate-index', 'candidates/imported/candidate-index.json',
    '--semantic-request', 'screening/semantic-request.json', '--report', 'public-safe/candidate-screen-report.json',
    '--details', 'screening/candidate-screen-details.jsonl', '--shortlist', 'screening/shortlist.jsonl',
  ];
  const run = spawnSync(process.execPath, args, { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.doesNotMatch(`${run.stdout}\n${run.stderr}`, /DO_NOT_LOG_CANDIDATE_SENTINEL|word8[0-9]/i);
  const report = JSON.parse(fs.readFileSync(path.join(root, 'public-safe/candidate-screen-report.json'), 'utf8'));
  assert.equal(report.strictReady, false);
  assert.equal(report.privacy.containsCandidateText, false);
  assert.deepEqual(inspectArtifactPermissions(root), []);
  const strict = spawnSync(process.execPath, [...args, '--strict'], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(strict.status, 1);
  assert.doesNotMatch(`${strict.stdout}\n${strict.stderr}`, /DO_NOT_LOG_CANDIDATE_SENTINEL/);
}));
