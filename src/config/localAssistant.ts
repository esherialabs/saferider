import { env } from './env';

type LocalAssistantConfig = {
  enabled: boolean;
  preferOnDevice: boolean;
  modelId: string;
  allowRealLiteRtLmRuntime: boolean;
  qaTunedArtifactManifestId?: string;
  artifact?: {
    fileName: string;
    downloadUrl: string;
    sha256: string;
    sizeBytes: number;
    contextWindow?: number;
    gpuLayers?: number;
    vramRequiredMb?: number;
  };
};

export const localAssistantConfig: LocalAssistantConfig = {
  enabled: env.localAssistant.enabled,
  preferOnDevice: env.localAssistant.preferOnDevice,
  modelId: env.localAssistant.modelId,
  allowRealLiteRtLmRuntime: env.localAssistant.allowRealLiteRtLmRuntime,
  qaTunedArtifactManifestId: env.localAssistant.qaTunedArtifactManifestId,
  artifact: env.localAssistant.artifact,
};
