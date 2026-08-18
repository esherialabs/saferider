import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, vi } from 'vitest';

(globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;

type ResettableAsyncStorage = typeof AsyncStorage & {
  __reset: () => void;
};

const encryptedRuntimeState = vi.hoisted(() => ({
  secureItems: new Map<string, string>(),
  secureStoreAvailable: true,
  randomCounter: 1,
}));

const sqliteRuntimeState = vi.hoisted(() => ({
  draftRows: new Map<string, {
    id: string;
    created_at: string;
    updated_at: string;
    status: string | null;
    current_step: string | null;
    encrypted_payload: string;
  }>(),
  kvRows: new Map<string, string>(),
}));

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      version: '1.0.0-test',
      extra: {
        runtime: { environment: 'test', buildProfile: 'test', releaseLike: false, openAIEnabled: false },
        api: { baseUrl: 'http://localhost:3001', timeoutMs: 5000 },
        websocket: { baseUrl: 'ws://localhost:3001' },
        auth: { baseUrl: 'http://localhost:3001/auth' },
        storage: { baseUrl: 'http://localhost:3001/storage' },
        remoteConfig: { refreshSeconds: 300 },
        localAssistant: { enabled: false, preferOnDevice: true, modelId: 'synthetic-test-model' },
        measurement: { moderatedTestMode: false },
        azureOpenAI: { transcriptionEnabled: false },
      },
    },
  },
}));

vi.mock('expo-file-system', () => ({
  FileMode: {
    ReadOnly: 'r',
    ReadWrite: 'rw',
    WriteOnly: 'w',
    Append: 'wa',
    Truncate: 'wt',
  },
  File: class MockFile {
    open() {
      return {
        readBytes: vi.fn(() => new Uint8Array()),
        writeBytes: vi.fn(),
        close: vi.fn(),
        offset: 0,
        size: 0,
      };
    }
  },
}));

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

function appendCodePoint(output: string, codePoint: number): string {
  if (codePoint <= 0xffff) {
    return output + String.fromCharCode(codePoint);
  }

  const adjusted = codePoint - 0x10000;
  return output + String.fromCharCode(
    0xd800 + (adjusted >> 10),
    0xdc00 + (adjusted & 0x3ff),
  );
}

function encodeUtf8(value: string): Uint8Array {
  const bytes: number[] = [];

  for (let i = 0; i < value.length; i += 1) {
    let codePoint = value.charCodeAt(i);

    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      } else {
        codePoint = 0xfffd;
      }
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      codePoint = 0xfffd;
    }

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }

  return new Uint8Array(bytes);
}

function decodeUtf8(value: Uint8Array): string {
  let output = '';
  let i = 0;

  while (i < value.length) {
    const first = value[i];

    if (first <= 0x7f) {
      output += String.fromCharCode(first);
      i += 1;
      continue;
    }

    if ((first & 0xe0) === 0xc0 && i + 1 < value.length) {
      output = appendCodePoint(output, ((first & 0x1f) << 6) | (value[i + 1] & 0x3f));
      i += 2;
      continue;
    }

    if ((first & 0xf0) === 0xe0 && i + 2 < value.length) {
      output = appendCodePoint(
        output,
        ((first & 0x0f) << 12) | ((value[i + 1] & 0x3f) << 6) | (value[i + 2] & 0x3f),
      );
      i += 3;
      continue;
    }

    if ((first & 0xf8) === 0xf0 && i + 3 < value.length) {
      output = appendCodePoint(
        output,
        ((first & 0x07) << 18) |
          ((value[i + 1] & 0x3f) << 12) |
          ((value[i + 2] & 0x3f) << 6) |
          (value[i + 3] & 0x3f),
      );
      i += 4;
      continue;
    }

    output += '\ufffd';
    i += 1;
  }

  return output;
}

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').toUpperCase();
}

vi.mock('expo-secure-store', () => ({
  isAvailableAsync: vi.fn(async () => encryptedRuntimeState.secureStoreAvailable),
  getItemAsync: vi.fn(async (key: string) => encryptedRuntimeState.secureItems.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    encryptedRuntimeState.secureItems.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    encryptedRuntimeState.secureItems.delete(key);
  }),
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
}));

vi.mock('expo-crypto', () => {
  class MockAesKey {
    bytes: Uint8Array;

    constructor(bytes: Uint8Array) {
      this.bytes = bytes;
    }

    static async import(value: Uint8Array | string, encoding?: 'base64') {
      if (typeof value === 'string') {
        return new MockAesKey(encoding === 'base64' ? base64ToBytes(value) : encodeUtf8(value));
      }
      return new MockAesKey(value);
    }

    static async generate() {
      const bytes = new Uint8Array(32);
      for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = (encryptedRuntimeState.randomCounter + i) % 256;
      }
      encryptedRuntimeState.randomCounter += bytes.length;
      return new MockAesKey(bytes);
    }

    async encoded(encoding?: 'base64') {
      return encoding === 'base64' ? bytesToBase64(this.bytes) : this.bytes;
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
    AESKeySize: { AES256: 256 },
    AESSealedData: MockSealedData,
    randomUUID: vi.fn(() => {
      const suffix = String(encryptedRuntimeState.randomCounter++).padStart(12, '0');
      return `00000000-0000-4000-8000-${suffix}`;
    }),
    getRandomBytesAsync: vi.fn(async (length: number) => {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) {
        bytes[i] = (encryptedRuntimeState.randomCounter + i) % 256;
      }
      encryptedRuntimeState.randomCounter += length;
      return bytes;
    }),
    digestStringAsync: vi.fn(async (_algorithm: string, data: string) => hashString(data)),
    digest: vi.fn(async (_algorithm: string, data: Uint8Array | ArrayBuffer) => {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      const seed = encodeUtf8(hashString(bytesToBase64(bytes)));
      const digestBytes = new Uint8Array(32);
      for (let i = 0; i < digestBytes.length; i += 1) digestBytes[i] = seed[i % seed.length];
      return digestBytes.buffer;
    }),
    aesEncryptAsync: vi.fn(async (plaintext: Uint8Array, key: MockAesKey, options: { additionalData?: Uint8Array }) => {
      const sealed = {
        keyHash: hashString(bytesToBase64(key.bytes)),
        aad: options.additionalData ? bytesToBase64(options.additionalData) : '',
        plaintext: bytesToBase64(plaintext),
      };
      return new MockSealedData(encodeUtf8(JSON.stringify(sealed)));
    }),
    aesDecryptAsync: vi.fn(async (sealedData: MockSealedData, key: MockAesKey, options: { additionalData?: Uint8Array }) => {
      const sealed = JSON.parse(decodeUtf8(sealedData.combinedBytes));
      if (sealed.keyHash !== hashString(bytesToBase64(key.bytes))) {
        throw new Error('bad key');
      }
      if (sealed.aad !== (options.additionalData ? bytesToBase64(options.additionalData) : '')) {
        throw new Error('bad aad');
      }
      return base64ToBytes(sealed.plaintext);
    }),
  };
});

vi.mock('expo-sqlite', () => {
  const normalizeSql = (sql: string) => sql.replace(/\s+/g, ' ').trim().toLowerCase();

  const mockDb = {
    execAsync: vi.fn(async () => undefined),
    withTransactionAsync: vi.fn(async (task: () => Promise<void>) => {
      const draftRowsSnapshot = new Map(sqliteRuntimeState.draftRows);
      const kvRowsSnapshot = new Map(sqliteRuntimeState.kvRows);
      try {
        await task();
      } catch (error) {
        sqliteRuntimeState.draftRows.clear();
        draftRowsSnapshot.forEach((value, key) => sqliteRuntimeState.draftRows.set(key, value));
        sqliteRuntimeState.kvRows.clear();
        kvRowsSnapshot.forEach((value, key) => sqliteRuntimeState.kvRows.set(key, value));
        throw error;
      }
    }),
    runAsync: vi.fn(async (sql: string, ...params: unknown[]) => {
      const normalized = normalizeSql(sql);

      if (normalized.startsWith('insert into incident_draft_records')) {
        const [id, createdAt, updatedAt, status, currentStep, encryptedPayload] = params as [
          string,
          string,
          string,
          string | null,
          string | null,
          string,
        ];
        sqliteRuntimeState.draftRows.set(id, {
          id,
          created_at: createdAt,
          updated_at: updatedAt,
          status,
          current_step: currentStep,
          encrypted_payload: encryptedPayload,
        });
        return { lastInsertRowId: 0, changes: 1 };
      }

      if (normalized.startsWith('delete from incident_draft_records where id')) {
        const [id] = params as [string];
        sqliteRuntimeState.draftRows.delete(id);
        return { lastInsertRowId: 0, changes: 1 };
      }

      if (normalized === 'delete from incident_draft_records') {
        sqliteRuntimeState.draftRows.clear();
        return { lastInsertRowId: 0, changes: 1 };
      }

      if (normalized.startsWith('insert into local_kv')) {
        const [key, value] = params as [string, string];
        sqliteRuntimeState.kvRows.set(key, value);
        return { lastInsertRowId: 0, changes: 1 };
      }

      if (normalized.startsWith('delete from local_kv where key')) {
        const [key] = params as [string];
        sqliteRuntimeState.kvRows.delete(key);
        return { lastInsertRowId: 0, changes: 1 };
      }

      if (normalized === 'delete from local_kv') {
        sqliteRuntimeState.kvRows.clear();
        return { lastInsertRowId: 0, changes: 1 };
      }

      throw new Error(`Unexpected SQLite runAsync query in test: ${sql}`);
    }),
    getFirstAsync: vi.fn(async (sql: string, ...params: unknown[]) => {
      const normalized = normalizeSql(sql);

      if (normalized.startsWith('select count(*) as count from incident_draft_records')) {
        return { count: sqliteRuntimeState.draftRows.size };
      }

      if (normalized.startsWith('select id, created_at, updated_at, status, current_step, encrypted_payload from incident_draft_records where id')) {
        const [id] = params as [string];
        return sqliteRuntimeState.draftRows.get(id) ?? null;
      }

      if (normalized.startsWith('select value from local_kv where key')) {
        const [key] = params as [string];
        const value = sqliteRuntimeState.kvRows.get(key);
        return value ? { value } : null;
      }

      throw new Error(`Unexpected SQLite getFirstAsync query in test: ${sql}`);
    }),
    getAllAsync: vi.fn(async (sql: string) => {
      const normalized = normalizeSql(sql);

      if (normalized.startsWith('select id, created_at, updated_at, status, current_step, encrypted_payload from incident_draft_records')) {
        return Array.from(sqliteRuntimeState.draftRows.values())
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      }

      throw new Error(`Unexpected SQLite getAllAsync query in test: ${sql}`);
    }),
  };

  return {
    openDatabaseAsync: vi.fn(async () => mockDb),
  };
});

beforeEach(() => {
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;
  (AsyncStorage as ResettableAsyncStorage).__reset();
  encryptedRuntimeState.secureItems.clear();
  encryptedRuntimeState.secureStoreAvailable = true;
  encryptedRuntimeState.randomCounter = 1;
  sqliteRuntimeState.draftRows.clear();
  sqliteRuntimeState.kvRows.clear();
  vi.clearAllMocks();
});
