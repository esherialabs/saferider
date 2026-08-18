import { getRuntimeConfigSnapshot } from '../../config/runtime/runtimeConfigStore';
import { devPrivacyWarn, getPrivacySafeErrorReason, getPrivacySafeHttpStatus } from '../../utils/privacyLog';
import { secureStoreAdapter } from '../secureStoreAdapter';
import { isAuthNetworkError } from './authErrors';

export type User = {
  id: string;
  app_metadata: Record<string, any>;
  user_metadata: Record<string, any>;
  aud: string;
  created_at: string;
  email?: string;
  role?: string;
};

export type Session = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  token_type: string;
  user: User;
};

type EmailPasswordCredentials = {
  email: string;
  password: string;
};

type SignUpPayload = EmailPasswordCredentials & {
  data?: Record<string, unknown>;
  emailRedirectTo?: string;
};

type AuthResult<T> = {
  data: T;
  error: Error | null;
};

type AuthStateSubscription = {
  data: {
    subscription: {
      unsubscribe: () => void;
    };
  };
};

type LocalAuthSessionPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  token_type?: string;
  user?: Record<string, unknown> | null;
};

type StoredSessionEnvelope = {
  provider: 'local';
  session: Session;
};

type ActiveAuthProvider = 'local' | null;

const LOCAL_AUTH_SESSION_KEY = 'saferide_local_auth_session';
const REFRESH_SKEW_SECONDS = 60;

let activeProvider: ActiveAuthProvider = null;

class AuthRequestError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AuthRequestError';
    this.status = status;
  }
}

function getAuthBaseUrl(): string {
  const runtime = getRuntimeConfigSnapshot();
  return runtime.authBaseUrl.endsWith('/')
    ? runtime.authBaseUrl.slice(0, -1)
    : runtime.authBaseUrl;
}

async function readStoredLocalAuthSession(): Promise<Session | null> {
  const raw = await secureStoreAdapter.getItem(LOCAL_AUTH_SESSION_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as StoredSessionEnvelope;
    return parsed.provider === 'local' ? parsed.session : null;
  } catch {
    await secureStoreAdapter.removeItem(LOCAL_AUTH_SESSION_KEY);
    return null;
  }
}

async function persistLocalAuthSession(session: Session | null): Promise<void> {
  if (!session) {
    await secureStoreAdapter.removeItem(LOCAL_AUTH_SESSION_KEY);
    return;
  }

  const envelope: StoredSessionEnvelope = {
    provider: 'local',
    session,
  };
  await secureStoreAdapter.setItem(LOCAL_AUTH_SESSION_KEY, JSON.stringify(envelope));
}

function normalizeUser(rawUser: Record<string, unknown> | null | undefined): User {
  const metadata =
    rawUser && typeof rawUser.user_metadata === 'object' && rawUser.user_metadata !== null
      ? (rawUser.user_metadata as Record<string, unknown>)
      : {};

  return {
    id: String(rawUser?.id ?? rawUser?.sub ?? ''),
    app_metadata:
      rawUser && typeof rawUser.app_metadata === 'object' && rawUser.app_metadata !== null
        ? (rawUser.app_metadata as Record<string, unknown>)
        : {},
    user_metadata: metadata,
    aud: String(rawUser?.aud ?? 'authenticated'),
    created_at: String(rawUser?.created_at ?? new Date().toISOString()),
    email: typeof rawUser?.email === 'string' ? rawUser.email : undefined,
    role: typeof rawUser?.role === 'string' ? rawUser.role : undefined,
  } as User;
}

function buildSession(payload: LocalAuthSessionPayload): Session {
  if (!payload.access_token || !payload.refresh_token) {
    throw new AuthRequestError('Auth response did not include a complete session');
  }

  const expiresIn = payload.expires_in ?? 3600;
  const expiresAt = payload.expires_at ?? Math.floor(Date.now() / 1000) + expiresIn;

  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_in: expiresIn,
    expires_at: expiresAt,
    token_type: payload.token_type ?? 'bearer',
    user: normalizeUser(payload.user),
  } as Session;
}

function isSessionExpired(session: Session): boolean {
  const expiresAt = session.expires_at ?? 0;
  return expiresAt > 0 && expiresAt - REFRESH_SKEW_SECONDS <= Math.floor(Date.now() / 1000);
}

async function parseAuthResponse(response: Response): Promise<LocalAuthSessionPayload> {
  const rawBody = await response.text();
  let parsed: Record<string, any> = {};
  try {
    parsed = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    if (response.ok) {
      throw new AuthRequestError('Authentication response could not be read', response.status);
    }
  }

  if (!response.ok) {
    const message =
      parsed?.msg ??
      parsed?.message ??
      parsed?.error_description ??
      parsed?.error ??
      response.statusText ??
      'Authentication request failed';
    throw new AuthRequestError(String(message), response.status);
  }

  return parsed as LocalAuthSessionPayload;
}

async function localAuthRequest<T extends LocalAuthSessionPayload>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${getAuthBaseUrl()}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  return (await parseAuthResponse(response)) as T;
}

async function getLocalAuthUser(accessToken: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${getAuthBaseUrl()}/user`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) return null;
  return (await response.json()) as Record<string, unknown>;
}

async function refreshLocalAuthSession(session: Session): Promise<Session> {
  const payload = await localAuthRequest('/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  const refreshed = buildSession(payload);
  await persistLocalAuthSession(refreshed);
  activeProvider = 'local';
  return refreshed;
}

async function getValidLocalAuthSession(): Promise<Session | null> {
  const stored = await readStoredLocalAuthSession();
  if (!stored) return null;

  if (!isSessionExpired(stored)) {
    activeProvider = 'local';
    return stored;
  }

  try {
    return await refreshLocalAuthSession(stored);
  } catch (error) {
    if (isAuthNetworkError(error)) {
      activeProvider = 'local';
      return stored;
    }
    devPrivacyWarn('local auth session refresh failed', {
      reason: getPrivacySafeErrorReason(error),
      status: getPrivacySafeHttpStatus(error),
    });
    await persistLocalAuthSession(null);
    activeProvider = null;
    return null;
  }
}

async function signInWithLocalAuth(credentials: EmailPasswordCredentials): Promise<Session> {
  const payload = await localAuthRequest('/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
  const session = buildSession(payload);
  await persistLocalAuthSession(session);
  activeProvider = 'local';
  return session;
}

async function signUpWithLocalAuth(payload: SignUpPayload): Promise<{ user: User | null; session: Session | null }> {
  const result = await localAuthRequest('/signup', {
    method: 'POST',
    body: JSON.stringify({
      email: payload.email,
      password: payload.password,
      data: payload.data,
      redirect_to: payload.emailRedirectTo,
    }),
  });

  const session = result.access_token ? buildSession(result) : null;
  if (session) {
    await persistLocalAuthSession(session);
    activeProvider = 'local';
  }

  const user = session?.user ?? (result.user ? normalizeUser(result.user) : null);
  return { user, session };
}

async function signInAnonymouslyWithLocalAuth(): Promise<Session> {
  const payload = await localAuthRequest('/signup', {
    method: 'POST',
    body: JSON.stringify({ data: { provider: 'anonymous' } }),
  });
  const session = buildSession(payload);
  await persistLocalAuthSession(session);
  activeProvider = 'local';
  return session;
}

export const authClient = {
  getActiveProvider(): ActiveAuthProvider {
    return activeProvider;
  },

  async getSession(): Promise<AuthResult<{ session: Session | null }>> {
    const localAuthSession = await getValidLocalAuthSession();
    if (localAuthSession) {
      return { data: { session: localAuthSession }, error: null };
    }

    activeProvider = null;
    return { data: { session: null }, error: null };
  },

  onAuthStateChange(
    callback: (event: string, session: Session | null) => void | Promise<void>,
  ): AuthStateSubscription {
    return {
      data: {
        subscription: {
          unsubscribe: () => {},
        },
      },
    };
  },

  async exchangeCodeForSession(code: string): Promise<AuthResult<{ session: Session | null }>> {
    return {
      data: { session: null },
      error: new AuthRequestError('Auth code exchange is not available in the owned auth adapter yet.'),
    };
  },

  async setSession(tokens: {
    access_token: string;
    refresh_token: string;
  }): Promise<AuthResult<{ session: Session | null; user: User | null }>> {
    try {
      const user = await getLocalAuthUser(tokens.access_token);
      const session = buildSession({
        ...tokens,
        user,
      });
      await persistLocalAuthSession(session);
      activeProvider = 'local';
      return { data: { session, user: session.user }, error: null };
    } catch (error) {
      return { data: { session: null, user: null }, error: error as Error };
    }
  },

  async signInAnonymously(): Promise<AuthResult<{ session: Session | null; user: User | null }>> {
    try {
      const session = await signInAnonymouslyWithLocalAuth();
      return { data: { session, user: session.user }, error: null };
    } catch (error) {
      return { data: { session: null, user: null }, error: error as Error };
    }
  },

  async signInWithPassword(
    credentials: EmailPasswordCredentials,
  ): Promise<AuthResult<{ session: Session | null; user: User | null }>> {
    try {
      const session = await signInWithLocalAuth(credentials);
      return { data: { session, user: session.user }, error: null };
    } catch (error) {
      return { data: { session: null, user: null }, error: error as Error };
    }
  },

  async signUp(payload: SignUpPayload): Promise<AuthResult<{ user: User | null; session: Session | null }>> {
    try {
      const data = await signUpWithLocalAuth(payload);
      return { data, error: null };
    } catch (error) {
      return { data: { user: null, session: null }, error: error as Error };
    }
  },

  async resetPasswordForEmail(email: string, redirectTo: string): Promise<AuthResult<unknown>> {
    try {
      const data = await localAuthRequest('/recover', {
        method: 'POST',
        body: JSON.stringify({ email, redirect_to: redirectTo }),
      });
      return { data, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  },

  async signOut(): Promise<AuthResult<unknown>> {
    const stored = await readStoredLocalAuthSession();
    if (activeProvider === 'local' || stored) {
      await fetch(`${getAuthBaseUrl()}/logout`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${(stored ?? undefined)?.access_token ?? ''}`,
        },
      }).catch(error => {
        devPrivacyWarn('local auth logout request failed', {
          reason: getPrivacySafeErrorReason(error),
          status: getPrivacySafeHttpStatus(error),
        });
      });
      await persistLocalAuthSession(null);
      activeProvider = null;
      return { data: null, error: null };
    }

    activeProvider = null;
    return { data: null, error: null };
  },
};
