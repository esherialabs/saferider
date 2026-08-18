import { AccessibilityInfo, findNodeHandle, AccessibilityRole } from 'react-native';
import * as Haptics from 'expo-haptics';

export class AccessibilityManager {
  static announce(message: string, priority: 'low' | 'high' = 'high'): void {
    if (priority === 'high') {
      AccessibilityInfo.announceForAccessibility(message);
    } else {
      setTimeout(() => {
        AccessibilityInfo.announceForAccessibility(message);
      }, 500);
    }
  }
  
  static focusElement(elementRef: any): void {
    if (elementRef?.current) {
      const reactTag = findNodeHandle(elementRef.current);
      if (reactTag) {
        AccessibilityInfo.setAccessibilityFocus(reactTag);
      }
    }
  }
  
  static async isScreenReaderEnabled(): Promise<boolean> {
    try {
      return await AccessibilityInfo.isScreenReaderEnabled();
    } catch (error) {
      console.warn('Failed to check screen reader status:', error);
      return false;
    }
  }
  
  static provideFeedback(type: 'success' | 'warning' | 'error' | 'selection' = 'selection'): void {
    switch (type) {
      case 'success':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case 'warning':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        break;
      case 'error':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        break;
      case 'selection':
      default:
        Haptics.selectionAsync();
        break;
    }
  }
}

export const accessibilityPresets = {
  incidentForm: {
    patternSelection: {
      role: 'radio' as AccessibilityRole,
      hint: 'Select the type of incident that occurred',
    },
    descriptionField: {
      role: 'text' as AccessibilityRole,
      hint: 'Describe what happened in detail',
      multiline: true,
    },
    evidenceUpload: {
      role: 'button' as AccessibilityRole,
      hint: 'Add photos, audio, or documents as evidence',
    },
  },
  
  navigation: {
    backButton: {
      role: 'button' as AccessibilityRole,
      label: 'Go back',
      hint: 'Return to previous screen',
    },
    nextButton: {
      role: 'button' as AccessibilityRole,
      label: 'Continue',
      hint: 'Proceed to next step',
    },
    saveButton: {
      role: 'button' as AccessibilityRole,
      label: 'Save draft',
      hint: 'Save current progress',
    },
  },
};