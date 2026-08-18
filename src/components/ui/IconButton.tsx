import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/SimpleThemeProvider';
import { feedback, radii, spacing, touchTargets } from '../../theme/tokens';

export type IconButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
export type IconButtonSize = 'sm' | 'md' | 'lg';

export interface IconButtonProps {
  icon: keyof typeof Ionicons.glyphMap | React.ReactElement;
  accessibilityLabel: string;
  onPress?: () => void;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const SIZE_MAP: Record<IconButtonSize, { size: number; icon: number }> = {
  sm: { size: touchTargets.minimum, icon: 18 },
  md: { size: touchTargets.comfortable, icon: 20 },
  lg: { size: touchTargets.action, icon: 22 },
};

export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  variant = 'ghost',
  size = 'md',
  disabled = false,
  loading = false,
  accessibilityHint,
  style,
  testID,
}: IconButtonProps) {
  const { colors } = useTheme();
  const dimensions = SIZE_MAP[size];
  const isDisabled = disabled || loading || !onPress;

  const variantStyle = {
    primary: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
      iconColor: colors.primaryForeground,
    },
    secondary: {
      backgroundColor: colors.surfaceAlt,
      borderColor: colors.divider,
      iconColor: colors.foreground,
    },
    outline: {
      backgroundColor: 'transparent',
      borderColor: colors.border,
      iconColor: colors.foreground,
    },
    ghost: {
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      iconColor: colors.textSecondary,
    },
    destructive: {
      backgroundColor: colors.dangerMuted,
      borderColor: colors.dangerMuted,
      iconColor: colors.destructive,
    },
  }[variant];

  const renderIcon = () => {
    if (loading) {
      return <ActivityIndicator color={variantStyle.iconColor} size="small" />;
    }

    if (React.isValidElement(icon)) {
      return icon;
    }

    return <Ionicons name={icon} size={dimensions.icon} color={variantStyle.iconColor} />;
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        {
          width: dimensions.size,
          height: dimensions.size,
          borderRadius: radii.button,
          backgroundColor: variantStyle.backgroundColor,
          borderColor: variantStyle.borderColor,
          opacity: isDisabled ? feedback.opacity.subtleDisabled : 1,
        },
        pressed && !isDisabled ? styles.pressed : null,
        style,
      ]}
    >
      <View style={styles.iconWrap}>{renderIcon()}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    padding: spacing.xs,
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: feedback.opacity.pressed,
  },
});
