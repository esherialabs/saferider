import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { useTheme } from '../../theme/SimpleThemeProvider';
import { borders, elevation, radii, spacing, typography } from '../../theme/tokens';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type FeatureTone = 'primary' | 'support' | 'evidence' | 'privacy' | 'safety' | 'critical' | 'consent';

export type FeatureHeaderStat = {
  label: string;
  value: string | number;
  icon?: IconName;
};

export interface FeatureHeaderProps {
  eyebrow?: string;
  title: string;
  description: string;
  icon: IconName;
  tone?: FeatureTone;
  stats?: FeatureHeaderStat[];
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function FeatureHeader({
  eyebrow,
  title,
  description,
  icon,
  tone = 'primary',
  stats = [],
  children,
  style,
}: FeatureHeaderProps) {
  const { colors, mode, isHighContrast } = useTheme();
  const palette = {
    primary: { color: colors.primary, muted: colors.primaryMuted },
    support: { color: colors.support, muted: colors.supportMuted },
    evidence: { color: colors.evidence, muted: colors.evidenceMuted },
    privacy: { color: colors.privacy, muted: colors.privacyMuted },
    safety: { color: colors.safety, muted: colors.safetyMuted },
    critical: { color: colors.critical, muted: colors.criticalMuted },
    consent: { color: colors.consent, muted: colors.consentMuted },
  }[tone];
  const gradientColors = isHighContrast
    ? [colors.surface, colors.surface] as const
    : mode === 'dark'
      ? [colors.surfaceAlt, colors.surface] as const
      : [colors.surface, palette.muted] as const;

  return (
    <View style={[styles.shadowWrap, { shadowColor: palette.color }, style]}>
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.surface, { borderColor: colors.border }]}
      >
        <View style={[styles.accent, { backgroundColor: palette.color }]} />
        <View style={styles.topRow}>
          <View style={[styles.iconBox, { backgroundColor: palette.muted, borderColor: palette.color + '33' }]}>
            <Ionicons name={icon} size={22} color={palette.color} />
          </View>
          <View style={styles.copy}>
            {eyebrow ? <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>{eyebrow}</Text> : null}
            <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
            {description.trim() ? (
              <Text style={[styles.description, { color: colors.textSecondary }]}>{description}</Text>
            ) : null}
          </View>
        </View>

        {stats.length > 0 ? (
          <View style={styles.stats}>
            {stats.map((stat) => (
              <View
                key={`${stat.label}-${stat.value}`}
                accessible
                accessibilityLabel={`${stat.label}: ${stat.value}`}
                style={[styles.statItem, { backgroundColor: colors.surface, borderColor: colors.divider }]}
              >
                <View style={styles.statValueRow}>
                  {stat.icon ? <Ionicons name={stat.icon} size={14} color={palette.color} /> : null}
                  <Text
                    style={[styles.statValue, { color: colors.foreground }]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {stat.value}
                  </Text>
                </View>
                <Text
                  style={[styles.statLabel, { color: colors.textSecondary }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {stat.label}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {children ? <View style={styles.children}>{children}</View> : null}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  shadowWrap: {
    borderRadius: radii.card,
    overflow: 'hidden',
    ...elevation.card,
  },
  surface: {
    borderRadius: radii.card,
    borderWidth: borders.hairline,
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  accent: {
    height: 3,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  topRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  iconBox: {
    alignItems: 'center',
    borderRadius: radii.card,
    borderWidth: borders.hairline,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    ...typography.overline,
    marginBottom: spacing.xxxs,
    textTransform: 'uppercase',
  },
  title: {
    ...typography.titleMedium,
  },
  description: {
    ...typography.bodySmall,
    marginTop: spacing.xxxs,
  },
  stats: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  statItem: {
    borderRadius: radii.card,
    borderWidth: borders.hairline,
    flex: 1,
    gap: spacing.xxxs,
    justifyContent: 'center',
    minHeight: 54,
    minWidth: 0,
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  statValueRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xxxs,
    minWidth: 0,
  },
  statValue: {
    ...typography.titleSmall,
    flexShrink: 1,
    minWidth: 0,
  },
  statLabel: {
    ...typography.caption,
    minWidth: 0,
  },
  children: {
    marginTop: spacing.md,
  },
});
