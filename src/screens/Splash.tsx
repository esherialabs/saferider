import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../components/ui/Screen';
import AppLogo from '../components/AppLogo';
import { useTheme } from '../theme/SimpleThemeProvider';
import { RootStackParamList } from '../navigation/routes';
import { useOnboarding } from '../context/OnboardingProvider';
import { useAuth } from '../context/AuthProvider';

type SplashNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Splash'>;

export default function SplashScreen() {
  const navigation = useNavigation<SplashNavigationProp>();
  const { colors } = useTheme();
  const { isHydrated: isOnboardingHydrated, isComplete, nextStep } = useOnboarding();
  const { isHydrated: isAuthHydrated, session } = useAuth();

  useEffect(() => {
    if (!isAuthHydrated || !isOnboardingHydrated) {
      return;
    }

    if (!session) {
      navigation.reset({
        index: 0,
        routes: [{ name: 'Auth' }],
      });
      return;
    }

    if (isComplete) {
      navigation.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      });
      return;
    }

    const target = nextStep ?? 'Onboarding';
    navigation.replace(target);
  }, [isAuthHydrated, isOnboardingHydrated, isComplete, nextStep, navigation, session]);

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.primary,
    },
    logoWrapper: {
      marginBottom: 24,
    },
    subtitle: {
      fontSize: 16,
      color: colors.primaryForeground,
      opacity: 0.8,
      textAlign: 'center',
      marginTop: 8,
    },
  });

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.logoWrapper}>
          <AppLogo width={200} height={72} inverted />
        </View>
        <Text style={styles.subtitle}>Your safety, our priority</Text>
      </View>
    </Screen>
  );
}
