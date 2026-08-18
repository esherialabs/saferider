import { describe, expect, it } from 'vitest';

import { shouldUseLocalGuestForAnonymousAuthError } from '../authFallback';

describe('shouldUseLocalGuestForAnonymousAuthError', () => {
  it.each([
    'failed to fetch',
    'fetch failed',
    'Network request failed',
    'TypeError: fetch failed',
    'Load failed',
    'The Internet connection appears to be offline.',
    'Could not connect to the server.',
    'Request timed out',
  ])('treats network fetch wording as local-guest eligible: %s', message => {
    expect(shouldUseLocalGuestForAnonymousAuthError(new Error(message))).toBe(true);
  });

  it('treats disabled anonymous auth as local-guest eligible', () => {
    expect(shouldUseLocalGuestForAnonymousAuthError(new Error('Anonymous sign-ins are disabled'))).toBe(true);
  });

  it('keeps anonymous use local-only while remote account creation is disabled', () => {
    const error = Object.assign(
      new Error('Remote account creation is disabled pending legal and safeguarding approval'),
      { status: 503 },
    );
    expect(shouldUseLocalGuestForAnonymousAuthError(error)).toBe(true);
  });

  it('does not hide HTTP auth errors behind local guest fallback', () => {
    const error = Object.assign(new Error('Invalid email or password'), { status: 401 });

    expect(shouldUseLocalGuestForAnonymousAuthError(error)).toBe(false);
  });
});
