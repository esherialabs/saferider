import { z } from 'zod';

import { rsiSignalSchema } from './rsiContracts.js';

const safeIdentifier = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9._:-]+$/);
const category = z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9 _-]+$/);

// Save-private is deliberately a local record contract, not an API body.
// No route accepts it; keeping the schema explicit prevents it from being
// confused with submitted-case payloads by validators and migration tooling.
export const savePrivateLocalRecordSchema = z.object({
  schemaVersion: z.literal('1.0'),
  workflowType: z.literal('save-private'),
  storage: z.literal('local-only'),
}).strict();

export const anonymousSignalSchema = rsiSignalSchema;

const referralSelectedFieldSchema = z.enum([
  'incident_categories',
  'time_context',
  'location_type',
  'ongoing_status',
]);

export const referralWorkflowSchema = z.object({
  schemaVersion: z.literal('1.0'),
  workflowType: z.literal('referral'),
  providerId: safeIdentifier,
  channel: z.enum(['call', 'whatsapp', 'sms']),
  supportBrief: z.union([
    z.object({
      included: z.literal(false),
      selectedFields: z.array(referralSelectedFieldSchema).length(0),
    }).strict(),
    z.object({
      included: z.literal(true),
      selectedFields: z.array(referralSelectedFieldSchema).min(1).max(4),
      incidentCategories: z.array(category).max(12).optional(),
      timeContext: z.object({
        date: z.string().date(),
        accuracy: z.enum(['exact', 'approximate', 'estimated']),
      }).strict().optional(),
      locationType: category.optional(),
      isOngoing: z.boolean().optional(),
    }).strict().superRefine((brief, ctx) => {
      const fieldToValue: Record<z.infer<typeof referralSelectedFieldSchema>, unknown> = {
        incident_categories: brief.incidentCategories,
        time_context: brief.timeContext,
        location_type: brief.locationType,
        ongoing_status: brief.isOngoing,
      };
      const selected = new Set(brief.selectedFields);
      for (const [field, value] of Object.entries(fieldToValue)) {
        if (selected.has(field as z.infer<typeof referralSelectedFieldSchema>) !== (value !== undefined)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['selectedFields'],
            message: `${field} selection must exactly match its supplied value`,
          });
        }
      }
    }),
  ]),
}).strict();

const packetEvidenceSchema = z.object({
  id: z.string().min(1).max(120),
  type: z.enum(['photo', 'video', 'audio', 'document']),
  label: z.string().min(1).max(180),
  sizeBytes: z.number().int().nonnegative().optional(),
  capturedAt: z.string().datetime().optional(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  description: z.string().max(2000).optional(),
  transcript: z.string().max(8000).optional(),
  metadataStatus: z.string().min(1).max(120),
  privacyRequests: z.array(z.string().min(1).max(180)).max(3),
}).strict();

export const escalationWorkflowSchema = z.object({
  schemaVersion: z.literal('1.0'),
  workflowType: z.literal('escalation'),
  packet: z.object({
    version: z.literal('1.0'),
    generatedAt: z.string().datetime(),
    pathway: z.literal('escalate'),
    redactionLevel: z.enum(['none', 'light', 'heavy']),
    contact: z.object({
      preference: z.enum(['alias', 'none']),
      alias: z.string().min(1).max(120).optional(),
      label: z.string().min(1).max(180),
    }).strict(),
    content: z.object({
      timeRange: z.string().max(180),
      location: z.string().max(500),
      incidentDescription: z.string().max(8000),
      statement: z.string().max(8000),
      impactSummary: z.string().max(2000).optional(),
      witnessDetails: z.string().max(2000).optional(),
      tags: z.array(z.string().max(80)).max(30),
      patterns: z.array(z.string().max(80)).max(30),
      transportIdentifiers: z.array(z.string().max(180)).max(10),
    }).strict(),
    evidenceManifest: z.array(packetEvidenceSchema).max(50),
    redaction: z.object({
      appliedLabels: z.array(z.string().max(180)).max(20),
      textFields: z.array(z.string().max(80)).max(20),
      evidenceMetadata: z.string().max(180),
      mediaProcessing: z.array(z.string().max(180)).max(10),
    }).strict(),
  }).strict(),
}).strict();

export const submittedCaseWorkflowSchema = z.object({
  schemaVersion: z.literal('1.0'),
  workflowType: z.literal('submitted-case'),
  pathway: z.literal('escalation'),
  submission: escalationWorkflowSchema,
}).strict();

export const createCaseSchema = z.object({
  idempotencyKey: z.string().uuid(),
  draftId: z.string().min(1).max(180).nullable().optional(),
  pathwayConsent: z.object({
    recordId: z.string().uuid(),
    purpose: z.literal('pathway_submission'),
    version: z.literal('pathway-consent.v1'),
  }).strict(),
  workflow: z.discriminatedUnion('workflowType', [referralWorkflowSchema, submittedCaseWorkflowSchema]),
}).strict().superRefine((submission, ctx) => {
  if (submission.idempotencyKey !== submission.pathwayConsent.recordId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['idempotencyKey'],
      message: 'submission idempotency must be bound to the pathway consent record',
    });
  }
});

export type CaseWorkflow = z.infer<typeof createCaseSchema>['workflow'];

export function buildLifecyclePayload(workflow: CaseWorkflow): Record<string, unknown> {
  return {
    schemaVersion: '1.0',
    workflowType: workflow.workflowType,
    status: 'submitted',
  };
}
