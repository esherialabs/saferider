import assert from 'node:assert/strict';
import test from 'node:test';

import { validateRsiPrivacy } from '../saferide-rsi-privacy-check.mjs';

test('RSI controls, schemas, migration, routes, and suppression gates validate', async () => {
  const result = await validateRsiPrivacy();
  assert.equal(result.controlVersion, 'rsi-privacy-controls.2026-07-30.1');
  assert.equal(result.syntheticMinimumCount, 10);
  assert.ok(result.checks >= 35);
});
