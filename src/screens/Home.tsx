import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { CompositeNavigationProp, useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import {
  ActionSheet,
  Button,
  DashboardTemplate,
  InfoModal,
  InfoModalBullet,
  InfoModalSection,
} from '../components/ui';
import { RootStackParamList, MainTabParamList } from '../navigation/routes';
import { resetReportStackToRoute } from '../navigation/reportNavigation';
import { useStealthMode } from '../hooks/useStealthMode';
import { useToast } from '../components/ui/Toast';
import { useTheme } from '../theme/SimpleThemeProvider';
import { borders, elevation, radii, spacing, typography } from '../theme/tokens';
import { draftStorage, type DraftData } from '../utils/draftStorage';
import { getReportWizardProgress, getReportWizardResumeTarget } from '../navigation/reportPathwayFlow';
import { getEditableReportDrafts } from '../utils/reportDraftSelection';
import { getProvidersWithInfo, type CatalogLoadSource, type Provider as CatalogProvider } from '../lib/catalog';
import {
  getDialUrl,
  KENYA_POLICE_EMERGENCY_CONTACT,
  PRIMARY_KENYA_GBV_CONTACT,
} from '../lib/supportResources';
import { buildCatalogStatusLine } from '../utils/supportDiscovery';
import { captureMeasurementEvent } from '../lib/measurement/localEventStore';

type HomeNavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Home'>,
  NativeStackNavigationProp<RootStackParamList>
>;

type DraftStepRoute = 'WhatHappened' | 'WhereWhen' | 'EvidenceDetail';
type HomeInfoTopic = 'report' | 'support' | 'cases' | 'learn' | 'immediate' | 'tips' | 'privacy';
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const REPORT_START_STEP: DraftStepRoute = 'WhatHappened';
const HORIZONTAL_PADDING = 24;
const TILE_GUTTER = 12;

function formatUpdatedAt(value?: Date) {
  if (!value || Number.isNaN(value.getTime())) {
    return 'Saved locally';
  }

  return `Updated ${value.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

export default function HomeScreen() {
  const navigation = useNavigation<HomeNavigationProp>();
  const { quickExit, quickExitAvailable } = useStealthMode();
  const toast = useToast();
  const { colors, mode, isHighContrast } = useTheme();
  const { width } = useWindowDimensions();
  const [searchQuery, setSearchQuery] = useState('');
  const [latestDraft, setLatestDraft] = useState<DraftData | null>(null);
  const [draftCount, setDraftCount] = useState(0);
  const [activeInfo, setActiveInfo] = useState<HomeInfoTopic | null>(null);
  const [isEmergencySheetVisible, setIsEmergencySheetVisible] = useState(false);
  const [supportProviders, setSupportProviders] = useState<CatalogProvider[]>([]);
  const [supportCatalogSource, setSupportCatalogSource] = useState<CatalogLoadSource>('seed');
  const [supportCatalogLastUpdated, setSupportCatalogLastUpdated] = useState<string | null>(null);
  const [supportCatalogError, setSupportCatalogError] = useState<string | null>(null);
  const [isSupportCatalogLoading, setIsSupportCatalogLoading] = useState(false);

  const tileWidth = useMemo(() => {
    return Math.max(124, Math.floor((width - HORIZONTAL_PADDING * 2 - TILE_GUTTER) / 2));
  }, [width]);

  const loadDrafts = useCallback(async () => {
    const drafts = await draftStorage.getAllDrafts();
    const activeDrafts = getEditableReportDrafts(drafts);

    setDraftCount(activeDrafts.length);
    setLatestDraft(activeDrafts[0] ?? null);
  }, []);

  // Refresh the dashboard when any draft write commits (autosave, sync,
  // another screen), not only on tab focus.
  useEffect(() => draftStorage.subscribe(() => {
    loadDrafts().catch(() => {});
  }), [loadDrafts]);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      loadDrafts().catch((error) => {
        console.warn('Failed to load home draft state', error);
        if (isActive) {
          toast.show({ title: 'Draft status unavailable', variant: 'error' });
        }
      });

      setIsSupportCatalogLoading(true);
      getProvidersWithInfo()
        .then(result => {
          if (!isActive) return;
          setSupportProviders(result.items);
          setSupportCatalogSource(result.source);
          setSupportCatalogLastUpdated(result.lastUpdated);
          setSupportCatalogError(result.error ? 'Provider update failed. Saved or bundled listings are shown.' : null);
        })
        .catch(error => {
          console.warn('Failed to load home support catalog', error);
          if (!isActive) return;
          setSupportProviders([]);
          setSupportCatalogSource('seed');
          setSupportCatalogLastUpdated(null);
          setSupportCatalogError('Provider catalog could not be loaded. Immediate contacts remain available.');
        })
        .finally(() => {
          if (isActive) {
            setIsSupportCatalogLoading(false);
          }
        });

      return () => {
        isActive = false;
      };
    }, [loadDrafts, toast]),
  );

  const latestDraftStatus = useMemo(() => {
    if (!latestDraft) {
      return draftCount > 0 ? `${draftCount} drafts in progress` : 'Saved on this device';
    }

    const progress = getReportWizardProgress(latestDraft);
    return `${progress.completedSteps}/${progress.totalSteps} steps - ${formatUpdatedAt(latestDraft.updatedAt)}`;
  }, [draftCount, latestDraft]);

  const supportCatalogStatus = useMemo(() => buildCatalogStatusLine({
    label: 'Providers',
    source: supportCatalogSource,
    lastUpdated: supportCatalogLastUpdated,
    itemCount: supportProviders.length,
    error: supportCatalogError,
  }), [supportCatalogError, supportCatalogLastUpdated, supportCatalogSource, supportProviders.length]);

  const supportProviderPreview = useMemo(() => {
    if (supportProviders.length === 0) {
      return 'No provider listings loaded. Immediate contacts still use the Kenya support catalog.';
    }

    const providerNames = supportProviders.slice(0, 3).map(provider => provider.name).join(' / ');
    return `${providerNames}${supportProviders.length > 3 ? ' / more in provider picker' : ''}`;
  }, [supportProviders]);

  const createDraftAndOpen = useCallback(
    async (routeName: DraftStepRoute) => {
      if (routeName === REPORT_START_STEP) {
        resetReportStackToRoute(navigation, REPORT_START_STEP, undefined);
        return;
      }

      resetReportStackToRoute(navigation, REPORT_START_STEP, undefined);
      toast.show({
        title: 'Start with what happened',
        message: 'SafeRide saves the local draft after the first report step.',
        variant: 'info',
      });
    },
    [navigation, toast],
  );

  const handleContinueDraft = useCallback(() => {
    captureMeasurementEvent({
      name: 'report_start',
      screenId: 'home',
      taskId: 'report-flow',
      outcome: 'started',
    });
    if (!latestDraft) {
      createDraftAndOpen(REPORT_START_STEP);
      return;
    }

    const target = getReportWizardResumeTarget(latestDraft);
    if (target.route === 'DraftOverview') {
      navigation.navigate('Cases');
      return;
    }
    resetReportStackToRoute(navigation, target.route, target.params as any);
  }, [createDraftAndOpen, latestDraft, navigation]);

  const handleAddEvidence = useCallback(() => {
    if (latestDraft) {
      resetReportStackToRoute(navigation, 'EvidenceDetail', { draftId: latestDraft.id });
      return;
    }

    createDraftAndOpen('EvidenceDetail');
  }, [createDraftAndOpen, latestDraft, navigation]);

  const handleOpenProviderSupport = useCallback(async () => {
    const draftId = draftStorage.generateDraftId();
    try {
      await draftStorage.saveDraft({
        id: draftId,
        selectedPathway: 'referral',
        currentStep: 'ReferralPicker',
      });
    } catch (error) {
      console.warn('Failed to initialize provider support draft:', error);
      toast.show({
        title: 'Draft save unavailable',
        message: 'SafeRide could not start a local referral draft on this device.',
        variant: 'error',
      });
      return;
    }

    resetReportStackToRoute(navigation, 'ReferralPicker', { draftId });
  }, [navigation, toast]);

  const dialSupportNumber = useCallback(
    (phoneNumber: string) => {
      Linking.openURL(getDialUrl(phoneNumber, Platform.OS)).catch(() => {
        toast.show({
          title: 'Dial failed',
          message: 'Unable to launch the phone dialer.',
          variant: 'error',
        });
      });
    },
    [toast],
  );

  const handleEmergency = useCallback(() => {
    setIsEmergencySheetVisible(true);
  }, []);

  const handleSearch = useCallback(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      toast.show({
        title: 'Search SafeRide',
        message: 'Try report, case, support, tips, or learn.',
        variant: 'info',
      });
      return;
    }

    if (query.includes('case') || query.includes('draft')) {
      navigation.navigate('Cases');
      return;
    }

    if (query.includes('support') || query.includes('help') || query.includes('chat')) {
      navigation.navigate('Support');
      return;
    }

    if (query.includes('tip') || query.includes('right')) {
      navigation.navigate('TipsRights');
      return;
    }

    if (query.includes('learn') || query.includes('video')) {
      navigation.navigate('Learn');
      return;
    }

    toast.show({
      title: 'No quick match',
      message: 'Use the cards below to open the main journeys.',
      variant: 'info',
    });
  }, [navigation, searchQuery, toast]);

  const isDarkMode = mode === 'dark';
  const inverseMutedText = isDarkMode ? 'rgba(16,9,8,0.72)' : 'rgba(255,248,243,0.88)';
  const inverseArtwork = isDarkMode ? 'rgba(16,9,8,0.18)' : 'rgba(255,248,243,0.22)';
  const inverseControlBackground = isDarkMode ? 'rgba(16,9,8,0.10)' : 'rgba(255,255,255,0.16)';
  const inverseControlBorder = isDarkMode ? 'rgba(16,9,8,0.16)' : 'rgba(255,255,255,0.22)';
  const inverseAccent = isDarkMode ? 'rgba(16,9,8,0.18)' : 'rgba(255,255,255,0.28)';

  const cardGradients = useMemo(() => {
    if (isHighContrast) {
      return {
        status: [colors.surface, colors.surface] as const,
        emergency: [colors.critical, colors.critical] as const,
        tips: [colors.surface, colors.surface] as const,
      };
    }

    if (mode === 'dark') {
      return {
        status: [colors.surfaceAlt, colors.surface] as const,
        emergency: [colors.critical, '#FFD5CF'] as const,
        tips: [colors.surfaceAlt, colors.primaryMuted] as const,
      };
    }

    return {
      status: [colors.surface, colors.safetyMuted] as const,
      emergency: [colors.critical, '#5F1422'] as const,
      tips: [colors.surface, colors.primaryMuted] as const,
    };
  }, [colors, isHighContrast, mode]);

  const tileThemes = useMemo(() => {
    if (isHighContrast) {
      return {
        report: {
          gradient: [colors.primary, colors.primary] as const,
          shadow: colors.primary,
          icon: 'document-text-outline' as IoniconName,
        },
        support: {
          gradient: [colors.support, colors.support] as const,
          shadow: colors.support,
          icon: 'chatbubbles-outline' as IoniconName,
        },
        cases: {
          gradient: [colors.evidence, colors.evidence] as const,
          shadow: colors.evidence,
          icon: 'folder-open' as IoniconName,
        },
        learn: {
          gradient: [colors.consent, colors.consent] as const,
          shadow: colors.consent,
          icon: 'play-circle-outline' as IoniconName,
        },
      };
    }

    if (mode === 'dark') {
      return {
        report: {
          gradient: [colors.primary, '#F0BBD4'] as const,
          shadow: colors.primary,
          icon: 'document-text-outline' as IoniconName,
        },
        support: {
          gradient: [colors.support, '#BEEBC9'] as const,
          shadow: colors.support,
          icon: 'chatbubbles-outline' as IoniconName,
        },
        cases: {
          gradient: [colors.evidence, '#C3E1FF'] as const,
          shadow: colors.evidence,
          icon: 'folder-open' as IoniconName,
        },
        learn: {
          gradient: [colors.consent, '#FFE0A8'] as const,
          shadow: colors.consent,
          icon: 'play-circle-outline' as IoniconName,
        },
      };
    }

    return {
      report: {
        gradient: [colors.primary, '#4F203D'] as const,
        shadow: colors.primary,
        icon: 'document-text-outline' as IoniconName,
      },
      support: {
        gradient: [colors.support, '#18412B'] as const,
        shadow: colors.support,
        icon: 'chatbubbles-outline' as IoniconName,
      },
      cases: {
        gradient: [colors.evidence, '#123E5C'] as const,
        shadow: colors.evidence,
        icon: 'folder-open' as IoniconName,
      },
      learn: {
        gradient: [colors.consent, '#5C2D0F'] as const,
        shadow: colors.consent,
        icon: 'play-circle-outline' as IoniconName,
      },
    };
  }, [colors, isHighContrast, mode]);

  const closeInfo = useCallback(() => setActiveInfo(null), []);

  const runFromInfo = useCallback((action: () => void) => {
    setActiveInfo(null);
    setTimeout(action, 120);
  }, []);

  return (
    <DashboardTemplate showNetworkStatus edges={['left', 'right']} scrollContentStyle={styles.scrollContent}>
      <View style={[styles.searchContainer, { backgroundColor: colors.surface, borderColor: colors.divider, shadowColor: colors.primary }]}>
        <View pointerEvents="none" style={[styles.searchAccent, { backgroundColor: colors.primary }]} />
        <Ionicons name="search-outline" size={20} color={colors.textTertiary} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          placeholder="Find reports, cases, tips, or support"
          placeholderTextColor={colors.textTertiary}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Search SafeRide"
          activeOpacity={0.8}
          style={styles.searchAction}
          onPress={handleSearch}
        >
          <Ionicons name="arrow-forward" size={20} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      <View
        style={[
          styles.emergencyButton,
          {
            shadowColor: colors.critical,
          },
        ]}
      >
        <LinearGradient
          colors={cardGradients.emergency}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.emergencyGradient}
        >
          <View style={[styles.emergencySignal, { backgroundColor: inverseAccent }]} />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open immediate help options"
            activeOpacity={0.9}
            onPress={handleEmergency}
            style={styles.emergencyPrimary}
          >
            <View style={[styles.emergencyIconShell, { backgroundColor: inverseControlBackground, borderColor: inverseControlBorder }]}>
              <Ionicons
                name="warning"
                size={24}
                color={colors.criticalForeground}
              />
            </View>
            <View style={styles.emergencyCopy}>
              <Text style={[styles.emergencyText, { color: colors.criticalForeground }]}>
                Immediate Help
              </Text>
              <Text style={[styles.emergencySubtext, { color: colors.criticalForeground }]}>
                Kenya: 1195, 999, 112, or Quick Exit
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.criticalForeground} />
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="More about immediate help"
            activeOpacity={0.85}
            onPress={() => setActiveInfo('immediate')}
            style={[styles.emergencyMoreButton, { borderTopColor: inverseControlBorder }]}
          >
            <Ionicons name="information-circle-outline" size={16} color={colors.criticalForeground} />
            <Text style={[styles.moreButtonText, { color: colors.criticalForeground }]}>More</Text>
          </TouchableOpacity>
        </LinearGradient>
      </View>

      <View style={styles.tileRow}>
        <View style={[styles.actionTile, { width: tileWidth, shadowColor: tileThemes.report.shadow }]}>
          <LinearGradient
            colors={tileThemes.report.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.tileGradient}
          >
          <View style={[styles.tileAccentRail, { backgroundColor: inverseAccent }]} />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={latestDraft ? 'Continue latest draft' : 'Start a report'}
            activeOpacity={0.94}
            onPress={handleContinueDraft}
            style={styles.tilePrimary}
          >
            <Text style={[styles.tileLabel, { color: colors.textInverse }]}>{latestDraft ? 'Continue draft' : 'File report'}</Text>
            <Text style={[styles.tileMeta, { color: inverseMutedText }]} numberOfLines={2}>{latestDraftStatus}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="More about reports"
            activeOpacity={0.85}
            onPress={() => setActiveInfo('report')}
            style={[styles.tileInfoButton, { backgroundColor: inverseControlBackground, borderColor: inverseControlBorder }]}
          >
            <Ionicons name="information-circle-outline" size={18} color={colors.textInverse} />
          </TouchableOpacity>
          <View style={[styles.tileIconBadge, { backgroundColor: inverseControlBackground, borderColor: inverseControlBorder }]}>
            <Ionicons name={tileThemes.report.icon} size={26} color={colors.textInverse} />
          </View>
          <Ionicons name={tileThemes.report.icon} size={62} color={inverseArtwork} style={styles.tileArtworkIcon} />
          </LinearGradient>
        </View>

        <View style={[styles.actionTile, { width: tileWidth, shadowColor: tileThemes.support.shadow }]}>
          <LinearGradient
            colors={tileThemes.support.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.tileGradient}
          >
          <View style={[styles.tileAccentRail, { backgroundColor: inverseAccent }]} />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open support"
            activeOpacity={0.94}
            onPress={() => navigation.navigate('Support')}
            style={styles.tilePrimary}
          >
            <Text style={[styles.tileLabel, { color: colors.textInverse }]}>Quick support</Text>
            <Text style={[styles.tileMeta, { color: inverseMutedText }]} numberOfLines={2}>Chat and provider options</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="More about support"
            activeOpacity={0.85}
            onPress={() => setActiveInfo('support')}
            style={[styles.tileInfoButton, { backgroundColor: inverseControlBackground, borderColor: inverseControlBorder }]}
          >
            <Ionicons name="information-circle-outline" size={18} color={colors.textInverse} />
          </TouchableOpacity>
          <View style={[styles.tileIconBadge, { backgroundColor: inverseControlBackground, borderColor: inverseControlBorder }]}>
            <Ionicons name={tileThemes.support.icon} size={26} color={colors.textInverse} />
          </View>
          <Ionicons name={tileThemes.support.icon} size={62} color={inverseArtwork} style={styles.tileArtworkIcon} />
          </LinearGradient>
        </View>
      </View>

      <View style={styles.tileRow}>
        <View style={[styles.actionTile, { width: tileWidth, shadowColor: tileThemes.cases.shadow }]}>
          <LinearGradient
            colors={tileThemes.cases.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.tileGradient}
          >
          <View style={[styles.tileAccentRail, { backgroundColor: inverseAccent }]} />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open case tracker"
            activeOpacity={0.94}
            onPress={() => navigation.navigate('Cases')}
            style={styles.tilePrimary}
          >
            <Text style={[styles.tileLabel, { color: colors.textInverse }]}>Case Tracker</Text>
            <Text style={[styles.tileMeta, { color: inverseMutedText }]} numberOfLines={2}>Drafts and submissions</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="More about case tracking"
            activeOpacity={0.85}
            onPress={() => setActiveInfo('cases')}
            style={[styles.tileInfoButton, { backgroundColor: inverseControlBackground, borderColor: inverseControlBorder }]}
          >
            <Ionicons name="information-circle-outline" size={18} color={colors.textInverse} />
          </TouchableOpacity>
          <View style={[styles.tileIconBadge, { backgroundColor: inverseControlBackground, borderColor: inverseControlBorder }]}>
            <Ionicons name={tileThemes.cases.icon} size={26} color={colors.textInverse} />
          </View>
          <Ionicons name={tileThemes.cases.icon} size={62} color={inverseArtwork} style={styles.tileArtworkIcon} />
          </LinearGradient>
        </View>

        <View style={[styles.actionTile, { width: tileWidth, shadowColor: tileThemes.learn.shadow }]}>
          <LinearGradient
            colors={tileThemes.learn.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.tileGradient}
          >
          <View style={[styles.tileAccentRail, { backgroundColor: inverseAccent }]} />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open learning videos"
            activeOpacity={0.94}
            onPress={() => navigation.navigate('Learn')}
            style={styles.tilePrimary}
          >
            <Text style={[styles.tileLabel, { color: colors.textInverse }]}>Learn</Text>
            <Text style={[styles.tileMeta, { color: inverseMutedText }]} numberOfLines={2}>Saved guidance</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="More about learning resources"
            activeOpacity={0.85}
            onPress={() => setActiveInfo('learn')}
            style={[styles.tileInfoButton, { backgroundColor: inverseControlBackground, borderColor: inverseControlBorder }]}
          >
            <Ionicons name="information-circle-outline" size={18} color={colors.textInverse} />
          </TouchableOpacity>
          <View style={[styles.tileIconBadge, { backgroundColor: inverseControlBackground, borderColor: inverseControlBorder }]}>
            <Ionicons name={tileThemes.learn.icon} size={26} color={colors.textInverse} />
          </View>
          <Ionicons name={tileThemes.learn.icon} size={62} color={inverseArtwork} style={styles.tileArtworkIcon} />
          </LinearGradient>
        </View>
      </View>

      <View style={[styles.tipsCard, { shadowColor: colors.primary }]}>
        <LinearGradient
          colors={cardGradients.tips}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.tipsSurface, { borderColor: colors.divider }]}
        >
        <View pointerEvents="none" style={[styles.tipsAccent, { backgroundColor: colors.primary }]} />
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Open tips and rights"
          activeOpacity={0.9}
          onPress={() => navigation.navigate('TipsRights')}
          style={styles.tipsPrimary}
        >
          <View style={[styles.tipsIcon, { backgroundColor: colors.surface, borderColor: colors.primary + '22' }]}>
            <Ionicons name="book-outline" size={22} color={colors.primary} />
          </View>
          <View style={styles.tipsCopy}>
            <Text style={[styles.tipsTitle, { color: colors.foreground }]}>Tips and rights</Text>
            <Text style={[styles.tipsSubtitle, { color: colors.textSecondary }]}>
              PEP/EC, P3, evidence, 1195, and plain-language rights.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="More about tips and rights"
          activeOpacity={0.85}
          onPress={() => setActiveInfo('tips')}
          style={[styles.tipsMoreButton, { borderColor: colors.divider }]}
        >
          <Ionicons name="shield-checkmark-outline" size={16} color={colors.primary} />
          <Text style={[styles.tipsMoreText, { color: colors.primary }]}>About</Text>
        </TouchableOpacity>
        </LinearGradient>
      </View>

      <InfoModal
        visible={activeInfo === 'immediate'}
        title="Immediate help options"
        description="The card stays simple, while the details remain available when someone needs them."
        onClose={closeInfo}
      >
        <InfoModalSection title="What happens when you tap the card">
          <InfoModalBullet>SafeRide asks before opening the phone dialer.</InfoModalBullet>
          <InfoModalBullet>Options include {PRIMARY_KENYA_GBV_CONTACT.displayPhone}, 999, and 112.</InfoModalBullet>
          <InfoModalBullet>Quick Exit appears only when the calculator decoy can be unlocked.</InfoModalBullet>
        </InfoModalSection>
        <Button title={`Call ${PRIMARY_KENYA_GBV_CONTACT.shortLabel}`} onPress={() => runFromInfo(() => dialSupportNumber(PRIMARY_KENYA_GBV_CONTACT.phoneNumbers[0]))} fullWidth />
      </InfoModal>

      <InfoModal
        visible={activeInfo === 'report'}
        title="Report and draft journey"
        description="Start quickly, then fill in the extra release guidance only when needed."
        onClose={closeInfo}
      >
        <InfoModalSection title="Current draft status">
          <InfoModalBullet>{latestDraftStatus}</InfoModalBullet>
          <InfoModalBullet>Drafts are local first and can be resumed from the latest unfinished step.</InfoModalBullet>
          <InfoModalBullet>Provider, escalation, and map update routes confirm what leaves the device before sending.</InfoModalBullet>
        </InfoModalSection>
        <InfoModalSection title="Extra paths">
          <InfoModalBullet>Add evidence directly when the survivor already has files, audio, or notes.</InfoModalBullet>
          <InfoModalBullet>Continue draft uses the current wizard progress model instead of restarting.</InfoModalBullet>
        </InfoModalSection>
        <Button title="Add evidence to a draft" onPress={() => runFromInfo(handleAddEvidence)} fullWidth />
      </InfoModal>

      <InfoModal
        visible={activeInfo === 'support'}
        title="Support resources"
        description={isSupportCatalogLoading ? 'Loading provider details.' : supportCatalogStatus}
        onClose={closeInfo}
      >
        <InfoModalSection title="Provider preview">
          <InfoModalBullet>{supportProviderPreview}</InfoModalBullet>
          <InfoModalBullet>Referral details stay consent-gated. Nothing is sent from provider listings until review.</InfoModalBullet>
          {supportCatalogError ? <InfoModalBullet>{supportCatalogError}</InfoModalBullet> : null}
        </InfoModalSection>
        <InfoModalSection title="Immediate fallback">
          <InfoModalBullet>{PRIMARY_KENYA_GBV_CONTACT.shortLabel} is available as a centralized Kenya support contact.</InfoModalBullet>
          <InfoModalBullet>Chat and legal-aid information remain available from the Support tab.</InfoModalBullet>
        </InfoModalSection>
        <Button title="Open provider listings" onPress={() => runFromInfo(handleOpenProviderSupport)} fullWidth />
      </InfoModal>

      <InfoModal
        visible={activeInfo === 'cases'}
        title="Cases and submissions"
        description="Case tracking keeps the card compact, then exposes queue and follow-up detail here."
        onClose={closeInfo}
      >
        <InfoModalSection title="What you can review">
          <InfoModalBullet>Drafts in progress, saved local records, and synced cases are visible from Cases.</InfoModalBullet>
          <InfoModalBullet>Optional online sync shows status instead of pretending a send happened.</InfoModalBullet>
          <InfoModalBullet>Submitted cases keep follow-up space for additional information where supported.</InfoModalBullet>
        </InfoModalSection>
      </InfoModal>

      <InfoModal
        visible={activeInfo === 'learn'}
        title="Learning and guidance"
        description="Keep the home grid light while preserving the richer resource content."
        onClose={closeInfo}
      >
        <InfoModalSection title="What is inside">
          <InfoModalBullet>Saved guidance and learning materials are available without crowding the home screen.</InfoModalBullet>
          <InfoModalBullet>Tips and rights remain separate so urgent reporting and support actions stay easy to scan.</InfoModalBullet>
          <InfoModalBullet>Content is written as guidance, not legal, medical, or emergency-response advice.</InfoModalBullet>
        </InfoModalSection>
      </InfoModal>

      <InfoModal
        visible={activeInfo === 'tips'}
        title="Tips and rights"
        description="Fast guidance stays separate from the learning library so urgent next steps are easier to scan."
        onClose={closeInfo}
      >
        <InfoModalSection title="What is inside">
          <InfoModalBullet>Start here highlights care timing, 1195, P3, evidence handling, and rights before the full guide list.</InfoModalBullet>
          <InfoModalBullet>Each guide keeps source links and review labels where available.</InfoModalBullet>
          <InfoModalBullet>This is general information, not legal, medical, counselling, or emergency-response advice.</InfoModalBullet>
        </InfoModalSection>
        <Button title="Open tips and rights" onPress={() => runFromInfo(() => navigation.navigate('TipsRights'))} fullWidth />
      </InfoModal>

      <InfoModal
        visible={activeInfo === 'privacy'}
        title="Privacy and consent"
        description="The previous card structure stays, with the latest release caveats available on demand."
        onClose={closeInfo}
      >
        <InfoModalSection title="Sharing needs consent">
          <InfoModalBullet>Local reports stay on the device until a consent step is chosen.</InfoModalBullet>
          <InfoModalBullet>Provider referral, escalation, and anonymous map update paths show what will leave the device before sending.</InfoModalBullet>
          <InfoModalBullet>Offline or queued routes show sync status rather than hiding uncertainty.</InfoModalBullet>
        </InfoModalSection>
        <InfoModalSection title="Resource caveats">
          <InfoModalBullet>Support listings may come from remote, cached, or bundled catalog data.</InfoModalBullet>
          <InfoModalBullet>Safety and rights content should stay reviewed and Kenya-context aware before release.</InfoModalBullet>
        </InfoModalSection>
      </InfoModal>

      <ActionSheet
        visible={isEmergencySheetVisible}
        onClose={() => setIsEmergencySheetVisible(false)}
        title="Immediate Help - Kenya"
        message={
          quickExitAvailable
            ? 'Choose a support contact or open the calculator decoy.'
            : 'Choose a support contact. Quick Exit is unavailable until setup is complete.'
        }
        cancelText="Cancel"
        actions={[
          {
            title: `Call ${PRIMARY_KENYA_GBV_CONTACT.displayPhone}`,
            icon: 'call-outline',
            onPress: () => dialSupportNumber(PRIMARY_KENYA_GBV_CONTACT.phoneNumbers[0]),
          },
          {
            title: 'Call 999',
            icon: 'call-outline',
            destructive: true,
            onPress: () => dialSupportNumber(KENYA_POLICE_EMERGENCY_CONTACT.phoneNumbers[0]),
          },
          {
            title: 'Call 112',
            icon: 'call-outline',
            destructive: true,
            onPress: () => dialSupportNumber(KENYA_POLICE_EMERGENCY_CONTACT.phoneNumbers[1]),
          },
          ...(quickExitAvailable
            ? [{
              title: 'Quick Exit',
              icon: 'calculator-outline' as const,
              onPress: quickExit,
            }]
            : []),
        ]}
      />
    </DashboardTemplate>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    gap: TILE_GUTTER,
    paddingBottom: spacing.md,
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: spacing.lg,
  },
  searchContainer: {
    alignItems: 'center',
    borderRadius: radii.card,
    borderWidth: borders.hairline,
    flexDirection: 'row',
    height: 56,
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
    position: 'relative',
    ...elevation.card,
  },
  searchAccent: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
    width: 4,
  },
  searchInput: {
    ...typography.bodyS,
    flex: 1,
    marginLeft: spacing.xs,
    minWidth: 0,
  },
  searchAction: {
    alignItems: 'center',
    borderRadius: radii.round,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  statusPanel: {
    borderRadius: radii.card,
    overflow: 'hidden',
    ...elevation.card,
  },
  statusPanelSurface: {
    borderRadius: radii.card,
    borderWidth: borders.hairline,
    overflow: 'hidden',
    padding: spacing.md,
    position: 'relative',
  },
  statusAccent: {
    height: 3,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  statusHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statusIcon: {
    alignItems: 'center',
    borderRadius: radii.card,
    borderWidth: borders.hairline,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  statusCopy: {
    flex: 1,
    minWidth: 0,
  },
  statusTitle: {
    ...typography.titleMedium,
  },
  statusSubtitle: {
    ...typography.bodySmall,
    marginTop: spacing.xxxs,
  },
  statusGrid: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  statusMetric: {
    alignItems: 'center',
    borderRadius: radii.card,
    borderWidth: borders.hairline,
    flex: 1,
    gap: spacing.xxxs,
    justifyContent: 'center',
    minHeight: 64,
    overflow: 'hidden',
    padding: spacing.xs,
    position: 'relative',
  },
  metricAccent: {
    height: 3,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  statusMetricValue: {
    ...typography.titleLarge,
  },
  statusMetricLabel: {
    ...typography.labelSmall,
    textAlign: 'center',
  },
  emergencyButton: {
    alignItems: 'center',
    borderRadius: radii.card,
    elevation: 4,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
  },
  emergencyGradient: {
    borderRadius: radii.card,
    overflow: 'hidden',
    width: '100%',
  },
  emergencyPrimary: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 78,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    width: '100%',
  },
  emergencyIconShell: {
    alignItems: 'center',
    borderRadius: radii.card,
    borderWidth: borders.hairline,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  emergencyCopy: {
    flex: 1,
    minWidth: 0,
  },
  emergencyMoreButton: {
    alignItems: 'center',
    borderTopColor: 'rgba(255,255,255,0.22)',
    borderTopWidth: borders.hairline,
    flexDirection: 'row',
    gap: spacing.xxs,
    justifyContent: 'center',
    minHeight: 42,
    width: '100%',
  },
  moreButtonText: {
    ...typography.caption,
    fontWeight: '700',
  },
  emergencyText: {
    ...typography.titleLarge,
  },
  emergencySubtext: {
    ...typography.bodySmall,
    fontWeight: '600',
    marginTop: spacing.xxxs,
  },
  emergencySignal: {
    height: 3,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 1,
  },
  tileRow: {
    flexDirection: 'row',
    gap: TILE_GUTTER,
    justifyContent: 'space-between',
  },
  actionTile: {
    aspectRatio: 1,
    borderRadius: radii.card,
    elevation: 4,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
  },
  tileGradient: {
    borderRadius: radii.card,
    flex: 1,
    overflow: 'hidden',
  },
  tilePrimary: {
    flex: 1,
    padding: spacing.md,
    paddingRight: spacing.xl,
    paddingTop: 58,
  },
  tileLabel: {
    ...typography.titleS,
  },
  tileMeta: {
    ...typography.caption,
    marginTop: spacing.xxs,
    maxWidth: '92%',
  },
  tileArtworkIcon: {
    bottom: -2,
    position: 'absolute',
    right: spacing.xs,
  },
  tileIconBadge: {
    alignItems: 'center',
    borderRadius: radii.card,
    borderWidth: borders.hairline,
    height: 44,
    justifyContent: 'center',
    left: spacing.sm,
    position: 'absolute',
    top: spacing.sm,
    width: 44,
  },
  tileInfoButton: {
    alignItems: 'center',
    borderWidth: borders.hairline,
    borderRadius: radii.round,
    height: 34,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.xs,
    top: spacing.xs,
    width: 34,
  },
  tileAccentRail: {
    height: 3,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  tipsCard: {
    alignItems: 'center',
    borderRadius: radii.card,
    overflow: 'hidden',
    ...elevation.card,
  },
  tipsSurface: {
    borderRadius: radii.card,
    borderWidth: borders.hairline,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  tipsAccent: {
    height: 4,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  tipsPrimary: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    width: '100%',
  },
  tipsIcon: {
    alignItems: 'center',
    borderRadius: radii.card,
    borderWidth: borders.hairline,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  tipsCopy: {
    flex: 1,
    minWidth: 0,
  },
  tipsTitle: {
    ...typography.label,
  },
  tipsSubtitle: {
    ...typography.bodyS,
    marginTop: spacing.xxxs,
  },
  tipsMoreButton: {
    alignItems: 'center',
    borderTopWidth: borders.hairline,
    flexDirection: 'row',
    gap: spacing.xxs,
    justifyContent: 'center',
    minHeight: 42,
    width: '100%',
  },
  tipsMoreText: {
    ...typography.caption,
    fontWeight: '700',
  },
});
