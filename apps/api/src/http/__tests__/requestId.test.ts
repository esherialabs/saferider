import { describe, expect, it } from 'vitest';

import { isSafeRequestId, resolveRequestId } from '../requestId.js';

describe('request ID boundary', () => {
  const generated = 'server-generated-request-id';

  it('preserves short identifiers made only from the approved character set', () => {
    expect(resolveRequestId('trace-01:span_02.example', () => generated)).toBe('trace-01:span_02.example');
  });

  it.each([
    '',
    'survivor narrative must not enter logs',
    'exact/location/value',
    'line\nbreak',
    '<script>',
    'éxternal-id',
    `a${'b'.repeat(96)}`,
  ])('replaces unsafe client input instead of returning or persisting it: %j', value => {
    expect(isSafeRequestId(value)).toBe(false);
    expect(resolveRequestId(value, () => generated)).toBe(generated);
  });

  it('rejects duplicate header arrays rather than choosing an ambiguous client value', () => {
    expect(resolveRequestId(['first', 'second'], () => generated)).toBe(generated);
  });
});
