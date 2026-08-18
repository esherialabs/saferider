import { describe, expect, it } from 'vitest';

import { buildContentFreeAggregateReport } from './aggregateReport';
import { createMeasurementEvent } from './eventSchema';
import { createIssueReport } from './issueSchema';

const baseEvent = {
  eventId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  sessionStartedAtBucketMs: Date.parse('2026-07-30T10:00:00.000Z'),
  controlVersion: 'controls.synthetic-v1',
  consentVersion: 'consent.synthetic-v1',
  retentionHours: 24,
  now: new Date('2026-07-30T10:00:31.200Z'),
};

function event(input: Parameters<typeof createMeasurementEvent>[0]['input']) {
  return createMeasurementEvent({ ...baseEvent, input });
}

describe('measurement event schema', () => {
  it('creates only coarse, allowlisted, expiring events', () => {
    const created = event({
      name: 'report_start',
      screenId: 'home',
      taskId: 'report-flow',
      outcome: 'started',
    });

    expect(created.recordedAtBucket).toBe('2026-07-30T10:00:30.000Z');
    expect(created.elapsedMsBucket).toBe(30_000);
    expect(created.expiresAtBucket).toBe('2026-07-31T10:00:30.000Z');
    expect(created.diagnostics).toBeNull();
  });

  it('requires explicit review for diagnostics and rejects extra or sensitive fields', () => {
    const diagnostics = {
      appVersion: '1.0.0',
      deviceTier: 'standard' as const,
      androidVersion: '16',
      featureFlags: ['offline'] as Array<'offline'>,
    };
    expect(() => event({
      name: 'step_complete', screenId: 'where-when', taskId: 'report-flow', outcome: 'completed', diagnostics,
    })).toThrow('explicit user review');
    expect(() => event({
      name: 'step_complete', screenId: 'where-when', taskId: 'report-flow', outcome: 'completed',
      diagnostics, diagnosticsReviewed: true,
    })).not.toThrow();
    expect(() => event({
      name: 'report_start', screenId: 'home', taskId: 'report-flow', outcome: 'started',
      narrative: 'synthetic private narrative',
    } as never)).toThrow();
    expect(() => event({
      name: 'report_start', screenId: 'home', taskId: 'report-flow', outcome: 'started',
      exactLocation: { latitude: 0, longitude: 0 },
    } as never)).toThrow();
  });

  it('enforces error and unassisted-completion semantics', () => {
    expect(() => event({
      name: 'error_outcome', screenId: 'consent-gate', taskId: 'report-flow', outcome: 'failed',
    })).toThrow('allowlisted error code');
    expect(() => event({
      name: 'step_complete', screenId: 'where-when', taskId: 'report-flow', outcome: 'completed',
      errorCode: 'submit_failed',
    })).toThrow('only on error_outcome');
    expect(() => event({
      name: 'report_complete', screenId: 'consent-gate', taskId: 'report-flow', outcome: 'completed',
    })).toThrow('assistance value');
    expect(() => event({
      name: 'report_complete', screenId: 'consent-gate', taskId: 'report-flow', outcome: 'completed', assistance: 'none',
    })).not.toThrow();
  });
});

describe('categorical issue reports and aggregate output', () => {
  it('rejects free text and requires review before optional diagnostics', () => {
    const input = {
      category: 'accessibility' as const,
      screenId: 'consent-gate' as const,
      taskId: 'consent-review' as const,
      severity: 'high' as const,
      expectedBehavior: 'task_completes' as const,
      actualBehavior: 'control_unresponsive' as const,
    };
    expect(() => createIssueReport({
      input: { ...input, actualText: 'synthetic free text' } as never,
      issueId: '00000000-0000-4000-8000-000000000003',
    })).toThrow();
  });

  it('aggregates without leaking event, session, issue, or timing identifiers', () => {
    const start = event({ name: 'report_start', screenId: 'home', taskId: 'report-flow', outcome: 'started' });
    const complete = createMeasurementEvent({
      ...baseEvent,
      now: new Date('2026-07-30T10:02:31.000Z'),
      input: {
        name: 'report_complete', screenId: 'consent-gate', taskId: 'report-flow', outcome: 'completed', assistance: 'none',
      },
    });
    const issue = createIssueReport({
      input: {
        category: 'copy_clarity', screenId: 'consent-gate', taskId: 'consent-review', severity: 'medium',
        expectedBehavior: 'task_completes', actualBehavior: 'unclear_copy',
      },
      issueId: '00000000-0000-4000-8000-000000000003',
      now: new Date('2026-07-30T10:03:00.000Z'),
    });
    const aggregate = buildContentFreeAggregateReport([start, complete], [issue]);
    const serialized = JSON.stringify(aggregate);

    expect(aggregate).toMatchObject({
      reportStarts: 1,
      reportCompletions: 1,
      unassistedReportCompletions: 1,
      unassistedCompletionRate: 1,
      completionRate: 1,
      reportDropOffs: 0,
      medianTimeToReportMsBucket: 120_000,
    });
    expect(serialized).not.toMatch(/eventId|sessionId|issueId|recordedAtBucket|createdAtBucket|diagnostics/);
  });
});
