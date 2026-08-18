import { describe, expect, it, vi } from 'vitest';

import { DELETION_TARGET_CLASSES } from '../privacyLifecycle.js';
import { runServerRetention } from '../serverRetention.js';

const candidates = DELETION_TARGET_CLASSES.map((resourceClass, index) => ({
  resourceClass,
  resourceId: `opaque-${index}`,
  createdAt: '2026-01-01T00:00:00.000Z',
  policyId: 'synthetic-server-30',
}));

describe('server retention executor', () => {
  it('blocks before invoking handlers when policy approval is absent', async () => {
    const handler = vi.fn(async () => 'deleted' as const);
    const result = await runServerRetention({
      now: new Date('2026-07-30'), mode: 'enforce', candidates,
      policy: { policyId: 'synthetic-server-30', durationDays: 30, executionEnabled: false, approvalStatus: 'pending_legal' },
      handlers: DELETION_TARGET_CLASSES.map(targetClass => ({ targetClass, deleteByOpaqueId: handler })),
    });
    expect(result).toMatchObject({ status: 'blocked', blockedReason: 'retention_policy_not_approved' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('requires complete handler coverage before deletion', async () => {
    const handler = vi.fn(async () => 'deleted' as const);
    const result = await runServerRetention({
      now: new Date('2026-07-30'), mode: 'enforce', candidates,
      policy: { policyId: 'synthetic-server-30', durationDays: 30, executionEnabled: true, approvalStatus: 'approved_legal' },
      handlers: [{ targetClass: 'case_rows', deleteByOpaqueId: handler }],
    });
    expect(result).toMatchObject({ status: 'blocked', blockedReason: 'retention_target_handler_missing' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('dry-runs and enforces all required target classes without exposing opaque ids', async () => {
    const handlers = DELETION_TARGET_CLASSES.map(targetClass => ({ targetClass, deleteByOpaqueId: vi.fn(async () => 'deleted' as const) }));
    const policy = { policyId: 'synthetic-server-30', durationDays: 30, executionEnabled: true, approvalStatus: 'approved_legal' };
    const dryRun = await runServerRetention({ now: new Date('2026-07-30'), mode: 'dry-run', policy, candidates, handlers });
    expect(Object.values(dryRun.targetCounts).reduce((sum, value) => sum + value, 0)).toBe(DELETION_TARGET_CLASSES.length);
    expect(handlers.every(handler => handler.deleteByOpaqueId.mock.calls.length === 0)).toBe(true);
    const enforce = await runServerRetention({ now: new Date('2026-07-30'), mode: 'enforce', policy, candidates, handlers });
    expect(enforce.status).toBe('completed');
    expect(enforce.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(enforce)).not.toContain('opaque-');
  });
});
