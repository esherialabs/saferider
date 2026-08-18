import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeApprovedRsiRetention } from '../rsiRetentionService.js';

const state = vi.hoisted(() => ({ rsiEnabled: false, privacyEnabled: false }));
const repository = vi.hoisted(() => ({ deleteExpiredAnonymousRsiSignals: vi.fn() }));
const audit = vi.hoisted(() => ({ auditEvent: vi.fn() }));

vi.mock('../../config/rsiControls.js', () => ({
  getRsiCapabilityDecision: vi.fn(() => state.rsiEnabled
    ? {
        enabled: true,
        controls: {
          controlVersion: 'synthetic-control-v1',
          rawSignalRetention: { status: 'approved', durationDays: 7 },
        },
      }
    : { enabled: false, reason: 'pending_legal_retention_approval' }),
}));
vi.mock('../../config/privacyControls.js', () => ({
  isPrivacyCapabilityEnabled: vi.fn(() => state.privacyEnabled),
}));
vi.mock('../../repositories/rsiRepository.js', () => repository);
vi.mock('../auditService.js', () => audit);

describe('RSI raw-signal retention execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.rsiEnabled = false;
    state.privacyEnabled = false;
    repository.deleteExpiredAnonymousRsiSignals.mockResolvedValue(3);
  });

  it('fails before deletion while either RSI or legal retention approval is absent', async () => {
    await expect(executeApprovedRsiRetention()).rejects.toThrow(/disabled/);
    state.rsiEnabled = true;
    await expect(executeApprovedRsiRetention()).rejects.toThrow(/legal retention/);
    expect(repository.deleteExpiredAnonymousRsiSignals).not.toHaveBeenCalled();
  });

  it('deletes only expired minimized rows and records a content-free audit after both gates pass', async () => {
    state.rsiEnabled = true;
    state.privacyEnabled = true;
    const now = new Date('2026-08-07T00:00:00.000Z');
    await expect(executeApprovedRsiRetention(now)).resolves.toEqual({ deletedCount: 3 });
    expect(repository.deleteExpiredAnonymousRsiSignals).toHaveBeenCalledWith(now);
    expect(audit.auditEvent).toHaveBeenCalledWith({
      action: 'rsi.signal.retention.delete', resourceClass: 'anonymous_aggregate_signal',
      outcome: 'success', policyVersion: 'synthetic-control-v1',
    });
  });
});
