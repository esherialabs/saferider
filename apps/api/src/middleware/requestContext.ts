import { FastifyInstance } from 'fastify';

import { resolveRequestId } from '../http/requestId.js';

export async function registerRequestContext(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request, reply) => {
    const id = resolveRequestId(request.headers['x-request-id'], () => request.id);

    request.id = id;
    reply.header('x-request-id', id);
  });
}
