import {
  buildDeletionReceipt,
  DELETION_TARGET_CLASSES,
  type DeletionStatus,
  type DeletionTargetClass,
  type DeletionTargetResult,
} from './privacyLifecycle.js';

export type DeletionTargetHandler = {
  targetClass: DeletionTargetClass;
  deleteByRequestId: (
    requestId: string,
  ) => Promise<'deleted' | 'not_found' | 'legal_hold'>;
};

export type DeletionExecutionResult = ReturnType<typeof buildDeletionReceipt> & {
  targetResults: DeletionTargetResult[];
};

const EXECUTABLE_STATUSES = new Set<DeletionStatus>([
  'verified',
  'executing',
  'partially_completed',
  'failed',
]);

/**
 * Runs only after a caller has persisted identity verification and legal
 * authorization. Handlers receive an opaque rights-request ID, must resolve
 * their own target set, and must treat repeat deletion as not_found. No
 * content or deleted identifiers are returned in the receipt.
 */
export async function runDeletionWorkflow(params: {
  requestId: string;
  currentStatus: DeletionStatus;
  policyVersion: string;
  handlers: DeletionTargetHandler[];
  previousResults?: DeletionTargetResult[];
  now?: Date;
}): Promise<DeletionExecutionResult> {
  if (!EXECUTABLE_STATUSES.has(params.currentStatus)) {
    throw new Error('Deletion request is not verified for execution');
  }

  const handlerMap = new Map(params.handlers.map(handler => [handler.targetClass, handler]));
  if (handlerMap.size !== params.handlers.length) {
    throw new Error('Deletion target handlers contain duplicates');
  }
  const missing = DELETION_TARGET_CLASSES.filter(targetClass => !handlerMap.has(targetClass));
  if (missing.length > 0) {
    throw new Error('Deletion target handler coverage is incomplete');
  }

  const prior = new Map((params.previousResults ?? []).map(result => [result.targetClass, result.status]));
  const targetResults: DeletionTargetResult[] = [];
  for (const targetClass of DELETION_TARGET_CLASSES) {
    const priorStatus = prior.get(targetClass);
    if (priorStatus === 'deleted' || priorStatus === 'not_found' || priorStatus === 'legal_hold') {
      targetResults.push({ targetClass, status: priorStatus });
      continue;
    }

    try {
      const status = await handlerMap.get(targetClass)!.deleteByRequestId(params.requestId);
      targetResults.push({ targetClass, status });
    } catch {
      targetResults.push({ targetClass, status: 'failed' });
    }
  }

  const receipt = buildDeletionReceipt({
    requestId: params.requestId,
    completedAt: (params.now ?? new Date()).toISOString(),
    policyVersion: params.policyVersion,
    targetResults,
  });
  return { ...receipt, targetResults };
}
