import { randomUUID } from 'node:crypto';

const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;

export function isSafeRequestId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_REQUEST_ID.test(value);
}

export function resolveRequestId(
  headerValue: string | string[] | undefined,
  generate: () => string = randomUUID,
): string {
  return isSafeRequestId(headerValue) ? headerValue : generate();
}
