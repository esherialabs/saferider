import React, { useCallback, useState } from 'react';
import {
  Alert,
  ImageBackground,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';

import { Button, InfoModal, InfoModalBullet, InfoModalSection } from '../components/ui';
import { useAuth } from '../context/AuthProvider';
import { RootStackParamList } from '../navigation/routes';
import { useTheme } from '../theme/SimpleThemeProvider';
import { borders, elevation, radii, spacing, typography } from '../theme/tokens';
import {
  getDialUrl,
  KENYA_POLICE_EMERGENCY_CONTACT,
  KENYA_SUPPORT_RESOURCES,
  PRIMARY_KENYA_GBV_CONTACT,
  type SupportContact,
} from '../lib/supportResources';
import { useToast } from '../components/ui/Toast';

type LandingNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Landing'>;

type HelpCard = {
  id: string;
  title: string;
  meta: string;
  contact: SupportContact;
  icon: keyof typeof Ionicons.glyphMap;
  tone: 'support' | 'critical' | 'safety';
};

const HELP_CARDS: HelpCard[] = [
  {
    id: 'police',
    title: 'Emergency',
    meta: 'Police or urgent danger',
    contact: KENYA_POLICE_EMERGENCY_CONTACT,
    icon: 'call-outline',
    tone: 'critical',
  },
  {
    id: 'gbv',
    title: 'GBV support',
    meta: 'Confidential help and referrals',
    contact: PRIMARY_KENYA_GBV_CONTACT,
    icon: 'heart-outline',
    tone: 'support',
  },
  {
    id: 'child',
    title: 'Child protection',
    meta: 'For children or child safety',
    contact: KENYA_SUPPORT_RESOURCES.childHelpline,
    icon: 'shield-checkmark-outline',
    tone: 'safety',
  },
];

export default function LandingScreen() {
  const navigation = useNavigation<LandingNavigationProp>();
  const { colors } = useTheme();
  const toast = useToast();
  const { signInAnonymously, isLoading } = useAuth();
  const [activeHelp, setActiveHelp] = useState<SupportContact | null>(null);
  const [isGuestStarting, setIsGuestStarting] = useState(false);

  const confirmDial = useCallback(
    (contact: SupportContact, phoneNumber = contact.phoneNumbers[0]) => {
      Alert.alert(
        `Call ${contact.displayPhone}`,
        `SafeRide will open your phone dialer for ${contact.shortLabel}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open dialer',
            onPress: () => {
              Linking.openURL(getDialUrl(phoneNumber, Platform.OS)).catch(() => {
                toast.show({
                  title: 'Dial failed',
                  message: 'Unable to launch the phone dialer.',
                  variant: 'error',
                });
              });
            },
          },
        ],
      );
    },
    [toast],
  );

  const handleGuest = useCallback(async () => {
    setIsGuestStarting(true);
    try {
      const result = await signInAnonymously();
      toast.show({
        title: 'No-account session',
        message:
          result === 'owned-auth'
            ? 'You can continue without creating an email or phone account.'
            : 'You are in local-only mode. Optional online services can be connected later.',
        variant: result === 'owned-auth' ? 'success' : 'warning',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start a no-account session.';
      toast.show({
        title: 'No-account sign-in failed',
        message,
        variant: 'error',
      });
    } finally {
      setIsGuestStarting(false);
    }
  }, [signInAnonymously, toast]);

  const styles = StyleSheet.create({
    safeArea: {
      backgroundColor: colors.canvas,
      flex: 1,
    },
    scrollContent: {
      flexGrow: 1,
      paddingBottom: spacing.xxl,
    },
    hero: {
      minHeight: 284,
      justifyContent: 'flex-end',
      overflow: 'hidden',
    },
    heroImage: {
      height: '100%',
      width: '100%',
    },
    heroOverlay: {
      ...StyleSheet.absoluteFill,
      backgroundColor: 'rgba(48, 19, 35, 0.66)',
      zIndex: 1,
    },
    heroContent: {
      gap: spacing.md,
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.lg,
      paddingTop: spacing.xxl,
      zIndex: 2,
    },
    eyebrow: {
      ...typography.overline,
      color: 'rgba(255,248,243,0.78)',
      textTransform: 'uppercase',
    },
    brandLine: {
      alignItems: 'baseline',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    title: {
      ...typography.displaySmall,
      color: colors.textInverse,
      fontWeight: '900',
      maxWidth: 340,
    },
    country: {
      ...typography.titleMedium,
      color: 'rgba(255,248,243,0.82)',
      fontWeight: '800',
    },
    subtitle: {
      ...typography.bodyMedium,
      color: 'rgba(255,248,243,0.9)',
      maxWidth: 330,
    },
    content: {
      gap: spacing.lg,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
    },
    sectionTitle: {
      ...typography.headlineSmall,
      color: colors.foreground,
    },
    sectionSubtitle: {
      ...typography.bodyMedium,
      color: colors.textSecondary,
    },
    helpPanel: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radii.card,
      borderWidth: borders.hairline,
      overflow: 'hidden',
      position: 'relative',
      ...elevation.card,
    },
    helpPanelHeader: {
      gap: spacing.xxs,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
      paddingTop: spacing.lg,
    },
    helpRows: {
      borderTopColor: colors.divider,
      borderTopWidth: borders.hairline,
    },
    helpRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.sm,
      minHeight: 68,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    cardAccentTop: {
      height: 4,
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    helpIcon: {
      alignItems: 'center',
      borderRadius: radii.card,
      height: 42,
      justifyContent: 'center',
      width: 42,
    },
    helpCopy: {
      flex: 1,
      minWidth: 0,
    },
    helpLabel: {
      ...typography.labelLarge,
      color: colors.foreground,
    },
    helpMeta: {
      ...typography.caption,
      color: colors.textSecondary,
      marginTop: spacing.xxxs,
    },
    phonePill: {
      ...typography.titleMedium,
      color: colors.foreground,
      marginTop: spacing.xxs,
    },
    helpActions: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.xs,
      marginLeft: 'auto',
      marginTop: 0,
    },
    callButton: {
      alignItems: 'center',
      borderRadius: radii.button,
      flexDirection: 'row',
      gap: spacing.xs,
      justifyContent: 'center',
      minHeight: 38,
      minWidth: 76,
      paddingHorizontal: spacing.sm,
    },
    callButtonText: {
      ...typography.labelMedium,
      color: colors.textInverse,
    },
    iconButton: {
      alignItems: 'center',
      borderRadius: radii.round,
      height: 38,
      justifyContent: 'center',
      width: 38,
    },
    authPanel: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radii.card,
      borderWidth: borders.hairline,
      gap: spacing.sm,
      overflow: 'hidden',
      padding: spacing.md,
      position: 'relative',
      ...elevation.card,
    },
    authTitle: {
      ...typography.titleMedium,
      color: colors.foreground,
    },
    authText: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    authActions: {
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
  });

  const toneStyles = {
    support: {
      backgroundColor: colors.supportMuted,
      iconColor: colors.support,
      buttonBackground: colors.support,
    },
    critical: {
      backgroundColor: colors.criticalMuted,
      iconColor: colors.critical,
      buttonBackground: colors.critical,
    },
    safety: {
      backgroundColor: colors.safetyMuted,
      iconColor: colors.safety,
      buttonBackground: colors.safety,
    },
  };

  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <ImageBackground
          source={require('../../assets/images/saferide-warm-transit-hero.webp')}
          resizeMode="cover"
          style={styles.hero}
          imageStyle={styles.heroImage}
          accessibilityIgnoresInvertColors
        >
          <View style={styles.heroOverlay} />
          <View style={styles.heroContent}>
            <View>
              <Text style={styles.eyebrow}>Private help, your pace</Text>
              <View style={styles.brandLine}>
                <Text style={styles.title}>SafeRide</Text>
                <Text style={styles.country}>Kenya</Text>
              </View>
              <Text style={styles.subtitle}>
                Start without an account. Save details on this phone. Choose support only when you are ready.
              </Text>
            </View>
          </View>
        </ImageBackground>

        <View style={styles.content}>
          <View style={styles.authPanel}>
            <View pointerEvents="none" style={[styles.cardAccentTop, { backgroundColor: colors.primary }]} />
            <Text style={styles.authTitle}>Start in private</Text>
            <Text style={styles.authText}>
              Use SafeRide first without giving account details. Sync can wait until you choose it.
            </Text>
            <View style={styles.authActions}>
              <Button
                title="Continue without an account"
                onPress={handleGuest}
                loading={isGuestStarting}
                disabled={isGuestStarting || isLoading}
                fullWidth
              />
              <Button
                title="Sign in"
                variant="secondary"
                onPress={() => navigation.navigate('Auth', { action: 'sign-in' })}
                fullWidth
              />
              <Button
                title="Create account"
                variant="outline"
                onPress={() => navigation.navigate('Auth', { action: 'sign-up' })}
                fullWidth
              />
            </View>
          </View>

          <View style={styles.helpPanel}>
            <View pointerEvents="none" style={[styles.cardAccentTop, { backgroundColor: colors.support }]} />
            <View style={styles.helpPanelHeader}>
              <Text style={styles.sectionTitle}>Help numbers</Text>
              <Text style={styles.sectionSubtitle}>
                Tap a number only when it is safe. Calls may appear in phone records.
              </Text>
            </View>
            <View style={styles.helpRows}>
              {HELP_CARDS.map((item) => {
                const tone = toneStyles[item.tone];
                return (
                  <View
                    key={item.id}
                    style={styles.helpRow}
                  >
                    <View style={[styles.helpIcon, { backgroundColor: tone.backgroundColor }]}>
                      <Ionicons name={item.icon} size={22} color={tone.iconColor} />
                    </View>
                    <View style={styles.helpCopy}>
                      <Text style={styles.helpLabel}>{item.title}</Text>
                      <Text style={styles.helpMeta} numberOfLines={1}>{item.meta}</Text>
                    </View>
                    <View style={styles.helpActions}>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Call ${item.title} at ${item.contact.displayPhone}`}
                        activeOpacity={0.88}
                        onPress={() => confirmDial(item.contact)}
                        style={[styles.callButton, { backgroundColor: tone.buttonBackground }]}
                      >
                        <Ionicons name="call" size={17} color={colors.textInverse} />
                        <Text style={styles.callButtonText} numberOfLines={1}>{item.contact.displayPhone}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Details for ${item.title}`}
                        activeOpacity={0.86}
                        onPress={() => setActiveHelp(item.contact)}
                        style={[styles.iconButton, { backgroundColor: colors.primaryMuted }]}
                      >
                        <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      </ScrollView>

      <InfoModal
        visible={Boolean(activeHelp)}
        title={activeHelp?.label ?? 'Support contact'}
        description={activeHelp?.description}
        onClose={() => setActiveHelp(null)}
      >
        {activeHelp ? (
          <>
            <InfoModalSection title="Number">
              <InfoModalBullet>{activeHelp.displayPhone}</InfoModalBullet>
              <InfoModalBullet>Availability: {activeHelp.availability}</InfoModalBullet>
            </InfoModalSection>
            <InfoModalSection title="Before calling">
              <InfoModalBullet>SafeRide opens your device dialer only after you confirm.</InfoModalBullet>
              <InfoModalBullet>Phone calls can appear in device, carrier, or account records.</InfoModalBullet>
            </InfoModalSection>
            <Button title={`Call ${activeHelp.displayPhone}`} onPress={() => confirmDial(activeHelp)} fullWidth />
          </>
        ) : null}
      </InfoModal>
    </SafeAreaView>
  );
}
