import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalSha256, compileV05Schemas, privacyFindings, schemaErrors, sha256 } from '../lib/saferide-gemma4-v05.mjs';
import { analyzeCrossSplitSimilarity, auditV05Dataset } from '../saferide-gemma4-v05-audit.mjs';
import { validateSemanticLeakageArtifacts } from '../saferide-gemma4-v05-semantic-check.mjs';
import { clone, makeApprovedFixture, makeAuditFixture } from './helpers/saferide-v05-fixtures.mjs';

const fixture = makeApprovedFixture();
const auditInputs = makeAuditFixture(fixture);

function runAudit(overrides = {}) {
  const details = {};
  const report = auditV05Dataset({
    rows: fixture.rows,
    plan: fixture.plan,
    specs: fixture.specs,
    splitManifest: fixture.manifest,
    reviewSummary: fixture.reviewSummary,
    ...auditInputs,
    ...overrides,
    detailsOutput: details,
  });
  return { report, details };
}

function semanticArtifactFixture() {
  const report = clone(auditInputs.semanticReport);
  const assignments = fixture.manifest.assignments.flatMap(assignment => Object.values(assignment.rowIds)
    .map(rowId => ({ rowId, clusterId: assignment.scenarioFamilyId })));
  const rowIds = assignments.map(assignment => assignment.rowId).sort();
  const distribution = fixture.manifest.assignments
    .map(assignment => ({ clusterId: assignment.scenarioFamilyId, rowCount: 2 }))
    .sort((left, right) => left.clusterId.localeCompare(right.clusterId));
  const distributionSha256 = canonicalSha256(distribution);
  report.pairInventorySha256 = canonicalSha256([]);
  report.clusterDistribution = {
    clusterCount: 1300,
    largestClusterRows: 2,
    largestClusterShare: 2 / 2600,
    distributionSha256,
  };
  report.restrictedDetails.containsEmbeddings = true;
  const details = {
    schema: 'com.saferide.ai.v05-semantic-leakage-details',
    schemaVersion: 1,
    reportId: report.reportId,
    datasetId: report.datasetId,
    status: report.status,
    classification: 'restricted',
    datasetArtifactManifestSha256: auditInputs.bindings.datasetManifestSha256,
    splitManifestSha256: auditInputs.bindings.splitManifestSha256,
    methodSha256: canonicalSha256(report.method),
    threshold: report.threshold,
    rowCount: 2600,
    evaluatedCrossSplitPairCount: report.crossSplitPairCount,
    unresolvedPairCount: 0,
    maximumSimilarity: report.maximumSimilarity,
    pairs: [],
    pairInventorySha256: canonicalSha256([]),
    clusters: {
      assignmentCount: 2600,
      rowInventorySha256: sha256(rowIds.join('\n')),
      distributionSha256,
      assignments,
    },
    embeddingArtifact: {
      classification: 'restricted', artifactRef: 'fixture:semantic-embeddings', sha256: 'e'.repeat(64),
      sizeBytes: 2600, format: 'safetensors', containsRawText: false,
    },
    privacy: { containsRawText: false, containsSurvivorData: false, rowIdentifiersPublic: false, containsEmbeddings: true },
  };
  return { report, details };
}

test('full 2,600-row audit passes structural, quota, privacy, provenance, language, duplication, n-gram, and external-semantic gates', { timeout: 60_000 }, () => {
  const { report, details } = runAudit();
  assert.equal(report.passed, true);
  assert.deepEqual(report.failures, []);
  assert.equal(report.counts.rows, 2600);
  assert.equal(report.counts.families, 1300);
  assert.equal(report.overlap.exactTurnCount, 0);
  assert.equal(report.overlap.nearDuplicatePairCount, 0);
  assert.equal(report.diversity.responseLengthBySplitLanguageCategory.length, 80);
  assert.equal(report.semanticLeakage.unresolvedPairCount, 0);
  assert.equal(report.restrictedDetails.rowIdentifiersPublic, false);
  const schemas = compileV05Schemas();
  assert.deepEqual(schemaErrors('audit', schemas.audit, report), []);
  assert.deepEqual(schemaErrors('details', schemas.auditDetails, details), []);
  assert.doesNotMatch(JSON.stringify(report), /leftRowId|rightRowId|mismatchSamples|exactTurnSamples/);
});

test('combined negative corpus fails closed without leaking row identifiers into the public report', { timeout: 60_000 }, () => {
  const rows = clone(fixture.rows);
  const train = rows.find(row => row.split === 'train');
  const holdout = rows.find(row => row.split === 'safety-holdout');
  holdout.messages[1].content = train.messages[1].content;
  rows[1].messages.at(-1).content += ' person@example.org';
  rows[2].authoring.toolId = '';
  const specs = clone(fixture.specs).map(spec => ({ ...spec, behaviorFlags: { ...spec.behaviorFlags, safeNextStep: false } }));
  const semanticReport = clone(auditInputs.semanticReport);
  semanticReport.status = 'blocked';
  semanticReport.unresolvedPairCount = 1;
  semanticReport.review.status = 'blocked';
  const reviewSummary = clone(fixture.reviewSummary);
  reviewSummary.languageAssessment.agreed -= 1;
  const { report, details } = runAudit({ rows, specs, semanticReport, reviewSummary });
  assert.equal(report.passed, false);
  assert.match(report.failures.join('\n'), /structural/);
  assert.match(report.failures.join('\n'), /privacy/);
  assert.match(report.failures.join('\n'), /provenance/);
  assert.match(report.failures.join('\n'), /overlap/);
  assert.match(report.failures.join('\n'), /distribution/);
  assert.match(report.failures.join('\n'), /semantic/);
  assert.match(report.failures.join('\n'), /language/);
  assert.doesNotMatch(JSON.stringify(report), new RegExp(train.id));
  assert.match(JSON.stringify(details), new RegExp(train.id));
});

test('external semantic aggregate is bound to all restricted cluster assignments and adjudicated pairs', () => {
  const { report, details } = semanticArtifactFixture();
  assert.deepEqual(validateSemanticLeakageArtifacts({
    report,
    details,
    splitManifest: fixture.manifest,
    datasetManifestSha256: auditInputs.bindings.datasetManifestSha256,
    splitManifestSha256: auditInputs.bindings.splitManifestSha256,
  }), []);
});

test('external semantic details fail closed on missing rows and invalid cross-split adjudication', () => {
  const { report, details } = semanticArtifactFixture();
  details.clusters.assignments.pop();
  const rowsBySplit = new Map(fixture.rows.map(row => [row.id, row.split]));
  const rowIds = [fixture.rows.find(row => row.split === 'train').id, fixture.rows.find(row => row.split === 'dev').id].sort();
  const pair = {
    pairId: sha256(rowIds.join('\n')),
    leftRowId: rowIds[0],
    leftSplit: rowsBySplit.get(rowIds[0]),
    rightRowId: rowIds[1],
    rightSplit: rowsBySplit.get(rowIds[0]),
    similarity: 0.95,
    disposition: 'distinct-after-independent-review',
    adjudicationEvidenceRef: null,
  };
  details.pairs = [pair];
  details.pairInventorySha256 = canonicalSha256(details.pairs);
  details.maximumSimilarity = pair.similarity;
  report.pairInventorySha256 = details.pairInventorySha256;
  report.maximumSimilarity = pair.similarity;
  const errors = validateSemanticLeakageArtifacts({
    report,
    details,
    splitManifest: fixture.manifest,
    datasetManifestSha256: auditInputs.bindings.datasetManifestSha256,
    splitManifestSha256: auditInputs.bindings.splitManifestSha256,
  }).join('\n');
  assert.match(errors, /cluster assignments must cover each frozen row|must NOT have more than 2600/);
  assert.match(errors, /invalid cross-split pair records/);
});

test('external semantic details require complete pair coverage and reject a collapsed cluster', () => {
  const { report, details } = semanticArtifactFixture();
  details.evaluatedCrossSplitPairCount = 0;
  report.crossSplitPairCount = 0;
  details.clusters.assignments = details.clusters.assignments.map(assignment => ({
    ...assignment,
    clusterId: 'collapsed-semantic-cluster',
  }));
  const distribution = [{ clusterId: 'collapsed-semantic-cluster', rowCount: 2600 }];
  details.clusters.distributionSha256 = canonicalSha256(distribution);
  report.clusterDistribution = {
    clusterCount: 1,
    largestClusterRows: 2600,
    largestClusterShare: 1,
    distributionSha256: details.clusters.distributionSha256,
  };
  const errors = validateSemanticLeakageArtifacts({
    report,
    details,
    splitManifest: fixture.manifest,
    datasetManifestSha256: auditInputs.bindings.datasetManifestSha256,
    splitManifestSha256: auditInputs.bindings.splitManifestSha256,
  }).join('\n');
  assert.match(errors, /evaluate all 1930000 cross-split row pairs|must be equal to constant/);
  assert.match(errors, /3% maximum cluster share|must be <= 0\.03/);
});

test('n-gram and lexical-semantic near duplicates are detected across splits', () => {
  const tokens = ['one', 'two', 'three', 'four', 'five'];
  const document = (rowId, split) => ({
    rowId, split, role: 'assistant', tokens,
    ngrams: new Set(['one two three', 'two three four', 'three four five']),
    frequencies: new Map(tokens.map(token => [token, 1])),
  });
  const result = analyzeCrossSplitSimilarity([document('a', 'train'), document('b', 'dev')], fixture.plan.auditPolicy);
  assert.equal(result.pairCount, 1);
  assert.equal(result.maximumNgramSimilarity, 1);
  assert.equal(result.maximumLexicalSemanticProxy, 1);
});

test('privacy detector rejects secrets, contacts, coordinates, official references, law citations, doses, and fees', () => {
  const syntheticApiKey = ['sk', 'proj', 'abcdefghijklmnopqrstuvwxyz123456'].join('-');
  const value = [
    syntheticApiKey, 'person@example.org', '+254700000000',
    '-1.2921, 36.8219', 'case number', 'section 12', '50 mg', 'KES 100',
  ].join(' ');
  const codes = new Set(privacyFindings(value).map(finding => finding.code));
  for (const expected of ['api-key', 'email-address', 'phone-number', 'coordinate-pair', 'official-identifier', 'law-citation', 'medication-dose', 'fee-or-price']) {
    assert.equal(codes.has(expected), true, expected);
  }
});
