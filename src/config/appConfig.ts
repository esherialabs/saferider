import { env } from './env';

type ApiConfig = {
  baseUrl: string;
  timeoutMs: number;
};

type WebSocketConfig = {
  baseUrl: string;
};

type EndpointConfig = {
  baseUrl: string;
};

type RemoteConfig = {
  url?: string;
  refreshSeconds: number;
};

type ReleaseEndpointPolicy = {
  releaseLike: boolean;
  endpointHosts: string[];
  storageHosts: string[];
};

type ResolvedConfig = {
  environment: string;
  buildProfile?: string;
  api: ApiConfig;
  websocket: WebSocketConfig;
  auth: EndpointConfig;
  storage: EndpointConfig;
  remoteConfig: RemoteConfig;
  releaseEndpointPolicy: ReleaseEndpointPolicy;
};

const releaseLike =
  env.releaseLike ||
  env.environment === 'staging' ||
  env.environment === 'production' ||
  env.buildProfile === 'preview' ||
  env.buildProfile === 'production';

export const appConfig: ResolvedConfig = {
  environment: env.environment,
  buildProfile: env.buildProfile,
  api: {
    baseUrl: env.apiBaseUrl,
    timeoutMs: env.apiTimeoutMs,
  },
  websocket: {
    baseUrl: env.wsBaseUrl,
  },
  auth: {
    baseUrl: env.authBaseUrl,
  },
  storage: {
    baseUrl: env.storageBaseUrl,
  },
  remoteConfig: {
    url: env.runtimeConfigUrl,
    refreshSeconds: env.configRefreshSeconds,
  },
  releaseEndpointPolicy: {
    releaseLike,
    endpointHosts: env.releaseEndpointHosts,
    storageHosts: env.releaseStorageHosts,
  },
};

export type AppConfig = ResolvedConfig;
