import { useEffect, useState, useRef } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { useSafetyStore } from '@/store/safetyStore';

export default function useAutoCheck() {
  const { settings } = useSafetyStore();
  const [showAlert, setShowAlert] = useState(false);
  const appState = useRef(AppState.currentState);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  
  const clearCheckTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  
  const scheduleNextCheck = () => {
    clearCheckTimer();
    
    if (settings.autoCheckIn) {
      const checkInMs = settings.checkInInterval * 60 * 1000;
      timerRef.current = setTimeout(() => {
        setShowAlert(true);
      }, checkInMs);
    }
  };
  
  const handleAppStateChange = (nextAppState: AppStateStatus) => {
    if (
      appState.current.match(/inactive|background/) && 
      nextAppState === 'active' && 
      settings.autoCheckIn
    ) {
      // App came to foreground, schedule next check
      scheduleNextCheck();
    } else if (nextAppState.match(/inactive|background/)) {
      // App went to background, clear timer
      clearCheckTimer();
    }
    
    appState.current = nextAppState;
  };
  
  useEffect(() => {
    // Set up app state listener
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    
    // Initial schedule
    if (settings.autoCheckIn) {
      scheduleNextCheck();
    }
    
    return () => {
      subscription.remove();
      clearCheckTimer();
    };
  }, [settings.autoCheckIn, settings.checkInInterval]);
  
  useEffect(() => {
    // Reschedule when settings change
    if (settings.autoCheckIn) {
      scheduleNextCheck();
    } else {
      clearCheckTimer();
    }
  }, [settings.autoCheckIn, settings.checkInInterval]);
  
  const closeAlert = () => {
    setShowAlert(false);
    scheduleNextCheck();
  };
  
  return { showAlert, closeAlert };
}