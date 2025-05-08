import React from 'react';
import { StyleSheet, View, SafeAreaView } from 'react-native';
import { useSafetyStore } from '@/store/safetyStore';
import StatusIndicator from '@/components/StatusIndicator';
import ReportButton from '@/components/ReportButton';
import RiskAlertModal from '@/components/RiskAlertModal';
import useAutoCheck from '@/hooks/useAutoCheck';
import Colors from '@/constants/colors';

export default function DashboardScreen() {
  const { status } = useSafetyStore();
  const { showAlert, closeAlert } = useAutoCheck();
  
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.statusContainer}>
          <StatusIndicator status={status} />
        </View>
        <View style={styles.reportContainer}>
          <ReportButton />
        </View>
      </View>
      
      <RiskAlertModal 
        visible={showAlert} 
        onClose={closeAlert} 
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 40,
  },
  statusContainer: {
    flex: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reportContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});