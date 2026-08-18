import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/SimpleThemeProvider';

interface ConsentModalProps {
  visible: boolean;
  onClose: () => void;
  onAccept: () => void;
  onDecline: () => void;
  title: string;
  description: string;
  consentText: string;
  acceptText?: string;
  declineText?: string;
  isRequired?: boolean;
}

const { height } = Dimensions.get('window');

export default function ConsentModal({
  visible,
  onClose,
  onAccept,
  onDecline,
  title,
  description,
  consentText,
  acceptText = 'I Consent',
  declineText = 'Decline',
  isRequired = false,
}: ConsentModalProps) {
  const { colors } = useTheme();

  const styles = StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    modal: {
      backgroundColor: colors.card,
      borderRadius: 16,
      maxHeight: height * 0.8,
      width: '100%',
      maxWidth: 400,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 20,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.foreground,
      flex: 1,
    },
    closeButton: {
      padding: 4,
      marginLeft: 12,
    },
    content: {
      flexGrow: 1,
    },
    description: {
      fontSize: 16,
      color: colors.foreground,
      lineHeight: 24,
      padding: 20,
    },
    consentSection: {
      backgroundColor: colors.muted,
      margin: 20,
      padding: 16,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    consentText: {
      fontSize: 14,
      color: colors.mutedForeground,
      lineHeight: 20,
    },
    actions: {
      flexDirection: 'row',
      padding: 20,
      gap: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    button: {
      flex: 1,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryButton: {
      backgroundColor: colors.primary,
    },
    secondaryButton: {
      backgroundColor: colors.secondary,
      borderWidth: 1,
      borderColor: colors.border,
    },
    primaryButtonText: {
      color: colors.primaryForeground,
      fontSize: 16,
      fontWeight: '600',
    },
    secondaryButtonText: {
      color: colors.secondaryForeground,
      fontSize: 16,
      fontWeight: '600',
    },
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={isRequired ? undefined : onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            {!isRequired && (
              <TouchableOpacity
                style={styles.closeButton}
                onPress={onClose}
                accessibilityLabel="Close modal"
              >
                <Ionicons name="close" size={24} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            <Text style={styles.description}>{description}</Text>
            
            <View style={styles.consentSection}>
              <Text style={styles.consentText}>{consentText}</Text>
            </View>
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={onDecline}
              accessibilityLabel={declineText}
            >
              <Text style={styles.secondaryButtonText}>{declineText}</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.button, styles.primaryButton]}
              onPress={onAccept}
              accessibilityLabel={acceptText}
            >
              <Text style={styles.primaryButtonText}>{acceptText}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}