import AsyncStorage from '@react-native-async-storage/async-storage';
import { describe, expect, it } from 'vitest';

import {
  createLocalChatSessionRecord,
  DEFAULT_LOCAL_CHAT_OWNER_ID,
  deleteLocalChatSessionRecord,
  deleteLocalChatSessionRecordForRemoteSession,
  getLocalChatSessionId,
  isLocalChatSessionId,
  listLocalChatSessionRecords,
  LOCAL_CHAT_SESSION_PREFIX,
  touchLocalChatSessionRecord,
  upsertLocalChatSessionRecord,
} from '../chatLocalSession';

function unreadableEncryptedEnvelope(): string {
  return JSON.stringify({
    __saferideEncrypted: true,
    version: 1,
    algorithm: 'AES-256-GCM',
    keyName: 'saferide_local_data_aes_key_v1',
    data: 'not-valid-encrypted-data',
    createdAt: '2026-07-09T00:00:00.000Z',
  });
}

describe('chat local session helpers', () => {
  it('uses a stable local session id per owner so offline chat can reload from storage', () => {
    expect(getLocalChatSessionId('user-123')).toBe(getLocalChatSessionId('user-123'));
    expect(getLocalChatSessionId('user-123')).toBe(`${LOCAL_CHAT_SESSION_PREFIX}-user-123`);
  });

  it('falls back to the device local session when owner id is unavailable', () => {
    expect(getLocalChatSessionId(undefined)).toBe(`${LOCAL_CHAT_SESSION_PREFIX}-${DEFAULT_LOCAL_CHAT_OWNER_ID}`);
    expect(getLocalChatSessionId('   ')).toBe(`${LOCAL_CHAT_SESSION_PREFIX}-${DEFAULT_LOCAL_CHAT_OWNER_ID}`);
  });

  it('identifies only SafeRide local legal-aid sessions', () => {
    expect(isLocalChatSessionId(getLocalChatSessionId('user-123'))).toBe(true);
    expect(isLocalChatSessionId('remote-session-1')).toBe(false);
    expect(isLocalChatSessionId(null)).toBe(false);
  });

  it('creates durable local thread records without reusing the owner fallback id', async () => {
    const first = createLocalChatSessionRecord('user-123');
    const second = createLocalChatSessionRecord('user-123');

    expect(first.id).not.toBe(second.id);
    expect(first.id).toContain(`${LOCAL_CHAT_SESSION_PREFIX}-user-123-`);

    await upsertLocalChatSessionRecord(first);
    await upsertLocalChatSessionRecord(second);

    const records = await listLocalChatSessionRecords('user-123');
    expect(records.map(record => record.id).sort()).toEqual([first.id, second.id].sort());
  });

  it('touches and deletes local thread records by owner', async () => {
    const record = createLocalChatSessionRecord('user-123');
    await upsertLocalChatSessionRecord(record);
    await touchLocalChatSessionRecord('user-123', record.id, new Date('2026-06-24T12:00:00.000Z'));

    await expect(listLocalChatSessionRecords('user-123')).resolves.toEqual([
      expect.objectContaining({
        id: record.id,
        lastActivity: '2026-06-24T12:00:00.000Z',
      }),
    ]);

    await deleteLocalChatSessionRecord('user-123', record.id);
    await expect(listLocalChatSessionRecords('user-123')).resolves.toEqual([]);
  });

  it('removes synced local records when their remote session is deleted', async () => {
    const record = {
      ...createLocalChatSessionRecord('user-123'),
      syncStatus: 'synced' as const,
      remoteSessionId: 'remote-session-1',
    };
    await upsertLocalChatSessionRecord(record);

    await deleteLocalChatSessionRecordForRemoteSession('user-123', 'remote-session-1');

    await expect(listLocalChatSessionRecords('user-123')).resolves.toEqual([]);
  });

  it('treats an unreadable local session index as stale cache', async () => {
    await AsyncStorage.setItem('chat_local_sessions:user-123', unreadableEncryptedEnvelope());

    await expect(listLocalChatSessionRecords('user-123')).resolves.toEqual([]);
    await expect(AsyncStorage.getItem('chat_local_sessions:user-123')).resolves.toBeNull();
  });
});
