import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { EmergencyContact } from '@/types';
import { Phone, Trash2 } from 'lucide-react-native';
import Colors from '@/constants/colors';
import * as Linking from 'expo-linking';

interface ContactItemProps {
  contact: EmergencyContact;
  onDelete: (id: string) => void;
}

export default function ContactItem({ contact, onDelete }: ContactItemProps) {
  const handleCall = () => {
    Linking.openURL(`tel:${contact.phone}`);
  };
  
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.name}>{contact.name}</Text>
        <Text style={styles.phone}>{contact.phone}</Text>
        {contact.isPrimary && <Text style={styles.primary}>Primary</Text>}
      </View>
      <View style={styles.actions}>
        <TouchableOpacity 
          style={styles.actionButton} 
          onPress={handleCall}
          disabled={Platform.OS === 'web'}
        >
          <Phone size={20} color={Colors.dark.accent} />
        </TouchableOpacity>
        {!contact.isPrimary && (
          <TouchableOpacity 
            style={styles.actionButton} 
            onPress={() => onDelete(contact.id)}
          >
            <Trash2 size={20} color={Colors.dark.dangerStatus} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
  },
  name: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  phone: {
    color: Colors.dark.tabIconDefault,
    fontSize: 14,
    marginBottom: 4,
  },
  primary: {
    color: Colors.dark.accent,
    fontSize: 12,
    fontWeight: 'bold',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionButton: {
    padding: 8,
    marginLeft: 8,
  },
});