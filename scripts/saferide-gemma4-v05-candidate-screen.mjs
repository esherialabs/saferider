#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  cosine,
  distinctMetric,
  jaccard,
  ngrams,
  normalizeText,
  percentile,
  termFrequency,
  words,
} from './lib/saferide-v05-text-metrics.mjs';
import {
  CATEGORIES,
  DATASET_ID,
  DEFAULT_PLAN_PATH,
  LANGUAGES,
  REPO_ROOT,
  SPLITS,
  candidateContentHash,
  candidateContext,
  canonicalSha256,
  compareCandidates,
  compileV05Schemas,
  fileSha256,
  jsonlText,
  lexicalLanguageAssessment,
  privacyFindings,
  readJson,
  readJsonl,
  responseSkeletonId,
  schemaErrors,
  sha256,
  stableJson,
  validateCandidate,
  validatePlanSemantics,
  validateSplitManifestSemantics,
} from './lib/saferide-gemma4-v05.mjs';
import { validatePolicyAndPrompt, validateScenarioMatrix } from './saferide-gemma4-v05-build.mjs';
import {
  artifactPath,
  assertPrivateFile,
  atomicWritePrivate,
  enforcePrivateUmask,
  secureArtifactRoot,
} from './lib/saferide-artifact-security.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const CANDIDATE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{7,127}$/;
const DETAIL_PRIVACY = Object.freeze({ containsRawText: false, containsReviewerNotes: false, containsEmbeddings: false });
const PUBLIC_PRIVACY = Object.freeze({
  containsCandidateText: false,
  containsReviewerNotes: false,
  containsHoldouts: false,
  containsEmbeddings: false,
  classification: 'public-safe-aggregate',
});
const STAGES = Object.freeze([
  'binding-structure',
  'security-privacy',
  'product-policy',
  'language',
  'exact-duplicate',
  'lexical-near-duplicate',
  'semantic-similarity',
  'diversity',
]);
const SHENG_MARKERS = new Set(['maze', 'msee', 'manze', 'siati', 'rada', 'mbogi', 'nimejam']);
const LANGUAGE_MARKERS = Object.freeze({
  en: new Set(['a', 'and', 'are', 'can', 'do', 'for', 'i', 'if', 'is', 'it', 'my', 'not', 'of', 'or', 'safe', 'that', 'the', 'this', 'to', 'what', 'you', 'your']),
  sw: new Set(['au', 'hii', 'hilo', 'ikiwa', 'kwa', 'lakini', 'na', 'ni', 'nina', 'salama', 'si', 'taarifa', 'unaweza', 'usalama', 'ya', 'yako', 'je', 'kwamba']),
});

const EXTRA_SENSITIVE_PATTERNS = Object.freeze([
  ['PHONE_LIKE', 'phone-number-like', /(?:\+?\d[\d\s().-]{7,}\d)/g],
  ['PRECISE_ADDRESS', 'precise-location', /\b(?:plot|house|flat|apartment|room|building|street|road|lane|avenue|estate)\s*(?:no\.?\s*)?[a-z0-9-]{1,20}\b/gi],
  ['POSTAL_ADDRESS', 'precise-location', /\bP\.?\s*O\.?\s*Box\s+\d{2,}\b/gi],
  ['RAW_AUTH_HEADER', 'raw-header', /\b(?:authorization|proxy-authorization|x-api-key|cookie|set-cookie)\s*:\s*[^\s]+/gi],
  ['BEARER_TOKEN', 'credential', /\bBearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}\b/g],
  ['STACK_TRACE', 'raw-stack-trace', /\b(?:Traceback \(most recent call last\)|at\s+[A-Za-z_$][\w.$]*\s*\([^\n]+:\d+:\d+\))/g],
  ['PAYMENT_IDENTIFIER', 'payment-identifier', /\b(?:M-PESA|MPESA|transaction|payment)\s+(?:code|id|reference|ref)\s*[:#-]?\s*[A-Z0-9-]{5,}\b/gi],
  ['CASE_REFERENCE', 'official-identifier', /\b(?:case|report|registration|file)\s+(?:id|number|no\.?|reference|ref)\s*[:#-]?\s*[A-Z0-9/-]{4,}\b/gi],
  ['NAMED_CASE_ENTITY', 'possible-real-case-entity', /\b(?:survivor|complainant|patient|client)\s+(?:named|called)\s+[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/g],
]);

const ASSISTANT_HARD_RULES = Object.freeze([
  ['PROFESSIONAL_AUTHORITY_CLAIM', 'unsupported-authority', /\b(?:i am|i'm|mimi ni)\s+(?:a\s+)?(?:lawyer|doctor|clinician|counsellor|counselor|police officer|emergency responder|wakili|daktari)\b/i],
  ['LEGAL_OR_MEDICAL_DETERMINATION', 'unsupported-domain-fact', /\b(?:you definitely have|you are legally entitled|the law guarantees|you will win|i diagnose|my diagnosis is|take \d+\s*(?:mg|ml)|utashinda kesi|sheria inahakikisha)\b/i],
  ['BLAME_OR_COERCION', 'unsafe-agency', /\b(?:this is your fault|you caused this|you must report|you have to confront|you should have prevented|ni kosa lako|lazima uripoti|lazima ukabiliane)\b/i],
  ['HIDDEN_PROMPT_DISCLOSURE', 'hidden-instruction-disclosure', /\b(?:the hidden (?:prompt|instructions?) (?:is|are)|my system prompt (?:is|says)|sera (?:ya siri|iliyofichwa) (?:ni|inasema))\b/i],
  ['UNSUPPORTED_SAFERIDE_CAPABILITY', 'unsupported-product-capability', /\bSafeRide\s+(?:automatically\s+)?(?:sends|uploads|shares|deletes|alerts|calls|tracks|backs up|encrypts)\b/i],
]);

const AMBIGUOUS_DOMAIN_PATTERNS = Object.freeze([
  ['UNSUPPORTED_PROVIDER_FACT', 'provider-fact', /\b(?:UNICEF|the police|polisi|hospital|hospitali|provider|mtoa huduma|court|mahakama)\s+(?:has|have|will|must|did|can guarantee|ime|wame|ita|lazima)\w*/i],
  ['UNSUPPORTED_OFFICIAL_PROCESS', 'official-process-fact', /\b(?:official form|legal form|police form|court form|filing fee|service fee|official process|fomu rasmi|ada ya)\b/i],
]);

function usage() {
  return [
    'Usage: node scripts/saferide-gemma4-v05-candidate-screen.mjs',
    '  --artifact-root <absolute-dir> [--plan <json>] --scenarios <jsonl>',
    '  --split-manifest <json> --candidate <jsonl> [--candidate <jsonl> ...]',
    '  --policy <json> --system-prompt <json> [--token-report <json>] [--semantic-report <json>]',
    '  --candidate-index <json> --semantic-request <json> --report <json> --details <jsonl> --shortlist <jsonl> [--strict]',
    '',
    'Candidate text is written only to the restricted shortlist. Stdout and aggregate reports are content-free.',
  ].join('\n');
}

function parseArgs(argv) {
  if (argv.some(argument => ['--help', '-h'].includes(argument))) {
    console.log(usage());
    process.exit(0);
  }
  const args = { plan: DEFAULT_PLAN_PATH, candidates: [], strict: false };
  if (argv.length === 1 && argv[0] === '--contract-check') return { contractCheck: true };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--artifact-root') args.artifactRoot = argv[++index];
    else if (argument === '--plan') args.plan = argv[++index];
    else if (argument === '--scenarios') args.scenarios = argv[++index];
    else if (argument === '--split-manifest') args.splitManifest = argv[++index];
    else if (argument === '--candidate') args.candidates.push(argv[++index]);
    else if (argument === '--policy') args.policy = argv[++index];
    else if (argument === '--system-prompt') args.systemPrompt = argv[++index];
    else if (argument === '--token-report') args.tokenReport = argv[++index];
    else if (argument === '--semantic-report') args.semanticReport = argv[++index];
    else if (argument === '--candidate-index') args.candidateIndex = argv[++index];
    else if (argument === '--semantic-request') args.semanticRequest = argv[++index];
    else if (argument === '--report') args.report = argv[++index];
    else if (argument === '--details') args.details = argv[++index];
    else if (argument === '--shortlist') args.shortlist = argv[++index];
    else if (argument === '--strict') args.strict = true;
    else throw new Error(`Unknown or incomplete argument: ${argument}\n\n${usage()}`);
  }
  for (const field of ['artifactRoot', 'scenarios', 'splitManifest', 'policy', 'systemPrompt', 'candidateIndex', 'semanticRequest', 'report', 'details', 'shortlist']) {
    if (!args[field]) throw new Error(`--${field.replace(/[A-Z]/g, value => `-${value.toLowerCase()}`)} is required`);
  }
  if (!args.candidates.length || args.candidates.some(value => !value)) throw new Error('At least one complete --candidate path is required');
  return args;
}

function round(value) {
  return Number(Number(value).toFixed(6));
}

function safeCandidateId(candidate, index) {
  return typeof candidate?.candidateId === 'string' && candidate.candidateId
    ? candidate.candidateId
    : `invalid-candidate-${String(index).padStart(6, '0')}`;
}

function safeRowId(candidate, index) {
  return typeof candidate?.id === 'string' && candidate.id
    ? candidate.id
    : `invalid-row-${String(index).padStart(6, '0')}`;
}

function screenableCandidate(candidate) {
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : {};
}

function screenedContentHash(candidate) {
  const screenable = screenableCandidate(candidate);
  return Object.keys(screenable).length && Array.isArray(screenable.messages)
    ? candidateContentHash(screenable)
    : canonicalSha256(candidate);
}

function candidateInventory(candidates) {
  return candidates.map((candidate, index) => ({
    candidateId: safeCandidateId(candidate, index),
    candidateContentSha256: screenedContentHash(candidate),
  })).sort((left, right) => left.candidateId.localeCompare(right.candidateId)
    || left.candidateContentSha256.localeCompare(right.candidateContentSha256));
}

export function candidateTokenInventory(candidates) {
  const inventory = candidateInventory(candidates);
  return { inventory, inventorySha256: canonicalSha256(inventory) };
}

function crossSplitPairCount(candidates) {
  const counts = Object.fromEntries(SPLITS.map(split => [split, 0]));
  for (const candidate of candidates) if (counts[candidate.split] !== undefined) counts[candidate.split] += 1;
  let total = 0;
  for (let left = 0; left < SPLITS.length; left += 1) {
    for (let right = left + 1; right < SPLITS.length; right += 1) total += counts[SPLITS[left]] * counts[SPLITS[right]];
  }
  return total;
}

export function createCandidateSemanticRequest(candidates, bindings) {
  const records = candidates.map(candidate => ({
    candidateId: candidate.candidateId,
    candidateContentSha256: candidateContentHash(candidate),
    split: candidate.split,
  })).sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  const candidateInventorySha256 = canonicalSha256(records);
  return {
    schema: 'com.saferide.ai.v05-candidate-semantic-request',
    schemaVersion: 1,
    requestId: `v05-semantic-request-${canonicalSha256({ bindings, candidateInventorySha256 }).slice(0, 16)}`,
    datasetId: DATASET_ID,
    classification: 'restricted-content-free-identifiers',
    bindings,
    candidateCount: records.length,
    crossSplitPairCount: crossSplitPairCount(records),
    candidateInventorySha256,
    candidates: records,
    privacy: { containsRawText: false, containsEmbeddings: false },
  };
}

function fileArtifact(text) {
  const bytes = Buffer.byteLength(text);
  return { sha256: sha256(text), sizeBytes: bytes };
}

function makeEntries(candidates, candidateSources = null) {
  return candidates.map((candidate, index) => {
    const screenable = screenableCandidate(candidate);
    const source = candidateSources?.[index] ?? { sourceFileOrdinal: 0, sourceRecordOrdinal: index };
    return {
      key: `${safeCandidateId(screenable, index)}\u0000${String(index).padStart(6, '0')}`,
      index,
      candidate: screenable,
      candidateId: safeCandidateId(screenable, index),
      rowId: safeRowId(screenable, index),
      contentSha256: screenedContentHash(candidate),
      sourceFileOrdinal: source.sourceFileOrdinal,
      sourceRecordOrdinal: source.sourceRecordOrdinal,
      findings: [],
    };
  });
}

function findingFingerprint(ruleId, match) {
  return sha256(`${ruleId}\u0000${normalizeText(match)}`);
}

function addFinding(entry, {
  ruleId,
  stage,
  fieldPath = 'candidate',
  matchClass,
  severity,
  outcome,
  match = ruleId,
  otherCandidateId = null,
  otherSplit = null,
  comparedField = null,
  similarity = null,
}) {
  const finding = {
    ruleId,
    stage,
    fieldPath,
    matchClass,
    severity,
    outcome,
    fingerprint: findingFingerprint(ruleId, match),
    otherCandidateId,
    otherSplit,
    comparedField,
    similarity: similarity === null ? null : round(similarity),
  };
  const key = stableJson(finding);
  if (!entry.findings.some(existing => stableJson(existing) === key)) entry.findings.push(finding);
}

function entryState(entry) {
  if (entry.findings.some(finding => finding.outcome === 'quarantined')) return 'quarantined';
  if (entry.findings.some(finding => finding.outcome === 'rejected')) return 'rejected';
  if (entry.findings.some(finding => finding.outcome === 'needs-adjudication')) return 'needs-adjudication';
  return 'eligible';
}

function addGlobalFinding(entries, ruleId, stage, matchClass, severity = 'adjudication', outcome = 'needs-adjudication') {
  for (const entry of entries) addFinding(entry, { ruleId, stage, matchClass, severity, outcome });
}

function assistantStrings(candidate) {
  return (Array.isArray(candidate.messages) ? candidate.messages : []).map((message, index) => ({ ...message, index }))
    .filter(message => message.role === 'assistant' && typeof message.content === 'string');
}

function allMessageStrings(candidate) {
  return (Array.isArray(candidate.messages) ? candidate.messages : []).map((message, index) => ({ ...message, index }))
    .filter(message => typeof message.content === 'string');
}

function validateBaseContracts({ plan, specs, manifest, schemas }) {
  const errors = [
    ...schemaErrors('plan', schemas.plan, plan),
    ...validatePlanSemantics(plan),
    ...validateScenarioMatrix(specs, plan, schemas),
    ...schemaErrors('splitManifest', schemas.splitManifest, manifest),
    ...validateSplitManifestSemantics(manifest, plan, specs),
  ];
  if (manifest.status !== 'frozen') errors.push('split manifest is not frozen');
  for (const approval of Object.values(manifest.approvals ?? {})) {
    if (approval?.status !== 'approved' || !approval?.evidenceRef) errors.push('split approval is incomplete');
  }
  if (specs.some(spec => spec.matrixReview?.status !== 'approved' || !spec.matrixReview?.evidenceRef)) {
    errors.push('scenario matrix approval is incomplete');
  }
  return errors;
}

function screenStructure(entries, specs, manifest, plan, schemas, allowTestFixtures) {
  const context = candidateContext(specs, manifest, schemas, { allowTestFixtures });
  for (const entry of entries) {
    const callable = Array.isArray(entry.candidate.messages);
    const errors = (callable
      ? validateCandidate(entry.candidate, context)
      : schemaErrors(`candidate ${entry.candidateId}`, schemas.example, entry.candidate))
      .filter(error => !error.includes(' contains prohibited '));
    for (const error of errors) {
      addFinding(entry, {
        ruleId: 'STRUCTURAL_CONTRACT',
        stage: 'binding-structure',
        matchClass: 'schema-binding-or-provenance',
        severity: 'hard',
        outcome: 'rejected',
        match: error,
      });
    }
    const messages = Array.isArray(entry.candidate.messages) ? entry.candidate.messages : [];
    if (![2, 4, 6, 8].includes(messages.length)) {
      addFinding(entry, {
        ruleId: 'MESSAGE_COUNT', stage: 'binding-structure', fieldPath: 'messages',
        matchClass: 'unsupported-message-count', severity: 'hard', outcome: 'rejected', match: String(messages.length),
      });
    }
    if (messages.some(message => message?.role === 'system')) {
      addFinding(entry, {
        ruleId: 'SYSTEM_MESSAGE_DUPLICATION', stage: 'binding-structure', fieldPath: 'messages',
        matchClass: 'candidate-supplied-system-message', severity: 'hard', outcome: 'rejected',
      });
    }
    if (CANDIDATE_ID_PATTERN.test(entry.candidateId)
      && entry.candidate.metadata?.responseSkeletonId !== responseSkeletonId(messages)) {
      addFinding(entry, {
        ruleId: 'RESPONSE_SKELETON_BINDING', stage: 'binding-structure', fieldPath: 'metadata.responseSkeletonId',
        matchClass: 'stale-response-skeleton', severity: 'hard', outcome: 'rejected',
      });
    }
    for (const message of assistantStrings(entry.candidate)) {
      const count = words(message.content).length;
      if (count > plan.auditPolicy.normalResponseWordMaximum && !entry.candidate.metadata?.longResponseReason) {
        addFinding(entry, {
          ruleId: 'LONG_RESPONSE_UNJUSTIFIED', stage: 'binding-structure', fieldPath: `messages[${message.index}].content`,
          matchClass: 'response-length', severity: 'hard', outcome: 'rejected', match: String(count),
        });
      } else if (count > plan.auditPolicy.normalResponseWordMaximum || count < plan.auditPolicy.normalResponseWordMinimum) {
        addFinding(entry, {
          ruleId: 'RESPONSE_LENGTH_EXCEPTION', stage: 'binding-structure', fieldPath: `messages[${message.index}].content`,
          matchClass: 'response-length', severity: 'adjudication', outcome: 'needs-adjudication', match: String(count),
        });
      }
    }
  }

  const byCandidateId = new Map();
  const byRowId = new Map();
  for (const entry of entries) {
    const ids = byCandidateId.get(entry.candidateId) ?? [];
    ids.push(entry);
    byCandidateId.set(entry.candidateId, ids);
    const rows = byRowId.get(entry.rowId) ?? [];
    rows.push(entry);
    byRowId.set(entry.rowId, rows);
  }
  for (const group of byCandidateId.values()) {
    if (group.length < 2) continue;
    for (const entry of group) addFinding(entry, {
      ruleId: 'DUPLICATE_CANDIDATE_ID', stage: 'binding-structure', fieldPath: 'candidateId',
      matchClass: 'identity-collision', severity: 'hard', outcome: 'rejected', match: entry.candidateId,
    });
  }
  for (const group of byRowId.values()) {
    if (group.length <= plan.candidateAuthoring.maximumCandidatesPerFamilyLanguage) continue;
    for (const entry of group) addFinding(entry, {
      ruleId: 'CANDIDATE_SLOT_MAXIMUM', stage: 'binding-structure', fieldPath: 'id',
      matchClass: 'more-than-three-candidates', severity: 'hard', outcome: 'rejected', match: entry.rowId,
    });
  }
  return { context, byRowId };
}

function validateTokenReport({ tokenReport, entries, plan, systemPrompt, hashes, schemas, allowTestFixtures }) {
  const result = { trusted: true, errors: [], records: new Map() };
  if (!tokenReport) {
    result.trusted = false;
    result.errors.push('missing');
    addGlobalFinding(entries, 'TOKENIZATION_REPORT_MISSING', 'binding-structure', 'external-tokenization-evidence');
    return result;
  }
  const reportErrors = schemaErrors('tokenizationReport', schemas.tokenizationReport, tokenReport);
  if (reportErrors.length) result.errors.push('schema');
  const expected = candidateTokenInventory(entries.map(entry => entry.candidate));
  const expectedBindings = {
    planSha256: hashes.planSha256,
    candidateInventorySha256: expected.inventorySha256,
    policySha256: hashes.policySha256,
    systemPromptConfigSha256: hashes.systemPromptConfigSha256,
    systemPromptTextSha256: systemPrompt.textSha256,
  };
  if (stableJson(tokenReport.bindings) !== stableJson(expectedBindings)) result.errors.push('bindings');
  if (tokenReport.method?.maximumSequenceLength !== plan.training.maxSequenceLength
    || tokenReport.method?.rejectTruncation !== plan.training.rejectTruncation) result.errors.push('training-contract');
  if (tokenReport.status !== 'approved-controlled' && !allowTestFixtures) result.errors.push('unapproved');
  if (tokenReport.status === 'approved-controlled'
    && (tokenReport.approval?.status !== 'approved' || tokenReport.approval?.reviewerRole !== 'technical-ml' || !tokenReport.approval?.evidenceRef)) {
    result.errors.push('approval');
  }
  if (tokenReport.recordCount !== tokenReport.records?.length || tokenReport.recordCount !== entries.length) result.errors.push('record-count');
  for (const record of tokenReport.records ?? []) {
    if (result.records.has(record.candidateId)) result.errors.push('duplicate-record');
    result.records.set(record.candidateId, record);
  }
  if (result.errors.length) {
    result.trusted = false;
    addGlobalFinding(entries, 'TOKENIZATION_REPORT_INVALID', 'binding-structure', 'token-report-binding-or-approval');
    return result;
  }
  for (const entry of entries) {
    const record = result.records.get(entry.candidateId);
    if (!record || record.candidateContentSha256 !== entry.contentSha256) {
      addFinding(entry, {
        ruleId: 'TOKENIZATION_RECORD_BINDING', stage: 'binding-structure', fieldPath: 'tokenizationReport.records',
        matchClass: 'missing-or-stale-token-record', severity: 'hard', outcome: 'rejected',
      });
      continue;
    }
    if (record.truncated !== false || record.totalTokens > plan.training.maxSequenceLength) {
      addFinding(entry, {
        ruleId: 'TOKEN_LIMIT_OR_TRUNCATION', stage: 'binding-structure', fieldPath: 'tokenizationReport.records.totalTokens',
        matchClass: record.truncated ? 'truncation' : 'sequence-over-1024', severity: 'hard', outcome: 'rejected',
        match: `${record.totalTokens}:${record.truncated}`,
      });
    }
    if (record.assistantTokens > record.totalTokens) {
      addFinding(entry, {
        ruleId: 'ASSISTANT_TOKEN_COUNT', stage: 'binding-structure', fieldPath: 'tokenizationReport.records.assistantTokens',
        matchClass: 'invalid-assistant-token-count', severity: 'hard', outcome: 'rejected',
      });
    }
  }
  return result;
}

function screenPrivacy(entries) {
  for (const entry of entries) {
    for (const finding of privacyFindings({ messages: entry.candidate.messages, authoring: entry.candidate.authoring }, 'candidate')) {
      addFinding(entry, {
        ruleId: `PRIVATE_${finding.code.toUpperCase().replaceAll('-', '_')}`,
        stage: 'security-privacy', fieldPath: finding.location, matchClass: finding.code,
        severity: 'quarantine', outcome: 'quarantined', match: `${entry.contentSha256}:${finding.location}:${finding.code}`,
      });
    }
    for (const message of allMessageStrings(entry.candidate)) {
      for (const [ruleId, matchClass, pattern] of EXTRA_SENSITIVE_PATTERNS) {
        const matcher = new RegExp(pattern.source, pattern.flags);
        const match = matcher.exec(message.content);
        if (!match) continue;
        addFinding(entry, {
          ruleId, stage: 'security-privacy', fieldPath: `messages[${message.index}].content`, matchClass,
          severity: 'quarantine', outcome: 'quarantined', match: match[0],
        });
      }
    }
  }
}

function assistantText(candidate) {
  return assistantStrings(candidate).map(message => message.content).join('\n');
}

function detectedBehaviors(candidate) {
  const value = normalizeText(assistantText(candidate));
  return {
    safeNextStep: /\b(?:you can|consider|one (?:small )?(?:step|option)|if (?:it is|you are) safe|unaweza|hatua|ikiwa (?:ni |uko )?salama)\b/.test(value),
    explicitUncertainty: /\b(?:cannot confirm|can t confirm|unconfirmed|unknown|not (?:know|verified|confirmed)|uncertain|siwezi kuthibitisha|haijathibitishwa|haijulikani|sijui)\b/.test(value),
    stateDistinction: /\b(?:not|isn t|doesn t|different from|but|however|si|siyo|tofauti na|lakini)\b/.test(value),
    counterfactual: /\b(?:if|unless|would|could be|ikiwa|kama|isipokuwa)\b/.test(value),
    refusalBoundary: /\b(?:i can t|i cannot|i won t|siwezi|sitaweza|not able to)\b/.test(value),
  };
}

function stateClaimFindings(entry, spec) {
  const value = assistantText(entry.candidate);
  const claims = [
    ['received-confirmed', /\b(?:has been|was|is|they have|UNICEF has|provider has)\s+(?:received|read|accepted)|\b(?:imepokelewa|wamepokea|imesomwa)\b/i],
    ['sent-unconfirmed', /\b(?:has been|was|is)\s+sent|\bimetumwa\b/i],
    ['saved-locally', /\b(?:has been|was|is)\s+saved|\bimehifadhiwa\b/i],
    ['syncing', /\b(?:has been|was|is)\s+(?:synced|uploaded)|\bimepakiwa|imesawazishwa\b/i],
    ['deleted', /\b(?:has been|was|is)\s+(?:deleted|erased)|\bimefutwa\b/i],
    ['escalated', /\b(?:has been|was|is|will be)\s+escalated|\bimepelekwa kwa mamlaka\b/i],
  ];
  const allowed = new Set({
    'received-confirmed': ['received-confirmed', 'sent-unconfirmed', 'saved-locally'],
    'sent-unconfirmed': ['sent-unconfirmed', 'saved-locally'],
    syncing: ['syncing', 'saved-locally'], queued: ['saved-locally'], 'saved-locally': ['saved-locally'],
  }[spec?.appState] ?? []);
  for (const [claim, pattern] of claims) {
    if (!pattern.test(value) || allowed.has(claim)) continue;
    addFinding(entry, {
      ruleId: 'PRODUCT_STATE_CONTRADICTION', stage: 'product-policy', fieldPath: 'messages[*].assistant',
      matchClass: `unsupported-${claim}`, severity: 'hard', outcome: 'rejected', match: claim,
    });
  }
  if (['unknown', 'incomplete', 'conflicting', 'user-provided-only', 'visible-app-state-only'].includes(spec?.informationState)
    && /\b(?:definitely|certainly|i confirm|it is confirmed|ninathibitisha|bila shaka|hakika kabisa)\b/i.test(value)) {
    addFinding(entry, {
      ruleId: 'UNSUPPORTED_CERTAINTY', stage: 'product-policy', fieldPath: 'messages[*].assistant',
      matchClass: 'certainty-over-unknown-state', severity: 'hard', outcome: 'rejected',
    });
  }
}

function screenPolicyAndProduct(entries, specs, policy, systemPrompt, allowTestFixtures) {
  const specById = new Map(specs.map(spec => [spec.scenarioFamilyId, spec]));
  const policyRefs = new Set((policy.boundaries ?? []).map(boundary => boundary.boundaryId));
  for (const entry of entries) {
    const spec = specById.get(entry.candidate.metadata?.scenarioFamilyId);
    if (!allowTestFixtures) {
      const unknown = (entry.candidate.metadata?.sourcePolicyRefs ?? []).filter(ref => !policyRefs.has(ref));
      if (unknown.length) addFinding(entry, {
        ruleId: 'UNKNOWN_POLICY_REFERENCE', stage: 'product-policy', fieldPath: 'metadata.sourcePolicyRefs',
        matchClass: 'unapproved-policy-source', severity: 'hard', outcome: 'rejected', match: unknown.join('|'),
      });
    }
    const assistant = assistantText(entry.candidate);
    for (const [ruleId, matchClass, pattern] of ASSISTANT_HARD_RULES) {
      const match = pattern.exec(assistant);
      if (match) addFinding(entry, {
        ruleId, stage: 'product-policy', fieldPath: 'messages[*].assistant', matchClass,
        severity: 'hard', outcome: 'rejected', match: match[0],
      });
    }
    for (const [ruleId, matchClass, pattern] of AMBIGUOUS_DOMAIN_PATTERNS) {
      const match = pattern.exec(assistant);
      if (match) addFinding(entry, {
        ruleId, stage: 'product-policy', fieldPath: 'messages[*].assistant', matchClass,
        severity: 'adjudication', outcome: 'needs-adjudication', match: match[0],
      });
    }
    stateClaimFindings(entry, spec);
    for (const prohibited of spec?.prohibitedBehavior ?? []) {
      const normalized = normalizeText(prohibited);
      if (normalized.length >= 12 && normalizeText(assistant).includes(normalized)) addFinding(entry, {
        ruleId: 'SCENARIO_PROHIBITED_BEHAVIOR', stage: 'product-policy', fieldPath: 'messages[*].assistant',
        matchClass: 'direct-prohibited-behavior-match', severity: 'hard', outcome: 'rejected', match: prohibited,
      });
    }
    const detected = detectedBehaviors(entry.candidate);
    for (const [flag, required] of Object.entries(spec?.behaviorFlags ?? {})) {
      if (!required || !['safeNextStep', 'explicitUncertainty', 'stateDistinction', 'counterfactual'].includes(flag) || detected[flag]) continue;
      addFinding(entry, {
        ruleId: `REQUIRED_${flag.replace(/[A-Z]/g, value => `_${value}`).toUpperCase()}`,
        stage: 'product-policy', fieldPath: 'messages[*].assistant', matchClass: 'required-behavior-not-detected',
        severity: 'adjudication', outcome: 'needs-adjudication', match: flag,
      });
    }
    if (spec?.primaryCategory === 'jailbreak' && !detected.refusalBoundary) addFinding(entry, {
      ruleId: 'JAILBREAK_BOUNDARY_NOT_DETECTED', stage: 'product-policy', fieldPath: 'messages[*].assistant',
      matchClass: 'hidden-prompt-boundary', severity: 'adjudication', outcome: 'needs-adjudication',
    });
  }
  return { specById, policyPromptErrors: validatePolicyAndPrompt(policy, systemPrompt) };
}

function screenLanguage(entries) {
  for (const entry of entries) {
    const assessment = lexicalLanguageAssessment(Array.isArray(entry.candidate.messages) ? entry.candidate.messages : []);
    if (assessment.predicted === 'undetermined' || assessment.predicted !== entry.candidate.metadata?.language) {
      addFinding(entry, {
        ruleId: assessment.predicted === 'undetermined' ? 'LANGUAGE_ID_UNDETERMINED' : 'LANGUAGE_ID_MISMATCH',
        stage: 'language', fieldPath: 'messages', matchClass: 'deterministic-language-id',
        severity: 'adjudication', outcome: 'needs-adjudication', match: `${assessment.predicted}:${entry.candidate.metadata?.language}`,
      });
    }
    const tokens = words(allMessageStrings(entry.candidate).map(message => message.content).join(' '));
    const sheng = [...new Set(tokens.filter(token => SHENG_MARKERS.has(token)))];
    if (sheng.length >= 2) addFinding(entry, {
      ruleId: 'SHENG_OUT_OF_SCOPE', stage: 'language', fieldPath: 'messages', matchClass: 'out-of-scope-register',
      severity: 'adjudication', outcome: 'needs-adjudication', match: sheng.join('|'),
    });
    const expectedLanguage = entry.candidate.metadata?.language;
    const oppositeLanguage = expectedLanguage === 'en' ? 'sw' : 'en';
    const expectedMarkers = tokens.filter(token => LANGUAGE_MARKERS[expectedLanguage]?.has(token)).length;
    const oppositeMarkers = tokens.filter(token => LANGUAGE_MARKERS[oppositeLanguage]?.has(token)).length;
    const markerTotal = expectedMarkers + oppositeMarkers;
    if (oppositeMarkers >= 3 && oppositeMarkers / Math.max(1, markerTotal) >= 0.3) {
      addFinding(entry, {
        ruleId: 'EXCESSIVE_CODE_SWITCH', stage: 'language', fieldPath: 'messages', matchClass: 'opposite-language-markers',
        severity: 'adjudication', outcome: 'needs-adjudication', match: `${expectedMarkers}:${oppositeMarkers}`,
      });
    }
  }
}

function enforcePairedBehaviorIntent(entries, specById) {
  const byFamilyLanguage = new Map();
  for (const entry of entries) {
    const family = entry.candidate.metadata?.scenarioFamilyId;
    const language = entry.candidate.metadata?.language;
    if (!family || !LANGUAGES.includes(language)) continue;
    const key = `${family}:${language}`;
    const group = byFamilyLanguage.get(key) ?? [];
    group.push(entry);
    byFamilyLanguage.set(key, group);
  }
  for (const [familyId, spec] of specById) {
    const languageSignals = Object.fromEntries(LANGUAGES.map(language => {
      const candidates = byFamilyLanguage.get(`${familyId}:${language}`) ?? [];
      const signals = Object.fromEntries(['safeNextStep', 'explicitUncertainty', 'stateDistinction', 'counterfactual']
        .map(flag => [flag, candidates.some(entry => detectedBehaviors(entry.candidate)[flag])]));
      return [language, { candidates, signals }];
    }));
    if (!languageSignals.en.candidates.length || !languageSignals.sw.candidates.length) continue;
    for (const flag of ['safeNextStep', 'explicitUncertainty', 'stateDistinction', 'counterfactual']) {
      if (!spec.behaviorFlags?.[flag] || languageSignals.en.signals[flag] === languageSignals.sw.signals[flag]) continue;
      for (const language of LANGUAGES) for (const entry of languageSignals[language].candidates) addFinding(entry, {
        ruleId: 'PAIRED_BEHAVIOR_INTENT_MISMATCH', stage: 'language', fieldPath: 'messages[*].assistant',
        matchClass: `paired-${flag}`, severity: 'adjudication', outcome: 'needs-adjudication', match: `${familyId}:${flag}`,
      });
    }
  }
}

function screeningDocuments(entries) {
  const documents = [];
  for (const entry of entries) {
    const messages = Array.isArray(entry.candidate.messages) ? entry.candidate.messages : [];
    const conversationRaw = JSON.stringify(messages);
    const conversationNormalized = messages.map(message => `${message?.role ?? 'invalid'}:${normalizeText(message?.content ?? '')}`).join('\n');
    documents.push({
      entry, field: 'conversation', turnIndex: null, raw: conversationRaw, normalized: conversationNormalized,
      exactHash: sha256(conversationRaw), normalizedHash: sha256(conversationNormalized), tokens: words(conversationNormalized),
    });
    messages.forEach((message, index) => {
      if (!['user', 'assistant'].includes(message?.role) || typeof message.content !== 'string') return;
      const field = message.role === 'user' ? 'user-turn' : 'assistant-target';
      const normalized = normalizeText(message.content);
      documents.push({
        entry, field, turnIndex: index, raw: message.content, normalized,
        exactHash: sha256(message.content), normalizedHash: sha256(normalized), tokens: words(normalized),
      });
      if (message.role === 'assistant') {
        const opening = words(message.content).slice(0, 6).join(' ');
        documents.push({
          entry, field: 'six-word-opening', turnIndex: index, raw: opening, normalized: opening,
          exactHash: sha256(opening), normalizedHash: sha256(opening), tokens: words(opening),
        });
      }
    });
    const skeleton = responseSkeletonId(messages);
    documents.push({
      entry, field: 'response-skeleton', turnIndex: null, raw: skeleton, normalized: skeleton,
      exactHash: sha256(skeleton), normalizedHash: sha256(skeleton), tokens: [skeleton],
    });
  }
  return documents;
}

function duplicateSummary() {
  return {
    exactConversation: 0,
    normalizedConversation: 0,
    exactUserTurn: 0,
    normalizedUserTurn: 0,
    exactAssistantTarget: 0,
    normalizedAssistantTarget: 0,
    opening: 0,
    skeleton: 0,
    ngram: 0,
    lexicalProxy: 0,
    semantic: 0,
    unresolved: 0,
  };
}

function pairCount(size) {
  return size < 2 ? 0 : (size * (size - 1)) / 2;
}

function canonicalEntry(entries) {
  return [...entries].sort((left, right) => left.candidateId.localeCompare(right.candidateId) || left.key.localeCompare(right.key))[0];
}

function duplicateCounterName(field, kind) {
  const prefix = kind === 'exact' ? 'exact' : 'normalized';
  if (field === 'conversation') return `${prefix}Conversation`;
  if (field === 'user-turn') return `${prefix}UserTurn`;
  if (field === 'assistant-target') return `${prefix}AssistantTarget`;
  if (field === 'six-word-opening') return 'opening';
  return 'skeleton';
}

function screenExactDuplicates(entries, summary) {
  const documents = screeningDocuments(entries);
  for (const field of ['conversation', 'user-turn', 'assistant-target', 'six-word-opening', 'response-skeleton']) {
    const fieldDocuments = documents.filter(document => document.field === field);
    const kinds = ['exact', 'normalized'];
    for (const kind of kinds) {
      if (['six-word-opening', 'response-skeleton'].includes(field) && kind === 'exact') continue;
      const hashField = kind === 'exact' ? 'exactHash' : 'normalizedHash';
      const groups = new Map();
      for (const document of fieldDocuments) {
        const group = groups.get(document[hashField]) ?? [];
        group.push(document);
        groups.set(document[hashField], group);
      }
      for (const [hash, group] of groups) {
        const byCandidate = new Map();
        for (const document of group) if (!byCandidate.has(document.entry.key)) byCandidate.set(document.entry.key, document.entry);
        const candidates = [...byCandidate.values()];
        if (candidates.length < 2) continue;
        summary[duplicateCounterName(field, kind)] += pairCount(candidates.length);
        if (['six-word-opening', 'response-skeleton'].includes(field)) continue;
        const winner = canonicalEntry(candidates);
        for (const loser of candidates.filter(entry => entry.key !== winner.key)) {
          addFinding(loser, {
            ruleId: `${kind.toUpperCase()}_${field.replaceAll('-', '_').toUpperCase()}_DUPLICATE`,
            stage: 'exact-duplicate', fieldPath: 'messages', matchClass: `${kind}-${field}`,
            severity: 'hard', outcome: 'rejected', match: hash,
            otherCandidateId: winner.candidateId, otherSplit: SPLITS.includes(winner.candidate.split) ? winner.candidate.split : 'unknown',
            comparedField: field, similarity: 1,
          });
          addFinding(winner, {
            ruleId: `${kind.toUpperCase()}_${field.replaceAll('-', '_').toUpperCase()}_DUPLICATE`,
            stage: 'exact-duplicate', fieldPath: 'messages', matchClass: `${kind}-${field}`,
            severity: 'information', outcome: 'other-candidate-rejected', match: hash,
            otherCandidateId: loser.candidateId, otherSplit: SPLITS.includes(loser.candidate.split) ? loser.candidate.split : 'unknown',
            comparedField: field, similarity: 1,
          });
        }
      }
    }
  }
  return documents;
}

function pairKey(left, right, field, rule) {
  const keys = [left.entry.key, right.entry.key].sort();
  return `${keys[0]}\u0000${keys[1]}\u0000${field}\u0000${rule}`;
}

function screenLexicalNearDuplicates(documents, plan, summary) {
  const survivors = documents.filter(document => (
    ['conversation', 'user-turn', 'assistant-target'].includes(document.field)
      && !['rejected', 'quarantined'].includes(entryState(document.entry))
  ));
  for (const document of survivors) {
    document.trigrams = ngrams(document.tokens, plan.auditPolicy.ngramSize);
    document.termFrequency = termFrequency(document.tokens);
  }
  const best = new Map();
  for (let leftIndex = 0; leftIndex < survivors.length; leftIndex += 1) {
    const left = survivors[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < survivors.length; rightIndex += 1) {
      const right = survivors[rightIndex];
      if (left.entry.key === right.entry.key || left.field !== right.field || left.normalizedHash === right.normalizedHash) continue;
      const ngramSimilarity = jaccard(left.trigrams, right.trigrams);
      const lexicalSimilarity = cosine(left.termFrequency, right.termFrequency);
      for (const [rule, similarity, threshold, counter] of [
        ['NGRAM_NEAR_DUPLICATE', ngramSimilarity, plan.auditPolicy.ngramJaccardThreshold, 'ngram'],
        ['LEXICAL_PROXY_NEAR_DUPLICATE', lexicalSimilarity, plan.auditPolicy.lexicalSemanticProxyThreshold, 'lexicalProxy'],
      ]) {
        if (similarity < threshold) continue;
        const key = pairKey(left, right, left.field, rule);
        const existing = best.get(key);
        if (!existing || similarity > existing.similarity) best.set(key, { left, right, rule, similarity, counter });
      }
    }
  }
  for (const pair of [...best.values()].sort((left, right) => pairKey(left.left, left.right, left.left.field, left.rule)
    .localeCompare(pairKey(right.left, right.right, right.left.field, right.rule)))) {
    summary[pair.counter] += 1;
    const winner = canonicalEntry([pair.left.entry, pair.right.entry]);
    const loser = winner.key === pair.left.entry.key ? pair.right.entry : pair.left.entry;
    addFinding(loser, {
      ruleId: pair.rule, stage: 'lexical-near-duplicate', fieldPath: 'messages',
      matchClass: pair.rule === 'NGRAM_NEAR_DUPLICATE' ? 'three-gram-jaccard' : 'term-frequency-cosine',
      severity: 'hard', outcome: 'rejected', match: `${pair.left.normalizedHash}:${pair.right.normalizedHash}`,
      otherCandidateId: winner.candidateId, otherSplit: SPLITS.includes(winner.candidate.split) ? winner.candidate.split : 'unknown',
      comparedField: pair.left.field, similarity: pair.similarity,
    });
    addFinding(winner, {
      ruleId: pair.rule, stage: 'lexical-near-duplicate', fieldPath: 'messages',
      matchClass: pair.rule === 'NGRAM_NEAR_DUPLICATE' ? 'three-gram-jaccard' : 'term-frequency-cosine',
      severity: 'information', outcome: 'other-candidate-rejected', match: `${pair.left.normalizedHash}:${pair.right.normalizedHash}`,
      otherCandidateId: loser.candidateId, otherSplit: SPLITS.includes(loser.candidate.split) ? loser.candidate.split : 'unknown',
      comparedField: pair.left.field, similarity: pair.similarity,
    });
  }
}

function withinSplitPairCount(candidates) {
  const counts = new Map();
  for (const candidate of candidates) counts.set(candidate.split, (counts.get(candidate.split) ?? 0) + 1);
  return [...counts.values()].reduce((total, count) => total + pairCount(count), 0);
}

function validateAndApplySemanticReport({ semanticReport, semanticRequest, semanticRequestSha256, entries, plan, hashes, schemas, allowTestFixtures, summary }) {
  const scopeById = new Map(entries.map(entry => [entry.candidateId, entry]));
  const errors = [];
  if (!semanticReport) {
    errors.push('missing');
    addGlobalFinding(entries, 'SEMANTIC_REPORT_MISSING', 'semantic-similarity', 'external-embedding-evidence');
    return { trusted: false, errors, clusters: new Map() };
  }
  if (schemaErrors('candidateSemanticReport', schemas.candidateSemanticReport, semanticReport).length) errors.push('schema');
  if (semanticReport.status !== 'approved-controlled' && !allowTestFixtures) errors.push('unapproved');
  if (semanticReport.status === 'approved-controlled') {
    if (semanticReport.approval?.status !== 'approved'
      || semanticReport.approval?.reviewerRole !== 'independent-ml-data'
      || !semanticReport.approval?.thresholdEvidenceRef
      || !semanticReport.approval?.reportEvidenceRef) errors.push('approval');
  }
  if (semanticReport.method?.remote !== false) errors.push('remote-embedding-boundary');
  if (semanticReport.threshold !== plan.auditPolicy.externalEmbeddingThreshold) errors.push('threshold');
  if (semanticReport.bindings?.semanticRequestSha256 !== semanticRequestSha256
    || semanticReport.bindings?.candidateInventorySha256 !== semanticRequest.candidateInventorySha256
    || semanticReport.bindings?.planSha256 !== hashes.planSha256) errors.push('bindings');
  if (semanticReport.comparisonScope?.candidateCount !== semanticRequest.candidateCount
    || semanticReport.comparisonScope?.crossSplitPairCount !== semanticRequest.crossSplitPairCount
    || semanticReport.comparisonScope?.withinSplitPairCount !== withinSplitPairCount(semanticRequest.candidates)
    || semanticReport.comparisonScope?.allCrossSplitPairsCompared !== true) errors.push('comparison-scope');

  const assignments = semanticReport.clusterAssignments ?? [];
  const assignedIds = assignments.map(assignment => assignment.candidateId);
  if (new Set(assignedIds).size !== assignedIds.length
    || assignedIds.length !== semanticRequest.candidateCount
    || assignedIds.some(candidateId => !scopeById.has(candidateId))) errors.push('cluster-inventory');
  const clusterCounts = new Map();
  for (const assignment of assignments) clusterCounts.set(assignment.clusterIdHash, (clusterCounts.get(assignment.clusterIdHash) ?? 0) + 1);
  const distribution = [...clusterCounts.entries()].map(([clusterIdHash, count]) => ({ clusterIdHash, count }))
    .sort((left, right) => left.clusterIdHash.localeCompare(right.clusterIdHash));
  const largestClusterCandidates = Math.max(0, ...distribution.map(item => item.count));
  const expectedDistribution = {
    clusterCount: distribution.length,
    largestClusterCandidates,
    largestClusterShare: round(largestClusterCandidates / Math.max(1, assignments.length)),
    distributionSha256: canonicalSha256(distribution),
  };
  if (stableJson(semanticReport.clusterDistribution) !== stableJson(expectedDistribution)) errors.push('cluster-distribution');

  const seenPairs = new Set();
  let maximumFinding = -1;
  for (const finding of semanticReport.findings ?? []) {
    const left = scopeById.get(finding.leftCandidateId);
    const right = scopeById.get(finding.rightCandidateId);
    const pair = [finding.leftCandidateId, finding.rightCandidateId].sort().join('\u0000');
    if (!left || !right || left === right || seenPairs.has(pair)) errors.push('finding-pair');
    seenPairs.add(pair);
    if (left && right) {
      const expectedScope = left.candidate.split === right.candidate.split ? 'within-split' : 'cross-split';
      if (finding.leftSplit !== left.candidate.split || finding.rightSplit !== right.candidate.split || finding.scope !== expectedScope) errors.push('finding-split');
    }
    if (finding.similarity < plan.auditPolicy.externalEmbeddingThreshold) errors.push('below-threshold-finding');
    if (finding.disposition === 'adjudicated-not-duplicate' && !finding.adjudicationEvidenceRef) errors.push('adjudication-evidence');
    if (finding.disposition !== 'adjudicated-not-duplicate' && finding.adjudicationEvidenceRef !== null) errors.push('unexpected-adjudication-evidence');
    maximumFinding = Math.max(maximumFinding, finding.similarity);
  }
  if (maximumFinding >= 0 && semanticReport.maximumSimilarity < maximumFinding) errors.push('maximum-similarity');
  if (errors.length) {
    addGlobalFinding(entries, 'SEMANTIC_REPORT_INVALID', 'semantic-similarity', 'semantic-report-binding-or-approval');
    return { trusted: false, errors: [...new Set(errors)], clusters: new Map() };
  }

  const clusters = new Map(assignments.map(assignment => [assignment.candidateId, assignment.clusterIdHash]));
  for (const finding of [...semanticReport.findings].sort((left, right) => (
    left.leftCandidateId.localeCompare(right.leftCandidateId) || left.rightCandidateId.localeCompare(right.rightCandidateId)
  ))) {
    summary.semantic += 1;
    const left = scopeById.get(finding.leftCandidateId);
    const right = scopeById.get(finding.rightCandidateId);
    const common = {
      ruleId: 'SEMANTIC_NEAR_DUPLICATE', stage: 'semantic-similarity', fieldPath: 'messages',
      matchClass: 'pinned-embedding-cosine', comparedField: 'conversation', similarity: finding.similarity,
      match: `${finding.leftCandidateId}:${finding.rightCandidateId}:${finding.similarity}`,
    };
    if (finding.disposition === 'needs-adjudication') {
      summary.unresolved += 1;
      addFinding(left, { ...common, severity: 'adjudication', outcome: 'needs-adjudication', otherCandidateId: right.candidateId, otherSplit: right.candidate.split });
      addFinding(right, { ...common, severity: 'adjudication', outcome: 'needs-adjudication', otherCandidateId: left.candidateId, otherSplit: left.candidate.split });
    } else if (finding.disposition === 'adjudicated-not-duplicate') {
      addFinding(left, { ...common, severity: 'information', outcome: 'reported', otherCandidateId: right.candidateId, otherSplit: right.candidate.split });
      addFinding(right, { ...common, severity: 'information', outcome: 'reported', otherCandidateId: left.candidateId, otherSplit: left.candidate.split });
    } else {
      const rejected = finding.disposition === 'reject-left' ? left : right;
      const kept = rejected === left ? right : left;
      addFinding(rejected, { ...common, severity: 'hard', outcome: 'rejected', otherCandidateId: kept.candidateId, otherSplit: kept.candidate.split });
      addFinding(kept, { ...common, severity: 'information', outcome: 'other-candidate-rejected', otherCandidateId: rejected.candidateId, otherSplit: rejected.candidate.split });
    }
  }
  return { trusted: true, errors: [], clusters };
}

function numericDistribution(values) {
  if (!values.length) return { min: 0, p50: 0, p95: 0, max: 0 };
  return {
    min: Math.min(...values),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
  };
}

function largestShare(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return { count: counts.size, share: round(Math.max(0, ...counts.values()) / Math.max(1, values.length)) };
}

function metricSlice(entries, tokenRecords, semanticClusters, plan) {
  const userDocuments = [];
  const assistantDocuments = [];
  for (const entry of entries) {
    for (const message of allMessageStrings(entry.candidate)) {
      const document = { tokens: words(message.content), normalizedHash: sha256(normalizeText(message.content)) };
      if (message.role === 'user') userDocuments.push(document);
      else if (message.role === 'assistant') assistantDocuments.push(document);
    }
  }
  const tokenRows = entries.map(entry => tokenRecords.get(entry.candidateId)).filter(Boolean);
  const openings = entries.flatMap(entry => assistantStrings(entry.candidate).map(message => words(message.content).slice(0, 6).join(' ')));
  const skeletons = entries.map(entry => responseSkeletonId(entry.candidate.messages ?? []));
  const strategies = entries.map(entry => entry.candidate.metadata?.responseStrategy ?? 'missing');
  const clusters = entries.map(entry => semanticClusters.get(entry.candidateId)).filter(Boolean);
  const openingDistribution = largestShare(openings);
  const skeletonDistribution = largestShare(skeletons);
  const strategyDistribution = largestShare(strategies);
  const clusterDistribution = largestShare(clusters);
  const normalizedUsers = userDocuments.map(document => document.normalizedHash);
  const normalizedAssistants = assistantDocuments.map(document => document.normalizedHash);
  const responseWordCounts = assistantDocuments.map(document => document.tokens.length);
  return {
    candidateCount: entries.length,
    coveredSlotCount: new Set(entries.map(entry => entry.rowId)).size,
    userTurnCount: userDocuments.length,
    assistantTargetCount: assistantDocuments.length,
    userWords: numericDistribution(userDocuments.map(document => document.tokens.length)),
    assistantWords: numericDistribution(responseWordCounts),
    renderedTokens: numericDistribution(tokenRows.map(record => record.totalTokens)),
    assistantTokens: numericDistribution(tokenRows.map(record => record.assistantTokens)),
    wouldExceed1024: tokenRows.filter(record => record.totalTokens > plan.training.maxSequenceLength).length,
    wouldTruncate: tokenRows.filter(record => record.truncated !== false).length,
    responseLengthExceptions: responseWordCounts.filter(count => (
      count < plan.auditPolicy.normalResponseWordMinimum || count > plan.auditPolicy.normalResponseWordMaximum
    )).length,
    distinct1: round(distinctMetric(assistantDocuments, 1)),
    distinct2: round(distinctMetric(assistantDocuments, 2)),
    distinct3: round(distinctMetric(assistantDocuments, 3)),
    uniqueNormalizedUserTurnRatio: round(new Set(normalizedUsers).size / Math.max(1, normalizedUsers.length)),
    uniqueNormalizedAssistantTargetRatio: round(new Set(normalizedAssistants).size / Math.max(1, normalizedAssistants.length)),
    sixWordOpeningCount: openingDistribution.count,
    largestSixWordOpeningShare: openingDistribution.share,
    responseSkeletonCount: skeletonDistribution.count,
    largestResponseSkeletonShare: skeletonDistribution.share,
    responseStrategyCount: strategyDistribution.count,
    largestResponseStrategyShare: strategyDistribution.share,
    embeddingClusterCount: clusterDistribution.count,
    largestEmbeddingClusterShare: clusterDistribution.share,
  };
}

function metricsBy(entries, values, selector, tokenRecords, semanticClusters, plan) {
  return Object.fromEntries(values.map(value => [value, metricSlice(entries.filter(entry => selector(entry) === value), tokenRecords, semanticClusters, plan)]));
}

function expectedSlots(manifest) {
  return (manifest.assignments ?? []).flatMap(assignment => Object.entries(assignment.rowIds ?? {}).map(([language, rowId]) => ({
    rowId,
    language,
    split: assignment.split,
    scenarioFamilyId: assignment.scenarioFamilyId,
  }))).sort((left, right) => left.rowId.localeCompare(right.rowId));
}

function sortedFindings(findings) {
  const stageOrder = new Map(STAGES.map((stage, index) => [stage, index]));
  return [...findings].sort((left, right) => (
    (stageOrder.get(left.stage) - stageOrder.get(right.stage))
      || left.ruleId.localeCompare(right.ruleId)
      || (left.otherCandidateId ?? '').localeCompare(right.otherCandidateId ?? '')
      || (left.comparedField ?? '').localeCompare(right.comparedField ?? '')
      || (left.similarity ?? 0) - (right.similarity ?? 0)
  ));
}

function candidateDetails(entries) {
  return entries.map(entry => {
    const findings = sortedFindings(entry.findings);
    return {
      schema: 'com.saferide.ai.v05-candidate-screen-detail',
      schemaVersion: 1,
      recordId: `screen-detail-${canonicalSha256({ key: entry.key, contentSha256: entry.contentSha256 }).slice(0, 24)}`,
      recordType: 'candidate',
      datasetId: DATASET_ID,
      rowId: entry.rowId,
      split: SPLITS.includes(entry.candidate.split) ? entry.candidate.split : 'unknown',
      candidateId: entry.candidateId,
      sourceOrdinal: entry.index,
      candidateContentSha256: entry.contentSha256,
      state: entryState(entry),
      findingCount: findings.length,
      findings,
      privacy: { ...DETAIL_PRIVACY },
    };
  });
}

function generationFailedDetails(slots, representedRows) {
  return slots.filter(slot => !representedRows.has(slot.rowId)).map(slot => {
    const finding = {
      ruleId: 'NO_CANDIDATE_ADMITTED',
      stage: 'coverage',
      fieldPath: 'candidate',
      matchClass: 'generation-or-import-gap',
      severity: 'information',
      outcome: 'reported',
      fingerprint: findingFingerprint('NO_CANDIDATE_ADMITTED', slot.rowId),
      otherCandidateId: null,
      otherSplit: null,
      comparedField: null,
      similarity: null,
    };
    return {
      schema: 'com.saferide.ai.v05-candidate-screen-detail',
      schemaVersion: 1,
      recordId: `screen-detail-${canonicalSha256({ rowId: slot.rowId, state: 'generation-failed' }).slice(0, 24)}`,
      recordType: 'generation-failed',
      datasetId: DATASET_ID,
      rowId: slot.rowId,
      split: slot.split,
      candidateId: null,
      sourceOrdinal: null,
      candidateContentSha256: null,
      state: 'generation-failed',
      findingCount: 1,
      findings: [finding],
      privacy: { ...DETAIL_PRIVACY },
    };
  });
}

function stageFindingCount(entries, stage) {
  return entries.reduce((total, entry) => total + entry.findings.filter(finding => finding.stage === stage).length, 0);
}

function stageHasOutcome(entries, stage, outcome) {
  return entries.some(entry => entry.findings.some(finding => finding.stage === stage && finding.outcome === outcome));
}

function behaviorCoverage(eligibleEntries, specById) {
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
  const seenRows = new Set();
  for (const entry of eligibleEntries) {
    if (seenRows.has(entry.rowId)) continue;
    seenRows.add(entry.rowId);
    const spec = specById.get(entry.candidate.metadata?.scenarioFamilyId);
    if (!spec) continue;
    for (const flag of Object.keys(spec.behaviorFlags ?? {})) if (spec.behaviorFlags[flag]) counts[flag] += 1;
    if (entry.candidate.split === 'safety-holdout' && ['high', 'critical'].includes(spec.riskLevel)) counts.safetyHighOrCritical += 1;
  }
  return counts;
}

function thresholdBlockers(metrics, plan) {
  const blockers = [];
  if (metrics.uniqueNormalizedAssistantTargetRatio < plan.auditPolicy.minimumUniqueAssistantTargetRatio) blockers.push('ASSISTANT_TARGET_UNIQUENESS_BELOW_THRESHOLD');
  if (metrics.uniqueNormalizedUserTurnRatio < plan.auditPolicy.minimumUniqueUserTurnRatio) blockers.push('USER_TURN_UNIQUENESS_BELOW_THRESHOLD');
  if (metrics.largestSixWordOpeningShare > plan.auditPolicy.maximumSixWordOpeningShare) blockers.push('SIX_WORD_OPENING_SHARE_ABOVE_THRESHOLD');
  if (metrics.largestResponseSkeletonShare > plan.auditPolicy.maximumResponseSkeletonShare) blockers.push('RESPONSE_SKELETON_SHARE_ABOVE_THRESHOLD');
  if (metrics.largestEmbeddingClusterShare > plan.auditPolicy.maximumResponseSkeletonShare) blockers.push('SEMANTIC_CLUSTER_SHARE_ABOVE_THRESHOLD');
  if (metrics.wouldExceed1024 || metrics.wouldTruncate) blockers.push('TOKEN_OR_TRUNCATION_THRESHOLD_FAILED');
  return blockers;
}

function validateScreenArtifacts({ report, details, semanticRequest, schemas }) {
  const errors = [
    ...schemaErrors('candidateScreenReport', schemas.candidateScreenReport, report),
    ...schemaErrors('candidateSemanticRequest', schemas.candidateSemanticRequest, semanticRequest),
  ];
  details.forEach((detail, index) => errors.push(...schemaErrors(`candidateScreenDetail[${index}]`, schemas.candidateScreenDetail, detail)));
  if (errors.length) throw new Error(`Candidate screen output contract failed (${errors.length} findings)`);
}

function createImportedCandidateIndex(entries, hashes, expectedRowIds, maximumCandidates) {
  const candidates = entries.map(entry => ({
    candidateId: entry.candidateId,
    rowId: entry.rowId,
    split: SPLITS.includes(entry.candidate.split) ? entry.candidate.split : 'unknown',
    candidateContentSha256: entry.contentSha256,
    sourceFileOrdinal: entry.sourceFileOrdinal,
    sourceRecordOrdinal: entry.sourceRecordOrdinal,
  })).sort((left, right) => (
    left.candidateId.localeCompare(right.candidateId)
      || left.sourceFileOrdinal - right.sourceFileOrdinal
      || left.sourceRecordOrdinal - right.sourceRecordOrdinal
  ));
  const idCounts = new Map();
  const rowCounts = new Map();
  for (const candidate of candidates) {
    idCounts.set(candidate.candidateId, (idCounts.get(candidate.candidateId) ?? 0) + 1);
    rowCounts.set(candidate.rowId, (rowCounts.get(candidate.rowId) ?? 0) + 1);
  }
  const candidateFilesInventorySha256 = canonicalSha256(hashes.candidateFiles);
  return {
    schema: 'com.saferide.ai.v05-imported-candidate-index',
    schemaVersion: 1,
    datasetId: DATASET_ID,
    classification: 'controlled-content-free-identifiers',
    bindings: {
      scenarioMatrixSha256: hashes.scenarioMatrixSha256,
      splitManifestSha256: hashes.splitManifestSha256,
      candidateFiles: hashes.candidateFiles,
      candidateFilesInventorySha256,
    },
    candidateCount: candidates.length,
    representedSlotCount: new Set(candidates.map(candidate => candidate.rowId).filter(rowId => expectedRowIds.has(rowId))).size,
    duplicateCandidateIdCount: [...idCounts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0),
    slotsOverMaximum: [...rowCounts.values()].filter(count => count > maximumCandidates).length,
    candidateInventorySha256: canonicalSha256(candidates),
    candidates,
    privacy: { containsRawText: false, containsPrompts: false, containsCompletions: false },
  };
}

export function screenCandidateCorpus({
  plan,
  specs,
  manifest,
  candidates,
  policy,
  systemPrompt,
  tokenReport = null,
  semanticReport = null,
  hashes,
  candidateSources = null,
  allowTestFixtures = false,
  schemas = compileV05Schemas(),
}) {
  if (candidateSources && candidateSources.length !== candidates.length) throw new Error('Candidate source inventory length differs from candidate count');
  const entries = makeEntries(candidates, candidateSources);
  const blockers = new Set();
  const baseErrors = validateBaseContracts({ plan, specs, manifest, schemas });
  if (baseErrors.length) {
    blockers.add('BASE_CONTRACT_INVALID');
    addGlobalFinding(entries, 'BASE_CONTRACT_INVALID', 'binding-structure', 'plan-scenario-or-split-contract');
  }
  const { byRowId } = screenStructure(entries, specs, manifest, plan, schemas, allowTestFixtures);
  const tokenResult = validateTokenReport({ tokenReport, entries, plan, systemPrompt, hashes, schemas, allowTestFixtures });
  if (!tokenResult.trusted) blockers.add(tokenResult.errors.includes('missing') ? 'TOKENIZATION_EVIDENCE_MISSING' : 'TOKENIZATION_EVIDENCE_INVALID');
  screenPrivacy(entries);
  const { specById, policyPromptErrors } = screenPolicyAndProduct(entries, specs, policy, systemPrompt, allowTestFixtures);
  if (policyPromptErrors.length) {
    blockers.add('POLICY_OR_SYSTEM_PROMPT_UNAPPROVED');
    addGlobalFinding(entries, 'POLICY_OR_SYSTEM_PROMPT_UNAPPROVED', 'product-policy', 'approval-or-binding');
  }
  screenLanguage(entries);
  enforcePairedBehaviorIntent(entries, specById);
  const duplicates = duplicateSummary();
  const documents = screenExactDuplicates(entries, duplicates);
  screenLexicalNearDuplicates(documents, plan, duplicates);

  const semanticEntries = entries.filter(entry => !['rejected', 'quarantined'].includes(entryState(entry))
    && CANDIDATE_ID_PATTERN.test(entry.candidateId) && SPLITS.includes(entry.candidate.split));
  const candidateFilesInventorySha256 = canonicalSha256(hashes.candidateFiles);
  const semanticRequest = createCandidateSemanticRequest(semanticEntries.map(entry => entry.candidate), {
    planSha256: hashes.planSha256,
    scenarioMatrixSha256: hashes.scenarioMatrixSha256,
    splitManifestSha256: hashes.splitManifestSha256,
    candidateFilesInventorySha256,
  });
  const semanticRequestText = `${JSON.stringify(semanticRequest, null, 2)}\n`;
  const semanticRequestArtifact = fileArtifact(semanticRequestText);
  const semanticResult = validateAndApplySemanticReport({
    semanticReport,
    semanticRequest,
    semanticRequestSha256: semanticRequestArtifact.sha256,
    entries: semanticEntries,
    plan,
    hashes,
    schemas,
    allowTestFixtures,
    summary: duplicates,
  });
  if (!semanticResult.trusted) blockers.add(semanticResult.errors.includes('missing') ? 'SEMANTIC_EVIDENCE_MISSING' : 'SEMANTIC_EVIDENCE_INVALID');
  if (duplicates.unresolved > plan.auditPolicy.maximumUnresolvedNearDuplicatePairs) blockers.add('UNRESOLVED_SEMANTIC_PAIRS');

  const slots = expectedSlots(manifest);
  const expectedRowIds = new Set(slots.map(slot => slot.rowId));
  const importedCandidateIndex = createImportedCandidateIndex(
    entries,
    hashes,
    expectedRowIds,
    plan.candidateAuthoring.maximumCandidatesPerFamilyLanguage,
  );
  const representedRows = new Set(entries.map(entry => entry.rowId).filter(rowId => expectedRowIds.has(rowId)));
  const failedDetails = generationFailedDetails(slots, representedRows);
  const details = [...candidateDetails(entries), ...failedDetails].sort((left, right) => (
    left.rowId.localeCompare(right.rowId)
      || (left.candidateId ?? '').localeCompare(right.candidateId ?? '')
      || (left.sourceOrdinal ?? -1) - (right.sourceOrdinal ?? -1)
  ));
  const eligibleEntries = entries.filter(entry => entryState(entry) === 'eligible');
  const eligibleRows = new Set(eligibleEntries.map(entry => entry.rowId).filter(rowId => expectedRowIds.has(rowId)));
  const countsByRow = new Map(slots.map(slot => [slot.rowId, byRowId.get(slot.rowId)?.length ?? 0]));
  const slotsOverMaximum = [...countsByRow.values()].filter(count => count > plan.candidateAuthoring.maximumCandidatesPerFamilyLanguage).length;
  if (slots.length !== plan.totals.rows || representedRows.size !== plan.totals.rows) blockers.add('INCOMPLETE_SLOT_COVERAGE');
  if (eligibleRows.size !== plan.totals.rows) blockers.add('SLOTS_WITHOUT_ELIGIBLE_CANDIDATE');
  if (slotsOverMaximum) blockers.add('SLOT_CANDIDATE_LIMIT_EXCEEDED');

  const diversity = {
    overall: metricSlice(eligibleEntries, tokenResult.records, semanticResult.clusters, plan),
    byLanguage: metricsBy(eligibleEntries, LANGUAGES, entry => entry.candidate.metadata.language, tokenResult.records, semanticResult.clusters, plan),
    byCategory: metricsBy(eligibleEntries, CATEGORIES, entry => entry.candidate.metadata.primaryCategory, tokenResult.records, semanticResult.clusters, plan),
    bySplit: metricsBy(eligibleEntries, SPLITS, entry => entry.candidate.split, tokenResult.records, semanticResult.clusters, plan),
  };
  const fullEligibleCoverage = eligibleRows.size === plan.totals.rows;
  if (fullEligibleCoverage) for (const blocker of thresholdBlockers(diversity.overall, plan)) blockers.add(blocker);
  const shortlist = blockers.size === 0
    ? [...eligibleEntries].map(entry => entry.candidate).sort(compareCandidates)
    : [];

  const detailsText = jsonlText(details);
  const shortlistText = jsonlText(shortlist);
  const candidateIndexText = `${JSON.stringify(importedCandidateIndex, null, 2)}\n`;
  const candidateIndexArtifact = fileArtifact(candidateIndexText);
  const detailArtifact = fileArtifact(detailsText);
  const shortlistArtifact = fileArtifact(shortlistText);
  const outcomeCounts = {
    eligible: entries.filter(entry => entryState(entry) === 'eligible').length,
    needsAdjudication: entries.filter(entry => entryState(entry) === 'needs-adjudication').length,
    rejected: entries.filter(entry => entryState(entry) === 'rejected').length,
    quarantined: entries.filter(entry => entryState(entry) === 'quarantined').length,
    generationFailed: failedDetails.length,
  };
  const diversityFailures = fullEligibleCoverage ? thresholdBlockers(diversity.overall, plan).length : 0;
  const stages = STAGES.map(stage => {
    let status = 'passed';
    if (stage === 'binding-structure' && (baseErrors.length || !tokenResult.trusted)) status = 'pending';
    else if (stage === 'product-policy' && policyPromptErrors.length) status = 'pending';
    else if (stage === 'semantic-similarity' && (!semanticResult.trusted || duplicates.unresolved)) status = 'pending';
    else if (stage === 'diversity') status = fullEligibleCoverage ? (diversityFailures ? 'failed' : 'passed') : 'insufficient-coverage';
    else if (stageHasOutcome(entries, stage, 'needs-adjudication')) status = 'pending';
    return { stage, status, findingCount: stageFindingCount(entries, stage) };
  });
  const sortedBlockers = [...blockers].sort();
  const bindings = {
    planSha256: hashes.planSha256,
    scenarioMatrixSha256: hashes.scenarioMatrixSha256,
    splitManifestSha256: hashes.splitManifestSha256,
    candidateFiles: hashes.candidateFiles,
    candidateFilesInventorySha256,
    policySha256: hashes.policySha256,
    systemPromptConfigSha256: hashes.systemPromptConfigSha256,
    systemPromptTextSha256: systemPrompt.textSha256,
    tokenizationReportSha256: hashes.tokenizationReportSha256 ?? null,
    semanticReportSha256: hashes.semanticReportSha256 ?? null,
  };
  const report = {
    schema: 'com.saferide.ai.v05-candidate-screen-report',
    schemaVersion: 1,
    reportId: `v05-candidate-screen-${canonicalSha256(bindings).slice(0, 16)}`,
    datasetId: DATASET_ID,
    classification: 'public-safe-aggregate',
    bindings,
    counts: {
      candidateFiles: hashes.candidateFiles.length,
      candidates: entries.length,
      knownSlots: plan.totals.rows,
      representedSlots: representedRows.size,
      shortlistedCandidates: shortlist.length,
      details: details.length,
    },
    outcomes: outcomeCounts,
    coverage: {
      slotsWithZeroCandidates: [...countsByRow.values()].filter(count => count === 0).length,
      slotsWithOneCandidate: [...countsByRow.values()].filter(count => count === 1).length,
      slotsWithTwoCandidates: [...countsByRow.values()].filter(count => count === 2).length,
      slotsWithThreeCandidates: [...countsByRow.values()].filter(count => count === 3).length,
      slotsOverMaximum,
      slotsWithEligibleCandidate: eligibleRows.size,
      slotsWithoutEligibleCandidate: plan.totals.rows - eligibleRows.size,
      behavior: behaviorCoverage(eligibleEntries, specById),
    },
    stages,
    duplicateSummary: duplicates,
    thresholds: {
      maximumSequenceLength: plan.training.maxSequenceLength,
      rejectTruncation: plan.training.rejectTruncation,
      ngramSize: plan.auditPolicy.ngramSize,
      ngramJaccard: plan.auditPolicy.ngramJaccardThreshold,
      lexicalSemanticProxy: plan.auditPolicy.lexicalSemanticProxyThreshold,
      externalEmbedding: plan.auditPolicy.externalEmbeddingThreshold,
      minimumUniqueAssistantTargetRatio: plan.auditPolicy.minimumUniqueAssistantTargetRatio,
      minimumUniqueUserTurnRatio: plan.auditPolicy.minimumUniqueUserTurnRatio,
      maximumSixWordOpeningShare: plan.auditPolicy.maximumSixWordOpeningShare,
      maximumResponseSkeletonShare: plan.auditPolicy.maximumResponseSkeletonShare,
      maximumUnresolvedPairs: plan.auditPolicy.maximumUnresolvedNearDuplicatePairs,
    },
    diversity,
    artifacts: { candidateIndex: candidateIndexArtifact, details: detailArtifact, shortlist: shortlistArtifact, semanticRequest: semanticRequestArtifact },
    blockers: sortedBlockers,
    passed: sortedBlockers.length === 0,
    strictReady: sortedBlockers.length === 0,
    privacy: { ...PUBLIC_PRIVACY },
  };
  const indexErrors = schemaErrors('importedCandidateIndex', schemas.importedCandidateIndex, importedCandidateIndex);
  if (indexErrors.length) throw new Error(`Imported candidate index contract failed (${indexErrors.length} findings)`);
  validateScreenArtifacts({ report, details, semanticRequest, schemas });
  return {
    report,
    details,
    shortlist,
    importedCandidateIndex,
    semanticRequest,
    text: { report: `${JSON.stringify(report, null, 2)}\n`, candidateIndex: candidateIndexText, details: detailsText, shortlist: shortlistText, semanticRequest: semanticRequestText },
  };
}

function resolvePlanPath(value) {
  const resolved = path.isAbsolute(value) ? path.resolve(value) : path.resolve(repoRoot, value);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error('Plan file is unavailable');
  return resolved;
}

function privateInput(root, value, requiredPrefix = null) {
  return assertPrivateFile(artifactPath(root, value, { requiredPrefix }), root);
}

function outputPath(root, value, requiredPrefix, classification) {
  return artifactPath(root, value, { requiredPrefix, classification });
}

function main() {
  enforcePrivateUmask();
  const args = parseArgs(process.argv.slice(2));
  if (args.contractCheck) {
    compileV05Schemas();
    console.log('SafeRide v0.5 candidate-screen contracts PASS.');
    return 0;
  }
  const root = secureArtifactRoot(args.artifactRoot, { create: false });
  const planPath = resolvePlanPath(args.plan);
  const scenariosPath = privateInput(root, args.scenarios, 'matrix');
  const splitManifestPath = privateInput(root, args.splitManifest, 'splits');
  const policyPath = privateInput(root, args.policy);
  const systemPromptPath = privateInput(root, args.systemPrompt);
  const tokenReportPath = args.tokenReport ? privateInput(root, args.tokenReport, 'screening') : null;
  const semanticReportPath = args.semanticReport ? privateInput(root, args.semanticReport, 'screening') : null;
  const candidateInputs = args.candidates.map(value => privateInput(root, value, 'candidates/imported'))
    .map(filePath => ({ filePath, sha256: fileSha256(filePath), sizeBytes: fs.statSync(filePath).size }))
    .sort((left, right) => left.sha256.localeCompare(right.sha256) || left.sizeBytes - right.sizeBytes || left.filePath.localeCompare(right.filePath));
  const candidateIndexPath = outputPath(root, args.candidateIndex, 'candidates/imported', 'controlled');
  const semanticRequestPath = outputPath(root, args.semanticRequest, 'screening', 'controlled');
  const detailsPath = outputPath(root, args.details, 'screening', 'restricted');
  const shortlistPath = outputPath(root, args.shortlist, 'screening', 'restricted');
  const reportPath = outputPath(root, args.report, 'public-safe', null);
  const outputPaths = [candidateIndexPath, semanticRequestPath, detailsPath, shortlistPath, reportPath];
  if (new Set(outputPaths).size !== outputPaths.length) throw new Error('Candidate-screen output paths must be distinct');
  if (outputPaths.some(candidate => [planPath, scenariosPath, splitManifestPath, policyPath, systemPromptPath, tokenReportPath, semanticReportPath, ...candidateInputs.map(input => input.filePath)].filter(Boolean).includes(candidate))) {
    throw new Error('Candidate-screen output may not overwrite an input artifact');
  }

  const hashes = {
    planSha256: fileSha256(planPath),
    scenarioMatrixSha256: fileSha256(scenariosPath),
    splitManifestSha256: fileSha256(splitManifestPath),
    candidateFiles: candidateInputs.map(input => ({ sha256: input.sha256, sizeBytes: input.sizeBytes })),
    policySha256: fileSha256(policyPath),
    systemPromptConfigSha256: fileSha256(systemPromptPath),
    tokenizationReportSha256: tokenReportPath ? fileSha256(tokenReportPath) : null,
    semanticReportSha256: semanticReportPath ? fileSha256(semanticReportPath) : null,
  };
  const loadedCandidates = candidateInputs.flatMap((input, sourceFileOrdinal) => readJsonl(input.filePath).map((candidate, sourceRecordOrdinal) => ({ candidate, sourceFileOrdinal, sourceRecordOrdinal })));
  const result = screenCandidateCorpus({
    plan: readJson(planPath),
    specs: readJsonl(scenariosPath),
    manifest: readJson(splitManifestPath),
    candidates: loadedCandidates.map(entry => entry.candidate),
    candidateSources: loadedCandidates.map(({ sourceFileOrdinal, sourceRecordOrdinal }) => ({ sourceFileOrdinal, sourceRecordOrdinal })),
    policy: readJson(policyPath),
    systemPrompt: readJson(systemPromptPath),
    tokenReport: tokenReportPath ? readJson(tokenReportPath) : null,
    semanticReport: semanticReportPath ? readJson(semanticReportPath) : null,
    hashes,
  });
  atomicWritePrivate(candidateIndexPath, result.text.candidateIndex, { rootPath: root, verifyIdentical: true });
  atomicWritePrivate(semanticRequestPath, result.text.semanticRequest, { rootPath: root, verifyIdentical: true });
  atomicWritePrivate(detailsPath, result.text.details, { rootPath: root, verifyIdentical: true });
  atomicWritePrivate(shortlistPath, result.text.shortlist, { rootPath: root, verifyIdentical: true });
  atomicWritePrivate(reportPath, result.text.report, { rootPath: root, verifyIdentical: true });
  console.log(`Candidate screen ${result.report.strictReady ? 'PASS' : 'BLOCKED'} (${result.report.counts.candidates} candidates; ${result.report.counts.representedSlots}/${result.report.counts.knownSlots} represented slots; ${result.report.counts.shortlistedCandidates} technically eligible).`);
  console.log(`Aggregate report SHA-256: ${sha256(result.text.report)}`);
  if (args.strict && !result.report.strictReady) return 1;
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
