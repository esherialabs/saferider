import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { isConsentPurposeEnabled } from '../config/privacyControls.js';
import { getRsiCapabilityDecision, type RsiCapability } from '../config/rsiControls.js';
import { badRequest, conflict, forbidden, notFound, serviceUnavailable } from '../http/errors.js';
import { getAuth, requireAuth } from '../middleware/auth.js';
import {
  getPublicRsiRelease,
  recordRsiOperatorAccess,
  submitAnonymousRsiSignalsWithConsent,
} from '../repositories/rsiRepository.js';
import { auditEvent } from '../services/auditService.js';
import { buildVerifiedStoredRsiRelease } from '../services/differencingProtectionService.js';
import { enforceRsiRateLimit, fingerprintRsiPrincipal } from '../services/rsiAccessControl.js';
import { validateFixedRsiQuery } from '../services/privacySuppressionService.js';
import {
  findForbiddenRsiFields,
  validateRsiSignalBatchSubmission,
  validateRsiSignalSubmission,
} from '../services/rsiSignalService.js';

const HANDOFF_ID = 'HANDOFF-RSI-PRIVACY-MENTOR';

function requireCapability(capability: RsiCapability) {
  const decision = getRsiCapabilityDecision(capability);
  if (!decision.enabled) {
    throw serviceUnavailable('RSI capability is disabled pending privacy approval', {
      handoffId: HANDOFF_ID,
      reason: decision.reason,
    });
  }
  return decision.controls;
}

function requireAggregateConsentCapability(consentVersion: string): void {
  if (!isConsentPurposeEnabled('anonymous_aggregate', consentVersion)) {
    throw serviceUnavailable('Anonymous aggregate consent is disabled pending privacy approval', {
      handoffId: HANDOFF_ID,
    });
  }
}

async function persistSignalSubmission(params: {
  request: FastifyRequest;
  ownerId: string;
  consentRecordId: string;
  ingestionId: string;
  consentVersion: string;
  signals: ReturnType<typeof validateRsiSignalBatchSubmission>['signals'];
  action: 'rsi.signal.accept' | 'rsi.signal.batch.accept';
  controlVersion: string;
}) {
  const result = await submitAnonymousRsiSignalsWithConsent({
    ownerId: params.ownerId,
    consentRecordId: params.consentRecordId,
    consentVersion: params.consentVersion,
    ingestionId: params.ingestionId,
    signals: params.signals,
  });
  if (result.status !== 'accepted') {
    if (result.status === 'area_unavailable') {
      throw badRequest('One or more RSI area definitions are unavailable or not approved');
    }
    if (result.status === 'consent_conflict') {
      throw conflict('Anonymous aggregate consent checkpoint conflicts with server state');
    }
    throw conflict('RSI ingestion identifier was already used for a different submission');
  }
  if (!result.replayed) {
    await auditEvent({
      action: 'consent.grant',
      resourceClass: 'consent',
      requestId: params.request.id,
      outcome: 'success',
      policyVersion: params.controlVersion,
    });
  }
  await auditEvent({
    action: params.action,
    resourceClass: 'anonymous_aggregate_signal',
    requestId: params.request.id,
    outcome: 'success',
    policyVersion: params.controlVersion,
  });
}

async function handleOperatorRelease(params: {
  request: FastifyRequest;
  reply: FastifyReply;
  capability: 'operatorRead' | 'export';
  action: 'rsi.release.read' | 'rsi.release.export';
}) {
  const controls = requireCapability(params.capability);
  await requireAuth(params.request, params.reply);
  const auth = getAuth(params.request);
  const routeParams = params.request.params as { releaseId?: string };
  const query = params.request.query as Record<string, unknown>;
  const parsed = validateFixedRsiQuery({
    ...query,
    releaseId: routeParams.releaseId,
    viewId: query.viewId ?? controls.queryPolicy.viewId,
  });
  const fingerprint = fingerprintRsiPrincipal(auth.userId);
  if (auth.role !== controls.queryPolicy.operatorRole) {
    await recordRsiOperatorAccess({
      actorFingerprint: fingerprint,
      requestId: params.request.id,
      action: params.action,
      releaseId: parsed.releaseId,
      outcome: 'denied',
      policyVersion: controls.controlVersion,
    });
    throw forbidden('RSI operator role required');
  }
  await enforceRsiRateLimit({
    principalFingerprint: fingerprint,
    action: params.capability === 'export' ? 'export' : 'read',
    requestsPerMinute: controls.queryPolicy.requestsPerMinute,
  });
  try {
    const stored = await getPublicRsiRelease(parsed.releaseId, controls.queryPolicy.maxRows);
    if (!stored || stored.viewId !== parsed.viewId) throw notFound('Published RSI release not found');
    const release = buildVerifiedStoredRsiRelease({
      releaseId: parsed.releaseId,
      viewId: stored.viewId,
      storedRevisionSha256: stored.revisionSha256,
      cells: stored.cells,
    });
    await recordRsiOperatorAccess({
      actorFingerprint: fingerprint,
      requestId: params.request.id,
      action: params.action,
      releaseId: parsed.releaseId,
      outcome: 'success',
      policyVersion: controls.controlVersion,
    });
    return params.reply.send({
      ...release,
      representation: params.capability === 'export' ? 'export' : 'screen-api',
    });
  } catch (error) {
    const outcome = error instanceof Error && error.name === 'AppError' && 'statusCode' in error && error.statusCode === 404
      ? 'denied'
      : 'failed';
    await recordRsiOperatorAccess({
      actorFingerprint: fingerprint,
      requestId: params.request.id,
      action: params.action,
      releaseId: parsed.releaseId,
      outcome,
      policyVersion: controls.controlVersion,
    });
    throw error;
  }
}

export async function registerRsiRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/rsi/signals', async (request, reply) => {
    const controls = requireCapability('signalIngestion');
    const forbiddenFields = findForbiddenRsiFields(request.body);
    if (forbiddenFields.length > 0) throw badRequest('RSI signal contains forbidden fields', { forbiddenFields });
    await requireAuth(request, reply);
    const auth = getAuth(request);
    const principalFingerprint = fingerprintRsiPrincipal(auth.userId);
    await enforceRsiRateLimit({
      principalFingerprint,
      action: 'signal',
      requestsPerMinute: controls.queryPolicy.requestsPerMinute,
    });
    requireAggregateConsentCapability(controls.consent.requiredVersion!);
    const submission = validateRsiSignalSubmission(request.body, controls);
    await persistSignalSubmission({
      request,
      ownerId: auth.userId,
      consentRecordId: submission.consentRecordId,
      ingestionId: submission.ingestionId,
      consentVersion: submission.signals[0].consentVersion,
      signals: submission.signals,
      action: 'rsi.signal.accept',
      controlVersion: controls.controlVersion,
    });
    return { accepted: true };
  });

  app.post('/api/rsi/signals/batch', async (request, reply) => {
    const controls = requireCapability('signalIngestion');
    const forbiddenFields = findForbiddenRsiFields(request.body);
    if (forbiddenFields.length > 0) throw badRequest('RSI signal batch contains forbidden fields', { forbiddenFields });
    await requireAuth(request, reply);
    const auth = getAuth(request);
    const principalFingerprint = fingerprintRsiPrincipal(auth.userId);
    await enforceRsiRateLimit({
      principalFingerprint,
      action: 'signal',
      requestsPerMinute: controls.queryPolicy.requestsPerMinute,
    });
    requireAggregateConsentCapability(controls.consent.requiredVersion!);
    const submission = validateRsiSignalBatchSubmission(request.body, controls);
    await persistSignalSubmission({
      request,
      ownerId: auth.userId,
      consentRecordId: submission.consentRecordId,
      ingestionId: submission.ingestionId,
      consentVersion: submission.signals[0].consentVersion,
      signals: submission.signals,
      action: 'rsi.signal.batch.accept',
      controlVersion: controls.controlVersion,
    });
    return { accepted: true, count: submission.signals.length };
  });

  app.get('/api/rsi/releases/:releaseId', async (request, reply) => {
    return handleOperatorRelease({ request, reply, capability: 'operatorRead', action: 'rsi.release.read' });
  });

  app.get('/api/rsi/releases/:releaseId/export', async (request, reply) => {
    return handleOperatorRelease({ request, reply, capability: 'export', action: 'rsi.release.export' });
  });
}
