import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { devPrivacyWarn, getPrivacySafeErrorReason } from '../utils/privacyLog';

// Expo SecureStore only accepts keys matching ^[-._a-zA-Z0-9]+$, so keep the prefix simple.
const KEY_PREFIX = 'saferide_auth_';

type StorageAdapter = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

function buildKey(key: string): string {
  return `${KEY_PREFIX}${key}`;
}

async function getSecureItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem(buildKey(key));
  }

  return SecureStore.getItemAsync(buildKey(key));
}

async function setSecureItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(buildKey(key), value);
    return;
  }

  await SecureStore.setItemAsync(buildKey(key), value, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

async function removeSecureItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(buildKey(key));
    return;
  }

  await SecureStore.deleteItemAsync(buildKey(key));
}

export const secureStoreAdapter: StorageAdapter = {
  async getItem(key: string) {
    try {
      return await getSecureItem(key);
    } catch (error) {
      devPrivacyWarn('auth storage read failed', { reason: getPrivacySafeErrorReason(error) });
      return null;
    }
  },
  async setItem(key: string, value: string) {
    try {
      await setSecureItem(key, value);
    } catch (error) {
      devPrivacyWarn('auth storage write failed', { reason: getPrivacySafeErrorReason(error) });
    }
  },
  async removeItem(key: string) {
    try {
      await removeSecureItem(key);
    } catch (error) {
      devPrivacyWarn('auth storage delete failed', { reason: getPrivacySafeErrorReason(error) });
    }
  },
};
