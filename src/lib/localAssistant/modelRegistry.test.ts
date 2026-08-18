import { describe, expect, it } from 'vitest';

import {
  SAFERIDE_GEMMA4_E2B_V03_TUNED_LITERTLM_EXPORT_BLOCKED_MANIFEST,
  SAFERIDE_GEMMA4_E2B_V058_ORIGINAL_419806_LITERTLM_ARTIFACT_PRODUCED_MANIFEST,
  TUNED_MOBILE_ARTIFACT_LIFECYCLE,
} from './modelManifest';
import { TUNED_ARTIFACT_CONTROLS, type TunedArtifactControls } from './tunedArtifactControls';
import {
  ALL_LOCAL_MODELS,
  buildQaTunedArtifactRuntimeConfig,
  GEMMA_4_E2B_LITERTLM_CONFIG,
  formatApproximateModelSize,
  getLocalModelArtifactBlocker,
  isLocalModelAppReady,
  isRetiredLocalModelId,
  resolveLocalModelConfig,
  resolveTunedArtifactRuntimeCandidate,
} from './modelRegistry';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('local assistant model registry', () => {
  it('uses the Gemma 4 E2B LiteRT-LM target as the only app runtime entry', () => {
    const model = resolveLocalModelConfig(undefined);

    expect(model).toBe(GEMMA_4_E2B_LITERTLM_CONFIG);
    expect(ALL_LOCAL_MODELS).toEqual([GEMMA_4_E2B_LITERTLM_CONFIG]);
    expect(model.runtime.kind).toBe('litert-lm');
    expect(model.runtime.modelFileName).toBe('gemma-4-E2B-it.litertlm');
    expect(model.files).toHaveLength(1);
    expect(model.files[0]).toMatchObject({
      fileName: 'gemma-4-E2B-it.litertlm',
      sha256: '181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c',
      sizeBytes: 2_588_147_712,
      downloadMode: 'controlled-import',
    });
    expect(model.label).toBe('SafeRide local AI');
    expect(model.capabilities.textGeneration).toBe(false);
    expect(isLocalModelAppReady(model)).toBe(false);
    expect(getLocalModelArtifactBlocker(model)).toContain('not ready for SafeRide mobile release');
  });

  it('does not expose the blocked v0.3 tuned manifest as an app runtime entry', () => {
    expect(ALL_LOCAL_MODELS.map(model => model.manifestId)).not.toContain(
      SAFERIDE_GEMMA4_E2B_V03_TUNED_LITERTLM_EXPORT_BLOCKED_MANIFEST.manifestId,
    );
    const resolved = resolveLocalModelConfig(
      SAFERIDE_GEMMA4_E2B_V03_TUNED_LITERTLM_EXPORT_BLOCKED_MANIFEST.manifestId,
    );
    expect(resolved).not.toBe(GEMMA_4_E2B_LITERTLM_CONFIG);
    expect(resolved.capabilities.textGeneration).toBe(false);
    expect(getLocalModelArtifactBlocker(resolved)).toContain('not registered');
  });

  it('does not expose the artifact-produced v0.5.8 manifest before Android and approval gates', () => {
    expect(ALL_LOCAL_MODELS.map(model => model.manifestId)).not.toContain(
      SAFERIDE_GEMMA4_E2B_V058_ORIGINAL_419806_LITERTLM_ARTIFACT_PRODUCED_MANIFEST.manifestId,
    );
    const resolved = resolveLocalModelConfig(
      SAFERIDE_GEMMA4_E2B_V058_ORIGINAL_419806_LITERTLM_ARTIFACT_PRODUCED_MANIFEST.manifestId,
    );
    expect(resolved).not.toBe(GEMMA_4_E2B_LITERTLM_CONFIG);
    expect(getLocalModelArtifactBlocker(resolved)).toContain('not registered');
  });

  it('builds the exact artifact-produced v0.5.8 config only for controlled QA', () => {
    const config = buildQaTunedArtifactRuntimeConfig(
      SAFERIDE_GEMMA4_E2B_V058_ORIGINAL_419806_LITERTLM_ARTIFACT_PRODUCED_MANIFEST,
      'd3ce2105a1d496cd52b0a59701da103ac8f20295145ac5094320f46591b511c9',
    );
    expect(config).toMatchObject({
      qaOnly: true,
      devOnly: true,
      lifecycleStatus: 'artifact-produced',
      rolloutDownloadMode: 'app-download',
      capabilities: { textGeneration: true, audioTranscription: false, offenceTagging: false },
      files: [{
        fileName: 'saferide-gemma4-e2b-v058-original-419806-runtime-compatible.litertlm',
        sizeBytes: 5_071_837_136,
        sha256: '8b73fd844464f220955eeedc474c30f39e621458c7a6b092de5afa2c3d027fcd',
      }],
    });

    const changedArtifact = clone(
      SAFERIDE_GEMMA4_E2B_V058_ORIGINAL_419806_LITERTLM_ARTIFACT_PRODUCED_MANIFEST,
    );
    changedArtifact.artifact.sizeBytes = Number(changedArtifact.artifact.sizeBytes) + 1;
    expect(buildQaTunedArtifactRuntimeConfig(
      changedArtifact,
      'd3ce2105a1d496cd52b0a59701da103ac8f20295145ac5094320f46591b511c9',
    )).toBeNull();
    expect(buildQaTunedArtifactRuntimeConfig(
      SAFERIDE_GEMMA4_E2B_V058_ORIGINAL_419806_LITERTLM_ARTIFACT_PRODUCED_MANIFEST,
      '0'.repeat(64),
    )).toBeNull();
  });

  it('returns no fallback runtime candidate while tuned controls are disabled', () => {
    const result = resolveTunedArtifactRuntimeCandidate({
      manifest: SAFERIDE_GEMMA4_E2B_V058_ORIGINAL_419806_LITERTLM_ARTIFACT_PRODUCED_MANIFEST,
      manifestSha256: '0'.repeat(64),
      controls: TUNED_ARTIFACT_CONTROLS,
      appVersion: '1.0.0',
      cohortBucket: 0,
      now: new Date('2026-07-30T00:00:00.000Z'),
    });
    expect(result.config).toBeNull();
    expect(result.decision.reason).toBe('controls-disabled');
    expect(result.config).not.toBe(GEMMA_4_E2B_LITERTLM_CONFIG);
  });

  it('builds only an exact hash-bound release-ready manifest and rejects its revocation', () => {
    const manifest = clone(SAFERIDE_GEMMA4_E2B_V058_ORIGINAL_419806_LITERTLM_ARTIFACT_PRODUCED_MANIFEST);
    const controls = clone(TUNED_ARTIFACT_CONTROLS) as TunedArtifactControls;
    manifest.status = 'release-ready';
    manifest.stateHistory = TUNED_MOBILE_ARTIFACT_LIFECYCLE.slice(0, 8).map((state, index) => ({
      state,
      enteredAt: `2026-07-${String(4 + index).padStart(2, '0')}T00:00:00.000Z`,
      evidenceRefs: [`synthetic-${state}`],
    }));
    manifest.exportPath.decision = 'merge-peft-then-export-litertlm';
    delete manifest.exportPath.blocker;
    manifest.exportTooling.exporterRepositoryRevision = 'a'.repeat(40);
    manifest.exportTooling.pythonVersion = '3.11.9';
    manifest.exportTooling.packages = { 'litert-lm': '0.9.0' };
    manifest.exportTooling.tokenizer.metadataSha256 = 'b'.repeat(64);
    manifest.deviceRequirements.minRamGb = 6;
    manifest.deviceRequirements.storageRequiredBytes = 2048;
    manifest.artifact = {
      ...manifest.artifact,
      downloadMode: 'app-download',
      immutableLocation: 'https://artifacts.example/immutable/tuned.litertlm',
      sha256: 'c'.repeat(64),
      sizeBytes: 1024,
      fileInventoryRef: 'private://inventory/tuned-v1',
    };
    manifest.attestation = {
      status: 'approved',
      processId: 'organization-artifact-attestation-v1',
      attestationRef: 'private://attestation/tuned-v1',
      approverRole: 'release approver',
      approvedAt: '2026-07-12T00:00:00.000Z',
    };
    manifest.androidProof.tunedArtifactPhysicalDeviceProof = true;
    manifest.androidProof.deviceEvidenceId = 'synthetic-device-evidence';
    manifest.androidProof.deviceEvidenceRef = 'private://device/tuned-v1';
    manifest.approvals = { legal: 'approved', safety: 'approved', release: 'approved' };

    controls.activation.enabled = true;
    controls.download.enabled = true;
    controls.activation.activeManifestId = manifest.manifestId;
    controls.activation.activeManifestSha256 = 'd'.repeat(64);
    controls.activation.rolloutPercent = 100;
    controls.approvals = { legal: 'approved', safety: 'approved', release: 'approved' };

    const result = resolveTunedArtifactRuntimeCandidate({
      manifest,
      manifestSha256: 'd'.repeat(64),
      controls,
      appVersion: '1.0.0',
      cohortBucket: 99,
      now: new Date('2026-07-30T00:00:00.000Z'),
    });
    expect(result.decision.enabled).toBe(true);
    expect(result.config).toMatchObject({
      id: manifest.modelId,
      manifestId: manifest.manifestId,
      capabilities: { textGeneration: true },
      files: [{ sha256: 'c'.repeat(64), sizeBytes: 1024 }],
    });

    controls.activation.revokedArtifactSha256 = ['c'.repeat(64)];
    const revoked = resolveTunedArtifactRuntimeCandidate({
      manifest,
      manifestSha256: 'd'.repeat(64),
      controls,
      appVersion: '1.0.0',
      cohortBucket: 0,
      now: new Date('2026-07-30T00:00:00.000Z'),
    });
    expect(revoked.config).toBeNull();
    expect(revoked.decision.reason).toBe('artifact-revoked');
  });

  it('recognizes the Gemma 4 E2B aliases, manifest id, and file name', () => {
    expect(resolveLocalModelConfig('litert-community/gemma-4-E2B-it-litert-lm')).toBe(GEMMA_4_E2B_LITERTLM_CONFIG);
    expect(resolveLocalModelConfig('gemma-4-e2b-it')).toBe(GEMMA_4_E2B_LITERTLM_CONFIG);
    expect(resolveLocalModelConfig('gemma-4-e2b')).toBe(GEMMA_4_E2B_LITERTLM_CONFIG);
    expect(resolveLocalModelConfig('https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/')).toBe(
      GEMMA_4_E2B_LITERTLM_CONFIG,
    );
    expect(resolveLocalModelConfig('litert-community-gemma-4-e2b-litertlm-prototype-2026-06-29.1')).toBe(
      GEMMA_4_E2B_LITERTLM_CONFIG,
    );
    expect(resolveLocalModelConfig('gemma-4-E2B-it.litertlm')).toBe(GEMMA_4_E2B_LITERTLM_CONFIG);
  });

  it('fails old Qwen, Gemma 2, Gemma 3n, and GGUF ids closed to Gemma 4 LiteRT-LM', () => {
    const legacyIds = [
      'Qwen2.5-3B-Instruct-q4f16_1-MLC',
      'saferide-qwen2.5-3b-q4-k-m-gguf',
      'gemma-2-2b-it-q4f16_1-MLC',
      'saferide-gemma-2-2b-it-q4-k-m-gguf',
      'esherialabs/saferide-gemma-3n',
      'saferide-gemma-3n',
      'https://huggingface.co/esherialabs/saferide-gemma-3n/',
      'base-gemma-3n-e4b-it',
      'base-gemma-3n-e4b-it-gguf',
      'unsloth/gemma-3n-E4B-it-GGUF/UD-IQ2_XXS',
    ];

    for (const id of legacyIds) {
      expect(isRetiredLocalModelId(id)).toBe(true);
      const resolved = resolveLocalModelConfig(id);
      expect(resolved).not.toBe(GEMMA_4_E2B_LITERTLM_CONFIG);
      expect(resolved.capabilities.textGeneration).toBe(false);
      expect(getLocalModelArtifactBlocker(resolved)).toContain('retired');
    }
  });

  it('does not turn legacy GGUF metadata into an app-ready entry', () => {
    const model = resolveLocalModelConfig('esherialabs/saferide-gemma-3n', {
      fileName: 'saferide-gemma-3n-Q4_K_M.gguf',
      downloadUrl:
        'https://huggingface.co/esherialabs/saferide-gemma-3n/resolve/abc123/saferide-gemma-3n-Q4_K_M.gguf?download=true',
      sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      sizeBytes: 2_400_000_000,
      contextWindow: 4096,
      gpuLayers: 1,
      vramRequiredMb: 4096,
    });

    expect(model).not.toBe(GEMMA_4_E2B_LITERTLM_CONFIG);
    expect(model.runtime.kind).toBe('litert-lm');
    expect(model.files[0].fileName).toBe('gemma-4-E2B-it.litertlm');
    expect(isLocalModelAppReady(model)).toBe(false);
    expect(getLocalModelArtifactBlocker(model)).toContain('retired');
  });

  it('fails unknown model ids closed to the active Gemma 4 E2B target', () => {
    expect(isRetiredLocalModelId('unknown-dev-model')).toBe(false);
    const resolved = resolveLocalModelConfig('unknown-dev-model');
    expect(resolved).not.toBe(GEMMA_4_E2B_LITERTLM_CONFIG);
    expect(resolved.capabilities.textGeneration).toBe(false);
    expect(getLocalModelArtifactBlocker(resolved)).toContain('not registered');
  });

  it('formats the active model download size for UI copy', () => {
    expect(formatApproximateModelSize(GEMMA_4_E2B_LITERTLM_CONFIG)).toBe('2.4 GB');
  });
});
