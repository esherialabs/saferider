import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@react-native-async-storage/async-storage': resolve(rootDir, 'src/test/mocks/asyncStorage.ts'),
    },
  },
  test: {
    clearMocks: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'apps/api/src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
