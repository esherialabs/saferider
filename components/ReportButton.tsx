import React from 'react';
import { TouchableOpacity, Text, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';

interface ReportButtonProps {
  size?: number;
  onPress?: () => void;
}

export default function ReportButton({ size = 100, onPress }: ReportButtonProps) {
  const router = useRouter();
  
  const handlePress = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
    
    if (onPress) {
      onPress();
    } else {
      router.push('/report');
    }
  };
  
  return (
    <TouchableOpacity
      style={[
        styles.button,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
      ]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <Text style={styles.buttonText}>REPORT</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: Colors.dark.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.dark.accent,
    elevation: 5,
    shadowColor: Colors.dark.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  buttonText: {
    color: Colors.dark.text,
    fontWeight: 'bold',
    fontSize: 16,
  },
});