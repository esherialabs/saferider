const MAX_IDENTITY_LENGTH = 200;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isSafeModelPathSegment(value: string | null | undefined): value is string {
  return Boolean(
    value
    && value.length <= MAX_IDENTITY_LENGTH
    && SAFE_PATH_SEGMENT.test(value)
    && value !== '.'
    && value !== '..',
  );
}

export function isSafeNamespacedModelId(value: string | null | undefined): value is string {
  return Boolean(
    value
    && value.length <= MAX_IDENTITY_LENGTH
    && value.split('/').every(isSafeModelPathSegment),
  );
}

export function isSafeRelativeModelPath(value: string | null | undefined): value is string {
  return Boolean(
    value
    && value.length <= MAX_IDENTITY_LENGTH * 2
    && !value.startsWith('/')
    && !value.endsWith('/')
    && value.split('/').every(isSafeModelPathSegment),
  );
}

export function hasUnsafeModelPathTraversal(value: string): boolean {
  return value.includes('\\')
    || value.includes('%')
    || value.split('/').some(segment => segment === '.' || segment === '..');
}
