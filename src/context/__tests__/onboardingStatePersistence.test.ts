import AsyncStorage from '@react-native-async-storage/async-storage';
import { describe, expect, it } from 'vitest';

import {
  ONBOARDING_ANONYMOUS_USER_KEY,
  ONBOARDING_STORAGE_KEY,
  readPersistedOnboardingStates,
  serializeOnboardingStore,
  updatePersistedOnboardingState,
} from '../onboardingStatePersistence';

describe('onboarding state persistence', () => {
  it('reads restored onboarding state and preserves it for later writes', async () => {
    await AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({
      version: 2,
      users: {
        [ONBOARDING_ANONYMOUS_USER_KEY]: {
          steps: {
            Onboarding: true,
            PermissionGate: true,
            StealthTriggerSetup: true,
          },
          permissionStatus: {
            location: 'granted',
            audio: 'granted',
          },
          stealthSettings: {
            trigger: 'shake',
            enableVibration: false,
            enableAutoRecord: true,
          },
        },
      },
    }));

    const restoredStates = await readPersistedOnboardingStates();
    expect(restoredStates[ONBOARDING_ANONYMOUS_USER_KEY].steps).toEqual({
      Onboarding: true,
      PermissionGate: true,
      StealthTriggerSetup: true,
    });

    await AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, serializeOnboardingStore({
      ...restoredStates,
      [ONBOARDING_ANONYMOUS_USER_KEY]: {
        ...restoredStates[ONBOARDING_ANONYMOUS_USER_KEY],
        permissionStatus: {
          location: 'denied',
          audio: 'granted',
        },
      },
    }));

    const afterFollowUpWrite = await readPersistedOnboardingStates();
    expect(afterFollowUpWrite[ONBOARDING_ANONYMOUS_USER_KEY].steps).toEqual({
      Onboarding: true,
      PermissionGate: true,
      StealthTriggerSetup: true,
    });
    expect(afterFollowUpWrite[ONBOARDING_ANONYMOUS_USER_KEY].stealthSettings).toMatchObject({
      trigger: 'shake',
      enableVibration: false,
      enableAutoRecord: true,
    });
    expect(afterFollowUpWrite[ONBOARDING_ANONYMOUS_USER_KEY].permissionStatus.location).toBe('denied');
  });


  it('updates from restored storage instead of stale provider state', async () => {
    await AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({
      version: 2,
      users: {
        [ONBOARDING_ANONYMOUS_USER_KEY]: {
          steps: {
            Onboarding: true,
            PermissionGate: true,
            StealthTriggerSetup: true,
          },
          permissionStatus: {
            location: 'granted',
            audio: 'granted',
          },
          stealthSettings: {
            trigger: 'tap',
            enableVibration: true,
            enableAutoRecord: false,
          },
        },
      },
    }));

    const { state } = await updatePersistedOnboardingState(
      ONBOARDING_ANONYMOUS_USER_KEY,
      (previous) => ({
        ...previous,
        permissionStatus: {
          ...previous.permissionStatus,
          location: 'denied',
        },
      }),
    );

    expect(state.steps).toEqual({
      Onboarding: true,
      PermissionGate: true,
      StealthTriggerSetup: true,
    });

    const persisted = await readPersistedOnboardingStates();
    expect(persisted[ONBOARDING_ANONYMOUS_USER_KEY].steps).toEqual({
      Onboarding: true,
      PermissionGate: true,
      StealthTriggerSetup: true,
    });
    expect(persisted[ONBOARDING_ANONYMOUS_USER_KEY].permissionStatus.location).toBe('denied');
    expect(persisted[ONBOARDING_ANONYMOUS_USER_KEY].stealthSettings).toMatchObject({
      trigger: 'tap',
      enableAutoRecord: false,
    });
  });

});
