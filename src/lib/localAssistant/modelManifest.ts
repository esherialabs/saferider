import baseGemma4ManifestJson from '../../../config/ai/manifests/base-gemma4-e2b.json';
import v03TunedBlockedManifestJson from '../../../config/ai/manifests/saferide-v03-tuned.export-blocked.json';
import v058TunedArtifactProducedManifestJson from '../../../config/ai/manifests/saferide-v058-original-419806.artifact-produced.json';
import { isSafeModelPathSegment, isSafeNamespacedModelId } from './modelIdentity';

export const LOCAL_AI_MODEL_MANIFEST_SCHEMA = 'com.saferide.local-ai-model-manifest';
export const LOCAL_AI_MODEL_MANIFEST_SCHEMA_VERSION = 1;

export type LocalAiReleaseChannel =
  | 'prototype'
  | 'internal-test'
  | 'unicef-checkpoint'
  | 'moderated-test'
  | 'release-candidate'
  | 'release-ready';

export type LocalAiLifecycleStatus = LocalAiReleaseChannel | 'retired' | 'revoked';
export type LocalAiBackend = 'npu' | 'gpu' | 'cpu-multimodal' | 'cpu-text';

export type LiteRtLmRuntimeManifest = {
  kind: 'litert-lm';
  engine: 'google-ai-edge-litert-lm';
  androidModule: 'saferide-litert-lm';
  primaryFileRole: 'model';
  modelFileExtension: '.litertlm';
  backendPlan: LocalAiBackend[];
  cachePolicy: 'app-cache' | 'app-documents';
  acceleratorDefaults: {
    textBackend: 'gpu' | 'cpu' | 'npu';
    visionBackend: 'disabled' | 'gpu' | 'cpu' | 'npu';
    audioBackend: 'disabled' | 'gpu' | 'cpu' | 'npu';
    npuNativeLibraryDirRequired: boolean;
  };
};

export type LlamaRnRuntimeManifest = {
  kind: 'llama-rn-gguf';
  engine: 'llama.rn';
  primaryFileRole: 'model';
  modelFileExtension: '.gguf';
  contextWindow: number;
  gpuLayers: number;
  loraScale?: number;
};

export type LocalAiRuntimeManifest = LiteRtLmRuntimeManifest | LlamaRnRuntimeManifest;

export type ModelLineage = {
  baseModel: string;
  baseRevision: string;
  baseTermsOwnerRole: string;
  adapterModel?: string;
  adapterRevision?: string;
  trainingRunId?: string;
  dataRegisterId?: string;
  exportPipelineId: string;
  exportCommit?: string;
  quantization: {
    method: string;
    precision: string;
    tool: string;
    toolVersion: string;
  };
};

export type ModelArtifact = {
  role:
    | 'model'
    | 'lora-sidecar'
    | 'tokenizer'
    | 'processor'
    | 'audio-package'
    | 'vision-package'
    | 'manifest-signature';
  fileName: string;
  format: 'litertlm' | 'gguf' | 'safetensors' | 'json' | 'model' | 'other';
  immutableUrl?: string;
  controlledImportOnly?: boolean;
  immutableRevision?: string;
  sha256: string;
  sizeBytes: number;
  required: boolean;
};

export type PromptContract = {
  systemPromptId: string;
  systemPromptRevision: string;
  chatTemplateId: string;
  chatTemplateRevision: string;
  stopTokens: string[];
  contextWindow: number;
  maxInputTokens: number;
  maxOutputTokens: number;
};

export type SamplerDefaults = {
  temperature: number;
  topP: number;
  topK?: number;
  repeatPenalty?: number;
};

export type CapabilityState = {
  enabled: boolean;
  stage: 'disabled' | 'prototype' | 'internal-only' | 'controlled' | 'release';
  evidenceRef?: string;
  limitations: string[];
};

export type CapabilityFlags = {
  textGuidance: CapabilityState;
  incidentStructuring: CapabilityState;
  audioTranscription: CapabilityState;
  imageUnderstanding: CapabilityState;
  offenceTagging: CapabilityState;
  multilingual: CapabilityState;
};

export type DeviceRequirements = {
  androidMinSdk: number;
  supportedAbis: string[];
  minRamGb: number;
  recommendedRamGb?: number;
  storageRequiredBytes: number;
  additionalFreeStorageBytes: number;
  expectedFirstTokenMs?: number;
  expectedTokensPerSecond?: number;
  thermalRisk: 'unknown' | 'low' | 'medium' | 'high';
};

export type SafetyEvidenceRef = {
  policyDoc: string;
  promptSuiteVersion: string;
  rubricVersion: string;
  evalReport?: string;
  criticalFailures: number | 'unknown';
  reviewerSignoff?: string;
};

export type PrivacyEvidenceRef = {
  privacyReviewDoc?: string;
  rawPromptLogging: 'forbidden';
  rawCompletionLogging: 'forbidden';
  sensitiveDataUse: 'none' | 'blocked' | 'approved-internal';
};

export type LicenseEvidenceRef = {
  accessDecisionDoc: string;
  legalStatus: 'pending' | 'approved' | 'blocked';
  publicSharing: 'allowed' | 'restricted' | 'blocked';
};

export type AndroidEvidenceRef = {
  deviceMatrixDoc?: string;
  physicalDeviceProof: boolean;
  loadGenerateCancelUnload: boolean;
  offlineProof: boolean;
};

export type RolloutPolicy = {
  downloadMode: 'disabled' | 'controlled-import' | 'internal-url' | 'app-download';
  allowedBuildProfiles: string[];
  userVisiblePreparationRequired: boolean;
  maxRolloutPercent?: number;
};

export type RollbackPolicy = {
  rollbackTargetManifestId?: string;
  disableIfStatus: Array<'retired' | 'revoked'>;
  clearCachedReadyState: boolean;
  blockNewDownloads: boolean;
  removeLocalArtifactOnRevoke: boolean;
  ownerRole: string;
};

export type SafeRideLocalAiManifest = {
  schema: typeof LOCAL_AI_MODEL_MANIFEST_SCHEMA;
  schemaVersion: typeof LOCAL_AI_MODEL_MANIFEST_SCHEMA_VERSION;
  manifestId: string;
  modelId: string;
  humanLabel: string;
  releaseChannel: LocalAiReleaseChannel;
  status: LocalAiLifecycleStatus;
  runtime: LocalAiRuntimeManifest;
  lineage: ModelLineage;
  artifacts: ModelArtifact[];
  prompting: PromptContract;
  samplerDefaults: SamplerDefaults;
  capabilities: CapabilityFlags;
  deviceRequirements: DeviceRequirements;
  safety: SafetyEvidenceRef;
  privacy: PrivacyEvidenceRef;
  license: LicenseEvidenceRef;
  androidEvidence: AndroidEvidenceRef;
  limitations: string[];
  rollout: RolloutPolicy;
  rollback: RollbackPolicy;
  createdAt: string;
  createdByRole: string;
};

export const TUNED_MOBILE_ARTIFACT_MANIFEST_SCHEMA = 'com.saferide.tuned-mobile-artifact-manifest';
export const TUNED_MOBILE_ARTIFACT_MANIFEST_SCHEMA_VERSION = 2;

export const TUNED_MOBILE_ARTIFACT_LIFECYCLE = [
  'training-complete',
  'adapter-evaluated',
  'export-blocked',
  'artifact-produced',
  'artifact-android-verified',
  'checkpoint-candidate',
  'release-candidate',
  'release-ready',
  'revoked',
] as const;

export type TunedMobileArtifactState = typeof TUNED_MOBILE_ARTIFACT_LIFECYCLE[number];
export type TunedArtifactApprovalState = 'pending' | 'blocked' | 'approved' | 'rejected';

export type TunedMobileArtifactManifest = {
  schema: typeof TUNED_MOBILE_ARTIFACT_MANIFEST_SCHEMA;
  schemaVersion: typeof TUNED_MOBILE_ARTIFACT_MANIFEST_SCHEMA_VERSION;
  manifestId: string;
  modelId: string;
  status: TunedMobileArtifactState;
  stateHistory: Array<{
    state: TunedMobileArtifactState;
    enteredAt: string;
    evidenceRefs: string[];
  }>;
  adapterModel: string;
  adapterRevision: string;
  adapterRepoSha: string;
  trainingRunId: string;
  dataRegisterId: string;
  baseModel: string;
  baseRevision: string;
  exportDecisionDoc: string;
  exportRunner: string;
  exportRunbook: string;
  exportPath: {
    decision: 'merge-peft-then-export-litertlm' | 'blocked';
    requiredSteps: string[];
    blocker?: string;
  };
  exportTooling: {
    environmentClass: 'approved-high-memory-only';
    exporterRepositoryRevision: string | null;
    pythonVersion: string | null;
    packages: Record<string, string>;
    tokenizer: {
      model: string;
      revision: string;
      metadataSha256: string | null;
    };
  };
  runtime: {
    contextWindow: number;
    maxOutputTokens: number;
    backendPlan: LocalAiBackend[];
    cachePolicy: 'app-cache' | 'app-documents';
  };
  deviceRequirements: {
    minAndroidApi: number;
    minRamGb: number | null;
    storageRequiredBytes: number | null;
  };
  artifact: {
    fileName: string;
    format: 'litertlm';
    downloadMode: 'disabled' | 'controlled-import' | 'app-download';
    immutableLocation: string | null;
    sha256: string | null;
    sizeBytes: number | null;
    fileInventoryRef: string | null;
  };
  attestation: {
    status: 'missing' | 'pending' | 'approved' | 'rejected';
    processId: string;
    attestationRef: string | null;
    approverRole: string | null;
    approvedAt: string | null;
  };
  safetyReport: {
    reportDoc: string;
    summaryId: string;
    privateEvidenceRepo: string;
    privateEvidenceRepoSha: string;
  };
  androidProof: {
    baseRuntimeManifestId: string;
    baseRuntimeDeviceMatrixDoc: string;
    baseRuntimePhysicalDeviceProof: boolean;
    tunedArtifactPhysicalDeviceProof: boolean;
    deviceEvidenceId: string | null;
    deviceEvidenceRef: string | null;
  };
  controlPolicy: {
    controlId: string;
    sha256: string;
  };
  approvals: {
    legal: TunedArtifactApprovalState;
    safety: TunedArtifactApprovalState;
    release: TunedArtifactApprovalState;
  };
  rollbackTargetManifestId: string;
  limitations: string[];
  createdAt: string;
  createdByRole: string;
};

const RELEASE_LIKE_STATUSES = new Set<LocalAiLifecycleStatus>([
  'unicef-checkpoint',
  'moderated-test',
  'release-candidate',
  'release-ready',
]);

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function hasText(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function primaryExtensionForRuntime(runtime: LocalAiRuntimeManifest): string {
  return runtime.modelFileExtension;
}

function primaryFormatForRuntime(runtime: LocalAiRuntimeManifest): ModelArtifact['format'] {
  return runtime.kind === 'litert-lm' ? 'litertlm' : 'gguf';
}

function isEnabledCapability(capability: CapabilityState): boolean {
  return capability.enabled && capability.stage !== 'disabled';
}

export function isManifestAudioTranscriptionRuntimeReady(manifest: SafeRideLocalAiManifest): boolean {
  const audio = manifest.capabilities.audioTranscription;
  if (!isEnabledCapability(audio) || !hasText(audio.evidenceRef)) return false;
  if (!hasText(manifest.privacy.privacyReviewDoc)) return false;
  if (
    !manifest.androidEvidence.physicalDeviceProof
    || !manifest.androidEvidence.loadGenerateCancelUnload
    || !manifest.androidEvidence.offlineProof
  ) {
    return false;
  }
  if (manifest.runtime.kind !== 'litert-lm') return false;
  return manifest.runtime.acceleratorDefaults.audioBackend !== 'disabled';
}

export function getPrimaryModelArtifact(manifest: SafeRideLocalAiManifest): ModelArtifact | null {
  return manifest.artifacts.find(artifact => (
    artifact.required && artifact.role === manifest.runtime.primaryFileRole
  )) ?? null;
}

export function validateLocalAiManifest(manifest: SafeRideLocalAiManifest): string[] {
  const errors: string[] = [];

  if (manifest.schema !== LOCAL_AI_MODEL_MANIFEST_SCHEMA) {
    errors.push(`schema must be ${LOCAL_AI_MODEL_MANIFEST_SCHEMA}`);
  }
  if (manifest.schemaVersion !== LOCAL_AI_MODEL_MANIFEST_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${LOCAL_AI_MODEL_MANIFEST_SCHEMA_VERSION}`);
  }
  if (!hasText(manifest.manifestId)) errors.push('manifestId is required');
  if (!hasText(manifest.modelId)) errors.push('modelId is required');
  if (hasText(manifest.manifestId) && !isSafeModelPathSegment(manifest.manifestId)) {
    errors.push('manifestId must be a safe path component');
  }
  if (hasText(manifest.modelId) && !isSafeNamespacedModelId(manifest.modelId)) {
    errors.push('modelId must contain only safe path components');
  }
  if (manifest.limitations.length === 0) errors.push('at least one limitation is required');

  for (const [name, capability] of Object.entries(manifest.capabilities)) {
    if (capability.enabled && capability.stage === 'disabled') {
      errors.push(`${name} cannot be enabled while its capability stage is disabled`);
    }
    if (!capability.enabled && capability.stage !== 'disabled') {
      errors.push(`${name} must use stage disabled when it is not enabled`);
    }
    if (capability.enabled && !hasText(capability.evidenceRef)) {
      errors.push(`${name} enabled requires an evidenceRef`);
    }
    if (capability.limitations.length === 0) {
      errors.push(`${name} requires at least one limitation`);
    }
  }

  if (manifest.capabilities.audioTranscription.enabled && !isManifestAudioTranscriptionRuntimeReady(manifest)) {
    errors.push(
      'audioTranscription enabled requires evidenceRef, privacyReviewDoc, physical Android load/offline proof, and a non-disabled LiteRT-LM audio backend',
    );
  }

  const primaryArtifact = getPrimaryModelArtifact(manifest);
  if (!primaryArtifact) {
    errors.push(`a required ${manifest.runtime.primaryFileRole} artifact is required`);
    return errors;
  }

  const requiredExtension = primaryExtensionForRuntime(manifest.runtime);
  const requiredFormat = primaryFormatForRuntime(manifest.runtime);
  if (!primaryArtifact.fileName.endsWith(requiredExtension)) {
    errors.push(`${manifest.runtime.kind} runtime requires ${requiredExtension} model files`);
  }
  if (!isSafeModelPathSegment(primaryArtifact.fileName)) {
    errors.push('primary artifact fileName must be a safe path component');
  }
  if (primaryArtifact.format !== requiredFormat) {
    errors.push(`${manifest.runtime.kind} runtime requires ${requiredFormat} artifact format`);
  }
  if (!isSha256(primaryArtifact.sha256)) {
    errors.push(`${primaryArtifact.fileName} must include a 64-character SHA-256 digest`);
  }
  if (!Number.isSafeInteger(primaryArtifact.sizeBytes) || primaryArtifact.sizeBytes <= 0) {
    errors.push(`${primaryArtifact.fileName} must include a positive byte size`);
  }
  if (!primaryArtifact.immutableUrl && !primaryArtifact.controlledImportOnly) {
    errors.push(`${primaryArtifact.fileName} requires an immutable URL or controlledImportOnly=true`);
  }
  if (manifest.rollout.downloadMode === 'app-download' && primaryArtifact.controlledImportOnly) {
    errors.push('app-download mode cannot use controlledImportOnly artifacts');
  }
  if (manifest.license.legalStatus !== 'approved' && manifest.rollout.downloadMode !== 'controlled-import' && manifest.rollout.downloadMode !== 'disabled') {
    errors.push('pending or blocked legal status requires controlled-import or disabled rollout');
  }
  if (manifest.license.legalStatus !== 'approved' && (manifest.rollout.maxRolloutPercent ?? 0) !== 0) {
    errors.push('pending or blocked legal status requires maxRolloutPercent=0');
  }
  if (manifest.runtime.kind === 'litert-lm' && manifest.runtime.backendPlan.length === 0) {
    errors.push('litert-lm manifests require at least one backend plan entry');
  }
  if (manifest.prompting.contextWindow <= 0 || manifest.prompting.maxOutputTokens <= 0) {
    errors.push('prompting contextWindow and maxOutputTokens must be positive');
  }
  if (manifest.deviceRequirements.storageRequiredBytes < primaryArtifact.sizeBytes) {
    errors.push('device storageRequiredBytes must cover the primary artifact size');
  }

  if (RELEASE_LIKE_STATUSES.has(manifest.status)) {
    if (manifest.releaseChannel !== manifest.status) {
      errors.push('release-like manifest status must match releaseChannel');
    }
    if (manifest.license.legalStatus !== 'approved') {
      errors.push('release-like manifests require approved license evidence');
    }
    if (manifest.safety.criticalFailures !== 0 || !hasText(manifest.safety.reviewerSignoff)) {
      errors.push('release-like manifests require zero critical failures and reviewer signoff');
    }
    if (
      !manifest.androidEvidence.physicalDeviceProof
      || !manifest.androidEvidence.loadGenerateCancelUnload
      || !manifest.androidEvidence.offlineProof
    ) {
      errors.push('release-like manifests require complete physical Android evidence');
    }
    if (!hasText(manifest.rollback.rollbackTargetManifestId)) {
      errors.push('release-like manifests require a rollback target');
    }
  }

  if (manifest.status === 'retired' || manifest.status === 'revoked') {
    if (manifest.rollout.downloadMode !== 'disabled' || (manifest.rollout.maxRolloutPercent ?? 0) !== 0) {
      errors.push(`${manifest.status} manifests must disable rollout`);
    }
  }

  return errors;
}

export function validateTunedMobileArtifactManifest(manifest: TunedMobileArtifactManifest): string[] {
  const errors: string[] = [];
  if (manifest.schema !== TUNED_MOBILE_ARTIFACT_MANIFEST_SCHEMA) {
    errors.push(`schema must be ${TUNED_MOBILE_ARTIFACT_MANIFEST_SCHEMA}`);
  }
  if (manifest.schemaVersion !== TUNED_MOBILE_ARTIFACT_MANIFEST_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${TUNED_MOBILE_ARTIFACT_MANIFEST_SCHEMA_VERSION}`);
  }
  for (const [field, value] of Object.entries({
    manifestId: manifest.manifestId,
    modelId: manifest.modelId,
    adapterModel: manifest.adapterModel,
    adapterRevision: manifest.adapterRevision,
    trainingRunId: manifest.trainingRunId,
    dataRegisterId: manifest.dataRegisterId,
    exportRunner: manifest.exportRunner,
    exportRunbook: manifest.exportRunbook,
    rollbackTargetManifestId: manifest.rollbackTargetManifestId,
  })) {
    if (!hasText(value)) errors.push(`${field} is required`);
  }
  if (hasText(manifest.manifestId) && !isSafeModelPathSegment(manifest.manifestId)) {
    errors.push('manifestId must be a safe path component');
  }
  if (hasText(manifest.modelId) && !isSafeNamespacedModelId(manifest.modelId)) {
    errors.push('modelId must contain only safe path components');
  }
  if (!isSafeModelPathSegment(manifest.artifact.fileName)) {
    errors.push('artifact fileName must be a safe path component');
  }
  if (!manifest.artifact.fileName.endsWith('.litertlm') || manifest.artifact.format !== 'litertlm') {
    errors.push('tuned mobile artifact must be registered as a .litertlm artifact');
  }
  if (!hasText(manifest.safetyReport.summaryId)) errors.push('structured safety summary is required');
  if (!hasText(manifest.androidProof.baseRuntimeDeviceMatrixDoc)) errors.push('base Android proof is required');
  if (!hasText(manifest.controlPolicy.controlId) || !isSha256(manifest.controlPolicy.sha256)) {
    errors.push('tuned mobile artifact requires a hash-bound control policy');
  }

  const statusIndex = TUNED_MOBILE_ARTIFACT_LIFECYCLE.indexOf(manifest.status);
  const expectedHistory = TUNED_MOBILE_ARTIFACT_LIFECYCLE.slice(0, statusIndex + 1);
  if (
    statusIndex < 0
    || manifest.stateHistory.length !== expectedHistory.length
    || manifest.stateHistory.some((entry, index) => (
      entry.state !== expectedHistory[index]
      || entry.evidenceRefs.length === 0
    ))
  ) {
    errors.push(`stateHistory must contain every lifecycle state through ${manifest.status} without skips`);
  }
  if (manifest.stateHistory.some((entry, index) => (
    index > 0 && Date.parse(entry.enteredAt) < Date.parse(manifest.stateHistory[index - 1].enteredAt)
  ))) {
    errors.push('stateHistory timestamps must be monotonic');
  }

  const producedOrLater = statusIndex >= TUNED_MOBILE_ARTIFACT_LIFECYCLE.indexOf('artifact-produced');
  if (producedOrLater) {
    if (!manifest.artifact.sha256 || !isSha256(manifest.artifact.sha256)) {
      errors.push(`${manifest.status} manifests require a 64-character artifact SHA-256`);
    }
    if (!Number.isSafeInteger(manifest.artifact.sizeBytes) || Number(manifest.artifact.sizeBytes) <= 0) {
      errors.push(`${manifest.status} manifests require a positive artifact size`);
    }
    if (
      !hasText(manifest.artifact.immutableLocation ?? undefined)
      || !hasText(manifest.artifact.fileInventoryRef ?? undefined)
      || manifest.artifact.downloadMode === 'disabled'
    ) {
      errors.push(`${manifest.status} manifests require immutable location, inventory, and distribution mode`);
    }
    if (
      manifest.exportPath.decision !== 'merge-peft-then-export-litertlm'
      || !hasText(manifest.exportTooling.exporterRepositoryRevision ?? undefined)
      || !hasText(manifest.exportTooling.pythonVersion ?? undefined)
      || Object.keys(manifest.exportTooling.packages).length === 0
      || !isSha256(manifest.exportTooling.tokenizer.metadataSha256 ?? '')
    ) {
      errors.push(`${manifest.status} manifests require complete pinned export tooling and tokenizer metadata`);
    }
    if (
      !manifest.deviceRequirements.minRamGb
      || !manifest.deviceRequirements.storageRequiredBytes
      || manifest.deviceRequirements.storageRequiredBytes < Number(manifest.artifact.sizeBytes)
    ) {
      errors.push(`${manifest.status} manifests require RAM and storage requirements covering the artifact`);
    }
  }

  if (manifest.status === 'export-blocked') {
    if (manifest.artifact.sha256 !== null) errors.push('export-blocked manifests must not invent an artifact SHA-256');
    if (manifest.artifact.sizeBytes !== null) errors.push('export-blocked manifests must not invent an artifact size');
    if (manifest.artifact.immutableLocation !== null || manifest.artifact.fileInventoryRef !== null) {
      errors.push('export-blocked manifests must not invent an immutable artifact location or inventory');
    }
    if (manifest.artifact.downloadMode !== 'disabled') {
      errors.push('export-blocked manifests must disable artifact distribution');
    }
    if (!hasText(manifest.exportPath.blocker) || manifest.exportPath.decision !== 'blocked') {
      errors.push('export-blocked manifests require an explicit blocked export path');
    }
    if (manifest.androidProof.tunedArtifactPhysicalDeviceProof) {
      errors.push('export-blocked manifests cannot claim tuned Android physical-device proof');
    }
  }

  const androidVerifiedOrLater = statusIndex >= TUNED_MOBILE_ARTIFACT_LIFECYCLE.indexOf('artifact-android-verified');
  if (androidVerifiedOrLater && manifest.status !== 'revoked') {
    if (
      !manifest.androidProof.tunedArtifactPhysicalDeviceProof
      || !hasText(manifest.androidProof.deviceEvidenceId ?? undefined)
      || !hasText(manifest.androidProof.deviceEvidenceRef ?? undefined)
    ) {
      errors.push(`${manifest.status} manifests require exact tuned-artifact Android evidence`);
    }
  }

  if (manifest.status === 'release-ready') {
    if (manifest.artifact.downloadMode !== 'app-download') {
      errors.push('release-ready manifests require approved app-download distribution');
    }
    if (
      manifest.attestation.status !== 'approved'
      || !hasText(manifest.attestation.attestationRef ?? undefined)
      || !hasText(manifest.attestation.approverRole ?? undefined)
      || !manifest.attestation.approvedAt
    ) {
      errors.push('release-ready manifests require organization artifact attestation');
    }
    if (Object.values(manifest.approvals).some(status => status !== 'approved')) {
      errors.push('release-ready manifests require legal, safety, and release approvals');
    }
  }

  return errors;
}

export function assertValidLocalAiManifest(
  manifest: SafeRideLocalAiManifest,
): asserts manifest is SafeRideLocalAiManifest {
  const errors = validateLocalAiManifest(manifest);
  if (errors.length > 0) throw new Error(`Invalid SafeRide local AI manifest: ${errors.join('; ')}`);
}

function loadLocalAiManifest(value: unknown): SafeRideLocalAiManifest {
  const manifest = value as SafeRideLocalAiManifest;
  assertValidLocalAiManifest(manifest);
  return manifest;
}

function loadTunedMobileArtifactManifest(value: unknown): TunedMobileArtifactManifest {
  const manifest = value as TunedMobileArtifactManifest;
  const errors = validateTunedMobileArtifactManifest(manifest);
  if (errors.length > 0) throw new Error(`Invalid tuned mobile artifact manifest: ${errors.join('; ')}`);
  return manifest;
}

export const GEMMA_4_E2B_LITERTLM_PROTOTYPE_MANIFEST = loadLocalAiManifest(baseGemma4ManifestJson);
export const SAFERIDE_GEMMA4_E2B_V03_TUNED_LITERTLM_EXPORT_BLOCKED_MANIFEST =
  loadTunedMobileArtifactManifest(v03TunedBlockedManifestJson);
export const SAFERIDE_GEMMA4_E2B_V058_ORIGINAL_419806_LITERTLM_ARTIFACT_PRODUCED_MANIFEST =
  loadTunedMobileArtifactManifest(v058TunedArtifactProducedManifestJson);
