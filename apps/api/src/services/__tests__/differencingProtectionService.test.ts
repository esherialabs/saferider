import { describe, expect, it } from 'vitest';

import { buildVerifiedStoredRsiRelease } from '../differencingProtectionService.js';
import { buildSuppressedRsiRelease } from '../privacySuppressionService.js';

describe('immutable RSI release verification', () => {
  it('reconstructs the exact release and rejects altered values or revisions', () => {
    const { release } = buildSuppressedRsiRelease([
      { areaId: 'cell-100-100', timeBucket: '2026-07-30T10:00:00.000Z', category: 'harassment', rawCount: 15 },
    ], {
      releaseId: '11111111-1111-4111-8111-111111111111', viewId: 'rsi-fixed-grid-v1', minimumCount: 10,
      differentialPrivacy: { status: 'not_approved' },
    });
    expect(buildVerifiedStoredRsiRelease({
      releaseId: release.releaseId, viewId: release.viewId,
      storedRevisionSha256: release.revisionSha256, cells: release.cells,
    })).toEqual(release);
    expect(() => buildVerifiedStoredRsiRelease({
      releaseId: release.releaseId, viewId: release.viewId,
      storedRevisionSha256: 'a'.repeat(64), cells: release.cells,
    })).toThrow(/does not match/);
  });

  it('preserves empty and fully suppressed no-data releases', () => {
    for (const rows of [
      [],
      [{ areaId: 'cell-100-100', timeBucket: '2026-07-30T10:00:00.000Z', category: 'harassment', rawCount: 1 }],
    ]) {
      const { release } = buildSuppressedRsiRelease(rows, {
        releaseId: '22222222-2222-4222-8222-222222222222',
        viewId: 'rsi-fixed-grid-v1',
        minimumCount: 10,
        differentialPrivacy: { status: 'not_approved' },
      });
      expect(buildVerifiedStoredRsiRelease({
        releaseId: release.releaseId,
        viewId: release.viewId,
        storedRevisionSha256: release.revisionSha256,
        cells: release.cells,
      }).state).toBe('no_data');
    }
  });

  it('rejects suppressed values, misleading labels, and malformed revision hashes', () => {
    const base = {
      releaseId: '33333333-3333-4333-8333-333333333333',
      viewId: 'rsi-fixed-grid-v1',
      storedRevisionSha256: 'not-a-hash',
    };
    expect(() => buildVerifiedStoredRsiRelease({
      ...base,
      cells: [{
        areaId: 'cell-100-100',
        timeBucket: '2026-07-30T10:00:00.000Z',
        category: 'harassment',
        state: 'suppressed',
        display: 'No data',
        value: 1,
      } as never],
    })).toThrow(/cannot expose/);
    expect(() => buildVerifiedStoredRsiRelease({
      ...base,
      cells: [{
        areaId: 'cell-100-100',
        timeBucket: '2026-07-30T10:00:00.000Z',
        category: 'harassment',
        state: 'suppressed',
        display: 'Hidden',
      } as never],
    })).toThrow(/cannot expose/);
    expect(() => buildVerifiedStoredRsiRelease({ ...base, cells: [] })).toThrow(/missing or does not match/);
  });
});
