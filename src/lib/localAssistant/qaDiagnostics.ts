import type { SafeRideLiteRtLmBridgeStatus } from './liteRtLmBridge';

export type TunedArtifactDeviceClass =
  | 'android-2-3gb'
  | 'android-4gb'
  | 'android-6-8gb'
  | 'android-unknown';

export type TunedArtifactQaDiagnostic = {
  schema: 'com.saferide.tuned-artifact-qa-diagnostic';
  schemaVersion: 1;
  manifestId: string;
  artifactSha256: string;
  runtimeState: SafeRideLiteRtLmBridgeStatus['state'];
  artifactValidated: boolean;
  realRuntimeLoaded: boolean;
  deviceClass: TunedArtifactDeviceClass;
  timings: {
    loadMs: number | null;
    firstTokenMs: number | null;
    totalGenerationMs: number | null;
  };
  result: {
    status: 'not-run' | 'passed' | 'failed' | 'cancelled';
    errorCode: string | null;
  };
  capturedAt: string;
};

function safeTiming(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function safeErrorCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 80);
  return normalized || 'UNCLASSIFIED';
}

export function createTunedArtifactQaDiagnostic(params: {
  manifestId: string;
  artifactSha256: string;
  bridgeStatus: SafeRideLiteRtLmBridgeStatus;
  deviceClass: TunedArtifactDeviceClass;
  timings?: Partial<TunedArtifactQaDiagnostic['timings']>;
  resultStatus: TunedArtifactQaDiagnostic['result']['status'];
  errorCode?: string | null;
  capturedAt?: Date;
}): TunedArtifactQaDiagnostic {
  if (!params.manifestId.trim()) throw new Error('QA diagnostic requires a manifest ID.');
  if (!/^[a-f0-9]{64}$/i.test(params.artifactSha256)) throw new Error('QA diagnostic requires an artifact SHA-256.');
  return {
    schema: 'com.saferide.tuned-artifact-qa-diagnostic',
    schemaVersion: 1,
    manifestId: params.manifestId,
    artifactSha256: params.artifactSha256.toLowerCase(),
    runtimeState: params.bridgeStatus.state,
    artifactValidated: params.bridgeStatus.artifactValidated === true,
    realRuntimeLoaded: params.bridgeStatus.realRuntimeLoaded === true,
    deviceClass: params.deviceClass,
    timings: {
      loadMs: safeTiming(params.timings?.loadMs),
      firstTokenMs: safeTiming(params.timings?.firstTokenMs),
      totalGenerationMs: safeTiming(params.timings?.totalGenerationMs),
    },
    result: {
      status: params.resultStatus,
      errorCode: safeErrorCode(params.errorCode ?? params.bridgeStatus.lastErrorCode),
    },
    capturedAt: (params.capturedAt ?? new Date()).toISOString(),
  };
}
