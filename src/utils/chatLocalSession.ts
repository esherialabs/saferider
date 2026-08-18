import { encryptedAsyncStorage } from '../lib/encryptedAsyncStorage';
import { devPrivacyInfo, devPrivacyWarn, getPrivacySafeErrorReason } from './privacyLog';

export const LOCAL_CHAT_SESSION_PREFIX = 'local-legal-aid';
export const DEFAULT_LOCAL_CHAT_OWNER_ID = 'local-device';
export const LOCAL_CHAT_SESSION_INDEX_KEY_PREFIX = 'chat_local_sessions:';

export type LocalChatSessionSyncStatus = 'local-only' | 'syncing' | 'synced' | 'sync-failed';

export type LocalChatSessionRecord = {
  id: string;
  ownerId: string;
  mode: string;
  createdAt: string;
  lastActivity: string;
  syncStatus: LocalChatSessionSyncStatus;
  remoteSessionId?: string;
};

function normalizeLocalOwnerId(ownerId?: string | null): string {
  const trimmed = typeof ownerId === 'string' ? ownerId.trim() : '';
  const fallback = trimmed.length > 0 ? trimmed : DEFAULT_LOCAL_CHAT_OWNER_ID;
  return fallback.replace(/[^A-Za-z0-9._-]/g, '_');
}

export function getLocalChatSessionId(ownerId?: string | null): string {
  return `${LOCAL_CHAT_SESSION_PREFIX}-${normalizeLocalOwnerId(ownerId)}`;
}

export function createLocalChatSessionId(ownerId?: string | null, createdAt: Date = new Date()): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${getLocalChatSessionId(ownerId)}-${createdAt.getTime()}-${suffix}`;
}

export function isLocalChatSessionId(sessionId?: string | null): boolean {
  return typeof sessionId === 'string' && sessionId.startsWith(`${LOCAL_CHAT_SESSION_PREFIX}-`);
}

function localSessionIndexKey(ownerId?: string | null): string {
  return `${LOCAL_CHAT_SESSION_INDEX_KEY_PREFIX}${normalizeLocalOwnerId(ownerId)}`;
}

function parseLocalSessionRecords(raw: string | null): LocalChatSessionRecord[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as Partial<LocalChatSessionRecord>[];
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((record): record is LocalChatSessionRecord => (
      typeof record?.id === 'string' &&
      isLocalChatSessionId(record.id) &&
      typeof record.ownerId === 'string' &&
      typeof record.mode === 'string' &&
      typeof record.createdAt === 'string' &&
      typeof record.lastActivity === 'string'
    )).map(record => ({
      ...record,
      syncStatus: record.syncStatus ?? 'local-only',
    }));
  } catch {
    return [];
  }
}

function sortLocalSessionRecords(records: LocalChatSessionRecord[]): LocalChatSessionRecord[] {
  return [...records].sort((left, right) => {
    const leftTime = new Date(left.lastActivity).getTime();
    const rightTime = new Date(right.lastActivity).getTime();
    return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
  });
}

async function saveLocalSessionRecords(ownerId: string, records: LocalChatSessionRecord[]): Promise<void> {
  await encryptedAsyncStorage.setItem(localSessionIndexKey(ownerId), JSON.stringify(sortLocalSessionRecords(records)));
}

export function createLocalChatSessionRecord(ownerId?: string | null): LocalChatSessionRecord {
  const normalizedOwnerId = normalizeLocalOwnerId(ownerId);
  const now = new Date();
  return {
    id: createLocalChatSessionId(normalizedOwnerId, now),
    ownerId: normalizedOwnerId,
    mode: 'legal-aid-local',
    createdAt: now.toISOString(),
    lastActivity: now.toISOString(),
    syncStatus: 'local-only',
  };
}

export async function listLocalChatSessionRecords(ownerId?: string | null): Promise<LocalChatSessionRecord[]> {
  const normalizedOwnerId = normalizeLocalOwnerId(ownerId);
  const indexKey = localSessionIndexKey(normalizedOwnerId);
  try {
    return sortLocalSessionRecords(parseLocalSessionRecords(await encryptedAsyncStorage.getItem(
      indexKey,
    )));
  } catch (error) {
    await encryptedAsyncStorage.removeItem(indexKey);
    devPrivacyInfo('local chat session index reset', {
      reason: getPrivacySafeErrorReason(error),
    });
    return [];
  }
}

export async function upsertLocalChatSessionRecord(record: LocalChatSessionRecord): Promise<void> {
  try {
    const records = await listLocalChatSessionRecords(record.ownerId);
    const nextRecords = [
      record,
      ...records.filter(existing => existing.id !== record.id),
    ];
    await saveLocalSessionRecords(record.ownerId, nextRecords);
  } catch (error) {
    devPrivacyWarn('local chat session index save failed', {
      reason: getPrivacySafeErrorReason(error),
    });
  }
}

export async function touchLocalChatSessionRecord(
  ownerId: string,
  sessionId: string,
  lastActivity: Date = new Date(),
): Promise<void> {
  if (!isLocalChatSessionId(sessionId)) return;

  const normalizedOwnerId = normalizeLocalOwnerId(ownerId);
  const records = await listLocalChatSessionRecords(normalizedOwnerId);
  const existing = records.find(record => record.id === sessionId);
  const timestamp = lastActivity.toISOString();
  await upsertLocalChatSessionRecord(existing
    ? { ...existing, lastActivity: timestamp }
    : {
      id: sessionId,
      ownerId: normalizedOwnerId,
      mode: 'legal-aid-local',
      createdAt: timestamp,
      lastActivity: timestamp,
      syncStatus: 'local-only',
    });
}

export async function deleteLocalChatSessionRecord(ownerId: string, sessionId: string): Promise<void> {
  try {
    const normalizedOwnerId = normalizeLocalOwnerId(ownerId);
    const records = await listLocalChatSessionRecords(normalizedOwnerId);
    await saveLocalSessionRecords(
      normalizedOwnerId,
      records.filter(record => record.id !== sessionId),
    );
  } catch (error) {
    devPrivacyWarn('local chat session index delete failed', {
      reason: getPrivacySafeErrorReason(error),
    });
  }
}

export async function deleteLocalChatSessionRecordForRemoteSession(
  ownerId: string,
  remoteSessionId: string,
): Promise<void> {
  try {
    const normalizedOwnerId = normalizeLocalOwnerId(ownerId);
    const records = await listLocalChatSessionRecords(normalizedOwnerId);
    await saveLocalSessionRecords(
      normalizedOwnerId,
      records.filter(record => record.remoteSessionId !== remoteSessionId),
    );
  } catch (error) {
    devPrivacyWarn('local chat synced session index delete failed', {
      reason: getPrivacySafeErrorReason(error),
    });
  }
}
