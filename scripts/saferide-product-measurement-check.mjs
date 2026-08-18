#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

import { findForbiddenMeasurementPath } from './saferide-moderated-cohort.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED_EVENT_NAMES = [
  'report_start', 'step_complete', 'report_complete', 'consent_review',
  'referral_select', 'contact_action', 'export_attempt', 'ai_preparation', 'error_outcome',
];
const REQUIRED_SCOPES = ['app-shell', 'core-settings', 'accessibility', 'moderated-testing'];
const PLACEHOLDER_PATTERN = /\b(?:TODO|TBD|TRANSLATE|PLACEHOLDER|LOREM IPSUM)\b|\{\{[^}]+\}\}/i;

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function schemaValidator(schemaPath) {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  return ajv.compile(readJson(schemaPath));
}

function schemaErrors(validate, value, label) {
  if (validate(value)) return [];
  return (validate.errors ?? []).map(error => `${label}${error.instancePath || '$'} ${error.message ?? 'is invalid'}`);
}

const validateControlsShape = schemaValidator('schemas/moderated-test-controls.schema.json');
const validateLocaleMatrixShape = schemaValidator('schemas/locale-availability.schema.json');
const validateReleaseEvidenceShape = schemaValidator('schemas/moderated-testing-release-evidence.schema.json');
const validateCohortShape = schemaValidator('schemas/moderated-cohort-summary.schema.json');
const validateFindingsShape = schemaValidator('schemas/moderated-findings.schema.json');

function addGate(gates, id, passed, detail) {
  gates.push({ id, passed: Boolean(passed), detail });
}

export function readProductMeasurementSources(root = ROOT) {
  const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
  const coreScreenPaths = [
    'src/screens/Home.tsx', 'src/screens/WhatHappened.tsx', 'src/screens/WhereWhen.tsx',
    'src/screens/EvidenceDetail.tsx', 'src/screens/ConsentGate.tsx', 'src/screens/ReferralPicker.tsx',
    'src/screens/PrivacyData.tsx', 'src/screens/ChatLegalAid.tsx',
  ];
  return {
    eventSchema: read('src/lib/measurement/eventSchema.ts'),
    eventStore: read('src/lib/measurement/localEventStore.ts'),
    aggregate: read('src/lib/measurement/aggregateReport.ts'),
    consentScreen: read('src/screens/TestMeasurementConsent.tsx'),
    issueScreen: read('src/screens/IssueReport.tsx'),
    summaryScreen: read('src/screens/TestSessionSummary.tsx'),
    settings: read('src/screens/Settings.tsx'),
    rootNavigator: read('src/navigation/RootNavigator.tsx'),
    encryptedStorage: read('src/lib/encryptedAsyncStorage.ts'),
    languageConfig: read('src/config/languageAvailability.ts'),
    appConfig: read('app.config.js'),
    coreScreens: coreScreenPaths.map(read).join('\n'),
  };
}

export function validateProductMeasurementSources(sources, controls) {
  const gates = [];
  addGate(gates, 'default-disabled', controls?.capability?.status === 'disabled' && Boolean(controls?.capability?.reason), 'Checked-in measurement control must be disabled with a reason.');
  addGate(gates, 'no-production-or-upload', controls?.runtime?.productionAllowed === false && controls?.runtime?.networkUploadAllowed === false, 'Production and automatic network upload must be prohibited.');
  addGate(gates, 'test-build-only', sources.appConfig.includes("new Set(['preview', 'test'])") && sources.appConfig.includes('is allowed only for explicit test or staging-preview builds'), 'Expo config must reject moderated mode outside approved test profiles.');
  addGate(gates, 'separate-consent', controls?.consent?.separateFromPathwayConsent === true && controls?.consent?.withdrawalDeletesLocalEvents === true, 'Moderated measurement uses separate, withdrawable consent.');
  addGate(gates, 'encrypted-keys', ['MEASUREMENT_CONSENT_KEY', 'MEASUREMENT_SESSION_KEY', 'MEASUREMENT_EVENTS_KEY', 'MEASUREMENT_ISSUES_KEY'].every(key => sources.encryptedStorage.includes(key)), 'Every moderated-test persistence key must use encrypted device-bound storage.');
  addGate(gates, 'strict-categorical-issue-flow', !/TextInput|Textarea/.test(sources.issueScreen) && sources.issueScreen.includes('ACTUAL_BEHAVIORS') && sources.issueScreen.includes('EXPECTED_BEHAVIORS'), 'Issue reporting must remain categorical with no free-text field.');
  addGate(gates, 'reviewed-diagnostics', sources.issueScreen.includes('diagnosticsReviewed: true') && sources.eventSchema.includes('Optional diagnostics require an explicit user review confirmation'), 'Optional diagnostics require review and an allowlist.');
  addGate(gates, 'inspect-delete-copy', sources.summaryScreen.includes('listMeasurementEvents') && sources.summaryScreen.includes('deleteAllLocalTestData') && sources.summaryScreen.includes('buildContentFreeAggregateReport'), 'Participants can inspect and delete local data and intentionally copy only an aggregate.');
  addGate(gates, 'visible-test-banner', sources.rootNavigator.includes('measurementDecision.enabled') && sources.rootNavigator.includes('measurementCopy.enabledBanner') && sources.rootNavigator.includes('accessibilityLiveRegion="polite"'), 'Enabled test mode has a persistent visible moderated-measurement banner.');
  addGate(gates, 'settings-entry', sources.settings.includes("navigate('TestMeasurementConsent')"), 'The issue and measurement controls are reachable from Settings.');
  addGate(gates, 'disabled-navigation-gate', sources.settings.includes('measurementDecision.enabled ?') && sources.rootNavigator.includes('buildLinkingOptions(measurementDecision.enabled)') && sources.consentScreen.includes('{granted ? ('), 'Disabled or unconsented moderated-test navigation must fail closed.');
  addGate(gates, 'issue-consent-session-gate', sources.eventStore.includes('hasCurrentMeasurementAuthorization') && sources.eventStore.includes('No current consented moderated-test session exists.') && sources.issueScreen.includes("authorization !== 'allowed'"), 'Issue persistence and UI require current approved controls, consent, and an active matching session.');
  addGate(gates, 'aggregate-no-identifiers', !/eventId:|sessionId:|issueId:/.test(sources.aggregate), 'Aggregate output must not expose event, session, or issue identifiers.');
  for (const eventName of REQUIRED_EVENT_NAMES) {
    const instrumented = eventName === 'report_complete'
      ? sources.coreScreens.includes('captureReportCompletion()')
      : sources.coreScreens.includes(`name: '${eventName}'`);
    addGate(gates, `event-${eventName}`, sources.eventSchema.includes(`'${eventName}'`) && instrumented, `${eventName} must be allowlisted and instrumented at a real task boundary.`);
  }
  addGate(gates, 'shared-language-matrix', sources.languageConfig.includes('rawMatrix') && sources.languageConfig.includes('isLanguageClaimable') && sources.languageConfig.includes("return DEFAULT_LANGUAGE_CODE"), 'Product and AI language claims share one fail-closed matrix.');
  return gates;
}

function flattenStrings(value, prefix = '', output = new Map()) {
  if (typeof value === 'string') {
    output.set(prefix, value);
  } else if (Array.isArray(value)) {
    value.forEach((child, index) => flattenStrings(child, `${prefix}[${index}]`, output));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (['schemaVersion', 'resourceVersion', 'locale'].includes(key)) continue;
      flattenStrings(child, prefix ? `${prefix}.${key}` : key, output);
    }
  }
  return output;
}

export function validateLocaleAvailability(matrix, readResource = relative => readJson(relative)) {
  const errors = [...schemaErrors(validateLocaleMatrixShape, matrix, 'locale matrix ')];
  if (!Array.isArray(matrix?.locales)) return errors;
  const codes = matrix.locales.map(locale => locale.code);
  if (new Set(codes).size !== codes.length || !['en', 'sw', 'sh'].every(code => codes.includes(code))) {
    errors.push('locale matrix must contain en, sw, and sh exactly once');
  }
  const source = matrix.locales.find(locale => locale.code === matrix.sourceLocale);
  if (!source || source.productStatus !== 'enabled' || source.claimStatus !== 'enabled') {
    errors.push('English source locale must be enabled for both product and claim status');
  }

  let sourceKeys = null;
  for (const locale of matrix.locales) {
    if (locale.productStatus !== locale.claimStatus) {
      errors.push(`${locale.code} productStatus and claimStatus must match`);
    }
    const enabled = locale.productStatus === 'enabled';
    if (enabled) {
      if (!locale.resource) errors.push(`${locale.code} enabled locale requires a versioned resource`);
      if (!['source', 'approved'].includes(locale.review?.status) || !locale.review?.reviewId || !locale.review?.reviewedAt) {
        errors.push(`${locale.code} enabled locale requires attributable source or approved review metadata`);
      }
      for (const scope of REQUIRED_SCOPES) {
        if (!locale.review?.scope?.includes(scope)) errors.push(`${locale.code} enabled locale review is missing ${scope} scope`);
      }
    } else if (!locale.unavailableReason) {
      errors.push(`${locale.code} disabled locale requires an unavailable reason`);
    }
    if (!locale.resource) continue;
    let resource;
    try {
      resource = readResource(locale.resource);
    } catch (error) {
      errors.push(`${locale.code} resource cannot be read: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (resource.schemaVersion !== '1.0.0' || resource.resourceVersion !== matrix.resourceVersion || resource.locale !== locale.code) {
      errors.push(`${locale.code} resource metadata does not match the matrix`);
    }
    const strings = flattenStrings(resource);
    for (const [key, value] of strings) {
      if (!value.trim()) errors.push(`${locale.code} resource key ${key} is empty`);
      if (PLACEHOLDER_PATTERN.test(value)) errors.push(`${locale.code} resource key ${key} contains a placeholder`);
    }
    if (locale.code === matrix.sourceLocale) sourceKeys = new Set(strings.keys());
  }
  if (sourceKeys) {
    for (const locale of matrix.locales.filter(item => item.resource && item.code !== matrix.sourceLocale)) {
      const keys = new Set(flattenStrings(readResource(locale.resource)).keys());
      for (const key of sourceKeys) if (!keys.has(key)) errors.push(`${locale.code} resource is missing key ${key}`);
      for (const key of keys) if (!sourceKeys.has(key)) errors.push(`${locale.code} resource has orphan key ${key}`);
    }
  }
  return [...new Set(errors)];
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function resolveEvidenceFile(pointer, label, blockers, root) {
  if (!pointer?.path || !pointer?.sha256) {
    blockers.push(`${label} path and SHA-256 are required`);
    return null;
  }
  const resolved = path.resolve(root, pointer.path);
  if (!resolved.startsWith(`${root}${path.sep}`) || !fs.existsSync(resolved)) {
    blockers.push(`${label} must resolve to an existing repository file`);
    return null;
  }
  if (sha256File(resolved) !== pointer.sha256) {
    blockers.push(`${label} SHA-256 does not match`);
    return null;
  }
  return { resolved, value: JSON.parse(fs.readFileSync(resolved, 'utf8')) };
}

export function getModeratedTestingReleaseBlockers(evidence, root = ROOT) {
  const blockers = [...schemaErrors(validateReleaseEvidenceShape, evidence, 'release evidence ')];
  const forbiddenPath = findForbiddenMeasurementPath(evidence);
  if (forbiddenPath) blockers.push(`forbidden sensitive field at ${forbiddenPath}`);
  if (evidence?.status !== 'approved') blockers.push('release evidence status must be approved');
  if (!/^[a-f0-9]{40}$/.test(evidence?.sourceRevision ?? '')) blockers.push('sourceRevision must be a full commit SHA');
  if (!/^[a-f0-9]{64}$/.test(evidence?.buildArtifactSha256 ?? '')) blockers.push('test build artifact SHA-256 is required');

  const cohort = resolveEvidenceFile(evidence?.cohortSummary, 'cohort summary', blockers, root);
  const findings = resolveEvidenceFile(evidence?.findings, 'findings register', blockers, root);
  if (cohort) {
    blockers.push(...schemaErrors(validateCohortShape, cohort.value, 'cohort summary '));
    if (cohort.value.sessionCount < 15 || cohort.value.sessionCount > 25) blockers.push('15 to 25 valid sessions are required');
    if (cohort.value.thresholdResult !== 'pass' || cohort.value.unassistedCompletionRate < 0.8) blockers.push('unassisted completion must meet the 80 percent threshold');
  }
  if (findings) {
    blockers.push(...schemaErrors(validateFindingsShape, findings.value, 'findings register '));
    if (findings.value.sourceRevision !== evidence?.sourceRevision) blockers.push('findings source revision must match release evidence');
    if (cohort && findings.value.cohortSummarySha256 !== evidence.cohortSummary.sha256) blockers.push('findings must bind the cohort summary SHA-256');
    for (const finding of findings.value.findings ?? []) {
      if (finding.severity !== 'critical') continue;
      const fixed = finding.status === 'fixed' && finding.fixCommit && finding.retestStatus === 'pass';
      const accepted = finding.status === 'risk_accepted' && finding.reviewDecision && finding.retestStatus === 'not_applicable';
      if (!fixed && !accepted) blockers.push(`critical finding ${finding.findingId} is not fixed and retested or formally risk accepted`);
    }
  }
  const approvals = Array.isArray(evidence?.approvals) ? evidence.approvals : [];
  const reviewerIds = new Set();
  for (const role of ['product-safeguarding', 'privacy', 'independent-qa']) {
    const matches = approvals.filter(item => item?.role === role);
    if (matches.length !== 1) {
      blockers.push(`${role} approval must appear exactly once`);
      continue;
    }
    const approval = matches[0];
    if (approval.status !== 'approved' || !approval.reviewerId || !approval.reviewedAt || approval.independent !== true) {
      blockers.push(`${role} approval must be current, attributable, and independent`);
    }
    if (approval.reviewerId) reviewerIds.add(approval.reviewerId);
  }
  if (reviewerIds.size !== 3) blockers.push('the three approval roles require distinct reviewers');
  return [...new Set(blockers)];
}

export function runProductMeasurementCheck(options = {}) {
  const controls = options.controls ?? readJson('config/measurement/moderated-test-controls.v1.json');
  const matrix = options.matrix ?? readJson('config/localization/locale-availability.v1.json');
  const sources = options.sources ?? readProductMeasurementSources(options.root);
  const sourceGates = validateProductMeasurementSources(sources, controls);
  const errors = [
    ...schemaErrors(validateControlsShape, controls, 'measurement controls '),
    ...sourceGates.filter(gate => !gate.passed).map(gate => `${gate.id}: ${gate.detail}`),
    ...validateLocaleAvailability(matrix, options.readResource),
  ];
  let releaseBlockers = [];
  if (options.release) {
    const evidence = options.evidence ?? readJson(options.evidencePath ?? 'docs/qa/saferide-moderated-testing-evidence.pending.json');
    releaseBlockers = getModeratedTestingReleaseBlockers(evidence);
    errors.push(...releaseBlockers.map(blocker => `release blocker: ${blocker}`));
  }
  return { sourceGates, releaseBlockers, errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const release = process.argv.includes('--release');
  const evidenceIndex = process.argv.indexOf('--evidence');
  const knownArgs = new Set(['--release', '--evidence']);
  const unknown = process.argv.slice(2).filter((arg, index, all) => !knownArgs.has(arg) && all[index - 1] !== '--evidence');
  if (unknown.length) {
    console.error(`Unknown argument: ${unknown[0]}`);
    process.exitCode = 1;
  } else {
    const result = runProductMeasurementCheck({
      release,
      evidencePath: evidenceIndex >= 0 ? process.argv[evidenceIndex + 1] : undefined,
    });
    if (result.errors.length) {
      result.errors.forEach(error => console.error(`FAIL ${error}`));
      process.exitCode = 1;
    } else {
      console.log(`PASS ${result.sourceGates.length} measurement and localization source gates`);
    }
  }
}
