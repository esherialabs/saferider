import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/SimpleThemeProvider';
import { borders, radii, spacing, typography } from '../../theme/tokens';
import { Badge } from './Badge';
import { type ComponentTone, getTonePalette } from './componentStyles';

export interface ConsentSummaryItem {
  id: string;
  label: string;
  description?: string;
  included: boolean;
  tone?: ComponentTone;
}

export interface ConsentSummaryProps {
  title?: string;
  pathwayLabel: string;
  recipientLabel?: string;
  statusLabel?: string;
  retentionNote?: string;
  items: ConsentSummaryItem[];
  style?: StyleProp<ViewStyle>;
}

export function ConsentSummary({
  title = 'Consent summary',
  pathwayLabel,
  recipientLabel,
  statusLabel = 'Consent required',
  retentionNote,
  items,
  style,
}: ConsentSummaryProps) {
  const { colors } = useTheme();

  return (
    <View
      accessibilityRole="text"
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderColor: colors.divider,
        },
        style,
      ]}
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
            {title}
          </Text>
          <Text style={[styles.description, { color: colors.textSecondary }]}>
            {recipientLabel ? `${pathwayLabel} to ${recipientLabel}` : pathwayLabel}
          </Text>
        </View>
        <Badge variant="warning">{statusLabel}</Badge>
      </View>

      <View style={styles.itemList}>
        {items.map(item => {
          const tonePalette = getTonePalette(colors, item.tone ?? (item.included ? 'consent' : 'neutral'));

          return (
            <View key={item.id} style={styles.item}>
              <View
                style={[
                  styles.itemIcon,
                  {
                    backgroundColor: item.included ? tonePalette.muted : colors.surfaceAlt,
                    borderColor: item.included ? tonePalette.border : colors.divider,
                  },
                ]}
              >
                <Ionicons
                  name={item.included ? 'checkmark' : 'remove'}
                  size={16}
                  color={item.included ? tonePalette.color : colors.textTertiary}
                />
              </View>
              <View style={styles.itemText}>
                <Text style={[styles.itemLabel, { color: colors.foreground }]}>{item.label}</Text>
                {item.description ? (
                  <Text style={[styles.itemDescription, { color: colors.textSecondary }]}>
                    {item.description}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>

      {retentionNote ? (
        <View style={[styles.note, { backgroundColor: colors.consentMuted }]}>
          <Text style={[styles.noteText, { color: colors.consent }]}>{retentionNote}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radii.card,
    borderWidth: borders.standard,
    gap: spacing.md,
    padding: spacing.md,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...typography.titleS,
  },
  description: {
    ...typography.bodyS,
    marginTop: spacing.xxs,
  },
  itemList: {
    gap: spacing.sm,
  },
  item: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  itemIcon: {
    alignItems: 'center',
    borderRadius: radii.round,
    borderWidth: borders.standard,
    height: 28,
    justifyContent: 'center',
    marginTop: 2,
    width: 28,
  },
  itemText: {
    flex: 1,
    minWidth: 0,
  },
  itemLabel: {
    ...typography.bodyS,
    fontWeight: '700',
  },
  itemDescription: {
    ...typography.caption,
    marginTop: spacing.xxs,
  },
  note: {
    borderRadius: radii.sm,
    padding: spacing.sm,
  },
  noteText: {
    ...typography.caption,
    fontWeight: '600',
  },
});
