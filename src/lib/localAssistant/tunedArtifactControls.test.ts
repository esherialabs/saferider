import { describe, expect, it } from 'vitest';

import { SAFERIDE_GEMMA4_E2B_V058_ORIGINAL_419806_LITERTLM_ARTIFACT_PRODUCED_MANIFEST } from './modelManifest';
import {
  TUNED_ARTIFACT_CONTROLS,
  TUNED_ARTIFACT_CONTROLS_SHA256,
  evaluateTunedArtifactActivation,
  validateTunedArtifactControls,
  type TunedArtifactControls,
} from './tunedArtifactControls';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('tuned artifact controls', () => {
  it('loads the shared controls and keeps the current tuned artifact disabled', () => {
    expect(validateTunedArtifactControls(TUNED_ARTIFACT_CONTROLS)).toEqual([]);
    const decision = evaluateTunedArtifactActivation({
      controls: TUNED_ARTIFACT_CONTROLS,
      manifest: SAFERIDE_GEMMA4_E2B_V058_ORIGINAL_419806_LITERTLM_ARTIFACT_PRODUCED_MANIFEST,
      manifestSha256: '0'.repeat(64),
      appVersion: '1.0.0',
      cohortBucket: 0,
      now: new Date('2026-07-30T00:00:00.000Z'),
    });
    expect(decision).toMatchObject({
      enabled: false,
      reason: 'controls-disabled',
      rollbackTargetManifestId: 'fail-closed:no-local-ai',
    });
  });

  it('rejects a control mutation that enables fallback', () => {
    const controls = clone(TUNED_ARTIFACT_CONTROLS) as TunedArtifactControls;
    (controls.selection as { silentFallbackAllowed: boolean }).silentFallbackAllowed = true;
    expect(validateTunedArtifactControls(controls)).toContain(
      'tuned artifact selection must forbid fallback and require a bundled manifest ID',
    );
  });

  it('requires the exact shared policy hash even after all external gates are represented as approved', () => {
    const controls = clone(TUNED_ARTIFACT_CONTROLS) as TunedArtifactControls;
    const manifest = clone(SAFERIDE_GEMMA4_E2B_V058_ORIGINAL_419806_LITERTLM_ARTIFACT_PRODUCED_MANIFEST);
    controls.activation.enabled = true;
    controls.download.enabled = true;
    controls.activation.activeManifestId = manifest.manifestId;
    controls.activation.activeManifestSha256 = 'a'.repeat(64);
    controls.activation.rolloutPercent = 100;
    controls.approvals = { legal: 'approved', safety: 'approved', release: 'approved' };
    manifest.controlPolicy.sha256 = 'b'.repeat(64);

    expect(evaluateTunedArtifactActivation({
      controls,
      manifest,
      manifestSha256: 'a'.repeat(64),
      appVersion: '1.0.0',
      cohortBucket: 0,
      now: new Date('2026-07-30T00:00:00.000Z'),
    }).enabled).toBe(false);
    expect(manifest.controlPolicy.sha256).not.toBe(TUNED_ARTIFACT_CONTROLS_SHA256);
  });
});
