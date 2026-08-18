import Fastify, { type FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { AppError } from '../../http/errors.js';
import { indicatesMinor, registerAuthRoutes } from '../auth.js';

const testState = vi.hoisted(() => ({
  authSecret: 'test-auth-secret-with-enough-length',
}));

const db = vi.hoisted(() => ({
  query: vi.fn(),
}));

const privacyState = vi.hoisted(() => ({
  minorProcessingEnabled: false,
}));
const testPassword = 'test-password-placeholder';

vi.mock('../../config/env.js', () => ({
  env: {
    authJwtSecret: testState.authSecret,
  },
}));

vi.mock('../../plugins/db.js', () => db);
vi.mock('../../config/privacyControls.js', () => ({
  isPrivacyCapabilityEnabled: vi.fn(() => privacyState.minorProcessingEnabled),
}));

async function buildRouteApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    genReqId: () => 'req-auth-test-1',
  });

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

    reply.status(500).send({
      code: 'internal_error',
      message: 'Internal server error',
      requestId: request.id,
    });
  });

  await registerAuthRoutes(app);
  return app;
}

describe('auth user route', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    privacyState.minorProcessingEnabled = false;
    app = await buildRouteApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns a clean unauthorized response for malformed bearer tokens', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/user',
      headers: { authorization: 'Bearer not-a-jwt' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      code: 'unauthorized',
      message: 'Invalid or expired token',
      requestId: 'req-auth-test-1',
    });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('returns unauthorized for valid tokens that do not resolve to an owned user', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const token = await new SignJWT({ aud: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('missing-user')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(testState.authSecret));

    const response = await app.inject({
      method: 'GET',
      url: '/auth/user',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: 'unauthorized',
      message: 'Invalid or expired token',
      requestId: 'req-auth-test-1',
    });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('keeps minor processing disabled before account data is written', async () => {
    expect(indicatesMinor({ age: 17 }, new Date('2026-07-30'))).toBe(true);
    expect(indicatesMinor({ dateOfBirth: '2010-01-01' }, new Date('2026-07-30'))).toBe(true);
    expect(indicatesMinor({ age: 18 }, new Date('2026-07-30'))).toBe(false);
    const response = await app.inject({
      method: 'POST', url: '/auth/signup',
      payload: { email: 'synthetic@example.invalid', password: testPassword, data: { isMinor: true } },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().message).toContain('Remote account creation is disabled');
    expect(db.query).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    {},
    { isMinor: false },
    { isMinor: 'false' },
    { age: 18 },
  ])('does not treat unverified adult metadata as permission to create a remote account: %j', async data => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'synthetic@example.invalid', password: testPassword, data },
    });

    expect(response.statusCode).toBe(503);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('retains the explicit known-minor denial if safeguarding approval later enables processing', async () => {
    privacyState.minorProcessingEnabled = true;
    const response = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'synthetic@example.invalid', password: testPassword, data: { isMinor: true } },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().message).toContain('minors is unavailable');
    expect(db.query).not.toHaveBeenCalled();
  });
});
