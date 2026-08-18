import { describe, expect, it } from 'vitest';

import {
  classifyModelDownloadNetwork,
  createLargeModelDownloadAuthorization,
  getModelDownloadNetworkType,
} from './modelDownloadConsent';

describe('local model download consent', () => {
  it('classifies Wi-Fi, metered, and unknown network states fail closed', async () => {
    expect(classifyModelDownloadNetwork({ type: 'WIFI', isConnected: true })).toBe('wifi');
    expect(classifyModelDownloadNetwork({ type: 'CELLULAR', isConnected: true })).toBe('metered');
    expect(classifyModelDownloadNetwork({ type: 'VPN', isConnected: true })).toBe('unknown');
    expect(classifyModelDownloadNetwork({ type: 'WIFI', isConnected: false })).toBe('unknown');
    await expect(getModelDownloadNetworkType(async () => {
      throw new Error('unavailable');
    })).resolves.toBe('unknown');
  });

  it('binds consent to the exact manifest, hash, size, time, and network choice', () => {
    expect(createLargeModelDownloadAuthorization({
      manifestId: 'manifest-v1',
      artifactSha256: 'A'.repeat(64),
      exactSizeBytes: 5_071_837_136,
    }, 'metered', true, new Date('2026-08-13T00:00:00.000Z'))).toEqual({
      manifestId: 'manifest-v1',
      artifactSha256: 'a'.repeat(64),
      acknowledgedSizeBytes: 5_071_837_136,
      consentedAt: '2026-08-13T00:00:00.000Z',
      networkType: 'metered',
      meteredNetworkAccepted: true,
    });
  });

  it('rejects incomplete download identity metadata', () => {
    expect(() => createLargeModelDownloadAuthorization({
      manifestId: 'manifest-v1',
      exactSizeBytes: 5_071_837_136,
    }, 'wifi', false)).toThrow('missing exact download identity');
  });
});
