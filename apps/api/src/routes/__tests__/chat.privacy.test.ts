import Fastify, { type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../http/errors.js';
import { registerChatRoutes } from '../chat.js';

const chatRepository = vi.hoisted(() => ({
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  getOrCreateSession: vi.fn(),
  insertMessage: vi.fn(),
  isChatSessionOwnedBy: vi.fn(),
  listMessages: vi.fn(),
  listSessions: vi.fn(),
}));

const privacyState = vi.hoisted(() => ({
  remoteChatIngestionEnabled: false,
}));

const redis = vi.hoisted(() => ({ publish: vi.fn() }));
const auditService = vi.hoisted(() => ({ auditEvent: vi.fn() }));

vi.mock('../../config/privacyControls.js', () => ({
  ACTIVE_PRIVACY_CONTROL_VERSION: 'privacy-controls.2026-07-30.2',
  isPrivacyCapabilityEnabled: vi.fn((capability: string) =>
    capability === 'remote_chat_ingestion' && privacyState.remoteChatIngestionEnabled),
}));
vi.mock('../../middleware/auth.js', () => ({
  requireAuth: vi.fn(async (request: FastifyRequest) => {
    if (!request.headers.authorization) throw Object.assign(new Error('Authentication required'), {
      statusCode: 401,
      code: 'unauthorized',
    });
  }),
  getAuth: vi.fn(() => ({ userId: 'owner-a' })),
}));
vi.mock('../../plugins/redis.js', () => ({ redis }));
vi.mock('../../repositories/chatRepository.js', () => chatRepository);
vi.mock('../../services/auditService.js', () => auditService);

describe('remote chat ingestion control', () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    privacyState.remoteChatIngestionEnabled = false;
  });
  afterEach(async () => Promise.all(apps.splice(0).map(app => app.close())));

  async function buildApp() {
    const app = Fastify({ logger: false });
    apps.push(app);
    app.setErrorHandler((error, request, reply) => {
      if (error instanceof AppError) {
        reply.status(error.statusCode).send({ code: error.code, message: error.message, requestId: request.id });
        return;
      }
      reply.status(500).send({ code: 'internal_error' });
    });
    await registerChatRoutes(app);
    return app;
  }

  it.each([
    ['/api/chat/sessions', { mode: 'legal-aid' }],
    ['/api/chat/session', { mode: 'legal-aid' }],
    ['/api/chat/message', { role: 'user', content: 'synthetic', mode: 'legal-aid' }],
  ])('blocks sensitive writes at %s while the capability is disabled', async (url, payload) => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: 'Bearer test-token' },
      payload,
    });

    expect(response.statusCode).toBe(503);
    expect(chatRepository.createSession).not.toHaveBeenCalled();
    expect(chatRepository.getOrCreateSession).not.toHaveBeenCalled();
    expect(chatRepository.insertMessage).not.toHaveBeenCalled();
  });

  it('still permits an owner to list existing sessions for access and deletion workflows', async () => {
    chatRepository.listSessions.mockResolvedValueOnce([]);
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/chat/sessions',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(chatRepository.listSessions).toHaveBeenCalledWith('owner-a');
  });

  it('returns not found without publishing or auditing when a supplied session is invalid or foreign', async () => {
    privacyState.remoteChatIngestionEnabled = true;
    chatRepository.insertMessage.mockResolvedValueOnce(null);
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat/message',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        sessionId: '11111111-1111-4111-8111-111111111111',
        role: 'user',
        content: 'synthetic',
        mode: 'legal-aid',
      },
    });

    expect(response.statusCode).toBe(404);
    expect(redis.publish).not.toHaveBeenCalled();
    expect(auditService.auditEvent).not.toHaveBeenCalled();
  });

  it('returns not found instead of an empty message list for an invalid or foreign session', async () => {
    chatRepository.isChatSessionOwnedBy.mockResolvedValueOnce(false);
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/chat/session/11111111-1111-4111-8111-111111111111/messages',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(404);
    expect(chatRepository.listMessages).not.toHaveBeenCalled();
  });
});
