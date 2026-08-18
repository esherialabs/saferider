import { afterEach, describe, expect, it } from 'vitest';

import { formatDraftLocalDate, formatDraftLocalTime } from '../reportDateTime';

const originalTimezone = process.env.TZ;

afterEach(() => {
  if (originalTimezone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTimezone;
  }
});

describe('report date/time formatting', () => {
  it('stores the selected local day and time instead of UTC slices', () => {
    process.env.TZ = 'Africa/Nairobi';
    const selectedLocalTime = new Date(2026, 5, 6, 0, 30);

    expect(selectedLocalTime.toISOString().slice(0, 10)).toBe('2026-06-05');
    expect(formatDraftLocalDate(selectedLocalTime)).toBe('2026-06-06');
    expect(formatDraftLocalTime(selectedLocalTime)).toBe('00:30');
  });
});
