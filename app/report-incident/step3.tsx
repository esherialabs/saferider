import React from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  TouchableOpacity, 
  ScrollView,
  ActivityIndicator
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import StepIndicator from '@/components/StepIndicator';
import { useIncidentStore } from '@/store/incidentStore';
import { useSafetyStore } from '@/store/safetyStore';
import Colors from '@/constants/colors';
import { CheckCircle, MapPin, Calendar, FileText } from 'lucide-react-native';
import { incidentTypes } from '@/constants/incidentTypes';

export default function ReportIncidentStep3Screen() {
  const router = useRouter();
  const { currentStep, incidentReport, setCurrentStep, resetIncidentReport } = useIncidentStore();
  const { addHistoryItem, setStatus } = useSafetyStore();
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  
  const incidentType = incidentTypes.find(type => type.id === incidentReport.incidentType);
  
  const handleBack = () => {
    setCurrentStep(currentStep - 1);
    router.back();
  };
  
  const handleSubmit = () => {
    setIsSubmitting(true);
    
    // Update status and add to history
    setStatus('danger');
    
    // Add to history
    addHistoryItem({
      status: 'danger',
      description: `${incidentType?.label}: ${incidentReport.description}`,
      location: incidentReport.location,
    });
    
    // Simulate API call
    setTimeout(() => {
      setIsSubmitting(false);
      resetIncidentReport();
      
      // Navigate to chat for follow-up assistance
      router.push('/(tabs)/chat');
    }, 1500);
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
    <View style={styles.container}>
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
        
        <View style={styles.summaryContainer}>
          <Text style={styles.summaryTitle}>Review your report</Text>
          
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Incident Type:</Text>
              <Text style={styles.summaryValue}>{incidentType?.label}</Text>
            </View>
            
            <View style={styles.summaryRow}>
              <FileText size={20} color={Colors.dark.accent} style={styles.summaryIcon} />
              <Text style={styles.summaryText}>{incidentReport.description}</Text>
            </View>
            
            <View style={styles.summaryRow}>
              <MapPin size={20} color={Colors.dark.accent} style={styles.summaryIcon} />
              <Text style={styles.summaryText}>{incidentReport.location}</Text>
            </View>
            
            <View style={styles.summaryRow}>
              <Calendar size={20} color={Colors.dark.accent} style={styles.summaryIcon} />
              <Text style={styles.summaryText}>
                {formatDate(incidentReport.date || new Date())}
              </Text>
            </View>
          </View>
          
          <Text style={styles.disclaimer}>
            By submitting this report, you confirm that the information provided is accurate to the best of your knowledge.
          </Text>
        </View>
        
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBack}
            disabled={isSubmitting}
          >
            <Text style={styles.backButtonText}>BACK</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.submitButton}
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color={Colors.dark.text} />
            ) : (
              <>
                <CheckCircle size={20} color={Colors.dark.text} style={styles.submitIcon} />
                <Text style={styles.submitButtonText}>SUBMIT</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
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
  summaryContainer: {
    padding: 20,
  },
  summaryTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
    color: Colors.dark.background,
  },
  summaryCard: {
    backgroundColor: Colors.dark.text,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  summaryLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.dark.background,
    marginRight: 8,
  },
  summaryValue: {
    fontSize: 16,
    color: Colors.dark.background,
    flex: 1,
  },
  summaryIcon: {
    marginRight: 12,
    marginTop: 2,
  },
  summaryText: {
    fontSize: 16,
    color: Colors.dark.background,
    flex: 1,
  },
  disclaimer: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
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
  submitButton: {
    flex: 1,
    backgroundColor: Colors.dark.accent,
    borderRadius: 8,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  submitIcon: {
    marginRight: 8,
  },
  submitButtonText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
});