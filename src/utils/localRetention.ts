import * as FileSystem from 'expo-file-system/legacy';

import { draftStorage, type DraftData } from './draftStorage';
import { getPrivacyRetentionPreference, type PrivacyRetentionPreference } from './retentionPolicy';

export type LocalRetentionPolicy = {
  policyId: PrivacyRetentionPreference;
  durationDays: number | null;
  approvalStatus: 'approved_engineering' | 'approved_legal' | 'pending_legal' | 'retired';
  executionEnabled: boolean;
};

export const LOCAL_RETENTION_POLICIES: Record<PrivacyRetentionPreference, LocalRetentionPolicy> = {
  'local-manual-v1': {
    policyId: 'local-manual-v1',
    durationDays: null,
    approvalStatus: 'approved_engineering',
    executionEnabled: true,
  },
  'local-30-days-v1': {
    policyId: 'local-30-days-v1',
    durationDays: 30,
    approvalStatus: 'pending_legal',
    executionEnabled: false,
  },
  'local-90-days-v1': {
    policyId: 'local-90-days-v1',
    durationDays: 90,
    approvalStatus: 'pending_legal',
    executionEnabled: false,
  },
};

export type LocalRetentionRunResult = {
  policyId: PrivacyRetentionPreference;
  mode: 'dry-run' | 'enforce';
  status: 'completed' | 'blocked' | 'partially_completed';
  blockedReason?: string;
  selectedDraftIds: string[];
  deletedDraftIds: string[];
  failures: Array<{ draftId: string; reason: string }>;
};

function isAppOwnedUri(uri: string): boolean {
  return Boolean(
    (FileSystem.documentDirectory && uri.startsWith(FileSystem.documentDirectory)) ||
    (FileSystem.cacheDirectory && uri.startsWith(FileSystem.cacheDirectory)),
  );
}

export function selectExpiredDrafts(drafts: DraftData[], policy: LocalRetentionPolicy, now: Date): DraftData[] {
  if (!policy.executionEnabled || !policy.approvalStatus.startsWith('approved_')) return [];
  if (policy.durationDays === null) return [];
  const cutoff = now.getTime() - policy.durationDays * 24 * 60 * 60 * 1000;
  return drafts.filter(draft => draft.updatedAt.getTime() <= cutoff);
}

export async function runLocalRetentionJob(options: {
  mode?: 'dry-run' | 'enforce';
  now?: Date;
  policyOverride?: LocalRetentionPolicy;
} = {}): Promise<LocalRetentionRunResult> {
  const mode = options.mode ?? 'dry-run';
  const policyId = await getPrivacyRetentionPreference();
  const policy = options.policyOverride ?? LOCAL_RETENTION_POLICIES[policyId];
  if (policy.policyId !== policyId) {
    return { policyId, mode, status: 'blocked', blockedReason: 'policy_identity_mismatch', selectedDraftIds: [], deletedDraftIds: [], failures: [] };
  }
  if (!policy.executionEnabled || !policy.approvalStatus.startsWith('approved_')) {
    return { policyId, mode, status: 'blocked', blockedReason: 'policy_not_approved', selectedDraftIds: [], deletedDraftIds: [], failures: [] };
  }

  const expired = selectExpiredDrafts(await draftStorage.getAllDrafts(), policy, options.now ?? new Date());
  const result: LocalRetentionRunResult = {
    policyId,
    mode,
    status: 'completed',
    selectedDraftIds: expired.map(draft => draft.id),
    deletedDraftIds: [],
    failures: [],
  };
  if (mode === 'dry-run') return result;

  for (const draft of expired) {
    try {
      for (const media of draft.mediaFiles ?? []) {
        if (media.uri && isAppOwnedUri(media.uri)) {
          await FileSystem.deleteAsync(media.uri, { idempotent: true });
        }
      }
      await draftStorage.deleteDraft(draft.id);
      result.deletedDraftIds.push(draft.id);
    } catch {
      result.failures.push({ draftId: draft.id, reason: 'local_delete_failed' });
    }
  }
  if (result.failures.length > 0) result.status = 'partially_completed';
  return result;
}
