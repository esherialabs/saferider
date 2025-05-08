import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { Shield } from 'lucide-react-native';
import Colors from '@/constants/colors';

interface SplashScreenProps {
  onFinish: () => void;
}

export default function SplashScreen({ onFinish }: SplashScreenProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const dotAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Sequence of animations
    Animated.sequence([
      // Fade in and scale up
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
          easing: Easing.out(Easing.ease),
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
          easing: Easing.out(Easing.back(1.5)),
        }),
      ]),
      
      // Start glowing effect
      Animated.timing(glowAnim, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: false,
        easing: Easing.inOut(Easing.ease),
      }),
      
      // Animate dots
      Animated.timing(dotAnim, {
        toValue: 3,
        duration: 1500,
        useNativeDriver: false,
        easing: Easing.inOut(Easing.ease),
      }),
      
      // Hold for a moment
      Animated.delay(500),
    ]).start(() => {
      // Call onFinish when animation sequence completes
      onFinish();
    });
  }, [fadeAnim, scaleAnim, glowAnim, dotAnim, onFinish]);

  // Interpolate glow opacity for pulsing effect
  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.7],
  });

  // Interpolate dot opacity for sequential appearance
  const dot1Opacity = dotAnim.interpolate({
    inputRange: [0, 0.5, 3],
    outputRange: [0.3, 1, 1],
  });
  
  const dot2Opacity = dotAnim.interpolate({
    inputRange: [0, 0.5, 1, 3],
    outputRange: [0.3, 0.3, 1, 1],
  });
  
  const dot3Opacity = dotAnim.interpolate({
    inputRange: [0, 1, 1.5, 3],
    outputRange: [0.3, 0.3, 1, 1],
  });

  return (
    <View style={styles.container}>
      <Animated.View 
        style={[
          styles.iconContainer,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        {/* Glow effect */}
        <Animated.View 
          style={[
            styles.glow,
            {
              opacity: glowOpacity,
            },
          ]}
        />
        
        {/* Circle border */}
        <View style={styles.circle}>
          <Shield size={80} color="#FFFFFF" />
        </View>
      </Animated.View>
      
      <Animated.Text 
        style={[
          styles.title,
          {
            opacity: fadeAnim,
            transform: [
              { 
                translateY: fadeAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [20, 0],
                }) 
              }
            ],
          },
        ]}
      >
        Esheria SafeRide
      </Animated.Text>
      
      <View style={styles.dotsContainer}>
        <Animated.View style={[styles.dot, { opacity: dot1Opacity }]} />
        <Animated.View style={[styles.dot, { opacity: dot2Opacity }]} />
        <Animated.View style={[styles.dot, { opacity: dot3Opacity }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 60,
  },
  glow: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: Colors.dark.warningStatus,
    opacity: 0.5,
  },
  circle: {
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 3,
    borderColor: Colors.dark.warningStatus,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10, 26, 53, 0.8)',
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 100,
  },
  dotsContainer: {
    flexDirection: 'row',
    position: 'absolute',
    bottom: 60,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
    marginHorizontal: 5,
  },
});