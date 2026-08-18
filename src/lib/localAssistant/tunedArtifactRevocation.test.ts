import { describe, expect, it } from 'vitest';

import type { TunedArtifactRuntimeSnapshot } from '../../config/runtime/runtimeConfigStore';
import type { LocalModelConfig } from './modelRegistry';
import { tunedArtifactRemovalReason } from './tunedArtifactRevocation';

const config: LocalModelConfig = {
  id: 'synthetic-tuned-model',
  label: 'Synthetic tuned model',
  variant: 'synthetic/tuned',
  providerFamily: 'gemma',
  manifestId: 'synthetic-tuned-manifest',
  manifestSha256: 'b'.repeat(64),
  lifecycleStatus: 'release-ready',
  rolloutDownloadMode: 'app-download',
  runtime: {
    kind: 'litert-lm',
    modelId: 'synthetic-tuned-model',
    modelFileName: 'synthetic.litertlm',
    contextWindow: 128,
    maxOutputTokens: 32,
    backendPlan: ['cpu-text'],
    cachePolicy: 'app-cache',
  },
  storageDir: 'synthetic',
  files: [{
    fileName: 'synthetic.litertlm',
    downloadUrl: 'https://artifacts.example/immutable/synthetic.litertlm',
    sha256: 'a'.repeat(64),
    sizeBytes: 1024,
    downloadMode: 'app-download',
  }],
  systemPrompt: 'Synthetic prompt',
  capabilities: { textGeneration: true, audioTranscription: false, offenceTagging: false },
};

function runtime(): TunedArtifactRuntimeSnapshot {
  return {
    enabled: true,
    reasonCode: 'enabled',
    controlId: 'synthetic-controls',
    activeManifestId: config.manifestId ?? null,
    activeManifestSha256: 'b'.repeat(64),
    rolloutPercent: 100,
    minimumAppVersion: '1.0.0',
    remoteDisableSupported: true,
    revokedManifestIds: [],
    revokedArtifactSha256: [],
    rollbackTargetManifestId: 'fail-closed:no-local-ai',
    expiresAt: '2026-08-14T00:00:00.000Z',
  };
}

describe('tuned artifact revocation', () => {
  const now = new Date('2026-07-30T00:00:00.000Z');

  it('keeps only the exact active identity', () => {
    expect(tunedArtifactRemovalReason(config, runtime(), now)).toBeNull();
    expect(tunedArtifactRemovalReason(config, { ...runtime(), activeManifestSha256: 'c'.repeat(64) }, now)).toBe('remote-hash-mismatch');
    expect(tunedArtifactRemovalReason({
      ...config,
      files: config.files.map(file => ({ ...file, sha256: undefined })),
    }, runtime(), now)).toBe('remote-hash-mismatch');
  });

  it('removes on disable or either revocation identity', () => {
    expect(tunedArtifactRemovalReason(config, { ...runtime(), enabled: false }, now)).toBe('remote-disabled');
    expect(tunedArtifactRemovalReason(config, { ...runtime(), revokedManifestIds: [config.manifestId!] }, now)).toBe('manifest-revoked');
    expect(tunedArtifactRemovalReason(config, { ...runtime(), revokedArtifactSha256: ['a'.repeat(64)] }, now)).toBe('artifact-revoked');
  });

  it('removes an exact artifact when its remote control expires', () => {
    expect(tunedArtifactRemovalReason(
      config,
      { ...runtime(), expiresAt: '2026-07-29T23:59:59.000Z' },
      now,
    )).toBe('remote-control-expired');
  });

  it('does not apply tuned controls to the base prototype', () => {
    expect(tunedArtifactRemovalReason(
      { ...config, lifecycleStatus: 'prototype' },
      { ...runtime(), enabled: false },
      now,
    )).toBeNull();
  });
});
