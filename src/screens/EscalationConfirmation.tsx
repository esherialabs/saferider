import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import Screen from '../components/ui/Screen';
import Button from '../components/ui/Button';
import { Chip } from '../components/ui/Chip';
import { useTheme } from '../theme/SimpleThemeProvider';
import { RootStackParamList } from '../navigation/routes';

type EscalationConfirmationNavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface EscalationConfirmationRouteParams {
  isOffline?: boolean;
  caseId: string;
  contactMethod: string;
}

export default function EscalationConfirmationScreen() {
  const navigation = useNavigation<EscalationConfirmationNavigationProp>();
  const route = useRoute();
  const { colors } = useTheme();
  
  const { isOffline = false, caseId, contactMethod } = route.params as EscalationConfirmationRouteParams;

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    statusIcon: {
      width: 64,
      height: 64,
      borderRadius: 32,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 24,
    },
    title: {
      fontSize: 24,
      fontWeight: 'bold',
      color: colors.foreground,
      textAlign: 'center',
      marginBottom: 16,
    },
    subtitle: {
      fontSize: 16,
      color: colors.mutedForeground,
      textAlign: 'center',
      marginBottom: 24,
      maxWidth: 280,
    },
    chipsContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      marginBottom: 32,
    },
    chipSpacing: {
      marginRight: 8,
      marginBottom: 8,
    },
    buttonsContainer: {
      width: '100%',
      maxWidth: 280,
      gap: 12,
    },
    microcopy: {
      fontSize: 12,
      color: colors.mutedForeground,
      textAlign: 'center',
      marginTop: 24,
      maxWidth: 280,
    },
  });

  const handleViewCase = () => {
    navigation.navigate('CaseDetail', { caseId });
  };

  const handleDone = () => {
    navigation.navigate('MainTabs');
  };

  return (
    <Screen>
      <View style={styles.container}>
        {/* Status Icon */}
        <View style={[
          styles.statusIcon,
          {
            backgroundColor: isOffline 
              ? colors.primary + '20'
              : '#22c55e20'
          }
        ]}>
          <Ionicons 
            name={isOffline ? "time-outline" : "checkmark-circle-outline"} 
            size={32} 
            color={isOffline ? colors.primary : '#22c55e'}
          />
        </View>

        {/* Title */}
        <Text style={styles.title}>
          {isOffline ? 'Queued to send' : 'Sent'}
        </Text>

        {/* Subtitle */}
        <Text style={styles.subtitle}>
          {isOffline 
            ? "We'll send it when you're online."
            : "Your incident packet was delivered."
          }
        </Text>

        {/* Info Chips */}
        <View style={styles.chipsContainer}>
          <Chip label={`Case ID: ${caseId}`} style={styles.chipSpacing} />
          <Chip label={`Contact: ${contactMethod}`} style={styles.chipSpacing} />
        </View>

        {/* Buttons */}
        <View style={styles.buttonsContainer}>
          <Button
            title="View case"
            onPress={handleViewCase}
            fullWidth
          />
          <Button
            title="Done"
            onPress={handleDone}
            variant="outline"
            fullWidth
          />
        </View>

        {/* Microcopy */}
        <Text style={styles.microcopy}>
          Case details show available local draft actions. Open a submitted case detail to request manual deletion review.
        </Text>
      </View>
    </Screen>
  );
}
