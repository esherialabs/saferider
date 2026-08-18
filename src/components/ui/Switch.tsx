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
import { spacing, typography, fontFamilies, touchTargets } from '../../theme/tokens';

export interface SwitchProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  description?: string;
  labelPosition?: 'left' | 'right';
  trackColor?: {
    false?: string;
    true?: string;
  };
  thumbColor?: string;
  style?: any;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

export function Switch({
  value,
  onValueChange,
  disabled = false,
  size = 'md',
  label,
  description,
  labelPosition = 'right',
  trackColor,
  thumbColor,
  style,
  accessibilityLabel,
  accessibilityHint,
}: SwitchProps) {
  const { colors } = useTheme();
  const animatedValue = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(animatedValue, {
      toValue: value ? 1 : 0,
      tension: 100,
      friction: 8,
      useNativeDriver: false,
    }).start();
  }, [value, animatedValue]);

  const getSizeStyles = () => {
    switch (size) {
      case 'sm':
        return {
          track: { width: 36, height: 20, borderRadius: 10 },
          thumb: { width: 16, height: 16, borderRadius: 8 },
          translateX: 14, // track width - thumb width - 2px padding
        };
      case 'lg':
        return {
          track: { width: 56, height: 32, borderRadius: 16 },
          thumb: { width: 28, height: 28, borderRadius: 14 },
          translateX: 22, // track width - thumb width - 2px padding
        };
      default:
        return {
          track: { width: 44, height: 24, borderRadius: 12 },
          thumb: { width: 20, height: 20, borderRadius: 10 },
          translateX: 18, // track width - thumb width - 2px padding
        };
    }
  };

  const sizeStyles = getSizeStyles();

  const trackColorAnimated = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [
      trackColor?.false || (disabled ? colors.divider : colors.divider),
      trackColor?.true || (disabled ? colors.primaryMuted : colors.primary),
    ],
  });

  const thumbTranslateX = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [2, sizeStyles.translateX],
  });

  const handlePress = () => {
    if (!disabled) {
      onValueChange(!value);
    }
  };

  const styles = StyleSheet.create({
    container: {
      flexDirection: labelPosition === 'left' ? 'row-reverse' : 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: touchTargets.minimum,
    },
    switchContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: touchTargets.minimum,
      minWidth: touchTargets.minimum,
    },
    track: {
      ...sizeStyles.track,
      justifyContent: 'center',
      padding: 2,
      opacity: disabled ? 0.6 : 1,
      backgroundColor: trackColor?.false || colors.divider,
    },
    thumb: {
      ...sizeStyles.thumb,
      backgroundColor: thumbColor || colors.surface,
      shadowColor: 'rgba(17,24,39,0.2)',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
      elevation: 3,
      position: 'absolute',
      left: 0,
    },
    labelContainer: {
      flex: 1,
    },
    label: {
      fontSize: size === 'sm' ? typography.bodyS.fontSize : typography.bodyM.fontSize,
      fontWeight: '500',
      color: disabled ? colors.textTertiary : colors.foreground,
      lineHeight: size === 'sm' ? typography.bodyS.lineHeight : typography.bodyM.lineHeight,
      fontFamily: fontFamilies.text,
    },
    description: {
      fontSize: typography.caption.fontSize,
      color: colors.textSecondary,
      marginTop: spacing.xxs,
      lineHeight: typography.caption.lineHeight,
      fontFamily: fontFamilies.text,
    },
  });

  const switchElement = (
    <TouchableOpacity
      style={styles.switchContainer}
      onPress={handlePress}
      disabled={disabled}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={accessibilityLabel || label}
      accessibilityHint={accessibilityHint}
    >
      <Animated.View
        style={[
          styles.track,
          { backgroundColor: trackColorAnimated },
        ]}
      >
        <Animated.View
          style={[
            styles.thumb,
            {
              transform: [{ translateX: thumbTranslateX }],
            },
          ]}
        />
      </Animated.View>
    </TouchableOpacity>
  );

  if (!label && !description) {
    return <View style={style}>{switchElement}</View>;
  }

  return (
    <View style={[styles.container, style]}>
      {switchElement}
      <View style={styles.labelContainer}>
        {label && <Text style={styles.label}>{label}</Text>}
        {description && <Text style={styles.description}>{description}</Text>}
      </View>
    </View>
  );
}

// Utility component for form-like switches with consistent spacing
export function FormSwitch({
  children,
  ...props
}: SwitchProps & { children?: React.ReactNode }) {
  const styles = StyleSheet.create({
    container: {
      paddingVertical: spacing.sm,
    },
  });

  return (
    <View style={styles.container}>
      <Switch {...props} />
      {children}
    </View>
  );
}

// Controlled switch that manages its own state
export function ControlledSwitch({
  defaultValue = false,
  onValueChange,
  ...props
}: Omit<SwitchProps, 'value' | 'onValueChange'> & {
  defaultValue?: boolean;
  onValueChange?: (value: boolean) => void;
}) {
  const [value, setValue] = React.useState(defaultValue);

  const handleValueChange = (newValue: boolean) => {
    setValue(newValue);
    onValueChange?.(newValue);
  };

  return (
    <Switch
      {...props}
      value={value}
      onValueChange={handleValueChange}
    />
  );
}
