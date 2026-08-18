import { describe, expect, it } from 'vitest';
import {
  accessibility,
  radii,
  semanticStates,
  themeColors,
  touchTargets,
  normalizeThemePreference,
  type SemanticStateName,
} from './tokens';

const requiredStates: SemanticStateName[] = [
  'critical',
  'safety',
  'warning',
  'offline',
  'queued',
  'consent',
  'evidence',
  'support',
  'case',
  'success',
  'destructive',
  'privacy',
  'info',
  'unavailable',
];

describe('SafeRide design tokens', () => {
  it('defines every required semantic state', () => {
    expect(Object.keys(semanticStates).sort()).toEqual([...requiredStates].sort());
  });

  it('resolves semantic state color roles for every theme mode', () => {
    Object.values(themeColors).forEach(colors => {
      requiredStates.forEach(stateName => {
        const state = semanticStates[stateName];

        expect(colors[state.color]).toBeTruthy();
        expect(colors[state.foreground]).toBeTruthy();
        expect(colors[state.muted]).toBeTruthy();
      });
    });
  });

  it('keeps framed surfaces restrained and touch targets accessible', () => {
    expect(radii.card).toBeLessThanOrEqual(8);
    expect(radii.input).toBeLessThanOrEqual(10);
    expect(radii.button).toBeLessThanOrEqual(12);
    expect(radii.round).toBe(999);
    expect(touchTargets.minimum).toBeGreaterThanOrEqual(48);
    expect(accessibility.minTouchTarget).toBe(touchTargets.minimum);
  });

  it('accepts high contrast and rejects corrupt persisted theme values', () => {
    expect(normalizeThemePreference('highContrast')).toBe('highContrast');
    expect(normalizeThemePreference('unsupported')).toBe('system');
  });
});
