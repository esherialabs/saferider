import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafetyStore } from '@/store/safetyStore';
import Colors from '@/constants/colors';

export default function AddContactScreen() {
  const router = useRouter();
  const { addContact } = useSafetyStore();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [nameError, setNameError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  
  const validateForm = () => {
    let isValid = true;
    
    if (!name.trim()) {
      setNameError('Name is required');
      isValid = false;
    } else {
      setNameError('');
    }
    
    if (!phone.trim()) {
      setPhoneError('Phone number is required');
      isValid = false;
    } else {
      setPhoneError('');
    }
    
    return isValid;
  };
  
  const handleSave = () => {
    if (validateForm()) {
      addContact({
        name,
        phone,
        isPrimary: false,
      });
      
      router.back();
    }
  };
  
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.formGroup}>
        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter contact name"
          placeholderTextColor={Colors.dark.tabIconDefault}
          value={name}
          onChangeText={setName}
        />
        {nameError ? <Text style={styles.errorText}>{nameError}</Text> : null}
      </View>
      
      <View style={styles.formGroup}>
        <Text style={styles.label}>Phone Number</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter phone number"
          placeholderTextColor={Colors.dark.tabIconDefault}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />
        {phoneError ? <Text style={styles.errorText}>{phoneError}</Text> : null}
      </View>
      
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[styles.button, styles.cancelButton]}
          onPress={() => router.back()}
        >
          <Text style={styles.buttonText}>Cancel</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.button, styles.saveButton]}
          onPress={handleSave}
        >
          <Text style={styles.buttonText}>Save</Text>
        </TouchableOpacity>
      </View>
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
  formGroup: {
    marginBottom: 20,
  },
  label: {
    color: Colors.dark.text,
    fontSize: 16,
    marginBottom: 8,
  },
  input: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    color: Colors.dark.text,
    fontSize: 16,
  },
  errorText: {
    color: Colors.dark.dangerStatus,
    fontSize: 14,
    marginTop: 4,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  button: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 8,
  },
  cancelButton: {
    backgroundColor: Colors.dark.card,
  },
  saveButton: {
    backgroundColor: Colors.dark.accent,
  },
  buttonText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
});