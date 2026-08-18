import { secureStoreAdapter } from '../lib/secureStoreAdapter';

const LOCAL_GUEST_SESSION_KEY = 'saferide_local_guest_session';
const LOCAL_GUEST_SESSION_VERSION = 1;

export type LocalGuestSession = {
  startedAt: string;
};

type StoredLocalGuestSession = LocalGuestSession & {
  provider: 'local-guest';
  version: typeof LOCAL_GUEST_SESSION_VERSION;
};

function isValidLocalGuestSession(value: unknown): value is StoredLocalGuestSession {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<StoredLocalGuestSession>;
  return (
    candidate.provider === 'local-guest' &&
    candidate.version === LOCAL_GUEST_SESSION_VERSION &&
    typeof candidate.startedAt === 'string' &&
    Number.isFinite(Date.parse(candidate.startedAt))
  );
}

export function createLocalGuestSession(now = new Date()): LocalGuestSession {
  return {
    startedAt: now.toISOString(),
  };
}

export async function readLocalGuestSession(): Promise<LocalGuestSession | null> {
  const raw = await secureStoreAdapter.getItem(LOCAL_GUEST_SESSION_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (isValidLocalGuestSession(parsed)) {
      return {
        startedAt: parsed.startedAt,
      };
    }
  } catch {
    // Fall through and remove the unreadable marker.
  }

  await clearLocalGuestSession();
  return null;
}

export async function persistLocalGuestSession(session: LocalGuestSession): Promise<void> {
  const envelope: StoredLocalGuestSession = {
    provider: 'local-guest',
    version: LOCAL_GUEST_SESSION_VERSION,
    startedAt: session.startedAt,
  };

  await secureStoreAdapter.setItem(LOCAL_GUEST_SESSION_KEY, JSON.stringify(envelope));
}

export async function clearLocalGuestSession(): Promise<void> {
  await secureStoreAdapter.removeItem(LOCAL_GUEST_SESSION_KEY);
}
