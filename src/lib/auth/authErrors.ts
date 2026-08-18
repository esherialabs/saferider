const NETWORK_AUTH_SIGNALS = [
  'failed to fetch',
  'fetch failed',
  'network request failed',
  'networkerror',
  'load failed',
  'internet connection appears to be offline',
  'could not connect to the server',
  'connection timed out',
  'request timed out',
  'network connection was lost',
  'offline',
];

export function isAuthNetworkError(error: unknown): boolean {
  const status = typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : undefined;
  if (typeof status === 'number') {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error ?? '');
  const normalized = message.trim().toLowerCase();

  return NETWORK_AUTH_SIGNALS.some(signal => normalized.includes(signal));
}

export function getAuthErrorMessage(error: unknown): string {
  if (isAuthNetworkError(error)) {
    return 'No connection. Use a saved session or continue without an account; sign-in needs internet.';
  }

  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.trim() || 'Authentication failed. Try again.';
}
