import { describe, expect, it } from 'vitest';

import { loadPublicTunedArtifactRuntimeConfig } from '../tunedArtifactRuntimeConfig';

describe('public tuned artifact runtime config', () => {
  it('returns only the fail-closed public control state', () => {
    const config = loadPublicTunedArtifactRuntimeConfig(new Date('2026-08-10T12:00:00.000Z'));
    expect(config).toMatchObject({
      enabled: false,
      reasonCode: 'exact-artifact-physical-android-pending',
      activeManifestId: null,
      activeManifestSha256: null,
      rolloutPercent: 0,
      remoteDisableSupported: true,
      rollbackTargetManifestId: 'fail-closed:no-local-ai',
    });
    expect(JSON.stringify(config)).not.toMatch(/location|prompt|completion|path|url|token/i);
  });

  it('reports control expiry truthfully instead of retaining an activation reason', () => {
    expect(loadPublicTunedArtifactRuntimeConfig(new Date('2026-09-11T00:00:00.000Z'))).toMatchObject({
      enabled: false,
      reasonCode: 'controls-expired',
      activeManifestId: null,
      activeManifestSha256: null,
      rolloutPercent: 0,
    });
  });
});
