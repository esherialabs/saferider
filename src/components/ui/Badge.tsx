import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { View, Text, StyleSheet, ViewStyle, TextStyle, StyleProp } from 'react-native';
import { useTheme } from '../../theme/SimpleThemeProvider';
import { borders, radii, spacing, typography } from '../../theme/tokens';
import { type ComponentTone, getTonePalette } from './componentStyles';

export interface BadgeProps {
  children?: React.ReactNode;
  variant?: 'default' | 'primary' | 'secondary' | 'destructive' | 'success' | 'warning' | 'info' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  shape?: 'rounded' | 'square' | 'pill';
  dot?: boolean;
  style?: any;
}

export function Badge({ 
  children, 
  variant = 'default', 
  size = 'md',
  shape = 'rounded',
  dot = false,
  style 
}: BadgeProps) {
  const { colors } = useTheme();

  const getVariantStyles = () => {
    const base = {
      borderWidth: 0,
      backgroundColor: colors.primaryMuted,
      textColor: colors.primary,
      borderColor: 'transparent',
    };

    switch (variant) {
      case 'secondary':
        return {
          ...base,
          backgroundColor: colors.surfaceAlt,
          textColor: colors.textSecondary,
          borderColor: colors.divider,
        };
      case 'destructive':
        return {
          ...base,
          backgroundColor: colors.destructive,
          textColor: colors.destructiveForeground,
          borderColor: colors.destructive,
        };
      case 'success':
        return {
          ...base,
          backgroundColor: colors.successMuted,
          textColor: colors.success,
          borderColor: colors.success,
        };
      case 'warning':
        return {
          ...base,
          backgroundColor: colors.warningMuted,
          textColor: colors.warning,
          borderColor: colors.warning,
        };
      case 'info':
        return {
          ...base,
          backgroundColor: colors.infoMuted,
          textColor: colors.info,
          borderColor: colors.info,
        };
      case 'outline':
        return {
          ...base,
          backgroundColor: 'transparent',
          textColor: colors.textPrimary,
          borderColor: colors.divider,
          borderWidth: 1,
        };
      case 'primary':
      default:
        return {
          ...base,
          backgroundColor: colors.primaryMuted,
          textColor: colors.primary,
          borderColor: 'transparent',
        };
    }
  };

  const getSizeStyles = () => {
    if (dot) {
      switch (size) {
        case 'sm':
          return {
            width: 8,
            height: 8,
            borderRadius: 4,
          };
        case 'lg':
          return {
            width: 16,
            height: 16,
            borderRadius: 8,
          };
        default:
          return {
            width: 12,
            height: 12,
            borderRadius: 6,
          };
      }
    }

    switch (size) {
      case 'sm':
        return {
          minHeight: 20,
          paddingHorizontal: spacing.sm,
          font: { ...typography.caption, fontWeight: '600' as const },
          radius: radii.badge,
          borderRadius: radii.badge,
        };
      case 'lg':
        return {
          minHeight: 36,
          paddingHorizontal: spacing.md,
          font: { ...typography.bodyS, fontWeight: '600' as const },
          radius: radii.chip,
          borderRadius: radii.chip,
        };
      default:
        return {
          minHeight: 24,
          paddingHorizontal: spacing.sm,
          font: { ...typography.caption, fontWeight: '600' as const },
          radius: radii.badge,
          borderRadius: radii.badge,
        };
    }
  };

  const getShapeStyles = (computedSizeStyles: { radius?: number; borderRadius?: number; width?: number; height?: number }) => {
    switch (shape) {
      case 'square':
        return {
          borderRadius: 4,
        };
      case 'pill':
        return {
          borderRadius: 999,
        };
      default:
        return {
          borderRadius: dot ? computedSizeStyles.borderRadius ?? computedSizeStyles.radius : (computedSizeStyles.radius ?? radii.badge),
        };
    }
  };

  const variantStyles = getVariantStyles();
  const sizeStyles = getSizeStyles();
  const shapeStyles = getShapeStyles(sizeStyles);

  const containerStyle: ViewStyle = dot
    ? {
        width: sizeStyles.width ?? 12,
        height: sizeStyles.height ?? 12,
        borderRadius: shapeStyles.borderRadius ?? sizeStyles.borderRadius ?? radii.badge,
        backgroundColor: variantStyles.backgroundColor,
      }
    : {
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'flex-start',
        paddingHorizontal: sizeStyles.paddingHorizontal ?? spacing.sm,
        minHeight: sizeStyles.minHeight ?? 24,
        borderRadius: shapeStyles.borderRadius ?? sizeStyles.borderRadius ?? radii.badge,
        backgroundColor: variantStyles.backgroundColor,
        borderColor: variantStyles.borderColor,
        borderWidth: variantStyles.borderWidth ?? 0,
      };

  const textStyle: TextStyle = {
    color: variantStyles.textColor,
    fontSize: sizeStyles.font?.fontSize ?? typography.caption.fontSize,
    lineHeight: sizeStyles.font?.lineHeight ?? typography.caption.lineHeight,
    fontWeight: sizeStyles.font?.fontWeight ?? ('600' as const),
    textAlign: 'center',
    includeFontPadding: false,
  };

  const styles = StyleSheet.create({
    badge: containerStyle,
    text: {
      ...textStyle,
    },
    dot: {
      // For dot badges, we don't need text styles
    },
  });

  if (dot) {
    return <View style={[styles.badge, styles.dot, style]} />;
  }

  return (
    <View style={[styles.badge, style]}>
      <Text style={styles.text} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}

export interface StatePillProps {
  label: string;
  tone?: ComponentTone;
  icon?: keyof typeof Ionicons.glyphMap;
  size?: 'sm' | 'md';
  emphasized?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function StatePill({
  label,
  tone = 'neutral',
  icon,
  size = 'md',
  emphasized = false,
  accessibilityLabel,
  style,
}: StatePillProps) {
  const { colors } = useTheme();
  const tonePalette = getTonePalette(colors, tone);
  const minHeight = size === 'sm' ? 24 : 28;
  const iconSize = size === 'sm' ? 13 : 14;
  const textColor = emphasized ? tonePalette.foreground : tonePalette.color;

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        statePillStyles.pill,
        {
          backgroundColor: emphasized ? tonePalette.color : tonePalette.muted,
          borderColor: emphasized ? tonePalette.color : tonePalette.border,
          minHeight,
          paddingHorizontal: size === 'sm' ? spacing.xs : spacing.sm,
        },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={iconSize} color={textColor} /> : null}
      <Text
        numberOfLines={1}
        style={[
          statePillStyles.text,
          {
            color: textColor,
            fontSize: size === 'sm' ? typography.caption.fontSize : typography.bodyS.fontSize,
            lineHeight: size === 'sm' ? typography.caption.lineHeight : typography.bodyS.lineHeight,
          },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const statePillStyles = StyleSheet.create({
  pill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radii.chip,
    borderWidth: borders.standard,
    flexDirection: 'row',
    gap: spacing.xxs,
    justifyContent: 'center',
    maxWidth: '100%',
  },
  text: {
    fontWeight: '700',
    includeFontPadding: false,
  },
});

// Utility components for common patterns
export function StatusBadge({ 
  status, 
  ...props 
}: Omit<BadgeProps, 'variant' | 'children'> & { 
  status: 'active' | 'inactive' | 'pending' | 'error' | 'success' 
}) {
  const getVariantAndText = () => {
    switch (status) {
      case 'active':
        return { variant: 'success' as const, text: 'Active' };
      case 'inactive':
        return { variant: 'secondary' as const, text: 'Inactive' };
      case 'pending':
        return { variant: 'warning' as const, text: 'Pending' };
      case 'error':
        return { variant: 'destructive' as const, text: 'Error' };
      case 'success':
        return { variant: 'success' as const, text: 'Success' };
      default:
        return { variant: 'default' as const, text: status };
    }
  };

  const { variant, text } = getVariantAndText();

  return (
    <Badge variant={variant} {...props}>
      {text}
    </Badge>
  );
}

export function CountBadge({ 
  count, 
  max = 99,
  showZero = false,
  ...props 
}: Omit<BadgeProps, 'children'> & { 
  count: number;
  max?: number;
  showZero?: boolean;
}) {
  if (count === 0 && !showZero) {
    return null;
  }

  const displayCount = count > max ? `${max}+` : count.toString();

  return (
    <Badge {...props}>
      {displayCount}
    </Badge>
  );
}

export function DotBadge(props: Omit<BadgeProps, 'dot' | 'children'>) {
  return <Badge dot {...props} />;
}

// Notification badge that can be positioned over another component
export function NotificationBadge({ 
  children,
  count,
  dot = false,
  position = 'top-right',
  offset = { x: 0, y: 0 },
  ...badgeProps
}: {
  children: React.ReactNode;
  count?: number;
  dot?: boolean;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  offset?: { x: number; y: number };
} & Omit<BadgeProps, 'children' | 'dot'>) {
  const getPositionStyles = () => {
    const baseOffset = 4;
    
    switch (position) {
      case 'top-left':
        return {
          top: -baseOffset + offset.y,
          left: -baseOffset + offset.x,
        };
      case 'bottom-right':
        return {
          bottom: -baseOffset + offset.y,
          right: -baseOffset + offset.x,
        };
      case 'bottom-left':
        return {
          bottom: -baseOffset + offset.y,
          left: -baseOffset + offset.x,
        };
      default: // top-right
        return {
          top: -baseOffset + offset.y,
          right: -baseOffset + offset.x,
        };
    }
  };

  const styles = StyleSheet.create({
    container: {
      position: 'relative',
    },
    badge: {
      position: 'absolute',
      zIndex: 10,
      ...getPositionStyles(),
    },
  });

  // Don't show badge if count is 0 and not a dot
  if (!dot && (!count || count === 0)) {
    return <>{children}</>;
  }

  return (
    <View style={styles.container}>
      {children}
      <View style={styles.badge}>
        {dot ? (
          <DotBadge {...badgeProps} />
        ) : (
          <CountBadge count={count || 0} {...badgeProps} />
        )}
      </View>
    </View>
  );
}
