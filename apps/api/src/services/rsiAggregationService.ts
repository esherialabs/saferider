import type { MinimizedRsiSignal } from './rsiSignalService.js';
import type { RsiAggregateCellInput } from './privacySuppressionService.js';

type PreviousCount = { areaId: string; timeBucket: string; category: string; rawCount: number };

function keyOf(value: { areaId: string; timeBucket: string; category: string }): string {
  return `${value.areaId}|${value.timeBucket}|${value.category}`;
}

export function aggregateRsiSignals(params: {
  signals: MinimizedRsiSignal[];
  windowStart: Date;
  windowEnd: Date;
  releaseCadenceHours: number;
  timeBucketMinutes: number;
  areaIds: string[];
  categories: string[];
  maxCells: number;
  adjacentWindowStatus: 'initial' | 'continuous';
  previousCounts?: PreviousCount[];
  triangulationGroups?: Record<string, string>;
}): RsiAggregateCellInput[] {
  const durationMs = params.windowEnd.getTime() - params.windowStart.getTime();
  const bucketMs = params.timeBucketMinutes * 60 * 1000;
  if (
    !Number.isInteger(params.releaseCadenceHours) ||
    params.releaseCadenceHours <= 0 ||
    durationMs !== params.releaseCadenceHours * 60 * 60 * 1000 ||
    params.windowStart.getTime() >= params.windowEnd.getTime() ||
    params.windowStart.getTime() % durationMs !== 0 ||
    !Number.isInteger(params.timeBucketMinutes) ||
    params.timeBucketMinutes <= 0 ||
    durationMs % bucketMs !== 0
  ) {
    throw new Error('RSI release window is not aligned to the fixed cadence');
  }
  if (
    params.areaIds.length === 0 ||
    params.categories.length === 0 ||
    new Set(params.areaIds).size !== params.areaIds.length ||
    new Set(params.categories).size !== params.categories.length
  ) {
    throw new Error('RSI fixed release grid is empty or contains duplicate dimensions');
  }
  const timeBucketCount = durationMs / bucketMs;
  const gridCellCount = params.areaIds.length * params.categories.length * timeBucketCount;
  if (
    !Number.isSafeInteger(params.maxCells) ||
    params.maxCells < 1 ||
    !Number.isSafeInteger(gridCellCount) ||
    gridCellCount < 1 ||
    gridCellCount > params.maxCells
  ) {
    throw new Error('RSI fixed release grid exceeds the approved public row bound');
  }
  if (params.adjacentWindowStatus === 'continuous' && !params.previousCounts) {
    throw new Error('Continuous RSI release requires the complete adjacent-window counts');
  }
  if (params.adjacentWindowStatus === 'initial' && (params.previousCounts?.length ?? 0) > 0) {
    throw new Error('Initial RSI release cannot claim adjacent-window counts');
  }

  const counts = new Map<string, RsiAggregateCellInput>();
  for (const areaId of params.areaIds) {
    for (let bucket = 0; bucket < timeBucketCount; bucket += 1) {
      const timeBucket = new Date(params.windowStart.getTime() + bucket * bucketMs).toISOString();
      for (const category of params.categories) {
        const cell = {
          areaId,
          timeBucket,
          category,
          rawCount: 0,
          triangulationGroup: params.triangulationGroups?.[areaId],
        };
        counts.set(keyOf(cell), cell);
      }
    }
  }
  for (const signal of params.signals) {
    if (signal.timeBucket < params.windowStart || signal.timeBucket >= params.windowEnd) {
      throw new Error('RSI signal falls outside the fixed release window');
    }
    const timeBucket = signal.timeBucket.toISOString();
    const key = keyOf({ areaId: signal.areaId, timeBucket, category: signal.category });
    const current = counts.get(key);
    if (!current || signal.timeBucketMinutes !== params.timeBucketMinutes) {
      throw new Error('RSI signal falls outside the approved fixed release grid');
    }
    current.rawCount += 1;
  }

  const previous = new Map<string, number>();
  const expectedPreviousKeys = new Set(
    [...counts.values()].map(cell => keyOf({
      areaId: cell.areaId,
      timeBucket: new Date(new Date(cell.timeBucket).getTime() - durationMs).toISOString(),
      category: cell.category,
    })),
  );
  for (const item of params.previousCounts ?? []) {
    if (!Number.isInteger(item.rawCount) || item.rawCount < 0) throw new Error('RSI previous aggregate count is invalid');
    const previousTime = new Date(item.timeBucket);
    if (
      Number.isNaN(previousTime.getTime()) ||
      previousTime < new Date(params.windowStart.getTime() - durationMs) ||
      previousTime >= params.windowStart
    ) {
      throw new Error('RSI previous aggregate count is outside the adjacent fixed window');
    }
    const key = keyOf({ ...item, timeBucket: previousTime.toISOString() });
    if (!expectedPreviousKeys.has(key)) {
      throw new Error('RSI previous aggregate count is outside the approved fixed release grid');
    }
    if (previous.has(key)) throw new Error('RSI previous aggregate cells contain duplicate dimensions');
    previous.set(key, item.rawCount);
  }
  if (params.adjacentWindowStatus === 'continuous' && previous.size !== expectedPreviousKeys.size) {
    throw new Error('Continuous RSI release requires every adjacent fixed-grid count');
  }
  return [...counts.values()].map(cell => ({
    ...cell,
    previousRawCount: params.adjacentWindowStatus === 'continuous'
      ? previous.get(keyOf({
          areaId: cell.areaId,
          timeBucket: new Date(new Date(cell.timeBucket).getTime() - durationMs).toISOString(),
          category: cell.category,
        }))!
      : undefined,
  }));
}
