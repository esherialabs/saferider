import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { CompositeNavigationProp, useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { Badge, Button, DashboardTemplate } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { MainTabParamList, RootStackParamList } from '../navigation/routes';
import { resetReportStackToRoute } from '../navigation/reportNavigation';
import {
  getReportWizardProgress,
  getReportWizardResumeTarget,
  type ReportWizardProgress,
  type ReportWizardStep,
} from '../navigation/reportPathwayFlow';
import { useTheme } from '../theme/SimpleThemeProvider';
import { borders, elevation, radii, spacing, typography } from '../theme/tokens';
import { draftStorage, type DraftData } from '../utils/draftStorage';
import { devPrivacyWarn, getPrivacySafeErrorReason } from '../utils/privacyLog';
import { getEditableReportDrafts } from '../utils/reportDraftSelection';

type ReportHubNavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Report'>,
  NativeStackNavigationProp<RootStackParamList>
>;

function formatSavedAt(value?: Date | null): string {
  if (!value || Number.isNaN(value.getTime())) {
    return 'Saved locally';
  }

  const now = Date.now();
  const diffMs = now - value.getTime();
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;

  if (diffMs >= 0 && diffMs < minuteMs) {
    return 'Saved just now';
  }

  if (diffMs >= 0 && diffMs < hourMs) {
    const minutes = Math.max(1, Math.floor(diffMs / minuteMs));
    return `Saved ${minutes} min ago`;
  }

  const today = new Date(now);
  if (
    value.getFullYear() === today.getFullYear() &&
    value.getMonth() === today.getMonth() &&
    value.getDate() === today.getDate()
  ) {
    return `Saved ${value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  return `Saved ${value.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function getResumeStep(progress: ReportWizardProgress): ReportWizardStep | undefined {
  return progress.steps.find((step) => step.status === 'current') ??
    progress.steps.find((step) => step.status === 'upcoming') ??
    progress.steps.at(-1);
}

function getStepBadgeVariant(status: ReportWizardStep['status']) {
  switch (status) {
    case 'complete':
      return 'success' as const;
    case 'current':
      return 'primary' as const;
    case 'skipped':
      return 'secondary' as const;
    case 'upcoming':
    default:
      return 'outline' as const;
  }
}

function getStepStatusLabel(status: ReportWizardStep['status']) {
  switch (status) {
    case 'complete':
      return 'Done';
    case 'current':
      return 'Next';
    case 'skipped':
      return 'Skipped';
    case 'upcoming':
    default:
      return 'Open';
  }
}

function getEvidenceSummary(draft: DraftData): string {
  const mediaCount = draft.mediaFiles?.length ?? 0;
  if (mediaCount > 0) {
    return `${mediaCount} evidence item${mediaCount === 1 ? '' : 's'}`;
  }

  if (draft.textEvidence?.trim()) {
    return 'Text evidence saved';
  }

  return 'No evidence yet';
}

export default function ReportHubScreen() {
  const navigation = useNavigation<ReportHubNavigationProp>();
  const { colors } = useTheme();
  const toast = useToast();
  const [drafts, setDrafts] = useState<DraftData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadDrafts = useCallback(async () => {
    const allDrafts = await draftStorage.getAllDrafts();
    return getEditableReportDrafts(allDrafts);
  }, []);

  // Refresh whenever a draft write commits so the workspace never shows a
  // stale draft list while it is on screen.
  useEffect(() => draftStorage.subscribe(() => {
    loadDrafts()
      .then((editableDrafts) => {
        setDrafts(editableDrafts);
        setLoadError(null);
      })
      .catch(() => {});
  }), [loadDrafts]);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      setIsLoading(true);

      loadDrafts()
        .then((editableDrafts) => {
          if (!isActive) return;
          setDrafts(editableDrafts);
          setLoadError(null);
        })
        .catch((error) => {
          devPrivacyWarn('report workspace draft load failed', {
            reason: getPrivacySafeErrorReason(error),
          });
          if (!isActive) return;
          setLoadError('Draft progress could not be loaded.');
          toast.show({ title: 'Draft progress unavailable', variant: 'error' });
        })
        .finally(() => {
          if (isActive) {
            setIsLoading(false);
          }
        });

      return () => {
        isActive = false;
      };
    }, [loadDrafts, toast]),
  );

  const latestDraft = drafts[0] ?? null;
  const otherDrafts = drafts.slice(1, 3);
  const progress = useMemo(() => latestDraft ? getReportWizardProgress(latestDraft) : null, [latestDraft]);
  const resumeStep = useMemo(() => progress ? getResumeStep(progress) : undefined, [progress]);
  const progressLabel = progress ? `${progress.completedSteps}/${progress.totalSteps}` : '0/4';
  const draftCountLabel = drafts.length === 1 ? '1 draft in progress' : `${drafts.length} drafts in progress`;
  const latestSavedLabel = latestDraft ? formatSavedAt(latestDraft.updatedAt) : 'No draft in progress';

  const styles = StyleSheet.create({
    scrollContent: {
      gap: spacing.lg,
      paddingBottom: spacing.xxl,
    },
    activePanel: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radii.card,
      borderWidth: borders.hairline,
      overflow: 'hidden',
      padding: spacing.lg,
      ...elevation.card,
    },
    panelAccent: {
      backgroundColor: latestDraft ? colors.primary : colors.info,
      height: 4,
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    panelTop: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.md,
      justifyContent: 'space-between',
      marginTop: spacing.xs,
    },
    panelTitleGroup: {
      flex: 1,
      minWidth: 0,
    },
    eyebrow: {
      ...typography.overline,
      color: colors.textTertiary,
      marginBottom: spacing.xxxs,
      textTransform: 'uppercase',
    },
    panelTitle: {
      ...typography.titleLarge,
      color: colors.foreground,
    },
    panelSubtitle: {
      ...typography.bodySmall,
      color: colors.textSecondary,
      marginTop: spacing.xs,
    },
    loadingRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.lg,
    },
    loadingText: {
      ...typography.bodySmall,
      color: colors.textSecondary,
    },
    progressTrack: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radii.round,
      height: 10,
      marginTop: spacing.lg,
      overflow: 'hidden',
    },
    progressFill: {
      backgroundColor: colors.primary,
      borderRadius: radii.round,
      height: '100%',
      width: `${progress?.percentage ?? 0}%`,
    },
    progressMeta: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
      justifyContent: 'space-between',
      marginTop: spacing.md,
    },
    metaText: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    currentStepRow: {
      alignItems: 'center',
      backgroundColor: colors.surfaceAlt,
      borderColor: colors.divider,
      borderRadius: radii.card,
      borderWidth: borders.hairline,
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.lg,
      padding: spacing.md,
    },
    currentIcon: {
      alignItems: 'center',
      backgroundColor: colors.primaryMuted,
      borderRadius: radii.round,
      height: 42,
      justifyContent: 'center',
      width: 42,
    },
    currentCopy: {
      flex: 1,
      minWidth: 0,
    },
    currentLabel: {
      ...typography.labelSmall,
      color: colors.textTertiary,
      marginBottom: spacing.xxxs,
      textTransform: 'uppercase',
    },
    currentTitle: {
      ...typography.titleSmall,
      color: colors.foreground,
    },
    currentDescription: {
      ...typography.bodySmall,
      color: colors.textSecondary,
      marginTop: spacing.xxxs,
    },
    stepPills: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
      marginTop: spacing.lg,
    },
    actions: {
      gap: spacing.sm,
    },
    actionRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    actionButton: {
      flex: 1,
    },
    recentPanel: {
      backgroundColor: colors.surface,
      borderColor: colors.divider,
      borderRadius: radii.card,
      borderWidth: borders.hairline,
      overflow: 'hidden',
    },
    recentHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
    },
    recentTitle: {
      ...typography.titleSmall,
      color: colors.foreground,
    },
    recentCount: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    recentRow: {
      alignItems: 'center',
      borderTopColor: colors.divider,
      borderTopWidth: borders.hairline,
      flexDirection: 'row',
      gap: spacing.sm,
      minHeight: 64,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    recentIcon: {
      alignItems: 'center',
      backgroundColor: colors.surfaceAlt,
      borderRadius: radii.round,
      height: 36,
      justifyContent: 'center',
      width: 36,
    },
    recentCopy: {
      flex: 1,
      minWidth: 0,
    },
    recentName: {
      ...typography.labelLarge,
      color: colors.foreground,
    },
    recentMeta: {
      ...typography.caption,
      color: colors.textSecondary,
      marginTop: spacing.xxxs,
    },
    errorText: {
      ...typography.bodySmall,
      color: colors.destructive,
      marginTop: spacing.md,
    },
  });

  const openDraft = useCallback((draft: DraftData) => {
    const target = getReportWizardResumeTarget(draft);
    if (target.route === 'DraftOverview') {
      navigation.navigate('Cases');
      return;
    }
    resetReportStackToRoute(navigation, target.route, target.params as any);
  }, [navigation]);

  const openNewReport = useCallback(() => {
    resetReportStackToRoute(navigation, 'WhatHappened', undefined);
  }, [navigation]);

  const handleContinue = useCallback(() => {
    if (latestDraft) {
      openDraft(latestDraft);
      return;
    }

    openNewReport();
  }, [latestDraft, openDraft, openNewReport]);

  const openEvidence = useCallback(() => {
    if (!latestDraft) {
      openNewReport();
      return;
    }

    resetReportStackToRoute(navigation, 'EvidenceDetail', { draftId: latestDraft.id });
  }, [latestDraft, navigation, openNewReport]);

  const openCases = useCallback(() => {
    navigation.navigate('Cases');
  }, [navigation]);

  return (
    <DashboardTemplate edges={['left', 'right']} scrollContentStyle={styles.scrollContent}>
      <View style={styles.activePanel}>
        <View pointerEvents="none" style={styles.panelAccent} />
        <View style={styles.panelTop}>
          <View style={styles.panelTitleGroup}>
            <Text style={styles.eyebrow}>Latest report</Text>
            <Text style={styles.panelTitle}>
              {latestDraft ? 'Continue where you stopped' : 'Start a report'}
            </Text>
            <Text style={styles.panelSubtitle}>
              {latestDraft
                ? `${draftCountLabel} - ${getEvidenceSummary(latestDraft)}`
                : 'No editable draft is waiting on this device.'}
            </Text>
          </View>
          <Badge variant={latestDraft ? 'primary' : 'info'} size="lg">
            {progressLabel}
          </Badge>
        </View>

        {isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.loadingText}>Loading draft progress</Text>
          </View>
        ) : null}

        {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}

        <View style={styles.progressTrack}>
          <View style={styles.progressFill} />
        </View>

        <View style={styles.progressMeta}>
          <Text style={styles.metaText}>{latestSavedLabel}</Text>
          <Text style={styles.metaText}>
            {progress ? `${progress.percentage}% complete` : 'Ready when needed'}
          </Text>
        </View>

        <View style={styles.currentStepRow}>
          <View style={styles.currentIcon}>
            <Ionicons
              name={latestDraft ? 'navigate-circle-outline' : 'create-outline'}
              size={22}
              color={colors.primary}
            />
          </View>
          <View style={styles.currentCopy}>
            <Text style={styles.currentLabel}>{latestDraft ? 'Resume step' : 'First step'}</Text>
            <Text style={styles.currentTitle}>{resumeStep?.label ?? 'What happened'}</Text>
            <Text style={styles.currentDescription} numberOfLines={2}>
              {resumeStep?.description ?? 'Begin with the incident pattern and only add details that feel safe.'}
            </Text>
          </View>
        </View>

        {progress ? (
          <View style={styles.stepPills}>
            {progress.steps.map((step) => (
              <Badge key={step.id} variant={getStepBadgeVariant(step.status)} size="sm">
                {step.label}: {getStepStatusLabel(step.status)}
              </Badge>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Button
          title={latestDraft ? 'Continue draft' : 'Start report'}
          onPress={handleContinue}
          fullWidth
          icon={<Ionicons name="arrow-forward" size={18} color={colors.primaryForeground} />}
          iconPosition="right"
        />
        {latestDraft ? (
          <View style={styles.actionRow}>
            <Button
              title="Add evidence"
              variant="outline"
              onPress={openEvidence}
              style={styles.actionButton}
            />
            <Button
              title="Cases"
              variant="secondary"
              onPress={openCases}
              style={styles.actionButton}
            />
          </View>
        ) : (
          <Button title="Review cases" variant="secondary" onPress={openCases} fullWidth />
        )}
      </View>

      {otherDrafts.length > 0 ? (
        <View style={styles.recentPanel}>
          <View style={styles.recentHeader}>
            <Text style={styles.recentTitle}>Other drafts</Text>
            <Text style={styles.recentCount}>
              {drafts.length - 1} more
            </Text>
          </View>
          {otherDrafts.map((draft) => {
            const draftProgress = getReportWizardProgress(draft);
            const draftStep = getResumeStep(draftProgress);

            return (
              <TouchableOpacity
                key={draft.id}
                accessibilityRole="button"
                accessibilityLabel={`Continue draft from ${draftStep?.label ?? 'next step'}`}
                activeOpacity={0.86}
                onPress={() => openDraft(draft)}
                style={styles.recentRow}
              >
                <View style={styles.recentIcon}>
                  <Ionicons name="document-text-outline" size={18} color={colors.textSecondary} />
                </View>
                <View style={styles.recentCopy}>
                  <Text style={styles.recentName} numberOfLines={1}>
                    {draftStep?.label ?? 'Draft'}
                  </Text>
                  <Text style={styles.recentMeta} numberOfLines={1}>
                    {draftProgress.completedSteps}/{draftProgress.totalSteps} steps - {formatSavedAt(draft.updatedAt)}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
    </DashboardTemplate>
  );
}
