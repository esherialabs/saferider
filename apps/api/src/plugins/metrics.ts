import { FastifyInstance } from 'fastify';
import client from 'prom-client';

export const register = new client.Registry();

client.collectDefaultMetrics({ register, prefix: 'saferide_' });

export const httpRequestDuration = new client.Histogram({
  name: 'saferide_api_request_duration_seconds',
  help: 'API request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

export const uploadCounter = new client.Counter({
  name: 'saferide_upload_requests_total',
  help: 'Evidence upload requests by outcome',
  labelNames: ['outcome'],
  registers: [register],
});

export const authFailureCounter = new client.Counter({
  name: 'saferide_auth_failures_total',
  help: 'Authentication failures',
  labelNames: ['reason'],
  registers: [register],
});

export async function registerMetrics(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async request => {
    (request as typeof request & { metricsStart?: bigint }).metricsStart = process.hrtime.bigint();
  });

  app.addHook('onResponse', async (request, reply) => {
    const started = (request as typeof request & { metricsStart?: bigint }).metricsStart;
    if (!started) return;
    const durationSeconds = Number(process.hrtime.bigint() - started) / 1_000_000_000;
    httpRequestDuration
      .labels(request.method, request.routeOptions.url ?? request.url, String(reply.statusCode))
      .observe(durationSeconds);
  });

  app.get('/metrics', async (_request, reply) => {
    reply.header('content-type', register.contentType);
    return register.metrics();
  });
}
