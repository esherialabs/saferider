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
import { useIncidentStore } from '@/store/incidentStore';
import Colors from '@/constants/colors';
import { MapPin, Calendar } from 'lucide-react-native';

export default function ReportIncidentStep2Screen() {
  const router = useRouter();
  const { currentStep, incidentReport, updateIncidentReport, setCurrentStep } = useIncidentStore();
  const [locationError, setLocationError] = useState('');
  
  const validateStep = () => {
    let isValid = true;
    
    if (!incidentReport.location) {
      setLocationError('Please provide a location');
      isValid = false;
    } else {
      setLocationError('');
    }
    
    return isValid;
  };
  
  const handleNext = () => {
    if (validateStep()) {
      if (currentStep < 3) {
        setCurrentStep(currentStep + 1);
        router.push(`/report-incident/step3`);
      }
    }
  };
  
  const handleBack = () => {
    setCurrentStep(currentStep - 1);
    router.back();
  };
  
  const handleLocationChange = (text: string) => {
    updateIncidentReport({ location: text });
    if (text) {
      setLocationError('');
    }
  };
  
  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
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
          <Text style={styles.label}>Where did it happen?</Text>
          <View style={styles.inputContainer}>
            <MapPin size={20} color="#9CA3AF" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Enter location"
              placeholderTextColor="#9CA3AF"
              value={incidentReport.location}
              onChangeText={handleLocationChange}
            />
          </View>
          {locationError ? <Text style={styles.errorText}>{locationError}</Text> : null}
          
          <Text style={[styles.label, { marginTop: 20 }]}>When did it happen?</Text>
          <View style={styles.dateContainer}>
            <Calendar size={20} color={Colors.dark.accent} style={styles.dateIcon} />
            <Text style={styles.dateText}>
              {formatDate(incidentReport.date || new Date())}
            </Text>
          </View>
          <Text style={styles.dateHint}>Current date and time is used by default</Text>
        </View>
        
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBack}
          >
            <Text style={styles.backButtonText}>BACK</Text>
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
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.text,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 16,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    paddingVertical: 16,
    fontSize: 16,
    color: Colors.dark.background,
  },
  dateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.text,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 16,
  },
  dateIcon: {
    marginRight: 10,
  },
  dateText: {
    fontSize: 16,
    color: Colors.dark.background,
  },
  dateHint: {
    color: '#9CA3AF',
    fontSize: 12,
    marginTop: 5,
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
  backButton: {
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
  backButtonText: {
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