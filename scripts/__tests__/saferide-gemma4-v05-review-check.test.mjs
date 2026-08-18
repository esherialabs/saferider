import assert from 'node:assert/strict';
import test from 'node:test';

import { compileV05Schemas } from '../lib/saferide-gemma4-v05.mjs';
import { validateReviewLedger } from '../saferide-gemma4-v05-review-check.mjs';
import { clone, makeApprovedFixture } from './helpers/saferide-v05-fixtures.mjs';

const fixture = makeApprovedFixture();

function validate(candidates = fixture.candidates, reviews = fixture.reviews, manifest = fixture.manifest) {
  return validateReviewLedger({
    candidates,
    reviews,
    specs: fixture.specs,
    manifest,
    plan: fixture.plan,
    systemPrompt: fixture.systemPrompt,
    schemas: compileV05Schemas(),
  });
}

test('review ledger selects exactly one hash-bound candidate per row with language, safeguarding, and specialist coverage', () => {
  const result = validate();
  assert.deepEqual(result.errors, []);
  assert.equal(result.summary.finalRowCount, 2600);
  assert.equal(result.summary.primaryReviewCount, 2600);
  assert.equal(result.summary.safetyDomainReviewCount, 2600);
  assert.equal(result.summary.specialistDomainReviewCount, 1820);
  assert.deepEqual(result.summary.languageAssessment, { agreed: 2600, adjudicatedMismatch: 0, adjudicatedUndetermined: 0, blocked: 0 });
});

test('content edits after review invalidate every stale review hash', () => {
  const candidates = clone(fixture.candidates);
  candidates[0].messages.at(-1).content += ' changed';
  const result = validate(candidates);
  assert.match(result.errors.join('\n'), /reviewable-content hash does not match candidate bytes/);
  assert.match(result.errors.join('\n'), /has 0 fully approved candidates/);
});

test('same identity cannot satisfy primary and safeguarding independence', () => {
  const reviews = clone(fixture.reviews);
  const candidateId = fixture.candidates[0].candidateId;
  const primary = reviews.find(record => record.candidateId === candidateId && record.reviewKind === 'primary-language-content');
  const safety = reviews.find(record => record.candidateId === candidateId && record.reviewKind === 'safety-domain');
  safety.reviewer.identityRef = primary.reviewer.identityRef;
  const result = validate(fixture.candidates, reviews);
  assert.match(result.errors.join('\n'), /has 0 fully approved candidates/);
});

test('Kiswahili and automated-language claims fail closed without fluent attributable adjudication', () => {
  const reviews = clone(fixture.reviews);
  const sw = fixture.candidates.find(candidate => candidate.metadata.language === 'sw');
  const primary = reviews.find(record => record.candidateId === sw.candidateId && record.reviewKind === 'primary-language-content');
  primary.reviewer.languageCompetence = 'fluent-en';
  primary.languageAssessment.predicted = 'en';
  primary.languageAssessment.result = 'mismatch';
  primary.languageAssessment.adjudicationStatus = 'not-required';
  primary.languageAssessment.adjudicationEvidenceRef = null;
  const result = validate(fixture.candidates, reviews);
  assert.match(result.errors.join('\n'), /language assessment is not bound|fluent human adjudication/);
  assert.match(result.errors.join('\n'), /has 0 fully approved candidates/);
});

test('negative hard-safety review cannot be laundered into approval without a passing replacement review', () => {
  const reviews = clone(fixture.reviews);
  const candidate = fixture.candidates[0];
  const safety = reviews.find(record => record.candidateId === candidate.candidateId && record.reviewKind === 'safety-domain');
  safety.finalStatus = 'rejected';
  safety.decisions.safetyContent = 'fail';
  safety.decisions.hardFailures = ['fabricated-fact'];
  const result = validate(fixture.candidates, reviews);
  assert.match(result.errors.join('\n'), /has 0 fully approved candidates/);
});

test('review cannot begin against a draft split assignment', () => {
  const manifest = clone(fixture.manifest);
  manifest.status = 'draft';
  manifest.approvals.safeguardingProduct = { status: 'pending', evidenceRef: null };
  manifest.approvals.independentMlData = { status: 'pending', evidenceRef: null };
  const result = validate(fixture.candidates, fixture.reviews, manifest);
  assert.match(result.errors.join('\n'), /frozen pre-prose split manifest/);
});
