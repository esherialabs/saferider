import Constants from 'expo-constants';

import { runtimeEnvSchema, type RuntimeEnv } from './runtime/schema';

type ExtraConfig = {
  runtime?: {
    environment?: string;
    buildProfile?: string;
    releaseLike?: boolean;
    releaseEndpointHosts?: string[];
    releaseStorageHosts?: string[];
    openAIEnabled?: boolean;
  };
  api?: {
    baseUrl?: string;
    timeoutMs?: number;
  };
  websocket?: {
    baseUrl?: string;
  };
  auth?: {
    baseUrl?: string;
  };
  storage?: {
    baseUrl?: string;
  };
  remoteConfig?: {
    url?: string;
    refreshSeconds?: number;
  };
  localAssistant?: {
    enabled?: boolean;
    preferOnDevice?: boolean;
    modelId?: string;
    allowRealLiteRtLmRuntime?: boolean;
    qaTunedArtifactManifestId?: string;
    artifact?: {
      fileName?: string;
      downloadUrl?: string;
      sha256?: string;
      sizeBytes?: number;
      contextWindow?: number;
      gpuLayers?: number;
      vramRequiredMb?: number;
    };
  };
  measurement?: {
    moderatedTestMode?: boolean;
    controlVersion?: string;
  };
  azureOpenAI?: {
    transcriptionEnabled?: boolean;
    endpoint?: string;
    deployment?: string;
    apiVersion?: string;
  };
};

function getExpoExtra(): ExtraConfig {
  const constants = Constants as unknown as {
    expoConfig?: { extra?: ExtraConfig };
    manifest2?: { extra?: { expoClient?: { extra?: ExtraConfig } } };
  };

  return (
    constants.expoConfig?.extra ??
    constants.manifest2?.extra?.expoClient?.extra ??
    {}
  );
}

function parseRuntimeEnv(): RuntimeEnv {
  const extra = getExpoExtra();

  const result = runtimeEnvSchema.safeParse({
    environment: extra.runtime?.environment,
    buildProfile: extra.runtime?.buildProfile,
    releaseLike: extra.runtime?.releaseLike,
    releaseEndpointHosts: extra.runtime?.releaseEndpointHosts,
    releaseStorageHosts: extra.runtime?.releaseStorageHosts,
    openAIEnabled: extra.runtime?.openAIEnabled,
    apiBaseUrl: extra.api?.baseUrl,
    apiTimeoutMs: extra.api?.timeoutMs,
    wsBaseUrl: extra.websocket?.baseUrl,
    authBaseUrl: extra.auth?.baseUrl,
    storageBaseUrl: extra.storage?.baseUrl,
    runtimeConfigUrl: extra.remoteConfig?.url,
    configRefreshSeconds: extra.remoteConfig?.refreshSeconds,
    localAssistant: {
      enabled: extra.localAssistant?.enabled,
      preferOnDevice: extra.localAssistant?.preferOnDevice,
      modelId: extra.localAssistant?.modelId,
      allowRealLiteRtLmRuntime: extra.localAssistant?.allowRealLiteRtLmRuntime,
      qaTunedArtifactManifestId: extra.localAssistant?.qaTunedArtifactManifestId,
      artifact: extra.localAssistant?.artifact,
    },
    measurement: {
      moderatedTestMode: extra.measurement?.moderatedTestMode,
      controlVersion: extra.measurement?.controlVersion,
    },
    azureOpenAI: {
      transcriptionEnabled: extra.azureOpenAI?.transcriptionEnabled,
      endpoint: extra.azureOpenAI?.endpoint,
      deployment: extra.azureOpenAI?.deployment,
      apiVersion: extra.azureOpenAI?.apiVersion,
    },
  });

  if (!result.success) {
    const details = result.error.issues
      .map(issue => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid SafeRide runtime environment: ${details}`);
  }

  return result.data;
}

export const env = parseRuntimeEnv();
export type { RuntimeEnv };
