import { isAuthNetworkError } from '../lib/auth/authErrors';

export function shouldUseLocalGuestForAnonymousAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const normalized = message.trim().toLowerCase();

  if (
    normalized.includes('anonymous sign-ins are disabled') ||
    normalized.includes('remote account creation is disabled')
  ) {
    return true;
  }

  const status = typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : undefined;
  if (typeof status === 'number') {
    return false;
  }

  return isAuthNetworkError(error);
}
