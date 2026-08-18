import { createHash } from 'node:crypto';

import { z } from 'zod';

export type RsiAggregateCellInput = {
  areaId: string;
  timeBucket: string;
  category: string;
  rawCount: number;
  previousRawCount?: number;
  triangulationGroup?: string;
  memoizedNoise?: { key: string; value: number };
};

export type RsiSuppressionPolicy = {
  releaseId: string;
  viewId: string;
  minimumCount: number;
  differentialPrivacy:
    | { status: 'not_approved' }
    | {
        status: 'approved';
        epsilon: number;
        delta: number;
        sensitivity: number;
        clipping: number;
        composition: string;
      };
};

export type PublicRsiCell = {
  areaId: string;
  timeBucket: string;
  category: string;
} & (
  | { state: 'suppressed'; display: 'No data' }
  | { state: 'released'; value: number; noiseMemoized: boolean }
);

export type RsiSuppressionDecision = {
  areaId: string;
  timeBucket: string;
  category: string;
  reasons: string[];
};

export type RsiRelease = {
  schemaVersion: '1.0';
  releaseId: string;
  viewId: string;
  state: 'released' | 'no_data';
  cells: PublicRsiCell[];
  revisionSha256: string;
};

export type BuiltRsiRelease = {
  release: RsiRelease;
  decisions: RsiSuppressionDecision[];
};

type WorkingCell = RsiAggregateCellInput & { suppressed: boolean; reasons: Set<string> };

function cellKey(cell: Pick<RsiAggregateCellInput, 'areaId' | 'timeBucket' | 'category'>): string {
  return `${cell.areaId}|${cell.timeBucket}|${cell.category}`;
}

function groupBy(cells: WorkingCell[], keyFor: (cell: WorkingCell) => string | null): WorkingCell[][] {
  const groups = new Map<string, WorkingCell[]>();
  for (const cell of cells) {
    const key = keyFor(cell);
    if (key === null) continue;
    groups.set(key, [...(groups.get(key) ?? []), cell]);
  }
  return [...groups.values()];
}

function applyComplementarySuppression(group: WorkingCell[], reason: string): boolean {
  if (group.length < 2 || group.filter(cell => cell.suppressed).length !== 1) return false;
  const complement = group
    .filter(cell => !cell.suppressed)
    .sort((a, b) => a.rawCount - b.rawCount || cellKey(a).localeCompare(cellKey(b)))[0];
  if (!complement) return false;
  complement.suppressed = true;
  complement.reasons.add(reason);
  return true;
}

function assertValidInputs(cells: RsiAggregateCellInput[], policy: RsiSuppressionPolicy): void {
  if (!Number.isInteger(policy.minimumCount) || policy.minimumCount < 2) {
    throw new Error('RSI minimum count is invalid');
  }
  if (policy.differentialPrivacy.status === 'approved') {
    const dp = policy.differentialPrivacy;
    if (
      !Number.isFinite(dp.epsilon) || dp.epsilon <= 0 ||
      !Number.isFinite(dp.delta) || dp.delta <= 0 || dp.delta >= 1 ||
      !Number.isFinite(dp.sensitivity) || dp.sensitivity <= 0 ||
      !Number.isFinite(dp.clipping) || dp.clipping <= 0 ||
      !dp.composition.trim()
    ) {
      throw new Error('Approved RSI differential-privacy parameters are invalid');
    }
  }
  const keys = new Set<string>();
  for (const cell of cells) {
    if (!Number.isInteger(cell.rawCount) || cell.rawCount < 0) throw new Error('RSI aggregate count is invalid');
    const parsedTime = new Date(cell.timeBucket);
    if (Number.isNaN(parsedTime.getTime())) throw new Error('RSI aggregate time bucket is invalid');
    const key = cellKey(cell);
    if (keys.has(key)) throw new Error('RSI aggregate cells contain duplicate dimensions');
    keys.add(key);
    if (cell.previousRawCount !== undefined && (!Number.isInteger(cell.previousRawCount) || cell.previousRawCount < 0)) {
      throw new Error('RSI previous aggregate count is invalid');
    }
    if (policy.differentialPrivacy.status === 'approved') {
      const expectedNoiseKey = `${policy.releaseId}|${key}`;
      if (!cell.memoizedNoise || cell.memoizedNoise.key !== expectedNoiseKey || !Number.isFinite(cell.memoizedNoise.value)) {
        throw new Error('Approved differential privacy requires memoized noise for every release cell');
      }
    } else if (cell.memoizedNoise) {
      throw new Error('Noise cannot be applied before differential-privacy approval');
    }
  }
}

export function buildSuppressedRsiRelease(
  inputs: RsiAggregateCellInput[],
  policy: RsiSuppressionPolicy,
): BuiltRsiRelease {
  assertValidInputs(inputs, policy);
  const cells: WorkingCell[] = inputs.map(input => {
    const reasons = new Set<string>();
    if (input.rawCount < policy.minimumCount) reasons.add('below_minimum_count');
    if (
      input.previousRawCount !== undefined &&
      Math.abs(input.rawCount - input.previousRawCount) < policy.minimumCount
    ) {
      reasons.add('adjacent_window_differencing');
    }
    return { ...input, suppressed: reasons.size > 0, reasons };
  });

  let changed = true;
  while (changed) {
    changed = false;
    const groupSets: Array<{ groups: WorkingCell[][]; reason: string }> = [
      {
        groups: groupBy(cells, cell => `${cell.timeBucket}|${cell.category}`),
        reason: 'complementary_area_suppression',
      },
      {
        groups: groupBy(cells, cell => `${cell.areaId}|${cell.timeBucket}`),
        reason: 'complementary_category_suppression',
      },
      {
        groups: groupBy(cells, cell => `${cell.areaId}|${cell.category}`),
        reason: 'complementary_time_suppression',
      },
      {
        groups: groupBy(cells, cell => cell.triangulationGroup
          ? `${cell.triangulationGroup}|${cell.timeBucket}|${cell.category}`
          : null),
        reason: 'corridor_triangulation_suppression',
      },
    ];
    for (const { groups, reason } of groupSets) {
      for (const group of groups) {
        if (applyComplementarySuppression(group, reason)) changed = true;
      }
    }
  }

  const publicCells: PublicRsiCell[] = cells
    .sort((a, b) => cellKey(a).localeCompare(cellKey(b)))
    .map(cell => {
      const dimensions = { areaId: cell.areaId, timeBucket: cell.timeBucket, category: cell.category };
      if (cell.suppressed) {
        return { ...dimensions, state: 'suppressed' as const, display: 'No data' as const };
      }
      const noise = policy.differentialPrivacy.status === 'approved' ? cell.memoizedNoise!.value : 0;
      const value = Math.max(1, Math.round(cell.rawCount + noise));
      return {
        ...dimensions,
        state: 'released' as const,
        value,
        noiseMemoized: policy.differentialPrivacy.status === 'approved',
      };
    });
  const releaseWithoutHash = {
    schemaVersion: '1.0' as const,
    releaseId: policy.releaseId,
    viewId: policy.viewId,
    state: publicCells.length === 0 || publicCells.every(cell => cell.state === 'suppressed')
      ? 'no_data' as const
      : 'released' as const,
    cells: publicCells,
  };
  return {
    release: {
      ...releaseWithoutHash,
      revisionSha256: createHash('sha256').update(JSON.stringify(releaseWithoutHash)).digest('hex'),
    },
    decisions: cells
      .filter(cell => cell.suppressed)
      .map(cell => ({
        areaId: cell.areaId,
        timeBucket: cell.timeBucket,
        category: cell.category,
        reasons: [...cell.reasons].sort(),
      })),
  };
}

export const rsiReleaseQuerySchema = z.object({
  releaseId: z.string().uuid(),
  viewId: z.literal('rsi-fixed-grid-v1'),
}).strict();

export function validateFixedRsiQuery(value: unknown): z.infer<typeof rsiReleaseQuerySchema> {
  return rsiReleaseQuerySchema.parse(value);
}
