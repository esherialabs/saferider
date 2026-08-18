import { vi } from 'vitest';

const storage = new Map<string, string>();

const asyncStorageMock = {
  getItem: vi.fn(async (key: string) => storage.get(key) ?? null),

  setItem: vi.fn(async (key: string, value: string) => {
    storage.set(key, value);
  }),

  removeItem: vi.fn(async (key: string) => {
    storage.delete(key);
  }),

  getAllKeys: vi.fn(async () => Array.from(storage.keys())),

  multiGet: vi.fn(async (keys: readonly string[]) => (
    keys.map((key): [string, string | null] => [key, storage.get(key) ?? null])
  )),

  multiRemove: vi.fn(async (keys: readonly string[]) => {
    keys.forEach((key) => storage.delete(key));
  }),

  multiSet: vi.fn(async (pairs: readonly (readonly [string, string])[]) => {
    pairs.forEach(([key, value]) => storage.set(key, value));
  }),

  clear: vi.fn(async () => {
    storage.clear();
  }),

  __reset: () => {
    storage.clear();
  },

  __dump: () => new Map(storage),
};

export default asyncStorageMock;
