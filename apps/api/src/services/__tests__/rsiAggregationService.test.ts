import { describe, expect, it } from 'vitest';

import { aggregateRsiSignals } from '../rsiAggregationService.js';
import type { MinimizedRsiSignal } from '../rsiSignalService.js';

function signal(overrides: Partial<MinimizedRsiSignal> = {}): MinimizedRsiSignal {
  return {
    areaId: 'cell-100-100', areaType: 'coarse_cell', areaDefinitionVersion: 'synthetic-v1',
    timeBucket: new Date('2026-07-30T10:00:00.000Z'), timeBucketMinutes: 60,
    category: 'harassment', configVersion: 'synthetic', policyVersion: 'synthetic',
    consentVersion: 'synthetic-consent', expiresAt: new Date('2026-08-06T12:00:00.000Z'),
    ...overrides,
  };
}

const fixedGrid = {
  timeBucketMinutes: 60,
  areaIds: ['cell-100-100', 'cell-100-101'],
  categories: ['harassment'],
  maxCells: 10,
};

describe('fixed RSI aggregation', () => {
  it('materializes the complete fixed grid, including zero-count cells', () => {
    const cells = aggregateRsiSignals({
      signals: [signal(), signal()],
      windowStart: new Date('2026-07-30T10:00:00.000Z'),
      windowEnd: new Date('2026-07-30T11:00:00.000Z'),
      releaseCadenceHours: 1,
      ...fixedGrid,
      adjacentWindowStatus: 'continuous',
      previousCounts: [
        { areaId: 'cell-100-100', timeBucket: '2026-07-30T09:00:00.000Z', category: 'harassment', rawCount: 1 },
        { areaId: 'cell-100-101', timeBucket: '2026-07-30T09:00:00.000Z', category: 'harassment', rawCount: 0 },
      ],
    });
    expect(cells).toEqual([
      expect.objectContaining({ areaId: 'cell-100-100', rawCount: 2, previousRawCount: 1 }),
      expect.objectContaining({ areaId: 'cell-100-101', rawCount: 0, previousRawCount: 0 }),
    ]);
  });

  it('rejects off-cadence windows and out-of-window signals', () => {
    expect(() => aggregateRsiSignals({
      signals: [], windowStart: new Date('2026-07-30'), windowEnd: new Date('2026-07-30T12:00:00Z'),
      releaseCadenceHours: 24, ...fixedGrid, adjacentWindowStatus: 'initial',
    })).toThrow(/cadence/);
    expect(() => aggregateRsiSignals({
      signals: [signal({ timeBucket: new Date('2026-07-29T23:00:00Z') })],
      windowStart: new Date('2026-07-30'), windowEnd: new Date('2026-07-31'),
      releaseCadenceHours: 24, ...fixedGrid, maxCells: 100, adjacentWindowStatus: 'initial',
    })).toThrow(/outside/);
    expect(() => aggregateRsiSignals({
      signals: [], windowStart: new Date('2026-07-30T01:00:00Z'), windowEnd: new Date('2026-07-31T01:00:00Z'),
      releaseCadenceHours: 24, ...fixedGrid, maxCells: 100, adjacentWindowStatus: 'initial',
    })).toThrow(/aligned/);
  });

  it('rejects a continuous window unless every prior fixed-grid cell is present', () => {
    expect(() => aggregateRsiSignals({
      signals: [signal()], windowStart: new Date('2026-07-30T10:00:00Z'), windowEnd: new Date('2026-07-30T11:00:00Z'),
      releaseCadenceHours: 1, ...fixedGrid, adjacentWindowStatus: 'continuous',
    })).toThrow(/complete adjacent-window/);
    expect(() => aggregateRsiSignals({
      signals: [signal()], windowStart: new Date('2026-07-30T10:00:00Z'), windowEnd: new Date('2026-07-30T11:00:00Z'),
      releaseCadenceHours: 1, ...fixedGrid, adjacentWindowStatus: 'continuous', previousCounts: [],
    })).toThrow(/every adjacent fixed-grid/);
  });

  it('rejects a configured fixed grid that exceeds the public row limit', () => {
    expect(() => aggregateRsiSignals({
      signals: [], windowStart: new Date('2026-07-30T10:00:00Z'), windowEnd: new Date('2026-07-30T11:00:00Z'),
      releaseCadenceHours: 1, ...fixedGrid, maxCells: 1, adjacentWindowStatus: 'initial',
    })).toThrow(/row bound/);
  });
});
