import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/SimpleThemeProvider';
import { spacing, radii, typography, fontFamilies } from '../../theme/tokens';

export default function StatTile({ label, value, tone = 'default' }: { label: string; value: string | number; tone?: 'default' | 'success' | 'warning' | 'muted' }) {
  const { colors } = useTheme();
  const palette = getTone(tone, colors);
  const styles = StyleSheet.create({
    container: {
      flex: 1,
      padding: spacing.sm,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.bg,
    },
    label: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    value: {
      marginTop: spacing.xs / 2,
      fontSize: typography.titleM.fontSize,
      fontWeight: '700',
      color: colors.foreground,
      fontFamily: fontFamilies.text,
    },
  });

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function getTone(tone: 'default' | 'success' | 'warning' | 'muted', colors: any) {
  switch (tone) {
    case 'success':
      return { bg: colors.primary + '15', border: colors.primary + '40' };
    case 'warning':
      return { bg: colors.warning + '15', border: colors.warning + '40' };
    case 'muted':
      return { bg: colors.muted, border: colors.border };
    default:
      return { bg: colors.background, border: colors.border };
  }
}
