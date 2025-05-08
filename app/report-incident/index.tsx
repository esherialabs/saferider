import React, { useState } from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  ScrollView,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import StepIndicator from '@/components/StepIndicator';
import Dropdown from '@/components/Dropdown';
import { useIncidentStore } from '@/store/incidentStore';
import { incidentTypes } from '@/constants/incidentTypes';
import Colors from '@/constants/colors';

export default function ReportIncidentScreen() {
  const router = useRouter();
  const { currentStep, incidentReport, updateIncidentReport, setCurrentStep } = useIncidentStore();
  const [descriptionError, setDescriptionError] = useState('');
  const [typeError, setTypeError] = useState('');
  
  const selectedType = incidentReport.incidentType 
    ? incidentTypes.find(type => type.id === incidentReport.incidentType) 
    : undefined;
  
  const validateStep = () => {
    let isValid = true;
    
    if (!incidentReport.incidentType) {
      setTypeError('Please select an incident type');
      isValid = false;
    } else {
      setTypeError('');
    }
    
    if (!incidentReport.description) {
      setDescriptionError('Please provide a description');
      isValid = false;
    } else if (incidentReport.description.length < 10) {
      setDescriptionError('Description must be at least 10 characters');
      isValid = false;
    } else {
      setDescriptionError('');
    }
    
    return isValid;
  };
  
  const handleNext = () => {
    if (validateStep()) {
      if (currentStep < 3) {
        setCurrentStep(currentStep + 1);
        router.push(`/report-incident/step${currentStep + 1}`);
      }
    }
  };
  
  const handleCancel = () => {
    router.back();
  };
  
  const handleSelectType = (option: { id: string; label: string }) => {
    updateIncidentReport({ incidentType: option.id });
    setTypeError('');
  };
  
  const handleDescriptionChange = (text: string) => {
    updateIncidentReport({ description: text });
    if (text.length >= 10) {
      setDescriptionError('');
    }
  };
  
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
      <Stack.Screen 
        options={{ 
          title: 'Report an Incident',
          headerStyle: {
            backgroundColor: Colors.dark.background,
          },
          headerTintColor: Colors.dark.text,
        }} 
      />
      
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <StepIndicator currentStep={currentStep} totalSteps={3} />
        
        <View style={styles.formContainer}>
          <Text style={styles.label}>What happened?</Text>
          <Dropdown
            options={incidentTypes}
            selectedOption={selectedType}
            onSelect={handleSelectType}
            placeholder="Select incident type"
          />
          {typeError ? <Text style={styles.errorText}>{typeError}</Text> : null}
          
          <Text style={[styles.label, { marginTop: 20 }]}>Description</Text>
          <TextInput
            style={styles.textArea}
            placeholder="Enter a description..."
            placeholderTextColor="#9CA3AF"
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            value={incidentReport.description}
            onChangeText={handleDescriptionChange}
          />
          {descriptionError ? <Text style={styles.errorText}>{descriptionError}</Text> : null}
        </View>
        
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={handleCancel}
          >
            <Text style={styles.cancelButtonText}>CANCEL</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.nextButton}
            onPress={handleNext}
          >
            <Text style={styles.nextButtonText}>NEXT</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.text,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
  formContainer: {
    padding: 20,
  },
  label: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: Colors.dark.background,
  },
  textArea: {
    backgroundColor: Colors.dark.text,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 16,
    fontSize: 16,
    color: Colors.dark.background,
    minHeight: 150,
  },
  errorText: {
    color: Colors.dark.dangerStatus,
    marginTop: 5,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 20,
    marginTop: 'auto',
  },
  cancelButton: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.dark.accent,
    borderRadius: 8,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  cancelButtonText: {
    color: Colors.dark.accent,
    fontSize: 16,
    fontWeight: 'bold',
  },
  nextButton: {
    flex: 1,
    backgroundColor: Colors.dark.accent,
    borderRadius: 8,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  nextButtonText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
});