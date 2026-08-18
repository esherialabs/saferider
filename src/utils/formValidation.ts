export interface ValidationRule {
  type: 'required' | 'minLength' | 'maxLength' | 'email' | 'phone' | 'custom';
  value?: any;
  message: string;
  validator?: (value: any) => boolean;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface FieldValidation {
  [fieldName: string]: ValidationRule[];
}

class FormValidator {
  validateField(value: any, rules: ValidationRule[]): ValidationResult {
    const errors: string[] = [];
    
    for (const rule of rules) {
      let isValid = true;
      
      switch (rule.type) {
        case 'required':
          isValid = this.isRequired(value);
          break;
        case 'minLength':
          isValid = this.hasMinLength(value, rule.value);
          break;
        case 'maxLength':
          isValid = this.hasMaxLength(value, rule.value);
          break;
        case 'email':
          isValid = this.isValidEmail(value);
          break;
        case 'phone':
          isValid = this.isValidPhone(value);
          break;
        case 'custom':
          isValid = rule.validator ? rule.validator(value) : true;
          break;
      }
      
      if (!isValid) {
        errors.push(rule.message);
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
    };
  }
  
  validateForm(data: any, validationRules: FieldValidation): {
    isValid: boolean;
    errors: { [fieldName: string]: string[] };
    firstError?: string;
  } {
    const errors: { [fieldName: string]: string[] } = {};
    let firstError: string | undefined;
    
    for (const [fieldName, rules] of Object.entries(validationRules)) {
      const fieldValue = data[fieldName];
      const validation = this.validateField(fieldValue, rules);
      
      if (!validation.isValid) {
        errors[fieldName] = validation.errors;
        if (!firstError) {
          firstError = validation.errors[0];
        }
      }
    }
    
    return {
      isValid: Object.keys(errors).length === 0,
      errors,
      firstError,
    };
  }
  
  private isRequired(value: any): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }
  
  private hasMinLength(value: any, minLength: number): boolean {
    if (!value) return false;
    return value.toString().length >= minLength;
  }
  
  private hasMaxLength(value: any, maxLength: number): boolean {
    if (!value) return true;
    return value.toString().length <= maxLength;
  }
  
  private isValidEmail(value: string): boolean {
    if (!value) return true;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(value);
  }
  
  private isValidPhone(value: string): boolean {
    if (!value) return true;
    const phoneRegex = /^[\+]?[1-9][\d\s\-\(\)]{7,}$/;
    return phoneRegex.test(value.replace(/\s/g, ''));
  }
}

export const formValidator = new FormValidator();