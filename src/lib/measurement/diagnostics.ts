import Constants from 'expo-constants';
import { Platform } from 'react-native';

import {
  MEASUREMENT_FEATURE_FLAGS,
  measurementDiagnosticsSchema,
  type MeasurementDiagnostics,
} from './eventSchema';

export function buildReviewableDiagnostics(params: {
  deviceTier?: MeasurementDiagnostics['deviceTier'];
  featureFlags?: Array<typeof MEASUREMENT_FEATURE_FLAGS[number]>;
} = {}): MeasurementDiagnostics {
  const rawVersion = Constants.expoConfig?.version ?? 'unknown';
  const appVersion = /^[A-Za-z0-9._-]{1,64}$/.test(rawVersion) ? rawVersion : 'unknown';
  const rawAndroidVersion = Platform.OS === 'android' ? String(Platform.Version) : 'not-android';
  const androidVersion = /^[A-Za-z0-9._ -]{1,32}$/.test(rawAndroidVersion)
    ? rawAndroidVersion
    : 'unknown';

  return measurementDiagnosticsSchema.parse({
    appVersion,
    deviceTier: params.deviceTier ?? 'unknown',
    androidVersion,
    featureFlags: [...new Set(params.featureFlags ?? [])],
  });
}
