import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '../config/env.js';
import { getRetentionPolicy, isConsentPurposeEnabled, isPrivacyCapabilityEnabled, loadPrivacyControls } from '../config/privacyControls.js';
import { buildLifecyclePayload, createCaseSchema } from '../contracts/caseContracts.js';
import { badRequest, conflict, notFound, serviceUnavailable } from '../http/errors.js';
import { getAuth, requireAuth } from '../middleware/auth.js';
import {
  type AttachmentRow,
  CaseSubmissionConflictError,
  completeAttachment,
  createPendingAttachment,
  getCase,
  listAttachments,
  listCaseEvents,
  listCases,
  submitCaseTransaction,
} from '../repositories/caseRepository.js';
import { auditEvent } from '../services/auditService.js';
import { getEvidenceCompletionStatus, MAX_EVIDENCE_SIZE_BYTES } from '../services/evidenceUploadPolicy.js';
import { buildSafeEvidenceMetadata, getEvidenceProcessingErrors } from '../services/evidenceMetadata.js';
import { getEvidenceDownloadDecision } from '../services/evidenceQuarantine.js';
import {
  buildEvidenceObjectKey,
  createPresignedDownloadUrl,
  createPresignedUploadPolicy,
  deleteEvidenceObject,
  hashStoredObject,
} from '../storage/evidenceStorage.js';
import { uploadCounter } from '../plugins/metrics.js';

const evidenceRequestSchema = z.object({
  fileName: z.string().min(1).max(180),
  mimeType: z.string().min(1).max(120),
  sizeBytes: z.number().int().positive().max(MAX_EVIDENCE_SIZE_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  retentionPolicyId: z.string().regex(/^[a-z0-9-]+$/),
  metadata: z.record(z.unknown()).optional(),
}).strict();

type PublicAttachmentRow = Pick<
  AttachmentRow,
  'id' | 'case_id' | 'mime_type' | 'size_bytes' | 'metadata' | 'created_at' | 'status' |
  'antivirus_status' | 'quarantine_status' | 'retention_policy_id'
>;

function toPublicAttachment(row: AttachmentRow): PublicAttachmentRow {
  return {
    id: row.id,
    case_id: row.case_id,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    metadata: buildSafeEvidenceMetadata(row.metadata, row.mime_type ?? 'application/octet-stream'),
    created_at: row.created_at,
    status: row.status,
    antivirus_status: row.antivirus_status,
    quarantine_status: row.quarantine_status,
    retention_policy_id: row.retention_policy_id,
  };
}

function requirePrivacyPolicyVersion(): string {
  try {
    return loadPrivacyControls().controlVersion;
  } catch {
    throw serviceUnavailable('Privacy controls are unavailable');
  }
}

function requireSubmittedCaseIngestion(): void {
  if (!isPrivacyCapabilityEnabled('submitted_case_ingestion')) {
    throw serviceUnavailable('Submitted-case ingestion is disabled pending privacy and legal approval', {
      handoffId: 'HANDOFF-PRIVACY-LEGAL-REVIEW',
    });
  }
}

type ServerRetentionPolicy = NonNullable<ReturnType<typeof getRetentionPolicy>>;

function requireEvidenceIngestionPrerequisites(retentionPolicyId: string | null): {
  policyVersion: string;
  retentionPolicy: ServerRetentionPolicy;
} {
  requireSubmittedCaseIngestion();
  if (!isPrivacyCapabilityEnabled('server_retention_execution')) {
    throw serviceUnavailable('Evidence ingestion is disabled pending server retention approval', {
      handoffId: 'HANDOFF-PRIVACY-LEGAL-REVIEW',
    });
  }
  if (!retentionPolicyId) {
    throw serviceUnavailable('Evidence ingestion is disabled without an approved retention policy', {
      handoffId: 'HANDOFF-PRIVACY-LEGAL-REVIEW',
    });
  }

  let controls: ReturnType<typeof loadPrivacyControls>;
  let retentionPolicy: ReturnType<typeof getRetentionPolicy>;
  try {
    controls = loadPrivacyControls();
    retentionPolicy = getRetentionPolicy(retentionPolicyId, 'server');
  } catch {
    throw serviceUnavailable('Privacy controls are unavailable');
  }

  const scanPolicy = controls.malwareScanPolicy;
  const now = Date.now();
  if (
    scanPolicy.status !== 'enabled' ||
    !scanPolicy.approvalId ||
    !scanPolicy.scanner ||
    !scanPolicy.definitionVersion ||
    !scanPolicy.validFrom ||
    !scanPolicy.validUntil ||
    now < new Date(scanPolicy.validFrom).getTime() ||
    now >= new Date(scanPolicy.validUntil).getTime()
  ) {
    throw serviceUnavailable('Evidence ingestion is disabled pending a current approved malware scanner', {
      handoffId: 'HANDOFF-SECURITY-SCAN-APPROVAL',
    });
  }

  if (!retentionPolicy || retentionPolicy.approvalStatus === 'retired') {
    throw badRequest('Unknown or retired retention policy');
  }
  if (!retentionPolicy.executionEnabled || retentionPolicy.approvalStatus !== 'approved_legal') {
    throw serviceUnavailable('Evidence ingestion is disabled pending retention policy approval', {
      handoffId: 'HANDOFF-PRIVACY-LEGAL-REVIEW',
    });
  }

  return { policyVersion: controls.controlVersion, retentionPolicy };
}

export async function registerCaseRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/cases', { preHandler: requireAuth }, async request => {
    const auth = getAuth(request);
    return { cases: await listCases(auth.userId) };
  });

  app.post('/api/cases', { preHandler: requireAuth }, async request => {
    const auth = getAuth(request);
    const parsed = createCaseSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid case payload', parsed.error.flatten());
    requireSubmittedCaseIngestion();
    const policyVersion = requirePrivacyPolicyVersion();
    if (!isConsentPurposeEnabled(parsed.data.pathwayConsent.purpose, parsed.data.pathwayConsent.version)) {
      throw serviceUnavailable('Pathway submission consent is not enabled for this version');
    }

    let caseRecord;
    try {
      caseRecord = await submitCaseTransaction({
        ownerId: auth.userId,
        draftId: parsed.data.draftId,
        pathway: parsed.data.workflow.workflowType === 'referral' ? 'referral' : 'escalate',
        summary: {
          schemaVersion: '1.0',
          pathwayConsent: {
            recordId: parsed.data.pathwayConsent.recordId,
            purpose: parsed.data.pathwayConsent.purpose,
            version: parsed.data.pathwayConsent.version,
          },
          workflow: parsed.data.workflow,
        },
        lifecyclePayload: buildLifecyclePayload(parsed.data.workflow),
        consentRecordId: parsed.data.pathwayConsent.recordId,
        consentPurpose: parsed.data.pathwayConsent.purpose,
        consentVersion: parsed.data.pathwayConsent.version,
        idempotencyKey: parsed.data.idempotencyKey,
        requestId: request.id,
        policyVersion,
      });
    } catch (error) {
      if (error instanceof CaseSubmissionConflictError) {
        throw conflict('Case submission idempotency or consent record conflicts with an existing submission');
      }
      throw error;
    }

    return { case: caseRecord };
  });

  app.get('/api/cases/:id', { preHandler: requireAuth }, async request => {
    const auth = getAuth(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const caseRecord = await getCase(auth.userId, params.id);
    if (!caseRecord) throw notFound('Case not found');
    requireSubmittedCaseIngestion();
    const attachments = await listAttachments(auth.userId, params.id);
    const events = await listCaseEvents(auth.userId, params.id);
    return { case: caseRecord, attachments: attachments.map(toPublicAttachment), events };
  });

  app.post('/api/cases/:id/deletion-request', { preHandler: requireAuth }, async request => {
    const auth = getAuth(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const caseRecord = await getCase(auth.userId, params.id);
    if (!caseRecord) throw notFound('Case not found');
    const policyVersion = requirePrivacyPolicyVersion();

    await auditEvent({
      action: 'case.deletion_request',
      resourceClass: 'rights_request',
      requestId: request.id,
      outcome: 'denied',
      policyVersion,
    });
    throw serviceUnavailable('Submitted-case deletion intake is pending legal approval', {
      handoffId: 'HANDOFF-PRIVACY-LEGAL-REVIEW',
      replacementEndpoint: '/api/privacy/dsar',
    });
  });

  app.post('/api/cases/:id/evidence', { preHandler: requireAuth }, async request => {
    const auth = getAuth(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const parsed = evidenceRequestSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid evidence payload', parsed.error.flatten());
    const { policyVersion, retentionPolicy } = requireEvidenceIngestionPrerequisites(parsed.data.retentionPolicyId);

    const caseRecord = await getCase(auth.userId, params.id);
    if (!caseRecord) throw notFound('Case not found');

    const metadata = buildSafeEvidenceMetadata(parsed.data.metadata, parsed.data.mimeType);
    const processingErrors = getEvidenceProcessingErrors(parsed.data.metadata, {
      allowProcessedClaims: isPrivacyCapabilityEnabled('evidence_transform_processing'),
    });
    if (processingErrors.length > 0) {
      throw badRequest('Evidence processing claims are incomplete', { errors: processingErrors });
    }
    const objectKey = buildEvidenceObjectKey();
    const expiresInSeconds = 300;
    const uploadPolicy = await createPresignedUploadPolicy({
      objectKey,
      expirySeconds: expiresInSeconds,
      mimeType: parsed.data.mimeType,
      maxSizeBytes: MAX_EVIDENCE_SIZE_BYTES,
    });

    const attachment = await createPendingAttachment({
      ownerId: auth.userId,
      caseId: params.id,
      draftId: null,
      bucket: env.s3Bucket,
      objectKey,
      mimeType: parsed.data.mimeType,
      sizeBytes: parsed.data.sizeBytes,
      expectedSha256: parsed.data.sha256,
      uploadManifest: {
        displayName: metadata.displayName,
        mimeType: parsed.data.mimeType,
        sizeBytes: parsed.data.sizeBytes,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      },
      retentionPolicyId: retentionPolicy.policyId,
      metadata,
    });

    uploadCounter.labels('signed').inc();

    await auditEvent({
      action: 'evidence.signed_upload',
      resourceClass: 'attachment',
      requestId: request.id,
      outcome: 'success',
      policyVersion,
    });

    return {
      attachment: toPublicAttachment(attachment),
      upload: {
        method: 'POST',
        url: uploadPolicy.url,
        expiresInSeconds,
        fields: uploadPolicy.fields,
      },
    };
  });

  app.post('/api/cases/:caseId/evidence/:attachmentId/complete', { preHandler: requireAuth }, async request => {
    const auth = getAuth(request);
    const params = z.object({ caseId: z.string().uuid(), attachmentId: z.string().uuid() }).parse(request.params);
    const attachments = await listAttachments(auth.userId, params.caseId);
    const attachment = attachments.find(item => item.id === params.attachmentId);
    if (!attachment) throw notFound('Attachment not found');
    const { policyVersion } = requireEvidenceIngestionPrerequisites(attachment.retention_policy_id);

    const hashed = await hashStoredObject(attachment.bucket_path);
    const status = getEvidenceCompletionStatus({
      declaredSizeBytes: attachment.size_bytes,
      actualSizeBytes: hashed.sizeBytes,
      expectedSha256: attachment.expected_sha256,
      actualSha256: hashed.sha256,
    });

    if (status !== 'uploaded') {
      await deleteEvidenceObject(attachment.bucket_path);
    }

    const completed = await completeAttachment({
      ownerId: auth.userId,
      attachmentId: params.attachmentId,
      sha256: hashed.sha256,
      sizeBytes: hashed.sizeBytes,
      status,
    });

    if (!completed) throw notFound('Attachment not found');

    uploadCounter.labels(status).inc();

    await auditEvent({
      action: 'evidence.complete_upload',
      resourceClass: 'attachment',
      requestId: request.id,
      outcome: status === 'uploaded' ? 'success' : 'failed',
      policyVersion,
    });

    return { attachment: toPublicAttachment(completed) };
  });

  app.get('/api/cases/:caseId/evidence/:attachmentId/download', { preHandler: requireAuth }, async request => {
    const auth = getAuth(request);
    const params = z.object({ caseId: z.string().uuid(), attachmentId: z.string().uuid() }).parse(request.params);
    const policyVersion = requirePrivacyPolicyVersion();
    const attachments = await listAttachments(auth.userId, params.caseId);
    const attachment = attachments.find(item => item.id === params.attachmentId);
    if (!attachment) throw notFound('Attachment not found');

    const downloadDecision = getEvidenceDownloadDecision(attachment);
    if (!downloadDecision.allowed) {
      await auditEvent({
        action: 'evidence.signed_download',
        resourceClass: 'attachment',
        requestId: request.id,
        outcome: 'denied',
        policyVersion,
      });
      throw conflict('Evidence is not available for download', { reason: downloadDecision.reason });
    }

    const expiresInSeconds = 60;
    const url = await createPresignedDownloadUrl({
      objectKey: attachment.bucket_path,
      expirySeconds: expiresInSeconds,
    });

    await auditEvent({
      action: 'evidence.signed_download',
      resourceClass: 'attachment',
      requestId: request.id,
      outcome: 'success',
      policyVersion,
    });

    return { url, expiresInSeconds };
  });
}
