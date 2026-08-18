import { describe, expect, it } from 'vitest';

import {
  GEMMA_4_E2B_LITERTLM_PROTOTYPE_MANIFEST,
  SAFERIDE_GEMMA4_E2B_V03_TUNED_LITERTLM_EXPORT_BLOCKED_MANIFEST,
  SAFERIDE_GEMMA4_E2B_V058_ORIGINAL_419806_LITERTLM_ARTIFACT_PRODUCED_MANIFEST,
  getPrimaryModelArtifact,
  isManifestAudioTranscriptionRuntimeReady,
  type SafeRideLocalAiManifest,
  validateLocalAiManifest,
  validateTunedMobileArtifactManifest,
} from './modelManifest';

function cloneManifest(): SafeRideLocalAiManifest {
  return JSON.parse(JSON.stringify(GEMMA_4_E2B_LITERTLM_PROTOTYPE_MANIFEST)) as SafeRideLocalAiManifest;
}

describe('local assistant model manifest contract', () => {
  it('accepts the Gemma 4 E2B LiteRT-LM prototype manifest', () => {
    expect(validateLocalAiManifest(GEMMA_4_E2B_LITERTLM_PROTOTYPE_MANIFEST)).toEqual([]);
    expect(getPrimaryModelArtifact(GEMMA_4_E2B_LITERTLM_PROTOTYPE_MANIFEST)).toMatchObject({
      fileName: 'gemma-4-E2B-it.litertlm',
      format: 'litertlm',
      immutableRevision: '361a4010ad6d88fc5c86e148e333c0342b99763d',
      sha256: '181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c',
      sizeBytes: 2_588_147_712,
      controlledImportOnly: true,
    });
    expect(GEMMA_4_E2B_LITERTLM_PROTOTYPE_MANIFEST.rollout).toMatchObject({
      downloadMode: 'controlled-import',
      maxRolloutPercent: 0,
    });
  });

  it('rejects a LiteRT-LM manifest that points at GGUF or old adapter-shaped files', () => {
    const ggufManifest = cloneManifest();
    ggufManifest.artifacts[0] = {
      ...ggufManifest.artifacts[0],
      fileName: 'gemma-4-E2B-it.gguf',
      format: 'gguf',
    };

    expect(validateLocalAiManifest(ggufManifest)).toEqual(
      expect.arrayContaining([
        'litert-lm runtime requires .litertlm model files',
        'litert-lm runtime requires litertlm artifact format',
      ]),
    );

    const adapterManifest = cloneManifest();
    adapterManifest.artifacts[0] = {
      ...adapterManifest.artifacts[0],
      fileName: 'adapter_model.safetensors',
      format: 'safetensors',
    };

    expect(validateLocalAiManifest(adapterManifest)).toEqual(
      expect.arrayContaining([
        'litert-lm runtime requires .litertlm model files',
        'litert-lm runtime requires litertlm artifact format',
      ]),
    );
  });

  it('rejects traversal and unsafe local model identities', () => {
    const manifest = cloneManifest();
    manifest.manifestId = '../outside';
    manifest.modelId = 'approved/../outside';
    manifest.artifacts[0].fileName = '../model.litertlm';

    expect(validateLocalAiManifest(manifest)).toEqual(expect.arrayContaining([
      'manifestId must be a safe path component',
      'modelId must contain only safe path components',
      'primary artifact fileName must be a safe path component',
    ]));
  });

  it('does not allow app-download mode for controlled-import prototype artifacts', () => {
    const manifest = cloneManifest();
    manifest.artifacts[0].controlledImportOnly = true;
    manifest.rollout.downloadMode = 'app-download';

    expect(validateLocalAiManifest(manifest)).toContain(
      'app-download mode cannot use controlledImportOnly artifacts',
    );
  });

  it('does not allow audio transcription from model capability flags alone', () => {
    const manifest = cloneManifest();
    expect(isManifestAudioTranscriptionRuntimeReady(manifest)).toBe(false);

    manifest.capabilities.audioTranscription = {
      enabled: true,
      stage: 'controlled',
      evidenceRef: 'docs/qa/saferide-gemma-4-e2b-audio-transcription-gate-2026-06-29.md',
      limitations: ['Controlled synthetic-audio test only.'],
    };

    expect(isManifestAudioTranscriptionRuntimeReady(manifest)).toBe(false);
    expect(validateLocalAiManifest(manifest)).toContain(
      'audioTranscription enabled requires evidenceRef, privacyReviewDoc, physical Android load/offline proof, and a non-disabled LiteRT-LM audio backend',
    );

    if (manifest.runtime.kind === 'litert-lm') {
      manifest.runtime.acceleratorDefaults.audioBackend = 'gpu';
    }
    manifest.androidEvidence = {
      deviceMatrixDoc: 'docs/qa/saferide-gemma-4-e2b-audio-transcription-gate-2026-06-29.md',
      physicalDeviceProof: true,
      loadGenerateCancelUnload: true,
      offlineProof: true,
    };

    expect(isManifestAudioTranscriptionRuntimeReady(manifest)).toBe(true);
    expect(validateLocalAiManifest(manifest)).toEqual([]);
  });

  it('registers the v0.3 tuned mobile artifact blocker without inventing a .litertlm hash', () => {
    const manifest = SAFERIDE_GEMMA4_E2B_V03_TUNED_LITERTLM_EXPORT_BLOCKED_MANIFEST;

    expect(validateTunedMobileArtifactManifest(manifest)).toEqual([]);
    expect(manifest.manifestId).toBe(
      'saferide-gemma4-e2b-v03-mitigation-litertlm-export-blocked-2026-07-14.2',
    );
    expect(manifest.adapterModel).toBe('V-ince-18/saferide-gemma-4-e2b-lora');
    expect(manifest.adapterRevision).toBe('e6d135a385352749995b988691c037e88b42a230');
    expect(manifest.trainingRunId).toBe('saferide-gemma4-e2b-colab-v03-mitigation-lora-480step-20260704');
    expect(manifest.dataRegisterId).toBe(
      'docs/security/saferide-gemma4-colab-input-register.synthetic-v0.3.candidate.json',
    );
    expect(manifest.exportRunner).toBe('scripts/saferide-gemma4-tuned-litertlm-export.py');
    expect(manifest.exportRunbook).toBe(
      'docs/qa/saferide-gemma4-e2b-v03-tuned-litertlm-colab-export-runbook-2026-07-14.md',
    );
    expect(manifest.artifact).toMatchObject({
      fileName: 'saferide-gemma4-e2b-v03-mitigation.litertlm',
      format: 'litertlm',
      downloadMode: 'disabled',
      immutableLocation: null,
      sha256: null,
      sizeBytes: null,
    });
    expect(manifest.safetyReport).toMatchObject({
      summaryId: 'saferide-gemma4-e2b-v03-adapter-safety-2026-07-30.1',
    });
    expect(manifest.androidProof).toMatchObject({
      baseRuntimePhysicalDeviceProof: true,
      tunedArtifactPhysicalDeviceProof: false,
    });
    expect(manifest.rollbackTargetManifestId).toBe('fail-closed:no-local-ai');
  });

  it('registers the v0.5.8 exact artifact without making it selectable', () => {
    const manifest = SAFERIDE_GEMMA4_E2B_V058_ORIGINAL_419806_LITERTLM_ARTIFACT_PRODUCED_MANIFEST;

    expect(validateTunedMobileArtifactManifest(manifest)).toEqual([]);
    expect(manifest.status).toBe('artifact-produced');
    expect(manifest.adapterRevision).toBe('019dd8182883ad0721ffa70f4680d6977b7be99b');
    expect(manifest.artifact).toMatchObject({
      fileName: 'saferide-gemma4-e2b-v058-original-419806-runtime-compatible.litertlm',
      downloadMode: 'controlled-import',
      sha256: '8b73fd844464f220955eeedc474c30f39e621458c7a6b092de5afa2c3d027fcd',
      sizeBytes: 5_071_837_136,
    });
    expect(manifest.androidProof.tunedArtifactPhysicalDeviceProof).toBe(false);
    expect(manifest.approvals).toEqual({ legal: 'approved', safety: 'blocked', release: 'blocked' });
  });

  it('rejects unsafe tuned artifact identities before activation', () => {
    const manifest = JSON.parse(JSON.stringify(
      SAFERIDE_GEMMA4_E2B_V03_TUNED_LITERTLM_EXPORT_BLOCKED_MANIFEST,
    )) as typeof SAFERIDE_GEMMA4_E2B_V03_TUNED_LITERTLM_EXPORT_BLOCKED_MANIFEST;
    manifest.manifestId = '../outside';
    manifest.modelId = 'approved/../outside';
    manifest.artifact.fileName = '../model.litertlm';

    expect(validateTunedMobileArtifactManifest(manifest)).toEqual(expect.arrayContaining([
      'manifestId must be a safe path component',
      'modelId must contain only safe path components',
      'artifact fileName must be a safe path component',
    ]));
  });

  it('requires a real artifact hash and size before marking export produced', () => {
    const manifest = JSON.parse(
      JSON.stringify(SAFERIDE_GEMMA4_E2B_V03_TUNED_LITERTLM_EXPORT_BLOCKED_MANIFEST),
    );

    manifest.status = 'artifact-produced';
    manifest.stateHistory.push({
      state: 'artifact-produced',
      enteredAt: '2026-07-15T00:00:00.000Z',
      evidenceRefs: ['synthetic-artifact-evidence'],
    });
    manifest.exportPath.decision = 'merge-peft-then-export-litertlm';
    manifest.artifact.sha256 = null;
    manifest.artifact.sizeBytes = null;
    manifest.androidProof.tunedArtifactPhysicalDeviceProof = false;

    expect(validateTunedMobileArtifactManifest(manifest)).toEqual(
      expect.arrayContaining([
        'artifact-produced manifests require a 64-character artifact SHA-256',
        'artifact-produced manifests require a positive artifact size',
      ]),
    );
  });

  it('fails closed when pending legal evidence is paired with app download', () => {
    const manifest = cloneManifest();
    manifest.artifacts[0].controlledImportOnly = false;
    manifest.rollout.downloadMode = 'app-download';
    manifest.rollout.maxRolloutPercent = 100;

    expect(validateLocalAiManifest(manifest)).toEqual(expect.arrayContaining([
      'pending or blocked legal status requires controlled-import or disabled rollout',
      'pending or blocked legal status requires maxRolloutPercent=0',
    ]));
  });
});
