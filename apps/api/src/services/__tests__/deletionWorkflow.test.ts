import { describe, expect, it, vi } from 'vitest';

import { DELETION_TARGET_CLASSES, type DeletionTargetResult } from '../privacyLifecycle.js';
import { runDeletionWorkflow, type DeletionTargetHandler } from '../deletionWorkflow.js';

function handlers(result: 'deleted' | 'not_found' | 'legal_hold' = 'deleted'): DeletionTargetHandler[] {
  return DELETION_TARGET_CLASSES.map(targetClass => ({
    targetClass,
    deleteByRequestId: vi.fn(async () => result),
  }));
}

describe('deletion workflow executor', () => {
  it('requires verification and complete non-duplicated handler coverage before mutation', async () => {
    const completeHandlers = handlers();
    await expect(runDeletionWorkflow({
      requestId: 'request-1', currentStatus: 'requested', policyVersion: 'policy-1', handlers: completeHandlers,
    })).rejects.toThrow('not verified');
    expect(completeHandlers.every(handler => vi.mocked(handler.deleteByRequestId).mock.calls.length === 0)).toBe(true);

    await expect(runDeletionWorkflow({
      requestId: 'request-1', currentStatus: 'verified', policyVersion: 'policy-1', handlers: completeHandlers.slice(1),
    })).rejects.toThrow('coverage is incomplete');
    expect(completeHandlers.every(handler => vi.mocked(handler.deleteByRequestId).mock.calls.length === 0)).toBe(true);
  });

  it('deletes every target class and returns only a sanitized hash-bound receipt', async () => {
    const result = await runDeletionWorkflow({
      requestId: 'request-1', currentStatus: 'verified', policyVersion: 'policy-1', handlers: handlers(),
      now: new Date('2026-07-30T00:00:00.000Z'),
    });
    expect(result.status).toBe('completed');
    expect(result.targetResults).toHaveLength(DELETION_TARGET_CLASSES.length);
    expect(result.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result.receipt)).not.toContain('survivor');
  });

  it('is retry-safe: completed targets are not called again and failed targets can resume', async () => {
    const retryHandlers = handlers('not_found');
    const failedTarget = DELETION_TARGET_CLASSES[2];
    const previousResults: DeletionTargetResult[] = DELETION_TARGET_CLASSES.map(targetClass => ({
      targetClass,
      status: targetClass === failedTarget ? 'failed' : 'deleted',
    }));
    const result = await runDeletionWorkflow({
      requestId: 'request-1', currentStatus: 'partially_completed', policyVersion: 'policy-1',
      handlers: retryHandlers, previousResults,
    });
    expect(result.status).toBe('completed');
    for (const handler of retryHandlers) {
      expect(handler.deleteByRequestId).toHaveBeenCalledTimes(handler.targetClass === failedTarget ? 1 : 0);
    }
  });

  it('preserves a legal hold as a fail-closed terminal result', async () => {
    const legalHoldHandlers = handlers('deleted');
    vi.mocked(legalHoldHandlers[0].deleteByRequestId).mockResolvedValueOnce('legal_hold');
    const result = await runDeletionWorkflow({
      requestId: 'request-1', currentStatus: 'verified', policyVersion: 'policy-1', handlers: legalHoldHandlers,
    });
    expect(result.status).toBe('legal_hold');
  });
});
