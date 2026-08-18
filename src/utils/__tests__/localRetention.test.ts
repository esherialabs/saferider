import { beforeEach, describe, expect, it, vi } from 'vitest';

const fileSystem = vi.hoisted(() => ({
  documentDirectory: 'file:///docs/',
  cacheDirectory: 'file:///cache/',
  deleteAsync: vi.fn(async () => undefined),
}));

vi.mock('expo-file-system/legacy', () => fileSystem);

import { encryptedAsyncStorage } from '../../lib/encryptedAsyncStorage';
import { draftStorage } from '../draftStorage';
import { runLocalRetentionJob, selectExpiredDrafts } from '../localRetention';
import { PRIVACY_RETENTION_POLICY_KEY } from '../storageKeys';

describe('local retention enforcement', () => {
  beforeEach(async () => {
    await draftStorage.clearAll();
  });

  it('does nothing under the approved manual policy', async () => {
    await draftStorage.saveDraft({ id: 'draft-recent', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') });
    const result = await runLocalRetentionJob({ mode: 'enforce', now: new Date('2026-07-30') });
    expect(result).toMatchObject({ policyId: 'local-manual-v1', status: 'completed', selectedDraftIds: [], deletedDraftIds: [] });
    expect(await draftStorage.getDraft('draft-recent')).not.toBeNull();
  });

  it('blocks a selected automatic policy while legal approval is pending', async () => {
    await encryptedAsyncStorage.setItem(PRIVACY_RETENTION_POLICY_KEY, 'local-30-days-v1');
    expect(await runLocalRetentionJob()).toMatchObject({ status: 'blocked', blockedReason: 'policy_not_approved' });
  });

  it('supports dry-run then enforcement only with an injected approved policy', async () => {
    await encryptedAsyncStorage.setItem(PRIVACY_RETENTION_POLICY_KEY, 'local-30-days-v1');
    await draftStorage.saveDraft({
      id: 'draft-expired', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
      mediaFiles: [{ id: 'media', type: 'photo', uri: 'file:///docs/synthetic.jpg', fileName: 'synthetic.jpg', size: 1, timestamp: new Date('2026-01-01') }],
    });
    const policyOverride = { policyId: 'local-30-days-v1' as const, durationDays: 30, approvalStatus: 'approved_legal' as const, executionEnabled: true };
    expect(await runLocalRetentionJob({ mode: 'dry-run', now: new Date('2030-07-30'), policyOverride })).toMatchObject({ selectedDraftIds: ['draft-expired'], deletedDraftIds: [] });
    expect(await draftStorage.getDraft('draft-expired')).not.toBeNull();
    expect(await runLocalRetentionJob({ mode: 'enforce', now: new Date('2030-07-30'), policyOverride })).toMatchObject({ status: 'completed', deletedDraftIds: ['draft-expired'] });
    expect(fileSystem.deleteAsync).toHaveBeenCalledWith('file:///docs/synthetic.jpg', { idempotent: true });
    expect(await draftStorage.getDraft('draft-expired')).toBeNull();
  });

  it('fails closed on a mismatched override and covers manual and pending selection', async () => {
    await encryptedAsyncStorage.setItem(PRIVACY_RETENTION_POLICY_KEY, 'local-30-days-v1');
    expect(await runLocalRetentionJob({
      policyOverride: {
        policyId: 'local-90-days-v1',
        durationDays: 90,
        approvalStatus: 'approved_legal',
        executionEnabled: true,
      },
    })).toMatchObject({ status: 'blocked', blockedReason: 'policy_identity_mismatch' });

    const draft = { id: 'synthetic', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') };
    expect(selectExpiredDrafts([draft], {
      policyId: 'local-30-days-v1',
      durationDays: 30,
      approvalStatus: 'pending_legal',
      executionEnabled: true,
    }, new Date('2026-07-30'))).toEqual([]);
    expect(selectExpiredDrafts([draft], {
      policyId: 'local-manual-v1',
      durationDays: null,
      approvalStatus: 'approved_engineering',
      executionEnabled: true,
    }, new Date('2026-07-30'))).toEqual([]);
  });

  it('deletes only app-owned media and reports a retryable partial failure', async () => {
    await encryptedAsyncStorage.setItem(PRIVACY_RETENTION_POLICY_KEY, 'local-30-days-v1');
    await draftStorage.saveDraft({
      id: 'draft-failure',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      mediaFiles: [
        { id: 'cache', type: 'photo', uri: 'file:///cache/synthetic.jpg', fileName: 'cache.jpg', size: 1, timestamp: new Date('2026-01-01') },
        { id: 'external', type: 'photo', uri: 'content://synthetic/external', fileName: 'external.jpg', size: 1, timestamp: new Date('2026-01-01') },
      ],
    });
    const deleteSpy = vi.spyOn(draftStorage, 'deleteDraft').mockRejectedValueOnce(new Error('synthetic deletion failure'));
    const result = await runLocalRetentionJob({
      mode: 'enforce',
      now: new Date('2030-07-30'),
      policyOverride: { policyId: 'local-30-days-v1', durationDays: 30, approvalStatus: 'approved_legal', executionEnabled: true },
    });
    expect(result).toMatchObject({
      status: 'partially_completed',
      deletedDraftIds: [],
      failures: [{ draftId: 'draft-failure', reason: 'local_delete_failed' }],
    });
    expect(fileSystem.deleteAsync).toHaveBeenCalledWith('file:///cache/synthetic.jpg', { idempotent: true });
    expect(fileSystem.deleteAsync).not.toHaveBeenCalledWith('content://synthetic/external', expect.anything());
    deleteSpy.mockRestore();
  });
});
