import {
  assertValidLocalAiManifest,
  GEMMA_4_E2B_LITERTLM_PROTOTYPE_MANIFEST,
  getPrimaryModelArtifact,
  isManifestAudioTranscriptionRuntimeReady,
  validateTunedMobileArtifactManifest,
  type LocalAiBackend,
  type LocalAiLifecycleStatus,
  type RolloutPolicy,
  type SafeRideLocalAiManifest,
  type TunedMobileArtifactManifest,
  type TunedMobileArtifactState,
} from './modelManifest';
import {
  evaluateTunedArtifactActivation,
  type TunedArtifactActivationDecision,
  type TunedArtifactControls,
} from './tunedArtifactControls';
import safeAssistantSystemPrompt from '../../../config/ai/safe-assistant-system-prompt.json';

export type LocalModelFile = {
  /** File name as it will be persisted on device. */
  fileName: string;
  /** Remote URL that hosts the asset. */
  downloadUrl: string;
  /** SHA256 checksum of the file for integrity verification (hex). */
  sha256?: string;
  /** Optional approximate size in bytes to drive progress UI. */
  sizeBytes?: number;
  /** Controls whether the app can download the file itself. */
  downloadMode?: 'app-download' | 'controlled-import';
};

export type LocalLiteRtLmRuntime = {
  kind: 'litert-lm';
  /** Runtime model id used by SafeRide config/env. */
  modelId: string;
  /** .litertlm file from files[] passed to the LiteRT-LM bridge. */
  modelFileName: string;
  /** Context window SafeRide allocates for the first controlled runtime pass. */
  contextWindow: number;
  /** Conservative output cap for SafeRide runtime smoke prompts. */
  maxOutputTokens: number;
  /** Ordered backend plan for the Android bridge. */
  backendPlan: LocalAiBackend[];
  cachePolicy: 'app-cache' | 'app-documents';
  /** Approximate runtime memory required by the model. */
  vramRequiredMb?: number;
  /** Approximate download/cache footprint for release copy and QA notes. */
  approximateSizeBytes?: number;
  /** Exact free-space requirement declared by the selected manifest. */
  storageRequiredBytes?: number;
};

export type LocalLlamaRnRuntime = {
  kind: 'llama-rn-gguf';
  modelId: string;
  modelFileName: string;
  contextWindow: number;
  gpuLayers: number;
  vramRequiredMb?: number;
  approximateSizeBytes?: number;
};

export type LocalModelRuntime = LocalLiteRtLmRuntime | LocalLlamaRnRuntime;

export type LocalModelArtifactStatus = {
  state: 'runtime-pending';
  format: 'litertlm';
  manifestId: string;
  sourceModelId: string;
  reason: string;
  requiredAction: string;
};

export type LocalModelConfig = {
  id: string;
  label: string;
  variant: string;
  providerFamily: 'gemma';
  /** True for local/emulator runtime probes that must not be used as SafeRide release targets. */
  devOnly?: boolean;
  /** True only for an explicitly configured staging-preview tuned-artifact build. */
  qaOnly?: boolean;
  /** Manifest id when the entry is backed by a versioned model manifest. */
  manifestId?: string;
  /** SHA-256 of the exact manifest file selected by tuned-artifact controls. */
  manifestSha256?: string;
  lifecycleStatus?: LocalAiLifecycleStatus | TunedMobileArtifactState;
  rolloutDownloadMode?: RolloutPolicy['downloadMode'];
  runtime: LocalModelRuntime;
  /** Directory we persist the model under within FileSystem.documentDirectory/models. */
  storageDir: string;
  /** Files required for the native on-device runtime. */
  files: LocalModelFile[];
  /** Whether the registry entry is blocked from normal app setup. */
  artifact?: LocalModelArtifactStatus;
  /** Chat system prompt that keeps behaviour survivor-centred. */
  systemPrompt: string;
  /** Supported capabilities for this model. */
  capabilities: {
    textGeneration: boolean;
    audioTranscription: boolean;
    offenceTagging: boolean;
  };
};

export type LocalModelArtifactOverride = {
  fileName: string;
  downloadUrl: string;
  sha256: string;
  sizeBytes: number;
  contextWindow?: number;
  gpuLayers?: number;
  vramRequiredMb?: number;
};

const SAFERIDE_SYSTEM_PROMPT = safeAssistantSystemPrompt.text;

const RETIRED_LOCAL_MODEL_ALIASES = new Set([
  'qwen2.5-3b-instruct-q4f16_1-mlc',
  'saferide-qwen2.5-3b-q4-k-m-gguf',
  'qwen2.5-3b-instruct-q4_k_m.gguf',
  'gemma-2-2b-it-q4f16_1-mlc',
  'saferide-gemma-2-2b-it-q4-k-m-gguf',
  'gemma-2-2b-it-q4_k_m.gguf',
  'esherialabs/saferide-gemma-3n',
  'saferide-gemma-3n',
  'https://huggingface.co/esherialabs/saferide-gemma-3n',
  'base-gemma-3n-e4b-it',
  'base-gemma-3n-e4b-it-gguf',
  'base-gemma-3n-e4b-it-ud-iq2-xxs-gguf',
  'gemma-3n-e4b-it-ud-iq2_xxs.gguf',
  'unsloth/gemma-3n-e4b-it-gguf/ud-iq2_xxs',
]);

function localModelConfigFromManifest(manifest: SafeRideLocalAiManifest): LocalModelConfig {
  assertValidLocalAiManifest(manifest);
  if (manifest.runtime.kind !== 'litert-lm') {
    throw new Error(`${manifest.manifestId} uses retired runtime ${manifest.runtime.kind}`);
  }

  const primaryArtifact = getPrimaryModelArtifact(manifest);
  if (!primaryArtifact?.immutableUrl) {
    throw new Error(`${manifest.manifestId} requires an immutable URL before SafeRide can build a local model entry`);
  }

  const files: LocalModelFile[] = [
    {
      fileName: primaryArtifact.fileName,
      downloadUrl: primaryArtifact.immutableUrl,
      sha256: primaryArtifact.sha256,
      sizeBytes: primaryArtifact.sizeBytes,
      downloadMode: primaryArtifact.controlledImportOnly ? 'controlled-import' : 'app-download',
    },
  ];
  const audioTranscriptionReady = isManifestAudioTranscriptionRuntimeReady(manifest);
  const appDownloadEnabled = manifest.rollout.downloadMode === 'app-download' && !primaryArtifact.controlledImportOnly;

  return {
    id: manifest.modelId,
    label: manifest.humanLabel,
    variant: `${manifest.modelId}/${primaryArtifact.fileName}`,
    providerFamily: 'gemma',
    devOnly: true,
    manifestId: manifest.manifestId,
    lifecycleStatus: manifest.status,
    rolloutDownloadMode: manifest.rollout.downloadMode,
    runtime: {
      kind: 'litert-lm',
      modelId: manifest.modelId,
      modelFileName: primaryArtifact.fileName,
      contextWindow: manifest.prompting.contextWindow,
      maxOutputTokens: manifest.prompting.maxOutputTokens,
      backendPlan: manifest.runtime.backendPlan,
      cachePolicy: manifest.runtime.cachePolicy,
      vramRequiredMb: manifest.deviceRequirements.minRamGb * 1024,
      approximateSizeBytes: primaryArtifact.sizeBytes,
      storageRequiredBytes: manifest.deviceRequirements.storageRequiredBytes,
    },
    storageDir: `manifests/${manifest.manifestId}`,
    files,
    artifact: appDownloadEnabled
      ? undefined
      : {
        state: 'runtime-pending',
        format: 'litertlm',
        manifestId: manifest.manifestId,
        sourceModelId: manifest.modelId,
        reason: 'The local model is not ready for in-app setup yet.',
        requiredAction: 'Use a QA build that can download and verify the approved model.',
      },
    systemPrompt: SAFERIDE_SYSTEM_PROMPT,
    capabilities: {
      textGeneration: manifest.capabilities.textGuidance.enabled && appDownloadEnabled,
      audioTranscription: audioTranscriptionReady,
      offenceTagging: false,
    },
  };
}

export const GEMMA_4_E2B_LITERTLM_CONFIG = localModelConfigFromManifest(
  GEMMA_4_E2B_LITERTLM_PROTOTYPE_MANIFEST,
);

export const DEFAULT_LOCAL_MODEL_ID = GEMMA_4_E2B_LITERTLM_CONFIG.id;
export const SAFERIDE_V058_TUNED_MODEL_ID =
  'esherialabs/saferide-gemma-4-e2b-v058-original-419806-litertlm';
export const SAFERIDE_V058_TUNED_MANIFEST_ID =
  'saferide-gemma4-e2b-v058-original-419806-litertlm-artifact-produced-2026-08-10.1';
export const SAFERIDE_V058_TUNED_MANIFEST_SHA256 =
  'd3ce2105a1d496cd52b0a59701da103ac8f20295145ac5094320f46591b511c9';
export const SAFERIDE_V058_TUNED_ARTIFACT_FILE_NAME =
  'saferide-gemma4-e2b-v058-original-419806-runtime-compatible.litertlm';
export const SAFERIDE_V058_TUNED_ARTIFACT_SHA256 =
  '8b73fd844464f220955eeedc474c30f39e621458c7a6b092de5afa2c3d027fcd';
export const SAFERIDE_V058_TUNED_ARTIFACT_SIZE_BYTES = 5_071_837_136;
export const SAFERIDE_V058_TUNED_ARTIFACT_IMMUTABLE_LOCATION =
  'https://huggingface.co/esherialabs/saferide-gemma-4-e2b-v058-original-419806-litertlm/' +
  'resolve/e91ea27c3134fe21fc5bc995141675756e2c4a21/' +
  SAFERIDE_V058_TUNED_ARTIFACT_FILE_NAME;
export const ALL_LOCAL_MODELS: LocalModelConfig[] = [
  GEMMA_4_E2B_LITERTLM_CONFIG,
];

function normalizeModelId(modelId: string | undefined): string | null {
  const normalized = modelId?.trim().replace(/\/+$/, '');
  return normalized ? normalized : null;
}

function isGemma4E2bTargetId(normalized: string): boolean {
  const value = normalized.toLowerCase();
  return (
    value === GEMMA_4_E2B_LITERTLM_CONFIG.id.toLowerCase() ||
    value === GEMMA_4_E2B_LITERTLM_PROTOTYPE_MANIFEST.manifestId ||
    value === GEMMA_4_E2B_LITERTLM_CONFIG.runtime.modelFileName.toLowerCase() ||
    value === 'gemma-4-e2b-it' ||
    value === 'gemma-4-e2b-it-litert-lm' ||
    value === 'gemma-4-e2b' ||
    value === 'https://huggingface.co/litert-community/gemma-4-e2b-it-litert-lm'
  );
}

export function isRetiredLocalModelId(modelId: string | undefined): boolean {
  const normalized = normalizeModelId(modelId);
  return normalized ? RETIRED_LOCAL_MODEL_ALIASES.has(normalized.toLowerCase()) : false;
}

export function resolveLocalModelConfig(
  modelId: string | undefined,
  _artifactOverride?: LocalModelArtifactOverride,
): LocalModelConfig {
  const normalized = normalizeModelId(modelId);
  if (!normalized || isGemma4E2bTargetId(normalized)) {
    return GEMMA_4_E2B_LITERTLM_CONFIG;
  }

  if (isRetiredLocalModelId(normalized)) {
    return {
      ...GEMMA_4_E2B_LITERTLM_CONFIG,
      devOnly: false,
      artifact: {
        state: 'runtime-pending',
        format: 'litertlm',
        manifestId: 'fail-closed-retired-local-model',
        sourceModelId: normalized,
        reason: 'The configured local model is retired.',
        requiredAction: 'Select an explicitly registered Gemma 4 E2B manifest; no fallback is allowed.',
      },
      capabilities: {
        textGeneration: false,
        audioTranscription: false,
        offenceTagging: false,
      },
    };
  }

  const registered = ALL_LOCAL_MODELS.find(model => (
    model.id === normalized ||
    model.runtime.modelId === normalized ||
    model.variant === normalized
  ));
  if (registered) return registered;

  return {
    ...GEMMA_4_E2B_LITERTLM_CONFIG,
    devOnly: false,
    artifact: {
      state: 'runtime-pending',
      format: 'litertlm',
      manifestId: 'fail-closed-unregistered-local-model',
      sourceModelId: normalized,
      reason: 'The configured local model is not registered in this build.',
      requiredAction: 'Use an exact bundled manifest; SafeRide will not substitute another model.',
    },
    capabilities: {
      textGeneration: false,
      audioTranscription: false,
      offenceTagging: false,
    },
  };
}

export function isLocalModelAppReady(config: LocalModelConfig): boolean {
  return !config.artifact || config.artifact.state !== 'runtime-pending';
}

export function getLocalModelArtifactBlocker(config: LocalModelConfig): string | null {
  if (!config.artifact || config.artifact.state !== 'runtime-pending') {
    return null;
  }

  return `${config.label} is not ready for SafeRide mobile release yet. ${config.artifact.reason} ${config.artifact.requiredAction}`;
}

export function formatApproximateModelSize(config: LocalModelConfig): string | null {
  const size = config.runtime.approximateSizeBytes;
  if (!size) return null;
  if (size >= 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (size >= 1024 * 1024) {
    return `${Math.round(size / (1024 * 1024))} MB`;
  }
  return `${size} bytes`;
}

export function resolveTunedArtifactRuntimeCandidate(params: {
  manifest: TunedMobileArtifactManifest;
  manifestSha256: string;
  controls: TunedArtifactControls;
  appVersion: string;
  cohortBucket: number;
  now?: Date;
}): { config: LocalModelConfig | null; decision: TunedArtifactActivationDecision } {
  const decision = evaluateTunedArtifactActivation(params);
  if (!decision.enabled) return { config: null, decision };

  const config = buildTunedArtifactRuntimeConfig(params.manifest, params.manifestSha256);
  if (!config) {
    return {
      config: null,
      decision: { ...decision, enabled: false, reason: 'artifact-identity-missing' },
    };
  }

  return { decision, config };
}

/**
 * Builds the exact storage/runtime identity needed for activation or removal.
 * Pre-release manifests are deliberately excluded from the app registry.
 */
function buildTunedArtifactRuntimeConfigForMode(
  manifest: TunedMobileArtifactManifest,
  manifestSha256: string,
  mode: 'release' | 'qa-controlled',
): LocalModelConfig | null {
  const qaControlled = mode === 'qa-controlled';
  const manifestErrors = validateTunedMobileArtifactManifest(manifest);
  if (
    manifestErrors.length > 0
    || (
      qaControlled
        ? manifest.status !== 'artifact-produced'
        : manifest.status !== 'release-ready' && manifest.status !== 'revoked'
    )
    || !/^[a-f0-9]{64}$/.test(manifestSha256)
  ) {
    return null;
  }

  const artifactSha256 = manifest.artifact.sha256;
  const artifactSizeBytes = manifest.artifact.sizeBytes;
  const immutableLocation = manifest.artifact.immutableLocation;
  const minRamGb = manifest.deviceRequirements.minRamGb;
  if (!artifactSha256 || !artifactSizeBytes || !immutableLocation || !minRamGb) {
    return null;
  }

  const releaseReady = manifest.status === 'release-ready';
  return {
    id: manifest.modelId,
    label: qaControlled ? 'SafeRide tuned local AI (QA)' : 'SafeRide tuned local AI',
    variant: `${manifest.modelId}/${manifest.artifact.fileName}`,
    providerFamily: 'gemma',
    devOnly: qaControlled,
    qaOnly: qaControlled,
    manifestId: manifest.manifestId,
    manifestSha256,
    lifecycleStatus: manifest.status,
    rolloutDownloadMode: 'app-download',
    runtime: {
      kind: 'litert-lm',
      modelId: manifest.modelId,
      modelFileName: manifest.artifact.fileName,
      contextWindow: manifest.runtime.contextWindow,
      maxOutputTokens: manifest.runtime.maxOutputTokens,
      backendPlan: manifest.runtime.backendPlan,
      cachePolicy: manifest.runtime.cachePolicy,
      vramRequiredMb: minRamGb * 1024,
      approximateSizeBytes: artifactSizeBytes,
      storageRequiredBytes: manifest.deviceRequirements.storageRequiredBytes ?? undefined,
    },
    storageDir: `manifests/${manifest.manifestId}`,
    files: [{
      fileName: manifest.artifact.fileName,
      downloadUrl: immutableLocation,
      sha256: artifactSha256,
      sizeBytes: artifactSizeBytes,
      downloadMode: 'app-download',
    }],
    systemPrompt: SAFERIDE_SYSTEM_PROMPT,
    capabilities: {
      textGeneration: releaseReady || qaControlled,
      audioTranscription: false,
      offenceTagging: false,
    },
  };
}

export function buildTunedArtifactRuntimeConfig(
  manifest: TunedMobileArtifactManifest,
  manifestSha256: string,
): LocalModelConfig | null {
  return buildTunedArtifactRuntimeConfigForMode(manifest, manifestSha256, 'release');
}

export function buildQaTunedArtifactRuntimeConfig(
  manifest: TunedMobileArtifactManifest,
  manifestSha256: string,
): LocalModelConfig | null {
  const exactV058Binding =
    manifest.manifestId === SAFERIDE_V058_TUNED_MANIFEST_ID
    && manifest.modelId === SAFERIDE_V058_TUNED_MODEL_ID
    && manifestSha256 === SAFERIDE_V058_TUNED_MANIFEST_SHA256
    && manifest.artifact.fileName === SAFERIDE_V058_TUNED_ARTIFACT_FILE_NAME
    && manifest.artifact.sha256 === SAFERIDE_V058_TUNED_ARTIFACT_SHA256
    && manifest.artifact.sizeBytes === SAFERIDE_V058_TUNED_ARTIFACT_SIZE_BYTES
    && manifest.artifact.immutableLocation === SAFERIDE_V058_TUNED_ARTIFACT_IMMUTABLE_LOCATION;
  if (!exactV058Binding) return null;
  return buildTunedArtifactRuntimeConfigForMode(manifest, manifestSha256, 'qa-controlled');
}
