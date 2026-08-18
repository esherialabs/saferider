import { describe, expect, it } from 'vitest';

import {
  buildSuppressedRsiRelease,
  type RsiAggregateCellInput,
  validateFixedRsiQuery,
} from '../privacySuppressionService.js';

const releaseId = '11111111-1111-4111-8111-111111111111';
const basePolicy = {
  releaseId,
  viewId: 'rsi-fixed-grid-v1',
  minimumCount: 10,
  differentialPrivacy: { status: 'not_approved' as const },
};

function cell(overrides: Partial<RsiAggregateCellInput> = {}): RsiAggregateCellInput {
  return {
    areaId: 'cell-100-100', timeBucket: '2026-07-30T10:00:00.000Z', category: 'harassment', rawCount: 12,
    ...overrides,
  };
}

describe('RSI suppression and differencing protection', () => {
  it('returns No data without a numeric zero or hidden count below threshold', () => {
    const { release } = buildSuppressedRsiRelease([cell({ rawCount: 4 })], basePolicy);
    expect(release.cells[0]).toEqual(expect.objectContaining({ state: 'suppressed', display: 'No data' }));
    expect(release.cells[0]).not.toHaveProperty('value');
    expect(JSON.stringify(release.cells[0])).not.toContain('"rawCount"');
  });

  it('adds complementary suppression across areas, categories, time buckets, and overlap groups', () => {
    const inputs = [
      cell({ areaId: 'cell-100-100', category: 'harassment', rawCount: 3, triangulationGroup: 'overlap-a' }),
      cell({ areaId: 'cell-100-101', category: 'harassment', rawCount: 20, triangulationGroup: 'overlap-a' }),
      cell({ areaId: 'cell-100-100', category: 'unsafe_driving', rawCount: 22, triangulationGroup: 'overlap-a' }),
      cell({ areaId: 'cell-100-100', category: 'harassment', timeBucket: '2026-07-30T11:00:00.000Z', rawCount: 24, triangulationGroup: 'overlap-a' }),
    ];
    const { release, decisions } = buildSuppressedRsiRelease(inputs, basePolicy);
    expect(release.cells.filter(item => item.state === 'suppressed').length).toBeGreaterThanOrEqual(2);
    expect(decisions.some(item => item.reasons.includes('complementary_area_suppression'))).toBe(true);
    expect(JSON.stringify(release)).not.toContain('below_minimum_count');
    expect(JSON.stringify(release)).not.toContain('complementary_');
    expect(release.cells.every(item => item.state === 'released' || !('value' in item))).toBe(true);
  });

  it('prevents category subtraction with complementary category suppression', () => {
    const { decisions } = buildSuppressedRsiRelease([
      cell({ category: 'harassment', rawCount: 3 }),
      cell({ category: 'unsafe_driving', rawCount: 24 }),
    ], basePolicy);
    expect(decisions.find(item => item.category === 'unsafe_driving')?.reasons).toContain(
      'complementary_category_suppression',
    );
  });

  it('prevents adjacent fixed-window subtraction with complementary time suppression', () => {
    const { decisions } = buildSuppressedRsiRelease([
      cell({ timeBucket: '2026-07-30T10:00:00.000Z', rawCount: 3 }),
      cell({ timeBucket: '2026-07-30T11:00:00.000Z', rawCount: 24 }),
    ], basePolicy);
    expect(decisions.find(item => item.timeBucket === '2026-07-30T11:00:00.000Z')?.reasons).toContain(
      'complementary_time_suppression',
    );
  });

  it('suppresses a triangulation complement even when the wider area group has multiple hidden cells', () => {
    const { decisions } = buildSuppressedRsiRelease([
      cell({ areaId: 'cell-100-099', rawCount: 2, triangulationGroup: 'outside' }),
      cell({ areaId: 'cell-100-100', rawCount: 3, triangulationGroup: 'overlap-a' }),
      cell({ areaId: 'corridor-synthetic-a', rawCount: 25, triangulationGroup: 'overlap-a' }),
    ], basePolicy);
    expect(decisions.find(item => item.areaId === 'corridor-synthetic-a')?.reasons).toContain(
      'corridor_triangulation_suppression',
    );
  });

  it('suppresses small adjacent-window changes even when both window counts exceed k', () => {
    const { release, decisions } = buildSuppressedRsiRelease([cell({ rawCount: 18, previousRawCount: 14 })], basePolicy);
    expect(release.cells[0]).toMatchObject({ state: 'suppressed', display: 'No data' });
    expect(decisions[0].reasons).toEqual(['adjacent_window_differencing']);
  });

  it('requires one memoized noise value per immutable release cell and is repeat-query stable', () => {
    const dpPolicy = {
      ...basePolicy,
      differentialPrivacy: { status: 'approved' as const, epsilon: 1, delta: 0.000001, sensitivity: 1, clipping: 1, composition: 'basic' },
    };
    expect(() => buildSuppressedRsiRelease([cell()], dpPolicy)).toThrow(/memoized noise/);
    const input = cell({ memoizedNoise: { key: `${releaseId}|cell-100-100|2026-07-30T10:00:00.000Z|harassment`, value: -1.25 } });
    const first = buildSuppressedRsiRelease([input], dpPolicy);
    const second = buildSuppressedRsiRelease([input], dpPolicy);
    expect(first).toEqual(second);
    expect(first.release.cells[0]).toMatchObject({ state: 'released', value: 11, noiseMemoized: true });
  });

  it('forbids arbitrary filters and combinations', () => {
    expect(validateFixedRsiQuery({ releaseId, viewId: 'rsi-fixed-grid-v1' })).toBeTruthy();
    expect(() => validateFixedRsiQuery({ releaseId, viewId: 'rsi-fixed-grid-v1', category: 'harassment' })).toThrow();
    expect(() => validateFixedRsiQuery({ releaseId, viewId: 'rsi-fixed-grid-v1', start: '2026-07-30' })).toThrow();
  });

  it('maintains every complementary invariant across deterministic synthetic matrices', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const inputs: RsiAggregateCellInput[] = [];
      for (let area = 0; area < 3; area += 1) {
        for (let category = 0; category < 3; category += 1) {
          for (let time = 0; time < 2; time += 1) {
            inputs.push(cell({
              areaId: `cell-100-${100 + area}`,
              category: `category_${category}`,
              timeBucket: `2026-07-30T${10 + time}:00:00.000Z`,
              triangulationGroup: area < 2 ? 'overlap-a' : 'overlap-b',
              rawCount: (seed * (area + 2) * (category + 3) * (time + 2)) % 24,
            }));
          }
        }
      }
      const { release } = buildSuppressedRsiRelease(inputs, basePolicy);
      const releasedByKey = new Map(release.cells.map(item => [`${item.areaId}|${item.timeBucket}|${item.category}`, item]));
      const groupings = [
        (input: RsiAggregateCellInput) => `area|${input.timeBucket}|${input.category}`,
        (input: RsiAggregateCellInput) => `category|${input.areaId}|${input.timeBucket}`,
        (input: RsiAggregateCellInput) => `time|${input.areaId}|${input.category}`,
        (input: RsiAggregateCellInput) => `triangulation|${input.triangulationGroup}|${input.timeBucket}|${input.category}`,
      ];
      for (const groupKey of groupings) {
        const groups = new Map<string, RsiAggregateCellInput[]>();
        for (const input of inputs) groups.set(groupKey(input), [...(groups.get(groupKey(input)) ?? []), input]);
        for (const group of groups.values()) {
          if (group.length < 2) continue;
          const suppressed = group.filter(input =>
            releasedByKey.get(`${input.areaId}|${input.timeBucket}|${input.category}`)?.state === 'suppressed');
          expect(suppressed.length).not.toBe(1);
        }
      }
    }
  });
});
