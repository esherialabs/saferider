import { defineConfig } from 'vitest/config';
import fs from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(fs.readFileSync(new URL('./config/release/coverage-policy.v1.json', import.meta.url), 'utf8'));

export default defineConfig({
  resolve: {
    alias: {
      '@react-native-async-storage/async-storage': resolve(rootDir, 'src/test/mocks/asyncStorage.ts'),
    },
  },
  test: {
    clearMocks: true,
    environment: 'node',
    include: policy.criticalTypeScript.tests,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage/critical-safety-privacy',
      reporter: ['text', 'json-summary', 'lcov'],
      include: policy.criticalTypeScript.modules,
      thresholds: {
        ...policy.criticalTypeScript.minimumPercent,
        perFile: true,
      },
    },
  },
});
