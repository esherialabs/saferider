import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  PropsWithChildren,
} from "react";
import { Linking } from "react-native";

import { authClient, type Session, type User } from "../lib/auth/authClient";
import { setAuthToken } from "../lib/api/httpClient";
import { draftStorage } from "../utils/draftStorage";
import { offlineSyncManager } from "../utils/offlineSync";
import { runAppReset, registerAppResetHandler, AppResetReason } from "../utils/appReset";
import { devPrivacyInfo, devPrivacyWarn, getPrivacySafeErrorReason, getPrivacySafeHttpStatus } from "../utils/privacyLog";
import { resetAuthStateForPrivacyDelete } from "./authStateReset";
import { shouldUseLocalGuestForAnonymousAuthError } from "./authFallback";
import { withStartupFallback } from "../utils/startupBudget";
import {
  clearLocalGuestSession,
  createLocalGuestSession,
  persistLocalGuestSession,
  readLocalGuestSession,
  type LocalGuestSession,
} from "./localGuestSessionStore";

const AUTH_REDIRECT_URI = "saferide://auth/callback";
const AUTH_HYDRATION_BUDGET_MS = 900;

type EmailPasswordCredentials = {
  email: string;
  password: string;
};

type SignUpWithPasswordResult = {
  user: User | null;
  session: Session | null;
  requiresEmailConfirmation: boolean;
};

type SignUpWithPasswordPayload = EmailPasswordCredentials & {
  fullName?: string;
  phone?: string;
};

type AnonymousSignInResult = "owned-auth" | "local-guest";

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  isLocalGuest: boolean;
  isLoading: boolean;
  isHydrated: boolean;
  isAuthenticatingWithLink: boolean;
  linkError: string | null;
  clearLinkError: () => void;
  signInAnonymously: () => Promise<AnonymousSignInResult>;
  signInWithPassword: (credentials: EmailPasswordCredentials) => Promise<void>;
  signUpWithPassword: (
    payload: SignUpWithPasswordPayload
  ) => Promise<SignUpWithPasswordResult>;
  sendPasswordReset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function ensureProfile(user: User | null) {
  if (!user) return;
  // Owned Postgres profile creation is handled server-side by the API auth middleware.
}

function collectAuthParams(url: URL): URLSearchParams {
  const params = new URLSearchParams(url.search ?? "");
  if (url.hash) {
    const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    if (hash) {
      const hashParams = new URLSearchParams(hash);
      hashParams.forEach((value, key) => {
        params.set(key, value);
      });
    }
  }
  return params;
}

export function AuthProvider({ children }: PropsWithChildren<{}>) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isHydrated, setIsHydrated] = useState(false);
  const [linkState, setLinkState] = useState<{
    isProcessing: boolean;
    error: string | null;
  }>({
    isProcessing: false,
    error: null,
  });
  const [localGuestSession, setLocalGuestSession] = useState<LocalGuestSession | null>(null);

  const lastAuthenticatedUserIdRef = useRef<string | null>(null);

  const resetAppState = useCallback(async (reason: AppResetReason) => {
    await Promise.allSettled([
      draftStorage.clearAll(),
      offlineSyncManager.reset(),
      runAppReset(reason),
    ]);
  }, []);

  const handlePrivacyDeleteReset = useCallback((reason: AppResetReason) => {
    if (reason === 'privacy-delete') {
      clearLocalGuestSession().catch((error) => {
        devPrivacyWarn("local guest session delete failed during privacy reset", {
          reason: getPrivacySafeErrorReason(error),
        });
      });
    }

    resetAuthStateForPrivacyDelete(reason, {
      setSession,
      setUser,
      setLocalGuestSession,
      lastAuthenticatedUserIdRef,
    });
  }, []);

  useEffect(() => registerAppResetHandler(handlePrivacyDeleteReset), [handlePrivacyDeleteReset]);

  const applySession = useCallback(
    async (nextSession: Session | null) => {
      const prevAuthenticatedUserId = lastAuthenticatedUserIdRef.current;
      const nextUserId = nextSession?.user?.id ?? null;

      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setAuthToken(nextSession?.access_token ?? null);
      if (nextSession) {
        setLocalGuestSession(null);
        await clearLocalGuestSession();
      }

      let resetReason: AppResetReason | null = null;

      if (
        nextUserId &&
        prevAuthenticatedUserId &&
        prevAuthenticatedUserId !== nextUserId
      ) {
        resetReason = "user-switch";
      } else if (!nextUserId && prevAuthenticatedUserId) {
        resetReason = "sign-out";
      }

      if (resetReason) {
        await resetAppState(resetReason);
      }

      if (nextSession?.user) {
        ensureProfile(nextSession.user).catch((error) => {
          devPrivacyWarn("profile ensure failed during session apply", {
            reason: getPrivacySafeErrorReason(error),
            status: getPrivacySafeHttpStatus(error),
          });
        });
      }

      if (nextUserId) {
        lastAuthenticatedUserIdRef.current = nextUserId;
      } else {
        lastAuthenticatedUserIdRef.current = null;
      }
    },
    [resetAppState]
  );

  const processAuthLink = useCallback(
    async (url: string): Promise<boolean> => {
      if (!url) return false;
      const normalized = url.toLowerCase();
      if (!normalized.startsWith("saferide://auth")) {
        return false;
      }

      setLinkState((prev) => ({ ...prev, isProcessing: true, error: null }));

      try {
        const parsed = new URL(url);
        const params = collectAuthParams(parsed);

        const errorDescription =
          params.get("error_description") ?? params.get("error") ?? null;

        if (errorDescription) {
          setLinkState({
            isProcessing: false,
            error: 'Unable to complete sign-in from that link.',
          });
          return true;
        }

        const code = params.get("code");
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");

        if (code) {
          const { data, error } = await authClient.exchangeCodeForSession(code);
          if (error) {
            throw error;
          }
          await applySession(data.session ?? null);
          setLinkState({ isProcessing: false, error: null });
          return true;
        }

        if (accessToken && refreshToken) {
          const { data, error } = await authClient.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) {
            throw error;
          }
          await applySession(data.session ?? null);
          setLinkState({ isProcessing: false, error: null });
          return true;
        }

        setLinkState((prev) => ({ ...prev, isProcessing: false }));
        return false;
      } catch (error) {
        devPrivacyWarn("auth deep link processing failed", {
          reason: getPrivacySafeErrorReason(error),
          status: getPrivacySafeHttpStatus(error),
        });
        setLinkState({
          isProcessing: false,
          error: "Unable to complete sign-in from that link.",
        });
        return false;
      }
    },
    [applySession]
  );

  useEffect(() => {
    let isMounted = true;

    const hydrate = async () => {
      const hydrationTask = (async () => {
        const { data, error } = await authClient.getSession();
        if (error) {
          devPrivacyWarn("auth session fetch failed", {
            reason: getPrivacySafeErrorReason(error),
            status: getPrivacySafeHttpStatus(error),
          });
        }
        if (isMounted) {
          if (data.session) {
            await applySession(data.session);
          } else {
            const storedLocalGuestSession = await readLocalGuestSession();
            if (storedLocalGuestSession) {
              setSession(null);
              setUser(null);
              setAuthToken(null);
              setLocalGuestSession(storedLocalGuestSession);
              lastAuthenticatedUserIdRef.current = 'local-guest';
            } else {
              await applySession(null);
            }
          }
        }
      })();

      let completedBeforeBudget = false;
      try {
        completedBeforeBudget = await withStartupFallback(
          hydrationTask.then(() => true),
          AUTH_HYDRATION_BUDGET_MS,
          false,
          () => {
            devPrivacyInfo("auth hydration released after budget", {
              reason: "startup-budget-expired",
            });
          },
        );
      } catch (error) {
        devPrivacyWarn("auth hydration failed", {
          reason: getPrivacySafeErrorReason(error),
          status: getPrivacySafeHttpStatus(error),
        });
      }

      if (isMounted) {
        setIsLoading(false);
        setIsHydrated(true);
      }

      if (!completedBeforeBudget) {
        hydrationTask.catch(error => {
          devPrivacyWarn("background auth hydration failed", {
            reason: getPrivacySafeErrorReason(error),
            status: getPrivacySafeHttpStatus(error),
          });
        });
      }

      const { data: subscription } = authClient.onAuthStateChange(
        async (_event, newSession) => {
          await applySession(newSession);
        }
      );
      return subscription.subscription;
    };

    let authSubscription: { unsubscribe: () => void } | null = null;
    hydrate()
      .then(subscription => {
        authSubscription = subscription ?? null;
      })
      .catch(error => {
        devPrivacyWarn("auth hydration failed", {
          reason: getPrivacySafeErrorReason(error),
          status: getPrivacySafeHttpStatus(error),
        });
      });

    return () => {
      isMounted = false;
      authSubscription?.unsubscribe();
    };
  }, [applySession]);

  useEffect(() => {
    const handleUrl = ({ url }: { url: string }) => {
      processAuthLink(url).catch((error) => {
        devPrivacyWarn("auth link handler failed", {
          reason: getPrivacySafeErrorReason(error),
          status: getPrivacySafeHttpStatus(error),
        });
      });
    };

    const subscription = Linking.addEventListener("url", handleUrl);

    Linking.getInitialURL()
      .then((initialUrl) => {
        if (initialUrl) {
          return processAuthLink(initialUrl);
        }
        return false;
      })
      .catch((error) => {
        devPrivacyWarn("initial auth link lookup failed", {
          reason: getPrivacySafeErrorReason(error),
          status: getPrivacySafeHttpStatus(error),
        });
      });

    return () => {
      subscription.remove();
    };
  }, [processAuthLink]);

  const signInAnonymously = useCallback(async (): Promise<AnonymousSignInResult> => {
    if (localGuestSession) {
      return 'local-guest';
    }

    try {
      const { data, error } = await authClient.signInAnonymously();
      if (error) {
        throw error;
      }
      await applySession(data.session ?? null);
      return 'owned-auth';
    } catch (error) {
      if (shouldUseLocalGuestForAnonymousAuthError(error)) {
        const nextLocalGuestSession = createLocalGuestSession();
        await resetAppState(localGuestSession ? 'user-switch' : 'sign-out');
        await persistLocalGuestSession(nextLocalGuestSession);
        setLocalGuestSession(nextLocalGuestSession);
        setSession(null);
        setUser(null);
        setAuthToken(null);
        lastAuthenticatedUserIdRef.current = 'local-guest';
        return 'local-guest';
      }

      throw error;
    }
  }, [applySession, localGuestSession, resetAppState]);

  const signInWithPassword = useCallback(
    async (credentials: EmailPasswordCredentials) => {
      const { data, error } = await authClient.signInWithPassword(credentials);
      if (error) {
        throw error;
      }
      await applySession(data.session ?? null);
    },
    [applySession]
  );

  const signUpWithPassword = useCallback(
    async (
      payload: SignUpWithPasswordPayload
    ): Promise<SignUpWithPasswordResult> => {
      const metadata: Record<string, unknown> = {};
      if (payload.fullName) {
        metadata.full_name = payload.fullName;
      }
      if (payload.phone) {
        metadata.phone = payload.phone;
      }

      const { data, error } = await authClient.signUp({
        email: payload.email,
        password: payload.password,
        emailRedirectTo: AUTH_REDIRECT_URI,
        data: Object.keys(metadata).length > 0 ? metadata : undefined,
      });

      if (error) {
        throw error;
      }

      if (data.session) {
        await applySession(data.session);
      }

      return {
        user: data.user ?? null,
        session: data.session ?? null,
        requiresEmailConfirmation: !data.session,
      };
    },
    [applySession]
  );

  const sendPasswordReset = useCallback(async (email: string) => {
    const { error } = await authClient.resetPasswordForEmail(email, AUTH_REDIRECT_URI);
    if (error) {
      throw error;
    }
  }, []);

  const signOut = useCallback(async () => {
    if (localGuestSession) {
      await resetAppState('sign-out');
      await clearLocalGuestSession();
      setLocalGuestSession(null);
      setSession(null);
      setUser(null);
      setAuthToken(null);
      lastAuthenticatedUserIdRef.current = null;
      return;
    }

    const { error } = await authClient.signOut();
    if (error) {
      throw error;
    }
    await applySession(null);
  }, [applySession, localGuestSession, resetAppState]);

  const clearLinkError = useCallback(() => {
    setLinkState((prev) => (prev.error ? { ...prev, error: null } : prev));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user,
      isLocalGuest: !!localGuestSession,
      isLoading,
      isHydrated,
      isAuthenticatingWithLink: linkState.isProcessing,
      linkError: linkState.error,
      clearLinkError,
      signInAnonymously,
      signInWithPassword,
      signUpWithPassword,
      sendPasswordReset,
      signOut,
    }),
    [
      session,
      user,
      localGuestSession,
      isLoading,
      isHydrated,
      linkState,
      clearLinkError,
      signInAnonymously,
      signInWithPassword,
      signUpWithPassword,
      sendPasswordReset,
      signOut,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
