import { NativeModules, Platform } from 'react-native';

import type { AssistantMessage } from './localGemmaEngine';
import {
  hasUnsafeModelPathTraversal,
  isSafeModelPathSegment,
  isSafeNamespacedModelId,
  isSafeRelativeModelPath,
} from './modelIdentity';
import type { LocalModelConfig, LocalLiteRtLmRuntime } from './modelRegistry';

export type SafeRideLiteRtLmBridgeState =
  | 'unavailable'
  | 'idle'
  | 'prepared'
  | 'loaded'
  | 'generating'
  | 'error';

export type SafeRideLiteRtLmBridgeStatus = {
  state: SafeRideLiteRtLmBridgeState;
  nativeAvailable: boolean;
  runtimeAvailable: boolean;
  mockMode: boolean;
  modelId?: string;
  manifestId?: string;
  realRuntimeLoaded?: boolean;
  artifactValidated?: boolean;
  backendLabel?: string;
  activeBackend?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
};

export type SafeRideLiteRtLmBridgeConfig = {
  modelId: string;
  manifestId: string;
  modelPath?: string;
  mockMode: boolean;
  allowRealRuntime: boolean;
  maxOutputTokens: number;
  expectedFileName: string;
  expectedSizeBytes: number;
  expectedSha256: string;
  contextWindow: number;
  backendPlan: string[];
  cachePolicy: LocalLiteRtLmRuntime['cachePolicy'];
  systemPrompt: string;
};

export type SafeRideLiteRtLmGenerateResult = {
  content: string;
  sourceLabel?: string;
  modelId?: string;
  manifestId?: string;
  mockMode?: boolean;
  backendLabel?: string;
  activeBackend?: string;
};

type NativeSafeRideLiteRtLmModule = {
  getStatus: () => Promise<Omit<SafeRideLiteRtLmBridgeStatus, 'nativeAvailable'>>;
  prepare: (config: SafeRideLiteRtLmBridgeConfig) => Promise<Omit<SafeRideLiteRtLmBridgeStatus, 'nativeAvailable'>>;
  load: (config: SafeRideLiteRtLmBridgeConfig) => Promise<Omit<SafeRideLiteRtLmBridgeStatus, 'nativeAvailable'>>;
  generate: (
    messages: AssistantMessage[],
    options?: { maxOutputTokens?: number; temperature?: number },
  ) => Promise<SafeRideLiteRtLmGenerateResult>;
  cancel: () => Promise<Omit<SafeRideLiteRtLmBridgeStatus, 'nativeAvailable'>>;
  unload: () => Promise<Omit<SafeRideLiteRtLmBridgeStatus, 'nativeAvailable'>>;
};

type LiteRtLmModelConfig = LocalModelConfig & { runtime: LocalLiteRtLmRuntime };

const NATIVE_MODULE_NAME = 'SafeRideLiteRtLm';
let nativeModuleOverride: NativeSafeRideLiteRtLmModule | null | undefined;

function nativeModule(): NativeSafeRideLiteRtLmModule | null {
  if (nativeModuleOverride !== undefined) {
    return nativeModuleOverride;
  }
  if (Platform.OS !== 'android') {
    return null;
  }
  return (NativeModules as Record<string, NativeSafeRideLiteRtLmModule | undefined>)[NATIVE_MODULE_NAME] ?? null;
}

function unavailableStatus(): SafeRideLiteRtLmBridgeStatus {
  return {
    state: 'unavailable',
    nativeAvailable: false,
    runtimeAvailable: false,
    mockMode: false,
  };
}

function normalizeStatus(
  status: Omit<SafeRideLiteRtLmBridgeStatus, 'nativeAvailable'>,
): SafeRideLiteRtLmBridgeStatus {
  return {
    ...status,
    state: status.state ?? 'idle',
    nativeAvailable: true,
    runtimeAvailable: Boolean(status.runtimeAvailable),
    mockMode: Boolean(status.mockMode),
  };
}

function requireNativeModule(): NativeSafeRideLiteRtLmModule {
  const module = nativeModule();
  if (!module) {
    throw new Error('SafeRide LiteRT-LM native bridge is unavailable in this build.');
  }
  return module;
}

export function isLiteRtLmModelConfig(modelConfig: LocalModelConfig): modelConfig is LiteRtLmModelConfig {
  return modelConfig.runtime.kind === 'litert-lm';
}

export function createSafeRideLiteRtLmBridgeConfig(
  modelConfig: LocalModelConfig,
  options: {
    modelPath?: string;
    mockMode?: boolean;
    allowRealRuntime?: boolean;
    maxOutputTokens?: number;
  } = {},
): SafeRideLiteRtLmBridgeConfig {
  if (!isLiteRtLmModelConfig(modelConfig)) {
    throw new Error(`${modelConfig.label} is not a LiteRT-LM model config.`);
  }
  if (!modelConfig.manifestId) {
    throw new Error(`${modelConfig.label} is missing a manifest id.`);
  }
  if (
    !isSafeNamespacedModelId(modelConfig.id)
    || !isSafeNamespacedModelId(modelConfig.runtime.modelId)
    || !isSafeModelPathSegment(modelConfig.manifestId)
    || !isSafeModelPathSegment(modelConfig.runtime.modelFileName)
    || !isSafeRelativeModelPath(modelConfig.storageDir)
  ) {
    throw new Error(`${modelConfig.label} has an invalid local model identity.`);
  }
  const modelPath = options.modelPath?.trim();
  if (modelPath && hasUnsafeModelPathTraversal(modelPath)) {
    throw new Error('SafeRide LiteRT-LM bridge model path is invalid.');
  }
  if (modelPath && !modelPath.endsWith('.litertlm')) {
    throw new Error('SafeRide LiteRT-LM bridge requires a .litertlm model path.');
  }
  if (modelPath && !modelPath.endsWith(`/${modelConfig.runtime.modelFileName}`)) {
    throw new Error('SafeRide LiteRT-LM bridge model path must match the manifest file name.');
  }
  const modelFile = modelConfig.files.find(file => file.fileName === modelConfig.runtime.modelFileName);
  if (!modelFile) {
    throw new Error(`${modelConfig.label} is missing the LiteRT-LM model artifact metadata.`);
  }
  if (!modelFile.sizeBytes || !Number.isSafeInteger(modelFile.sizeBytes) || modelFile.sizeBytes <= 0) {
    throw new Error(`${modelConfig.label} is missing an exact artifact byte size.`);
  }
  if (!modelFile.sha256 || !/^[a-f0-9]{64}$/i.test(modelFile.sha256)) {
    throw new Error(`${modelConfig.label} is missing an exact artifact SHA-256.`);
  }

  return {
    modelId: modelConfig.id,
    manifestId: modelConfig.manifestId,
    modelPath,
    mockMode: options.mockMode ?? false,
    allowRealRuntime: options.allowRealRuntime ?? false,
    maxOutputTokens: options.maxOutputTokens ?? modelConfig.runtime.maxOutputTokens,
    expectedFileName: modelConfig.runtime.modelFileName,
    expectedSizeBytes: modelFile.sizeBytes,
    expectedSha256: modelFile.sha256,
    contextWindow: modelConfig.runtime.contextWindow,
    backendPlan: modelConfig.runtime.backendPlan,
    cachePolicy: modelConfig.runtime.cachePolicy,
    systemPrompt: modelConfig.systemPrompt,
  };
}

export async function getSafeRideLiteRtLmBridgeStatus(): Promise<SafeRideLiteRtLmBridgeStatus> {
  const module = nativeModule();
  if (!module) {
    return unavailableStatus();
  }
  return normalizeStatus(await module.getStatus());
}

export async function prepareSafeRideLiteRtLmBridge(
  config: SafeRideLiteRtLmBridgeConfig,
): Promise<SafeRideLiteRtLmBridgeStatus> {
  return normalizeStatus(await requireNativeModule().prepare(config));
}

export async function loadSafeRideLiteRtLmBridge(
  config: SafeRideLiteRtLmBridgeConfig,
): Promise<SafeRideLiteRtLmBridgeStatus> {
  return normalizeStatus(await requireNativeModule().load(config));
}

export async function generateSafeRideLiteRtLmResponse(
  messages: AssistantMessage[],
  options?: { maxOutputTokens?: number; temperature?: number },
): Promise<SafeRideLiteRtLmGenerateResult> {
  const result = await requireNativeModule().generate(messages, options);
  if (!result.content.trim()) {
    throw new Error('SafeRide LiteRT-LM bridge returned an empty response.');
  }
  return result;
}

export async function cancelSafeRideLiteRtLmBridge(): Promise<SafeRideLiteRtLmBridgeStatus> {
  return normalizeStatus(await requireNativeModule().cancel());
}

export async function unloadSafeRideLiteRtLmBridge(): Promise<SafeRideLiteRtLmBridgeStatus> {
  return normalizeStatus(await requireNativeModule().unload());
}

export function __setSafeRideLiteRtLmNativeModuleForTests(
  module: NativeSafeRideLiteRtLmModule | null | undefined,
): void {
  nativeModuleOverride = module;
}
