#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  CATEGORIES,
  candidateContentHash,
  compileV05Schemas,
  expectedReviewStatus,
  fileSha256,
  lexicalLanguageAssessment,
  readJson,
  readJsonl,
  schemaErrors,
  sha256,
  stableJson,
  validateCandidateSet,
  validatePrivateOutputRoot,
} from './lib/saferide-gemma4-v05.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reviewScriptPath = fileURLToPath(import.meta.url);

const REQUIRED_SPECIALIST_ROLES = Object.freeze({
  privacy: ['privacy-security'],
  legal: ['legal'],
  medical: ['clinical-medical'],
  emergency: ['clinical-medical'],
  tone: [],
  coercion: [],
  fabrication: [],
  product: ['product-mobile-api'],
  jailbreak: ['technical-ml', 'privacy-security'],
  noNewFacts: [],
});

function parseArgs(argv) {
  const args = {
    contractCheck: false,
    output: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--contract-check') args.contractCheck = true;
    else if (argument === '--plan') args.plan = argv[++index];
    else if (argument === '--scenarios') args.scenarios = argv[++index];
    else if (argument === '--split-manifest') args.splitManifest = argv[++index];
    else if (argument === '--candidates') args.candidates = argv[++index];
    else if (argument === '--reviews') args.reviews = argv[++index];
    else if (argument === '--system-prompt') args.systemPrompt = argv[++index];
    else if (argument === '--output') args.output = argv[++index];
    else if (['--help', '-h'].includes(argument)) {
      console.log([
        'Usage: node scripts/saferide-gemma4-v05-review-check.mjs --contract-check',
        '   or: --plan <json> --scenarios <jsonl> --split-manifest <json>',
        '       --candidates <jsonl> --reviews <jsonl> --system-prompt <json> [--output <json>]',
        '',
        'The command reports IDs, hashes, counts, and status codes only. It never prints row content or reviewer notes.',
      ].join('\n'));
      process.exit(0);
    } else throw new Error(`Unknown or incomplete argument: ${argument}`);
  }
  return args;
}

function resolve(input) {
  return path.isAbsolute(input) ? input : path.join(repoRoot, input);
}

function allPass(decisions) {
  return decisions
    && ['pass', 'not-applicable'].includes(decisions.safetyContent)
    && ['pass', 'not-applicable'].includes(decisions.languageNaturalness)
    && decisions.pairedFamilyMeaning === 'pass'
    && decisions.criticalSafetyMeaning === 'pass'
    && ['pass', 'not-applicable'].includes(decisions.productTruth)
    && ['pass', 'not-applicable'].includes(decisions.noNewFacts)
    && ['pass', 'not-applicable'].includes(decisions.concisionAccessibility)
    && decisions.prohibitedData === 'pass'
    && decisions.helpfulnessScore >= 2
    && Array.isArray(decisions.hardFailures)
    && decisions.hardFailures.length === 0;
}

function languageReviewPasses(review, language) {
  if (review.reviewKind !== 'primary-language-content') return false;
  if (language === 'sw') {
    return review.reviewer?.role === 'kiswahili-language'
      && ['native-sw', 'fluent-sw'].includes(review.reviewer?.languageCompetence);
  }
  return review.reviewer?.role === 'english-language'
    && ['native-en', 'fluent-en'].includes(review.reviewer?.languageCompetence);
}

function safetyReviewPasses(review, category) {
  return review.reviewKind === 'safety-domain'
    && review.reviewer?.role === 'product-safeguarding';
}

function specialistReviewPasses(review, role) {
  return review.reviewKind === 'specialist-domain' && review.reviewer?.role === role;
}

function validateLanguageAssessment(review, candidate) {
  if (review.recordType !== 'review' || review.reviewKind !== 'primary-language-content') return [];
  const errors = [];
  const actual = lexicalLanguageAssessment(candidate.messages);
  const expected = candidate.metadata?.language;
  const result = actual.predicted === 'undetermined'
    ? 'undetermined'
    : actual.predicted === expected ? 'agrees' : 'mismatch';
  if (review.languageAssessment?.method !== actual.method
    || review.languageAssessment?.predicted !== actual.predicted
    || review.languageAssessment?.expected !== expected
    || review.languageAssessment?.result !== result) {
    errors.push(`${review.recordId} language assessment is not bound to the deterministic screening result`);
  }
  if (result === 'agrees') {
    if (review.languageAssessment?.adjudicationStatus !== 'not-required'
      || review.languageAssessment?.adjudicationEvidenceRef !== null) {
      errors.push(`${review.recordId} must not claim language adjudication when the proxy agrees`);
    }
  } else if (review.languageAssessment?.adjudicationStatus !== 'approved'
    || !review.languageAssessment?.adjudicationEvidenceRef) {
    errors.push(`${review.recordId} must bind fluent human adjudication for a ${result} language proxy result`);
  }
  return errors;
}

function validateReviewRecordSemantics(review, candidate, expectedPromptHash) {
  const errors = [];
  const expectedHash = candidateContentHash(candidate);
  if (review.rowId !== candidate.id || review.candidateId !== candidate.candidateId) {
    errors.push(`${review.recordId} row/candidate binding does not match the selected candidate`);
  }
  if (review.reviewableContentSha256 !== expectedHash) {
    errors.push(`${review.recordId} reviewable-content hash does not match candidate bytes`);
  }
  if (review.systemPromptSha256 !== expectedPromptHash) {
    errors.push(`${review.recordId} system-prompt hash does not match the approved prompt binding`);
  }
  if (review.recordType === 'review') {
    if (review.reviewer?.identityRef === candidate.authoring?.authorIdentityRef) {
      errors.push(`${review.recordId} reviewer cannot be the candidate author`);
    }
    if (review.reviewer?.independentFromAuthor !== true) {
      errors.push(`${review.recordId} lacks reviewer independence`);
    }
    errors.push(...validateLanguageAssessment(review, candidate));
    const approved = review.finalStatus === expectedReviewStatus(candidate.split);
    if (approved && (!allPass(review.decisions) || review.requiredChanges?.length || review.unresolvedComments)) {
      errors.push(`${review.recordId} claims approval with a failed decision, required change, or unresolved comment`);
    }
  }
  return errors;
}

function conflictIsResolved(candidateReviews, adjudications) {
  const negativeIds = candidateReviews
    .filter(review => review.finalStatus !== expectedReviewStatus(review._candidate.split)
      || (review.decisions?.hardFailures ?? []).length > 0)
    .map(review => review.recordId);
  if (negativeIds.length === 0) return { passed: true, adjudicationIds: [] };
  const resolution = adjudications.find(adjudication => (
    adjudication.resolution === 'approved'
    && adjudication.hardSafetyDisagreementResolved === true
    && negativeIds.every(id => adjudication.conflictingReviewIds.includes(id))
  ));
  return resolution
    ? { passed: true, adjudicationIds: [resolution.recordId] }
    : { passed: false, adjudicationIds: [] };
}

export function validateReviewLedger({ candidates, reviews, specs, manifest, plan, systemPrompt, schemas }) {
  const errors = [];
  const validators = schemas ?? compileV05Schemas();
  const candidateValidation = validateCandidateSet(candidates, specs, manifest, plan, {
    requireEverySlot: true,
    schemas: validators,
  });
  errors.push(...candidateValidation.errors);
  reviews.forEach((record, index) => errors.push(...schemaErrors(`review[${index}]`, validators.review, record)));
  const recordIds = reviews.map(record => record.recordId);
  if (new Set(recordIds).size !== recordIds.length) errors.push('review ledger record IDs must be unique');

  if (sha256(systemPrompt.text ?? '') !== systemPrompt.textSha256) {
    errors.push('system-prompt text hash is internally stale');
  }
  if (systemPrompt.status !== 'approved') errors.push('final review requires an approved system prompt');
  if (manifest.status !== 'frozen') errors.push('final review requires a frozen pre-prose split manifest');
  const requiredPromptRoles = new Set(['product-safeguarding', 'legal', 'privacy']);
  const approvedPromptRoles = new Set((systemPrompt.approvals ?? [])
    .filter(approval => approval.status === 'approved' && approval.evidenceRef)
    .map(approval => approval.role));
  for (const role of requiredPromptRoles) {
    if (!approvedPromptRoles.has(role)) errors.push(`system prompt lacks attributable approved ${role} evidence`);
  }

  const candidateById = new Map(candidates.map(candidate => [candidate.candidateId, candidate]));
  const reviewsByCandidate = new Map();
  const adjudicationsByCandidate = new Map();
  for (const record of reviews) {
    const candidate = candidateById.get(record.candidateId);
    if (!candidate) {
      errors.push(`${record.recordId} refers to an unknown candidate`);
      continue;
    }
    const recordSemanticErrors = validateReviewRecordSemantics(record, candidate, systemPrompt.textSha256);
    errors.push(...recordSemanticErrors);
    const destination = record.recordType === 'review' ? reviewsByCandidate : adjudicationsByCandidate;
    const entries = destination.get(record.candidateId) ?? [];
    entries.push({ ...record, _candidate: candidate, _semanticValid: recordSemanticErrors.length === 0 });
    destination.set(record.candidateId, entries);
  }

  for (const [candidateId, adjudications] of adjudicationsByCandidate) {
    const sourceReviews = reviewsByCandidate.get(candidateId) ?? [];
    const sourceIds = new Set(sourceReviews.map(review => review.recordId));
    const reviewerIds = new Set(sourceReviews.map(review => review.reviewer?.identityRef));
    for (const adjudication of adjudications) {
      if (!adjudication.conflictingReviewIds?.every(id => sourceIds.has(id))) {
        errors.push(`${adjudication.recordId} refers to a review outside its candidate and content hash`);
      }
      if (reviewerIds.has(adjudication.adjudicator?.identityRef)) {
        errors.push(`${adjudication.recordId} adjudicator must be distinct from conflicting reviewers`);
      }
      if (adjudication.adjudicator?.identityRef === candidateById.get(candidateId)?.authoring?.authorIdentityRef) {
        errors.push(`${adjudication.recordId} adjudicator must be distinct from the candidate author`);
      }
    }
  }

  const selections = [];
  for (const assignment of manifest.assignments ?? []) {
    for (const [language, rowId] of Object.entries(assignment.rowIds)) {
      const rowCandidates = candidateValidation.byRow.get(rowId) ?? [];
      const passing = [];
      for (const candidate of rowCandidates) {
        const candidateReviews = reviewsByCandidate.get(candidate.candidateId) ?? [];
        const positive = candidateReviews.filter(review => (
          review._semanticValid === true
          &&
          review.finalStatus === expectedReviewStatus(candidate.split)
          && allPass(review.decisions)
          && review.requiredChanges?.length === 0
          && review.unresolvedComments === false
        ));
        const primary = positive.find(review => languageReviewPasses(review, language));
        const safety = positive.find(review => safetyReviewPasses(review, assignment.primaryCategory));
        const specialists = (REQUIRED_SPECIALIST_ROLES[assignment.primaryCategory] ?? [])
          .map(role => positive.find(review => specialistReviewPasses(review, role)));
        const requiredReviews = [primary, safety, ...specialists];
        const identities = new Set(requiredReviews.map(review => review?.reviewer?.identityRef).filter(Boolean));
        const conflict = conflictIsResolved(candidateReviews, adjudicationsByCandidate.get(candidate.candidateId) ?? []);
        if (requiredReviews.every(Boolean) && identities.size === requiredReviews.length && conflict.passed) {
          passing.push({
            candidate,
            reviewRefs: [...requiredReviews.map(review => review.recordId), ...conflict.adjudicationIds].sort(),
          });
        }
      }
      if (passing.length !== 1) {
        errors.push(`${rowId} has ${passing.length} fully approved candidates; exactly one is required`);
        continue;
      }
      selections.push({
        rowId,
        candidateId: passing[0].candidate.candidateId,
        reviewableContentSha256: candidateContentHash(passing[0].candidate),
        reviewRefs: passing[0].reviewRefs,
      });
    }
  }

  const selectedRecordIds = new Set(selections.flatMap(selection => selection.reviewRefs));
  const selectedReviews = reviews.filter(record => selectedRecordIds.has(record.recordId));
  const summary = {
    schema: 'com.saferide.ai.v05-review-summary',
    schemaVersion: 1,
    datasetId: plan.datasetId,
    classification: 'restricted-content-free',
    candidateCount: candidates.length,
    finalRowCount: selections.length,
    reviewRecordCount: reviews.filter(record => record.recordType === 'review').length,
    adjudicationRecordCount: selectedReviews.filter(record => record.recordType === 'adjudication').length,
    primaryReviewCount: selectedReviews.filter(record => record.reviewKind === 'primary-language-content').length,
    safetyDomainReviewCount: selectedReviews.filter(record => record.reviewKind === 'safety-domain').length,
    specialistDomainReviewCount: selectedReviews.filter(record => record.reviewKind === 'specialist-domain').length,
    languageAssessment: {
      agreed: selectedReviews.filter(record => record.reviewKind === 'primary-language-content' && record.languageAssessment?.result === 'agrees').length,
      adjudicatedMismatch: selectedReviews.filter(record => record.reviewKind === 'primary-language-content' && record.languageAssessment?.result === 'mismatch' && record.languageAssessment?.adjudicationStatus === 'approved').length,
      adjudicatedUndetermined: selectedReviews.filter(record => record.reviewKind === 'primary-language-content' && record.languageAssessment?.result === 'undetermined' && record.languageAssessment?.adjudicationStatus === 'approved').length,
      blocked: selectedReviews.filter(record => record.reviewKind === 'primary-language-content' && record.languageAssessment?.adjudicationStatus === 'blocked').length,
    },
    approvedByLanguage: Object.fromEntries(['en', 'sw'].map(language => [
      language,
      selections.filter(selection => selection.rowId.endsWith(`-${language}`)).length,
    ])),
    approvedByCategory: Object.fromEntries(CATEGORIES.map(category => [
      category,
      selections.filter(selection => selection.rowId.startsWith(`v05-${category}-`)).length,
    ])),
    systemPromptTextSha256: systemPrompt.textSha256,
    selectionInventorySha256: sha256(stableJson(selections)),
    selections,
    implementation: {
      path: 'scripts/saferide-gemma4-v05-review-check.mjs',
      sha256: fileSha256(reviewScriptPath),
    },
    passed: errors.length === 0,
    failureCount: errors.length,
  };
  return { errors, summary, selections };
}

function contractCheck() {
  compileV05Schemas();
  console.log('SafeRide v0.5 review contract: PASS (schemas compile; no ledger content read).');
  console.log('Human row approvals remain unavailable and are not inferred by this check.');
  return 0;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.contractCheck) return contractCheck();
  const required = ['plan', 'scenarios', 'splitManifest', 'candidates', 'reviews', 'systemPrompt'];
  for (const field of required) if (!args[field]) throw new Error(`--${field.replace(/[A-Z]/g, value => `-${value.toLowerCase()}`)} is required`);
  const paths = Object.fromEntries(required.map(field => [field, resolve(args[field])]));
  const result = validateReviewLedger({
    plan: readJson(paths.plan),
    specs: readJsonl(paths.scenarios),
    manifest: readJson(paths.splitManifest),
    candidates: readJsonl(paths.candidates),
    reviews: readJsonl(paths.reviews),
    systemPrompt: readJson(paths.systemPrompt),
    schemas: compileV05Schemas(),
  });
  console.log('SafeRide v0.5 restricted review-ledger check');
  console.log(`Candidate SHA-256: ${fileSha256(paths.candidates)}`);
  console.log(`Review-ledger SHA-256: ${fileSha256(paths.reviews)}`);
  console.log(`Approved row slots: ${result.summary.finalRowCount}/2600`);
  if (result.errors.length) {
    result.errors.forEach(error => console.error(`- ${error}`));
    return 1;
  }
  if (args.output) {
    const summaryErrors = schemaErrors('reviewSummary', compileV05Schemas().reviewSummary, result.summary);
    if (summaryErrors.length) throw new Error(`Generated review summary failed:\n- ${summaryErrors.join('\n- ')}`);
    const output = validatePrivateOutputRoot(resolve(args.output));
    fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.dirname(output), 0o700);
    fs.writeFileSync(output, `${JSON.stringify(result.summary, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(output, 0o600);
    console.log(`Content-free review summary: ${path.relative(repoRoot, output) || output}`);
  }
  console.log('PASS (hash-bound primary/language and safety/domain review coverage).');
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
