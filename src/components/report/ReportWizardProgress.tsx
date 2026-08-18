import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';

import { Badge } from '../ui/Badge';
import Button from '../ui/Button';
import {
  getReportWizardProgress,
  type ReportStepName,
  type ReportWizardStepStatus,
} from '../../navigation/reportPathwayFlow';
import { useTheme } from '../../theme/SimpleThemeProvider';
import { borders, elevation, radii, spacing, typography } from '../../theme/tokens';
import type { DraftData } from '../../utils/draftStorage';
import { getReportWizardSaveStatus } from './reportWizardSaveStatus';

type ReportWizardProgressProps = {
  draft: DraftData | null | undefined;
  currentStep: ReportStepName;
  isSaving?: boolean;
  lastSaved?: Date | null;
  error?: string | null;
  showSaveStatus?: boolean;
  onSkipOptionalSteps?: () => void;
  skipOptionalLabel?: string;
  skipOptionalDisabled?: boolean;
};

function getStatusLabel(status: ReportWizardStepStatus): string {
  switch (status) {
    case 'complete':
      return 'Done';
    case 'current':
      return 'Now';
    case 'skipped':
      return 'Skipped';
    case 'upcoming':
    default:
      return 'Next';
  }
}

function getShortStepLabel(index: number): string {
  return `Step ${index + 1}`;
}

function getStatusIconName(status: ReportWizardStepStatus): keyof typeof Ionicons.glyphMap {
  switch (status) {
    case 'complete':
      return 'checkmark-circle';
    case 'skipped':
      return 'checkmark-done-circle-outline';
    case 'current':
      return 'radio-button-on';
    case 'upcoming':
    default:
      return 'ellipse-outline';
  }
}

export function ReportWizardProgress({
  draft,
  currentStep,
  isSaving = false,
  lastSaved,
  error,
  showSaveStatus = true,
  onSkipOptionalSteps,
  skipOptionalLabel = 'Skip optional',
  skipOptionalDisabled = false,
}: ReportWizardProgressProps) {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const isEditingCompleted = route.params?.editCompleted === true;
  const progress = getReportWizardProgress(draft, currentStep);
  const saveStatus = getReportWizardSaveStatus({
    draft,
    isSaving,
    lastSaved,
    error,
  });

  const styles = StyleSheet.create({
    panel: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderRadius: radii.card,
      borderWidth: borders.hairline,
      gap: spacing.sm,
      marginBottom: spacing.md,
      overflow: 'hidden',
      padding: spacing.md,
      paddingTop: spacing.lg,
      position: 'relative',
      ...elevation.card,
    },
    panelAccent: {
      backgroundColor: colors.primary,
      height: 4,
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    headerRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.sm,
      justifyContent: 'space-between',
    },
    headerActions: {
      alignItems: 'center',
      flexDirection: 'row',
      flexShrink: 0,
      flexWrap: 'wrap',
      gap: spacing.xs,
      justifyContent: 'flex-end',
    },
    title: {
      ...typography.titleMedium,
      color: colors.foreground,
      flex: 1,
    },
    stepRow: {
      flexDirection: 'row',
      gap: spacing.xs,
    },
    stepCell: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderColor: colors.divider,
      borderRadius: radii.card,
      borderWidth: borders.hairline,
      flex: 1,
      gap: spacing.xxxs,
      justifyContent: 'center',
      minHeight: 58,
      minWidth: 0,
      paddingHorizontal: spacing.xs,
      paddingVertical: spacing.xs,
    },
    stepCellActive: {
      backgroundColor: colors.primaryMuted,
      borderColor: colors.primary,
    },
    statusText: {
      ...typography.caption,
      color: colors.textSecondary,
      fontWeight: '600',
      textAlign: 'center',
    },
    statusRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.xxxs,
      justifyContent: 'center',
      minWidth: 0,
    },
    stepLabel: {
      ...typography.labelSmall,
      color: colors.foreground,
      textAlign: 'center',
    },
    saveRow: {
      alignItems: 'flex-start',
      borderTopColor: colors.divider,
      borderTopWidth: borders.hairline,
      flexDirection: 'row',
      gap: spacing.sm,
      paddingTop: spacing.sm,
    },
    saveText: {
      ...typography.caption,
      color: colors.textSecondary,
      flex: 1,
      lineHeight: 18,
    },
  });

  const openStep = (route?: string) => {
    if (!draft?.id || !route) return;
    navigation.navigate(route, {
      draftId: draft.id,
      ...(isEditingCompleted ? { editCompleted: true } : {}),
    });
  };

  return (
    <View style={styles.panel}>
      <View pointerEvents="none" style={styles.panelAccent} />
      <View style={styles.headerRow}>
        <Text style={styles.title}>Report progress</Text>
        <View style={styles.headerActions}>
          {onSkipOptionalSteps ? (
            <Button
              title={skipOptionalLabel}
              variant="outline"
              size="xs"
              disabled={skipOptionalDisabled}
              icon={<Ionicons name="play-skip-forward-outline" size={15} color={colors.textPrimary} />}
              onPress={onSkipOptionalSteps}
              accessibilityLabel={skipOptionalLabel}
            />
          ) : null}
          <Badge variant={progress.isComplete ? 'success' : 'info'} size="sm">
            {progress.completedSteps}/{progress.totalSteps}
          </Badge>
        </View>
      </View>

      <View style={styles.stepRow}>
        {progress.steps.map((step, index) => {
          const canOpenStep = Boolean(
            draft?.id &&
            step.route &&
            (step.status === 'complete' || step.status === 'current' || step.status === 'skipped'),
          );
          const isCurrent = step.status === 'current';
          const statusColor = step.status === 'complete' || step.status === 'skipped'
            ? colors.success
            : isCurrent
              ? colors.primary
              : colors.textSecondary;

          return (
            <Pressable
              key={step.id}
              accessibilityRole={canOpenStep ? 'button' : 'text'}
              accessibilityLabel={`${getShortStepLabel(index)}. ${step.label}. ${getStatusLabel(step.status)}`}
              disabled={!canOpenStep}
              onPress={() => openStep(step.route)}
              style={[
                styles.stepCell,
                isCurrent ? styles.stepCellActive : null,
                !canOpenStep ? { opacity: 0.72 } : null,
              ]}
            >
              <Text style={styles.stepLabel} numberOfLines={1}>{getShortStepLabel(index)}</Text>
              <View style={styles.statusRow}>
                <Ionicons
                  name={getStatusIconName(step.status)}
                  size={14}
                  color={statusColor}
                />
                <Text style={[styles.statusText, { color: statusColor }]} numberOfLines={1}>
                  {getStatusLabel(step.status)}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {showSaveStatus ? (
        <View style={styles.saveRow}>
          <Badge variant={saveStatus.variant} size="sm">{saveStatus.label}</Badge>
          <Text style={styles.saveText}>{saveStatus.detail}</Text>
        </View>
      ) : null}
    </View>
  );
}
