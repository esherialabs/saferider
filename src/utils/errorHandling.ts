import { Alert } from 'react-native';
import { notificationCenter } from './notificationCenter';
import { confirmCenter } from './confirmCenter';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { devPrivacyError, devPrivacyInfo, getPrivacySafeErrorReason, sanitizeConsoleArg } from './privacyLog';

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum ErrorCategory {
  NETWORK = 'network',
  STORAGE = 'storage',
  PERMISSION = 'permission',
  VALIDATION = 'validation',
  AUTHENTICATION = 'authentication',
  SYNC = 'sync',
  MEDIA = 'media',
  NAVIGATION = 'navigation',
  UNKNOWN = 'unknown',
}

export interface ErrorInfo {
  id: string;
  message: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  timestamp: Date;
  context?: Record<string, any>;
  stack?: string;
  userId?: string;
  sessionId?: string;
  retryable: boolean;
  retryCount?: number;
  maxRetries?: number;
}

export interface ErrorHandlerOptions {
  showAlert?: boolean;
  logToStorage?: boolean;
  autoRetry?: boolean;
  fallbackAction?: () => void;
  customMessage?: string;
}

class ErrorHandlingManager {
  private errorLog: ErrorInfo[] = [];
  private maxLogSize = 100;
  private retryQueue: Map<string, () => Promise<any>> = new Map();

  constructor() {
    this.loadErrorLog();
    this.setupGlobalHandlers();
  }

  // Main error handling method
  public async handleError(
    error: Error | string,
    category: ErrorCategory = ErrorCategory.UNKNOWN,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    options: ErrorHandlerOptions = {}
  ): Promise<void> {
    const errorInfo = this.createErrorInfo(error, category, severity);
    
    // Log error
    if (options.logToStorage !== false) {
      await this.logError(errorInfo);
    }

    // Show user-facing alert if requested
    if (options.showAlert) {
      this.showErrorAlert(errorInfo, options.customMessage);
    }

    // Handle retryable errors
    if (errorInfo.retryable && options.autoRetry) {
      await this.handleRetry(errorInfo);
    }

    // Execute fallback action
    if (options.fallbackAction) {
      try {
        options.fallbackAction();
      } catch (fallbackError) {
        devPrivacyError('fallback action failed', {
          reason: getPrivacySafeErrorReason(fallbackError),
        });
      }
    }

    // Report critical errors
    if (severity === ErrorSeverity.CRITICAL) {
      this.reportCriticalError(errorInfo);
    }
  }

  // Specific error handlers
  public async handleNetworkError(error: Error, options: ErrorHandlerOptions = {}): Promise<void> {
    await this.handleError(error, ErrorCategory.NETWORK, ErrorSeverity.MEDIUM, {
      showAlert: true,
      autoRetry: true,
      customMessage: 'SafeRide is still connecting. Your local drafts stay on this device.',
      ...options,
    });
  }

  public async handleStorageError(error: Error, options: ErrorHandlerOptions = {}): Promise<void> {
    await this.handleError(error, ErrorCategory.STORAGE, ErrorSeverity.HIGH, {
      showAlert: true,
      customMessage: 'SafeRide could not save that yet. Check device storage, then try again.',
      ...options,
    });
  }

  public async handlePermissionError(error: Error, options: ErrorHandlerOptions = {}): Promise<void> {
    await this.handleError(error, ErrorCategory.PERMISSION, ErrorSeverity.HIGH, {
      showAlert: true,
      customMessage: 'Permission required. Please check app settings.',
      ...options,
    });
  }

  public async handleValidationError(error: Error, options: ErrorHandlerOptions = {}): Promise<void> {
    await this.handleError(error, ErrorCategory.VALIDATION, ErrorSeverity.LOW, {
      showAlert: true,
      customMessage: 'Please check your input and try again.',
      ...options,
    });
  }

  public async handleSyncError(error: Error, options: ErrorHandlerOptions = {}): Promise<void> {
    await this.handleError(error, ErrorCategory.SYNC, ErrorSeverity.MEDIUM, {
      showAlert: false, // Let sync manager handle user notifications
      autoRetry: true,
      ...options,
    });
  }

  public async handleMediaError(error: Error, options: ErrorHandlerOptions = {}): Promise<void> {
    await this.handleError(error, ErrorCategory.MEDIA, ErrorSeverity.MEDIUM, {
      showAlert: true,
      customMessage: 'SafeRide could not finish the media action. Check permissions and storage, then try again.',
      ...options,
    });
  }

  // Recovery methods
  public async retryOperation(errorId: string): Promise<boolean> {
    const operation = this.retryQueue.get(errorId);
    if (!operation) {
      return false;
    }

    try {
      await operation();
      this.retryQueue.delete(errorId);
      return true;
    } catch (error) {
      devPrivacyError('retry failed', { reason: getPrivacySafeErrorReason(error) });
      return false;
    }
  }

  public async recoverFromError(errorId: string): Promise<boolean> {
    const errorInfo = this.errorLog.find(e => e.id === errorId);
    if (!errorInfo) {
      return false;
    }

    try {
      switch (errorInfo.category) {
        case ErrorCategory.STORAGE:
          return await this.recoverFromStorageError(errorInfo);
        case ErrorCategory.NETWORK:
          return await this.recoverFromNetworkError(errorInfo);
        case ErrorCategory.PERMISSION:
          return await this.recoverFromPermissionError(errorInfo);
        default:
          return false;
      }
    } catch (error) {
      devPrivacyError('recovery failed', { reason: getPrivacySafeErrorReason(error) });
      return false;
    }
  }

  // Logging and reporting
  public async getErrorLog(): Promise<ErrorInfo[]> {
    return [...this.errorLog];
  }

  public async getErrorStats(): Promise<{
    totalErrors: number;
    errorsByCategory: Record<ErrorCategory, number>;
    errorsBySeverity: Record<ErrorSeverity, number>;
    recentErrors: ErrorInfo[];
  }> {
    const errorsByCategory = Object.values(ErrorCategory).reduce((acc, category) => {
      acc[category] = this.errorLog.filter(e => e.category === category).length;
      return acc;
    }, {} as Record<ErrorCategory, number>);

    const errorsBySeverity = Object.values(ErrorSeverity).reduce((acc, severity) => {
      acc[severity] = this.errorLog.filter(e => e.severity === severity).length;
      return acc;
    }, {} as Record<ErrorSeverity, number>);

    const recentErrors = this.errorLog
      .filter(e => Date.now() - e.timestamp.getTime() < 24 * 60 * 60 * 1000) // Last 24 hours
      .slice(-10);

    return {
      totalErrors: this.errorLog.length,
      errorsByCategory,
      errorsBySeverity,
      recentErrors,
    };
  }

  public async clearErrorLog(): Promise<void> {
    this.errorLog = [];
    await this.saveErrorLog();
  }

  public async exportErrorLog(): Promise<string> {
    const exportData = {
      timestamp: new Date().toISOString(),
      version: '1.0',
      errors: this.errorLog,
      stats: await this.getErrorStats(),
    };

    return JSON.stringify(exportData, null, 2);
  }

  // Private helper methods
  private createErrorInfo(
    error: Error | string,
    category: ErrorCategory,
    severity: ErrorSeverity
  ): ErrorInfo {
    const rawMessage = typeof error === 'string' ? error : error.message;

    return {
      id: this.generateErrorId(),
      message: getPrivacySafeErrorReason(error),
      category,
      severity,
      timestamp: new Date(),
      retryable: this.isRetryable(category, rawMessage),
      retryCount: 0,
      maxRetries: this.getMaxRetries(category),
    };
  }

  private async logError(errorInfo: ErrorInfo): Promise<void> {
    this.errorLog.push(errorInfo);
    
    // Maintain log size
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog = this.errorLog.slice(-this.maxLogSize);
    }

    await this.saveErrorLog();
    
    devPrivacyError('handled app error', {
      severity: errorInfo.severity,
      category: errorInfo.category,
      retryable: errorInfo.retryable,
    });
  }

  private async showErrorAlert(errorInfo: ErrorInfo, customMessage?: string): Promise<void> {
    // Deprecated path; keep for backward compatibility if other code calls it
    await this.showErrorUI(errorInfo, customMessage);
  }

  private async showErrorUI(errorInfo: ErrorInfo, customMessage?: string): Promise<void> {
    const message = customMessage || this.getDefaultUserMessage(errorInfo);
    if (errorInfo.retryable) {
      const action = await confirmCenter.request({
        title: 'Error',
        message,
        actions: [
          { id: 'ok', label: 'OK', role: 'secondary' },
          { id: 'retry', label: 'Retry', role: 'primary' },
        ],
      });
      if (action === 'retry') {
        await this.retryOperation(errorInfo.id);
      }
    } else {
      notificationCenter.notify({ title: 'Error', message, variant: 'error' });
    }
  }

  private async handleRetry(errorInfo: ErrorInfo): Promise<void> {
    if (!errorInfo.retryable || (errorInfo.retryCount || 0) >= (errorInfo.maxRetries || 3)) {
      return;
    }

    // Implement exponential backoff
    const delay = Math.pow(2, errorInfo.retryCount || 0) * 1000;
    
    setTimeout(async () => {
      try {
        await this.retryOperation(errorInfo.id);
      } catch (retryError) {
        errorInfo.retryCount = (errorInfo.retryCount || 0) + 1;
        if (errorInfo.retryCount < (errorInfo.maxRetries || 3)) {
          await this.handleRetry(errorInfo);
        }
      }
    }, delay);
  }

  private reportCriticalError(errorInfo: ErrorInfo): void {
    // In a real app, this would send a redacted event to crash reporting.
    devPrivacyError('critical app error', {
      severity: errorInfo.severity,
      category: errorInfo.category,
    });
    
    Alert.alert(
      'Critical Error',
      'A critical error occurred. The app may not function properly. Please restart the app.',
      [
        { text: 'OK', style: 'default' },
        {
          text: 'Report',
          onPress: () => {
            // Would open bug report or send to support
            devPrivacyInfo('bug report requested');
          },
        },
      ]
    );
  }

  private isRetryable(category: ErrorCategory, message: string): boolean {
    switch (category) {
      case ErrorCategory.NETWORK:
        return !message.includes('401') && !message.includes('403'); // Don't retry auth errors
      case ErrorCategory.SYNC:
        return true;
      case ErrorCategory.STORAGE:
        return !message.includes('quota') && !message.includes('permission');
      default:
        return false;
    }
  }

  private getMaxRetries(category: ErrorCategory): number {
    switch (category) {
      case ErrorCategory.NETWORK:
        return 3;
      case ErrorCategory.SYNC:
        return 5;
      case ErrorCategory.STORAGE:
        return 2;
      default:
        return 1;
    }
  }

  private getDefaultUserMessage(errorInfo: ErrorInfo): string {
    switch (errorInfo.category) {
      case ErrorCategory.NETWORK:
        return 'SafeRide is still connecting. Your local drafts stay on this device; try again when your connection is stable.';
      case ErrorCategory.STORAGE:
        return 'Failed to save data. Please ensure you have enough storage space and try again.';
      case ErrorCategory.PERMISSION:
        return 'Permission required. Please check your app settings and grant the necessary permissions.';
      case ErrorCategory.VALIDATION:
        return 'Invalid input. Please check your data and try again.';
      case ErrorCategory.SYNC:
        return 'SafeRide could not reach the service yet. Your data is saved locally and can sync when the connection returns.';
      case ErrorCategory.MEDIA:
        return 'Media operation failed. Please check your permissions and try again.';
      default:
        return 'SafeRide could not finish that action. Your local work remains on this device.';
    }
  }

  private async recoverFromStorageError(errorInfo: ErrorInfo): Promise<boolean> {
    try {
      // Clear some cache or temporary data
      const keys = await AsyncStorage.getAllKeys();
      const cacheKeys = keys.filter(key => key.includes('cache') || key.includes('temp'));
      if (cacheKeys.length > 0) {
        await AsyncStorage.multiRemove(cacheKeys);
        return true;
      }
    } catch (error) {
      devPrivacyError('storage recovery failed', { reason: getPrivacySafeErrorReason(error) });
    }
    return false;
  }

  private async recoverFromNetworkError(errorInfo: ErrorInfo): Promise<boolean> {
    // Network errors usually resolve themselves, so just wait and retry
    return new Promise(resolve => {
      setTimeout(() => resolve(true), 2000);
    });
  }

  private async recoverFromPermissionError(errorInfo: ErrorInfo): Promise<boolean> {
    // Permission errors require user action, so just return false
    return false;
  }

  private generateErrorId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private setupGlobalHandlers(): void {
    const originalConsoleError = console.error;
    console.error = (...args) => {
      if (__DEV__) {
        const safeArgs = args.map(sanitizeConsoleArg);
        if (args.some(arg => arg instanceof Error)) {
          console.log('[handled console error]', ...safeArgs);
          return;
        }

        originalConsoleError(...safeArgs);
      }
    };
  }

  private async loadErrorLog(): Promise<void> {
    try {
      const logData = await AsyncStorage.getItem('@error_log');
      if (logData) {
        const parsed = JSON.parse(logData);
        this.errorLog = parsed.map((item: any) => ({
          ...item,
          timestamp: new Date(item.timestamp),
        }));
      }
    } catch (error) {
      devPrivacyError('error log load failed', { reason: getPrivacySafeErrorReason(error) });
    }
  }

  private async saveErrorLog(): Promise<void> {
    try {
      await AsyncStorage.setItem('@error_log', JSON.stringify(this.errorLog));
    } catch (error) {
      devPrivacyError('error log save failed', { reason: getPrivacySafeErrorReason(error) });
    }
  }
}

// Export singleton instance
export const errorHandler = new ErrorHandlingManager();

// Convenience functions for common error types
export const handleNetworkError = errorHandler.handleNetworkError.bind(errorHandler);
export const handleStorageError = errorHandler.handleStorageError.bind(errorHandler);
export const handlePermissionError = errorHandler.handlePermissionError.bind(errorHandler);
export const handleValidationError = errorHandler.handleValidationError.bind(errorHandler);
export const handleSyncError = errorHandler.handleSyncError.bind(errorHandler);
export const handleMediaError = errorHandler.handleMediaError.bind(errorHandler);

// Utility function for wrapping async operations with error handling
export const withErrorHandling = <T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  category: ErrorCategory = ErrorCategory.UNKNOWN,
  options: ErrorHandlerOptions = {}
) => {
  return async (...args: T): Promise<R | undefined> => {
    try {
      return await fn(...args);
    } catch (error) {
      await errorHandler.handleError(error as Error, category, ErrorSeverity.MEDIUM, options);
      return undefined;
    }
  };
};
