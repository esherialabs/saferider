#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_REGISTER_PATH = 'docs/security/saferide-gemma4-finetune-data-register.example.json';
const REGISTER_SCHEMA = 'com.saferide.gemma4-finetune-data-register';
const REGISTER_VERSION = 1;
const MODEL_ID = 'litert-community/gemma-4-E2B-it-litert-lm';

const registerStatuses = new Set(['draft', 'approved-prototype', 'approved-production', 'blocked']);
const sourceStatuses = new Set(['draft', 'approved-prototype', 'approved-production', 'blocked']);
const approvalStatuses = new Set(['pending', 'approved', 'blocked', 'scoped-out']);
const runtimeGateStatuses = new Set(['pending', 'passed', 'accepted-risk', 'blocked']);
const sourceTypes = new Set(['synthetic', 'public', 'licensed', 'partner-provided', 'de-identified-aggregate']);
const privacyClasses = new Set(['synthetic', 'public', 'de-identified', 'sensitive-internal', 'prohibited']);
const splits = new Set(['train', 'dev', 'quality-holdout', 'safety-holdout', 'never-train']);
const messageRoles = new Set(['system', 'user', 'assistant']);
const trainingReadinessStatuses = new Set(['pipeline-only', 'training-ready', 'blocked']);

const prohibitedFields = new Set([
  'audio',
  'audioTranscript',
  'caseNumber',
  'credential',
  'credentials',
  'evidence',
  'evidenceContent',
  'evidenceFile',
  'gps',
  'latitude',
  'location',
  'longitude',
  'privateLocation',
  'prompt',
  'rawCompletion',
  'rawPrompt',
  'request',
  'response',
  'routeTrace',
  'signedUrl',
  'transcript',
]);

const contentDetectors = [
  {
    label: 'OpenAI-style API key',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  },
  {
    label: 'JWT-looking token',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    label: 'AWS access key',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    label: 'private key block',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)?PRIVATE KEY-----/,
  },
  {
    label: 'signed URL marker',
    pattern: /\b(?:X-Amz-Signature|X-Goog-Signature|signature=|sig=|token=|access_token=)\b/i,
  },
  {
    label: 'Supabase signed object URL',
    pattern: /\/storage\/v1\/object\/sign\//i,
  },
  {
    label: 'Kenya-style phone number',
    pattern: /(?:\+254|0)7\d{8}\b/,
  },
  {
    label: 'email address',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  },
  {
    label: 'GPS coordinate pair',
    pattern: /[-+]?(?:[1-8]?\d(?:\.\d+)?|90(?:\.0+)?)\s*,\s*[-+]?(?:1[0-7]\d|\d?\d)(?:\.\d+)?/,
  },
  {
    label: 'Kenya national ID style label',
    pattern: /\b(?:national\s+id|id\s+number|passport\s+number|case\s+number)\b/i,
  },
];

function usage() {
  return `
Usage:
  node scripts/saferide-gemma4-finetune-data-check.mjs [--register <path>] [--data <jsonl>] [--audit <json>] [--for-finetuning]

Options:
  --register <path>   Data register JSON. Defaults to ${DEFAULT_REGISTER_PATH}.
  --data <jsonl>      Candidate fine-tuning JSONL to validate against the register.
  --audit <json>      Content-free dataset audit tied to exact register/data hashes.
  --for-finetuning    Enforce strict gates required before a real fine-tuning run.
  --help              Show this help.

JSONL row shape:
  {"id":"row-001","datasetId":"...","split":"train","messages":[{"role":"user","content":"..."},{"role":"assistant","content":"..."}]}
`.trim();
}

function parseArgs(argv) {
  const args = {
    registerPath: DEFAULT_REGISTER_PATH,
    dataPath: undefined,
    auditPath: undefined,
    forFinetuning: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (arg === '--register') {
      args.registerPath = argv[++index];
    } else if (arg === '--data') {
      args.dataPath = argv[++index];
    } else if (arg === '--audit') {
      args.auditPath = argv[++index];
    } else if (arg === '--for-finetuning') {
      args.forFinetuning = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.registerPath) throw new Error('--register requires a path');
  if (argv.includes('--data') && !args.dataPath) throw new Error('--data requires a path');
  if (argv.includes('--audit') && !args.auditPath) throw new Error('--audit requires a path');

  return args;
}

function resolveRepoPath(inputPath) {
  return path.isAbsolute(inputPath) ? inputPath : path.join(repoRoot, inputPath);
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function addIf(condition, list, message) {
  if (condition) list.push(message);
}

function formatPath(location) {
  return location.filter(part => part !== '').join('.');
}

function scanValueForProhibitedContent(value, location, errors) {
  if (typeof value === 'string') {
    for (const detector of contentDetectors) {
      if (detector.pattern.test(value)) {
        errors.push(`${formatPath(location)} contains ${detector.label}`);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanValueForProhibitedContent(entry, [...location, String(index)], errors));
    return;
  }
  if (!isObject(value)) return;

  for (const [key, entry] of Object.entries(value)) {
    if (prohibitedFields.has(key)) {
      errors.push(`${formatPath([...location, key])} uses prohibited field '${key}'`);
    }
    scanValueForProhibitedContent(entry, [...location, key], errors);
  }
}

function validateProhibitedScreen(source, sourceLabel, errors) {
  const screen = source.prohibitedDataScreen;
  if (!isObject(screen)) {
    errors.push(`${sourceLabel}.prohibitedDataScreen is required`);
    return;
  }

  for (const [key, value] of Object.entries(screen)) {
    if (value !== false) {
      errors.push(`${sourceLabel}.prohibitedDataScreen.${key} must be false`);
    }
  }
}

function validateRegister(register, options) {
  const errors = [];
  const warnings = [];
  const sourcesById = new Map();

  addIf(register.schema !== REGISTER_SCHEMA, errors, `schema must be ${REGISTER_SCHEMA}`);
  addIf(register.version !== REGISTER_VERSION, errors, `version must be ${REGISTER_VERSION}`);
  addIf(!hasText(register.registerId), errors, 'registerId is required');
  addIf(!registerStatuses.has(register.status), errors, 'status must be draft, approved-prototype, approved-production, or blocked');
  addIf(register.modelId !== MODEL_ID, errors, `modelId must be ${MODEL_ID}`);

  if (register.status === 'blocked') {
    warnings.push('register status is blocked');
  }

  const legalApproval = isObject(register.legalApproval) ? register.legalApproval : {};
  for (const field of ['derivativeUse', 'loraAdapterStorage', 'mobileExport', 'internalHosting', 'advisorDemo']) {
    const value = legalApproval[field];
    if (!approvalStatuses.has(value)) {
      errors.push(`legalApproval.${field} must be pending, approved, blocked, or scoped-out`);
    } else if (value !== 'approved') {
      warnings.push(`legalApproval.${field} is ${value}`);
    }
  }
  if (!hasText(legalApproval.reference)) {
    warnings.push('legalApproval.reference is not set');
  }

  const runtimeGate = isObject(register.runtimeGate) ? register.runtimeGate : {};
  if (!runtimeGateStatuses.has(runtimeGate.baseRuntimeProof)) {
    errors.push('runtimeGate.baseRuntimeProof must be pending, passed, accepted-risk, or blocked');
  } else if (!['passed', 'accepted-risk'].includes(runtimeGate.baseRuntimeProof)) {
    warnings.push(`runtimeGate.baseRuntimeProof is ${runtimeGate.baseRuntimeProof}`);
  }

  const trainingReadiness = isObject(register.trainingReadiness) ? register.trainingReadiness : null;
  if (!trainingReadiness) {
    if (/v0\.4/i.test(register.registerId ?? '') || options.forFinetuning) {
      errors.push('trainingReadiness is required for v0.4 and every strict fine-tuning run');
    }
  } else {
    if (!trainingReadinessStatuses.has(trainingReadiness.status)) {
      errors.push('trainingReadiness.status must be pipeline-only, training-ready, or blocked');
    } else if (trainingReadiness.status !== 'training-ready') {
      warnings.push(`trainingReadiness.status is ${trainingReadiness.status}`);
    }
    if (!Number.isInteger(trainingReadiness.declaredTrainRows) || trainingReadiness.declaredTrainRows < 0) {
      errors.push('trainingReadiness.declaredTrainRows must be a non-negative integer');
    }
    const qualityReview = isObject(trainingReadiness.independentQualityReview)
      ? trainingReadiness.independentQualityReview
      : {};
    if (!['pending', 'approved', 'blocked'].includes(qualityReview.status)) {
      errors.push('trainingReadiness.independentQualityReview.status must be pending, approved, or blocked');
    }
    if (!hasText(qualityReview.reviewerRole) || !/independent/i.test(qualityReview.reviewerRole)) {
      errors.push('trainingReadiness.independentQualityReview.reviewerRole must name an independent reviewer');
    }
    if (qualityReview.status !== 'approved') {
      warnings.push(`trainingReadiness.independentQualityReview.status is ${qualityReview.status ?? 'missing'}`);
    }
    if (qualityReview.status === 'approved' && (
      !hasText(qualityReview.reviewerIdentity)
      || !hasText(qualityReview.reviewedAt)
      || !hasText(qualityReview.artifactRef)
      || qualityReview.templateDiversityAccepted !== true
    )) {
      errors.push('approved independent quality review requires identity, date, artifact, and accepted template diversity');
    }
    if (trainingReadiness.approvedMinimumTrainRows !== null && (
      !Number.isInteger(trainingReadiness.approvedMinimumTrainRows)
      || trainingReadiness.approvedMinimumTrainRows < 1
    )) {
      errors.push('trainingReadiness.approvedMinimumTrainRows must be null or a positive integer');
    }
    if (options.forFinetuning) {
      if (trainingReadiness.status !== 'training-ready') {
        errors.push('strict fine-tuning gate requires trainingReadiness.status=training-ready; pipeline-only data cannot train');
      }
      if (!Number.isInteger(trainingReadiness.approvedMinimumTrainRows) || trainingReadiness.approvedMinimumTrainRows < 1) {
        errors.push('strict fine-tuning gate requires an independently approved minimum training-row count');
      }
      if (
        qualityReview.status !== 'approved'
        || !hasText(qualityReview.reviewerIdentity)
        || !hasText(qualityReview.reviewedAt)
        || !hasText(qualityReview.artifactRef)
        || qualityReview.templateDiversityAccepted !== true
      ) {
        errors.push('strict fine-tuning gate requires attributable independent scale and template-diversity review');
      }
    }
  }

  const policyBinding = isObject(register.policyBinding) ? register.policyBinding : {};
  if (!hasText(policyBinding.policyId) || !hasText(policyBinding.version) || !hasText(policyBinding.path) || !hasText(policyBinding.sha256)) {
    errors.push('policyBinding requires policyId, version, path, and sha256');
  } else {
    const policyPath = resolveRepoPath(policyBinding.path);
    if (!fs.existsSync(policyPath)) {
      errors.push('policyBinding.path does not exist');
    } else {
      const policyText = fs.readFileSync(policyPath, 'utf8').replace(/\r\n/g, '\n');
      const policy = JSON.parse(policyText);
      if (sha256(policyText) !== policyBinding.sha256) errors.push('policyBinding.sha256 does not match policy bytes');
      if (policy.policyId !== policyBinding.policyId || policy.version !== policyBinding.version || policy.status !== policyBinding.status) {
        errors.push('policyBinding identity or status does not match policy');
      }
      for (const trigger of ['hidden-prompt-disclosure', 'successful-policy-extraction', 'jailbreak-success']) {
        if (!asArray(policy.criticalTriggers).includes(trigger)) errors.push(`safe-assistant policy requires critical trigger ${trigger}`);
      }
      if (policy.privacy?.rawPromptLoggingAllowed !== false || policy.privacy?.rawCompletionLoggingAllowed !== false) {
        errors.push('safe-assistant policy must forbid raw prompt and completion logging');
      }
      if (options.forFinetuning) {
        if (policy.status !== 'approved' || !hasText(policy.effectiveDate)) errors.push('strict fine-tuning gate requires an approved effective safe-assistant policy');
        const approvals = new Map(asArray(policy.approvals).map(approval => [approval?.role, approval]));
        for (const role of ['product-safeguarding', 'technical-ml', 'privacy', 'legal', 'kiswahili']) {
          const approval = approvals.get(role);
          if (approval?.status !== 'approved' || !hasText(approval.reviewerIdentity) || !hasText(approval.reviewedAt) || !hasText(approval.artifactRef)) {
            errors.push(`strict fine-tuning gate requires attributable approved ${role} policy review`);
          }
        }
      }
    }
  }

  const languageReviews = isObject(register.languageReviews) ? register.languageReviews : {};
  for (const locale of ['en', 'sw']) {
    const review = isObject(languageReviews[locale]) ? languageReviews[locale] : {};
    if (!['pending', 'approved', 'blocked'].includes(review.status)) {
      errors.push(`languageReviews.${locale}.status must be pending, approved, or blocked`);
    }
    if (!hasText(review.requiredReviewer)) errors.push(`languageReviews.${locale}.requiredReviewer is required`);
    if (review.status !== 'approved') warnings.push(`languageReviews.${locale}.status is ${review.status ?? 'missing'}`);
    if (options.forFinetuning && review.status !== 'approved') {
      errors.push(`strict fine-tuning gate requires languageReviews.${locale}.status=approved`);
    }
    if (options.forFinetuning && (!hasText(review.reviewerIdentity) || !hasText(review.reviewedAt) || !hasText(review.artifactRef))) {
      errors.push(`strict fine-tuning gate requires attributable ${locale} language-review evidence`);
    }
  }
  const shengReview = isObject(languageReviews.sheng) ? languageReviews.sheng : {};
  if (shengReview.status !== 'disabled') errors.push('languageReviews.sheng.status must remain disabled until an approved pack exists');

  const promotionReviews = isObject(register.promotionReviews) ? register.promotionReviews : {};
  for (const area of ['safeguarding', 'privacy', 'legal', 'ml', 'english', 'kiswahili']) {
    const decision = isObject(promotionReviews[area]) ? promotionReviews[area] : {};
    if (!['pending', 'approved', 'blocked'].includes(decision.status)) {
      errors.push(`promotionReviews.${area}.status must be pending, approved, or blocked`);
    }
    if (!hasText(decision.ownerRole)) errors.push(`promotionReviews.${area}.ownerRole is required`);
    if (decision.status !== 'approved') warnings.push(`promotionReviews.${area}.status is ${decision.status ?? 'missing'}`);
    if (options.forFinetuning && (decision.status !== 'approved' || !hasText(decision.artifactRef))) {
      errors.push(`strict fine-tuning gate requires approved promotionReviews.${area} with artifactRef`);
    }
  }

  const protectedSplits = isObject(register.protectedSplits) ? register.protectedSplits : {};
  if (protectedSplits.trainingAllowed !== false || protectedSplits.routinePromptIterationAllowed !== false) {
    errors.push('protectedSplits must forbid training and routine prompt iteration');
  }
  if (!hasText(protectedSplits.segregatedAccessEvidence)) {
    warnings.push('protectedSplits.segregatedAccessEvidence is pending');
  }
  if (options.forFinetuning && (
    !hasText(protectedSplits.accessOwnerRole)
    || /pending/i.test(protectedSplits.accessOwnerRole)
    || !hasText(protectedSplits.segregatedAccessEvidence)
  )) {
    errors.push('strict fine-tuning gate requires an attributable protected-holdout owner and segregated-access evidence');
  }

  const sources = asArray(register.sources);
  if (sources.length === 0) {
    errors.push('sources must contain at least one dataset source');
  }

  sources.forEach((source, index) => {
    const label = `sources[${index}]`;
    if (!isObject(source)) {
      errors.push(`${label} must be an object`);
      return;
    }
    const datasetId = source.datasetId;
    if (!hasText(datasetId)) {
      errors.push(`${label}.datasetId is required`);
    } else if (sourcesById.has(datasetId)) {
      errors.push(`${label}.datasetId duplicates ${datasetId}`);
    } else {
      sourcesById.set(datasetId, source);
    }

    addIf(!hasText(source.version), errors, `${label}.version is required`);
    addIf(!sourceStatuses.has(source.status), errors, `${label}.status is invalid`);
    addIf(!sourceTypes.has(source.sourceType), errors, `${label}.sourceType is invalid`);
    addIf(!privacyClasses.has(source.privacyClass), errors, `${label}.privacyClass is invalid`);
    addIf(!hasText(source.sourceLocation), errors, `${label}.sourceLocation is required`);
    addIf(!hasText(source.consentBasis), errors, `${label}.consentBasis is required`);
    addIf(!hasText(source.licenseBasis), errors, `${label}.licenseBasis is required`);
    addIf(!hasText(source.provenanceNote), errors, `${label}.provenanceNote is required`);
    addIf(!hasText(source.retentionPolicy), errors, `${label}.retentionPolicy is required`);
    addIf(!['allowed', 'restricted', 'blocked'].includes(source.publicSharing), errors, `${label}.publicSharing is invalid`);

    if (source.status === 'blocked' || source.privacyClass === 'prohibited') {
      errors.push(`${label} is blocked or prohibited`);
    }
    if (source.privacyClass === 'sensitive-internal') {
      warnings.push(`${label}.privacyClass is sensitive-internal and cannot be used without explicit approval`);
    }
    if (source.sourceType === 'partner-provided' || source.sourceType === 'licensed') {
      warnings.push(`${label}.sourceType requires explicit license and derivative-use approval`);
    }

    const splitAssignment = asArray(source.splitAssignment);
    if (splitAssignment.length === 0) {
      errors.push(`${label}.splitAssignment must not be empty`);
    }
    for (const split of splitAssignment) {
      if (!splits.has(split)) errors.push(`${label}.splitAssignment contains invalid split '${split}'`);
    }

    const reviewer = isObject(source.reviewerSignoff) ? source.reviewerSignoff : {};
    if (!['pending', 'approved', 'blocked'].includes(reviewer.status)) {
      errors.push(`${label}.reviewerSignoff.status must be pending, approved, or blocked`);
    } else if (reviewer.status !== 'approved') {
      warnings.push(`${label}.reviewerSignoff.status is ${reviewer.status}`);
    }

    validateProhibitedScreen(source, label, errors);
    scanValueForProhibitedContent(source, [label], errors);
  });

  const splitMap = isObject(register.splits) ? register.splits : {};
  for (const split of splits) {
    if (!Array.isArray(splitMap[split])) {
      errors.push(`splits.${split} must be an array`);
    }
  }

  if (options.forFinetuning) {
    if (!['approved-prototype', 'approved-production'].includes(register.status)) {
      errors.push('strict fine-tuning gate requires register.status approved-prototype or approved-production');
    }
    for (const field of ['derivativeUse', 'loraAdapterStorage', 'mobileExport', 'internalHosting']) {
      if (legalApproval[field] !== 'approved') {
        errors.push(`strict fine-tuning gate requires legalApproval.${field}=approved`);
      }
    }
    if (!['passed', 'accepted-risk'].includes(runtimeGate.baseRuntimeProof)) {
      errors.push('strict fine-tuning gate requires runtimeGate.baseRuntimeProof passed or accepted-risk');
    }
    for (const [datasetId, source] of sourcesById.entries()) {
      if (!['approved-prototype', 'approved-production'].includes(source.status)) {
        errors.push(`strict fine-tuning gate requires source ${datasetId} to be approved`);
      }
      const reviewer = isObject(source.reviewerSignoff) ? source.reviewerSignoff : {};
      if (reviewer.status !== 'approved') {
        errors.push(`strict fine-tuning gate requires source ${datasetId} reviewerSignoff.status=approved`);
      }
      if (!['synthetic', 'public', 'de-identified'].includes(source.privacyClass)) {
        errors.push(`strict fine-tuning gate rejects source ${datasetId} privacyClass=${source.privacyClass}`);
      }
    }
  }

  return { errors, warnings, sourcesById, splitMap, register };
}

function parseJsonl(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(entry => entry.line.length > 0)
    .map(entry => {
      try {
        return { number: entry.number, value: JSON.parse(entry.line) };
      } catch (error) {
        throw new Error(`Invalid JSONL at line ${entry.number}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

function validateDataRows(rows, registerValidation, options) {
  const errors = [];
  const warnings = [];
  const rowIds = new Set();
  const unapprovedDatasetIdsReported = new Set();
  const splitCounts = Object.fromEntries([...splits].map(split => [split, 0]));
  const registerSplitIds = new Set(
    Object.values(registerValidation.splitMap)
      .filter(Array.isArray)
      .flat(),
  );
  const registerHasFrozenSplits = registerSplitIds.size > 0;

  rows.forEach(({ number, value }) => {
    const label = `line ${number}`;
    if (!isObject(value)) {
      errors.push(`${label} must be a JSON object`);
      return;
    }
    const rowId = value.id;
    const datasetId = value.datasetId;
    const split = value.split;
    if (!hasText(rowId)) {
      errors.push(`${label}.id is required`);
    } else if (rowIds.has(rowId)) {
      errors.push(`${label}.id duplicates ${rowId}`);
    } else {
      rowIds.add(rowId);
    }

    const source = registerValidation.sourcesById.get(datasetId);
    if (!source) {
      errors.push(`${label}.datasetId '${datasetId}' is not registered`);
    } else {
      if (source.status === 'blocked') {
        errors.push(`${label}.datasetId '${datasetId}' is blocked`);
      }
      if (!asArray(source.splitAssignment).includes(split)) {
        errors.push(`${label}.split '${split}' is not allowed by source ${datasetId}`);
      }
      if (options.forFinetuning && !['approved-prototype', 'approved-production'].includes(source.status)) {
        if (!unapprovedDatasetIdsReported.has(datasetId)) {
          errors.push(
            `${label}.datasetId '${datasetId}' is not approved for fine-tuning; further row-level errors for this dataset are suppressed`,
          );
          unapprovedDatasetIdsReported.add(datasetId);
        }
      }
    }

    if (!splits.has(split)) {
      errors.push(`${label}.split is invalid`);
    } else {
      splitCounts[split] += 1;
      if (registerHasFrozenSplits && !asArray(registerValidation.splitMap[split]).includes(rowId)) {
        errors.push(`${label}.id '${rowId}' is not listed under register.splits.${split}`);
      }
    }

    const messages = asArray(value.messages);
    if (messages.length < 2) {
      errors.push(`${label}.messages must contain at least user and assistant messages`);
    }
    messages.forEach((message, messageIndex) => {
      if (!isObject(message)) {
        errors.push(`${label}.messages[${messageIndex}] must be an object`);
        return;
      }
      if (!messageRoles.has(message.role)) {
        errors.push(`${label}.messages[${messageIndex}].role is invalid`);
      }
      if (!hasText(message.content)) {
        errors.push(`${label}.messages[${messageIndex}].content is required`);
      }
    });
    const roles = messages.map(message => message?.role);
    const conversationRoles = roles[0] === 'system' ? roles.slice(1) : roles;
    if (roles.filter(role => role === 'system').length > (roles[0] === 'system' ? 1 : 0)) {
      errors.push(`${label}.messages may contain at most one system message and only at index 0`);
    }
    if (conversationRoles.length < 2 || conversationRoles[0] !== 'user' || conversationRoles.at(-1) !== 'assistant') {
      errors.push(`${label}.messages must start with user after optional system and end with assistant`);
    }
    conversationRoles.forEach((role, roleIndex) => {
      const expected = roleIndex % 2 === 0 ? 'user' : 'assistant';
      if (role !== expected) errors.push(`${label}.messages[${roleIndex + (roles[0] === 'system' ? 1 : 0)}] must be ${expected}`);
    });

    scanValueForProhibitedContent(value, [label], errors);
  });

  if (!registerHasFrozenSplits) {
    warnings.push('register.splits is empty; strict fine-tuning mode requires frozen row ids');
  }
  if (registerHasFrozenSplits) {
    for (const registeredId of registerSplitIds) {
      if (!rowIds.has(registeredId)) errors.push(`register split row '${registeredId}' is missing from data`);
    }
    const listedCount = Object.values(registerValidation.splitMap).filter(Array.isArray).reduce((count, ids) => count + ids.length, 0);
    if (listedCount !== registerSplitIds.size) errors.push('register split row IDs must be unique across all splits');
  }
  if (options.forFinetuning) {
    if (rows.length === 0) errors.push('strict fine-tuning gate requires at least one data row');
    if (splitCounts.train === 0) errors.push('strict fine-tuning gate requires train rows');
    if (splitCounts.dev === 0) errors.push('strict fine-tuning gate requires dev rows');
    if (splitCounts['quality-holdout'] === 0) errors.push('strict fine-tuning gate requires quality-holdout rows');
    if (splitCounts['safety-holdout'] === 0) errors.push('strict fine-tuning gate requires safety-holdout rows');
    if (!registerHasFrozenSplits) errors.push('strict fine-tuning gate requires frozen register.splits row ids');
    const readiness = registerValidation.register.trainingReadiness;
    if (isObject(readiness) && readiness.declaredTrainRows !== splitCounts.train) {
      errors.push('trainingReadiness.declaredTrainRows does not match the actual train split');
    }
    if (
      isObject(readiness)
      && Number.isInteger(readiness.approvedMinimumTrainRows)
      && splitCounts.train < readiness.approvedMinimumTrainRows
    ) {
      errors.push(
        `strict fine-tuning gate requires at least ${readiness.approvedMinimumTrainRows} train rows; found ${splitCounts.train}`,
      );
    }
  } else if (
    isObject(registerValidation.register.trainingReadiness)
    && registerValidation.register.trainingReadiness.declaredTrainRows !== splitCounts.train
  ) {
    errors.push('trainingReadiness.declaredTrainRows does not match the actual train split');
  }

  return { errors, warnings, splitCounts };
}

function validateAuditReport(report, context) {
  const errors = [];
  const warnings = [];
  addIf(report.schema !== 'com.saferide.gemma4.dataset-audit', errors, 'audit.schema is invalid');
  addIf(report.schemaVersion !== 1, errors, 'audit.schemaVersion must be 1');
  addIf(report.registerId !== context.register.registerId, errors, 'audit.registerId does not match register');
  addIf(report.registerSha256 !== context.registerSha256, errors, 'audit.registerSha256 does not match register bytes');
  if (!hasText(report.auditImplementation?.script) || !hasText(report.auditImplementation?.sha256)) {
    errors.push('audit.auditImplementation script and SHA-256 are required');
  } else {
    const implementationPath = resolveRepoPath(report.auditImplementation.script);
    if (!fs.existsSync(implementationPath)) errors.push('audit implementation script does not exist');
    else if (report.auditImplementation.sha256 !== sha256(fs.readFileSync(implementationPath, 'utf8').replace(/\r\n/g, '\n'))) {
      errors.push('audit implementation SHA-256 does not match current bytes');
    }
  }
  if (context.dataSha256) {
    addIf(report.dataSha256 !== context.dataSha256, errors, 'audit.dataSha256 does not match data bytes');
    addIf(report.rowCount !== context.rowCount, errors, 'audit.rowCount does not match data rows');
  } else {
    warnings.push('audit data hash cannot be verified without --data');
  }
  addIf(report.passed !== true, errors, 'audit.passed must be true');
  addIf(!Array.isArray(report.failures) || report.failures.length !== 0, errors, 'audit.failures must be an empty array');
  addIf(report.protectedHoldouts?.configured !== true, errors, 'audit protected holdouts must be configured');
  for (const field of ['exactTurn', 'normalizedTurn', 'exactConversation', 'normalizedConversation', 'nearDuplicates', 'holdoutAssistantCopies']) {
    addIf(!Array.isArray(report.overlap?.[field]), errors, `audit.overlap.${field} must be an array`);
  }
  for (const field of ['uniqueAssistantTargetRatio', 'distinct1', 'distinct2', 'distinct3']) {
    addIf(typeof report.diversity?.[field] !== 'number', errors, `audit.diversity.${field} must be numeric`);
  }
  scanValueForProhibitedContent(report, ['audit'], errors);
  return { errors, warnings };
}

function printResult(label, errors, warnings) {
  if (warnings.length > 0) {
    console.log(`\n${label} warnings:`);
    warnings.forEach(warning => console.log(`- ${warning}`));
  }
  if (errors.length > 0) {
    console.error(`\n${label} errors:`);
    errors.forEach(error => console.error(`- ${error}`));
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const registerPath = resolveRepoPath(args.registerPath);
  const registerText = fs.readFileSync(registerPath, 'utf8').replace(/\r\n/g, '\n');
  const register = JSON.parse(registerText);
  const registerValidation = validateRegister(register, args);

  console.log('SafeRide Gemma 4 E2B fine-tuning data gate');
  console.log(`Register: ${path.relative(repoRoot, registerPath) || registerPath}`);
  console.log(`Mode: ${args.forFinetuning ? 'strict fine-tuning gate' : 'preparation check'}`);

  printResult('Register', registerValidation.errors, registerValidation.warnings);

  let dataValidation = { errors: [], warnings: [], splitCounts: Object.fromEntries([...splits].map(split => [split, 0])) };
  let dataText;
  let dataRows = [];
  if (args.dataPath) {
    const dataPath = resolveRepoPath(args.dataPath);
    dataText = fs.readFileSync(dataPath, 'utf8').replace(/\r\n/g, '\n');
    dataRows = parseJsonl(dataPath);
    dataValidation = validateDataRows(dataRows, registerValidation, args);
    console.log(`Data rows: ${dataRows.length}`);
    console.log(`Split counts: ${JSON.stringify(dataValidation.splitCounts)}`);
    printResult('Data', dataValidation.errors, dataValidation.warnings);
    if (register.generator) {
      if (register.generator.dataSha256 !== sha256(dataText)) {
        dataValidation.errors.push('register.generator.dataSha256 does not match data bytes');
      }
      if (register.generator.deterministicBytes !== true) {
        dataValidation.errors.push('register.generator.deterministicBytes must be true');
      }
      if (hasText(register.generator.script)) {
        const generatorPath = resolveRepoPath(register.generator.script);
        if (!fs.existsSync(generatorPath)) {
          dataValidation.errors.push('register.generator.script does not exist');
        } else if (register.generator.scriptSha256 !== sha256(fs.readFileSync(generatorPath, 'utf8').replace(/\r\n/g, '\n'))) {
          dataValidation.errors.push('register.generator.scriptSha256 does not match generator bytes');
        }
      }
      printResult('Generator', dataValidation.errors.filter(error => error.startsWith('register.generator')), []);
    }
  } else if (args.forFinetuning) {
    dataValidation.errors.push('strict fine-tuning gate requires --data <jsonl>');
    printResult('Data', dataValidation.errors, dataValidation.warnings);
  }

  let auditValidation = { errors: [], warnings: [] };
  if (args.auditPath) {
    const auditPath = resolveRepoPath(args.auditPath);
    const audit = readJsonFile(auditPath);
    auditValidation = validateAuditReport(audit, {
      register,
      registerSha256: sha256(registerText),
      dataSha256: dataText ? sha256(dataText) : undefined,
      rowCount: dataRows.length,
    });
    console.log(`Audit: ${path.relative(repoRoot, auditPath) || auditPath}`);
    printResult('Audit', auditValidation.errors, auditValidation.warnings);
  } else if (register.auditPolicy) {
    const message = 'register declares auditPolicy but --audit <json> was not supplied';
    if (args.forFinetuning) auditValidation.errors.push(message);
    else auditValidation.warnings.push(message);
    printResult('Audit', auditValidation.errors, auditValidation.warnings);
  }

  const errors = [...registerValidation.errors, ...dataValidation.errors, ...auditValidation.errors];
  if (errors.length > 0) {
    process.exitCode = 1;
    return;
  }

  console.log(args.forFinetuning
    ? '\nFine-tuning data gate passed.'
    : '\nPreparation check passed. Strict fine-tuning may still be blocked by warnings and missing approvals.');
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(`\n${usage()}`);
  process.exitCode = 1;
}
