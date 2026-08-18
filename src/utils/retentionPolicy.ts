import AsyncStorage from '@react-native-async-storage/async-storage';

import { encryptedAsyncStorage } from '../lib/encryptedAsyncStorage';
import { PRIVACY_RETENTION_POLICY_KEY } from './storageKeys';

export type PrivacyRetentionPreference = 'local-30-days-v1' | 'local-90-days-v1' | 'local-manual-v1';
export const PRIVACY_RETENTION_PREFERENCE_KEY = PRIVACY_RETENTION_POLICY_KEY;
export const LEGACY_PRIVACY_RETENTION_PREFERENCE_KEY = 'safe_ride_privacy_retention_preference';

export async function getPrivacyRetentionPreference(): Promise<PrivacyRetentionPreference> {
  const stored = await encryptedAsyncStorage.getItem(PRIVACY_RETENTION_PREFERENCE_KEY);
  if (stored === 'local-30-days-v1' || stored === 'local-90-days-v1' || stored === 'local-manual-v1') {
    return stored;
  }

  const legacy = await AsyncStorage.getItem(LEGACY_PRIVACY_RETENTION_PREFERENCE_KEY);
  const migrated: PrivacyRetentionPreference = legacy === '30'
    ? 'local-30-days-v1'
    : legacy === '90'
      ? 'local-90-days-v1'
      : 'local-manual-v1';
  await encryptedAsyncStorage.setItem(PRIVACY_RETENTION_PREFERENCE_KEY, migrated);
  if (legacy !== null) await AsyncStorage.removeItem(LEGACY_PRIVACY_RETENTION_PREFERENCE_KEY);
  return migrated;
}

export async function savePrivacyRetentionPreference(preference: PrivacyRetentionPreference): Promise<void> {
  if (preference !== 'local-manual-v1') {
    throw new Error('Automatic retention is unavailable until its legal policy is approved.');
  }
  await encryptedAsyncStorage.setItem(PRIVACY_RETENTION_PREFERENCE_KEY, preference);
}
