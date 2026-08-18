import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  PanResponder: {
    create: vi.fn((config) => ({ panHandlers: config })),
  },
}));

vi.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'Light', Medium: 'Medium' },
  impactAsync: vi.fn(async () => undefined),
}));

import {
  DEFAULT_QUICK_EXIT_CONFIG,
  QUICK_EXIT_CONFIG_KEY,
  QuickExitManager,
} from '../quickExit';

describe('QuickExitManager', () => {
  beforeEach(async () => {
    await QuickExitManager.getInstance().setConfig({
      ...DEFAULT_QUICK_EXIT_CONFIG,
      enabled: false,
      hapticFeedback: false,
    });
  });

  it('persists the enabled gesture setting', async () => {
    const manager = QuickExitManager.getInstance();

    await manager.setEnabled(true);

    expect(manager.isQuickExitEnabled()).toBe(true);
    expect(JSON.parse((await AsyncStorage.getItem(QUICK_EXIT_CONFIG_KEY)) ?? '{}')).toMatchObject({
      enabled: true,
      gestureType: 'swipe-down',
    });
  });

  it('notifies listeners when quick exit is requested', async () => {
    const manager = QuickExitManager.getInstance();
    const listener = vi.fn();
    const unsubscribe = manager.addListener(listener);

    await manager.requestQuickExit();

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
