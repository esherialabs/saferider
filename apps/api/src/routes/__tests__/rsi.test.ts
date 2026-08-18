import Fastify, { type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { AppError } from '../../http/errors.js';
import { buildSuppressedRsiRelease } from '../../services/privacySuppressionService.js';
import { registerRsiRoutes } from '../rsi.js';

const state = vi.hoisted(() => ({
  enabled: new Set<string>(),
  role: 'survivor',
}));
const controls = vi.hoisted(() => ({
  schema: 'com.saferide.rsi-privacy-controls',
  schemaVersion: 1,
  controlVersion: 'rsi-privacy-controls.2026-07-30.1',
  activation: {
    signalIngestion: { status: 'enabled', reason: null },
    releaseGeneration: { status: 'disabled', reason: 'synthetic-test' },
    retentionExecution: { status: 'disabled', reason: 'synthetic-test' },
    operatorRead: { status: 'enabled', reason: null },
    export: { status: 'enabled', reason: null },
    dashboard: { status: 'disabled', reason: 'synthetic-test' },
  },
  approval: {
    status: 'approved', approvalId: 'synthetic-approval', approvedByRole: 'synthetic-reviewer',
    approvedAt: '2026-07-29T00:00:00.000Z', expiresAt: '2099-08-30T00:00:00.000Z', minimumCount: 10,
  },
  fixedBuckets: {
    areaDefinitionVersion: 'synthetic-area-v1', allowedAreaIds: ['cell-100-100'],
    allowedAreaTypes: ['coarse_cell', 'corridor'], timeBucketMinutes: 60, releaseCadenceHours: 24,
    categories: ['harassment'],
  },
  spatialTransform: {
    status: 'approved', executionBoundary: 'on_device', implementationVersion: 'synthetic-grid-v1',
    coarseCellSizeDegrees: 0.05, rawCoordinatesTransmitted: false,
  },
  consent: { requiredPurpose: 'anonymous_aggregate', requiredVersion: 'synthetic-consent-v1' },
  queryPolicy: {
    viewId: 'rsi-fixed-grid-v1', allowedQueryKeys: ['releaseId', 'viewId'],
    operatorRole: 'rsi_operator', requestsPerMinute: 30, maxRows: 500,
  },
  differentialPrivacy: {
    status: 'not_approved', epsilon: null, delta: null, sensitivity: null, clipping: null,
    composition: null, releaseCadenceHours: null, noiseMemoizationRequired: true,
  },
  rawSignalRetention: { status: 'approved', durationDays: 7 },
  syntheticTestProfile: {
    testOnly: true, profileId: 'synthetic', minimumCount: 10, timeBucketMinutes: 60,
    releaseCadenceHours: 24, allowedAreaIds: ['cell-100-100'], categories: ['harassment'],
  },
}));
const repository = vi.hoisted(() => ({
  getPublicRsiRelease: vi.fn(), submitAnonymousRsiSignalsWithConsent: vi.fn(),
  recordRsiOperatorAccess: vi.fn(),
}));
const access = vi.hoisted(() => ({
  enforceRsiRateLimit: vi.fn(), fingerprintRsiPrincipal: vi.fn(() => 'a'.repeat(64)),
}));
const auth = vi.hoisted(() => ({ requireAuth: vi.fn(), getAuth: vi.fn() }));
const audit = vi.hoisted(() => ({ auditEvent: vi.fn() }));

vi.mock('../../config/rsiControls.js', () => ({
  parseRsiControls: vi.fn((value: unknown) => value),
  getRsiCapabilityDecision: vi.fn((capability: string) => state.enabled.has(capability)
    ? { enabled: true, controls }
    : { enabled: false, reason: 'pending_synthetic_approval' }),
}));
vi.mock('../../repositories/rsiRepository.js', () => repository);
vi.mock('../../config/privacyControls.js', () => ({ isConsentPurposeEnabled: vi.fn(() => true) }));
vi.mock('../../services/rsiAccessControl.js', () => access);
vi.mock('../../services/auditService.js', () => audit);
vi.mock('../../middleware/auth.js', () => ({
  requireAuth: vi.fn(async (request: FastifyRequest) => {
    auth.requireAuth(request);
    if (!request.headers.authorization) throw new AppError(401, 'unauthorized', 'Authentication required');
  }),
  getAuth: vi.fn(() => ({ userId: '11111111-1111-4111-8111-111111111111', role: state.role })),
}));

async function buildApp() {
  const app = Fastify({ logger: false, genReqId: () => 'request-1' });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({ code: error.code, message: error.message, details: error.details, requestId: request.id });
    } else if (error instanceof ZodError) {
      reply.status(400).send({ code: 'bad_request', message: 'Invalid request', requestId: request.id });
    } else {
      reply.status(500).send({ code: 'internal_error', message: 'Internal error', requestId: request.id });
    }
  });
  await registerRsiRoutes(app);
  return app;
}

const releaseId = '22222222-2222-4222-8222-222222222222';
const signal = {
  schemaVersion: '1.0', configVersion: controls.controlVersion, policyVersion: controls.controlVersion,
  consentVersion: 'synthetic-consent-v1', area: { type: 'coarse_cell', id: 'cell-100-100' },
  timeBucket: '2026-07-30T10:00:00.000Z', category: 'harassment',
};
const consent = {
  recordId: '33333333-3333-4333-8333-333333333333', purpose: 'anonymous_aggregate',
  version: 'synthetic-consent-v1',
};
const ingestionId = '44444444-4444-4444-8444-444444444444';
const singleSubmission = { consent, ingestionId, signal };
const batchSubmission = (signals: unknown[]) => ({ consent, ingestionId, signals });

describe('RSI privacy routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => {
    vi.clearAllMocks();
    state.enabled.clear();
    state.role = 'survivor';
    repository.submitAnonymousRsiSignalsWithConsent.mockResolvedValue({ status: 'accepted', replayed: false });
    app = await buildApp();
  });
  afterEach(async () => app.close());

  it('fails closed before auth or persistence while mentor approval is absent', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/rsi/signals', payload: signal });
    expect(response.statusCode).toBe(503);
    expect(response.json().details.handoffId).toBe('HANDOFF-RSI-PRIVACY-MENTOR');
    expect(auth.requireAuth).not.toHaveBeenCalled();
    expect(repository.submitAnonymousRsiSignalsWithConsent).not.toHaveBeenCalled();
  });

  it('rejects forbidden content and stores only the minimized approved signal', async () => {
    state.enabled.add('signalIngestion');
    const forbidden = await app.inject({
      method: 'POST', url: '/api/rsi/signals', headers: { authorization: 'Bearer synthetic' },
      payload: { ...singleSubmission, signal: { ...signal, narrative: 'synthetic narrative' } },
    });
    expect(forbidden.statusCode).toBe(400);
    expect(repository.submitAnonymousRsiSignalsWithConsent).not.toHaveBeenCalled();

    const accepted = await app.inject({
      method: 'POST', url: '/api/rsi/signals', headers: { authorization: 'Bearer synthetic' }, payload: singleSubmission,
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ accepted: true });
    expect(repository.submitAnonymousRsiSignalsWithConsent).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: '11111111-1111-4111-8111-111111111111',
      consentRecordId: consent.recordId,
      ingestionId,
      signals: [expect.objectContaining({
        areaId: 'cell-100-100', category: 'harassment', consentVersion: 'synthetic-consent-v1',
      })],
    }));
    expect(JSON.stringify(repository.submitAnonymousRsiSignalsWithConsent.mock.calls[0][0].signals)).not.toContain('userId');
  });

  it('rejects a consent checkpoint that conflicts with authenticated server state', async () => {
    state.enabled.add('signalIngestion');
    repository.submitAnonymousRsiSignalsWithConsent.mockResolvedValueOnce({ status: 'consent_conflict' });
    const response = await app.inject({
      method: 'POST', url: '/api/rsi/signals', headers: { authorization: 'Bearer synthetic' }, payload: singleSubmission,
    });
    expect(response.statusCode).toBe(409);
  });

  it('accepts a bounded minimized batch atomically and rejects duplicate or forbidden members', async () => {
    state.enabled.add('signalIngestion');
    controls.fixedBuckets.categories = ['harassment', 'unsafe_driving'];
    const second = { ...signal, category: 'unsafe_driving' };
    const accepted = await app.inject({
      method: 'POST', url: '/api/rsi/signals/batch', headers: { authorization: 'Bearer synthetic' },
      payload: batchSubmission([signal, second]),
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ accepted: true, count: 2 });
    expect(repository.submitAnonymousRsiSignalsWithConsent).toHaveBeenCalledWith(expect.objectContaining({
      signals: [
        expect.objectContaining({ category: 'harassment' }),
        expect.objectContaining({ category: 'unsafe_driving' }),
      ],
    }));

    repository.submitAnonymousRsiSignalsWithConsent.mockClear();
    const duplicate = await app.inject({
      method: 'POST', url: '/api/rsi/signals/batch', headers: { authorization: 'Bearer synthetic' },
      payload: batchSubmission([signal, signal]),
    });
    expect(duplicate.statusCode).toBe(400);
    expect(repository.submitAnonymousRsiSignalsWithConsent).not.toHaveBeenCalled();

    const forbiddenMember = await app.inject({
      method: 'POST', url: '/api/rsi/signals/batch', headers: { authorization: 'Bearer synthetic' },
      payload: batchSubmission([{ ...signal, evidence: 'synthetic' }]),
    });
    expect(forbiddenMember.statusCode).toBe(400);
    expect(repository.submitAnonymousRsiSignalsWithConsent).not.toHaveBeenCalled();
  });

  it('requires the least-privilege operator role and audits denial without raw query data', async () => {
    state.enabled.add('operatorRead');
    const response = await app.inject({
      method: 'GET', url: `/api/rsi/releases/${releaseId}`, headers: { authorization: 'Bearer synthetic' },
    });
    expect(response.statusCode).toBe(403);
    expect(repository.getPublicRsiRelease).not.toHaveBeenCalled();
    expect(repository.recordRsiOperatorAccess).toHaveBeenCalledWith(expect.objectContaining({
      actorFingerprint: 'a'.repeat(64), outcome: 'denied', action: 'rsi.release.read',
    }));
  });

  it('returns the same immutable suppressed cells to screen and export paths', async () => {
    state.enabled.add('operatorRead');
    state.enabled.add('export');
    state.role = 'rsi_operator';
    const { release } = buildSuppressedRsiRelease([
      { areaId: 'cell-100-100', timeBucket: '2026-07-30T10:00:00.000Z', category: 'harassment', rawCount: 4 },
    ], { releaseId, viewId: 'rsi-fixed-grid-v1', minimumCount: 10, differentialPrivacy: { status: 'not_approved' } });
    repository.getPublicRsiRelease.mockResolvedValue({
      revisionSha256: release.revisionSha256, viewId: release.viewId, cells: release.cells,
    });
    const screen = await app.inject({
      method: 'GET', url: `/api/rsi/releases/${releaseId}`, headers: { authorization: 'Bearer synthetic' },
    });
    const exported = await app.inject({
      method: 'GET', url: `/api/rsi/releases/${releaseId}/export`, headers: { authorization: 'Bearer synthetic' },
    });
    expect(screen.statusCode).toBe(200);
    expect(exported.statusCode).toBe(200);
    expect(screen.json().cells).toEqual(exported.json().cells);
    expect(screen.json().cells[0]).toMatchObject({ state: 'suppressed', display: 'No data' });
    expect(screen.json().cells[0]).not.toHaveProperty('value');
  });

  it('rejects arbitrary filters and exposes no raw-signal operator route', async () => {
    state.enabled.add('operatorRead');
    state.role = 'rsi_operator';
    const filtered = await app.inject({
      method: 'GET', url: `/api/rsi/releases/${releaseId}?category=harassment`, headers: { authorization: 'Bearer synthetic' },
    });
    expect(filtered.statusCode).toBe(400);
    const raw = await app.inject({
      method: 'GET', url: '/api/rsi/signals/raw', headers: { authorization: 'Bearer synthetic' },
    });
    expect(raw.statusCode).toBe(404);
  });
});
