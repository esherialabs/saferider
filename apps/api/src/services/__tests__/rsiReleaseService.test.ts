import { describe, expect, it } from 'vitest';

import { loadRsiControls, type RsiControls } from '../../config/rsiControls.js';
import { buildConfiguredRsiRelease } from '../rsiReleaseService.js';
import type { MinimizedRsiSignal } from '../rsiSignalService.js';

const releaseId = '11111111-1111-4111-8111-111111111111';

function approvedControls(): RsiControls {
  const controls = structuredClone(loadRsiControls());
  controls.activation.releaseGeneration = { status: 'enabled', reason: null };
  controls.approval = {
    status: 'approved', approvalId: 'synthetic-approval', approvedByRole: 'synthetic-reviewer',
    approvedAt: '2026-07-29T00:00:00.000Z', expiresAt: '2026-08-30T00:00:00.000Z', minimumCount: 10,
  };
  controls.fixedBuckets.areaDefinitionVersion = 'synthetic-area-v1';
  controls.fixedBuckets.allowedAreaIds = ['cell-100-100'];
  controls.consent.requiredVersion = 'synthetic-consent-v1';
  controls.rawSignalRetention = { status: 'approved', durationDays: 7 };
  return controls;
}

function signal(): MinimizedRsiSignal {
  return {
    areaId: 'cell-100-100', areaType: 'coarse_cell', areaDefinitionVersion: 'synthetic-area-v1',
    timeBucket: new Date('2026-07-30T10:00:00.000Z'), timeBucketMinutes: 60,
    category: 'harassment', configVersion: 'rsi-privacy-controls.2026-07-30.1', policyVersion: 'rsi-privacy-controls.2026-07-30.1',
    consentVersion: 'synthetic-consent-v1', expiresAt: new Date('2026-08-06T00:00:00.000Z'),
  };
}

function completePreviousCounts(controls: RsiControls, targetRawCount = 12) {
  const result: Array<{ areaId: string; timeBucket: string; category: string; rawCount: number }> = [];
  for (const areaId of controls.fixedBuckets.allowedAreaIds) {
    for (let hour = 0; hour < 24; hour += 1) {
      const timeBucket = new Date(Date.UTC(2026, 6, 29, hour)).toISOString();
      for (const category of controls.fixedBuckets.categories) {
        result.push({
          areaId,
          timeBucket,
          category,
          rawCount: hour === 10 && category === 'harassment' ? targetRawCount : 0,
        });
      }
    }
  }
  return result;
}

describe('configured RSI release generation', () => {
  it('stays disabled under the checked-in production controls', () => {
    expect(() => buildConfiguredRsiRelease({
      controls: loadRsiControls(), releaseId, signals: [],
      windowStart: new Date('2026-07-30'), windowEnd: new Date('2026-07-31'),
      adjacentWindowStatus: 'initial',
    })).toThrow(/not approved/);
  });

  it('uses the approved threshold and immutable release cadence', () => {
    const result = buildConfiguredRsiRelease({
      controls: approvedControls(), releaseId, signals: Array.from({ length: 12 }, signal),
      windowStart: new Date('2026-07-30'), windowEnd: new Date('2026-07-31'),
      adjacentWindowStatus: 'initial',
      now: new Date('2026-07-30T12:00:00.000Z'),
    });
    const targetInput = result.aggregateInputs.find(input =>
      input.timeBucket === '2026-07-30T10:00:00.000Z' && input.category === 'harassment');
    const targetCell = result.built.release.cells.find(cell =>
      cell.timeBucket === '2026-07-30T10:00:00.000Z' && cell.category === 'harassment');
    expect(result.aggregateInputs).toHaveLength(96);
    expect(targetInput).toMatchObject({ rawCount: 12 });
    expect(result.aggregateInputs.some(input => input.rawCount === 0)).toBe(true);
    expect(targetCell).toMatchObject({ state: 'released', value: 12, noiseMemoized: false });
    expect(result.built.release.revisionSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fails closed on a continuous window when any prior fixed-grid cell is absent', () => {
    expect(() => buildConfiguredRsiRelease({
      controls: approvedControls(), releaseId, signals: Array.from({ length: 12 }, signal),
      windowStart: new Date('2026-07-30'), windowEnd: new Date('2026-07-31'),
      adjacentWindowStatus: 'continuous', previousCounts: [],
      now: new Date('2026-07-30T12:00:00.000Z'),
    })).toThrow(/every adjacent fixed-grid/);
  });

  it('uses a complete adjacent fixed grid for differencing suppression', () => {
    const controls = approvedControls();
    const result = buildConfiguredRsiRelease({
      controls, releaseId, signals: Array.from({ length: 12 }, signal),
      windowStart: new Date('2026-07-30'), windowEnd: new Date('2026-07-31'),
      adjacentWindowStatus: 'continuous', previousCounts: completePreviousCounts(controls),
      now: new Date('2026-07-30T12:00:00.000Z'),
    });
    const targetInput = result.aggregateInputs.find(input =>
      input.timeBucket === '2026-07-30T10:00:00.000Z' && input.category === 'harassment');
    const targetCell = result.built.release.cells.find(cell =>
      cell.timeBucket === '2026-07-30T10:00:00.000Z' && cell.category === 'harassment');
    const targetDecision = result.built.decisions.find(decision =>
      decision.timeBucket === '2026-07-30T10:00:00.000Z' && decision.category === 'harassment');
    expect(targetInput).toMatchObject({ rawCount: 12, previousRawCount: 12 });
    expect(targetCell).toMatchObject({ state: 'suppressed', display: 'No data' });
    expect(targetDecision?.reasons).toContain('adjacent_window_differencing');
  });

  it('cannot generate approved-DP output without persisted memoized noise', () => {
    const controls = approvedControls();
    controls.differentialPrivacy = {
      status: 'approved', epsilon: 1, delta: 0.000001, sensitivity: 1, clipping: 1,
      composition: 'basic', releaseCadenceHours: 24, noiseMemoizationRequired: true,
    };
    expect(() => buildConfiguredRsiRelease({
      controls, releaseId, signals: Array.from({ length: 12 }, signal),
      windowStart: new Date('2026-07-30'), windowEnd: new Date('2026-07-31'),
      adjacentWindowStatus: 'initial',
      now: new Date('2026-07-30T12:00:00.000Z'),
    })).toThrow(/memoized noise/);
  });
});
