import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../repositories/catalogRepository', () => ({
  listLegalTags: vi.fn(),
  listTips: vi.fn(),
}));

import { AppError } from '../../http/errors';
import { registerCatalogRoutes } from '../catalog';

describe('provider catalog routes', () => {
  const app = Fastify({ logger: false });

  beforeEach(async () => {
    await registerCatalogRoutes(app);
    app.setErrorHandler((error, request, reply) => {
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send({
          code: error.code,
          message: error.message,
          details: error.details,
          requestId: request.id,
        });
      }
      return reply.status(500).send({ code: 'internal_error' });
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('fails closed for both the versioned and legacy endpoints', async () => {
    const pack = await app.inject({ method: 'GET', url: '/api/provider-pack' });
    expect(pack.statusCode).toBe(503);
    expect(pack.json()).toMatchObject({
      code: 'service_unavailable',
      details: { handoffId: 'HANDOFF-PROVIDER-PARTNER', reason: 'not-approved' },
    });
    expect(pack.body).not.toContain('providers');

    const legacy = await app.inject({ method: 'GET', url: '/api/providers' });
    expect(legacy.statusCode).toBe(503);
    expect(legacy.json()).toMatchObject({
      details: { handoffId: 'HANDOFF-PROVIDER-PARTNER', reason: 'provider-pack-required' },
    });
  });
});
