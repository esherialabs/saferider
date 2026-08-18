import { getRuntimeConfigSnapshot } from '../../config/runtime/runtimeConfigStore';

export interface RequestOptions {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: any;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ApiErrorPayload {
  code?: string;
  message?: string;
  details?: unknown;
}

export class ApiError extends Error {
  status: number | undefined;
  code?: string;
  details?: unknown;

  constructor(message: string, init: { status?: number; code?: string; details?: unknown } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
  }
}

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const trimmedPath = path.startsWith('/') ? path.slice(1) : path;
  const runtimeConfig = getRuntimeConfigSnapshot();
  const url = new URL(trimmedPath, ensureTrailingSlash(runtimeConfig.apiBaseUrl));

  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      url.searchParams.append(key, String(value));
    });
  }

  return url.toString();
}

function ensureTrailingSlash(base: string): string {
  return base.endsWith('/') ? base : `${base}/`;
}

function resolveTimeout(timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timeoutId),
  };
}

function isJsonLike(body: unknown): body is Record<string, unknown> | Array<unknown> {
  if (!body) return false;
  if (typeof body === 'string') return false;
  if (typeof body === 'number' || typeof body === 'boolean') return false;
  if (body instanceof FormData || body instanceof ArrayBuffer) return false;
  if (body instanceof Blob) return false;
  return true;
}

export async function request<T = unknown>(options: RequestOptions): Promise<T> {
  const { path, method = 'GET', query, body, headers = {}, timeoutMs, signal } = options;
  const url = buildUrl(path, query);

  const finalHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...headers,
  };

  let bodyToSend: BodyInit | undefined;
  if (body !== undefined && body !== null) {
    if (body instanceof FormData || body instanceof Blob || body instanceof ArrayBuffer) {
      bodyToSend = body as BodyInit;
    } else if (typeof body === 'string') {
      finalHeaders['Content-Type'] = finalHeaders['Content-Type'] ?? 'application/json';
      bodyToSend = body;
    } else if (isJsonLike(body)) {
      finalHeaders['Content-Type'] = finalHeaders['Content-Type'] ?? 'application/json';
      bodyToSend = JSON.stringify(body);
    } else {
      bodyToSend = body as BodyInit;
    }
  }

  if (authToken) {
    finalHeaders.Authorization = `Bearer ${authToken}`;
  }

  const timeout = resolveTimeout(timeoutMs ?? getRuntimeConfigSnapshot().apiTimeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers: finalHeaders,
      body: bodyToSend,
      signal: mergeSignals(signal, timeout.signal),
    });

    if (!response.ok) {
      await throwApiError(response);
    }

    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return undefined as T;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return (await response.json()) as T;
    }

    const text = await response.text();
    return text as unknown as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('Request timed out', { code: 'timeout' });
    }
    throw error;
  } finally {
    timeout.cancel();
  }
}

async function throwApiError(response: Response): Promise<never> {
  let payload: ApiErrorPayload | undefined;

  try {
    if (response.headers.get('content-type')?.includes('application/json')) {
      payload = await response.json();
    } else {
      const message = await response.text();
      payload = { message };
    }
  } catch {
    payload = { message: response.statusText };
  }

  throw new ApiError(payload?.message ?? 'Request failed', {
    status: response.status,
    code: payload?.code,
    details: payload?.details,
  });
}

function mergeSignals(primary: AbortSignal | undefined, secondary: AbortSignal): AbortSignal {
  if (!primary) return secondary;
  if ((primary as any).aborted) return primary;

  const controller = new AbortController();

  const abort = () => controller.abort();

  primary.addEventListener('abort', abort);
  secondary.addEventListener('abort', abort);

  if (primary.aborted || secondary.aborted) {
    controller.abort();
  }

  return controller.signal;
}
