import { createHash } from 'node:crypto';

import {
  DELETION_TARGET_CLASSES,
  type DeletionTargetClass,
  planRetentionRun,
  type RetentionCandidate,
} from './privacyLifecycle.js';

export type RetentionTargetHandler = {
  targetClass: DeletionTargetClass;
  deleteByOpaqueId: (opaqueId: string) => Promise<'deleted' | 'not_found'>;
};

export type ServerRetentionRun = {
  schemaVersion: '1.0';
  policyId: string;
  mode: 'dry-run' | 'enforce';
  status: 'blocked' | 'completed' | 'partially_completed';
  blockedReason?: string;
  targetCounts: Record<DeletionTargetClass, number>;
  deletedCounts: Record<DeletionTargetClass, number>;
  failedCounts: Record<DeletionTargetClass, number>;
  evidenceSha256: string;
};

function emptyCounts(): Record<DeletionTargetClass, number> {
  return Object.fromEntries(DELETION_TARGET_CLASSES.map(target => [target, 0])) as Record<DeletionTargetClass, number>;
}

export async function runServerRetention(params: {
  now: Date;
  mode: 'dry-run' | 'enforce';
  policy: { policyId: string; durationDays: number | null; executionEnabled: boolean; approvalStatus: string };
  candidates: RetentionCandidate[];
  handlers: RetentionTargetHandler[];
}): Promise<ServerRetentionRun> {
  const targetCounts = emptyCounts();
  const deletedCounts = emptyCounts();
  const failedCounts = emptyCounts();
  const plan = planRetentionRun({ now: params.now, policy: params.policy, candidates: params.candidates });
  const handlerMap = new Map(params.handlers.map(handler => [handler.targetClass, handler]));
  const missingHandlers = DELETION_TARGET_CLASSES.filter(target => !handlerMap.has(target));

  let status: ServerRetentionRun['status'] = 'completed';
  let blockedReason: string | undefined;
  if (!plan.executable) {
    status = 'blocked';
    blockedReason = plan.blockedReason;
  } else if (missingHandlers.length > 0) {
    status = 'blocked';
    blockedReason = 'retention_target_handler_missing';
  }

  for (const candidate of plan.targets) targetCounts[candidate.resourceClass] += 1;
  if (status !== 'blocked' && params.mode === 'enforce') {
    for (const candidate of plan.targets) {
      try {
        const result = await handlerMap.get(candidate.resourceClass)!.deleteByOpaqueId(candidate.resourceId);
        if (result === 'deleted' || result === 'not_found') deletedCounts[candidate.resourceClass] += 1;
      } catch {
        failedCounts[candidate.resourceClass] += 1;
        status = 'partially_completed';
      }
    }
  }

  const evidence = {
    schemaVersion: '1.0' as const,
    policyId: params.policy.policyId,
    mode: params.mode,
    status,
    ...(blockedReason ? { blockedReason } : {}),
    targetCounts,
    deletedCounts,
    failedCounts,
  };
  return {
    ...evidence,
    evidenceSha256: createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),
  };
}
