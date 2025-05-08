import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Colors from '@/constants/colors';

interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
}

export default function StepIndicator({ currentStep, totalSteps }: StepIndicatorProps) {
  const renderSteps = () => {
    const steps = [];
    
    for (let i = 1; i <= totalSteps; i++) {
      const isActive = i === currentStep;
      const isCompleted = i < currentStep;
      
      steps.push(
        <View key={i} style={styles.stepContainer}>
          <View 
            style={[
              styles.stepCircle, 
              isActive && styles.activeStepCircle,
              isCompleted && styles.completedStepCircle
            ]}
          >
            <Text 
              style={[
                styles.stepText, 
                isActive && styles.activeStepText,
                isCompleted && styles.completedStepText
              ]}
            >
              {i}
            </Text>
          </View>
          
          {i < totalSteps && (
            <View 
              style={[
                styles.stepLine, 
                (isActive || isCompleted) && styles.activeStepLine
              ]} 
            />
          )}
        </View>
      );
    }
    
    return steps;
  };
  
  return (
    <View style={styles.container}>
      {renderSteps()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
  },
  stepContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeStepCircle: {
    backgroundColor: Colors.dark.accent,
  },
  completedStepCircle: {
    backgroundColor: Colors.dark.accent,
  },
  stepText: {
    color: Colors.dark.background,
    fontWeight: 'bold',
    fontSize: 14,
  },
  activeStepText: {
    color: Colors.dark.text,
  },
  completedStepText: {
    color: Colors.dark.text,
  },
  stepLine: {
    width: 40,
    height: 2,
    backgroundColor: '#D1D5DB',
    marginHorizontal: 4,
  },
  activeStepLine: {
    backgroundColor: Colors.dark.accent,
  },
});