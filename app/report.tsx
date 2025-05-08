import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafetyStore } from '@/store/safetyStore';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { AlertTriangle, CheckCircle, PhoneCall } from 'lucide-react-native';
import * as Linking from 'expo-linking';

export default function ReportScreen() {
  const router = useRouter();
  const { setStatus, addHistoryItem, contacts } = useSafetyStore();
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const handleEmergency = () => {
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
    
    setStatus('danger');
    addHistoryItem({
      status: 'danger',
      description: description || 'Emergency reported',
    });
    
    setIsSubmitting(true);
    
    // Simulate API call
    setTimeout(() => {
      setIsSubmitting(false);
      router.back();
    }, 1000);
  };
  
  const handleWarning = () => {
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
    
    setStatus('warning');
    addHistoryItem({
      status: 'warning',
      description: description || 'Feeling unsafe',
    });
    
    setIsSubmitting(true);
    
    // Simulate API call
    setTimeout(() => {
      setIsSubmitting(false);
      router.back();
    }, 1000);
  };
  
  const handleSafe = () => {
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    
    setStatus('safe');
    addHistoryItem({
      status: 'safe',
      description: description || 'Marked as safe',
    });
    
    setIsSubmitting(true);
    
    // Simulate API call
    setTimeout(() => {
      setIsSubmitting(false);
      router.back();
    }, 1000);
  };
  
  const handleCall = (phone: string) => {
    Linking.openURL(`tel:${phone}`);
  };
  
  const handleReportIncident = () => {
    router.push('/report-incident');
  };
  
  const primaryContact = contacts.find(contact => contact.isPrimary);
  
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>What's happening?</Text>
        <TextInput
          style={styles.input}
          placeholder="Describe your situation..."
          placeholderTextColor={Colors.dark.tabIconDefault}
          multiline
          numberOfLines={4}
          value={description}
          onChangeText={setDescription}
        />
      </View>
      
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Report</Text>
        <TouchableOpacity
          style={[styles.button, styles.emergencyButton]}
          onPress={handleEmergency}
          disabled={isSubmitting}
        >
          <AlertTriangle size={24} color={Colors.dark.text} />
          <Text style={styles.buttonText}>Emergency</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.button, styles.warningButton]}
          onPress={handleWarning}
          disabled={isSubmitting}
        >
          <AlertTriangle size={24} color={Colors.dark.text} />
          <Text style={styles.buttonText}>Feeling Unsafe</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.button, styles.safeButton]}
          onPress={handleSafe}
          disabled={isSubmitting}
        >
          <CheckCircle size={24} color={Colors.dark.text} />
          <Text style={styles.buttonText}>I'm Safe</Text>
        </TouchableOpacity>
      </View>
      
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.detailedReportButton}
          onPress={handleReportIncident}
        >
          <Text style={styles.detailedReportText}>Report Detailed Incident</Text>
        </TouchableOpacity>
      </View>
      
      {primaryContact && Platform.OS !== 'web' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Emergency Call</Text>
          <TouchableOpacity
            style={styles.callButton}
            onPress={() => handleCall(primaryContact.phone)}
          >
            <PhoneCall size={24} color={Colors.dark.text} />
            <Text style={styles.buttonText}>Call {primaryContact.name}</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  content: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: Colors.dark.text,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  input: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    color: Colors.dark.text,
    fontSize: 16,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  emergencyButton: {
    backgroundColor: Colors.dark.dangerStatus,
  },
  warningButton: {
    backgroundColor: Colors.dark.warningStatus,
  },
  safeButton: {
    backgroundColor: Colors.dark.safeStatus,
  },
  callButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.dark.accent,
  },
  buttonText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 12,
  },
  detailedReportButton: {
    backgroundColor: Colors.dark.accent,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailedReportText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
});