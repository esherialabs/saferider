import { FastifyInstance } from 'fastify';

import { serviceUnavailable } from '../http/errors.js';
import { listLegalTags, listTips } from '../repositories/catalogRepository.js';
import { loadProviderPackDistribution } from '../services/providerPackDistribution.js';

export async function registerCatalogRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/providers', async () => {
    throw serviceUnavailable('Unversioned provider distribution is disabled; use the verified provider-pack endpoint', {
      handoffId: 'HANDOFF-PROVIDER-PARTNER',
      reason: 'provider-pack-required',
    });
  });
  app.get('/api/provider-pack', async () => {
    const decision = loadProviderPackDistribution();
    if (!decision.enabled) {
      throw serviceUnavailable('Provider pack distribution is disabled pending partner validation and release attestation', {
        handoffId: 'HANDOFF-PROVIDER-PARTNER',
        reason: decision.reason,
      });
    }
    return {
      pack: decision.pack,
      manifest: decision.manifest,
      controlVersion: decision.controlVersion,
    };
  });
  app.get('/api/tips', async () => ({ tips: await listTips() }));
  app.get('/api/legal-tags', async () => ({ tags: await listLegalTags() }));
}
