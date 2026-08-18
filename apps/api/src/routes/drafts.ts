import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { notFound, serviceUnavailable } from '../http/errors.js';
import { getAuth, requireAuth } from '../middleware/auth.js';
import { auditEvent } from '../services/auditService.js';
import { deleteDraft, getDraft, listDrafts } from '../repositories/draftRepository.js';
import { ACTIVE_PRIVACY_CONTROL_VERSION } from '../config/privacyControls.js';

export async function registerDraftRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/drafts', { preHandler: requireAuth }, async request => {
    const auth = getAuth(request);
    return { drafts: await listDrafts(auth.userId) };
  });

  app.get('/api/drafts/:id', { preHandler: requireAuth }, async request => {
    const auth = getAuth(request);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const draft = await getDraft(auth.userId, params.id);
    if (!draft) throw notFound('Draft not found');
    return { draft };
  });

  app.post('/api/drafts', { preHandler: requireAuth }, async request => {
    await auditEvent({
      action: 'draft.remote_write',
      resourceClass: 'draft',
      requestId: request.id,
      outcome: 'denied',
      policyVersion: ACTIVE_PRIVACY_CONTROL_VERSION,
    });
    throw serviceUnavailable('Remote draft persistence is disabled; save-private reports remain encrypted on this device', {
      handoffId: 'HANDOFF-PRIVACY-LEGAL-REVIEW',
    });
  });

  app.delete('/api/drafts/:id', { preHandler: requireAuth }, async request => {
    const auth = getAuth(request);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const deleted = await deleteDraft(auth.userId, params.id);

    await auditEvent({
      action: 'draft.delete',
      resourceClass: 'draft',
      requestId: request.id,
      outcome: deleted ? 'success' : 'denied',
      policyVersion: ACTIVE_PRIVACY_CONTROL_VERSION,
    });

    if (!deleted) throw notFound('Draft not found');
    return { ok: true };
  });
}
