import AsyncStorage from '@react-native-async-storage/async-storage';

export const ONBOARDING_STORAGE_KEY = 'onboarding_state_v1';
export const ONBOARDING_ANONYMOUS_USER_KEY = 'anonymous';
const PERSISTENCE_VERSION = 2;

export type OnboardingStep =
  | 'Onboarding'
  | 'PermissionGate'
  | 'StealthTriggerSetup';

export type PermissionStatus = {
  location: 'pending' | 'granted' | 'denied';
  audio: 'pending' | 'granted' | 'denied';
};

export type StealthTrigger = 'volume' | 'shake' | 'power' | 'tap';

export interface OnboardingState {
  steps: Record<OnboardingStep, boolean>;
  permissionStatus: PermissionStatus;
  stealthSettings: StealthSettings | null;
}

export type StealthSettings = {
  trigger: StealthTrigger;
  enableVibration: boolean;
  enableAutoRecord: boolean;
};

export const DEFAULT_ONBOARDING_STATE: OnboardingState = {
  steps: {
    Onboarding: false,
    PermissionGate: false,
    StealthTriggerSetup: false,
  },
  permissionStatus: {
    location: 'pending',
    audio: 'pending',
  },
  stealthSettings: null,
};

type PersistedStore = {
  version: number;
  users: Record<string, OnboardingState>;
};

export function mergeOnboardingState(partial: Partial<OnboardingState>): OnboardingState {
  return {
    steps: {
      ...DEFAULT_ONBOARDING_STATE.steps,
      ...(partial.steps ?? {}),
    },
    permissionStatus: {
      ...DEFAULT_ONBOARDING_STATE.permissionStatus,
      ...(partial.permissionStatus ?? {}),
    },
    stealthSettings: partial.stealthSettings
      ? {
          trigger: (partial.stealthSettings.trigger ?? 'shake') as StealthTrigger,
          enableVibration:
            partial.stealthSettings.enableVibration ??
            DEFAULT_ONBOARDING_STATE.stealthSettings?.enableVibration ??
            true,
          enableAutoRecord:
            partial.stealthSettings.enableAutoRecord ??
            DEFAULT_ONBOARDING_STATE.stealthSettings?.enableAutoRecord ??
            true,
        }
      : DEFAULT_ONBOARDING_STATE.stealthSettings,
  };
}

export function parsePersistedOnboardingStore(raw: string | null): Record<string, OnboardingState> {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (
      parsed &&
      typeof parsed === 'object' &&
      'version' in parsed &&
      typeof (parsed as PersistedStore).version === 'number' &&
      'users' in parsed &&
      typeof (parsed as PersistedStore).users === 'object'
    ) {
      const store = parsed as PersistedStore;
      return Object.entries(store.users).reduce<Record<string, OnboardingState>>((acc, [key, value]) => {
        if (value && typeof value === 'object') {
          acc[key] = mergeOnboardingState(value as Partial<OnboardingState>);
        }
        return acc;
      }, {});
    }

    if (
      parsed &&
      typeof parsed === 'object' &&
      ('steps' in parsed || 'permissionStatus' in parsed || 'stealthSettings' in parsed)
    ) {
      return {
        [ONBOARDING_ANONYMOUS_USER_KEY]: mergeOnboardingState(parsed as Partial<OnboardingState>),
      };
    }

    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, OnboardingState>>(
        (acc, [key, value]) => {
          if (value && typeof value === 'object') {
            acc[key] = mergeOnboardingState(value as Partial<OnboardingState>);
          }
          return acc;
        },
        {},
      );
    }
  } catch (error) {
    console.warn('Failed to parse onboarding state', error);
  }

  return {};
}

export function serializeOnboardingStore(users: Record<string, OnboardingState>): string {
  const payload: PersistedStore = {
    version: PERSISTENCE_VERSION,
    users,
  };
  return JSON.stringify(payload);
}

export async function readPersistedOnboardingStates(): Promise<Record<string, OnboardingState>> {
  const raw = await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY);
  return parsePersistedOnboardingStore(raw);
}

export async function updatePersistedOnboardingState(
  userKey: string,
  updater: (previous: OnboardingState) => OnboardingState,
): Promise<{ state: OnboardingState; allStates: Record<string, OnboardingState> }> {
  const allStates = await readPersistedOnboardingStates();
  const previousState = allStates[userKey]
    ? mergeOnboardingState(allStates[userKey])
    : mergeOnboardingState({});
  const nextState = mergeOnboardingState(updater(previousState));
  const nextAllStates = {
    ...allStates,
    [userKey]: nextState,
  };

  await AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, serializeOnboardingStore(nextAllStates));

  return {
    state: nextState,
    allStates: nextAllStates,
  };
}
