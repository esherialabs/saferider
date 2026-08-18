import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import {
  getStealthTriggerCapabilities,
  getSupportedStealthTriggers,
  resolveStealthTrigger,
} from '../stealthCapabilities';

describe('stealth trigger capabilities', () => {
  it('marks native-only volume and power triggers unavailable', () => {
    const capabilities = getStealthTriggerCapabilities('ios');

    expect(capabilities.volume.supported).toBe(false);
    expect(capabilities.power.supported).toBe(false);
    expect(resolveStealthTrigger('volume', 'ios')).toBe('shake');
  });

  it('keeps only tap available on web', () => {
    expect(getSupportedStealthTriggers('web')).toEqual(['tap']);
    expect(resolveStealthTrigger('shake', 'web')).toBe('tap');
  });
});
