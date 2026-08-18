import { afterEach, describe, expect, it, vi } from 'vitest';

import { withStartupFallback } from '../startupBudget';

describe('withStartupFallback', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves the original value when work completes inside the budget', async () => {
    await expect(withStartupFallback(Promise.resolve('ready'), 100, 'fallback')).resolves.toBe('ready');
  });

  it('releases with a fallback when work exceeds the startup budget', async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const result = withStartupFallback(new Promise<string>(() => undefined), 100, 'fallback', onTimeout);

    await vi.advanceTimersByTimeAsync(100);

    await expect(result).resolves.toBe('fallback');
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('keeps fast failures visible instead of hiding them as timeouts', async () => {
    await expect(
      withStartupFallback(Promise.reject(new Error('storage failed')), 100, 'fallback'),
    ).rejects.toThrow('storage failed');
  });
});
