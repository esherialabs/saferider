import { z } from 'zod';

export const MEASUREMENT_EVENT_SCHEMA_VERSION = 'measurement-event.v1' as const;
export const COARSE_TIME_BUCKET_MS = 15_000;

export const MEASUREMENT_EVENT_NAMES = [
  'report_start',
  'step_complete',
  'report_complete',
  'consent_review',
  'referral_select',
  'contact_action',
  'export_attempt',
  'ai_preparation',
  'error_outcome',
] as const;

export const MEASUREMENT_SCREEN_IDS = [
  'home',
  'what-happened',
  'where-when',
  'evidence-detail',
  'consent-gate',
  'referral-picker',
  'privacy-data',
  'chat-legal-aid',
  'test-measurement-consent',
  'issue-report',
  'test-session-summary',
] as const;

export const MEASUREMENT_TASK_IDS = [
  'report-flow',
  'consent-review',
  'referral-selection',
  'provider-contact',
  'privacy-export',
  'ai-setup',
] as const;

export const MEASUREMENT_OUTCOMES = [
  'started',
  'completed',
  'cancelled',
  'blocked',
  'failed',
  'retry',
] as const;

export const MEASUREMENT_ASSISTANCE = ['none', 'moderator', 'not_recorded'] as const;

export const MEASUREMENT_ERROR_CODES = [
  'validation',
  'storage_unavailable',
  'network_unavailable',
  'permission_denied',
  'submit_failed',
  'configuration_blocked',
  'unknown_sanitized',
] as const;

export const MEASUREMENT_FEATURE_FLAGS = [
  'offline',
  'high-contrast',
  'local-ai-enabled',
  'measurement-banner-visible',
] as const;

const safeVersion = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/);
const safeAndroidVersion = z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9._ -]+$/);

export const measurementDiagnosticsSchema = z.object({
  appVersion: safeVersion,
  deviceTier: z.enum(['unknown', 'small-low-end', 'standard', 'high']),
  androidVersion: safeAndroidVersion,
  featureFlags: z.array(z.enum(MEASUREMENT_FEATURE_FLAGS)).max(MEASUREMENT_FEATURE_FLAGS.length),
}).strict();

const measurementEventInputSchema = z.object({
  name: z.enum(MEASUREMENT_EVENT_NAMES),
  screenId: z.enum(MEASUREMENT_SCREEN_IDS),
  taskId: z.enum(MEASUREMENT_TASK_IDS),
  outcome: z.enum(MEASUREMENT_OUTCOMES),
  assistance: z.enum(MEASUREMENT_ASSISTANCE).nullable().optional(),
  errorCode: z.enum(MEASUREMENT_ERROR_CODES).nullable().optional(),
  diagnostics: measurementDiagnosticsSchema.nullable().optional(),
  diagnosticsReviewed: z.literal(true).optional(),
}).strict();

export type MeasurementEventInput = z.input<typeof measurementEventInputSchema>;
export type MeasurementDiagnostics = z.infer<typeof measurementDiagnosticsSchema>;

export type MeasurementEvent = z.infer<typeof measurementEventInputSchema> & {
  schemaVersion: typeof MEASUREMENT_EVENT_SCHEMA_VERSION;
  eventId: string;
  sessionId: string;
  controlVersion: string;
  consentVersion: string;
  recordedAtBucket: string;
  elapsedMsBucket: number;
  expiresAtBucket: string;
  errorCode: typeof MEASUREMENT_ERROR_CODES[number] | null;
  diagnostics: MeasurementDiagnostics | null;
};

export function floorToCoarseTimeBucket(timestampMs: number): number {
  if (!Number.isFinite(timestampMs) || timestampMs < 0) {
    throw new Error('Measurement timestamp must be a non-negative finite number.');
  }
  return Math.floor(timestampMs / COARSE_TIME_BUCKET_MS) * COARSE_TIME_BUCKET_MS;
}

export function createMeasurementEvent(params: {
  input: MeasurementEventInput;
  eventId: string;
  sessionId: string;
  sessionStartedAtBucketMs: number;
  controlVersion: string;
  consentVersion: string;
  retentionHours: number;
  now?: Date;
}): MeasurementEvent {
  if (!Number.isInteger(params.retentionHours) || params.retentionHours < 1 || params.retentionHours > 168) {
    throw new Error('Measurement retention must be an approved whole number of hours from 1 to 168.');
  }
  const input = measurementEventInputSchema.parse(params.input);
  if ((input.diagnostics !== undefined && input.diagnostics !== null) !== (input.diagnosticsReviewed === true)) {
    throw new Error('Optional diagnostics require an explicit user review confirmation.');
  }
  if (input.name === 'error_outcome' && (!input.errorCode || !['failed', 'blocked', 'retry'].includes(input.outcome))) {
    throw new Error('Error outcomes require an allowlisted error code and failed, blocked, or retry outcome.');
  }
  if (input.name !== 'error_outcome' && input.errorCode) {
    throw new Error('Error codes are allowed only on error_outcome events.');
  }
  if ((input.name === 'report_complete') !== (input.assistance !== undefined && input.assistance !== null)) {
    throw new Error('Report completion events require an assistance value; other events must omit it.');
  }

  const recordedAtBucketMs = floorToCoarseTimeBucket((params.now ?? new Date()).getTime());
  const sessionStartedAtBucketMs = floorToCoarseTimeBucket(params.sessionStartedAtBucketMs);
  return {
    ...input,
    schemaVersion: MEASUREMENT_EVENT_SCHEMA_VERSION,
    eventId: params.eventId,
    sessionId: params.sessionId,
    controlVersion: params.controlVersion,
    consentVersion: params.consentVersion,
    recordedAtBucket: new Date(recordedAtBucketMs).toISOString(),
    elapsedMsBucket: Math.max(0, recordedAtBucketMs - sessionStartedAtBucketMs),
    expiresAtBucket: new Date(
      recordedAtBucketMs + params.retentionHours * 60 * 60 * 1000,
    ).toISOString(),
    assistance: input.assistance ?? null,
    errorCode: input.errorCode ?? null,
    diagnostics: input.diagnostics ?? null,
  };
}

export function parseStoredMeasurementEvent(value: unknown): MeasurementEvent {
  const base = measurementEventInputSchema.extend({
    schemaVersion: z.literal(MEASUREMENT_EVENT_SCHEMA_VERSION),
    eventId: z.string().uuid(),
    sessionId: z.string().uuid(),
    controlVersion: z.string().min(1).max(96),
    consentVersion: z.string().min(1).max(96),
    recordedAtBucket: z.string().datetime(),
    elapsedMsBucket: z.number().int().nonnegative(),
    expiresAtBucket: z.string().datetime(),
    assistance: z.enum(MEASUREMENT_ASSISTANCE).nullable(),
    errorCode: z.enum(MEASUREMENT_ERROR_CODES).nullable(),
    diagnostics: measurementDiagnosticsSchema.nullable(),
  }).strict();
  return base.parse(value) as MeasurementEvent;
}
