import { mergeConfig } from 'vitest/config';
import fs from 'node:fs';

import baseConfig from './vitest.config.mjs';

const policy = JSON.parse(fs.readFileSync(new URL('./config/release/coverage-policy.v1.json', import.meta.url), 'utf8'));

export default mergeConfig(baseConfig, {
  test: {
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage/all-source',
      reporter: ['text', 'json-summary', 'lcov'],
      include: policy.global.include,
      exclude: policy.global.exclude,
      thresholds: policy.global.minimumPercent,
    },
  },
});
