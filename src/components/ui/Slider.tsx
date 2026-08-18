import React from 'react';
import { useRef, useState } from 'react';
import {
  View,
  PanResponder,
  Animated,
  StyleSheet,
  GestureResponderEvent,
} from 'react-native';
import { useTheme } from '../../theme/SimpleThemeProvider';

export interface SliderProps {
  value: number[];
  onValueChange?: (value: number[]) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  style?: any;
  trackStyle?: any;
  activeTrackStyle?: any;
  thumbStyle?: any;
  thumbSize?: number;
}

export function Slider({
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  style,
  trackStyle,
  activeTrackStyle,
  thumbStyle,
  thumbSize = 20,
}: SliderProps) {
  const { colors } = useTheme();
  const [sliderWidth, setSliderWidth] = useState(0);
  const animatedValue = useRef(new Animated.Value(value[0])).current;
  const currentValue = useRef(value[0]);
  const sliderWidthRef = useRef(0);
  const minRef = useRef(min);
  const maxRef = useRef(max);
  const stepRef = useRef(step);
  const disabledRef = useRef(disabled);
  const onValueChangeRef = useRef(onValueChange);
  
  // Update animated value when prop changes
  React.useEffect(() => {
    const newValue = value[0];
    if (newValue !== currentValue.current) {
      currentValue.current = newValue;
      animatedValue.setValue(newValue);
    }
  }, [value, animatedValue]);

  React.useEffect(() => {
    minRef.current = min;
    maxRef.current = max;
    stepRef.current = step;
    disabledRef.current = disabled;
    onValueChangeRef.current = onValueChange;
  }, [disabled, max, min, onValueChange, step]);

  const updateValueFromPosition = (positionX: number) => {
    const width = sliderWidthRef.current;
    if (width <= 0) return;
    const minimum = minRef.current;
    const maximum = maxRef.current;
    const increment = stepRef.current;
    const percentage = Math.max(0, Math.min(1, positionX / width));
    const rawValue = minimum + percentage * (maximum - minimum);
    const steppedValue = Math.round((rawValue - minimum) / increment) * increment + minimum;
    const nextValue = Math.max(minimum, Math.min(maximum, steppedValue));

    currentValue.current = nextValue;
    animatedValue.setValue(nextValue);
    onValueChangeRef.current?.([nextValue]);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current,
      onMoveShouldSetPanResponder: () => !disabledRef.current,
      onPanResponderGrant: (event: GestureResponderEvent) => {
        updateValueFromPosition(event.nativeEvent.locationX - thumbSize / 2);
      },
      onPanResponderMove: (event: GestureResponderEvent) => {
        updateValueFromPosition(event.nativeEvent.locationX - thumbSize / 2);
      },
    })
  ).current;

  const thumbPosition = animatedValue.interpolate({
    inputRange: [min, max],
    outputRange: [0, sliderWidth],
    extrapolate: 'clamp',
  });

  const activeTrackWidth = animatedValue.interpolate({
    inputRange: [min, max],
    outputRange: [0, sliderWidth],
    extrapolate: 'clamp',
  });

  const styles = StyleSheet.create({
    container: {
      height: thumbSize + 10,
      justifyContent: 'center',
      paddingHorizontal: thumbSize / 2,
    },
    track: {
      height: 4,
      backgroundColor: colors.muted,
      borderRadius: 2,
      position: 'relative',
    },
    activeTrack: {
      height: 4,
      backgroundColor: colors.primary,
      borderRadius: 2,
      position: 'absolute',
      left: 0,
      top: 0,
    },
    thumb: {
      width: thumbSize,
      height: thumbSize,
      backgroundColor: colors.background,
      borderRadius: thumbSize / 2,
      borderWidth: 2,
      borderColor: colors.primary,
      position: 'absolute',
      left: -(thumbSize / 2),
      top: -((thumbSize - 4) / 2),
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
      elevation: 3,
    },
    disabledThumb: {
      borderColor: colors.muted,
      backgroundColor: colors.muted,
    },
    disabledTrack: {
      backgroundColor: colors.muted,
    },
    disabledActiveTrack: {
      backgroundColor: colors.mutedForeground,
    },
  });

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityValue={{ min, max, now: currentValue.current }}
      accessibilityActions={[
        { name: 'increment', label: 'Increase' },
        { name: 'decrement', label: 'Decrease' },
      ]}
      onAccessibilityAction={(event) => {
        const delta = event.nativeEvent.actionName === 'increment'
          ? step
          : event.nativeEvent.actionName === 'decrement'
            ? -step
            : 0;
        if (!delta || disabled) return;
        const nextValue = Math.max(min, Math.min(max, currentValue.current + delta));
        currentValue.current = nextValue;
        animatedValue.setValue(nextValue);
        onValueChange?.([nextValue]);
      }}
      style={[styles.container, style]}
      {...panResponder.panHandlers}
    >
      <View
        style={[
          styles.track,
          disabled && styles.disabledTrack,
          trackStyle,
        ]}
        onLayout={(event) => {
          const { width } = event.nativeEvent.layout;
          setSliderWidth(width);
          sliderWidthRef.current = width;
        }}
      >
        <Animated.View
          style={[
            styles.activeTrack,
            disabled && styles.disabledActiveTrack,
            { width: activeTrackWidth },
            activeTrackStyle,
          ]}
        />
        
        {sliderWidth > 0 && (
          <Animated.View
            style={[
              styles.thumb,
              disabled && styles.disabledThumb,
              { transform: [{ translateX: thumbPosition }] },
              thumbStyle,
            ]}
          />
        )}
      </View>
    </View>
  );
}

// Alternative implementation using React Native's built-in Slider
// (Uncomment if you prefer to use the built-in component)
/*
import { Slider as RNSlider } from '@react-native-community/slider';

export function Slider({
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  style,
  ...props
}: SliderProps) {
  const { colors } = useTheme();
  
  return (
    <RNSlider
      value={value[0]}
      onValueChange={(val) => onValueChange?.([val])}
      minimumValue={min}
      maximumValue={max}
      step={step}
      disabled={disabled}
      minimumTrackTintColor={colors.primary}
      maximumTrackTintColor={colors.muted}
      thumbStyle={{ backgroundColor: colors.background, borderColor: colors.primary }}
      style={[{ height: 30 }, style]}
      {...props}
    />
  );
}
*/
