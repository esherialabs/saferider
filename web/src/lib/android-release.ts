import release from '../../public/releases/saferide-v0.5.8-android.json';

export const ANDROID_RELEASE = release;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${bytes.toLocaleString('en-US')} bytes`;
}
