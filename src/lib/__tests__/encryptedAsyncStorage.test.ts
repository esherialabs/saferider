import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { describe, expect, it, vi } from 'vitest';

import {
  __resetEncryptedAsyncStorageForTests,
  DEVICE_BOUND_LOCAL_ENCRYPTION_KEY_NAME,
  destroyDeviceBoundLocalEncryptionKey,
  encryptedAsyncStorage,
  isEncryptedAsyncStorageEnvelope,
} from '../encryptedAsyncStorage';

describe('encryptedAsyncStorage', () => {
  it('stores values as AES-GCM envelopes without raw survivor content', async () => {
    await encryptedAsyncStorage.setItem('incident_drafts', JSON.stringify([
      { id: 'draft-1', incidentDescription: 'Driver blocked the door.' },
    ]));

    const raw = await AsyncStorage.getItem('incident_drafts');

    expect(isEncryptedAsyncStorageEnvelope(raw)).toBe(true);
    expect(raw).not.toContain('Driver blocked the door.');
    await expect(encryptedAsyncStorage.getItem('incident_drafts')).resolves.toContain('draft-1');
  });

  it('serializes first-use key creation so concurrent writes use one persisted key', async () => {
    await Promise.all([
      encryptedAsyncStorage.setItem('@sync_queue', 'first sensitive value'),
      encryptedAsyncStorage.setItem('@workflow_concurrent', 'second sensitive value'),
    ]);

    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
    await expect(encryptedAsyncStorage.getItem('@sync_queue')).resolves.toBe('first sensitive value');
    await expect(encryptedAsyncStorage.getItem('@workflow_concurrent')).resolves.toBe('second sensitive value');
  });

  it('clears cached key material and makes remnant ciphertext unreadable after key destruction', async () => {
    await encryptedAsyncStorage.setItem('@sync_queue', 'synthetic survivor content');
    expect(isEncryptedAsyncStorageEnvelope(await AsyncStorage.getItem('@sync_queue'))).toBe(true);

    await destroyDeviceBoundLocalEncryptionKey();

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(DEVICE_BOUND_LOCAL_ENCRYPTION_KEY_NAME);
    await expect(encryptedAsyncStorage.getItem('@sync_queue')).rejects.toThrow(/bad key/);
  });

  it('fails deletion when the protected store does not confirm key removal', async () => {
    await encryptedAsyncStorage.setItem('@sync_queue', 'synthetic survivor content');
    vi.mocked(SecureStore.deleteItemAsync).mockImplementationOnce(async () => undefined);

    await expect(destroyDeviceBoundLocalEncryptionKey()).rejects.toThrow(/could not be verified/);
  });

  it('returns legacy plaintext and rewrites it as an encrypted envelope on first read', async () => {
    await AsyncStorage.setItem('@sync_queue', JSON.stringify([
      { id: 'queue-1', data: { narrative: 'Needs retry after network loss.' } },
    ]));

    const migrated = await encryptedAsyncStorage.getItem('@sync_queue');
    const rawAfterRead = await AsyncStorage.getItem('@sync_queue');

    expect(migrated).toContain('queue-1');
    expect(isEncryptedAsyncStorageEnvelope(rawAfterRead)).toBe(true);
    expect(rawAfterRead).not.toContain('Needs retry after network loss.');
  });

  it('uses the web fallback only for non-sensitive local preferences', async () => {
    const globals = globalThis as Record<string, unknown>;
    const hadDocument = 'document' in globals;
    const hadWindow = 'window' in globals;
    const originalDocument = globals.document;
    const originalWindow = globals.window;

    globals.document = {};
    globals.window = {};
    vi.mocked(SecureStore.isAvailableAsync).mockResolvedValue(false);
    __resetEncryptedAsyncStorageForTests();

    try {
      await encryptedAsyncStorage.setItem('non_sensitive_ui_preference', 'compact');

      const raw = await AsyncStorage.getItem('non_sensitive_ui_preference');

      expect(isEncryptedAsyncStorageEnvelope(raw)).toBe(true);
      await expect(encryptedAsyncStorage.getItem('non_sensitive_ui_preference')).resolves.toBe('compact');
      expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    } finally {
      if (hadDocument) {
        globals.document = originalDocument;
      } else {
        delete globals.document;
      }
      if (hadWindow) {
        globals.window = originalWindow;
      } else {
        delete globals.window;
      }
      vi.mocked(SecureStore.isAvailableAsync).mockResolvedValue(true);
      __resetEncryptedAsyncStorageForTests();
    }
  });

  it('fails closed for sensitive active storage on web', async () => {
    const globals = globalThis as Record<string, unknown>;
    globals.document = {};
    globals.window = {};

    try {
      await expect(encryptedAsyncStorage.setItem('@sync_queue', 'sensitive'))
        .rejects.toThrow('unavailable on web');
      await expect(AsyncStorage.getItem('@sync_queue')).resolves.toBeNull();
    } finally {
      delete globals.document;
      delete globals.window;
    }
  });

  it('does not expose legacy plaintext when its encrypted rewrite fails', async () => {
    const plaintext = JSON.stringify([{ id: 'queue-recovery', narrative: 'Synthetic private text' }]);
    await AsyncStorage.setItem('@sync_queue', plaintext);
    const setItemSpy = vi.spyOn(AsyncStorage, 'setItem')
      .mockRejectedValueOnce(new Error('synthetic migration write failure'));

    try {
      await expect(encryptedAsyncStorage.getItem('@sync_queue'))
        .rejects.toThrow('synthetic migration write failure');
    } finally {
      setItemSpy.mockRestore();
    }

    await expect(AsyncStorage.getItem('@sync_queue')).resolves.toBe(plaintext);
  });

  it('saves and reads drafts when native runtime lacks web text encoding globals', async () => {
    const globals = globalThis as Record<string, unknown>;
    const originalTextEncoder = globals.TextEncoder;
    const originalTextDecoder = globals.TextDecoder;
    const originalEscape = globals.escape;
    const originalUnescape = globals.unescape;

    delete globals.TextEncoder;
    delete globals.TextDecoder;
    delete globals.escape;
    delete globals.unescape;
    vi.mocked(SecureStore.isAvailableAsync).mockResolvedValue(true);
    __resetEncryptedAsyncStorageForTests();

    try {
      const draftPayload = JSON.stringify([
        {
          id: 'draft-android',
          incidentDescription: 'Saved locally on Android',
          location: { description: 'Nairobi stage' },
        },
      ]);

      await encryptedAsyncStorage.setItem('incident_drafts', draftPayload);

      const raw = await AsyncStorage.getItem('incident_drafts');
      expect(isEncryptedAsyncStorageEnvelope(raw)).toBe(true);
      expect(raw).not.toContain('Saved locally on Android');
      await expect(encryptedAsyncStorage.getItem('incident_drafts')).resolves.toBe(draftPayload);
    } finally {
      if (originalTextEncoder) globals.TextEncoder = originalTextEncoder;
      if (originalTextDecoder) globals.TextDecoder = originalTextDecoder;
      if (originalEscape) globals.escape = originalEscape;
      if (originalUnescape) globals.unescape = originalUnescape;
      __resetEncryptedAsyncStorageForTests();
    }
  });
});
