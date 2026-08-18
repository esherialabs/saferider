import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { getRandomBytesAsync } from 'expo-crypto';

import { localAssistantConfig } from '../../config/localAssistant';
import {
  getRuntimeConfigSnapshot,
  type TunedArtifactRuntimeSnapshot,
} from '../../config/runtime/runtimeConfigStore';
import { TUNED_ARTIFACT_ROLLOUT_BUCKET_KEY } from '../../utils/storageKeys';
import {
  SAFERIDE_GEMMA4_E2B_V058_ORIGINAL_419806_LITERTLM_ARTIFACT_PRODUCED_MANIFEST,
  type TunedMobileArtifactManifest,
} from './modelManifest';
import {
  buildQaTunedArtifactRuntimeConfig,
  buildTunedArtifactRuntimeConfig,
  resolveTunedArtifactRuntimeCandidate,
  SAFERIDE_V058_TUNED_MANIFEST_ID,
  SAFERIDE_V058_TUNED_MANIFEST_SHA256,
  type LocalModelConfig,
} from './modelRegistry';
import {
  TUNED_ARTIFACT_CONTROLS,
  type TunedArtifactActivationDecision,
  type TunedArtifactControls,
} from './tunedArtifactControls';

export const TUNED_ARTIFACT_BUNDLED_MANIFEST_SHA256 =
  SAFERIDE_V058_TUNED_MANIFEST_SHA256;
export const V058_QA_TUNED_MANIFEST_ID = SAFERIDE_V058_TUNED_MANIFEST_ID;

let rolloutBucket: number | null = null;

export type TunedArtifactRuntimeSelection = {
  selectionRequired: boolean;
  config: LocalModelConfig | null;
  decision: TunedArtifactActivationDecision;
};

function isRolloutBucket(value: string | null): value is string {
  return value !== null && /^(?:[0-9]|[1-9][0-9])$/.test(value);
}

function bundledRolloutCanBeAssigned(controls: TunedArtifactControls): boolean {
  return controls.activation.enabled && controls.download.enabled && controls.activation.rolloutPercent > 0;
}

/**
 * Hydrates a stable, content-free local cohort assignment. Disabled controls
 * neither create nor rotate an identifier.
 */
export async function hydrateTunedArtifactRolloutBucket(): Promise<number | null> {
  if (!bundledRolloutCanBeAssigned(TUNED_ARTIFACT_CONTROLS)) {
    rolloutBucket = null;
    return null;
  }

  const stored = await AsyncStorage.getItem(TUNED_ARTIFACT_ROLLOUT_BUCKET_KEY);
  if (isRolloutBucket(stored)) {
    rolloutBucket = Number(stored);
    return rolloutBucket;
  }

  const random = await getRandomBytesAsync(1);
  const nextBucket = random[0] % 100;
  await AsyncStorage.setItem(TUNED_ARTIFACT_ROLLOUT_BUCKET_KEY, String(nextBucket));
  rolloutBucket = nextBucket;
  return rolloutBucket;
}

function effectiveControls(
  bundled: TunedArtifactControls,
  runtime: TunedArtifactRuntimeSnapshot,
): TunedArtifactControls {
  return {
    ...bundled,
    controlId: runtime.controlId ?? 'fail-closed:missing-control-id',
    activation: {
      ...bundled.activation,
      enabled: runtime.enabled,
      reasonCode: runtime.reasonCode,
      activeManifestId: runtime.activeManifestId,
      activeManifestSha256: runtime.activeManifestSha256,
      rolloutPercent: runtime.rolloutPercent,
      minimumAppVersion: runtime.minimumAppVersion ?? '0.0.0',
      remoteDisableSupported: true,
      revokedManifestIds: [...runtime.revokedManifestIds],
      revokedArtifactSha256: [...runtime.revokedArtifactSha256],
    },
    download: {
      ...bundled.download,
      enabled: bundled.download.enabled && runtime.enabled,
    },
    expiresAt: runtime.expiresAt ?? '1970-01-01T00:00:00.000Z',
  };
}

function runtimeAppVersion(): string {
  return Constants.expoConfig?.version ?? 'unknown';
}

export function resolveTunedArtifactRuntimeSelection(params: {
  runtime?: TunedArtifactRuntimeSnapshot;
  manifest?: TunedMobileArtifactManifest;
  manifestSha256?: string;
  bundledControls?: TunedArtifactControls;
  appVersion?: string;
  cohortBucket?: number | null;
  qaTunedArtifactManifestId?: string | null;
  now?: Date;
} = {}): TunedArtifactRuntimeSelection {
  const bundledControls = params.bundledControls ?? TUNED_ARTIFACT_CONTROLS;
  const runtime = params.runtime ?? getRuntimeConfigSnapshot().localAi;
  const manifest = params.manifest
    ?? SAFERIDE_GEMMA4_E2B_V058_ORIGINAL_419806_LITERTLM_ARTIFACT_PRODUCED_MANIFEST;
  const manifestSha256 = params.manifestSha256 ?? TUNED_ARTIFACT_BUNDLED_MANIFEST_SHA256;
  const qaTunedArtifactManifestId = params.qaTunedArtifactManifestId === undefined
    ? localAssistantConfig.qaTunedArtifactManifestId
    : params.qaTunedArtifactManifestId ?? undefined;

  if (qaTunedArtifactManifestId) {
    const revoked = runtime.revokedManifestIds.includes(manifest.manifestId)
      || Boolean(
        manifest.artifact.sha256
        && runtime.revokedArtifactSha256.includes(manifest.artifact.sha256),
      );
    const exactQaSelection = qaTunedArtifactManifestId === V058_QA_TUNED_MANIFEST_ID;
    const config = exactQaSelection && !revoked
      ? buildQaTunedArtifactRuntimeConfig(manifest, manifestSha256)
      : null;
    return {
      selectionRequired: true,
      config,
      decision: {
        enabled: Boolean(config),
        reason: exactQaSelection && revoked
          ? 'artifact-revoked'
          : config
            ? 'qa-controlled-testing'
            : 'qa-manifest-mismatch',
        manifestId: manifest.manifestId,
        artifactSha256: manifest.artifact.sha256,
        rolloutPercent: config ? 100 : 0,
        rollbackTargetManifestId: bundledControls.rollback.targetManifestId,
      },
    };
  }
  const controls = effectiveControls(bundledControls, runtime);
  const selectionRequired = bundledControls.activation.enabled || runtime.enabled;
  const result = resolveTunedArtifactRuntimeCandidate({
    manifest,
    manifestSha256,
    controls,
    appVersion: params.appVersion ?? runtimeAppVersion(),
    // An unhydrated or invalid assignment is outside rollout by construction.
    cohortBucket: params.cohortBucket ?? rolloutBucket ?? -1,
    now: params.now,
  });

  return {
    selectionRequired,
    config: result.config,
    decision: result.decision,
  };
}

/** Returns a known exact artifact identity for revocation cleanup only. */
export function getBundledTunedArtifactRemovalCandidate(): LocalModelConfig | null {
  return buildTunedArtifactRuntimeConfig(
    SAFERIDE_GEMMA4_E2B_V058_ORIGINAL_419806_LITERTLM_ARTIFACT_PRODUCED_MANIFEST,
    TUNED_ARTIFACT_BUNDLED_MANIFEST_SHA256,
  ) ?? buildQaTunedArtifactRuntimeConfig(
    SAFERIDE_GEMMA4_E2B_V058_ORIGINAL_419806_LITERTLM_ARTIFACT_PRODUCED_MANIFEST,
    TUNED_ARTIFACT_BUNDLED_MANIFEST_SHA256,
  );
}
