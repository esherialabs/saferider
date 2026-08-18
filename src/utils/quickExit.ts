import { PanResponder, PanResponderInstance, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

export interface QuickExitConfig {
  enabled: boolean;
  gestureType: 'swipe-down' | 'double-tap';
  fingersRequired: number;
  sensitivity: number; // pixels
  hapticFeedback: boolean;
}

export interface QuickExitCapability {
  buttonAvailable: boolean;
  gestureAvailable: boolean;
  appSwitcherMaskingAvailable: boolean;
  platform: typeof Platform.OS;
  summary: string;
}

export type QuickExitListener = () => void;

export const QUICK_EXIT_CONFIG_KEY = 'safe_ride_quick_exit_config';
export const DEFAULT_QUICK_EXIT_CONFIG: QuickExitConfig = {
  enabled: false,
  gestureType: 'swipe-down',
  fingersRequired: 2,
  sensitivity: 100,
  hapticFeedback: true,
};

function normalizeConfig(raw: unknown): QuickExitConfig {
  const parsed = raw && typeof raw === 'object' ? raw as Partial<QuickExitConfig> : {};
  return {
    enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_QUICK_EXIT_CONFIG.enabled,
    gestureType: parsed.gestureType === 'double-tap' ? 'double-tap' : DEFAULT_QUICK_EXIT_CONFIG.gestureType,
    fingersRequired: typeof parsed.fingersRequired === 'number'
      ? Math.max(1, Math.min(5, Math.floor(parsed.fingersRequired)))
      : DEFAULT_QUICK_EXIT_CONFIG.fingersRequired,
    sensitivity: typeof parsed.sensitivity === 'number'
      ? Math.max(40, Math.min(300, parsed.sensitivity))
      : DEFAULT_QUICK_EXIT_CONFIG.sensitivity,
    hapticFeedback: typeof parsed.hapticFeedback === 'boolean'
      ? parsed.hapticFeedback
      : DEFAULT_QUICK_EXIT_CONFIG.hapticFeedback,
  };
}

export class QuickExitManager {
  private static instance: QuickExitManager | null = null;
  private config: QuickExitConfig = DEFAULT_QUICK_EXIT_CONFIG;
  private listeners: QuickExitListener[] = [];
  private panResponder: PanResponderInstance | null = null;
  private armed = false;
  private lastTriggeredAt = 0;

  static getInstance(): QuickExitManager {
    if (!this.instance) this.instance = new QuickExitManager();
    return this.instance;
  }

  private constructor() {
    // Fire and forget; config defaults are safe.
    this.loadConfig();
    this.initPanResponder();
  }

  private async loadConfig() {
    try {
      const raw = await AsyncStorage.getItem(QUICK_EXIT_CONFIG_KEY);
      this.config = raw ? normalizeConfig(JSON.parse(raw)) : DEFAULT_QUICK_EXIT_CONFIG;
      this.armed = this.config.enabled;
    } catch {
      this.config = DEFAULT_QUICK_EXIT_CONFIG;
      this.armed = false;
    }
  }

  async rehydrateFromStorage(): Promise<void> {
    await this.loadConfig();
  }

  private async saveConfig() {
    try {
      await AsyncStorage.setItem(QUICK_EXIT_CONFIG_KEY, JSON.stringify(this.config));
    } catch {
      // ignore
    }
  }

  private initPanResponder() {
    this.panResponder = PanResponder.create({
      onStartShouldSetPanResponder: (evt) => {
        if (!this.config.enabled || !this.armed || this.config.gestureType !== 'swipe-down') return false;
        return evt.nativeEvent.touches.length >= this.config.fingersRequired;
      },
      onMoveShouldSetPanResponder: (evt) => {
        if (!this.config.enabled || !this.armed || this.config.gestureType !== 'swipe-down') return false;
        return evt.nativeEvent.touches.length >= this.config.fingersRequired;
      },
      onPanResponderMove: (_evt, gestureState) => {
        if (!this.config.enabled || !this.armed) return;
        if (this.config.gestureType === 'swipe-down') {
          const deltaY = gestureState.dy;
          const deltaX = Math.abs(gestureState.dx);
          if (deltaX <= this.config.sensitivity / 2 && deltaY > this.config.sensitivity) {
            this.trigger();
          }
        }
      },
      onPanResponderRelease: () => {},
      onPanResponderTerminate: () => {},
    });
  }

  private async trigger() {
    const now = Date.now();
    if (now - this.lastTriggeredAt < 1000) return;
    this.lastTriggeredAt = now;

    if (this.config.hapticFeedback) {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}
    }
    this.listeners.forEach((l) => l());
  }

  // Public API
  async setConfig(partial: Partial<QuickExitConfig>) {
    this.config = normalizeConfig({ ...this.config, ...partial });
    if (typeof partial.enabled === 'boolean') {
      this.armed = partial.enabled;
    }
    await this.saveConfig();
  }

  getConfig(): QuickExitConfig {
    return { ...this.config };
  }

  async setEnabled(enabled: boolean) {
    this.config = { ...this.config, enabled };
    this.armed = enabled;
    await this.saveConfig();
  }

  isQuickExitEnabled(): boolean {
    return !!this.config.enabled;
  }

  enable(): void {
    this.armed = true;
  }

  disable(): void {
    this.armed = false;
  }

  getPanResponder(): PanResponderInstance | null {
    return this.panResponder;
  }

  addListener(listener: QuickExitListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  async requestQuickExit() {
    await this.trigger();
  }

  async testQuickExit() {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}
  }
}

export class AppExitHandler {
  private static instance: AppExitHandler | null = null;
  private exitListeners: Array<() => Promise<boolean>> = [];

  static getInstance(): AppExitHandler {
    if (!this.instance) this.instance = new AppExitHandler();
    return this.instance;
  }

  addExitListener(listener: () => Promise<boolean>): () => void {
    this.exitListeners.push(listener);
    return () => {
      this.exitListeners = this.exitListeners.filter((l) => l !== listener);
    };
  }

  async forceExit() {
    // Expo does not provide a supported cross-platform force-exit API.
    return false;
  }
}

export class SecurityStateManager {
  private static instance: SecurityStateManager | null = null;
  private isSecure = false;
  private listeners: Array<(isSecure: boolean) => void> = [];

  static getInstance(): SecurityStateManager {
    if (!this.instance) this.instance = new SecurityStateManager();
    return this.instance;
  }

  enableSecureMode() {
    this.isSecure = true;
    QuickExitManager.getInstance().enable();
    this.listeners.forEach((l) => l(true));
  }

  disableSecureMode() {
    this.isSecure = false;
    QuickExitManager.getInstance().disable();
    this.listeners.forEach((l) => l(false));
  }

  isInSecureMode() {
    return this.isSecure;
  }

  addListener(listener: (isSecure: boolean) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
}

export const quickExitUtils = {
  getCapabilities: (): QuickExitCapability => ({
    buttonAvailable: true,
    gestureAvailable: Platform.OS !== 'web',
    appSwitcherMaskingAvailable: false,
    platform: Platform.OS,
    summary: Platform.OS === 'web'
      ? 'Quick exit can open the calculator decoy; multitouch gestures and app-switcher masking are not available on web.'
      : 'Quick exit can open the calculator decoy from the app and through the foreground two-finger gesture.',
  }),
  supportsMultitouch: () => Platform.OS !== 'web',
  getRecommendedSettings: (): Partial<QuickExitConfig> => ({
    gestureType: 'swipe-down',
    fingersRequired: 2,
    sensitivity: 100,
  }),
};
