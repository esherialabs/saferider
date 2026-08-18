import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ImageBackground, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import PagerView, { PagerViewHandle } from '../utils/pagerViewShim';
import Screen from '../components/ui/Screen';
import Button from '../components/ui/Button';
import { useTheme } from '../theme/SimpleThemeProvider';
import { RootStackParamList } from '../navigation/routes';
import AppLogo from '../components/AppLogo';
import { useOnboarding } from '../context/OnboardingProvider';
import { spacing, typography, fontFamilies } from '../theme/tokens';
import { devPrivacyWarn, getPrivacySafeErrorReason } from '../utils/privacyLog';

type OnboardingNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Onboarding'>;

const BUTTON_HEIGHT = 56;
const BUTTON_RADIUS = BUTTON_HEIGHT / 2;

const backgroundImage = require('../../saferide.png');

const onboardingData = [
  {
    title: 'Welcome to SafeRide',
    description: 'Your personal safety companion for public transport and beyond. Document incidents, access support, and stay informed.',
    emoji: '🚌',
    features: ['Discreet incident recording', 'Safety notes and reminders', 'Kenya support contacts'],
    highlight: 'privacy-first',
  },
  {
    title: 'Privacy & Security First',
    description: 'Drafts stay on your device until you choose a consent step. Sensitive settings use protected device storage where available.',
    emoji: '🔐',
    features: ['Local draft storage', 'Consent before sharing', 'No tracking or analytics'],
    highlight: 'security',
  },
  {
    title: 'Stealth Mode Protection',
    description: 'Use supported foreground triggers like shake or secret taps while SafeRide is open.',
    emoji: '🤫',
    features: ['Foreground shake trigger', 'Secret tap pattern', 'Honest platform limits'],
    highlight: 'stealth',
  },
  {
    title: 'Evidence & Documentation',
    description: 'Collect photos, audio, and witness details with clear status for local evidence and privacy requests.',
    emoji: '📋',
    features: ['Privacy requests saved', 'Upload status shown', 'Processing limits labeled'],
    highlight: 'evidence',
  },
  {
    title: 'Legal Support Network',
    description: 'Review Kenya support options, legal-aid information, and referral contacts.',
    emoji: '⚖️',
    features: ['1195 and provider catalog', 'Legal-aid information', 'Consent-gated referral'],
    highlight: 'support',
  },
];

export default function OnboardingScreen() {
  const navigation = useNavigation<OnboardingNavigationProp>();
  const { colors } = useTheme();
  const { markStepComplete, state: onboardingState } = useOnboarding();
  const [currentPage, setCurrentPage] = useState(0);
  const pagerRef = useRef<PagerViewHandle | null>(null);

  const basePageStyles: ViewStyle = {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1,
    },
    pagerView: {
      flex: 1,
      zIndex: 2,
    },
    page: basePageStyles,
    backgroundImage: {
      ...StyleSheet.absoluteFill,
      zIndex: 0,
    },
    backgroundScrim: {
      ...StyleSheet.absoluteFill,
      zIndex: 1,
    },
    contentPanel: {
      alignItems: 'center',
      backgroundColor: 'rgba(18, 11, 16, 0.72)',
      borderColor: 'rgba(255, 255, 255, 0.16)',
      borderRadius: 28,
      borderWidth: 1,
      maxWidth: 560,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xl,
      width: '100%',
    },
    brandContainer: {
      alignItems: 'center',
      marginBottom: spacing.xl,
    },
    heroLogoContainer: {
      marginBottom: spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoContainer: {
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: 'rgba(255, 255, 255, 0.12)',
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: spacing.xl,
      borderWidth: 3,
      borderColor: 'rgba(255, 255, 255, 0.22)',
    },
    emoji: {
      fontSize: 60,
    },
    title: {
      ...typography.titleL,
      color: '#FFFFFF',
      textAlign: 'center',
      marginBottom: spacing.sm,
    },
    description: {
      ...typography.bodyS,
      color: 'rgba(255, 255, 255, 0.84)',
      textAlign: 'center',
      marginBottom: spacing.xl,
      lineHeight: 22,
    },
    featuresContainer: {
      width: '100%',
      paddingHorizontal: spacing.md,
    },
    featureItem: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: spacing.sm,
      paddingVertical: spacing.xs,
    },
    featureIcon: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: spacing.sm,
    },
    featureText: {
      ...typography.bodyS,
      color: '#FFFFFF',
      flex: 1,
    },
    tagline: {
      ...typography.bodyS,
      color: 'rgba(255, 255, 255, 0.82)',
      marginTop: spacing.xs,
      fontStyle: 'italic',
      fontFamily: fontFamilies.text,
    },
    footer: {
      backgroundColor: 'rgba(14, 9, 13, 0.78)',
      borderTopColor: 'rgba(255, 255, 255, 0.12)',
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.lg,
      paddingBottom: spacing.xxl,
      zIndex: 3,
    },
    pagination: {
      flexDirection: 'row',
      justifyContent: 'center',
      marginBottom: spacing.xxl,
      gap: spacing.xs,
    },
    paginationDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    activeDot: {
      backgroundColor: colors.primary,
    },
    inactiveDot: {
      backgroundColor: 'rgba(255, 255, 255, 0.42)',
    },
    buttonContainer: {
      gap: spacing.sm,
    },
    buttonPill: {
      height: BUTTON_HEIGHT,
      borderRadius: BUTTON_RADIUS,
      justifyContent: 'center',
    },
    primaryShadow: {
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
    },
  });

  const goToPage = (index: number) => {
    if (index < 0 || index >= onboardingData.length) {
      return;
    }
    setCurrentPage(index);
    if (pagerRef.current?.setPage) {
      pagerRef.current.setPage(index);
    }
  };

  const handleNext = async () => {
    if (currentPage < onboardingData.length - 1) {
      goToPage(currentPage + 1);
    } else {
      try {
        await markStepComplete('Onboarding');
      } catch (error) {
        devPrivacyWarn('onboarding progress persistence failed', {
          reason: getPrivacySafeErrorReason(error),
        });
      } finally {
        navigation.replace('PermissionGate');
      }
    }
  };

  const handleSkip = async () => {
    try {
      await markStepComplete('Onboarding');
    } catch (error) {
      devPrivacyWarn('onboarding skip persistence failed', {
        reason: getPrivacySafeErrorReason(error),
      });
    } finally {
      navigation.replace('PermissionGate');
    }
  };

  useEffect(() => {
    if (!onboardingState.steps.Onboarding) {
      return;
    }

    if (!onboardingState.steps.PermissionGate) {
      navigation.replace('PermissionGate');
      return;
    }

    if (!onboardingState.steps.StealthTriggerSetup) {
      navigation.replace('StealthTriggerSetup');
      return;
    }

    navigation.reset({
      index: 0,
      routes: [{ name: 'MainTabs' }],
    });
  }, [navigation, onboardingState.steps]);

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.container}>
        <ImageBackground
          source={backgroundImage}
          style={styles.backgroundImage}
          resizeMode="cover"
        >
          <LinearGradient
            colors={[
              'rgba(17, 10, 15, 0.48)',
              'rgba(17, 10, 15, 0.72)',
              'rgba(17, 10, 15, 0.92)',
            ]}
            locations={[0, 0.56, 1]}
            style={styles.backgroundScrim}
            pointerEvents="none"
          />
        </ImageBackground>

        <PagerView
          ref={pagerRef}
          style={styles.pagerView}
          initialPage={0}
          onPageSelected={(e) => setCurrentPage(e.nativeEvent.position)}
        >
          {onboardingData.map((item, index) => {
            const isFirstSlide = index === 0;
            return (
              <View key={index} style={styles.page}>
                <View style={styles.contentPanel}>
                  {isFirstSlide ? (
                    <View style={styles.brandContainer}>
                      <View style={styles.heroLogoContainer}>
                        <AppLogo width={220} height={72} />
                      </View>
                      <Text style={styles.tagline}>Your Safety Companion</Text>
                    </View>
                  ) : (
                    <View style={styles.logoContainer}>
                      <Text style={styles.emoji}>{item.emoji}</Text>
                    </View>
                  )}

                  <Text style={styles.title}>{item.title}</Text>
                  <Text style={styles.description}>{item.description}</Text>

                  <View style={styles.featuresContainer}>
                    {item.features.map((feature, featureIndex) => (
                      <View key={featureIndex} style={styles.featureItem}>
                        <View style={styles.featureIcon}>
                          <Text style={{ color: colors.background, fontSize: 12, fontWeight: 'bold' }}>✓</Text>
                        </View>
                        <Text style={styles.featureText}>{feature}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            );
          })}
        </PagerView>

        <View style={styles.footer}>
          <View style={styles.pagination}>
            {onboardingData.map((_, index) => (
              <View
                key={index}
                style={[
                  styles.paginationDot,
                  index === currentPage ? styles.activeDot : styles.inactiveDot,
                ]}
              />
            ))}
          </View>

          <View style={styles.buttonContainer}>
            <Button
              title={currentPage === onboardingData.length - 1 ? 'Start Using SafeRide' : 'Continue'}
              onPress={handleNext}
              fullWidth
              style={[styles.buttonPill, styles.primaryShadow]}
            />
            <Button
              title="Skip"
              onPress={handleSkip}
              variant="secondary"
              fullWidth
              style={styles.buttonPill}
            />
          </View>
        </View>
      </View>
    </Screen>
  );
}
