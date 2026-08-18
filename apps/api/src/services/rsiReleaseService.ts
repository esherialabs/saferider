import { parseRsiControls, type RsiControls } from '../config/rsiControls.js';
import { aggregateRsiSignals } from './rsiAggregationService.js';
import {
  buildSuppressedRsiRelease,
  type BuiltRsiRelease,
  type RsiAggregateCellInput,
  type RsiSuppressionPolicy,
} from './privacySuppressionService.js';
import type { MinimizedRsiSignal } from './rsiSignalService.js';

export function buildConfiguredRsiRelease(params: {
  controls: RsiControls;
  releaseId: string;
  signals: MinimizedRsiSignal[];
  windowStart: Date;
  windowEnd: Date;
  adjacentWindowStatus: 'initial' | 'continuous';
  previousCounts?: Array<{ areaId: string; timeBucket: string; category: string; rawCount: number }>;
  triangulationGroups?: Record<string, string>;
  memoizedNoise?: Record<string, number>;
  now?: Date;
}): { built: BuiltRsiRelease; aggregateInputs: RsiAggregateCellInput[] } {
  const controls = parseRsiControls(params.controls);
  const now = params.now ?? new Date();
  if (
    controls.activation.releaseGeneration.status !== 'enabled' ||
    controls.approval.status !== 'approved' ||
    !controls.approval.approvalId ||
    !controls.approval.minimumCount ||
    !controls.approval.expiresAt ||
    new Date(controls.approval.expiresAt).getTime() <= now.getTime()
  ) {
    throw new Error('RSI release generation is not approved');
  }
  for (const signal of params.signals) {
    if (
      signal.configVersion !== controls.controlVersion ||
      signal.policyVersion !== controls.controlVersion ||
      signal.areaDefinitionVersion !== controls.fixedBuckets.areaDefinitionVersion ||
      !controls.fixedBuckets.allowedAreaIds.includes(signal.areaId) ||
      !controls.fixedBuckets.categories.includes(signal.category) ||
      signal.timeBucketMinutes !== controls.fixedBuckets.timeBucketMinutes ||
      signal.expiresAt.getTime() <= now.getTime()
    ) {
      throw new Error('RSI release contains a stale or unapproved minimized signal');
    }
  }
  const aggregateInputs = aggregateRsiSignals({
    signals: params.signals,
    windowStart: params.windowStart,
    windowEnd: params.windowEnd,
    releaseCadenceHours: controls.fixedBuckets.releaseCadenceHours,
    timeBucketMinutes: controls.fixedBuckets.timeBucketMinutes,
    areaIds: controls.fixedBuckets.allowedAreaIds,
    categories: controls.fixedBuckets.categories,
    maxCells: controls.queryPolicy.maxRows,
    adjacentWindowStatus: params.adjacentWindowStatus,
    previousCounts: params.previousCounts,
    triangulationGroups: params.triangulationGroups,
  });
  const dp = controls.differentialPrivacy;
  const policy: RsiSuppressionPolicy = {
    releaseId: params.releaseId,
    viewId: controls.queryPolicy.viewId,
    minimumCount: controls.approval.minimumCount,
    differentialPrivacy: dp.status === 'approved'
      ? {
          status: 'approved',
          epsilon: dp.epsilon!,
          delta: dp.delta!,
          sensitivity: dp.sensitivity!,
          clipping: dp.clipping!,
          composition: dp.composition!,
        }
      : { status: 'not_approved' },
  };
  const inputsWithNoise = aggregateInputs.map(input => {
    if (dp.status !== 'approved') return input;
    const key = `${params.releaseId}|${input.areaId}|${input.timeBucket}|${input.category}`;
    const value = params.memoizedNoise?.[key];
    return { ...input, memoizedNoise: value === undefined ? undefined : { key, value } };
  });
  return {
    built: buildSuppressedRsiRelease(inputsWithNoise, policy),
    aggregateInputs: inputsWithNoise,
  };
}
