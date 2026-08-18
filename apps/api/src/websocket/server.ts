import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import pino from 'pino';
import client from 'prom-client';

import { corsOriginList, env } from '../config/env.js';
import { privacySafeSerializers } from '../logging/privacySafeSerializers.js';
import { verifyBearerToken } from '../middleware/auth.js';
import { duplicateRedis } from '../plugins/redis.js';
import { isChatSessionOwnedBy } from '../repositories/chatRepository.js';
import { resolveAuthorizedChatRoom, resolveChatRoomToLeave } from './chatRoomAuthorization.js';

const logger = pino({
  level: env.logLevel,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'socket.handshake.auth.token'],
    censor: '[redacted]',
  },
  serializers: privacySafeSerializers,
});
const httpServer = createServer();
const register = new client.Registry();
const CHAT_MESSAGE_CHANNEL = 'saferide:chat_messages';

client.collectDefaultMetrics({ register, prefix: 'saferide_ws_' });

const connectionsGauge = new client.Gauge({
  name: 'saferide_ws_connections',
  help: 'Active websocket connections',
  registers: [register],
});

const disconnectCounter = new client.Counter({
  name: 'saferide_ws_disconnects_total',
  help: 'Websocket disconnects by reason',
  labelNames: ['reason'],
  registers: [register],
});

const io = new Server(httpServer, {
  cors: {
    origin: corsOriginList(),
    credentials: true,
  },
});

const pubClient = duplicateRedis();
const subClient = duplicateRedis();
const eventSubClient = duplicateRedis();
await pubClient.connect();
await subClient.connect();
await eventSubClient.connect();
io.adapter(createAdapter(pubClient, subClient));

await eventSubClient.subscribe(CHAT_MESSAGE_CHANNEL);
eventSubClient.on('message', (channel, raw) => {
  if (channel !== CHAT_MESSAGE_CHANNEL) return;
  try {
    const payload = JSON.parse(raw) as { sessionId?: string; message?: unknown };
    if (!payload.sessionId || !payload.message) return;
    io.to(`chat:${payload.sessionId}`).emit('chat:message', payload.message);
  } catch (error) {
    logger.warn({ err: error }, 'failed to broadcast chat message');
  }
});

io.use(async (socket, next) => {
  const token =
    typeof socket.handshake.auth?.token === 'string'
      ? socket.handshake.auth.token
      : socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');

  if (!token) {
    next(new Error('Authentication required'));
    return;
  }

  try {
    const auth = await verifyBearerToken(token);
    socket.data.auth = auth;
    next();
  } catch (error) {
    logger.warn({ err: error }, 'websocket auth failed');
    next(new Error('Invalid token'));
  }
});

io.on('connection', socket => {
  const auth = socket.data.auth as { userId: string };
  connectionsGauge.inc();
  socket.join(`user:${auth.userId}`);

  socket.on('chat:join', async (payload: unknown, acknowledge?: (result: { ok: boolean }) => void) => {
    try {
      const room = await resolveAuthorizedChatRoom(auth.userId, payload, isChatSessionOwnedBy);
      if (!room) {
        acknowledge?.({ ok: false });
        return;
      }

      await socket.join(room);
      acknowledge?.({ ok: true });
    } catch (error) {
      logger.warn({ err: error }, 'chat room authorization failed');
      acknowledge?.({ ok: false });
    }
  });

  socket.on('chat:leave', async (payload: unknown) => {
    const room = resolveChatRoomToLeave(payload);
    if (room) await socket.leave(room);
  });

  socket.on('disconnect', reason => {
    connectionsGauge.dec();
    disconnectCounter.labels(reason).inc();
  });
});

httpServer.on('request', async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'saferide-websocket' }));
    return;
  }

  if (req.url === '/metrics') {
    res.writeHead(200, { 'content-type': register.contentType });
    res.end(await register.metrics());
    return;
  }
});

httpServer.listen(env.wsPort, env.wsHost, () => {
  logger.info({ host: env.wsHost, port: env.wsPort }, 'SafeRide websocket gateway listening');
});

const shutdown = async () => {
  logger.info('Shutting down SafeRide websocket gateway');
  io.close();
  pubClient.disconnect();
  subClient.disconnect();
  eventSubClient.disconnect();
  httpServer.close();
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
