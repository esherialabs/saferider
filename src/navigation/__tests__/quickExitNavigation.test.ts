import { describe, expect, it, vi } from 'vitest';

import {
  QUICK_EXIT_RESET_STATE,
  createQuickExitResetAction,
  resetToCalculatorDecoy,
  resetToCalculatorDecoyIfUnlockable,
} from '../quickExitNavigation';

describe('quick-exit navigation reset', () => {
  it('resets the root stack from tab header navigation', () => {
    const rootNavigation = { reset: vi.fn() };
    const tabNavigation = {
      getParent: vi.fn(() => rootNavigation),
      navigate: vi.fn(),
    };

    expect(resetToCalculatorDecoy(tabNavigation)).toBe(true);

    expect(tabNavigation.getParent).toHaveBeenCalledTimes(1);
    expect(rootNavigation.reset).toHaveBeenCalledWith(QUICK_EXIT_RESET_STATE);
    expect(tabNavigation.navigate).not.toHaveBeenCalled();
  });

  it('resets the root stack from Home quick-exit hook navigation', () => {
    const rootNavigation = { resetRoot: vi.fn() };
    const homeNavigation = {
      getParent: vi.fn(() => rootNavigation),
      navigate: vi.fn(),
    };

    expect(resetToCalculatorDecoy(homeNavigation)).toBe(true);

    expect(rootNavigation.resetRoot).toHaveBeenCalledWith(QUICK_EXIT_RESET_STATE);
    expect(homeNavigation.navigate).not.toHaveBeenCalled();
  });

  it('dispatches a reset action when reset methods are unavailable', () => {
    const dispatch = vi.fn();

    expect(resetToCalculatorDecoy({ dispatch })).toBe(true);

    expect(dispatch).toHaveBeenCalledWith(createQuickExitResetAction());
  });

  it('returns false when no reset-capable navigation object is available', () => {
    expect(resetToCalculatorDecoy(undefined)).toBe(false);
    expect(resetToCalculatorDecoy({})).toBe(false);
  });

  it('does not reset to the calculator when no Decoy PIN can unlock it', async () => {
    const reset = vi.fn();

    await expect(resetToCalculatorDecoyIfUnlockable({ reset }, async () => false)).resolves.toBe(false);

    expect(reset).not.toHaveBeenCalled();
  });

  it('resets to the calculator when the Decoy PIN guard passes', async () => {
    const reset = vi.fn();

    await expect(resetToCalculatorDecoyIfUnlockable({ reset }, async () => true)).resolves.toBe(true);

    expect(reset).toHaveBeenCalledWith(QUICK_EXIT_RESET_STATE);
  });
});
