import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  secureItems: new Map<string, string>(),
  platform: 'ios' as 'ios' | 'android' | 'web',
  secureStoreAvailable: true,
  localAuthLevel: 1,
  localAuthThrows: false,
  randomCounter: 1,
  digest(data: string) {
    let hash = 0;
    for (let i = 0; i < data.length; i += 1) {
      hash = (hash * 31 + data.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  },
}));

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockState.platform;
    },
  },
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

vi.mock('expo-local-authentication', () => ({
  SecurityLevel: {
    NONE: 0,
    SECRET: 1,
    BIOMETRIC_WEAK: 2,
    BIOMETRIC_STRONG: 3,
  },
  getEnrolledLevelAsync: vi.fn(async () => {
    if (mockState.localAuthThrows) {
      throw new Error('local auth unavailable');
    }
    return mockState.localAuthLevel;
  }),
  hasHardwareAsync: vi.fn(async () => mockState.localAuthLevel > 0),
  isEnrolledAsync: vi.fn(async () => mockState.localAuthLevel > 0),
  authenticateAsync: vi.fn(async () => ({ success: true })),
}));

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { HEX: 'hex' },
  getRandomBytesAsync: vi.fn(async (length: number) => {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
      bytes[i] = (mockState.randomCounter + i) % 256;
    }
    mockState.randomCounter += length;
    return bytes;
  }),
  digestStringAsync: vi.fn(async (_algorithm: string, data: string) => mockState.digest(data)),
}));

import { DecoyPinManager } from '../decoyPin';

const DECOY_PIN_KEY = 'safe_ride_decoy_pin';

describe('DecoyPinManager', () => {
  beforeEach(() => {
    mockState.secureItems.clear();
    mockState.platform = 'ios';
    mockState.secureStoreAvailable = true;
    mockState.localAuthLevel = 1;
    mockState.localAuthThrows = false;
    mockState.randomCounter = 1;
  });

  afterEach(() => vi.restoreAllMocks());

  it('stores the decoy PIN verifier in native secure storage, not AsyncStorage', async () => {
    const manager = DecoyPinManager.getInstance();
    vi.spyOn(Date, 'now').mockReturnValue(1_785_568_642_927);

    await manager.setPinConfig('8642', true);

    expect(await AsyncStorage.getItem(DECOY_PIN_KEY)).toBeNull();
    const stored = mockState.secureItems.get(DECOY_PIN_KEY);
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored ?? '{}') as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('pin');
    expect(parsed).not.toHaveProperty('rawPin');
    expect(Object.values(parsed)).not.toContain('8642');
    expect(parsed.hashedPin).toBe(mockState.digest(`8642${parsed.salt}`));
    expect(await manager.verifyPin('8642')).toBe(true);
    expect(await manager.verifyPin('8643')).toBe(false);
    expect(await manager.shouldRequireToExit()).toBe(true);
    expect(await manager.canUnlockCalculator()).toBe(true);
  });

  it('does not treat a require-to-exit PIN as calculator-unlockable when local auth is unavailable', async () => {
    const manager = DecoyPinManager.getInstance();

    await manager.setPinConfig('8642', true);
    mockState.localAuthLevel = 0;

    expect(await manager.hasPinConfigured()).toBe(true);
    expect(await manager.shouldRequireToExit()).toBe(true);
    expect(await manager.canUnlockCalculator()).toBe(false);
  });

  it('still treats a PIN without exit auth as calculator-unlockable when local auth is unavailable', async () => {
    const manager = DecoyPinManager.getInstance();
    mockState.localAuthLevel = 0;

    await manager.setPinConfig('9753', false);

    expect(await manager.canUnlockCalculator()).toBe(true);
  });

  it('refuses require-to-exit PIN setup when local auth is unavailable', async () => {
    const manager = DecoyPinManager.getInstance();
    mockState.localAuthLevel = 0;

    await expect(manager.setPinConfig('8642', true)).rejects.toThrow(/device authentication/i);
    expect(await manager.hasPinConfigured()).toBe(false);
  });

  it('migrates a legacy AsyncStorage verifier into secure storage on read', async () => {
    const manager = DecoyPinManager.getInstance();
    const legacy = {
      hashedPin: mockState.digest('2468legacy-salt'),
      requireToExit: false,
      salt: 'legacy-salt',
      createdAt: 1,
    };
    await AsyncStorage.setItem(DECOY_PIN_KEY, JSON.stringify(legacy));

    expect(await manager.verifyPin('2468')).toBe(true);
    expect(await AsyncStorage.getItem(DECOY_PIN_KEY)).toBeNull();
    expect(JSON.parse(mockState.secureItems.get(DECOY_PIN_KEY) ?? '{}')).toMatchObject(legacy);
  });

  it('refuses new decoy PINs when secure storage is unavailable', async () => {
    const manager = DecoyPinManager.getInstance();
    mockState.platform = 'web';

    await expect(manager.setPinConfig('97531', false)).rejects.toThrow(/native secure storage/i);
    expect(await manager.hasPinConfigured()).toBe(false);
  });
});
