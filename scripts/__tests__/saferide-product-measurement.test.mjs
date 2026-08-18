import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  getModeratedTestingReleaseBlockers,
  readProductMeasurementSources,
  runProductMeasurementCheck,
  validateLocaleAvailability,
  validateProductMeasurementSources,
} from '../saferide-product-measurement-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

test('repository measurement and localization source gates pass', () => {
  const result = runProductMeasurementCheck();
  assert.deepEqual(result.errors, []);
  assert.equal(result.sourceGates.every(gate => gate.passed), true);
});

test('source gate catches missing task-boundary instrumentation', () => {
  const sources = readProductMeasurementSources(root);
  sources.coreScreens = sources.coreScreens.replace("name: 'export_attempt'", "name: 'removed_export_attempt'");
  const gates = validateProductMeasurementSources(
    sources,
    readJson('config/measurement/moderated-test-controls.v1.json'),
  );
  assert.equal(gates.find(gate => gate.id === 'event-export_attempt')?.passed, false);
});

test('locale matrix rejects enabled Kiswahili without review metadata and resource', () => {
  const matrix = readJson('config/localization/locale-availability.v1.json');
  const sw = matrix.locales.find(locale => locale.code === 'sw');
  sw.productStatus = 'enabled';
  sw.claimStatus = 'enabled';
  const errors = validateLocaleAvailability(matrix);
  assert.ok(errors.some(error => error.includes('sw enabled locale requires a versioned resource')));
  assert.ok(errors.some(error => error.includes('sw enabled locale requires attributable')));
});

test('pending moderated evidence remains blocked without fabricating sessions or approvals', () => {
  const evidence = readJson('docs/qa/saferide-moderated-testing-evidence.pending.json');
  const blockers = getModeratedTestingReleaseBlockers(evidence);
  assert.ok(blockers.includes('release evidence status must be approved'));
  assert.ok(blockers.includes('cohort summary path and SHA-256 are required'));
  assert.ok(blockers.includes('product-safeguarding approval must be current, attributable, and independent'));
});

test('release gate accepts hash-bound content-free results and independent approvals', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'saferide-measurement-'));
  try {
    const sourceRevision = 'a'.repeat(40);
    const cohort = {
      schemaVersion: 'moderated-cohort-summary.v1', generatedAt: '2026-07-30T12:00:00.000Z',
      syntheticOnly: true, contentFree: true, sessionCount: 15, reportStarts: 15,
      reportCompletions: 13, unassistedReportCompletions: 12, completionRate: 13 / 15,
      unassistedCompletionRate: 0.8, unassistedThreshold: 0.8, thresholdResult: 'pass',
      medianTimeToReportMsBucket: 120000, dropOffsByStep: { 'consent-gate': 2 },
      retries: 3, errors: 1,
      meanRatings: { comprehension: 4, accessibility: 4, referralClarity: 4, errorRecovery: 4 },
      issueCounts: { low: 2, medium: 1, high: 0, critical: 1 },
    };
    const cohortText = `${JSON.stringify(cohort, null, 2)}\n`;
    fs.writeFileSync(path.join(tempRoot, 'cohort.json'), cohortText);
    const cohortHash = sha256(cohortText);
    const findings = {
      schemaVersion: 'moderated-findings.v1', sourceRevision, cohortSummarySha256: cohortHash,
      contentFree: true,
      findings: [{
        findingId: 'MT-001', severity: 'critical', category: 'privacy_boundary', issueReference: 'ESH-3897',
        status: 'fixed', fixCommit: 'b'.repeat(40), retestStatus: 'pass', reviewDecision: null,
      }],
    };
    const findingsText = `${JSON.stringify(findings, null, 2)}\n`;
    fs.writeFileSync(path.join(tempRoot, 'findings.json'), findingsText);
    const evidence = {
      schemaVersion: 'moderated-testing-release-evidence.v1', status: 'approved', sourceRevision,
      buildArtifactSha256: 'c'.repeat(64),
      cohortSummary: { path: 'cohort.json', sha256: cohortHash },
      findings: { path: 'findings.json', sha256: sha256(findingsText) },
      approvals: [
        { role: 'product-safeguarding', status: 'approved', reviewerId: 'reviewer-a', reviewedAt: '2026-07-30T13:00:00.000Z', independent: true },
        { role: 'privacy', status: 'approved', reviewerId: 'reviewer-b', reviewedAt: '2026-07-30T13:05:00.000Z', independent: true },
        { role: 'independent-qa', status: 'approved', reviewerId: 'reviewer-c', reviewedAt: '2026-07-30T13:10:00.000Z', independent: true },
      ],
      handoff: readJson('docs/qa/saferide-moderated-testing-evidence.pending.json').handoff,
    };
    assert.deepEqual(getModeratedTestingReleaseBlockers(evidence, tempRoot), []);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release gate rejects sensitive participant fields', () => {
  const evidence = readJson('docs/qa/saferide-moderated-testing-evidence.pending.json');
  evidence.participantName = 'must not exist';
  assert.ok(getModeratedTestingReleaseBlockers(evidence).some(error => error.includes('forbidden sensitive field')));
});
