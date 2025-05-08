import React from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { SafetyStatus } from '@/types';
import Colors from '@/constants/colors';

interface StatusIndicatorProps {
  status: SafetyStatus;
  size?: number;
}

export default function StatusIndicator({ status, size = 200 }: StatusIndicatorProps) {
  const pulseAnim = React.useRef(new Animated.Value(1)).current;
  
  React.useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    
    pulse.start();
    
    return () => {
      pulse.stop();
    };
  }, [pulseAnim]);
  
  const getStatusColor = () => {
    switch (status) {
      case 'safe':
        return Colors.dark.safeStatus;
      case 'warning':
        return Colors.dark.warningStatus;
      case 'danger':
        return Colors.dark.dangerStatus;
      default:
        return Colors.dark.safeStatus;
    }
  };
  
  const getStatusText = () => {
    switch (status) {
      case 'safe':
        return 'Safe';
      case 'warning':
        return 'Warning';
      case 'danger':
        return 'Danger';
      default:
        return 'Safe';
    }
  };
  
  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.pulseCircle,
          {
            backgroundColor: getStatusColor(),
            width: size * 1.2,
            height: size * 1.2,
            borderRadius: (size * 1.2) / 2,
            transform: [{ scale: pulseAnim }],
            opacity: 0.3,
          },
        ]}
      />
      <View
        style={[
          styles.circle,
          {
            backgroundColor: Colors.dark.card,
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: getStatusColor(),
          },
        ]}
      >
        <Text style={[styles.statusText, { fontSize: size / 5 }]}>
          {getStatusText()}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseCircle: {
    position: 'absolute',
  },
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
  },
  statusText: {
    color: Colors.dark.text,
    fontWeight: 'bold',
  },
});