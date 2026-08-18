import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  PropsWithChildren,
} from "react";
import { DeviceEventEmitter } from "react-native";

import { useAuth } from "./AuthProvider";
import { Storage } from "../lib/storage";
import {
  APP_EVENT_ONBOARDING_STATE_RESTORED,
  APP_EVENT_STEALTH_SETTINGS_CHANGED,
} from "../utils/appEvents";
import { devPrivacyInfo, devPrivacyWarn, getPrivacySafeErrorReason } from "../utils/privacyLog";
import { withStartupFallback } from "../utils/startupBudget";
import {
  DEFAULT_ONBOARDING_STATE as DEFAULT_STATE,
  ONBOARDING_ANONYMOUS_USER_KEY as ANONYMOUS_USER_KEY,
  mergeOnboardingState,
  readPersistedOnboardingStates,
  updatePersistedOnboardingState,
  type OnboardingState,
  type OnboardingStep,
  type PermissionStatus,
  type StealthSettings,
} from "./onboardingStatePersistence";

const ONBOARDING_HYDRATION_BUDGET_MS = 700;

export type {
  OnboardingState,
  OnboardingStep,
  PermissionStatus,
  StealthSettings,
  StealthTrigger,
} from "./onboardingStatePersistence";

interface OnboardingContextValue {
  state: OnboardingState;
  isHydrated: boolean;
  isComplete: boolean;
  nextStep: OnboardingStep | null;
  markStepComplete: (step: OnboardingStep) => Promise<void>;
  updatePermissionStatus: (status: PermissionStatus) => Promise<void>;
  saveStealthSettings: (settings: StealthSettings) => Promise<void>;
  reset: () => Promise<void>;
}

const OnboardingContext = createContext<OnboardingContextValue | undefined>(
  undefined
);

export function OnboardingProvider({ children }: PropsWithChildren<{}>) {
  const { user } = useAuth();
  const activeUserKey = user?.id ?? ANONYMOUS_USER_KEY;

  const [allStates, setAllStates] = useState<Record<string, OnboardingState>>(
    {}
  );
  const [state, setState] = useState<OnboardingState>(DEFAULT_STATE);
  const [isStoreLoaded, setIsStoreLoaded] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const hydrate = async () => {
      const hydrationTask = readPersistedOnboardingStates();
      let timedOut = false;

      try {
        if (isMounted) {
          setIsHydrated(false);
        }
        const parsedStates = await withStartupFallback(
          hydrationTask,
          ONBOARDING_HYDRATION_BUDGET_MS,
          {},
          () => {
            timedOut = true;
            devPrivacyInfo("onboarding hydration released after budget", {
              reason: "startup-budget-expired",
            });
          },
        );
        if (!isMounted) return;
        setAllStates(parsedStates);

        if (timedOut) {
          hydrationTask
            .then((lateStates) => {
              if (isMounted) {
                setAllStates(lateStates);
              }
            })
            .catch((error) => {
              devPrivacyWarn("background onboarding hydration failed", {
                reason: getPrivacySafeErrorReason(error),
              });
            });
        }
      } catch (error) {
        devPrivacyWarn("onboarding hydration failed", {
          reason: getPrivacySafeErrorReason(error),
        });
        if (isMounted) {
          setAllStates({});
        }
      } finally {
        if (isMounted) {
          setIsStoreLoaded(true);
        }
      }
    };

    hydrate();

    const restoreSubscription = DeviceEventEmitter.addListener(
      APP_EVENT_ONBOARDING_STATE_RESTORED,
      () => {
        void hydrate();
      },
    );

    return () => {
      isMounted = false;
      restoreSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!isStoreLoaded) return;
    const nextState = allStates[activeUserKey]
      ? mergeOnboardingState(allStates[activeUserKey])
      : DEFAULT_STATE;
    setState(nextState);
    setIsHydrated(true);
  }, [activeUserKey, allStates, isStoreLoaded]);

  const applyAndPersist = useCallback(
    async (updater: (prev: OnboardingState) => OnboardingState) => {
      try {
        // Read the latest persisted store before writing so restore rehydration races
        // cannot overwrite restored onboarding data with a stale provider snapshot.
        const { state: nextState, allStates: nextAllStates } =
          await updatePersistedOnboardingState(activeUserKey, updater);
        setState(nextState);
        setAllStates(nextAllStates);
      } catch (error) {
        console.warn("Failed to persist onboarding state", error);
        setState((prev) => mergeOnboardingState(updater(prev)));
      }
    },
    [activeUserKey]
  );

  const markStepComplete = useCallback(
    (step: OnboardingStep) =>
      applyAndPersist((prev) => ({
        ...prev,
        steps: {
          ...prev.steps,
          [step]: true,
        },
      })),
    [applyAndPersist]
  );

  const updatePermissionStatus = useCallback(
    (status: PermissionStatus) =>
      applyAndPersist((prev) => ({
        ...prev,
        permissionStatus: status,
      })),
    [applyAndPersist]
  );

  const saveStealthSettings = useCallback(
    async (settings: StealthSettings) => {
      await applyAndPersist((prev) => ({
        ...prev,
        stealthSettings: settings,
      }));

      try {
        await Storage.saveSettings({
          stealthTrigger: settings.trigger,
          stealthHapticsEnabled: settings.enableVibration,
          stealthAutoRecordEnabled: settings.enableAutoRecord,
        });
        DeviceEventEmitter.emit(APP_EVENT_STEALTH_SETTINGS_CHANGED, settings);
      } catch (error) {
        console.warn(
          "Failed to persist stealth settings to secure storage",
          error
        );
      }
    },
    [applyAndPersist]
  );

  const reset = useCallback(
    () =>
      applyAndPersist(() => ({
        ...DEFAULT_STATE,
      })),
    [applyAndPersist]
  );

  const isComplete = useMemo(
    () => Object.values(state.steps).every(Boolean),
    [state.steps]
  );

  const nextStep = useMemo<OnboardingStep | null>(() => {
    if (!state.steps.Onboarding) return "Onboarding";
    if (!state.steps.PermissionGate) return "PermissionGate";
    if (!state.steps.StealthTriggerSetup) return "StealthTriggerSetup";
    return null;
  }, [state.steps]);

  const value = useMemo<OnboardingContextValue>(
    () => ({
      state,
      isHydrated,
      isComplete,
      nextStep,
      markStepComplete,
      updatePermissionStatus,
      saveStealthSettings,
      reset,
    }),
    [
      state,
      isHydrated,
      isComplete,
      nextStep,
      markStepComplete,
      updatePermissionStatus,
      saveStealthSettings,
      reset,
    ]
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error("useOnboarding must be used within an OnboardingProvider");
  }
  return ctx;
}
