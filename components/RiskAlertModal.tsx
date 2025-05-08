import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Modal } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useSafetyStore } from '@/store/safetyStore';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

interface RiskAlertModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function RiskAlertModal({ visible, onClose }: RiskAlertModalProps) {
  const { setStatus, addHistoryItem } = useSafetyStore();
  
  const handleSafe = () => {
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    
    setStatus('safe');
    addHistoryItem({
      status: 'safe',
      description: 'Responded to auto-check: Safe',
    });
    
    onClose();
  };
  
  const handleSOS = () => {
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
    
    setStatus('danger');
    addHistoryItem({
      status: 'danger',
      description: 'Responded to auto-check: SOS',
    });
    
    onClose();
  };
  
  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <View style={styles.iconContainer}>
            <AlertTriangle size={48} color={Colors.dark.warningStatus} />
          </View>
          
          <Text style={styles.title}>We sensed risk, are you OK?</Text>
          
          <TouchableOpacity
            style={[styles.button, styles.safeButton]}
            onPress={handleSafe}
          >
            <Text style={styles.buttonText}>I'm safe</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.button, styles.sosButton]}
            onPress={handleSOS}
          >
            <Text style={styles.buttonText}>Send SOS</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(10, 26, 53, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: '80%',
    backgroundColor: Colors.dark.text,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.dark.background,
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    width: '100%',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  safeButton: {
    backgroundColor: Colors.dark.accent,
  },
  sosButton: {
    backgroundColor: Colors.dark.dangerStatus,
  },
  buttonText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
});