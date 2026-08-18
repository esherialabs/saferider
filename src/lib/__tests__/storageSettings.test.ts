import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  secureItems: new Map<string, string>(),
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (key: string) => mockState.secureItems.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    mockState.secureItems.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    mockState.secureItems.delete(key);
  }),
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
}));

import { Storage } from '../storage';

describe('Storage safety settings', () => {
  beforeEach(() => {
    mockState.secureItems.clear();
  });

  it('defaults to a supported stealth trigger and persists settings durably', async () => {
    expect((await Storage.getSettings()).stealthTrigger).toBe('shake');

    await Storage.saveSettings({
      stealthTrigger: 'tap',
      stealthHapticsEnabled: false,
      stealthAutoRecordEnabled: false,
    });

    expect(await Storage.getSettings()).toMatchObject({
      stealthTrigger: 'tap',
      stealthHapticsEnabled: false,
      stealthAutoRecordEnabled: false,
    });
    expect(JSON.parse(mockState.secureItems.get('app_settings') ?? '{}')).toMatchObject({
      stealthTrigger: 'tap',
      stealthHapticsEnabled: false,
      stealthAutoRecordEnabled: false,
    });
  });

  it('persists high contrast and fails closed to system for corrupt theme values', async () => {
    await Storage.saveSettings({ theme: 'highContrast' });
    expect((await Storage.getSettings()).theme).toBe('highContrast');

    mockState.secureItems.set('app_settings', JSON.stringify({ theme: 'neon' }));
    expect((await Storage.getSettings()).theme).toBe('system');
  });
});
