import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/SimpleThemeProvider';
import { borders, radii, spacing, touchTargets, typography } from '../../theme/tokens';

export type StepStatus = 'complete' | 'current' | 'upcoming' | 'error' | 'skipped';

export interface ProgressStep {
  id: string;
  label: string;
  description?: string;
  status?: StepStatus;
}

export interface ProgressStepperProps {
  steps: ProgressStep[];
  currentStepId?: string;
  orientation?: 'horizontal' | 'vertical';
  onStepPress?: (step: ProgressStep) => void;
  style?: StyleProp<ViewStyle>;
}

export function ProgressStepper({
  steps,
  currentStepId,
  orientation = 'horizontal',
  onStepPress,
  style,
}: ProgressStepperProps) {
  const { colors } = useTheme();
  const currentIndex = currentStepId ? steps.findIndex(step => step.id === currentStepId) : -1;

  const resolveStatus = (step: ProgressStep, index: number): StepStatus => {
    if (step.status) return step.status;
    if (currentIndex < 0) return index === 0 ? 'current' : 'upcoming';
    if (index < currentIndex) return 'complete';
    if (index === currentIndex) return 'current';
    return 'upcoming';
  };

  const statusColor = (status: StepStatus) => {
    if (status === 'complete') return colors.success;
    if (status === 'current') return colors.primary;
    if (status === 'error') return colors.destructive;
    if (status === 'skipped') return colors.textSecondary;
    return colors.border;
  };

  const iconName = (status: StepStatus) => {
    if (status === 'complete') return 'checkmark' as const;
    if (status === 'error') return 'alert' as const;
    if (status === 'skipped') return 'remove' as const;
    return 'ellipse' as const;
  };

  return (
    <View
      accessibilityRole="progressbar"
      style={[
        styles.container,
        orientation === 'vertical' ? styles.vertical : styles.horizontal,
        style,
      ]}
    >
      {steps.map((step, index) => {
        const status = resolveStatus(step, index);
        const interactive = Boolean(onStepPress);
        const color = statusColor(status);
        const isLast = index === steps.length - 1;

        return (
          <React.Fragment key={step.id}>
            <Pressable
              onPress={() => onStepPress?.(step)}
              disabled={!interactive}
              accessibilityRole={interactive ? 'button' : 'text'}
              accessibilityLabel={`${step.label}, ${status}`}
              accessibilityState={{ selected: status === 'current' }}
              style={[
                styles.step,
                orientation === 'vertical' ? styles.verticalStep : styles.horizontalStep,
              ]}
            >
              <View
                style={[
                  styles.marker,
                  {
                    backgroundColor: status === 'upcoming' ? colors.surface : color,
                    borderColor: color,
                  },
                ]}
              >
                <Ionicons
                  name={iconName(status)}
                  size={status === 'upcoming' ? 8 : 14}
                  color={status === 'upcoming' ? color : colors.primaryForeground}
                />
              </View>
              <View style={styles.stepText}>
                <Text
                  style={[
                    styles.label,
                    {
                      color: status === 'upcoming' || status === 'skipped' ? colors.textSecondary : colors.foreground,
                    },
                  ]}
                  numberOfLines={2}
                >
                  {step.label}
                </Text>
                {orientation === 'vertical' && step.description ? (
                  <Text style={[styles.description, { color: colors.textSecondary }]} numberOfLines={3}>
                    {step.description}
                  </Text>
                ) : null}
              </View>
            </Pressable>
            {!isLast ? (
              <View
                style={[
                  orientation === 'vertical' ? styles.verticalConnector : styles.horizontalConnector,
                  { backgroundColor: status === 'complete' ? colors.success : colors.divider },
                ]}
              />
            ) : null}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'stretch',
  },
  horizontal: {
    flexDirection: 'row',
  },
  vertical: {
    flexDirection: 'column',
  },
  step: {
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touchTargets.minimum,
  },
  horizontalStep: {
    flex: 1,
  },
  verticalStep: {
    alignItems: 'flex-start',
    flexDirection: 'row',
  },
  marker: {
    alignItems: 'center',
    borderRadius: radii.round,
    borderWidth: borders.emphasized,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  stepText: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    ...typography.caption,
    fontWeight: '700',
    textAlign: 'center',
  },
  description: {
    ...typography.caption,
    marginTop: spacing.xxs,
  },
  horizontalConnector: {
    height: borders.emphasized,
    marginHorizontal: -spacing.xs,
    marginTop: 14,
    width: spacing.lg,
  },
  verticalConnector: {
    height: spacing.lg,
    marginLeft: 13,
    width: borders.emphasized,
  },
});
