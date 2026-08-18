import { sha256 } from '@noble/hashes/sha2.js';
import { z } from 'zod';

import controlsRaw from '../../config/product/case-export-controls.v1.json';
import { utf8ToBytes } from '../lib/utf8';

const caseStateSchema = z.enum([
  'draft',
  'submitted',
  'provider_pending',
  'referred',
  'follow_up',
  'closed',
  'failed',
  'queued',
]);

const attachmentSchema = z.object({
  attachmentId: z.string().min(1).max(200),
  type: z.enum(['photo', 'audio', 'video', 'document', 'other']),
  mimeCategory: z.enum(['image', 'audio', 'video', 'document', 'other']),
  sizeBytes: z.number().int().min(0).max(2_147_483_648),
  evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['local', 'queued', 'quarantined', 'verified', 'failed', 'deleted']),
}).strict();

const eventSchema = z.object({
  eventId: z.string().min(1).max(200),
  eventType: caseStateSchema,
  timestamp: z.string().datetime(),
  state: caseStateSchema,
  summaryCode: z.string().regex(/^[a-z][a-z0-9_.-]{2,63}$/),
  attachmentIds: z.array(z.string().min(1).max(200)).max(100),
}).strict();

const inputSchema = z.object({
  caseId: z.string().min(1).max(200),
  state: caseStateSchema,
  events: z.array(eventSchema).min(1).max(1000),
  attachments: z.array(attachmentSchema).max(500),
}).strict();

const controlSchema = z.object({
  schema: z.literal('com.saferide.case-export-controls'),
  schemaVersion: z.literal(1),
  controlId: z.string().min(1),
  status: z.enum(['blocked_external_evidence', 'approved', 'revoked']),
  publicSafeTimeline: z.object({
    schemaPath: z.literal('schemas/public-safe-case-timeline-export.schema.json'),
    inMemoryBuilderEnabled: z.boolean(),
    fileWriteEnabled: z.boolean(),
    shareEnabled: z.boolean(),
  }).strict(),
  protectedExport: z.object({
    enabled: z.boolean(),
    authenticatedEncryption: z.enum(['repository_tested_device_unverified', 'verified', 'revoked']),
    cleanup: z.enum(['repository_tested_device_unverified', 'verified', 'revoked']),
    independentPrivacyReview: z.enum(['pending', 'approved', 'rejected', 'expired']),
    reason: z.string().min(1),
  }).strict(),
  identity: z.object({
    rawCaseIdAllowedInOutput: z.boolean(),
    rawAttachmentIdAllowedInOutput: z.boolean(),
    perExportSaltRequired: z.boolean(),
  }).strict(),
  externalHandoffId: z.literal('HANDOFF-DEVICE-ENCRYPTED-STORAGE'),
  rollbackTarget: z.literal('fail-closed:no-protected-case-export'),
}).strict();

export const caseExportControls = controlSchema.parse(controlsRaw);
export const PROTECTED_CASE_EXPORT_UNAVAILABLE_MESSAGE =
  'Protected case export is not available in this build. You can still review case details in the app.';
export type CaseTimelineState = z.infer<typeof caseStateSchema>;
export type CaseTimelineExportInput = z.infer<typeof inputSchema>;

export interface PublicSafeCaseTimelineExport {
  schema: 'com.saferide.public-safe-case-timeline-export';
  schemaVersion: 1;
  classification: 'public-safe-metadata';
  exportMetadata: {
    generatedAt: string;
    publicSafe: true;
    protectedExportEnabled: false;
    providerReceiptClaimed: false;
  };
  case: {
    anonymizedId: string;
    state: CaseTimelineState;
    providerReceiptStatus: 'not_confirmed';
  };
  events: Array<{
    anonymizedId: string;
    eventType: CaseTimelineState;
    timestamp: string;
    state: CaseTimelineState;
    summaryCode: string;
    attachmentRefs: string[];
    evidenceHashRefs: string[];
  }>;
  attachments: Array<{
    anonymizedId: string;
    type: 'photo' | 'audio' | 'video' | 'document' | 'other';
    mimeCategory: 'image' | 'audio' | 'video' | 'document' | 'other';
    sizeBytes: number;
    evidenceSha256: string;
    status: 'local' | 'queued' | 'quarantined' | 'verified' | 'failed' | 'deleted';
  }>;
  limitations: string[];
}

export type CaseTimelineExportErrorCode =
  | 'invalid_input'
  | 'unsafe_field'
  | 'duplicate_identifier'
  | 'missing_attachment_reference'
  | 'protected_export_blocked';

export class CaseTimelineExportError extends Error {
  constructor(public readonly code: CaseTimelineExportErrorCode, message: string) {
    super(message);
    this.name = 'CaseTimelineExportError';
  }
}

const FORBIDDEN_INPUT_KEYS = new Set([
  'storagekey',
  'rawstoragekey',
  'fileuri',
  'filepath',
  'url',
  'location',
  'coordinates',
  'latitude',
  'longitude',
  'narrative',
  'description',
  'prompt',
  'completion',
  'transcript',
  'providercontact',
  'contactvalue',
]);

function findUnsafeKey(value: unknown, path: string[] = []): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const result = findUnsafeKey(value[index], [...path, String(index)]);
      if (result) return result;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
    if (FORBIDDEN_INPUT_KEYS.has(normalized)) return [...path, key].join('.');
    const result = findUnsafeKey(child, [...path, key]);
    if (result) return result;
  }
  return null;
}

function toHex(bytes: Uint8Array): string {
  let output = '';
  for (const byte of bytes) output += byte.toString(16).padStart(2, '0');
  return output;
}

function pseudonym(prefix: 'case' | 'event' | 'attachment', salt: string, ...parts: string[]): string {
  const digest = toHex(sha256(utf8ToBytes([salt, ...parts].join('\u0000'))));
  return `${prefix}_${digest.slice(0, 24)}`;
}

function uniqueOrThrow(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new CaseTimelineExportError('duplicate_identifier', `${label} identifiers must be unique.`);
  }
}

function requireUtcTimestamp(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new CaseTimelineExportError('invalid_input', 'Case timeline timestamps must be explicit UTC ISO-8601 values.');
  }
}

export function buildPublicSafeCaseTimelineExport(
  input: unknown,
  options: { exportSalt: string; generatedAt: string },
): PublicSafeCaseTimelineExport {
  const unsafeKey = findUnsafeKey(input);
  if (unsafeKey) {
    throw new CaseTimelineExportError('unsafe_field', `Public-safe case export input contains forbidden field ${unsafeKey}.`);
  }
  if (!/^[A-Za-z0-9._:-]{32,128}$/.test(options.exportSalt)) {
    throw new CaseTimelineExportError('invalid_input', 'A per-export non-secret salt of 32 to 128 safe characters is required.');
  }
  requireUtcTimestamp(options.generatedAt);

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CaseTimelineExportError('invalid_input', 'Case timeline export input does not match the minimized contract.');
  }
  const value = parsed.data;
  uniqueOrThrow(value.events.map(event => event.eventId), 'Event');
  uniqueOrThrow(value.attachments.map(attachment => attachment.attachmentId), 'Attachment');
  value.events.forEach(event => requireUtcTimestamp(event.timestamp));

  const attachmentById = new Map(value.attachments.map(attachment => [attachment.attachmentId, attachment]));
  for (const event of value.events) {
    for (const attachmentId of event.attachmentIds) {
      if (!attachmentById.has(attachmentId)) {
        throw new CaseTimelineExportError(
          'missing_attachment_reference',
          'A timeline event references attachment metadata that is not in the minimized export input.',
        );
      }
    }
  }

  const attachmentPseudonyms = new Map(value.attachments.map(attachment => [
    attachment.attachmentId,
    pseudonym('attachment', options.exportSalt, value.caseId, attachment.attachmentId),
  ]));

  return {
    schema: 'com.saferide.public-safe-case-timeline-export',
    schemaVersion: 1,
    classification: 'public-safe-metadata',
    exportMetadata: {
      generatedAt: options.generatedAt,
      publicSafe: true,
      protectedExportEnabled: false,
      providerReceiptClaimed: false,
    },
    case: {
      anonymizedId: pseudonym('case', options.exportSalt, value.caseId),
      state: value.state,
      providerReceiptStatus: 'not_confirmed',
    },
    events: [...value.events]
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.eventId.localeCompare(right.eventId))
      .map(event => {
        const referenced = event.attachmentIds.map(id => attachmentById.get(id)!);
        return {
          anonymizedId: pseudonym('event', options.exportSalt, value.caseId, event.eventId),
          eventType: event.eventType,
          timestamp: event.timestamp,
          state: event.state,
          summaryCode: event.summaryCode,
          attachmentRefs: event.attachmentIds.map(id => attachmentPseudonyms.get(id)!),
          evidenceHashRefs: referenced.map(attachment => attachment.evidenceSha256),
        };
      }),
    attachments: [...value.attachments]
      .map(attachment => ({
        anonymizedId: attachmentPseudonyms.get(attachment.attachmentId)!,
        type: attachment.type,
        mimeCategory: attachment.mimeCategory,
        sizeBytes: attachment.sizeBytes,
        evidenceSha256: attachment.evidenceSha256,
        status: attachment.status,
      }))
      .sort((left, right) => left.anonymizedId.localeCompare(right.anonymizedId)),
    limitations: [
      'This export contains public-safe status metadata only; it is not a survivor record, legal filing, provider receipt, or proof of service.',
      'Narratives, transcripts, exact locations, contacts, file names, storage keys, raw identifiers, media bytes, and provider payloads are excluded.',
      'Protected case export file writing and sharing remain disabled pending device encryption, cleanup, and independent privacy evidence.',
    ],
  };
}

export function evaluateProtectedCaseExportGate(
  evidence: { authenticatedEncryptionVerified: boolean; cleanupVerified: boolean; independentPrivacyReviewApproved: boolean },
  controls = caseExportControls,
): { enabled: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (!controls.protectedExport.enabled || controls.status !== 'approved') blockers.push('checked-in protected export control is not approved and enabled');
  if (!evidence.authenticatedEncryptionVerified) blockers.push('authenticated encryption lacks exact-build device verification');
  if (!evidence.cleanupVerified) blockers.push('export cleanup lacks exact-build device verification');
  if (!evidence.independentPrivacyReviewApproved) blockers.push('independent privacy review is absent');
  return { enabled: blockers.length === 0, blockers };
}

export function assertProtectedCaseExportAvailable(
  evidence: { authenticatedEncryptionVerified: boolean; cleanupVerified: boolean; independentPrivacyReviewApproved: boolean },
): void {
  const result = evaluateProtectedCaseExportGate(evidence);
  if (!result.enabled) {
    throw new CaseTimelineExportError('protected_export_blocked', 'Protected case export is unavailable until every encryption, cleanup, and review gate passes.');
  }
}
