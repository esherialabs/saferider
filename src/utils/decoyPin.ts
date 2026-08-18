import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { devPrivacyWarn, getPrivacySafeErrorReason } from './privacyLog';

export interface DecoyPinConfig {
  hashedPin: string;
  requireToExit: boolean;
  salt: string;
  createdAt: number;
}

export interface DecoyPinStorageStatus {
  secure: boolean;
  storage: 'secure-store' | 'unavailable';
  platform: typeof Platform.OS;
  message: string;
}

export interface DecoyPinExitAuthStatus {
  available: boolean;
  method: 'device-auth' | 'unavailable';
  platform: typeof Platform.OS;
  message: string;
}

interface CalculatorState {
  display: string;
  operation: string | null;
  previousValue: string | null;
  isNewInput: boolean;
}

const DECOY_PIN_KEY = 'safe_ride_decoy_pin';
const CALCULATOR_STATE_KEY = 'calculator_state';
const SALT_BYTES = 16;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function constantTimeEquals(a: string, b: string): boolean {
  const maxLength = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;

  for (let i = 0; i < maxLength; i += 1) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }

  return mismatch === 0;
}

// PIN Management
export class DecoyPinManager {
  private static instance: DecoyPinManager;
  
  static getInstance(): DecoyPinManager {
    if (!DecoyPinManager.instance) {
      DecoyPinManager.instance = new DecoyPinManager();
    }
    return DecoyPinManager.instance;
  }

  private async hashPin(pin: string, salt: string): Promise<string> {
    const pinWithSalt = pin + salt;
    return await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      pinWithSalt,
      { encoding: Crypto.CryptoEncoding.HEX }
    );
  }

  private async generateSalt(): Promise<string> {
    const bytes = await Crypto.getRandomBytesAsync(SALT_BYTES);
    return bytesToHex(bytes);
  }

  async getStorageStatus(): Promise<DecoyPinStorageStatus> {
    if (Platform.OS === 'web') {
      return {
        secure: false,
        storage: 'unavailable',
        platform: Platform.OS,
        message: 'Decoy PIN requires native secure storage and is unavailable on web.',
      };
    }

    try {
      const isAvailable = typeof SecureStore.isAvailableAsync === 'function'
        ? await SecureStore.isAvailableAsync()
        : true;

      if (!isAvailable) {
        return {
          secure: false,
          storage: 'unavailable',
          platform: Platform.OS,
          message: 'Secure storage is unavailable on this device.',
        };
      }
    } catch (error) {
      devPrivacyWarn('decoy pin secure storage check failed', {
        reason: getPrivacySafeErrorReason(error),
      });
      return {
        secure: false,
        storage: 'unavailable',
        platform: Platform.OS,
        message: 'Secure storage could not be verified on this device.',
      };
    }

    return {
      secure: true,
      storage: 'secure-store',
      platform: Platform.OS,
      message: 'Decoy PIN verifier is stored with native secure storage on this device.',
    };
  }

  private parseConfig(configStr: string | null): DecoyPinConfig | null {
    if (!configStr) return null;

    try {
      const parsed = JSON.parse(configStr) as Partial<DecoyPinConfig>;
      if (
        typeof parsed.hashedPin === 'string' &&
        typeof parsed.salt === 'string' &&
        typeof parsed.createdAt === 'number'
      ) {
        return {
          hashedPin: parsed.hashedPin,
          requireToExit: !!parsed.requireToExit,
          salt: parsed.salt,
          createdAt: parsed.createdAt,
        };
      }
    } catch {
      return null;
    }

    return null;
  }

  private async readSecureConfig(): Promise<DecoyPinConfig | null> {
    const status = await this.getStorageStatus();
    if (!status.secure) return null;

    try {
      return this.parseConfig(await SecureStore.getItemAsync(DECOY_PIN_KEY));
    } catch (error) {
      devPrivacyWarn('decoy pin secure read failed', {
        reason: getPrivacySafeErrorReason(error),
      });
      return null;
    }
  }

  private async writeSecureConfig(config: DecoyPinConfig): Promise<void> {
    const status = await this.getStorageStatus();
    if (!status.secure) {
      throw new Error(status.message);
    }

    await SecureStore.setItemAsync(DECOY_PIN_KEY, JSON.stringify(config), {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  }

  private async deleteSecureConfig(): Promise<void> {
    const status = await this.getStorageStatus();
    if (!status.secure) return;

    try {
      await SecureStore.deleteItemAsync(DECOY_PIN_KEY);
    } catch (error) {
      devPrivacyWarn('decoy pin secure delete failed', {
        reason: getPrivacySafeErrorReason(error),
      });
    }
  }

  private async readLegacyConfig(): Promise<DecoyPinConfig | null> {
    try {
      return this.parseConfig(await AsyncStorage.getItem(DECOY_PIN_KEY));
    } catch {
      return null;
    }
  }

  async setPinConfig(pin: string, requireToExit: boolean): Promise<void> {
    if (requireToExit) {
      const exitAuthStatus = await this.getExitAuthStatus();
      if (!exitAuthStatus.available) {
        throw new Error(exitAuthStatus.message);
      }
    }

    const salt = await this.generateSalt();
    const hashedPin = await this.hashPin(pin, salt);
    
    const config: DecoyPinConfig = {
      hashedPin,
      requireToExit,
      salt,
      createdAt: Date.now(),
    };

    await this.writeSecureConfig(config);
    await AsyncStorage.removeItem(DECOY_PIN_KEY);
  }

  async getPinConfig(): Promise<DecoyPinConfig | null> {
    const secureConfig = await this.readSecureConfig();
    if (secureConfig) {
      return secureConfig;
    }

    const legacyConfig = await this.readLegacyConfig();
    if (!legacyConfig) {
      return null;
    }

    const status = await this.getStorageStatus();
    if (!status.secure) {
      return null;
    }

    try {
      await this.writeSecureConfig(legacyConfig);
      await AsyncStorage.removeItem(DECOY_PIN_KEY);
      return legacyConfig;
    } catch (error) {
      devPrivacyWarn('decoy pin legacy migration failed', {
        reason: getPrivacySafeErrorReason(error),
      });
      return null;
    }
  }

  async hasPinConfigured(): Promise<boolean> {
    const config = await this.getPinConfig();
    return config !== null;
  }

  async getExitAuthStatus(): Promise<DecoyPinExitAuthStatus> {
    if (Platform.OS === 'web') {
      return {
        available: false,
        method: 'unavailable',
        platform: Platform.OS,
        message: 'Device authentication for calculator exit is unavailable on web.',
      };
    }

    try {
      if (typeof LocalAuthentication.getEnrolledLevelAsync === 'function') {
        const enrolledLevel = await LocalAuthentication.getEnrolledLevelAsync();
        const hasDeviceAuth = enrolledLevel > LocalAuthentication.SecurityLevel.NONE;

        return {
          available: hasDeviceAuth,
          method: hasDeviceAuth ? 'device-auth' : 'unavailable',
          platform: Platform.OS,
          message: hasDeviceAuth
            ? 'Device authentication can protect calculator exit on this device.'
            : 'Device authentication is unavailable. Set up a device passcode or biometric unlock before requiring authentication to leave calculator mode.',
        };
      }

      const hasHardware = typeof LocalAuthentication.hasHardwareAsync === 'function'
        ? await LocalAuthentication.hasHardwareAsync()
        : false;
      const isEnrolled = typeof LocalAuthentication.isEnrolledAsync === 'function'
        ? await LocalAuthentication.isEnrolledAsync()
        : false;
      const hasDeviceAuth = hasHardware && isEnrolled;

      return {
        available: hasDeviceAuth,
        method: hasDeviceAuth ? 'device-auth' : 'unavailable',
        platform: Platform.OS,
        message: hasDeviceAuth
          ? 'Device authentication can protect calculator exit on this device.'
          : 'Device authentication is unavailable. Set up a device passcode or biometric unlock before requiring authentication to leave calculator mode.',
      };
    } catch (error) {
      devPrivacyWarn('decoy pin exit auth capability check failed', {
        reason: getPrivacySafeErrorReason(error),
      });
      return {
        available: false,
        method: 'unavailable',
        platform: Platform.OS,
        message: 'Device authentication could not be verified on this device.',
      };
    }
  }

  async canUnlockCalculator(): Promise<boolean> {
    const config = await this.getPinConfig();
    if (!config) return false;
    if (!config.requireToExit) return true;

    const exitAuthStatus = await this.getExitAuthStatus();
    return exitAuthStatus.available;
  }

  async verifyPin(inputPin: string): Promise<boolean> {
    const config = await this.getPinConfig();
    if (!config) return false;

    const hashedInput = await this.hashPin(inputPin, config.salt);
    return constantTimeEquals(hashedInput, config.hashedPin);
  }

  async clearPinConfig(): Promise<void> {
    await this.deleteSecureConfig();
    await AsyncStorage.removeItem(DECOY_PIN_KEY);
  }

  async shouldRequireToExit(): Promise<boolean> {
    const config = await this.getPinConfig();
    return config?.requireToExit ?? false;
  }
}

// Calculator Logic for Decoy Mode
export class DecoyCalculator {
  private static instance: DecoyCalculator;
  private state: CalculatorState;
  private pinBuffer: string = '';
  private listeners: Array<(state: CalculatorState) => void> = [];
  
  static getInstance(): DecoyCalculator {
    if (!DecoyCalculator.instance) {
      DecoyCalculator.instance = new DecoyCalculator();
    }
    return DecoyCalculator.instance;
  }

  constructor() {
    this.state = {
      display: '0',
      operation: null,
      previousValue: null,
      isNewInput: true,
    };
    this.loadState();
  }

  private async loadState(): Promise<void> {
    try {
      const stateStr = await AsyncStorage.getItem(CALCULATOR_STATE_KEY);
      if (stateStr) {
        this.state = JSON.parse(stateStr);
        this.notifyListeners();
      }
    } catch {
      // Use default state
    }
  }

  private async saveState(): Promise<void> {
    try {
      await AsyncStorage.setItem(CALCULATOR_STATE_KEY, JSON.stringify(this.state));
    } catch {
      // Ignore save errors
    }
  }

  addListener(listener: (state: CalculatorState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener({ ...this.state }));
  }

  async inputNumber(digit: string): Promise<{ shouldUnlock: boolean }> {
    // Add to pin buffer for decoy pin checking
    this.pinBuffer += digit;
    
    // Check if pin buffer matches decoy pin
    const pinManager = DecoyPinManager.getInstance();
    if (this.pinBuffer.length >= 4) {
      const isValidPin = await pinManager.verifyPin(this.pinBuffer);
      if (isValidPin) {
        this.pinBuffer = '';
        return { shouldUnlock: true };
      }
      
      // Reset buffer if it gets too long without matching
      if (this.pinBuffer.length > 8) {
        this.pinBuffer = '';
      }
    }

    // Normal calculator operation
    if (this.state.isNewInput) {
      this.state.display = digit;
      this.state.isNewInput = false;
    } else {
      this.state.display = this.state.display === '0' ? digit : this.state.display + digit;
    }

    this.notifyListeners();
    await this.saveState();
    return { shouldUnlock: false };
  }

  inputOperation(op: string): void {
    if (this.state.operation && !this.state.isNewInput) {
      this.calculate();
    }
    
    this.state.operation = op;
    this.state.previousValue = this.state.display;
    this.state.isNewInput = true;
    
    this.notifyListeners();
    this.saveState();
  }

  inputDecimal(): void {
    if (this.state.display.includes('.')) return;
    
    if (this.state.isNewInput) {
      this.state.display = '0.';
      this.state.isNewInput = false;
    } else {
      this.state.display += '.';
    }
    
    this.notifyListeners();
    this.saveState();
  }

  calculate(): void {
    if (!this.state.operation || !this.state.previousValue) return;
    
    const prev = parseFloat(this.state.previousValue);
    const current = parseFloat(this.state.display);
    let result = 0;
    
    switch (this.state.operation) {
      case '+':
        result = prev + current;
        break;
      case '-':
        result = prev - current;
        break;
      case '×':
        result = prev * current;
        break;
      case '÷':
        result = current !== 0 ? prev / current : 0;
        break;
      default:
        return;
    }
    
    this.state.display = result.toString();
    this.state.operation = null;
    this.state.previousValue = null;
    this.state.isNewInput = true;
    
    this.notifyListeners();
    this.saveState();
  }

  clear(): void {
    this.state = {
      display: '0',
      operation: null,
      previousValue: null,
      isNewInput: true,
    };
    this.pinBuffer = '';
    
    this.notifyListeners();
    this.saveState();
  }

  backspace(): void {
    if (this.state.display.length > 1) {
      this.state.display = this.state.display.slice(0, -1);
    } else {
      this.state.display = '0';
    }
    
    this.notifyListeners();
    this.saveState();
  }

  getState(): CalculatorState {
    return { ...this.state };
  }
}

// Decoy Mode Detection
export class DecoyModeDetector {
  private static instance: DecoyModeDetector;
  private isInDecoyMode: boolean = false;
  private listeners: Array<(isDecoy: boolean) => void> = [];
  
  static getInstance(): DecoyModeDetector {
    if (!DecoyModeDetector.instance) {
      DecoyModeDetector.instance = new DecoyModeDetector();
    }
    return DecoyModeDetector.instance;
  }

  addListener(listener: (isDecoy: boolean) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.isInDecoyMode));
  }

  async enterDecoyMode(): Promise<void> {
    this.isInDecoyMode = true;
    this.notifyListeners();
    
    // Initialize calculator
    DecoyCalculator.getInstance();
  }

  async exitDecoyMode(): Promise<boolean> {
    const pinManager = DecoyPinManager.getInstance();
    const requiresPin = await pinManager.shouldRequireToExit();
    
    if (requiresPin) {
      const isAuthorized = await this.authenticateForExit();
      if (!isAuthorized) {
        return false;
      }
    }
    
    this.isInDecoyMode = false;
    this.notifyListeners();
    return true;
  }

  private async authenticateForExit(): Promise<boolean> {
    try {
      // Try biometric authentication first
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Exit calculator mode',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });
      
      return result.success;
    } catch {
      return false;
    }
  }

  isDecoyActive(): boolean {
    return this.isInDecoyMode;
  }

  async shouldShowDecoyOnLaunch(): Promise<boolean> {
    // Launch-time decoy requires native launch-context support that is not present yet.
    return false;
  }
}

// Utility functions
export const decoyPinUtils = {
  isValidPin: (pin: string): boolean => {
    return /^\d{4,8}$/.test(pin) && pin !== '0000' && pin !== '1234' && pin !== '1111';
  },
  
  formatPinDisplay: (pin: string): string => {
    return pin.replace(/./g, '•');
  },
  
  generateSecurePin: async (): Promise<string> => {
    const bytes = await Crypto.getRandomBytesAsync(4);
    const value = (
      (bytes[0] << 24) +
      (bytes[1] << 16) +
      (bytes[2] << 8) +
      bytes[3]
    ) >>> 0;

    return String(100000 + (value % 900000));
  },
};
