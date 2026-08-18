import { beforeEach, describe, expect, it, vi } from 'vitest';

const secureStoreAdapterMock = vi.hoisted(() => ({
  store: new Map<string, string>(),
  getItem: vi.fn(async (key: string) => secureStoreAdapterMock.store.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => {
    secureStoreAdapterMock.store.set(key, value);
  }),
  removeItem: vi.fn(async (key: string) => {
    secureStoreAdapterMock.store.delete(key);
  }),
}));

vi.mock('../../lib/secureStoreAdapter', () => ({
  secureStoreAdapter: secureStoreAdapterMock,
}));

import {
  clearLocalGuestSession,
  createLocalGuestSession,
  persistLocalGuestSession,
  readLocalGuestSession,
} from '../localGuestSessionStore';

describe('local guest session store', () => {
  beforeEach(() => {
    secureStoreAdapterMock.store.clear();
    secureStoreAdapterMock.getItem.mockClear();
    secureStoreAdapterMock.setItem.mockClear();
    secureStoreAdapterMock.removeItem.mockClear();
  });

  it('persists a local guest marker through protected auth storage', async () => {
    const session = createLocalGuestSession(new Date('2026-06-15T16:40:00.000Z'));

    await persistLocalGuestSession(session);

    expect(secureStoreAdapterMock.setItem).toHaveBeenCalledWith(
      'saferide_local_guest_session',
      JSON.stringify({
        provider: 'local-guest',
        version: 1,
        startedAt: '2026-06-15T16:40:00.000Z',
      }),
    );
    expect(await readLocalGuestSession()).toEqual(session);
  });

  it('clears invalid stored markers instead of trusting them', async () => {
    secureStoreAdapterMock.store.set('saferide_local_guest_session', JSON.stringify({
      provider: 'local-guest',
      version: 1,
      startedAt: 'not-a-date',
    }));

    await expect(readLocalGuestSession()).resolves.toBeNull();

    expect(secureStoreAdapterMock.removeItem).toHaveBeenCalledWith('saferide_local_guest_session');
  });

  it('clears the local guest marker on sign-out or privacy delete', async () => {
    await persistLocalGuestSession(createLocalGuestSession(new Date('2026-06-15T16:40:00.000Z')));

    await clearLocalGuestSession();

    expect(secureStoreAdapterMock.removeItem).toHaveBeenCalledWith('saferide_local_guest_session');
    expect(await readLocalGuestSession()).toBeNull();
  });
});
