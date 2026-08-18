import { FastifyInstance } from 'fastify';

import { env } from '../config/env.js';
import { query } from '../plugins/db.js';
import { redis } from '../plugins/redis.js';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({
    ok: true,
    service: 'saferide-api',
    mode: env.nodeEnv,
    timestamp: new Date().toISOString(),
  }));

  app.get('/ready', async () => {
    await query('select 1');
    if (redis.status === 'wait') {
      await redis.connect();
    }
    await redis.ping();
    return { ok: true };
  });
}
