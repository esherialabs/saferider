import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SimpleThemeProvider } from './src/theme/SimpleThemeProvider';
import { RootNavigator } from './src/navigation/RootNavigator';
import { ToastProvider, useToast } from './src/components/ui/Toast';
import { notificationCenter } from './src/utils/notificationCenter';
import GlobalConfirm from './src/components/ui/GlobalConfirm';
import { OnlineProvider } from './src/context/OnlineProvider';
import { AuthProvider, useAuth } from './src/context/AuthProvider';
import { OnboardingProvider, useOnboarding } from './src/context/OnboardingProvider';
import { LanguageProvider } from './src/context/LanguageProvider';
import {
  hydrateRuntimeConfig,
  startRuntimeConfigRefreshLoop,
  subscribeToRuntimeConfig,
} from './src/config/runtime/runtimeConfigStore';
import { hydrateTunedArtifactRolloutBucket } from './src/lib/localAssistant/tunedArtifactRuntimeSelection';
import { handleLocalAssistantRuntimeConfigUpdate } from './src/services/localAssistantService';
import { configureAppTypography } from './src/theme/appTypography';
import LaunchScreen from './src/components/LaunchScreen';
import { devPrivacyInfo, devPrivacyWarn, getPrivacySafeErrorReason } from './src/utils/privacyLog';
import { wait } from './src/utils/startupBudget';

SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ duration: 450, fade: true });

const STARTUP_MAINTENANCE_DELAY_MS = 50;
const STARTUP_MAINTENANCE_BUDGET_MS = 600;

// ToastBridge must be inside providers to use hooks
function ToastBridge() {
  const toast = useToast();

  useEffect(() => {
    notificationCenter.setHandler(({ title, message, variant }) => {
      toast.show({ title, message, variant });
    });
    return () => notificationCenter.clearHandler();
  }, [toast]);

  return null;
}

function AppContent({
  onFirstLayout,
  startupMaintenanceReleased,
}: {
  onFirstLayout: () => void;
  startupMaintenanceReleased: boolean;
}) {
  const { isHydrated: isAuthHydrated } = useAuth();
  const { isHydrated: isOnboardingHydrated } = useOnboarding();
  const isBooting = !startupMaintenanceReleased || !isAuthHydrated || !isOnboardingHydrated;

  return (
    <View style={{ flex: 1 }} onLayout={onFirstLayout}>
      <ToastBridge />
      <GlobalConfirm />
      {isBooting ? (
        <LaunchScreen />
      ) : (
        <RootNavigator />
      )}
    </View>
  );
}

export default function App() {
  const [startupMaintenanceReleased, setStartupMaintenanceReleased] = useState(false);
  const [firstLayoutComplete, setFirstLayoutComplete] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    Inter: require('./assets/fonts/Inter.ttf'),
  });
  const fontsReady = fontsLoaded || Boolean(fontError);

  useEffect(() => {
    let isMounted = true;

    const runStartupMaintenance = async () => {
      const maintenanceTask = (async () => {
        try {
          await hydrateTunedArtifactRolloutBucket();
        } catch (error) {
          devPrivacyWarn('local AI rollout assignment unavailable', {
            reason: getPrivacySafeErrorReason(error),
          });
        }
        await hydrateRuntimeConfig();
        const { migrateSecureStoreDraftsIfNeeded } = await import('./src/utils/draftMigration');
        await migrateSecureStoreDraftsIfNeeded();
      })();

      let releasedBeforeCompletion = false;

      try {
        const result = await Promise.race([
          maintenanceTask.then(() => 'complete' as const),
          wait(STARTUP_MAINTENANCE_BUDGET_MS).then(() => 'released' as const),
        ]);

        releasedBeforeCompletion = result === 'released';
        if (releasedBeforeCompletion) {
          devPrivacyInfo('startup maintenance released after budget', {
            reason: 'startup-budget-expired',
          });
        }
      } catch (error) {
        devPrivacyWarn('startup maintenance failed before launch', {
          reason: getPrivacySafeErrorReason(error),
        });
      } finally {
        if (isMounted) {
          setStartupMaintenanceReleased(true);
        }
      }

      if (releasedBeforeCompletion) {
        maintenanceTask.catch(error => {
          devPrivacyWarn('background startup maintenance failed', {
            reason: getPrivacySafeErrorReason(error),
          });
        });
      }
    };

    const timer = setTimeout(runStartupMaintenance, STARTUP_MAINTENANCE_DELAY_MS);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToRuntimeConfig(config => {
      void handleLocalAssistantRuntimeConfigUpdate(config.localAi).catch(error => {
        devPrivacyWarn('local AI runtime control update failed', {
          reason: getPrivacySafeErrorReason(error),
        });
      });
    });
    const stopRefreshLoop = startRuntimeConfigRefreshLoop(error => {
      devPrivacyWarn('runtime config background refresh failed', {
        reason: getPrivacySafeErrorReason(error),
      });
    });

    return () => {
      stopRefreshLoop();
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (fontError) {
      console.warn('Font loading failed:', fontError);
    }
  }, [fontError]);

  useEffect(() => {
    if (fontsReady) {
      configureAppTypography();
    }
  }, [fontsReady]);

  useEffect(() => {
    if (firstLayoutComplete && fontsReady) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [firstLayoutComplete, fontsReady]);

  const handleFirstLayout = useCallback(() => {
    setFirstLayoutComplete(true);
  }, []);

  if (!fontsReady) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <SimpleThemeProvider>
        <LanguageProvider>
          <OnlineProvider>
            <AuthProvider>
              <OnboardingProvider>
                <ToastProvider>
                  <AppContent
                    onFirstLayout={handleFirstLayout}
                    startupMaintenanceReleased={startupMaintenanceReleased}
                  />
                </ToastProvider>
              </OnboardingProvider>
            </AuthProvider>
          </OnlineProvider>
        </LanguageProvider>
      </SimpleThemeProvider>
    </SafeAreaProvider>
  );
}
