import AsyncStorage from '@react-native-async-storage/async-storage';
import { describe, expect, it, vi } from 'vitest';

import { isEncryptedAsyncStorageEnvelope } from '../../lib/encryptedAsyncStorage';

vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
}));

import ChatErrorHandler from '../chatErrorHandling';

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

describe('ChatErrorHandler retry queue and offline copy', () => {
  it('returns true and exposes count when a message is queued for retry', async () => {
    const queued = await ChatErrorHandler.queueMessageForRetry('session-1', {
      id: 'message-1',
      role: 'user',
      content: 'I need support',
      timestamp: '2026-06-06T00:00:00.000Z',
      deliveryStatus: 'queued',
    });

    expect(queued).toBe(true);
    const rawQueue = await AsyncStorage.getItem('message_retry_queue:session-1');
    expect(isEncryptedAsyncStorageEnvelope(rawQueue)).toBe(true);
    expect(rawQueue).not.toContain('I need support');
    expect(await ChatErrorHandler.getRetryQueueCount('session-1')).toBe(1);
  });

  it('returns false when queue persistence fails so UI can avoid fake queued copy', async () => {
    vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('storage full'));

    const queued = await ChatErrorHandler.queueMessageForRetry('session-1', {
      id: 'message-1',
      role: 'user',
      content: 'Save this',
      timestamp: '2026-06-06T00:00:00.000Z',
    });

    expect(queued).toBe(false);
    expect(await ChatErrorHandler.getRetryQueueCount('session-1')).toBe(0);
  });

  it('keeps per-session retry counts separate when reading a shared legacy queue', async () => {
    await AsyncStorage.setItem('message_retry_queue', JSON.stringify([
      { id: 'one', role: 'user', content: 'one', timestamp: '2026-06-06T00:00:00.000Z', sessionId: 'session-1' },
      { id: 'two', role: 'user', content: 'two', timestamp: '2026-06-06T00:00:00.000Z', sessionId: 'session-2' },
    ]));

    expect(await ChatErrorHandler.getRetryQueueCount('session-1')).toBe(1);
    expect(await ChatErrorHandler.getRetryQueueCount('session-2')).toBe(1);
  });

  it('persists delivery status in offline message cache', async () => {
    await ChatErrorHandler.saveMessagesOffline('session-1', [{
      id: 'message-1',
      role: 'user',
      content: 'offline note',
      timestamp: '2026-06-06T00:00:00.000Z',
      isOffline: true,
      deliveryStatus: 'queued',
    }]);

    await expect(ChatErrorHandler.loadMessagesOffline('session-1')).resolves.toEqual([
      expect.objectContaining({ deliveryStatus: 'queued' }),
    ]);
  });

  it('persists a chat snapshot from screen messages through the encrypted offline cache', async () => {
    const saved = await ChatErrorHandler.persistMessageSnapshot('session-1', [
      {
        id: 'message-1',
        role: 'user',
        content: 'private chat text',
        createdAt: new Date('2026-07-05T02:00:00.000Z'),
        isOffline: true,
        deliveryStatus: 'local-only',
      },
      {
        id: 'message-2',
        role: 'assistant',
        content: 'support reply',
        createdAt: '2026-07-05T02:01:00.000Z',
        sources: ['SafeRide local AI'],
        isOffline: true,
      },
    ]);

    expect(saved).toBe(true);
    const rawMessages = await AsyncStorage.getItem('chat_messages:session-1');
    expect(isEncryptedAsyncStorageEnvelope(rawMessages)).toBe(true);
    expect(rawMessages).not.toContain('private chat text');

    await expect(ChatErrorHandler.loadMessagesOffline('session-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'message-1',
        timestamp: '2026-07-05T02:00:00.000Z',
        deliveryStatus: 'local-only',
      }),
      expect.objectContaining({
        id: 'message-2',
        timestamp: '2026-07-05T02:01:00.000Z',
        sources: ['SafeRide local AI'],
      }),
    ]);
  });

  it('treats an unreadable chat message cache as stale local state', async () => {
    await AsyncStorage.setItem('chat_messages:session-1', unreadableEncryptedEnvelope());

    await expect(ChatErrorHandler.loadMessagesOffline('session-1')).resolves.toEqual([]);
    await expect(AsyncStorage.getItem('chat_messages:session-1')).resolves.toBeNull();
  });

  it('offline fallback copy does not promise later assistant or provider support', () => {
    const response = ChatErrorHandler.generateOfflineResponse('How do I report to police?');

    expect(response.content).toContain('Not legal advice');
    expect(response.content).toContain('No provider received this chat');
    expect(response.content).not.toMatch(/I'll provide|detailed guidance when/i);
  });

  it('gives a useful local fallback for a greeting when the model is unavailable', () => {
    const response = ChatErrorHandler.generateOfflineResponse('hi');

    expect(response.content).toContain('SafeRide can save this chat on your phone');
    expect(response.content).toContain('ask about reporting, medical care, evidence, or support contacts');
    expect(response.content).toContain('No provider received this chat');
  });

  it('returns source-locale offline fallback copy when Kiswahili is disabled', () => {
    const response = ChatErrorHandler.generateOfflineResponse('Ninaripotije polisi?', 'sw');

    expect(response.content).toContain('Basic Kenya reporting options');
    expect(response.content).toContain('No provider received this chat');
    expect(response.sources).toContain('SafeRide Kenya support catalog');
  });
});
