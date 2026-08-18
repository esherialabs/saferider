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
import { Ionicons } from '@expo/vector-icons';
import { spacing, typography, fontFamilies, touchTargets } from '../../theme/tokens';

export type CheckboxState = boolean | 'indeterminate';

export interface CheckboxProps {
  checked: CheckboxState;
  onCheckedChange: (checked: CheckboxState) => void;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  description?: string;
  labelPosition?: 'left' | 'right';
  variant?: 'default' | 'primary' | 'destructive';
  style?: any;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

export function Checkbox({
  checked,
  onCheckedChange,
  disabled = false,
  size = 'md',
  label,
  description,
  labelPosition = 'right',
  variant = 'default',
  style,
  accessibilityLabel,
  accessibilityHint,
}: CheckboxProps) {
  const { colors } = useTheme();
  const animatedValue = useRef(new Animated.Value(checked ? 1 : 0)).current;
  const scaleValue = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(animatedValue, {
      toValue: checked ? 1 : 0,
      tension: 100,
      friction: 8,
      useNativeDriver: false,
    }).start();
  }, [checked, animatedValue]);

  const getSizeStyles = () => {
    switch (size) {
      case 'sm':
        return {
          checkbox: { width: 20, height: 20, borderRadius: 6 },
          iconSize: 12,
          labelFontSize: typography.bodyS.fontSize,
          descriptionFontSize: typography.caption.fontSize,
        };
      case 'lg':
        return {
          checkbox: { width: 28, height: 28, borderRadius: 8 },
          iconSize: 18,
          labelFontSize: typography.bodyM.fontSize,
          descriptionFontSize: typography.bodyS.fontSize,
        };
      default:
        return {
          checkbox: { width: 24, height: 24, borderRadius: 8 },
          iconSize: 16,
          labelFontSize: typography.bodyM.fontSize,
          descriptionFontSize: typography.caption.fontSize,
        };
    }
  };

  const getVariantStyles = () => {
    switch (variant) {
      case 'primary':
        return {
          checkedColor: colors.primary,
          checkedBorderColor: colors.primary,
          textColor: colors.primary,
        };
      case 'destructive':
        return {
          checkedColor: colors.destructive,
          checkedBorderColor: colors.destructive,
          textColor: colors.destructive,
        };
      default:
        return {
          checkedColor: colors.primary,
          checkedBorderColor: colors.primary,
          textColor: colors.foreground,
        };
    }
  };

  const sizeStyles = getSizeStyles();
  const variantStyles = getVariantStyles();

  const backgroundColor = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [
      colors.surface,
      disabled ? colors.primaryMuted : variantStyles.checkedColor,
    ],
  });

  const borderColor = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [
      disabled ? colors.divider : colors.divider,
      disabled ? colors.primaryMuted : variantStyles.checkedBorderColor,
    ],
  });

  const handlePress = () => {
    if (!disabled) {
      // Animate scale for tactile feedback
      Animated.sequence([
        Animated.timing(scaleValue, {
          toValue: 0.9,
          duration: 100,
          useNativeDriver: false,
        }),
        Animated.timing(scaleValue, {
          toValue: 1,
          duration: 100,
          useNativeDriver: false,
        }),
      ]).start();

      // Toggle checked state
      if (checked === 'indeterminate') {
        onCheckedChange(true);
      } else {
        onCheckedChange(!checked);
      }
    }
  };

  const getIcon = () => {
    if (checked === 'indeterminate') {
      return 'remove';
    }
    return checked ? 'checkmark' : null;
  };

  const iconName = getIcon();
  const iconColor = variant === 'destructive' ? colors.destructiveForeground : colors.primaryForeground;

  const styles = StyleSheet.create({
    container: {
      flexDirection: labelPosition === 'left' ? 'row-reverse' : 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      minHeight: touchTargets.minimum,
    },
    checkboxContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: touchTargets.minimum,
      minWidth: touchTargets.minimum,
      marginTop: label ? spacing.xxs : 0,
    },
    checkbox: {
      ...sizeStyles.checkbox,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
      opacity: disabled ? 0.6 : 1,
      backgroundColor: colors.surface,
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

  const checkboxElement = (
    <TouchableOpacity
      style={styles.checkboxContainer}
      onPress={handlePress}
      disabled={disabled}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityRole="checkbox"
      accessibilityState={{ 
        checked: checked === 'indeterminate' ? 'mixed' : checked,
        disabled 
      }}
      accessibilityLabel={accessibilityLabel || label}
      accessibilityHint={accessibilityHint}
    >
      <Animated.View
        style={[
          styles.checkbox,
          {
            backgroundColor,
            borderColor,
            transform: [{ scale: scaleValue }],
          },
        ]}
      >
        {iconName && (
          <Animated.View
            style={{
              opacity: animatedValue,
              transform: [
                {
                  scale: animatedValue.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.5, 1],
                  }),
                },
              ],
            }}
          >
            <Ionicons
              name={iconName as any}
              size={sizeStyles.iconSize}
              color={disabled ? colors.textSecondary : iconColor}
            />
          </Animated.View>
        )}
      </Animated.View>
    </TouchableOpacity>
  );

  if (!label && !description) {
    return <View style={style}>{checkboxElement}</View>;
  }

  return (
    <View style={[styles.container, style]}>
      {checkboxElement}
      <View style={styles.labelContainer}>
        {label && <Text style={styles.label}>{label}</Text>}
        {description && <Text style={styles.description}>{description}</Text>}
      </View>
    </View>
  );
}

// Utility component for form-like checkboxes with consistent spacing
export function FormCheckbox({
  children,
  ...props
}: CheckboxProps & { children?: React.ReactNode }) {
  const styles = StyleSheet.create({
    container: {
      paddingVertical: spacing.sm,
    },
  });

  return (
    <View style={styles.container}>
      <Checkbox {...props} />
      {children}
    </View>
  );
}

// Controlled checkbox that manages its own state
export function ControlledCheckbox({
  defaultChecked = false,
  onCheckedChange,
  ...props
}: Omit<CheckboxProps, 'checked' | 'onCheckedChange'> & {
  defaultChecked?: CheckboxState;
  onCheckedChange?: (checked: CheckboxState) => void;
}) {
  const [checked, setChecked] = React.useState<CheckboxState>(defaultChecked);

  const handleCheckedChange = (newChecked: CheckboxState) => {
    setChecked(newChecked);
    onCheckedChange?.(newChecked);
  };

  return (
    <Checkbox
      {...props}
      checked={checked}
      onCheckedChange={handleCheckedChange}
    />
  );
}

// Checkbox group for managing multiple checkboxes
export interface CheckboxGroupProps {
  children: React.ReactNode;
  value: string[];
  onValueChange: (value: string[]) => void;
  disabled?: boolean;
  style?: any;
}

export function CheckboxGroup({
  children,
  value,
  onValueChange,
  disabled = false,
  style,
}: CheckboxGroupProps) {
  return (
    <View style={style}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement<CheckboxGroupItemComponentProps>(child) && child.type === CheckboxGroupItem) {
          const childProps = child.props;
          return React.cloneElement(child, {
            checked: value.includes(childProps.value),
            onCheckedChange: (newChecked: CheckboxState) => {
              if (newChecked === true) {
                onValueChange([...value, childProps.value]);
              } else {
                onValueChange(value.filter((v) => v !== childProps.value));
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

export interface CheckboxGroupItemProps extends Omit<CheckboxProps, 'checked' | 'onCheckedChange'> {
  value: string;
}

type CheckboxGroupItemComponentProps = CheckboxGroupItemProps & {
  checked?: CheckboxState;
  onCheckedChange?: (checked: CheckboxState) => void;
};

export function CheckboxGroupItem({
  checked = false,
  onCheckedChange = () => {},
  ...props
}: CheckboxGroupItemComponentProps) {
  return <Checkbox checked={checked} onCheckedChange={onCheckedChange} {...props} />;
}
