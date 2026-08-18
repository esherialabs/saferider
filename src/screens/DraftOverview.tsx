import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import Screen from '../components/ui/Screen';
import Button from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card, CardContent, CardDescription, CardTitle } from '../components/ui/Card';
import { InfoModal, InfoModalBullet, InfoModalSection } from '../components/ui/InfoModal';
import { useTheme } from '../theme/SimpleThemeProvider';
import { RootStackParamList } from '../navigation/routes';
import {
  getReportWizardProgress,
  getReportWizardResumeTarget,
  isFinalReportDraftState,
  type ReportWizardStep,
} from '../navigation/reportPathwayFlow';
import { useDraftState } from '../hooks/useDraftState';
import { useReportDraftIdentity } from '../hooks/useReportDraftIdentity';
import { borders, elevation, radii, spacing, typography } from '../theme/tokens';

type DraftNavigationProp = NativeStackNavigationProp<RootStackParamList, 'DraftOverview'>;
type DraftOverviewRoute = keyof Pick<
  RootStackParamList,
  'WhatHappened' | 'WhereWhen' | 'EvidenceDetail' | 'ConsentGate'
>;

type DraftSection = {
  id: string;
  title: string;
  description: string;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: DraftOverviewRoute;
  steps: ReportWizardStep[];
  tone: 'primary' | 'support' | 'evidence' | 'privacy';
};

function getSectionStatus(steps: ReportWizardStep[]): ReportWizardStep['status'] {
  if (steps.some((step) => step.status === 'current')) return 'current';
  if (steps.length > 0 && steps.every((step) => step.status === 'complete' || step.status === 'skipped')) {
    return 'complete';
  }
  if (steps.some((step) => step.status === 'complete' || step.status === 'skipped')) return 'current';
  return 'upcoming';
}

function getStatusLabel(status: ReportWizardStep['status']) {
  switch (status) {
    case 'complete':
      return 'Done';
    case 'current':
      return 'Next';
    case 'skipped':
      return 'Skipped';
    case 'upcoming':
    default:
      return 'Upcoming';
  }
}

function formatSavedAt(value?: Date | null) {
  if (!value || Number.isNaN(value.getTime())) {
    return 'Saved locally as you work.';
  }

  return 'Last saved ' + value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function DraftOverviewScreen() {
  const navigation = useNavigation<DraftNavigationProp>();
  const route = useRoute<any>();
  const { colors } = useTheme();
  const routeDraftId = typeof route.params?.draftId === 'string' && route.params.draftId.trim()
    ? route.params.draftId
    : undefined;
  const {
    draftId: initialDraftId,
    isResolving: isResolvingDraftId,
    error: draftIdError,
  } = useReportDraftIdentity(routeDraftId, { initialStep: 'WhatHappened' });
  const { draftData, isSaving, lastSaved, error } = useDraftState(initialDraftId);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const progress = useMemo(() => getReportWizardProgress(draftData), [draftData]);

  useEffect(() => {
    if (isFinalReportDraftState(draftData)) {
      navigation.navigate('Cases');
    }
  }, [draftData, navigation]);

  const stepById = useMemo(() => {
    return new Map(progress.steps.map((step) => [step.id, step]));
  }, [progress.steps]);

  const sections = useMemo<DraftSection[]>(() => [
    {
      id: 'story',
      title: 'What happened',
      description: 'Capture the incident in your own words.',
      detail: 'The latest flow keeps incident pattern, description, impact, and immediate safety needs in this step. The card stays short so the survivor can start without reading the whole checklist.',
      icon: 'create-outline',
      route: 'WhatHappened',
      steps: [stepById.get('what-happened')].filter(Boolean) as ReportWizardStep[],
      tone: 'primary',
    },
    {
      id: 'place',
      title: 'Place and time',
      description: 'Add a place clue and optional timing details.',
      detail: 'This step carries location, time, duration, and context. It should stay optional where exact details are unsafe or unavailable.',
      icon: 'location-outline',
      route: 'WhereWhen',
      steps: [stepById.get('where-when')].filter(Boolean) as ReportWizardStep[],
      tone: 'support',
    },
    {
      id: 'evidence',
      title: 'Evidence',
      description: 'Attach files or notes when it feels safe.',
      detail: 'Evidence remains optional. The latest release copy labels privacy processing status, upload state, and platform limits instead of hiding uncertainty.',
      icon: 'images-outline',
      route: 'EvidenceDetail',
      steps: [stepById.get('evidence')].filter(Boolean) as ReportWizardStep[],
      tone: 'evidence',
    },
    {
      id: 'review',
      title: 'Review and next step',
      description: 'Choose private save, referral, map update, or escalation.',
      detail: 'This final step reviews the saved draft and lets her choose private save, map update, referral, or escalation. Extra detail opens only when that pathway needs it.',
      icon: 'shield-checkmark-outline',
      route: 'ConsentGate',
      steps: [stepById.get('review-next-step')].filter(Boolean) as ReportWizardStep[],
      tone: 'privacy',
    },
  ], [stepById]);

  const handleContinue = () => {
    if (!initialDraftId) {
      navigation.navigate('Cases');
      return;
    }

    if (!draftData) {
      navigation.navigate('Cases');
      return;
    }

    const target = getReportWizardResumeTarget(draftData);
    if (target.route === 'DraftOverview') {
      navigation.navigate('Cases');
      return;
    }
    navigation.navigate(target.route as any, target.params as any);
  };

  const saveStatus = error
    ? error
    : draftIdError
      ? draftIdError
      : isResolvingDraftId
        ? 'Opening local draft.'
        : isSaving
          ? 'Saving changes on this device.'
          : formatSavedAt(lastSaved ?? draftData?.updatedAt);

  const activeSection = useMemo(() => {
    return sections.find((section) => section.id === activeSectionId) ?? null;
  }, [activeSectionId, sections]);
  const activeSectionDetailSteps = useMemo(() => {
    return activeSection?.steps.flatMap((step) => (
      step.details && step.details.length > 0 ? step.details : [step]
    )) ?? [];
  }, [activeSection]);
  const canClose = navigation.canGoBack();

  const closeSectionInfo = () => setActiveSectionId(null);

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xl,
    },
    header: {
      marginBottom: spacing.xl,
    },
    eyebrow: {
      ...typography.overline,
      color: colors.textSecondary,
      marginBottom: spacing.xs,
      textTransform: 'uppercase',
    },
    title: {
      ...typography.headlineLarge,
      color: colors.foreground,
      marginBottom: spacing.xs,
    },
    subtitle: {
      ...typography.bodyMedium,
      color: colors.textSecondary,
    },
    progressPanel: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radii.card,
      borderWidth: borders.hairline,
      marginBottom: spacing.lg,
      overflow: 'hidden',
      padding: spacing.lg,
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
    progressTop: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    progressLabel: {
      ...typography.titleSmall,
      color: colors.foreground,
    },
    progressTrack: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radii.round,
      height: 10,
      marginTop: spacing.md,
      overflow: 'hidden',
    },
    progressFill: {
      backgroundColor: colors.primary,
      borderRadius: radii.round,
      height: '100%',
      width: `${progress.percentage}%`,
    },
    saveText: {
      ...typography.caption,
      color: error ? colors.destructive : colors.textSecondary,
      marginTop: spacing.sm,
    },
    sections: {
      gap: spacing.md,
      flex: 1,
    },
    primaryActions: {
      gap: spacing.sm,
      marginBottom: spacing.lg,
    },
    sectionCard: {
      backgroundColor: colors.surface,
    },
    sectionContent: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.md,
      paddingVertical: spacing.lg,
    },
    sectionMain: {
      alignItems: 'center',
      flex: 1,
      flexDirection: 'row',
      gap: spacing.sm,
      minWidth: 0,
    },
    iconWrap: {
      alignItems: 'center',
      borderRadius: radii.card,
      height: 52,
      justifyContent: 'center',
      width: 52,
    },
    cardCopy: {
      flex: 1,
      minWidth: 0,
    },
    cardTitle: {
      marginBottom: spacing.xxxs,
    },
    cardDescription: {
      ...typography.bodySmall,
    },
    sectionActions: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.xs,
    },
    moreButton: {
      alignItems: 'center',
      borderRadius: radii.round,
      height: 36,
      justifyContent: 'center',
      width: 36,
    },
    footer: {
      gap: spacing.sm,
      marginTop: spacing.lg,
    },
  });

  const sectionTones = {
    primary: { color: colors.primary, muted: colors.primaryMuted },
    support: { color: colors.support, muted: colors.supportMuted },
    evidence: { color: colors.evidence, muted: colors.evidenceMuted },
    privacy: { color: colors.privacy, muted: colors.privacyMuted },
  };

  return (
    <Screen scrollable edges={['left', 'right']}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>Draft journey</Text>
          <Text style={styles.title}>Incident draft</Text>
          <Text style={styles.subtitle}>
            Keep the report moving in a few clear steps. You can close this screen and resume later.
          </Text>
        </View>

        <View style={styles.progressPanel}>
          <View pointerEvents="none" style={styles.cardAccentTop} />
          <View style={styles.progressTop}>
            <Text style={styles.progressLabel}>Report progress</Text>
            <Badge variant={progress.isComplete ? 'success' : 'info'} size="sm">
              {progress.completedSteps}/{progress.totalSteps}
            </Badge>
          </View>
          <View style={styles.progressTrack}>
            <View style={styles.progressFill} />
          </View>
          <Text style={styles.saveText}>{saveStatus}</Text>
        </View>

        <View style={styles.primaryActions}>
          <Button
            title={progress.isComplete ? 'Review saved draft' : 'Continue draft'}
            onPress={handleContinue}
            disabled={isResolvingDraftId}
            loading={isResolvingDraftId}
            fullWidth
          />
        </View>

        <View style={styles.sections}>
          {sections.map((section) => {
            const status = getSectionStatus(section.steps);
            const tone = sectionTones[section.tone];

            return (
              <Card key={section.id} variant="elevated" surfaceStyle={[styles.sectionCard, { borderColor: tone.muted }]}>
                <CardContent style={styles.sectionContent}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${section.title}`}
                    accessibilityHint="Opens this draft step."
                    activeOpacity={0.86}
                    onPress={() => {
                      if (!initialDraftId) return;
                      navigation.navigate(section.route as any, { draftId: initialDraftId });
                    }}
                    style={styles.sectionMain}
                  >
                    <View style={[styles.iconWrap, { backgroundColor: tone.muted }]}>
                      <Ionicons name={section.icon} size={22} color={tone.color} />
                    </View>
                    <View style={styles.cardCopy}>
                      <CardTitle variant="small" style={styles.cardTitle}>{section.title}</CardTitle>
                      <CardDescription style={styles.cardDescription}>{section.description}</CardDescription>
                    </View>
                  </TouchableOpacity>
                  <View style={styles.sectionActions}>
                    <Badge
                      variant={status === 'complete' ? 'success' : status === 'current' ? 'primary' : status === 'skipped' ? 'secondary' : 'outline'}
                      size="sm"
                    >
                      {getStatusLabel(status)}
                    </Badge>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={`More about ${section.title}`}
                      activeOpacity={0.86}
                      onPress={() => setActiveSectionId(section.id)}
                      style={[styles.moreButton, { backgroundColor: tone.muted }]}
                    >
                      <Ionicons name="information-circle-outline" size={18} color={tone.color} />
                    </TouchableOpacity>
                  </View>
                </CardContent>
              </Card>
            );
          })}
        </View>

        <View style={styles.footer}>
          {canClose ? (
            <Button
              title="Close"
              onPress={() => navigation.goBack()}
              variant="outline"
              fullWidth
            />
          ) : null}
        </View>

        <InfoModal
          visible={Boolean(activeSection)}
          title={activeSection?.title ?? 'Draft step'}
          description={activeSection?.detail}
          onClose={closeSectionInfo}
        >
          <InfoModalSection title="What this card opens">
            <InfoModalBullet>{activeSection?.description}</InfoModalBullet>
            <InfoModalBullet>Tap the main card area to continue this step; use the info button when someone needs the extra release guidance.</InfoModalBullet>
          </InfoModalSection>
          <InfoModalSection title="Step details">
            {activeSectionDetailSteps.map((step) => (
              <InfoModalBullet key={step.id}>
                {step.label}: {step.description} Status: {getStatusLabel(step.status)}{step.optional ? '. Optional.' : ''}{step.conditionalPathway ? ' Appears only for the selected pathway.' : ''}
              </InfoModalBullet>
            ))}
          </InfoModalSection>
          <InfoModalSection title="Save and consent">
            <InfoModalBullet>{saveStatus}</InfoModalBullet>
            <InfoModalBullet>Consent review remains the place where the app explains what stays local, queues, or leaves the device.</InfoModalBullet>
          </InfoModalSection>
        </InfoModal>
      </View>
    </Screen>
  );
}
