import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import {
  AESEncryptionKey,
  AESSealedData,
  CryptoDigestAlgorithm,
  CryptoEncoding,
  aesDecryptAsync,
  aesEncryptAsync,
  digestStringAsync,
  getRandomBytesAsync,
} from 'expo-crypto';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { DeviceEventEmitter } from 'react-native';
import { encryptedAsyncStorage, isEncryptedActivePersistenceKey } from '../lib/encryptedAsyncStorage';
import { bytesToUtf8 as decodeUtf8, utf8ToBytes as encodeUtf8 } from '../lib/utf8';
import {
  APP_EVENT_ONBOARDING_STATE_RESTORED,
  APP_EVENT_STEALTH_SETTINGS_CHANGED,
} from './appEvents';
import { offlineSyncManager } from './offlineSync';
import { QuickExitManager } from './quickExit';
import { draftStorage, type DraftData } from './draftStorage';
import { workflowManager } from './workflowStateManager';
import { PRIVACY_CONSENT_LEDGER_KEY, PRIVACY_RETENTION_POLICY_KEY } from './storageKeys';

const BACKUP_TYPE = 'SafeRide_LocalEncryptedBackup' as const;
const BACKUP_VERSION = 1 as const;
const PAYLOAD_SCHEMA_VERSION = 1;
const KDF_ALGORITHM = 'PBKDF2-SHA256' as const;
const CIPHER_ALGORITHM = 'AES-256-GCM' as const;
const KEY_LENGTH_BYTES = 32;
const SALT_LENGTH_BYTES = 16;
const NONCE_LENGTH_BYTES = 12;
const GCM_TAG_LENGTH_BYTES = 16 as const;
const DEFAULT_KDF_ITERATIONS = 210_000;
const MIN_KDF_ITERATIONS = 210_000;
const MAX_KDF_ITERATIONS = 1_000_000;
const MIN_PASSPHRASE_LENGTH = 8;
const MAX_PASSPHRASE_BYTES = 1024;
const MAX_BACKUP_FILE_BYTES = 64 * 1024 * 1024;
const MAX_BACKUP_PAYLOAD_BYTES = 40 * 1024 * 1024;
const MAX_BACKUP_STORE_COUNT = 10_000;
const MAX_BACKUP_STORE_KEY_BYTES = 256;
const MAX_BACKUP_STORE_VALUE_BYTES = 32 * 1024 * 1024;
const NATIVE_APP_SETTINGS_BACKUP_KEY = 'secure_store:app_settings';
const NATIVE_APP_SETTINGS_STORE_KEY = 'app_settings';
const DRAFT_DATABASE_BACKUP_KEY = 'sqlite:incident_draft_records';

const EXACT_BACKUP_KEYS = new Set([
  'incident_drafts',
  '@sync_queue',
  'chat_messages',
  'message_retry_queue',
  'onboarding_state_v1',
  'safe_ride_quick_exit_config',
  'safe_ride_decoy_pin',
  PRIVACY_CONSENT_LEDGER_KEY,
  PRIVACY_RETENTION_POLICY_KEY,
  'saferide_legacy_secure_incident_drafts',
  'saferide_legacy_secure_app_settings',
]);

const BACKUP_KEY_PREFIXES = [
  '@offline_',
  '@workflow_',
  'chat_messages:',
  'chat_local_sessions:',
  'message_retry_queue:',
];

const NATIVE_SECURE_BACKUP_KEYS = new Map([
  [NATIVE_APP_SETTINGS_BACKUP_KEY, NATIVE_APP_SETTINGS_STORE_KEY],
]);

export const LOCAL_BACKUP_INCLUDED_STORES = [
  'local drafts',
  'offline queue and cached packets',
  'chat offline cache and retry queue',
  'report workflow state',
  'onboarding, quick-exit, decoy, and device stealth safety settings',
  'privacy consent history and retention policy selection',
];

export const LOCAL_BACKUP_EXCLUDED_STORES = [
  'auth sessions and tokens',
  'remote or cloud records',
  'navigation state',
  'runtime configuration and provider catalog cache',
  'raw media file bytes outside AsyncStorage',
];

export type LocalBackupErrorCode =
  | 'passphrase_required'
  | 'file_cancelled'
  | 'corrupt_file'
  | 'wrong_passphrase'
  | 'unsupported_version'
  | 'restore_conflict'
  | 'empty_backup'
  | 'file_unavailable'
  | 'backup_too_large'
  | 'restore_failed';

export class LocalBackupError extends Error {
  code: LocalBackupErrorCode;
  conflicts: LocalBackupConflict[];

  constructor(code: LocalBackupErrorCode, message: string, conflicts: LocalBackupConflict[] = []) {
    super(message);
    this.name = 'LocalBackupError';
    this.code = code;
    this.conflicts = conflicts;
  }
}

export interface LocalBackupConflict {
  key: string;
  reason: 'would_replace' | 'would_remove';
}

export interface LocalBackupKeyValue {
  key: string;
  value: string;
}

interface LocalBackupPayload {
  schemaVersion: number;
  app: 'SafeRide';
  createdAt: string;
  stores: LocalBackupKeyValue[];
  includedStores: string[];
  excludedStores: string[];
}

interface LocalEncryptedBackupFile {
  type: typeof BACKUP_TYPE;
  version: number;
  createdAt: string;
  kdf: {
    algorithm: typeof KDF_ALGORITHM;
    iterations: number;
    salt: string;
    keyLength: number;
  };
  cipher: {
    algorithm: typeof CIPHER_ALGORITHM;
    ivLength: number;
    tagLength: typeof GCM_TAG_LENGTH_BYTES;
  };
  payloadSha256: string;
  keyCheckSha256: string;
  ciphertext: string;
}

export interface CreateLocalBackupOptions {
  passphrase: string;
  kdfIterations?: number;
  now?: Date;
  fileName?: string;
}

export interface CreateLocalBackupResult {
  filePath: string;
  size?: number;
  itemCount: number;
  includedStores: string[];
  excludedStores: string[];
}

export interface RestoreLocalBackupOptions {
  passphrase: string;
  conflictPolicy?: 'fail-if-conflict' | 'replace';
}

export interface RestoreLocalBackupResult {
  restoredItemCount: number;
  includedStores: string[];
  excludedStores: string[];
}

function isBackupKey(key: string): boolean {
  return key === DRAFT_DATABASE_BACKUP_KEY || isAsyncStorageBackupKey(key) || isNativeSecureBackupKey(key);
}

function isAsyncStorageBackupKey(key: string): boolean {
  return EXACT_BACKUP_KEYS.has(key) || BACKUP_KEY_PREFIXES.some(prefix => key.startsWith(prefix));
}

function isNativeSecureBackupKey(key: string): boolean {
  return NATIVE_SECURE_BACKUP_KEYS.has(key);
}

async function isNativeSecureStoreAvailable(): Promise<boolean> {
  if (typeof SecureStore.isAvailableAsync !== 'function') {
    return true;
  }

  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

async function getBackupCandidateKeys(): Promise<string[]> {
  const keys = await AsyncStorage.getAllKeys();
  return keys.filter(isAsyncStorageBackupKey).sort();
}

async function collectAsyncStorageBackupStores(): Promise<LocalBackupKeyValue[]> {
  const keys = await getBackupCandidateKeys();
  if (keys.length === 0) {
    return [];
  }

  const pairs = await Promise.all(keys.map(async (key): Promise<[string, string | null]> => {
    if (isEncryptedActivePersistenceKey(key)) {
      return [key, await encryptedAsyncStorage.getItem(key)];
    }

    return [key, await AsyncStorage.getItem(key)];
  }));

  return pairs
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([key, value]) => ({ key, value }));
}

async function collectNativeSecureBackupStores(): Promise<LocalBackupKeyValue[]> {
  const stores: LocalBackupKeyValue[] = [];
  const isAvailable = await isNativeSecureStoreAvailable();

  if (!isAvailable) {
    return stores;
  }

  for (const [backupKey, secureStoreKey] of NATIVE_SECURE_BACKUP_KEYS) {
    const value = await SecureStore.getItemAsync(secureStoreKey);
    if (typeof value === 'string') {
      stores.push({ key: backupKey, value });
    }
  }

  return stores;
}

async function collectBackupStores(): Promise<LocalBackupKeyValue[]> {
  const drafts = await draftStorage.getAllDrafts();
  const draftDatabaseStores: LocalBackupKeyValue[] = drafts.length > 0
    ? [{ key: DRAFT_DATABASE_BACKUP_KEY, value: JSON.stringify(drafts) }]
    : [];

  const [asyncStores, nativeSecureStores] = await Promise.all([
    collectAsyncStorageBackupStores(),
    collectNativeSecureBackupStores(),
  ]);

  return [...draftDatabaseStores, ...asyncStores, ...nativeSecureStores]
    .sort((a, b) => a.key.localeCompare(b.key));
}

function validatePassphrase(passphrase: string): void {
  if (!passphrase || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new LocalBackupError(
      'passphrase_required',
      `Use a passphrase with at least ${MIN_PASSPHRASE_LENGTH} characters.`,
    );
  }
  if (encodeUtf8(passphrase).byteLength > MAX_PASSPHRASE_BYTES) {
    throw new LocalBackupError('passphrase_required', 'The backup passphrase is too long.');
  }
}

function validateKdfIterations(iterations: number): void {
  if (
    !Number.isSafeInteger(iterations) ||
    iterations < MIN_KDF_ITERATIONS ||
    iterations > MAX_KDF_ITERATIONS
  ) {
    throw new LocalBackupError('corrupt_file', 'The backup key-strength settings are outside supported bounds.');
  }
}

async function deriveBackupKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  return pbkdf2Async(sha256, passphrase, salt, {
    c: iterations,
    dkLen: KEY_LENGTH_BYTES,
    asyncTick: 10,
  });
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await digestStringAsync(CryptoDigestAlgorithm.SHA256, input, {
    encoding: CryptoEncoding.HEX,
  });
  return digest.toUpperCase();
}

async function buildKeyCheck(keyBytes: Uint8Array, saltBase64: string, iterations: number): Promise<string> {
  return sha256Hex([
    'SafeRideBackupKeyCheck:v1',
    bytesToBase64(keyBytes),
    saltBase64,
    String(iterations),
  ].join(':'));
}

function buildAad(file: Omit<LocalEncryptedBackupFile, 'ciphertext' | 'payloadSha256' | 'keyCheckSha256'>): Uint8Array {
  return encodeUtf8(JSON.stringify({
    type: file.type,
    version: file.version,
    createdAt: file.createdAt,
    kdf: file.kdf,
    cipher: file.cipher,
  }));
}

function validateEnvelope(value: unknown): LocalEncryptedBackupFile {
  if (!value || typeof value !== 'object') {
    throw new LocalBackupError('corrupt_file', 'The selected file is not a SafeRide backup.');
  }

  const file = value as Partial<LocalEncryptedBackupFile>;
  if (file.type !== BACKUP_TYPE) {
    throw new LocalBackupError('corrupt_file', 'The selected file is not a SafeRide backup.');
  }

  if (file.version !== BACKUP_VERSION) {
    throw new LocalBackupError('unsupported_version', 'This SafeRide backup version is not supported by this app build.');
  }

  if (
    !file.kdf ||
    file.kdf.algorithm !== KDF_ALGORITHM ||
    typeof file.kdf.iterations !== 'number' ||
    typeof file.kdf.salt !== 'string' ||
    file.kdf.keyLength !== KEY_LENGTH_BYTES
  ) {
    throw new LocalBackupError('corrupt_file', 'The backup key settings are missing or invalid.');
  }
  validateKdfIterations(file.kdf.iterations);
  const salt = decodeCanonicalBase64(file.kdf.salt, 'salt');
  if (salt.byteLength !== SALT_LENGTH_BYTES) {
    throw new LocalBackupError('corrupt_file', 'The backup salt has an invalid length.');
  }

  if (
    !file.cipher ||
    file.cipher.algorithm !== CIPHER_ALGORITHM ||
    file.cipher.ivLength !== NONCE_LENGTH_BYTES ||
    file.cipher.tagLength !== GCM_TAG_LENGTH_BYTES
  ) {
    throw new LocalBackupError('corrupt_file', 'The backup encryption settings are missing or invalid.');
  }

  if (
    typeof file.createdAt !== 'string' ||
    typeof file.payloadSha256 !== 'string' ||
    typeof file.keyCheckSha256 !== 'string' ||
    typeof file.ciphertext !== 'string'
  ) {
    throw new LocalBackupError('corrupt_file', 'The backup file is missing required data.');
  }
  if (
    !Number.isFinite(Date.parse(file.createdAt)) ||
    !/^[A-F0-9]{64}$/.test(file.payloadSha256) ||
    !/^[A-F0-9]{64}$/.test(file.keyCheckSha256)
  ) {
    throw new LocalBackupError('corrupt_file', 'The backup metadata or integrity fields are invalid.');
  }
  const sealedBytes = decodeCanonicalBase64(file.ciphertext, 'ciphertext');
  if (sealedBytes.byteLength <= NONCE_LENGTH_BYTES + GCM_TAG_LENGTH_BYTES || sealedBytes.byteLength > MAX_BACKUP_FILE_BYTES) {
    throw new LocalBackupError('corrupt_file', 'The backup ciphertext size is invalid.');
  }

  return file as LocalEncryptedBackupFile;
}

function validatePayload(value: unknown): LocalBackupPayload {
  if (!value || typeof value !== 'object') {
    throw new LocalBackupError('corrupt_file', 'The backup payload is unreadable.');
  }

  const payload = value as Partial<LocalBackupPayload>;
  if (payload.schemaVersion !== PAYLOAD_SCHEMA_VERSION) {
    throw new LocalBackupError('unsupported_version', 'This SafeRide backup schema is not supported by this app build.');
  }

  if (
    payload.app !== 'SafeRide' ||
    !Array.isArray(payload.stores) ||
    payload.stores.length > MAX_BACKUP_STORE_COUNT ||
    typeof payload.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(payload.createdAt))
  ) {
    throw new LocalBackupError('corrupt_file', 'The backup payload is not a valid SafeRide local backup.');
  }

  const seenKeys = new Set<string>();
  for (const item of payload.stores) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.key !== 'string' ||
      typeof item.value !== 'string' ||
      !isBackupKey(item.key) ||
      encodeUtf8(item.key).byteLength > MAX_BACKUP_STORE_KEY_BYTES ||
      encodeUtf8(item.value).byteLength > MAX_BACKUP_STORE_VALUE_BYTES ||
      seenKeys.has(item.key)
    ) {
      throw new LocalBackupError('corrupt_file', 'The backup contains an unsupported local data key.');
    }
    seenKeys.add(item.key);
  }

  return {
    schemaVersion: payload.schemaVersion,
    app: 'SafeRide',
    createdAt: payload.createdAt,
    stores: payload.stores,
    includedStores: LOCAL_BACKUP_INCLUDED_STORES,
    excludedStores: LOCAL_BACKUP_EXCLUDED_STORES,
  };
}

async function decryptPayload(rawFile: string, passphrase: string): Promise<LocalBackupPayload> {
  if (rawFile.length > MAX_BACKUP_FILE_BYTES || encodeUtf8(rawFile).byteLength > MAX_BACKUP_FILE_BYTES) {
    throw new LocalBackupError('corrupt_file', 'The selected backup file is too large.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawFile);
  } catch {
    throw new LocalBackupError('corrupt_file', 'The selected file is not readable JSON.');
  }

  const file = validateEnvelope(parsed);
  const salt = decodeCanonicalBase64(file.kdf.salt, 'salt');
  const keyBytes = await deriveBackupKey(passphrase, salt, file.kdf.iterations);
  const keyCheck = await buildKeyCheck(keyBytes, file.kdf.salt, file.kdf.iterations);

  if (keyCheck !== file.keyCheckSha256) {
    throw new LocalBackupError('wrong_passphrase', 'The passphrase does not unlock this backup.');
  }

  let decrypted: Uint8Array;
  try {
    const key = await AESEncryptionKey.import(keyBytes) as AESEncryptionKey;
    const aad = buildAad(file);
    const sealedData = AESSealedData.fromCombined(
      decodeCanonicalBase64(file.ciphertext, 'ciphertext'),
      {
        ivLength: file.cipher.ivLength,
        tagLength: file.cipher.tagLength,
      },
    );
    const result = await aesDecryptAsync(sealedData, key, { additionalData: aad });
    decrypted = typeof result === 'string' ? base64ToBytes(result) : result;
  } catch {
    throw new LocalBackupError('corrupt_file', 'The backup could not be verified. The file may be damaged.');
  }

  const payloadJson = decodeUtf8(decrypted);
  const actualPayloadHash = await sha256Hex(payloadJson);
  if (actualPayloadHash !== file.payloadSha256) {
    throw new LocalBackupError('corrupt_file', 'The backup integrity check failed.');
  }

  try {
    return validatePayload(JSON.parse(payloadJson));
  } catch (error) {
    if (error instanceof LocalBackupError) {
      throw error;
    }
    throw new LocalBackupError('corrupt_file', 'The backup payload could not be parsed.');
  }
}

function detectRestoreConflicts(
  stores: LocalBackupKeyValue[],
  currentStores: LocalBackupKeyValue[],
): LocalBackupConflict[] {
  const backupKeys = new Set(stores.map(item => item.key));
  const backupByKey = new Map(stores.map(item => [item.key, item.value]));
  const conflicts: LocalBackupConflict[] = [];

  for (const { key, value: currentValue } of currentStores) {
    if (!backupKeys.has(key)) {
      conflicts.push({ key, reason: 'would_remove' });
      continue;
    }

    if (backupByKey.get(key) !== currentValue) {
      conflicts.push({ key, reason: 'would_replace' });
    }
  }

  return conflicts;
}

async function ensureRestoreBackendsAvailable(stores: LocalBackupKeyValue[]): Promise<void> {
  const needsSecureStore = stores.some(item => (
    isNativeSecureBackupKey(item.key) || isEncryptedActivePersistenceKey(item.key)
  ));
  if (needsSecureStore && !(await isNativeSecureStoreAvailable())) {
    throw new LocalBackupError(
      'restore_failed',
      'Secure local storage is not available on this device.',
    );
  }
}

async function removeCurrentBackupStores(): Promise<void> {
  await draftStorage.clearAll();

  const currentKeys = await getBackupCandidateKeys();
  if (currentKeys.length > 0) {
    await AsyncStorage.multiRemove(currentKeys);
  }

  if (!(await isNativeSecureStoreAvailable())) {
    return;
  }

  await Promise.all(
    Array.from(NATIVE_SECURE_BACKUP_KEYS.values()).map(key => SecureStore.deleteItemAsync(key)),
  );
}

function parseBackupDrafts(value: string): DraftData[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new LocalBackupError('corrupt_file', 'The backup draft database payload is unreadable.');
  }

  if (!Array.isArray(parsed)) {
    throw new LocalBackupError('corrupt_file', 'The backup draft database payload is invalid.');
  }

  return parsed.map((draft): DraftData => {
    if (!draft || typeof draft !== 'object' || typeof (draft as { id?: unknown }).id !== 'string') {
      throw new LocalBackupError('corrupt_file', 'The backup contains an invalid local draft.');
    }

    const rawDraft = draft as Record<string, any>;
    const createdAt = new Date(rawDraft.createdAt);
    const updatedAt = new Date(rawDraft.updatedAt);
    if (!Number.isFinite(createdAt.getTime()) || !Number.isFinite(updatedAt.getTime())) {
      throw new LocalBackupError('corrupt_file', 'The backup contains an invalid local draft timestamp.');
    }
    return {
      ...rawDraft,
      createdAt,
      updatedAt,
      lastAutoSave: rawDraft.lastAutoSave ? new Date(rawDraft.lastAutoSave) : undefined,
      mediaFiles: Array.isArray(rawDraft.mediaFiles)
        ? rawDraft.mediaFiles.map((media: Record<string, any>) => ({
            ...media,
            timestamp: new Date(media.timestamp),
            uploadedAt: media.uploadedAt ? new Date(media.uploadedAt) : undefined,
          }))
        : undefined,
    } as DraftData;
  });
}

function preflightRestoreStores(stores: LocalBackupKeyValue[]): void {
  for (const item of stores) {
    if (item.key === DRAFT_DATABASE_BACKUP_KEY) {
      parseBackupDrafts(item.value);
    }
  }
}

async function restoreStoredValues(stores: LocalBackupKeyValue[]): Promise<void> {
  const draftDatabaseStores = stores.filter(item => item.key === DRAFT_DATABASE_BACKUP_KEY);
  const encryptedActiveStores = stores.filter(item => (
    item.key !== DRAFT_DATABASE_BACKUP_KEY &&
    !isNativeSecureBackupKey(item.key) &&
    isEncryptedActivePersistenceKey(item.key)
  ));
  const asyncStoragePairs = stores
    .filter(item => (
      item.key !== DRAFT_DATABASE_BACKUP_KEY &&
      !isNativeSecureBackupKey(item.key) &&
      !isEncryptedActivePersistenceKey(item.key)
    ))
    .map(item => [item.key, item.value] as [string, string]);
  const nativeSecureStores = stores.filter(item => isNativeSecureBackupKey(item.key));

  if (nativeSecureStores.length > 0 && !(await isNativeSecureStoreAvailable())) {
    throw new LocalBackupError(
      'restore_failed',
      'Secure local settings are not available on this device.',
    );
  }

  if (asyncStoragePairs.length > 0) {
    await AsyncStorage.multiSet(asyncStoragePairs);
  }

  for (const item of encryptedActiveStores) {
    await encryptedAsyncStorage.setItem(item.key, item.value);
  }

  for (const item of draftDatabaseStores) {
    await draftStorage.setDrafts(parseBackupDrafts(item.value));
  }

  for (const item of nativeSecureStores) {
    const secureStoreKey = NATIVE_SECURE_BACKUP_KEYS.get(item.key);
    if (!secureStoreKey) {
      throw new LocalBackupError('corrupt_file', 'The backup contains an unsupported secure data key.');
    }
    await SecureStore.setItemAsync(secureStoreKey, item.value);
  }
}

async function rehydrateRestoredRuntimeState(): Promise<void> {
  try {
    await Promise.all([
      offlineSyncManager.rehydrateFromStorage(),
      QuickExitManager.getInstance().rehydrateFromStorage(),
      workflowManager.rehydrateFromStorage(),
    ]);
    DeviceEventEmitter.emit(APP_EVENT_ONBOARDING_STATE_RESTORED);
    DeviceEventEmitter.emit(APP_EVENT_STEALTH_SETTINGS_CHANGED);
  } catch {
    throw new LocalBackupError(
      'restore_failed',
      'The backup was written, but SafeRide could not refresh restored local state. Close and reopen SafeRide before continuing.',
    );
  }
}

async function restorePayload(
  payload: LocalBackupPayload,
  conflictPolicy: RestoreLocalBackupOptions['conflictPolicy'] = 'fail-if-conflict',
): Promise<RestoreLocalBackupResult> {
  await ensureRestoreBackendsAvailable(payload.stores);
  preflightRestoreStores(payload.stores);
  const currentStores = await collectBackupStores();

  const conflicts = detectRestoreConflicts(payload.stores, currentStores);

  if (conflicts.length > 0 && conflictPolicy !== 'replace') {
    throw new LocalBackupError(
      'restore_conflict',
      'Restoring this backup would replace or remove local SafeRide data.',
      conflicts,
    );
  }

  let mutationStarted = false;
  try {
    if (conflictPolicy === 'replace') {
      mutationStarted = true;
      await removeCurrentBackupStores();
    }

    if (payload.stores.length > 0) {
      mutationStarted = true;
      await restoreStoredValues(payload.stores);
    }

    await rehydrateRestoredRuntimeState();
  } catch (error) {
    if (!mutationStarted) throw error;
    try {
      await removeCurrentBackupStores();
      if (currentStores.length > 0) {
        await restoreStoredValues(currentStores);
      }
      await rehydrateRestoredRuntimeState();
    } catch {
      throw new LocalBackupError(
        'restore_failed',
        'Backup restore failed and the previous local data could not be fully recovered. Stop using restore and contact support.',
      );
    }
    throw new LocalBackupError(
      'restore_failed',
      'Backup restore failed. The previous local SafeRide data was restored.',
    );
  }

  return {
    restoredItemCount: payload.stores.length,
    includedStores: payload.includedStores,
    excludedStores: payload.excludedStores,
  };
}

export async function createLocalEncryptedBackup({
  passphrase,
  kdfIterations = DEFAULT_KDF_ITERATIONS,
  now = new Date(),
  fileName,
}: CreateLocalBackupOptions): Promise<CreateLocalBackupResult> {
  validatePassphrase(passphrase);
  validateKdfIterations(kdfIterations);

  const stores = await collectBackupStores();
  if (stores.length === 0) {
    throw new LocalBackupError('empty_backup', 'There is no local SafeRide data to back up on this device.');
  }

  const createdAt = now.toISOString();
  const payload: LocalBackupPayload = {
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    app: 'SafeRide',
    createdAt,
    stores,
    includedStores: LOCAL_BACKUP_INCLUDED_STORES,
    excludedStores: LOCAL_BACKUP_EXCLUDED_STORES,
  };

  const payloadJson = JSON.stringify(payload);
  if (encodeUtf8(payloadJson).byteLength > MAX_BACKUP_PAYLOAD_BYTES) {
    throw new LocalBackupError('backup_too_large', 'Local SafeRide data is too large for one backup file.');
  }
  const payloadSha256 = await sha256Hex(payloadJson);
  const salt = await getRandomBytesAsync(SALT_LENGTH_BYTES);
  const nonce = await getRandomBytesAsync(NONCE_LENGTH_BYTES);
  const keyBytes = await deriveBackupKey(passphrase, salt, kdfIterations);
  const key = await AESEncryptionKey.import(keyBytes) as AESEncryptionKey;
  const baseFile: Omit<LocalEncryptedBackupFile, 'ciphertext' | 'payloadSha256' | 'keyCheckSha256'> = {
    type: BACKUP_TYPE,
    version: BACKUP_VERSION,
    createdAt,
    kdf: {
      algorithm: KDF_ALGORITHM,
      iterations: kdfIterations,
      salt: bytesToBase64(salt),
      keyLength: KEY_LENGTH_BYTES,
    },
    cipher: {
      algorithm: CIPHER_ALGORITHM,
      ivLength: NONCE_LENGTH_BYTES,
      tagLength: GCM_TAG_LENGTH_BYTES,
    },
  };

  const sealedData = await aesEncryptAsync(encodeUtf8(payloadJson), key, {
    nonce: { bytes: nonce },
    tagLength: GCM_TAG_LENGTH_BYTES,
    additionalData: buildAad(baseFile),
  });
  const ciphertext = await sealedData.combined('base64');
  const backupFile: LocalEncryptedBackupFile = {
    ...baseFile,
    payloadSha256,
    keyCheckSha256: await buildKeyCheck(keyBytes, baseFile.kdf.salt, kdfIterations),
    ciphertext,
  };
  const serializedBackup = JSON.stringify(backupFile);
  if (encodeUtf8(serializedBackup).byteLength > MAX_BACKUP_FILE_BYTES) {
    throw new LocalBackupError('backup_too_large', 'The encrypted backup exceeds the supported file size.');
  }

  if (!FileSystem.documentDirectory) {
    throw new LocalBackupError('file_unavailable', 'Local document storage is not available on this device.');
  }

  const safeTimestamp = createdAt.replace(/[:.]/g, '-');
  const backupFileName = fileName ?? `saferide_local_backup_${safeTimestamp}.srbackup`;
  const filePath = `${FileSystem.documentDirectory}${backupFileName}`;
  await FileSystem.writeAsStringAsync(filePath, serializedBackup);

  const fileInfo = await FileSystem.getInfoAsync(filePath);
  return {
    filePath,
    size: fileInfo.exists ? fileInfo.size : undefined,
    itemCount: stores.length,
    includedStores: LOCAL_BACKUP_INCLUDED_STORES,
    excludedStores: LOCAL_BACKUP_EXCLUDED_STORES,
  };
}

export async function restoreLocalEncryptedBackupFromString(
  rawFile: string,
  options: RestoreLocalBackupOptions,
): Promise<RestoreLocalBackupResult> {
  validatePassphrase(options.passphrase);
  const payload = await decryptPayload(rawFile, options.passphrase);
  return restorePayload(payload, options.conflictPolicy);
}

export async function pickLocalEncryptedBackupFile(): Promise<string> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/octet-stream', 'application/json', 'text/plain'],
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets || result.assets.length === 0) {
    throw new LocalBackupError('file_cancelled', 'Restore was cancelled.');
  }

  return FileSystem.readAsStringAsync(result.assets[0].uri);
}

export async function restoreLocalEncryptedBackup(
  options: RestoreLocalBackupOptions,
): Promise<RestoreLocalBackupResult> {
  validatePassphrase(options.passphrase);
  const rawFile = await pickLocalEncryptedBackupFile();
  return restoreLocalEncryptedBackupFromString(rawFile, options);
}

function bytesToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  let i = 0;

  for (; i + 2 < bytes.length; i += 3) {
    output += chars[bytes[i] >> 2];
    output += chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
    output += chars[((bytes[i + 1] & 15) << 2) | (bytes[i + 2] >> 6)];
    output += chars[bytes[i + 2] & 63];
  }

  if (i < bytes.length) {
    output += chars[bytes[i] >> 2];
    if (i === bytes.length - 1) {
      output += chars[(bytes[i] & 3) << 4];
      output += '==';
    } else {
      output += chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
      output += chars[(bytes[i + 1] & 15) << 2];
      output += '=';
    }
  }

  return output;
}

function base64ToBytes(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  const sanitized = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  const bytes: number[] = [];

  for (let i = 0; i < sanitized.length;) {
    const enc1 = chars.indexOf(sanitized.charAt(i++));
    const enc2 = chars.indexOf(sanitized.charAt(i++));
    const enc3 = chars.indexOf(sanitized.charAt(i++));
    const enc4 = chars.indexOf(sanitized.charAt(i++));

    if (enc1 < 0 || enc2 < 0 || enc3 < 0 || enc4 < 0) {
      throw new LocalBackupError('corrupt_file', 'The backup contains invalid encoded data.');
    }

    bytes.push((enc1 << 2) | (enc2 >> 4));

    if (enc3 !== 64) {
      bytes.push(((enc2 & 15) << 4) | (enc3 >> 2));
    }
    if (enc4 !== 64) {
      bytes.push(((enc3 & 3) << 6) | enc4);
    }
  }

  return new Uint8Array(bytes);
}

function decodeCanonicalBase64(value: string, field: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new LocalBackupError('corrupt_file', `The backup ${field} encoding is invalid.`);
  }
  const bytes = base64ToBytes(value);
  if (bytesToBase64(bytes) !== value) {
    throw new LocalBackupError('corrupt_file', `The backup ${field} encoding is not canonical.`);
  }
  return bytes;
}
