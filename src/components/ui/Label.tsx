import React from 'react';
import { Text, View, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../../theme/SimpleThemeProvider';
import { typography, spacing } from '../../theme/tokens';

export interface LabelProps {
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'secondary' | 'muted' | 'destructive' | 'success';
  weight?: 'normal' | 'medium' | 'semibold' | 'bold';
  required?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  style?: any;
  accessibilityLabel?: string;
}

export function Label({
  children,
  size = 'md',
  variant = 'default',
  weight = 'medium',
  required = false,
  disabled = false,
  onPress,
  style,
  accessibilityLabel,
}: LabelProps) {
  const { colors } = useTheme();

  const getSizeStyles = () => {
    switch (size) {
      case 'sm':
        return {
          fontSize: typography.caption.fontSize,
          lineHeight: typography.caption.lineHeight,
        };
      case 'lg':
        return {
          fontSize: typography.bodyM.fontSize,
          lineHeight: typography.bodyM.lineHeight,
        };
      default:
        return {
          fontSize: typography.bodyS.fontSize,
          lineHeight: typography.bodyS.lineHeight,
        };
    }
  };

  const getVariantStyles = () => {
    if (disabled) {
      return {
        color: colors.textTertiary,
      };
    }

    switch (variant) {
      case 'secondary':
        return {
          color: colors.textSecondary,
        };
      case 'muted':
        return {
          color: colors.textTertiary,
        };
      case 'destructive':
        return {
          color: colors.destructive,
        };
      case 'success':
        return {
          color: colors.success,
        };
      default:
        return {
          color: colors.foreground,
        };
    }
  };

  const getWeightStyles = () => {
    switch (weight) {
      case 'normal':
        return {
          fontWeight: '400' as const,
        };
      case 'medium':
        return {
          fontWeight: '500' as const,
        };
      case 'semibold':
        return {
          fontWeight: '600' as const,
        };
      case 'bold':
        return {
          fontWeight: '700' as const,
        };
      default:
        return {
          fontWeight: '500' as const,
        };
    }
  };

  const sizeStyles = getSizeStyles();
  const variantStyles = getVariantStyles();
  const weightStyles = getWeightStyles();

  const styles = StyleSheet.create({
    label: {
      ...sizeStyles,
      ...variantStyles,
      ...weightStyles,
      opacity: disabled ? 0.6 : 1,
    },
    required: {
      color: colors.destructive,
      marginLeft: spacing.xxs / 2,
    },
  });

  const labelContent = (
    <>
      <Text style={[styles.label, style]}>
        {children}
      </Text>
      {required && (
        <Text style={styles.required}>
          {' *'}
        </Text>
      )}
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint="Double tap to interact"
        accessibilityState={{ disabled }}
        style={{ flexDirection: 'row', alignItems: 'center' }}
      >
        {labelContent}
      </TouchableOpacity>
    );
  }

  return (
    <Text
      style={[styles.label, style]}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="text"
    >
      {children}
      {required && (
        <Text style={styles.required}>
          {' *'}
        </Text>
      )}
    </Text>
  );
}

// Utility components for common label patterns
export function FormLabel({ 
  children, 
  ...props 
}: Omit<LabelProps, 'weight'>) {
  return (
    <Label weight="medium" {...props}>
      {children}
    </Label>
  );
}

export function FieldLabel({ 
  children, 
  ...props 
}: Omit<LabelProps, 'size' | 'weight'>) {
  return (
    <Label size="sm" weight="medium" {...props}>
      {children}
    </Label>
  );
}

export function SectionLabel({ 
  children, 
  ...props 
}: Omit<LabelProps, 'size' | 'weight'>) {
  return (
    <Label size="lg" weight="semibold" {...props}>
      {children}
    </Label>
  );
}

export function HelperLabel({ 
  children, 
  ...props 
}: Omit<LabelProps, 'size' | 'variant'>) {
  return (
    <Label size="sm" variant="muted" {...props}>
      {children}
    </Label>
  );
}

export function ErrorLabel({ 
  children, 
  ...props 
}: Omit<LabelProps, 'size' | 'variant'>) {
  return (
    <Label size="sm" variant="destructive" {...props}>
      {children}
    </Label>
  );
}

export function SuccessLabel({ 
  children, 
  ...props 
}: Omit<LabelProps, 'size' | 'variant'>) {
  return (
    <Label size="sm" variant="success" {...props}>
      {children}
    </Label>
  );
}

// Form field wrapper with label
export interface LabeledFieldProps {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  error?: string;
  helperText?: string;
  disabled?: boolean;
  labelProps?: Partial<LabelProps>;
  style?: any;
}

export function LabeledField({
  label,
  children,
  required = false,
  error,
  helperText,
  disabled = false,
  labelProps,
  style,
}: LabeledFieldProps) {
  const styles = StyleSheet.create({
    container: {
      marginBottom: 16,
    },
    labelContainer: {
      marginBottom: 6,
    },
    helperContainer: {
      marginTop: 4,
    },
  });

  return (
    <View style={[styles.container, style]}>
      <View style={styles.labelContainer}>
        <FormLabel
          required={required}
          disabled={disabled}
          {...labelProps}
        >
          {label}
        </FormLabel>
      </View>
      
      {children}
      
      {(error || helperText) && (
        <View style={styles.helperContainer}>
          {error ? (
            <ErrorLabel>{error}</ErrorLabel>
          ) : (
            helperText && <HelperLabel>{helperText}</HelperLabel>
          )}
        </View>
      )}
    </View>
  );
}

// Inline label for checkboxes, radios, etc.
export interface InlineLabelProps extends LabelProps {
  htmlFor?: string;
}

export function InlineLabel({ 
  children,
  htmlFor,
  ...props 
}: InlineLabelProps) {
  return (
    <Label {...props}>
      {children}
    </Label>
  );
}

// Badge-style label
export interface BadgeLabelProps extends Omit<LabelProps, 'variant'> {
  color?: string;
  backgroundColor?: string;
}

export function BadgeLabel({
  children,
  color,
  backgroundColor,
  style,
  ...props
}: BadgeLabelProps) {
  const { colors } = useTheme();

  const badgeStyles = StyleSheet.create({
    badge: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 12,
      backgroundColor: backgroundColor || colors.muted,
      alignSelf: 'flex-start',
    },
    text: {
      color: color || colors.foreground,
    },
  });

  return (
    <View style={[badgeStyles.badge, style]}>
      <Label style={badgeStyles.text} {...props}>
        {children}
      </Label>
    </View>
  );
}
