import { describe, expect, it, vi } from 'vitest';

const httpClientMock = vi.hoisted(() => ({
  setAuthToken: vi.fn(),
}));

vi.mock('../../lib/api/httpClient', () => httpClientMock);

import { resetAuthStateForPrivacyDelete } from '../authStateReset';

describe('auth privacy delete reset', () => {
  it('clears in-memory auth and local guest state for privacy deletion', () => {
    const state = {
      session: { access_token: 'token', user: { id: 'user-a' } } as any,
      user: { id: 'user-a' } as any,
      localGuestSession: { startedAt: '2026-06-06T00:00:00.000Z' } as { startedAt: string } | null,
      lastAuthenticatedUserIdRef: { current: 'user-a' },
    };

    const handled = resetAuthStateForPrivacyDelete('privacy-delete', {
      setSession: value => {
        state.session = value;
      },
      setUser: value => {
        state.user = value;
      },
      setLocalGuestSession: value => {
        state.localGuestSession = value;
      },
      lastAuthenticatedUserIdRef: state.lastAuthenticatedUserIdRef,
    });

    expect(handled).toBe(true);
    expect(state.session).toBeNull();
    expect(state.user).toBeNull();
    expect(state.localGuestSession).toBeNull();
    expect(state.lastAuthenticatedUserIdRef.current).toBeNull();
    expect(httpClientMock.setAuthToken).toHaveBeenCalledWith(null);
  });

  it('ignores unrelated app reset reasons so user-switch can keep the new session', () => {
    const state = {
      session: { access_token: 'token', user: { id: 'user-b' } } as any,
      user: { id: 'user-b' } as any,
      localGuestSession: null as { startedAt: string } | null,
      lastAuthenticatedUserIdRef: { current: 'user-b' },
    };

    const handled = resetAuthStateForPrivacyDelete('user-switch', {
      setSession: value => {
        state.session = value;
      },
      setUser: value => {
        state.user = value;
      },
      setLocalGuestSession: value => {
        state.localGuestSession = value;
      },
      lastAuthenticatedUserIdRef: state.lastAuthenticatedUserIdRef,
    });

    expect(handled).toBe(false);
    expect(state.session?.user.id).toBe('user-b');
    expect(state.user?.id).toBe('user-b');
    expect(state.lastAuthenticatedUserIdRef.current).toBe('user-b');
    expect(httpClientMock.setAuthToken).not.toHaveBeenCalled();
  });
});
