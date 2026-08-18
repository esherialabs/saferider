import controlsJson from '../../../config/ai/tuned-artifact-controls.v2.json';

import {
  TUNED_MOBILE_ARTIFACT_LIFECYCLE,
  validateTunedMobileArtifactManifest,
  type TunedArtifactApprovalState,
  type TunedMobileArtifactManifest,
  type TunedMobileArtifactState,
} from './modelManifest';
import { isSafeModelPathSegment } from './modelIdentity';

export const TUNED_ARTIFACT_CONTROLS_SCHEMA = 'com.saferide.tuned-artifact-controls';
export const TUNED_ARTIFACT_CONTROLS_VERSION = 1;
export const TUNED_ARTIFACT_CONTROLS_SHA256 = 'ee70c852452f06f28e58294040f47a3b2b99fb09c2cc896d82ae8895c45e6deb';

export type TunedArtifactControls = {
  schema: typeof TUNED_ARTIFACT_CONTROLS_SCHEMA;
  schemaVersion: typeof TUNED_ARTIFACT_CONTROLS_VERSION;
  controlId: string;
  lifecycleOrder: TunedMobileArtifactState[];
  selection: {
    manifestSchemaId: string;
    requireBundledManifestById: true;
    silentFallbackAllowed: false;
    minimumSelectableState: 'release-ready';
  };
  activation: {
    enabled: boolean;
    reasonCode: string;
    activeManifestId: string | null;
    activeManifestSha256: string | null;
    rolloutPercent: number;
    minimumAppVersion: string;
    remoteDisableSupported: true;
    revokedManifestIds: string[];
    revokedArtifactSha256: string[];
  };
  download: {
    enabled: boolean;
    largeArtifactThresholdBytes: number;
    explicitConsentRequired: true;
    displayExactByteSize: true;
    freeSpacePreflightRequired: true;
    meteredNetworkOptInRequired: true;
    unknownNetworkFailsClosed: true;
    pauseRequired: true;
    resumeRequired: true;
    cancelAndPartialCleanupRequired: true;
  };
  approvals: Record<'legal' | 'safety' | 'release', TunedArtifactApprovalState>;
  rollback: {
    targetManifestId: string;
    removeArtifactOnRevocation: true;
    clearReadyStateOnRevocation: true;
    coreAppRemainsAvailable: true;
  };
  issuedAt: string;
  expiresAt: string;
  ownerRole: string;
};

export type TunedArtifactActivationReason =
  | 'enabled'
  | 'qa-controlled-testing'
  | 'qa-manifest-mismatch'
  | 'invalid-controls'
  | 'invalid-manifest'
  | 'controls-expired'
  | 'controls-disabled'
  | 'manifest-not-selected'
  | 'manifest-hash-mismatch'
  | 'control-policy-mismatch'
  | 'lifecycle-not-release-ready'
  | 'approval-missing'
  | 'artifact-revoked'
  | 'artifact-identity-missing'
  | 'app-version-unsupported'
  | 'outside-rollout';

export type TunedArtifactActivationDecision = {
  enabled: boolean;
  reason: TunedArtifactActivationReason;
  manifestId: string | null;
  artifactSha256: string | null;
  rolloutPercent: number;
  rollbackTargetManifestId: string;
};

function isSha256(value: string | null): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function parseVersion(value: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function versionAtLeast(actual: string, minimum: string): boolean {
  const left = parseVersion(actual);
  const right = parseVersion(minimum);
  if (!left || !right) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}

export function validateTunedArtifactControls(controls: TunedArtifactControls): string[] {
  const errors: string[] = [];
  if (controls.schema !== TUNED_ARTIFACT_CONTROLS_SCHEMA) errors.push('invalid tuned artifact controls schema');
  if (controls.schemaVersion !== TUNED_ARTIFACT_CONTROLS_VERSION) errors.push('invalid tuned artifact controls version');
  if (JSON.stringify(controls.lifecycleOrder) !== JSON.stringify(TUNED_MOBILE_ARTIFACT_LIFECYCLE)) {
    errors.push('tuned artifact lifecycle order is invalid');
  }
  if (controls.selection.silentFallbackAllowed || !controls.selection.requireBundledManifestById) {
    errors.push('tuned artifact selection must forbid fallback and require a bundled manifest ID');
  }
  if (controls.activation.rolloutPercent < 0 || controls.activation.rolloutPercent > 100) {
    errors.push('tuned artifact rollout percent is invalid');
  }
  if (
    (controls.activation.activeManifestId !== null && !isSafeModelPathSegment(controls.activation.activeManifestId))
    || controls.activation.revokedManifestIds.some(id => !isSafeModelPathSegment(id))
    || (
      controls.rollback.targetManifestId !== 'fail-closed:no-local-ai'
      && !isSafeModelPathSegment(controls.rollback.targetManifestId)
    )
  ) {
    errors.push('tuned artifact controls contain an unsafe manifest identity');
  }
  if (!controls.activation.enabled) {
    if (controls.activation.activeManifestId !== null || controls.activation.activeManifestSha256 !== null) {
      errors.push('disabled tuned artifact controls cannot select a manifest');
    }
    if (controls.activation.rolloutPercent !== 0 || controls.download.enabled) {
      errors.push('disabled tuned artifact controls require zero rollout and disabled download');
    }
  }
  if (
    !controls.rollback.removeArtifactOnRevocation
    || !controls.rollback.clearReadyStateOnRevocation
    || !controls.rollback.coreAppRemainsAvailable
  ) {
    errors.push('tuned artifact rollback controls are incomplete');
  }
  return errors;
}

function disabledDecision(
  controls: TunedArtifactControls,
  reason: TunedArtifactActivationReason,
  manifest?: TunedMobileArtifactManifest,
): TunedArtifactActivationDecision {
  return {
    enabled: false,
    reason,
    manifestId: manifest?.manifestId ?? null,
    artifactSha256: manifest?.artifact.sha256 ?? null,
    rolloutPercent: controls.activation.rolloutPercent,
    rollbackTargetManifestId: controls.rollback.targetManifestId,
  };
}

export function evaluateTunedArtifactActivation(params: {
  controls: TunedArtifactControls;
  manifest: TunedMobileArtifactManifest;
  manifestSha256: string;
  appVersion: string;
  cohortBucket: number;
  now?: Date;
}): TunedArtifactActivationDecision {
  const { controls, manifest } = params;
  if (validateTunedArtifactControls(controls).length > 0) return disabledDecision(controls, 'invalid-controls', manifest);
  if (validateTunedMobileArtifactManifest(manifest).length > 0) return disabledDecision(controls, 'invalid-manifest', manifest);
  if ((params.now ?? new Date()).getTime() > Date.parse(controls.expiresAt)) return disabledDecision(controls, 'controls-expired', manifest);
  if (!controls.activation.enabled || !controls.download.enabled) return disabledDecision(controls, 'controls-disabled', manifest);
  if (controls.activation.activeManifestId !== manifest.manifestId) return disabledDecision(controls, 'manifest-not-selected', manifest);
  if (controls.activation.activeManifestSha256 !== params.manifestSha256) return disabledDecision(controls, 'manifest-hash-mismatch', manifest);
  if (manifest.controlPolicy.controlId !== controls.controlId || manifest.controlPolicy.sha256 !== TUNED_ARTIFACT_CONTROLS_SHA256) {
    return disabledDecision(controls, 'control-policy-mismatch', manifest);
  }
  if (manifest.status !== controls.selection.minimumSelectableState) return disabledDecision(controls, 'lifecycle-not-release-ready', manifest);
  if (Object.values(controls.approvals).some(status => status !== 'approved') || Object.values(manifest.approvals).some(status => status !== 'approved')) {
    return disabledDecision(controls, 'approval-missing', manifest);
  }
  if (
    controls.activation.revokedManifestIds.includes(manifest.manifestId)
    || (manifest.artifact.sha256 !== null && controls.activation.revokedArtifactSha256.includes(manifest.artifact.sha256))
  ) {
    return disabledDecision(controls, 'artifact-revoked', manifest);
  }
  if (
    !isSha256(manifest.artifact.sha256)
    || !manifest.artifact.sizeBytes
    || !manifest.artifact.immutableLocation
    || manifest.artifact.downloadMode !== 'app-download'
  ) {
    return disabledDecision(controls, 'artifact-identity-missing', manifest);
  }
  if (!versionAtLeast(params.appVersion, controls.activation.minimumAppVersion)) {
    return disabledDecision(controls, 'app-version-unsupported', manifest);
  }
  if (!Number.isInteger(params.cohortBucket) || params.cohortBucket < 0 || params.cohortBucket > 99 || params.cohortBucket >= controls.activation.rolloutPercent) {
    return disabledDecision(controls, 'outside-rollout', manifest);
  }
  return {
    ...disabledDecision(controls, 'enabled', manifest),
    enabled: true,
  };
}

function loadControls(value: unknown): TunedArtifactControls {
  const controls = value as TunedArtifactControls;
  const errors = validateTunedArtifactControls(controls);
  if (errors.length > 0) throw new Error(`Invalid tuned artifact controls: ${errors.join('; ')}`);
  return controls;
}

export const TUNED_ARTIFACT_CONTROLS = loadControls(controlsJson);
