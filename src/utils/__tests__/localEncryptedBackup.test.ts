import { createHash } from 'node:crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  files: new Map<string, string>(),
  secureItems: new Map<string, string>(),
  secureStoreAvailable: true,
  pickerUri: 'file://cache/backup.srbackup',
  randomCounter: 1,
  emit: vi.fn(),
  rehydrateOffline: vi.fn(),
  rehydrateQuickExit: vi.fn(),
  rehydrateWorkflow: vi.fn(),
  runtime: {
    syncQueue: [] as unknown[],
    quickExitConfig: null as unknown,
    workflowIds: [] as string[],
  },
}));
const kdfMock = vi.hoisted(() => ({ pbkdf2Async: vi.fn() }));

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decodeUtf8(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex').toUpperCase();
}

vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file://docs/',
  writeAsStringAsync: vi.fn(async (uri: string, value: string) => {
    mockState.files.set(uri, value);
  }),
  readAsStringAsync: vi.fn(async (uri: string) => {
    const value = mockState.files.get(uri);
    if (typeof value !== 'string') {
      throw new Error('file not found');
    }
    return value;
  }),
  getInfoAsync: vi.fn(async (uri: string) => {
    const value = mockState.files.get(uri);
    return typeof value === 'string'
      ? { exists: true, isDirectory: false, size: value.length }
      : { exists: false, isDirectory: false };
  }),
}));

vi.mock('expo-document-picker', () => ({
  getDocumentAsync: vi.fn(async () => ({
    canceled: false,
    assets: [{ uri: mockState.pickerUri }],
  })),
}));

vi.mock('expo-secure-store', () => ({
  isAvailableAsync: vi.fn(async () => mockState.secureStoreAvailable),
  getItemAsync: vi.fn(async (key: string) => mockState.secureItems.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    mockState.secureItems.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    mockState.secureItems.delete(key);
  }),
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
}));

vi.mock('react-native', () => ({
  DeviceEventEmitter: {
    emit: mockState.emit,
  },
}));

vi.mock('@noble/hashes/pbkdf2.js', () => kdfMock);

vi.mock('../offlineSync', () => ({
  offlineSyncManager: {
    rehydrateFromStorage: mockState.rehydrateOffline,
  },
}));

vi.mock('../quickExit', () => ({
  QuickExitManager: {
    getInstance: vi.fn(() => ({
      rehydrateFromStorage: mockState.rehydrateQuickExit,
    })),
  },
}));

vi.mock('../workflowStateManager', () => ({
  workflowManager: {
    rehydrateFromStorage: mockState.rehydrateWorkflow,
  },
}));

vi.mock('expo-crypto', () => {
  class MockAesKey {
    bytes: Uint8Array;

    constructor(bytes: Uint8Array) {
      this.bytes = bytes;
    }

    static async import(bytes: Uint8Array) {
      return new MockAesKey(bytes);
    }
  }

  class MockSealedData {
    combinedBytes: Uint8Array;

    constructor(combined: string | Uint8Array) {
      this.combinedBytes = typeof combined === 'string' ? base64ToBytes(combined) : combined;
    }

    static fromCombined(combined: string | Uint8Array) {
      if (typeof combined === 'string') {
        throw new Error('Android native AES bridge expects combined bytes');
      }
      return new MockSealedData(combined);
    }

    async combined(encoding?: 'base64' | 'bytes') {
      return encoding === 'base64' ? bytesToBase64(this.combinedBytes) : this.combinedBytes;
    }
  }

  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    CryptoEncoding: { HEX: 'hex' },
    AESEncryptionKey: MockAesKey,
    AESSealedData: MockSealedData,
    getRandomBytesAsync: vi.fn(async (length: number) => {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) {
        bytes[i] = (mockState.randomCounter + i) % 256;
      }
      mockState.randomCounter += length;
      return bytes;
    }),
    digestStringAsync: vi.fn(async (_algorithm: string, data: string) => sha256Hex(data)),
    aesEncryptAsync: vi.fn(async (plaintext: Uint8Array, key: MockAesKey, options: { additionalData?: Uint8Array }) => {
      const sealed = {
        keyHash: sha256Hex(key.bytes),
        aad: options.additionalData ? bytesToBase64(options.additionalData) : '',
        plaintext: bytesToBase64(plaintext),
      };
      return new MockSealedData(encodeUtf8(JSON.stringify(sealed)));
    }),
    aesDecryptAsync: vi.fn(async (sealedData: MockSealedData, key: MockAesKey, options: { additionalData?: Uint8Array }) => {
      const sealed = JSON.parse(decodeUtf8(sealedData.combinedBytes));
      if (sealed.keyHash !== sha256Hex(key.bytes)) {
        throw new Error('bad key');
      }
      if (sealed.aad !== (options.additionalData ? bytesToBase64(options.additionalData) : '')) {
        throw new Error('bad aad');
      }
      return base64ToBytes(sealed.plaintext);
    }),
  };
});

import { encryptedAsyncStorage, isEncryptedAsyncStorageEnvelope } from '../../lib/encryptedAsyncStorage';
import { draftStorage } from '../draftStorage';
import { localDraftDatabase } from '../localDraftDatabase';
import {
  createLocalEncryptedBackup,
  LocalBackupError,
  LOCAL_BACKUP_EXCLUDED_STORES,
  LOCAL_BACKUP_INCLUDED_STORES,
  restoreLocalEncryptedBackupFromString,
} from '../localEncryptedBackup';

function storedDraft(
  id: string,
  incidentDescription = 'Synthetic local draft',
  updatedAt = '2026-06-05T12:00:00.000Z',
) {
  return {
    id,
    createdAt: '2026-06-05T11:00:00.000Z',
    updatedAt,
    incidentDescription,
    currentStep: 'WhatHappened',
    completedSteps: [],
  };
}

async function expectBackupError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LocalBackupError);
    expect((error as LocalBackupError).code).toBe(code);
    return error as LocalBackupError;
  }

  throw new Error('Expected LocalBackupError');
}

describe('local encrypted backup', () => {
  beforeEach(async () => {
    mockState.files.clear();
    mockState.secureItems.clear();
    mockState.secureStoreAvailable = true;
    mockState.pickerUri = 'file://cache/backup.srbackup';
    mockState.randomCounter = 1;
    mockState.runtime.syncQueue = [];
    mockState.runtime.quickExitConfig = null;
    mockState.runtime.workflowIds = [];
    kdfMock.pbkdf2Async.mockImplementation(async (
      _hash: unknown,
      passphrase: string,
      salt: Uint8Array,
      options: { dkLen: number },
    ) => {
      const seed = createHash('sha256').update(passphrase).update(salt).digest();
      const output = new Uint8Array(options.dkLen);
      for (let index = 0; index < output.length; index += 1) output[index] = seed[index % seed.length];
      return output;
    });
    mockState.rehydrateOffline.mockImplementation(async () => {
      const raw = await encryptedAsyncStorage.getItem('@sync_queue');
      mockState.runtime.syncQueue = raw ? JSON.parse(raw) : [];
    });
    mockState.rehydrateQuickExit.mockImplementation(async () => {
      const raw = await AsyncStorage.getItem('safe_ride_quick_exit_config');
      mockState.runtime.quickExitConfig = raw ? JSON.parse(raw) : { enabled: false };
    });
    mockState.rehydrateWorkflow.mockImplementation(async () => {
      const keys = await AsyncStorage.getAllKeys();
      const workflowKeys = keys.filter(key => key.startsWith('@workflow_')).sort();
      mockState.runtime.workflowIds = await Promise.all(workflowKeys.map(async (key) => {
        const raw = await encryptedAsyncStorage.getItem(key);
        return raw ? JSON.parse(raw).id : key.replace('@workflow_', '');
      }));
    });
    await draftStorage.clearAll();
  });

  it('creates and restores an encrypted backup for allowlisted SafeRide local stores', async () => {
    await AsyncStorage.setItem('incident_drafts', JSON.stringify([
      storedDraft('draft-a', 'private draft text'),
    ]));
    await AsyncStorage.setItem('@sync_queue', JSON.stringify([{ id: 'queue-a', type: 'submit' }]));
    await AsyncStorage.setItem('@offline_case-a', JSON.stringify({ id: 'case-a', data: { summary: 'cached' } }));
    await AsyncStorage.setItem('chat_messages:default', JSON.stringify([{ id: 'chat-a', content: 'saved offline' }]));
    await AsyncStorage.setItem('@workflow_report-a', JSON.stringify({ id: 'report-a', status: 'in_progress' }));
    await AsyncStorage.setItem('onboarding_state_v1', JSON.stringify({ version: 2, users: {} }));
    await AsyncStorage.setItem('NAVIGATION_STATE', 'not backed up');

    const result = await createLocalEncryptedBackup({
      passphrase: 'correct horse battery staple',
      kdfIterations: 210_000,
      now: new Date('2026-06-05T12:00:00Z'),
    });

    const rawBackup = mockState.files.get(result.filePath);
    expect(rawBackup).toBeTruthy();
    expect(rawBackup).not.toContain('private draft text');
    expect(result.itemCount).toBe(6);

    await (AsyncStorage as any).clear();
    await AsyncStorage.setItem('NAVIGATION_STATE', 'destination nav state');

    await restoreLocalEncryptedBackupFromString(rawBackup!, {
      passphrase: 'correct horse battery staple',
    });

    await expect(AsyncStorage.getItem('incident_drafts')).resolves.toBeNull();
    await expect(draftStorage.getDraft('draft-a')).resolves.toMatchObject({ id: 'draft-a' });
    await expect(encryptedAsyncStorage.getItem('@sync_queue')).resolves.toContain('queue-a');
    await expect(encryptedAsyncStorage.getItem('@offline_case-a')).resolves.toContain('case-a');
    await expect(encryptedAsyncStorage.getItem('chat_messages:default')).resolves.toContain('chat-a');
    await expect(encryptedAsyncStorage.getItem('@workflow_report-a')).resolves.toContain('report-a');
    expect(await AsyncStorage.getItem('onboarding_state_v1')).toContain('version');
    expect(await AsyncStorage.getItem('NAVIGATION_STATE')).toBe('destination nav state');
  });

  it('backs up and restores native SecureStore app settings with conflict protection', async () => {
    const backupSettings = JSON.stringify({
      stealthTrigger: 'shake',
      stealthHapticsEnabled: false,
      stealthAutoRecordEnabled: true,
    });
    const currentSettings = JSON.stringify({
      stealthTrigger: 'tap',
      stealthHapticsEnabled: true,
      stealthAutoRecordEnabled: false,
    });
    mockState.secureItems.set('app_settings', backupSettings);

    const result = await createLocalEncryptedBackup({ passphrase: 'right passphrase', kdfIterations: 210_000 });
    const rawBackup = mockState.files.get(result.filePath)!;

    expect(result.itemCount).toBe(1);
    expect(rawBackup).not.toContain('shake');

    mockState.secureItems.set('app_settings', currentSettings);

    const conflict = await expectBackupError(
      restoreLocalEncryptedBackupFromString(rawBackup, { passphrase: 'right passphrase' }),
      'restore_conflict',
    );
    expect(conflict.conflicts).toContainEqual({
      key: 'secure_store:app_settings',
      reason: 'would_replace',
    });
    expect(mockState.secureItems.get('app_settings')).toBe(currentSettings);

    await restoreLocalEncryptedBackupFromString(rawBackup, {
      passphrase: 'right passphrase',
      conflictPolicy: 'replace',
    });

    expect(mockState.secureItems.get('app_settings')).toBe(backupSettings);
    expect(mockState.emit).toHaveBeenCalledWith('app:onboardingStateRestored');
    expect(mockState.emit).toHaveBeenCalledWith('app:stealthSettingsChanged');
  });

  it('does not remove existing local data when required restore backends are unavailable', async () => {
    mockState.secureItems.set('app_settings', JSON.stringify({ stealthTrigger: 'shake' }));
    const result = await createLocalEncryptedBackup({ passphrase: 'right passphrase', kdfIterations: 210_000 });
    const rawBackup = mockState.files.get(result.filePath)!;

    await AsyncStorage.setItem('incident_drafts', JSON.stringify([{ id: 'current-draft' }]));
    mockState.secureItems.clear();
    mockState.secureStoreAvailable = false;

    await expectBackupError(
      restoreLocalEncryptedBackupFromString(rawBackup, {
        passphrase: 'right passphrase',
        conflictPolicy: 'replace',
      }),
      'restore_failed',
    );

    expect(await AsyncStorage.getItem('incident_drafts')).toContain('current-draft');
  });

  it('restores local draft store and encrypted active stores with a fresh SecureStore key', async () => {
    await AsyncStorage.setItem('incident_drafts', JSON.stringify([
      storedDraft('draft-local', 'Private local draft'),
    ]));
    await encryptedAsyncStorage.setItem('@sync_queue', JSON.stringify([
      { id: 'queue-encrypted', type: 'submit', data: { draftId: 'draft-local' } },
    ]));
    await encryptedAsyncStorage.setItem('chat_messages:default', JSON.stringify([
      { id: 'chat-encrypted', content: 'Offline survivor chat' },
    ]));
    await encryptedAsyncStorage.setItem('@workflow_report-encrypted', JSON.stringify({
      id: 'report-encrypted',
      metadata: { createdAt: '2026-06-05T12:00:00Z', updatedAt: '2026-06-05T12:00:00Z', progress: 50 },
      steps: {},
      stepOrder: [],
      data: { description: 'Workflow private detail' },
      config: {},
    }));

    const result = await createLocalEncryptedBackup({ passphrase: 'right passphrase', kdfIterations: 210_000 });
    const rawBackup = mockState.files.get(result.filePath)!;
    expect(result.itemCount).toBe(4);
    expect(rawBackup).not.toContain('Private local draft');
    expect(rawBackup).not.toContain('Offline survivor chat');

    await draftStorage.clearAll();
    await (AsyncStorage as any).clear();
    mockState.secureItems.clear();

    await restoreLocalEncryptedBackupFromString(rawBackup, { passphrase: 'right passphrase' });

    await expect(AsyncStorage.getItem('incident_drafts')).resolves.toBeNull();
    await expect(draftStorage.getDraft('draft-local')).resolves.toMatchObject({
      incidentDescription: 'Private local draft',
    });
    const restoredDraftRow = await localDraftDatabase.getDraftRow('draft-local');
    expect(isEncryptedAsyncStorageEnvelope(restoredDraftRow?.encrypted_payload ?? null)).toBe(true);
    expect(restoredDraftRow?.encrypted_payload).not.toContain('Private local draft');
    await expect(encryptedAsyncStorage.getItem('@sync_queue')).resolves.toContain('queue-encrypted');
    await expect(encryptedAsyncStorage.getItem('chat_messages:default')).resolves.toContain('chat-encrypted');
    await expect(encryptedAsyncStorage.getItem('@workflow_report-encrypted')).resolves.toContain('Workflow private detail');
  });

  it('rehydrates runtime managers after restore writes backed up stores', async () => {
    await AsyncStorage.setItem('@sync_queue', JSON.stringify([{ id: 'queue-backup', type: 'submit' }]));
    await AsyncStorage.setItem('safe_ride_quick_exit_config', JSON.stringify({
      enabled: true,
      gestureType: 'double-tap',
      fingersRequired: 2,
      sensitivity: 80,
      hapticFeedback: false,
    }));
    await AsyncStorage.setItem('@workflow_report-a', JSON.stringify({
      id: 'report-a',
      metadata: { createdAt: '2026-06-05T12:00:00Z', updatedAt: '2026-06-05T12:00:00Z', progress: 25 },
      steps: {},
      stepOrder: [],
      data: {},
      config: {},
    }));

    const result = await createLocalEncryptedBackup({ passphrase: 'right passphrase', kdfIterations: 210_000 });
    const rawBackup = mockState.files.get(result.filePath)!;
    expect(result.itemCount).toBe(3);

    await (AsyncStorage as any).clear();
    mockState.runtime.syncQueue = [{ id: 'stale-queue' }];
    mockState.runtime.quickExitConfig = { enabled: false };
    mockState.runtime.workflowIds = ['stale-workflow'];

    await restoreLocalEncryptedBackupFromString(rawBackup, { passphrase: 'right passphrase' });

    expect(mockState.rehydrateOffline).toHaveBeenCalledTimes(1);
    expect(mockState.rehydrateQuickExit).toHaveBeenCalledTimes(1);
    expect(mockState.rehydrateWorkflow).toHaveBeenCalledTimes(1);
    expect(mockState.runtime.syncQueue).toEqual([{ id: 'queue-backup', type: 'submit' }]);
    expect(mockState.runtime.quickExitConfig).toMatchObject({ enabled: true, gestureType: 'double-tap' });
    expect(mockState.runtime.workflowIds).toEqual(['report-a']);
  });

  it('rejects a wrong passphrase before restore', async () => {
    await AsyncStorage.setItem('incident_drafts', JSON.stringify([storedDraft('draft-a')]));
    const result = await createLocalEncryptedBackup({ passphrase: 'right passphrase', kdfIterations: 210_000 });
    const rawBackup = mockState.files.get(result.filePath)!;

    await expectBackupError(
      restoreLocalEncryptedBackupFromString(rawBackup, { passphrase: 'wrong passphrase' }),
      'wrong_passphrase',
    );
  });

  it('rejects a corrupt backup file after passphrase verification', async () => {
    await AsyncStorage.setItem('incident_drafts', JSON.stringify([storedDraft('draft-a')]));
    const result = await createLocalEncryptedBackup({ passphrase: 'right passphrase', kdfIterations: 210_000 });
    const file = JSON.parse(mockState.files.get(result.filePath)!);
    file.ciphertext = bytesToBase64(encodeUtf8('not-json'));

    await expectBackupError(
      restoreLocalEncryptedBackupFromString(JSON.stringify(file), { passphrase: 'right passphrase' }),
      'corrupt_file',
    );
  });

  it('rejects unsupported backup versions', async () => {
    await AsyncStorage.setItem('incident_drafts', JSON.stringify([storedDraft('draft-a')]));
    const result = await createLocalEncryptedBackup({ passphrase: 'right passphrase', kdfIterations: 210_000 });
    const file = JSON.parse(mockState.files.get(result.filePath)!);
    file.version = 99;

    await expectBackupError(
      restoreLocalEncryptedBackupFromString(JSON.stringify(file), { passphrase: 'right passphrase' }),
      'unsupported_version',
    );
  });

  it('rejects weak or attacker-amplified KDF settings before deriving a key', async () => {
    await AsyncStorage.setItem('incident_drafts', JSON.stringify([storedDraft('draft-a')]));
    const result = await createLocalEncryptedBackup({ passphrase: 'right passphrase', kdfIterations: 210_000 });
    const file = JSON.parse(mockState.files.get(result.filePath)!);
    kdfMock.pbkdf2Async.mockClear();

    file.kdf.iterations = 1;
    await expectBackupError(
      restoreLocalEncryptedBackupFromString(JSON.stringify(file), { passphrase: 'right passphrase' }),
      'corrupt_file',
    );
    expect(kdfMock.pbkdf2Async).not.toHaveBeenCalled();

    file.kdf.iterations = 10_000_000;
    await expectBackupError(
      restoreLocalEncryptedBackupFromString(JSON.stringify(file), { passphrase: 'right passphrase' }),
      'corrupt_file',
    );
    expect(kdfMock.pbkdf2Async).not.toHaveBeenCalled();
  });

  it('bounds passphrase input before backup KDF work', async () => {
    await AsyncStorage.setItem('incident_drafts', JSON.stringify([storedDraft('draft-a')]));
    kdfMock.pbkdf2Async.mockClear();
    await expectBackupError(
      createLocalEncryptedBackup({ passphrase: 'x'.repeat(1025) }),
      'passphrase_required',
    );
    expect(kdfMock.pbkdf2Async).not.toHaveBeenCalled();
  });

  it('restores the previous local snapshot when replace restore fails after deletion starts', async () => {
    await AsyncStorage.setItem('safe_ride_quick_exit_config', JSON.stringify({ enabled: true, marker: 'backup' }));
    const result = await createLocalEncryptedBackup({ passphrase: 'right passphrase', kdfIterations: 210_000 });
    const rawBackup = mockState.files.get(result.filePath)!;
    await AsyncStorage.setItem('safe_ride_quick_exit_config', JSON.stringify({ enabled: false, marker: 'current' }));
    const multiSetSpy = vi.spyOn(AsyncStorage, 'multiSet')
      .mockRejectedValueOnce(new Error('synthetic restore write failure'));

    try {
      await expectBackupError(
        restoreLocalEncryptedBackupFromString(rawBackup, {
          passphrase: 'right passphrase',
          conflictPolicy: 'replace',
        }),
        'restore_failed',
      );
    } finally {
      multiSetSpy.mockRestore();
    }

    expect(await AsyncStorage.getItem('safe_ride_quick_exit_config'))
      .toBe(JSON.stringify({ enabled: false, marker: 'current' }));
  });

  it('requires explicit replace policy when restore would overwrite or remove local data', async () => {
    await AsyncStorage.setItem('incident_drafts', JSON.stringify([
      storedDraft('backup-draft', 'from backup'),
    ]));
    const result = await createLocalEncryptedBackup({ passphrase: 'right passphrase', kdfIterations: 210_000 });
    const rawBackup = mockState.files.get(result.filePath)!;

    await draftStorage.clearAll();
    await AsyncStorage.setItem('incident_drafts', JSON.stringify([
      storedDraft('newer-draft', 'keep me', '2026-06-05T13:00:00.000Z'),
    ]));
    await AsyncStorage.setItem('@offline_newer', JSON.stringify({ id: 'newer' }));

    const conflict = await expectBackupError(
      restoreLocalEncryptedBackupFromString(rawBackup, { passphrase: 'right passphrase' }),
      'restore_conflict',
    );
    expect(conflict.conflicts.map(item => item.reason)).toEqual(expect.arrayContaining(['would_replace', 'would_remove']));
    await expect(draftStorage.getDraft('newer-draft')).resolves.toMatchObject({ id: 'newer-draft' });

    await restoreLocalEncryptedBackupFromString(rawBackup, {
      passphrase: 'right passphrase',
      conflictPolicy: 'replace',
    });

    await expect(draftStorage.getDraft('backup-draft')).resolves.toMatchObject({ id: 'backup-draft' });
    expect(await AsyncStorage.getItem('@offline_newer')).toBeNull();
  });

  it('keeps backup scope and copy local-only', () => {
    expect(LOCAL_BACKUP_INCLUDED_STORES.join(' ')).not.toMatch(/cloud|sync backend/i);
    expect(LOCAL_BACKUP_INCLUDED_STORES.join(' ')).toMatch(/offline queue/i);
    expect(LOCAL_BACKUP_EXCLUDED_STORES).toContain('auth sessions and tokens');
    expect(LOCAL_BACKUP_EXCLUDED_STORES).toContain('remote or cloud records');
  });
});
