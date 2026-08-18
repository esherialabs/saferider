import type {
  LargeModelDownloadAuthorization,
  ModelDownloadNetworkType,
} from './modelStorage';

type NetworkSnapshot = {
  type?: unknown;
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
};

export type ModelDownloadConsentDescriptor = {
  manifestId?: string;
  artifactSha256?: string;
  exactSizeBytes?: number;
};

export function classifyModelDownloadNetwork(snapshot: NetworkSnapshot): ModelDownloadNetworkType {
  if (snapshot.isConnected !== true || snapshot.isInternetReachable === false) return 'unknown';
  const type = String(snapshot.type ?? '').toLowerCase();
  if (type.includes('wifi') || type.includes('ethernet')) return 'wifi';
  if (type.includes('cellular') || type.includes('wimax')) return 'metered';
  return 'unknown';
}

export async function getModelDownloadNetworkType(
  getNetworkState?: () => Promise<NetworkSnapshot>,
): Promise<ModelDownloadNetworkType> {
  try {
    const resolveNetworkState = getNetworkState
      ?? (await import('expo-network')).getNetworkStateAsync;
    return classifyModelDownloadNetwork(await resolveNetworkState());
  } catch {
    return 'unknown';
  }
}

export function createLargeModelDownloadAuthorization(
  descriptor: ModelDownloadConsentDescriptor,
  networkType: ModelDownloadNetworkType,
  meteredNetworkAccepted: boolean,
  consentedAt = new Date(),
): LargeModelDownloadAuthorization {
  if (
    !descriptor.manifestId
    || !descriptor.artifactSha256
    || !/^[a-f0-9]{64}$/i.test(descriptor.artifactSha256)
    || !Number.isSafeInteger(descriptor.exactSizeBytes)
    || Number(descriptor.exactSizeBytes) <= 0
  ) {
    throw new Error('The selected local model is missing exact download identity metadata.');
  }
  return {
    manifestId: descriptor.manifestId,
    artifactSha256: descriptor.artifactSha256.toLowerCase(),
    acknowledgedSizeBytes: Number(descriptor.exactSizeBytes),
    consentedAt: consentedAt.toISOString(),
    networkType,
    meteredNetworkAccepted,
  };
}
