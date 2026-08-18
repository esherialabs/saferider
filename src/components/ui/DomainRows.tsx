import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/SimpleThemeProvider';
import { borders, radii, spacing, typography } from '../../theme/tokens';
import { Badge, StatePill } from './Badge';
import { ListRow } from './ListRow';
import { type ComponentTone, getTonePalette } from './componentStyles';

export type EvidenceStatus =
  | 'local'
  | 'queued'
  | 'uploading'
  | 'uploaded'
  | 'failed'
  | 'processing'
  | 'processed'
  | 'unavailable';

export interface EvidenceRowProps {
  title: string;
  kind: string;
  status: EvidenceStatus;
  detail?: string;
  timestampLabel?: string;
  privacyLabels?: string[];
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

const EVIDENCE_STATUS: Record<EvidenceStatus, { label: string; tone: ComponentTone; icon: keyof typeof Ionicons.glyphMap }> = {
  local: { label: 'Local only', tone: 'privacy', icon: 'phone-portrait-outline' },
  queued: { label: 'Queued', tone: 'queued', icon: 'cloud-upload-outline' },
  uploading: { label: 'Uploading', tone: 'info', icon: 'sync-outline' },
  uploaded: { label: 'Uploaded', tone: 'success', icon: 'cloud-done-outline' },
  failed: { label: 'Failed', tone: 'destructive', icon: 'alert-circle-outline' },
  processing: { label: 'Processing requested', tone: 'evidence', icon: 'options-outline' },
  processed: { label: 'Processed', tone: 'success', icon: 'shield-checkmark-outline' },
  unavailable: { label: 'Unavailable', tone: 'unavailable', icon: 'remove-circle-outline' },
};

export function EvidenceRow({
  title,
  kind,
  status,
  detail,
  timestampLabel,
  privacyLabels,
  onPress,
  style,
}: EvidenceRowProps) {
  const { colors } = useTheme();
  const config = EVIDENCE_STATUS[status];

  return (
    <ListRow
      title={title}
      description={detail}
      meta={timestampLabel}
      leadingIcon={config.icon}
      tone={config.tone}
      onPress={onPress}
      accessibilityLabel={`${title}, ${kind}, ${config.label}`}
      trailing={
        <View style={styles.trailingStack}>
          <StatePill label={config.label} tone={config.tone} icon={config.icon} size="sm" />
          <Text style={[styles.kind, { color: colors.textSecondary }]}>{kind}</Text>
          {privacyLabels?.slice(0, 2).map(label => (
            <Badge key={label} variant="outline" size="sm">
              {label}
            </Badge>
          ))}
        </View>
      }
      style={style}
    />
  );
}

export interface ProviderRowProps {
  name: string;
  serviceType: string;
  description?: string;
  distanceLabel?: string;
  availabilityLabel?: string;
  verified?: boolean;
  cached?: boolean;
  selected?: boolean;
  accessibilityHint?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function ProviderRow({
  name,
  serviceType,
  description,
  distanceLabel,
  availabilityLabel,
  verified = false,
  cached = false,
  selected = false,
  accessibilityHint,
  onPress,
  style,
}: ProviderRowProps) {
  return (
    <ListRow
      title={name}
      description={description}
      meta={distanceLabel}
      leadingIcon="business-outline"
      tone="support"
      onPress={onPress}
      selected={selected}
      accessibilityLabel={`${name}, ${serviceType}`}
      accessibilityHint={accessibilityHint}
      trailing={
        <View style={styles.trailingStack}>
          <StatePill label={verified ? 'Verified' : serviceType} tone={verified ? 'success' : 'support'} size="sm" />
          {availabilityLabel ? <Badge variant="outline">{availabilityLabel}</Badge> : null}
          {cached ? <Badge variant="warning">Cached</Badge> : null}
        </View>
      }
      style={style}
    />
  );
}

export type CaseTimelineStatus = 'complete' | 'current' | 'pending' | 'failed' | 'blocked';

export interface CaseTimelineItemProps {
  title: string;
  description?: string;
  timestampLabel?: string;
  status?: CaseTimelineStatus;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
}

const TIMELINE_STATUS: Record<CaseTimelineStatus, { tone: ComponentTone; icon: keyof typeof Ionicons.glyphMap }> = {
  complete: { tone: 'success', icon: 'checkmark' },
  current: { tone: 'case', icon: 'ellipse' },
  pending: { tone: 'queued', icon: 'time-outline' },
  failed: { tone: 'destructive', icon: 'alert' },
  blocked: { tone: 'warning', icon: 'pause' },
};

export function CaseTimelineItem({
  title,
  description,
  timestampLabel,
  status = 'pending',
  icon,
  style,
}: CaseTimelineItemProps) {
  const { colors } = useTheme();
  const config = TIMELINE_STATUS[status];
  const tonePalette = getTonePalette(colors, config.tone);

  return (
    <View style={[styles.timelineItem, style]}>
      <View style={styles.timelineRail}>
        <View
          style={[
            styles.timelineMarker,
            {
              backgroundColor: tonePalette.muted,
              borderColor: tonePalette.border,
            },
          ]}
        >
          <Ionicons name={icon ?? config.icon} size={14} color={tonePalette.color} />
        </View>
        <View style={[styles.timelineLine, { backgroundColor: colors.divider }]} />
      </View>
      <View style={[styles.timelineContent, { borderColor: colors.divider, backgroundColor: colors.surface }]}>
        <View style={styles.timelineHeader}>
          <Text style={[styles.timelineTitle, { color: colors.foreground }]}>{title}</Text>
          {timestampLabel ? (
            <Text style={[styles.timelineTime, { color: colors.textSecondary }]}>{timestampLabel}</Text>
          ) : null}
        </View>
        {description ? (
          <Text style={[styles.timelineDescription, { color: colors.textSecondary }]}>{description}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  trailingStack: {
    alignItems: 'flex-end',
    gap: spacing.xs,
    maxWidth: 132,
  },
  kind: {
    ...typography.caption,
  },
  timelineItem: {
    alignItems: 'stretch',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  timelineRail: {
    alignItems: 'center',
    width: 32,
  },
  timelineMarker: {
    alignItems: 'center',
    borderRadius: radii.round,
    borderWidth: borders.standard,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  timelineLine: {
    flex: 1,
    marginTop: spacing.xs,
    minHeight: spacing.md,
    width: borders.standard,
  },
  timelineContent: {
    borderRadius: radii.sm,
    borderWidth: borders.standard,
    flex: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  timelineHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  timelineTitle: {
    ...typography.bodyM,
    flex: 1,
    fontWeight: '700',
  },
  timelineTime: {
    ...typography.caption,
    flexShrink: 0,
  },
  timelineDescription: {
    ...typography.bodyS,
  },
});
