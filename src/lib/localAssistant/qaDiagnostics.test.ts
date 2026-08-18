import { describe, expect, it } from 'vitest';

import { createTunedArtifactQaDiagnostic } from './qaDiagnostics';

describe('tuned artifact QA diagnostics', () => {
  it('keeps exact public artifact identity and content-free runtime state', () => {
    const diagnostic = createTunedArtifactQaDiagnostic({
      manifestId: 'synthetic-tuned-manifest',
      artifactSha256: 'A'.repeat(64),
      bridgeStatus: {
        state: 'loaded',
        nativeAvailable: true,
        runtimeAvailable: true,
        mockMode: false,
        artifactValidated: true,
        realRuntimeLoaded: true,
        lastErrorMessage: 'must never be copied',
      },
      deviceClass: 'android-6-8gb',
      timings: { loadMs: 1234, firstTokenMs: 200, totalGenerationMs: 800 },
      resultStatus: 'passed',
      capturedAt: new Date('2026-07-30T00:00:00.000Z'),
    });

    expect(diagnostic).toMatchObject({
      artifactSha256: 'a'.repeat(64),
      artifactValidated: true,
      realRuntimeLoaded: true,
      result: { status: 'passed', errorCode: null },
    });
    const serialized = JSON.stringify(diagnostic);
    expect(serialized).not.toMatch(/prompt|completion|path|message|narrative|location/i);
  });

  it('normalizes codes and discards invalid timing values without copying arbitrary input', () => {
    const diagnostic = createTunedArtifactQaDiagnostic({
      manifestId: 'synthetic-tuned-manifest',
      artifactSha256: 'b'.repeat(64),
      bridgeStatus: {
        state: 'error',
        nativeAvailable: true,
        runtimeAvailable: true,
        mockMode: false,
        lastErrorCode: 'checksum mismatch: /private/path',
      },
      deviceClass: 'android-unknown',
      timings: { loadMs: -1, firstTokenMs: Number.NaN },
      resultStatus: 'failed',
    });
    expect(diagnostic.timings).toEqual({ loadMs: null, firstTokenMs: null, totalGenerationMs: null });
    expect(diagnostic.result.errorCode).toBe('CHECKSUM_MISMATCH___PRIVATE_PATH');
    expect(diagnostic).not.toHaveProperty('lastErrorMessage');
  });
});
