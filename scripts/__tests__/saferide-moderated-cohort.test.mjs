import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildModeratedCohortSummary,
  validateModeratedSession,
} from '../saferide-moderated-cohort.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function session(sequence, overrides = {}) {
  return {
    schemaVersion: 'moderated-session-aggregate.v1',
    sessionSequence: sequence,
    syntheticScenario: 'core-report',
    syntheticOnly: true,
    contentFree: true,
    consentScriptVersion: 'synthetic-consent-v1',
    safeguardingProtocolVersion: 'synthetic-safeguarding-v1',
    reportTask: {
      started: true,
      completed: true,
      assistance: sequence <= 12 ? 'none' : 'moderator',
      timeToReportMsBucket: sequence * 15000,
      dropOffStep: null,
      retries: sequence % 3,
      errorCount: 0,
    },
    ratings: { comprehension: 4, accessibility: 5, referralClarity: 4, errorRecovery: 4 },
    issueCounts: { low: 1, medium: 0, high: 0, critical: 0 },
    ...overrides,
  };
}

test('cohort runner produces a content-free 80 percent threshold result', () => {
  const summary = buildModeratedCohortSummary(
    Array.from({ length: 15 }, (_, index) => session(index + 1)),
    new Date('2026-07-30T12:00:00.000Z'),
  );
  assert.equal(summary.sessionCount, 15);
  assert.equal(summary.unassistedReportCompletions, 12);
  assert.equal(summary.unassistedCompletionRate, 0.8);
  assert.equal(summary.thresholdResult, 'pass');
  assert.equal(JSON.stringify(summary).includes('sessionSequence'), false);
});

test('checked-in synthetic session example is schema-valid but not cohort evidence', () => {
  const example = JSON.parse(fs.readFileSync(
    path.join(root, 'docs/qa/fixtures/moderated-session.synthetic-example.json'),
    'utf8',
  ));
  assert.deepEqual(validateModeratedSession(example), []);
  assert.equal(example.reportTask.assistance, 'not_recorded');
});

test('cohort runner reports a truthful failure below the threshold', () => {
  const sessions = Array.from({ length: 15 }, (_, index) => session(index + 1));
  sessions[11].reportTask.assistance = 'moderator';
  const summary = buildModeratedCohortSummary(sessions);
  assert.equal(summary.thresholdResult, 'fail');
  assert.ok(summary.unassistedCompletionRate < 0.8);
});

test('cohort runner rejects too few sessions and duplicate sequence numbers', () => {
  assert.throws(() => buildModeratedCohortSummary(
    Array.from({ length: 14 }, (_, index) => session(index + 1)),
  ), /15 to 25/);
  const sessions = Array.from({ length: 15 }, (_, index) => session(index + 1));
  sessions[14].sessionSequence = 1;
  assert.throws(() => buildModeratedCohortSummary(sessions), /duplicate sessionSequence/);
});

test('session validator rejects sensitive keys and inconsistent completion state', () => {
  const unsafe = session(1);
  unsafe.narrative = 'synthetic text that must never be accepted';
  assert.ok(validateModeratedSession(unsafe).some(error => error.includes('forbidden sensitive field')));

  const inconsistent = session(2);
  inconsistent.reportTask.completed = false;
  assert.ok(validateModeratedSession(inconsistent).includes('incomplete report must not have a completion time'));
  assert.ok(validateModeratedSession(inconsistent).includes('incomplete report requires a dropOffStep'));
});
