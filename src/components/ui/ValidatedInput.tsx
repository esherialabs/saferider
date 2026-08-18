import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/SimpleThemeProvider';
import { Input } from './Input';
import { Textarea } from './Textarea';

export interface ValidationState {
  isValid: boolean;
  errors: string[];
  warnings?: string[];
  success?: boolean;
}

export interface ValidatedInputProps {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  validation?: ValidationState;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  helperText?: string;
  maxLength?: number;
  required?: boolean;
  disabled?: boolean;
  type?: 'text' | 'email' | 'phone' | 'number';
  showCharacterCount?: boolean;
}

export default function ValidatedInput({
  label,
  value,
  onChangeText,
  validation,
  multiline = false,
  rows = 1,
  placeholder,
  helperText,
  maxLength,
  required = false,
  disabled = false,
  type = 'text',
  showCharacterCount = false,
}: ValidatedInputProps) {
  const { colors } = useTheme();

  const hasErrors = validation && !validation.isValid && validation.errors.length > 0;
  const hasWarnings = validation?.warnings && validation.warnings.length > 0;
  const hasSuccess = validation?.success;

  const getBorderColor = () => {
    if (hasErrors) return colors.destructive;
    if (hasWarnings) return colors.warning;
    if (hasSuccess) return colors.success || colors.primary;
    return colors.border;
  };

  const getStatusIcon = () => {
    if (hasErrors) return { name: 'alert-circle', color: colors.destructive };
    if (hasWarnings) return { name: 'warning', color: colors.warning };
    if (hasSuccess) return { name: 'checkmark-circle', color: colors.success || colors.primary };
    return null;
  };

  const statusIcon = getStatusIcon();

  const styles = StyleSheet.create({
    container: {
      marginBottom: 16,
    },
    labelContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
      gap: 4,
    },
    label: {
      fontSize: 14,
      fontWeight: '500',
      color: colors.foreground,
    },
    required: {
      color: colors.destructive,
      fontSize: 14,
    },
    inputContainer: {
      position: 'relative',
    },
    inputWrapper: {
      borderWidth: 1,
      borderColor: getBorderColor(),
      borderRadius: 8,
      backgroundColor: disabled ? colors.muted : colors.background,
    },
    statusContainer: {
      position: 'absolute',
      right: 12,
      top: multiline ? 12 : '50%',
      transform: multiline ? [] : [{ translateY: -10 }],
    },
    messagesContainer: {
      marginTop: 6,
      gap: 4,
    },
    errorMessage: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
    },
    warningMessage: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
    },
    successMessage: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
    },
    messageText: {
      fontSize: 12,
      flex: 1,
      lineHeight: 16,
    },
    helperText: {
      fontSize: 12,
      color: colors.mutedForeground,
      marginTop: 4,
    },
    characterCount: {
      fontSize: 11,
      color: colors.mutedForeground,
      textAlign: 'right',
      marginTop: 4,
    },
    characterCountOver: {
      color: colors.destructive,
    },
  });

  const getKeyboardType = () => {
    switch (type) {
      case 'email': return 'email-address';
      case 'phone': return 'phone-pad';
      case 'number': return 'numeric';
      default: return 'default';
    }
  };

  return (
    <View style={styles.container}>
      {label && (
        <View style={styles.labelContainer}>
          <Text style={styles.label}>{label}</Text>
          {required && <Text style={styles.required}>*</Text>}
        </View>
      )}
      
      <View style={styles.inputContainer}>
        <View style={styles.inputWrapper}>
          {multiline ? (
            <Textarea
              value={value}
              onChangeText={onChangeText}
              placeholder={placeholder}
              rows={rows}
              maxLength={maxLength}
              editable={!disabled}
              keyboardType={getKeyboardType()}
              inputStyle={{
                borderWidth: 0,
                backgroundColor: 'transparent',
                paddingRight: statusIcon ? 40 : 16,
              }}
              containerStyle={{ marginBottom: 0 }}
            />
          ) : (
            <Input
              value={value}
              onChangeText={onChangeText}
              placeholder={placeholder}
              maxLength={maxLength}
              editable={!disabled}
              keyboardType={getKeyboardType()}
              inputStyle={{
                borderWidth: 0,
                backgroundColor: 'transparent',
                paddingRight: statusIcon ? 40 : 16,
              }}
              containerStyle={{ marginBottom: 0 }}
            />
          )}
        </View>
        
        {statusIcon && (
          <View style={styles.statusContainer}>
            <Ionicons
              name={statusIcon.name as any}
              size={20}
              color={statusIcon.color}
            />
          </View>
        )}
      </View>

      <View style={styles.messagesContainer}>
        {hasErrors && validation?.errors.map((error, index) => (
          <View key={`error-${index}`} style={styles.errorMessage}>
            <Ionicons name="alert-circle" size={14} color={colors.destructive} />
            <Text style={[styles.messageText, { color: colors.destructive }]}>
              {error}
            </Text>
          </View>
        ))}
        
        {hasWarnings && validation?.warnings?.map((warning, index) => (
          <View key={`warning-${index}`} style={styles.warningMessage}>
            <Ionicons name="warning" size={14} color={colors.warning} />
            <Text style={[styles.messageText, { color: colors.warning }]}>
              {warning}
            </Text>
          </View>
        ))}
        
        {hasSuccess && !hasErrors && !hasWarnings && (
          <View style={styles.successMessage}>
            <Ionicons name="checkmark-circle" size={14} color={colors.success || colors.primary} />
            <Text style={[styles.messageText, { color: colors.success || colors.primary }]}>
              Input looks good
            </Text>
          </View>
        )}
      </View>

      {helperText && (
        <Text style={styles.helperText}>{helperText}</Text>
      )}
      
      {showCharacterCount && maxLength && (
        <Text style={[
          styles.characterCount,
          value.length > maxLength && styles.characterCountOver
        ]}>
          {value.length}/{maxLength}
        </Text>
      )}
    </View>
  );
}

// Validation helper functions
export const validationHelpers = {
  required: (value: string) => value.trim().length > 0,
  minLength: (value: string, min: number) => value.trim().length >= min,
  maxLength: (value: string, max: number) => value.length <= max,
  email: (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
  phone: (value: string) => /^[\+]?[0-9\-\s\(\)]{7,}$/.test(value),
  
  validateField: (
    value: string,
    rules: {
      required?: boolean;
      minLength?: number;
      maxLength?: number;
      email?: boolean;
      phone?: boolean;
      custom?: (value: string) => boolean;
    }
  ): ValidationState => {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (rules.required && !validationHelpers.required(value)) {
      errors.push('This field is required');
    }

    if (value.length > 0) {
      if (rules.minLength && !validationHelpers.minLength(value, rules.minLength)) {
        errors.push(`Must be at least ${rules.minLength} characters`);
      }
      
      if (rules.maxLength && !validationHelpers.maxLength(value, rules.maxLength)) {
        errors.push(`Must be no more than ${rules.maxLength} characters`);
      }
      
      if (rules.email && !validationHelpers.email(value)) {
        errors.push('Please enter a valid email address');
      }
      
      if (rules.phone && !validationHelpers.phone(value)) {
        errors.push('Please enter a valid phone number');
      }
      
      if (rules.custom && !rules.custom(value)) {
        errors.push('Invalid input');
      }

      // Add warnings for approaching limits
      if (rules.maxLength && value.length > rules.maxLength * 0.8) {
        warnings.push(`Approaching character limit (${value.length}/${rules.maxLength})`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      success: errors.length === 0 && warnings.length === 0 && value.length > 0,
    };
  },
};
