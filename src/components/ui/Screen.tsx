import React from 'react';
import { View, ScrollView, StyleSheet, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/SimpleThemeProvider';

interface ScreenProps {
  children: React.ReactNode;
  scrollable?: boolean;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
  statusBarStyle?: 'auto' | 'inverted';
  className?: string;
}

export default function Screen({ 
  children, 
  scrollable = false, 
  edges = ['top', 'bottom', 'left', 'right'],
  statusBarStyle = 'auto',
  className 
}: ScreenProps) {
  const { colors, colorScheme } = useTheme();

  const containerStyle = {
    flex: 1,
    backgroundColor: colors.background,
  };

  const contentStyle = {
    flexGrow: 1,
    backgroundColor: colors.background,
  };

  return (
    <SafeAreaView style={containerStyle} edges={edges}>
      <StatusBar 
        barStyle={
          statusBarStyle === 'auto' 
            ? colorScheme === 'dark' ? 'light-content' : 'dark-content'
            : colorScheme === 'dark' ? 'dark-content' : 'light-content'
        }
        backgroundColor={colors.canvas}
      />
      {scrollable ? (
        <ScrollView
          style={containerStyle}
          contentContainerStyle={contentStyle}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          accessible={false}
          contentInsetAdjustmentBehavior="automatic"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={containerStyle}>
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}
