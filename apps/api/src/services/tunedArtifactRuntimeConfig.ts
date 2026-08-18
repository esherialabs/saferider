import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const controlsSchema = z.object({
  schema: z.literal('com.saferide.tuned-artifact-controls'),
  schemaVersion: z.literal(1),
  controlId: z.string().min(1),
  selection: z.object({
    requireBundledManifestById: z.literal(true),
    silentFallbackAllowed: z.literal(false),
    minimumSelectableState: z.literal('release-ready'),
  }),
  activation: z.object({
    enabled: z.boolean(),
    reasonCode: z.string().min(1),
    activeManifestId: z.string().min(1).nullable(),
    activeManifestSha256: sha256Schema.nullable(),
    rolloutPercent: z.number().int().min(0).max(100),
    minimumAppVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    remoteDisableSupported: z.literal(true),
    revokedManifestIds: z.array(z.string().min(1)),
    revokedArtifactSha256: z.array(sha256Schema),
  }),
  download: z.object({ enabled: z.boolean() }),
  approvals: z.object({
    legal: z.enum(['pending', 'blocked', 'approved', 'rejected']),
    safety: z.enum(['pending', 'blocked', 'approved', 'rejected']),
    release: z.enum(['pending', 'blocked', 'approved', 'rejected']),
  }),
  rollback: z.object({
    targetManifestId: z.string().min(1),
    removeArtifactOnRevocation: z.literal(true),
    clearReadyStateOnRevocation: z.literal(true),
    coreAppRemainsAvailable: z.literal(true),
  }),
  expiresAt: z.string().datetime(),
});

export type PublicTunedArtifactRuntimeConfig = {
  enabled: boolean;
  reasonCode: string;
  controlId: string | null;
  activeManifestId: string | null;
  activeManifestSha256: string | null;
  rolloutPercent: number;
  minimumAppVersion: string | null;
  remoteDisableSupported: boolean;
  revokedManifestIds: string[];
  revokedArtifactSha256: string[];
  rollbackTargetManifestId: string;
  expiresAt: string | null;
};

function controlsPath(): string | null {
  const candidates = [
    resolve(process.cwd(), 'config/ai/tuned-artifact-controls.v2.json'),
    resolve(process.cwd(), '../../config/ai/tuned-artifact-controls.v2.json'),
  ];
  return candidates.find(candidate => existsSync(candidate)) ?? null;
}

function disabledUnavailable(reasonCode: string): PublicTunedArtifactRuntimeConfig {
  return {
    enabled: false,
    reasonCode,
    controlId: null,
    activeManifestId: null,
    activeManifestSha256: null,
    rolloutPercent: 0,
    minimumAppVersion: null,
    remoteDisableSupported: true,
    revokedManifestIds: [],
    revokedArtifactSha256: [],
    rollbackTargetManifestId: 'fail-closed:no-local-ai',
    expiresAt: null,
  };
}

export function loadPublicTunedArtifactRuntimeConfig(now = new Date()): PublicTunedArtifactRuntimeConfig {
  try {
    const filePath = controlsPath();
    if (!filePath) return disabledUnavailable('controls-unavailable');
    const controls = controlsSchema.parse(JSON.parse(readFileSync(filePath, 'utf8')));
    const approvalsPassed = Object.values(controls.approvals).every(status => status === 'approved');
    const controlsExpired = now.getTime() > Date.parse(controls.expiresAt);
    const manifestRevoked = controls.activation.activeManifestId !== null
      && controls.activation.revokedManifestIds.includes(controls.activation.activeManifestId);
    const internallyEnabled = (
      controls.activation.enabled
      && controls.download.enabled
      && approvalsPassed
      && controls.activation.activeManifestId !== null
      && controls.activation.activeManifestSha256 !== null
      && controls.activation.rolloutPercent > 0
      && !controlsExpired
      && !manifestRevoked
    );
    return {
      enabled: internallyEnabled,
      reasonCode: internallyEnabled
        ? 'enabled'
        : controlsExpired
          ? 'controls-expired'
          : manifestRevoked
            ? 'manifest-revoked'
            : controls.activation.reasonCode,
      controlId: controls.controlId,
      activeManifestId: internallyEnabled ? controls.activation.activeManifestId : null,
      activeManifestSha256: internallyEnabled ? controls.activation.activeManifestSha256 : null,
      rolloutPercent: internallyEnabled ? controls.activation.rolloutPercent : 0,
      minimumAppVersion: controls.activation.minimumAppVersion,
      remoteDisableSupported: controls.activation.remoteDisableSupported,
      revokedManifestIds: [...controls.activation.revokedManifestIds],
      revokedArtifactSha256: [...controls.activation.revokedArtifactSha256],
      rollbackTargetManifestId: controls.rollback.targetManifestId,
      expiresAt: controls.expiresAt,
    };
  } catch {
    return disabledUnavailable('controls-invalid');
  }
}
