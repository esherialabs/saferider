import { Platform } from 'react-native';
import type { StealthTrigger } from '../context/onboardingStatePersistence';

export type StealthSupportLevel = 'foreground' | 'unavailable';

export interface StealthTriggerCapability {
  trigger: StealthTrigger;
  label: string;
  supported: boolean;
  level: StealthSupportLevel;
  description: string;
  limitation: string;
}

const DEFAULT_TRIGGER_ORDER: StealthTrigger[] = ['shake', 'tap', 'volume', 'power'];

export function getStealthTriggerCapabilities(
  platform: typeof Platform.OS = Platform.OS,
): Record<StealthTrigger, StealthTriggerCapability> {
  const shakeSupported = platform !== 'web';

  return {
    shake: {
      trigger: 'shake',
      label: 'Shake device',
      supported: shakeSupported,
      level: shakeSupported ? 'foreground' : 'unavailable',
      description: shakeSupported
        ? 'Uses the device accelerometer while SafeRide is open.'
        : 'Shake detection is not available in the web build.',
      limitation: shakeSupported
        ? 'This does not run from the lock screen or while the app is fully backgrounded.'
        : 'Requires native sensor access.',
    },
    tap: {
      trigger: 'tap',
      label: 'Secret tap pattern',
      supported: true,
      level: 'foreground',
      description: 'Listens for repeated taps on the SafeRide wordmark while the app is open.',
      limitation: 'This requires SafeRide to be visible and cannot start from the lock screen.',
    },
    volume: {
      trigger: 'volume',
      label: 'Volume buttons',
      supported: false,
      level: 'unavailable',
      description: 'Volume button events are not wired in this Expo build.',
      limitation: 'Requires a native volume-button event module before it can be offered.',
    },
    power: {
      trigger: 'power',
      label: 'Quick Settings tile',
      supported: false,
      level: 'unavailable',
      description: 'A disguised Android tile is not included in this repo.',
      limitation: 'Requires native Android tile/service code before it can be offered.',
    },
  };
}

export function getStealthTriggerCapability(
  trigger: StealthTrigger,
  platform: typeof Platform.OS = Platform.OS,
): StealthTriggerCapability {
  return getStealthTriggerCapabilities(platform)[trigger];
}

export function getSupportedStealthTriggers(
  platform: typeof Platform.OS = Platform.OS,
): StealthTrigger[] {
  const capabilities = getStealthTriggerCapabilities(platform);
  return DEFAULT_TRIGGER_ORDER.filter((trigger) => capabilities[trigger].supported);
}

export function resolveStealthTrigger(
  trigger: StealthTrigger,
  platform: typeof Platform.OS = Platform.OS,
): StealthTrigger {
  const capabilities = getStealthTriggerCapabilities(platform);
  if (capabilities[trigger]?.supported) {
    return trigger;
  }

  return getSupportedStealthTriggers(platform)[0] ?? 'tap';
}

export function isStealthTriggerSupported(
  trigger: StealthTrigger,
  platform: typeof Platform.OS = Platform.OS,
): boolean {
  return getStealthTriggerCapability(trigger, platform).supported;
}
