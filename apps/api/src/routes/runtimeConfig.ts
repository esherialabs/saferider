import { FastifyInstance } from 'fastify';

import { env } from '../config/env.js';
import { loadPublicTunedArtifactRuntimeConfig } from '../services/tunedArtifactRuntimeConfig.js';

export async function registerRuntimeConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/config/runtime', async () => ({
    environment: env.appEnvironment,
    apiBaseUrl: env.apiPublicBaseUrl,
    wsBaseUrl: env.wsPublicBaseUrl,
    authBaseUrl: env.authPublicBaseUrl,
    storageBaseUrl: env.storagePublicBaseUrl,
    features: {
      ownedApi: true,
      ownedStorage: true,
      ownedRealtime: true,
      remoteTranscription: false,
    },
    localAi: loadPublicTunedArtifactRuntimeConfig(),
    refreshedAt: new Date().toISOString(),
  }));
}
