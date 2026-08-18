type PrivacyLogLevel = 'log' | 'info' | 'warn' | 'error';

export type PrivacyLogMeta = Record<string, string | number | boolean | null | undefined>;

const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|authorization|cookie|session|draft|case|owner|user|attachment|bucket|path|uri|url|file|name|email|phone|address|location|coordinate|lat|lng|long|provider|referral|contact|summary|description|narrative|evidence|media|payload|body|headers|stack|message)/i;

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HASH_PATTERN = /\b[a-f0-9]{32,}\b/gi;
const URL_PATTERN = /\b(?:https?|file|content):\/\/\S+/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const TOKEN_PATTERN = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;

function redactSensitiveText(value: string): string {
  return value
    .replace(TOKEN_PATTERN, '[redacted-token]')
    .replace(URL_PATTERN, '[redacted-url]')
    .replace(EMAIL_PATTERN, '[redacted-email]')
    .replace(UUID_PATTERN, '[redacted-id]')
    .replace(HASH_PATTERN, '[redacted-hash]');
}

function truncate(value: string): string {
  return value.length > 96 ? `${value.slice(0, 93)}...` : value;
}

function sanitizeMeta(meta: PrivacyLogMeta): PrivacyLogMeta {
  return Object.entries(meta).reduce<PrivacyLogMeta>((safeMeta, [key, value]) => {
    if (value === undefined) {
      return safeMeta;
    }

    if (SENSITIVE_KEY_PATTERN.test(key)) {
      safeMeta[key] = '[redacted]';
      return safeMeta;
    }

    if (typeof value === 'string') {
      safeMeta[key] = truncate(redactSensitiveText(value));
      return safeMeta;
    }

    safeMeta[key] = value;
    return safeMeta;
  }, {});
}

function write(level: PrivacyLogLevel, event: string, meta?: PrivacyLogMeta): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }

  const safeMeta = meta ? sanitizeMeta(meta) : undefined;
  const hasMeta = safeMeta && Object.keys(safeMeta).length > 0;
  const method = level === 'info' ? 'log' : level;

  if (hasMeta) {
    console[method](`[privacy] ${event}`, safeMeta);
    return;
  }

  console[method](`[privacy] ${event}`);
}

export function devPrivacyInfo(event: string, meta?: PrivacyLogMeta): void {
  write('info', event, meta);
}

export function devPrivacyWarn(event: string, meta?: PrivacyLogMeta): void {
  write('warn', event, meta);
}

export function devPrivacyError(event: string, meta?: PrivacyLogMeta): void {
  write('error', event, meta);
}

export function getPrivacySafeErrorReason(error: unknown): string {
  if (error instanceof Error) {
    return error.name || 'Error';
  }

  if (typeof error === 'string') {
    return 'Error';
  }

  if (error === null || error === undefined) {
    return 'unknown';
  }

  return typeof error;
}

export function getPrivacySafeHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return undefined;
  }

  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

export function sanitizeConsoleArg(value: unknown): unknown {
  if (value instanceof Error) {
    return { error: getPrivacySafeErrorReason(value) };
  }

  if (typeof value === 'string') {
    return truncate(redactSensitiveText(value));
  }

  if (Array.isArray(value)) {
    return `[redacted-array:${value.length}]`;
  }

  if (value && typeof value === 'object') {
    const constructorName = value.constructor?.name ?? 'Object';
    return `[redacted-${constructorName}]`;
  }

  return value;
}
