import type { TunedArtifactRuntimeSnapshot } from '../../config/runtime/runtimeConfigStore';
import type { LocalModelConfig } from './modelRegistry';

export type TunedArtifactRemovalReason =
  | 'manifest-revoked'
  | 'artifact-revoked'
  | 'remote-disabled'
  | 'remote-control-expired'
  | 'remote-manifest-mismatch'
  | 'remote-hash-mismatch';

export function tunedArtifactRemovalReason(
  config: LocalModelConfig,
  runtime: TunedArtifactRuntimeSnapshot,
  now = new Date(),
): TunedArtifactRemovalReason | null {
  if (config.lifecycleStatus === 'revoked') return 'manifest-revoked';
  if (!config.manifestId) return null;
  const artifactSha256 = config.files.find(file => file.fileName === config.runtime.modelFileName)?.sha256;
  if (runtime.revokedManifestIds.includes(config.manifestId)) return 'manifest-revoked';
  if (artifactSha256 && runtime.revokedArtifactSha256.includes(artifactSha256)) return 'artifact-revoked';
  if (config.qaOnly && config.lifecycleStatus === 'artifact-produced') return null;
  if (config.lifecycleStatus !== 'release-ready') return null;
  if (!artifactSha256) return 'remote-hash-mismatch';
  if (!runtime.enabled) {
    return runtime.reasonCode === 'remote-control-expired'
      ? 'remote-control-expired'
      : 'remote-disabled';
  }
  if (
    runtime.expiresAt === null
    || !Number.isFinite(Date.parse(runtime.expiresAt))
    || now.getTime() > Date.parse(runtime.expiresAt)
  ) return 'remote-control-expired';
  if (runtime.activeManifestId !== config.manifestId) return 'remote-manifest-mismatch';
  if (!config.manifestSha256 || runtime.activeManifestSha256 !== config.manifestSha256) {
    return 'remote-hash-mismatch';
  }
  return null;
}
