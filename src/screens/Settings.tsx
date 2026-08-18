import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import Screen from '../components/ui/Screen';
import { useTheme } from '../theme/SimpleThemeProvider';
import { RootStackParamList } from '../navigation/routes';
import { useToast } from '../components/ui/Toast';
import { getCatalogInfo, refreshProviders, refreshLegalTags, refreshTips } from '../lib/catalog';
import { useAuth } from '../context/AuthProvider';
import { useOnline } from '../context/OnlineProvider';
import { useLanguage } from '../context/LanguageProvider';
import { getSettingsCopy } from '../i18n/appLanguage';
import { getModeratedTestCopy } from '../i18n/languageAccessibilityCopy';
import { getMeasurementModeDecision } from '../lib/measurement/measurementConfig';
import { buildCatalogFreshnessSummary, buildCatalogRefreshSummary } from '../utils/supportDiscovery';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { borders, elevation, radii, spacing, typography } from '../theme/tokens';

type SettingsNavigationProp = NativeStackNavigationProp<RootStackParamList>;

type SettingRow = {
  key: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  meta?: string;
  disabled?: boolean;
  hideChevron?: boolean;
};

type SettingsSection = {
  key: string;
  label: string;
  rows: SettingRow[];
};

export default function SettingsScreen() {
  const navigation = useNavigation<SettingsNavigationProp>();
  const { colors } = useTheme();
  const toast = useToast();
  const { signOut, user } = useAuth();
  const { isOnline } = useOnline();
  const { languageCode } = useLanguage();
  const copy = getSettingsCopy(languageCode);
  const measurementCopy = getModeratedTestCopy(languageCode);
  const measurementDecision = useMemo(() => getMeasurementModeDecision(), []);

  const [updatingCatalogs, setUpdatingCatalogs] = useState(false);
  const [catalogStatusMessage, setCatalogStatusMessage] = useState<string>(copy.checkingCatalogStatus);

  useEffect(() => {
    (async () => {
      try {
        const info = await getCatalogInfo();
        setCatalogStatusMessage(buildCatalogFreshnessSummary(info));
      } catch {
        setCatalogStatusMessage(copy.catalogStatusUnavailable);
      }
    })();
  }, [copy.catalogStatusUnavailable]);

  const handleUpdateCatalogs = async () => {
    if (updatingCatalogs) return;
    setUpdatingCatalogs(true);
    try {
      const [providers, legalTags, tips] = await Promise.all([refreshProviders(), refreshLegalTags(), refreshTips()]);

      const summary = buildCatalogRefreshSummary([
        {
          label: 'Providers',
          source: providers.source,
          lastUpdated: providers.lastUpdated,
          itemCount: providers.items.length,
          error: providers.error,
        },
        {
          label: 'Rights tags',
          source: legalTags.source,
          lastUpdated: legalTags.lastUpdated,
          itemCount: legalTags.items.length,
          error: legalTags.error,
        },
        {
          label: 'Tips',
          source: tips.source,
          lastUpdated: tips.lastUpdated,
          itemCount: tips.items.length,
          error: tips.error,
        },
      ]);
      const offlinePrefix = isOnline ? '' : copy.offlinePrefix;
      setCatalogStatusMessage(`${offlinePrefix}${summary.message}`);
      toast.show({ title: summary.title, message: `${offlinePrefix}${summary.message}`, variant: summary.variant });
    } catch (e) {
      const message = copy.catalogUpdateFailed;
      setCatalogStatusMessage(message);
      toast.show({ title: copy.catalogUpdateFailedTitle, message, variant: 'error' });
    } finally {
      setUpdatingCatalogs(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await AsyncStorage.removeItem('NAVIGATION_STATE');
      await signOut();
      toast.show({ title: copy.signedOut, variant: 'info' });
    } catch (error) {
      console.warn('Failed to sign out', error);
      toast.show({ title: copy.signOutFailed, variant: 'error' });
    }
  };

  const displayName =
    user?.user_metadata?.full_name ||
    user?.email?.split('@')?.[0] ||
    copy.noAccountRider;
  const email = user?.email ?? copy.noAccountSession;

  const settingSections: SettingsSection[] = [
    {
      key: 'profile',
      label: copy.profileAccount,
      rows: [
        {
          key: 'account',
          title: copy.account,
          meta: email,
          icon: 'person-circle-outline',
          hideChevron: true,
        },
        {
          key: 'sign-out',
          title: copy.signOut,
          icon: 'log-out-outline',
          onPress: handleSignOut,
        },
      ],
    },
    {
      key: 'preferences',
      label: copy.preferences,
      rows: [
        {
          key: 'safety-settings',
          title: copy.safetySettings,
          icon: 'shield-outline',
          onPress: () => navigation.navigate('SafetySettings'),
        },
        {
          key: 'privacy-data',
          title: copy.privacyData,
          icon: 'lock-closed-outline',
          onPress: () => navigation.navigate('PrivacyData'),
        },
        {
          key: 'update-catalogs',
          title: updatingCatalogs ? copy.refreshingCatalogs : copy.refreshSupportCatalogs,
          meta: copy.catalogMeta,
          icon: 'refresh-outline',
          onPress: handleUpdateCatalogs,
          disabled: updatingCatalogs,
        },
        {
          key: 'language-accessibility',
          title: copy.languageAccessibility,
          meta: copy.languageMeta,
          icon: 'globe-outline',
          onPress: () => navigation.navigate('LanguageAccessibility'),
        },
        ...(measurementDecision.enabled ? [{
          key: 'moderated-test',
          title: measurementCopy.settingsTitle,
          meta: measurementCopy.settingsMeta,
          icon: 'clipboard-outline',
          onPress: () => navigation.navigate('TestMeasurementConsent'),
        } satisfies SettingRow] : []),
      ],
    },
    {
      key: 'waymo',
      label: copy.supportInfo,
      rows: [
        {
          key: 'tips-rights',
          title: copy.tipsRights,
          icon: 'bulb-outline',
          onPress: () => navigation.navigate('TipsRights'),
        },
        {
          key: 'about-legal',
          title: copy.aboutLegal,
          icon: 'information-circle-outline',
          onPress: () => navigation.navigate('AboutLegal'),
        },
      ],
    },
  ];

  const styles = StyleSheet.create({
    scrollContent: {
      paddingTop: spacing.md,
      paddingBottom: 34 + 24,
      paddingHorizontal: spacing.gutter,
      backgroundColor: colors.canvas,
      gap: spacing.md,
    },
    header: {
      marginBottom: spacing.xs,
    },
    summaryCard: {
      backgroundColor: colors.surface,
      borderColor: colors.divider,
      borderRadius: radii.card,
      borderWidth: borders.hairline,
      gap: spacing.xs,
      overflow: 'hidden',
      padding: spacing.sm,
      paddingTop: spacing.sm + 2,
      position: 'relative',
      ...elevation.card,
    },
    summaryTopRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.sm,
    },
    summaryIcon: {
      alignItems: 'center',
      backgroundColor: colors.privacyMuted,
      borderColor: colors.privacy + '33',
      borderRadius: radii.card,
      borderWidth: borders.hairline,
      height: 38,
      justifyContent: 'center',
      width: 38,
    },
    summaryCopy: {
      flex: 1,
      minWidth: 0,
    },
    summaryEyebrow: {
      ...typography.overline,
      color: colors.textSecondary,
      textTransform: 'uppercase',
    },
    summaryTitle: {
      ...typography.titleMedium,
      color: colors.textPrimary,
    },
    summaryMeta: {
      ...typography.caption,
      color: colors.textSecondary,
      marginTop: spacing.xxxs,
    },
    summaryStatusRow: {
      alignItems: 'center',
      borderColor: colors.divider,
      borderRadius: radii.card,
      borderWidth: borders.hairline,
      flexDirection: 'row',
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xxs,
    },
    catalogStatusText: {
      ...typography.caption,
      color: colors.textSecondary,
      flex: 1,
      lineHeight: 16,
    },
    section: {
      marginTop: spacing.sm,
    },
    sectionLabel: {
      ...typography.labelSmall,
      color: colors.textSecondary,
      marginBottom: spacing.xs,
      textTransform: 'uppercase',
    },
    card: {
      backgroundColor: colors.surface,
      borderColor: colors.divider,
      borderRadius: radii.card,
      borderWidth: borders.hairline,
      overflow: 'hidden',
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      position: 'relative',
      ...elevation.card,
    },
    cardAccentTop: {
      backgroundColor: colors.primary,
      height: 4,
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 56,
      borderRadius: radii.card,
      paddingHorizontal: spacing.xs,
    },
    rowPressed: {
      backgroundColor: colors.surfaceAlt,
    },
    rowDisabled: {
      opacity: 0.6,
    },
    rowIcon: {
      marginRight: 12,
    },
    rowContent: {
      flex: 1,
    },
    rowTitle: {
      ...typography.bodyM,
      color: colors.textPrimary,
    },
    rowMeta: {
      ...typography.caption,
      color: colors.textTertiary,
      marginTop: 4,
    },
    chevron: {
      marginLeft: 12,
    },
    divider: {
      height: 1,
      backgroundColor: colors.divider,
    },
  });

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.summaryCard}>
            <View pointerEvents="none" style={styles.cardAccentTop} />
            <View style={styles.summaryTopRow}>
              <View style={styles.summaryIcon}>
                <Ionicons name="person-circle-outline" size={22} color={colors.privacy} />
              </View>
              <View style={styles.summaryCopy}>
                <Text style={styles.summaryEyebrow}>{copy.settingsEyebrow}</Text>
                <Text style={styles.summaryTitle} numberOfLines={1}>{displayName}</Text>
                <Text style={styles.summaryMeta} numberOfLines={1}>{email}</Text>
              </View>
            </View>
            <View style={styles.summaryStatusRow}>
              <Ionicons name={isOnline ? 'cloud-done-outline' : 'cloud-offline-outline'} size={15} color={colors.primary} />
              <Text style={styles.catalogStatusText} numberOfLines={2}>{catalogStatusMessage}</Text>
            </View>
          </View>
        </View>

        {settingSections.map((section) => (
          <View key={section.key} style={styles.section}>
            <Text style={styles.sectionLabel}>{section.label}</Text>
            <View style={styles.card}>
              <View pointerEvents="none" style={styles.cardAccentTop} />
              {section.rows.map((row, index) => (
                <React.Fragment key={row.key}>
                  {index > 0 && <View style={styles.divider} />}
                  <Pressable
                    onPress={row.onPress}
                    disabled={!row.onPress || row.disabled}
                    style={({ pressed }) => [
                      styles.row,
                      pressed && !(row.disabled || !row.onPress) && styles.rowPressed,
                      row.disabled && styles.rowDisabled,
                    ]}
                  >
                    <Ionicons
                      name={row.icon}
                      size={24}
                      color={colors.primary}
                      style={styles.rowIcon}
                    />
                    <View style={styles.rowContent}>
                      <Text style={styles.rowTitle}>{row.title}</Text>
                      {row.meta ? <Text style={styles.rowMeta}>{row.meta}</Text> : null}
                    </View>
                    {!row.hideChevron && (
                      <Ionicons
                        name="chevron-forward"
                        size={18}
                        color={colors.textTertiary}
                        style={styles.chevron}
                      />
                    )}
                  </Pressable>
                </React.Fragment>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}
