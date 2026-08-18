import { describe, expect, it } from 'vitest';

import type { DraftData } from '../draftStorage';
import {
  buildAnonymousSignals,
  DISABLED_ANONYMOUS_SIGNAL_CONFIG,
  getAnonymousSignalForbiddenPaths,
  type AnonymousSignalConfig,
} from '../anonymousSignal';

const draft: DraftData = {
  id: 'synthetic-draft',
  createdAt: new Date('2026-07-30T00:00:00Z'),
  updatedAt: new Date('2026-07-30T00:00:00Z'),
  incidentDescription: 'synthetic narrative that must not leave the builder',
  textEvidence: 'synthetic evidence that must not leave the builder',
  location: { coordinates: { latitude: -1.2864, longitude: 36.8172 }, address: 'synthetic exact address' },
  datetime: { date: '2026-07-30', time: '10:37', accuracy: 'approximate' },
  selectedTags: ['harassment', 'unapproved-free-text'],
  mediaFiles: [],
};

const approvedConfig: AnonymousSignalConfig = {
  enabled: true,
  configVersion: 'synthetic-approved-test-only',
  policyVersion: 'synthetic-approved-test-only',
  consentVersion: 'synthetic-consent-v1',
  areaDefinitionVersion: 'synthetic-area-v1',
  privacyApprovalId: 'synthetic-test-approval',
  cellSizeDegrees: 0.05,
  timeBucketMinutes: 60,
  allowedAreaIds: ['cell-1774-4336'],
  allowedCategories: ['harassment'],
};

describe('anonymous signal minimization', () => {
  it('fails closed under the repository default configuration', () => {
    expect(() => buildAnonymousSignals(draft, DISABLED_ANONYMOUS_SIGNAL_CONFIG)).toThrow(/disabled pending privacy approval/);
  });

  it('transforms exact coordinates and time into one approved signal per controlled category', () => {
    const signals = buildAnonymousSignals(draft, approvedConfig);
    expect(signals).toEqual([{
      schemaVersion: '1.0',
      configVersion: approvedConfig.configVersion,
      policyVersion: approvedConfig.policyVersion,
      consentVersion: approvedConfig.consentVersion,
      area: { type: 'coarse_cell', id: 'cell-1774-4336' },
      timeBucket: '2026-07-30T10:00:00.000Z',
      category: 'harassment',
    }]);
    expect(getAnonymousSignalForbiddenPaths(signals)).toEqual([]);
    expect(JSON.stringify(signals)).not.toContain('synthetic narrative');
    expect(JSON.stringify(signals)).not.toContain('36.8172');
    expect(JSON.stringify(signals)).not.toContain('synthetic-draft');
  });

  it('rejects unsafe spatial/time parameters and unapproved derived cells', () => {
    expect(() => buildAnonymousSignals(draft, { ...approvedConfig, cellSizeDegrees: 0.001 })).toThrow(/cell size/);
    expect(() => buildAnonymousSignals(draft, { ...approvedConfig, timeBucketMinutes: 7 })).toThrow(/time bucket/);
    expect(() => buildAnonymousSignals(draft, { ...approvedConfig, allowedAreaIds: [] })).toThrow(/approved area/);
  });
});
