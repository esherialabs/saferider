import React from 'react';
import { useRef, useEffect } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  StyleSheet, 
  Animated 
} from 'react-native';
import { useTheme } from '../../theme/SimpleThemeProvider';
import { spacing, typography, fontFamilies } from '../../theme/tokens';

export interface RadioGroupProps {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
  orientation?: 'vertical' | 'horizontal';
  style?: any;
}

export interface RadioGroupItemProps {
  value: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  description?: string;
  labelPosition?: 'left' | 'right';
  variant?: 'default' | 'primary' | 'destructive';
  style?: any;
  accessibilityLabel?: string;
}

type RadioGroupItemComponentProps = RadioGroupItemProps & {
  selected?: boolean;
  onSelect?: () => void;
};

export function RadioGroup({
  value,
  onValueChange,
  disabled = false,
  children,
  orientation = 'vertical',
  style,
}: RadioGroupProps) {
  const styles = StyleSheet.create({
    container: {
      flexDirection: orientation === 'horizontal' ? 'row' : 'column',
      gap: orientation === 'horizontal' ? spacing.md : spacing.sm,
      flexWrap: orientation === 'horizontal' ? 'wrap' : 'nowrap',
    },
  });

  return (
    <View style={[styles.container, style]} accessibilityRole="radiogroup">
      {React.Children.map(children, (child) => {
        if (React.isValidElement<RadioGroupItemComponentProps>(child) && child.type === RadioGroupItem) {
          const childProps = child.props;
          return React.cloneElement(child, {
            selected: value === childProps.value,
            onSelect: () => {
              if (!disabled && !childProps.disabled) {
                onValueChange(childProps.value);
              }
            },
            disabled: disabled || childProps.disabled,
          });
        }
        return child;
      })}
    </View>
  );
}

export function RadioGroupItem({
  value,
  disabled = false,
  size = 'md',
  label,
  description,
  labelPosition = 'right',
  variant = 'default',
  style,
  accessibilityLabel,
  // These props are injected by RadioGroup
  selected = false,
  onSelect = () => {},
}: RadioGroupItemComponentProps) {
  const { colors } = useTheme();
  const animatedValue = useRef(new Animated.Value(selected ? 1 : 0)).current;
  const scaleValue = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(animatedValue, {
      toValue: selected ? 1 : 0,
      tension: 100,
      friction: 8,
      useNativeDriver: false,
    }).start();
  }, [selected, animatedValue]);

  const getSizeStyles = () => {
    switch (size) {
      case 'sm':
        return {
          radio: { width: 20, height: 20, borderRadius: 10 },
          inner: { width: 10, height: 10, borderRadius: 5 },
          labelFontSize: typography.bodyS.fontSize,
          descriptionFontSize: typography.caption.fontSize,
        };
      case 'lg':
        return {
          radio: { width: 28, height: 28, borderRadius: 14 },
          inner: { width: 14, height: 14, borderRadius: 7 },
          labelFontSize: typography.bodyM.fontSize,
          descriptionFontSize: typography.bodyS.fontSize,
        };
      default:
        return {
          radio: { width: 24, height: 24, borderRadius: 12 },
          inner: { width: 12, height: 12, borderRadius: 6 },
          labelFontSize: typography.bodyM.fontSize,
          descriptionFontSize: typography.caption.fontSize,
        };
    }
  };

  const getVariantStyles = () => {
    switch (variant) {
      case 'primary':
        return {
          selectedColor: colors.primary,
          selectedBorderColor: colors.primary,
          textColor: colors.primary,
        };
      case 'destructive':
        return {
          selectedColor: colors.destructive,
          selectedBorderColor: colors.destructive,
          textColor: colors.destructive,
        };
      default:
        return {
          selectedColor: colors.primary,
          selectedBorderColor: colors.primary,
          textColor: colors.foreground,
        };
    }
  };

  const sizeStyles = getSizeStyles();
  const variantStyles = getVariantStyles();

  const borderColor = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [
      disabled ? colors.divider : colors.divider,
      disabled ? colors.primaryMuted : variantStyles.selectedBorderColor,
    ],
  });

  const innerScale = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const handlePress = () => {
    if (!disabled) {
      // Animate scale for tactile feedback
      Animated.sequence([
        Animated.timing(scaleValue, {
          toValue: 0.9,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(scaleValue, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
      ]).start();

      onSelect();
    }
  };

  const styles = StyleSheet.create({
    container: {
      flexDirection: labelPosition === 'left' ? 'row-reverse' : 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      minHeight: 44,
    },
    radioContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: label ? spacing.xxs : 0,
    },
    radio: {
      ...sizeStyles.radio,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
      opacity: disabled ? 0.6 : 1,
      backgroundColor: colors.surface,
    },
    inner: {
      ...sizeStyles.inner,
      backgroundColor: disabled ? colors.primaryMuted : variantStyles.selectedColor,
    },
    labelContainer: {
      flex: 1,
    },
    label: {
      fontSize: sizeStyles.labelFontSize,
      fontWeight: '500',
      color: disabled ? colors.textTertiary : variantStyles.textColor,
      lineHeight: sizeStyles.labelFontSize * 1.4,
      fontFamily: fontFamilies.text,
    },
    description: {
      fontSize: sizeStyles.descriptionFontSize,
      color: colors.textSecondary,
      marginTop: spacing.xxs,
      lineHeight: sizeStyles.descriptionFontSize * 1.4,
      fontFamily: fontFamilies.text,
    },
  });

  const radioElement = (
    <TouchableOpacity
      style={styles.radioContainer}
      onPress={handlePress}
      disabled={disabled}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityRole="radio"
      accessibilityState={{ 
        selected,
        disabled 
      }}
      accessibilityLabel={accessibilityLabel || label}
    >
      <Animated.View
        style={[
          styles.radio,
          {
            borderColor,
            transform: [{ scale: scaleValue }],
          },
        ]}
      >
        <Animated.View
          style={[
            styles.inner,
            {
              transform: [{ scale: innerScale }],
            },
          ]}
        />
      </Animated.View>
    </TouchableOpacity>
  );

  if (!label && !description) {
    return <View style={style}>{radioElement}</View>;
  }

  return (
    <View style={[styles.container, style]}>
      {radioElement}
      <View style={styles.labelContainer}>
        {label && <Text style={styles.label}>{label}</Text>}
        {description && <Text style={styles.description}>{description}</Text>}
      </View>
    </View>
  );
}

// Utility component for form-like radio groups with consistent spacing
export function FormRadioGroup({
  children,
  title,
  description,
  error,
  ...props
}: RadioGroupProps & { 
  children?: React.ReactNode;
  title?: string;
  description?: string;
  error?: string;
}) {
  const { colors } = useTheme();

  const styles = StyleSheet.create({
    container: {
      paddingVertical: 8,
    },
    title: {
      fontSize: 16,
      fontWeight: '500',
      color: colors.foreground,
      marginBottom: 8,
    },
    description: {
      fontSize: 14,
      color: colors.mutedForeground,
      marginBottom: 12,
      lineHeight: 20,
    },
    error: {
      fontSize: 12,
      color: colors.destructive,
      marginTop: 8,
    },
  });

  return (
    <View style={styles.container}>
      {title && <Text style={styles.title}>{title}</Text>}
      {description && <Text style={styles.description}>{description}</Text>}
      <RadioGroup {...props}>
        {children}
      </RadioGroup>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

// Controlled radio group that manages its own state
export function ControlledRadioGroup({
  defaultValue = '',
  onValueChange,
  children,
  ...props
}: Omit<RadioGroupProps, 'value' | 'onValueChange'> & {
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
}) {
  const [value, setValue] = React.useState(defaultValue);

  const handleValueChange = (newValue: string) => {
    setValue(newValue);
    onValueChange?.(newValue);
  };

  return (
    <RadioGroup
      {...props}
      value={value}
      onValueChange={handleValueChange}
    >
      {children}
    </RadioGroup>
  );
}
