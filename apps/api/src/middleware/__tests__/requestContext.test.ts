import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { registerRequestContext } from '../requestContext.js';

describe('request context', () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map(app => app.close()));
  });

  async function buildApp() {
    const app = Fastify({ logger: false, genReqId: () => 'server-generated-request-id' });
    apps.push(app);
    await registerRequestContext(app);
    app.get('/request-id', async request => ({ requestId: request.id }));
    return app;
  }

  it('uses a valid client correlation ID consistently', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/request-id',
      headers: { 'x-request-id': 'client-correlation-01' },
    });

    expect(response.json()).toEqual({ requestId: 'client-correlation-01' });
    expect(response.headers['x-request-id']).toBe('client-correlation-01');
  });

  it('keeps unsafe client text out of the request context and response header', async () => {
    const app = await buildApp();
    const unsafeValue = 'sensitive narrative and exact location';
    const response = await app.inject({
      method: 'GET',
      url: '/request-id',
      headers: { 'x-request-id': unsafeValue },
    });

    expect(response.json()).toEqual({ requestId: 'server-generated-request-id' });
    expect(response.headers['x-request-id']).toBe('server-generated-request-id');
    expect(response.body).not.toContain(unsafeValue);
  });
});
