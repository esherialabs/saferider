import type { AppResetReason } from '../utils/appReset';
import { setAuthToken } from '../lib/api/httpClient';
import type { Session, User } from '../lib/auth/authClient';

type LocalGuestSession = { startedAt: string } | null;

export interface AuthPrivacyDeleteResetTargets {
  setSession: (session: Session | null) => void;
  setUser: (user: User | null) => void;
  setLocalGuestSession: (session: LocalGuestSession) => void;
  lastAuthenticatedUserIdRef: { current: string | null };
  setAuthTokenValue?: (token: string | null) => void;
}

export function resetAuthStateForPrivacyDelete(
  reason: AppResetReason,
  targets: AuthPrivacyDeleteResetTargets,
): boolean {
  if (reason !== 'privacy-delete') {
    return false;
  }

  targets.setLocalGuestSession(null);
  targets.setSession(null);
  targets.setUser(null);
  (targets.setAuthTokenValue ?? setAuthToken)(null);
  targets.lastAuthenticatedUserIdRef.current = null;
  return true;
}
