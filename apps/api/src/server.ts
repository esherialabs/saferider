import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { ZodError } from 'zod';

import { corsOriginList, env } from './config/env.js';
import { AppError } from './http/errors.js';
import { resolveRequestId } from './http/requestId.js';
import { privacySafeSerializers } from './logging/privacySafeSerializers.js';
import { registerRequestContext } from './middleware/requestContext.js';
import { closeDb } from './plugins/db.js';
import { registerMetrics } from './plugins/metrics.js';
import { redis } from './plugins/redis.js';
import { registerCaseRoutes } from './routes/cases.js';
import { registerCatalogRoutes } from './routes/catalog.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerDraftRoutes } from './routes/drafts.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerRuntimeConfigRoutes } from './routes/runtimeConfig.js';
import { registerPrivacyRoutes } from './routes/privacy.js';
import { registerRsiRoutes } from './routes/rsi.js';
import { registerAuthRoutes } from './routes/auth.js';

export async function buildApp() {
  const app: FastifyInstance = Fastify({
    logger: {
      level: env.logLevel,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.apikey',
          'req.headers.cookie',
          'req.headers.x-api-key',
          'req.headers.x-forwarded-for',
          'request.headers.authorization',
          'request.headers.apikey',
        ],
        censor: '[redacted]',
      },
      serializers: privacySafeSerializers,
    },
    genReqId: request => resolveRequestId(request.headers['x-request-id']),
  });

  await app.register(cors, { origin: corsOriginList(), credentials: true });
  await app.register(helmet);
  await registerRequestContext(app);
  await registerMetrics(app);
  await registerAuthRoutes(app);
  await registerHealthRoutes(app);
  await registerRuntimeConfigRoutes(app);
  await registerPrivacyRoutes(app);
  await registerRsiRoutes(app);
  await registerCatalogRoutes(app);
  await registerDraftRoutes(app);
  await registerCaseRoutes(app);
  await registerChatRoutes(app);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
        details: error.details,
        requestId: request.id,
      });
      return;
    }

    if (error instanceof ZodError) {
      reply.status(400).send({
        code: 'bad_request',
        message: 'Invalid request',
        details: error.flatten(),
        requestId: request.id,
      });
      return;
    }

    request.log.error({ err: error }, 'Unhandled API error');
    reply.status(500).send({
      code: 'internal_error',
      message: 'Internal server error',
      requestId: request.id,
    });
  });

  return app;
}

const app = await buildApp();

const shutdown = async () => {
  app.log.info('Shutting down SafeRide API');
  await app.close();
  await closeDb();
  redis.disconnect();
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

await app.listen({ host: env.apiHost, port: env.apiPort });
