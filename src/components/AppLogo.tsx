import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  DeviceEventEmitter,
  Easing,
  ImageStyle,
  Pressable,
  StyleProp,
} from 'react-native';
import { useOnboarding } from '../context/OnboardingProvider';
import { APP_EVENT_STEALTH_SECRET_TAP } from '../utils/appEvents';

type AppLogoProps = {
  width?: number;
  height?: number;
  inverted?: boolean;
  animated?: boolean;
  style?: StyleProp<ImageStyle>;
};

export function AppLogo({ width = 140, height = 48, inverted = false, animated = true, style }: AppLogoProps) {
  const {
    state: { stealthSettings },
  } = useOnboarding();
  const activeTrigger = stealthSettings?.trigger ?? 'volume';
  const [reduceMotion, setReduceMotion] = useState(false);

  const tapCountRef = useRef(0);
  const lastTapTimestampRef = useRef<number | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleProgressRef = useRef(new Animated.Value(0));
  const pressScaleRef = useRef(new Animated.Value(1));
  const idleProgress = idleProgressRef.current;
  const pressScale = pressScaleRef.current;
  const motionEnabled = animated && !reduceMotion;

  const reset = useCallback(() => {
    tapCountRef.current = 0;
    lastTapTimestampRef.current = null;
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (isMounted) {
          setReduceMotion(enabled);
        }
      })
      .catch(() => undefined);

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!motionEnabled) {
      idleProgress.stopAnimation();
      idleProgress.setValue(0);
      pressScale.stopAnimation();
      pressScale.setValue(1);
      return undefined;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(idleProgress, {
          toValue: 1,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(idleProgress, {
          toValue: 0,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    loop.start();

    return () => {
      loop.stop();
    };
  }, [idleProgress, motionEnabled, pressScale]);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const handlePressIn = useCallback(() => {
    if (!motionEnabled || activeTrigger !== 'tap') {
      return;
    }

    pressScale.stopAnimation();
    Animated.timing(pressScale, {
      toValue: 0.97,
      duration: 90,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [activeTrigger, motionEnabled, pressScale]);

  const handlePressOut = useCallback(() => {
    if (!motionEnabled || activeTrigger !== 'tap') {
      return;
    }

    pressScale.stopAnimation();
    Animated.timing(pressScale, {
      toValue: 1,
      duration: 160,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [activeTrigger, motionEnabled, pressScale]);

  const triggerLogoFeedback = useCallback(() => {
    if (!motionEnabled) {
      return;
    }

    pressScale.stopAnimation();
    Animated.sequence([
      Animated.timing(pressScale, {
        toValue: 1.08,
        duration: 110,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(pressScale, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  }, [motionEnabled, pressScale]);

  const handlePress = useCallback(() => {
    if (activeTrigger !== 'tap') {
      return;
    }

    const now = Date.now();
    if (lastTapTimestampRef.current && now - lastTapTimestampRef.current > 2500) {
      tapCountRef.current = 0;
    }

    tapCountRef.current += 1;
    lastTapTimestampRef.current = now;

    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
    }

    resetTimerRef.current = setTimeout(reset, 2500);

    if (tapCountRef.current >= 5) {
      DeviceEventEmitter.emit(APP_EVENT_STEALTH_SECRET_TAP);
      triggerLogoFeedback();
      reset();
    }
  }, [activeTrigger, reset, triggerLogoFeedback]);

  const idleScale = idleProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.018],
  });
  const idleTranslateY = idleProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -1.5],
  });
  const idleOpacity = idleProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.97, 1],
  });

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={activeTrigger !== 'tap'}
      hitSlop={16}
      accessibilityRole="image"
      accessibilityLabel="SafeRide logo"
    >
      <Animated.Image
        source={inverted ? require('../../assets/logo-inverted.png') : require('../../assets/logo.png')}
        resizeMode="contain"
        style={[
          { width, height },
          style,
          motionEnabled
            ? {
                opacity: idleOpacity,
                transform: [{ translateY: idleTranslateY }, { scale: idleScale }, { scale: pressScale }],
              }
            : null,
        ]}
      />
    </Pressable>
  );
}

export default AppLogo;
