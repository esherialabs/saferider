import React, { useState } from 'react';
import { StyleSheet, ScrollView, SafeAreaView, Text, View, Switch, TouchableOpacity, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafetyStore } from '@/store/safetyStore';
import ContactItem from '@/components/ContactItem';
import { Plus, Minus } from 'lucide-react-native';
import Colors from '@/constants/colors';

export default function SettingsScreen() {
  const router = useRouter();
  const { contacts, settings, updateSettings, removeContact } = useSafetyStore();
  
  const handleAddContact = () => {
    router.push('/add-contact');
  };
  
  const increaseInterval = () => {
    updateSettings({ checkInInterval: Math.min(settings.checkInInterval + 15, 240) });
  };
  
  const decreaseInterval = () => {
    updateSettings({ checkInInterval: Math.max(settings.checkInInterval - 15, 15) });
  };
  
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>App Settings</Text>
          <View style={styles.settingItem}>
            <Text style={styles.settingLabel}>Share Location</Text>
            <Switch
              value={settings.shareLocation}
              onValueChange={(value) => updateSettings({ shareLocation: value })}
              trackColor={{ false: Colors.dark.card, true: Colors.dark.accent }}
              thumbColor={Colors.dark.text}
            />
          </View>
          <View style={styles.settingItem}>
            <Text style={styles.settingLabel}>Auto Check-In</Text>
            <Switch
              value={settings.autoCheckIn}
              onValueChange={(value) => updateSettings({ autoCheckIn: value })}
              trackColor={{ false: Colors.dark.card, true: Colors.dark.accent }}
              thumbColor={Colors.dark.text}
            />
          </View>
          {settings.autoCheckIn && (
            <View style={styles.settingItem}>
              <Text style={styles.settingLabel}>Check-In Interval</Text>
              <View style={styles.intervalControl}>
                <TouchableOpacity 
                  style={styles.intervalButton} 
                  onPress={decreaseInterval}
                >
                  <Minus size={16} color={Colors.dark.text} />
                </TouchableOpacity>
                <Text style={styles.intervalValue}>{settings.checkInInterval} min</Text>
                <TouchableOpacity 
                  style={styles.intervalButton} 
                  onPress={increaseInterval}
                >
                  <Plus size={16} color={Colors.dark.text} />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
        
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Emergency Contacts</Text>
            <TouchableOpacity 
              style={styles.addButton} 
              onPress={handleAddContact}
            >
              <Plus size={20} color={Colors.dark.text} />
            </TouchableOpacity>
          </View>
          {contacts.map((contact) => (
            <ContactItem 
              key={contact.id} 
              contact={contact} 
              onDelete={removeContact} 
            />
          ))}
        </View>
        
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <Text style={styles.aboutText}>
            Safety Dashboard App v1.0.0
          </Text>
          <Text style={styles.aboutText}>
            This app helps you stay safe and connected with your emergency contacts.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
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
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    color: Colors.dark.text,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  settingLabel: {
    color: Colors.dark.text,
    fontSize: 16,
  },
  settingValue: {
    color: Colors.dark.accent,
    fontSize: 16,
    fontWeight: 'bold',
  },
  intervalControl: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  intervalButton: {
    backgroundColor: Colors.dark.accent,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  intervalValue: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: 'bold',
    marginHorizontal: 12,
    minWidth: 60,
    textAlign: 'center',
  },
  addButton: {
    backgroundColor: Colors.dark.accent,
    borderRadius: 20,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aboutText: {
    color: Colors.dark.tabIconDefault,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
});