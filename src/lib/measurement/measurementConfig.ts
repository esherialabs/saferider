import { z } from 'zod';

import rawControls from '../../../config/measurement/moderated-test-controls.v1.json';
import { env } from '../../config/env';

const controlsSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  controlVersion: z.string().min(1),
  eventSchemaVersion: z.literal('measurement-event.v1'),
  capability: z.discriminatedUnion('status', [
    z.object({ status: z.literal('disabled'), reason: z.string().min(1) }).strict(),
    z.object({ status: z.literal('enabled'), reason: z.null() }).strict(),
  ]),
  approval: z.object({
    status: z.enum(['pending', 'approved', 'expired', 'revoked']),
    approvalId: z.string().min(1).nullable(),
    approvedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime().nullable(),
    ownerRole: z.string().min(1),
    reviewerRole: z.string().min(1),
  }).strict(),
  consent: z.object({
    requiredVersion: z.string().min(1).nullable(),
    separateFromPathwayConsent: z.literal(true),
    withdrawalDeletesLocalEvents: z.literal(true),
  }).strict(),
  runtime: z.object({
    allowedEnvironments: z.array(z.enum(['test', 'staging'])).min(1),
    allowedBuildProfiles: z.array(z.enum(['test', 'preview'])).min(1),
    productionAllowed: z.literal(false),
    networkUploadAllowed: z.literal(false),
  }).strict(),
  retention: z.object({
    hours: z.number().int().min(1).max(168).nullable(),
    maxEvents: z.number().int().min(1).max(2000),
    maxIssueReports: z.number().int().min(1).max(250),
  }).strict(),
}).strict();

export type ModeratedTestControls = z.infer<typeof controlsSchema>;

export type MeasurementRuntimeConfig = {
  enabled: boolean;
  controlVersion?: string;
  environment: string;
  buildProfile?: string;
};

export type MeasurementModeDecision =
  | { enabled: true; controls: ModeratedTestControls }
  | { enabled: false; reason: string; controls: ModeratedTestControls | null };

export function evaluateMeasurementMode(
  runtime: MeasurementRuntimeConfig,
  controlsInput: unknown = rawControls,
  now = new Date(),
): MeasurementModeDecision {
  const parsed = controlsSchema.safeParse(controlsInput);
  if (!parsed.success) {
    return { enabled: false, reason: 'measurement_controls_invalid', controls: null };
  }
  const controls = parsed.data;
  if (controls.capability.status !== 'enabled') {
    return { enabled: false, reason: 'measurement_capability_disabled', controls };
  }
  if (!runtime.enabled) {
    return { enabled: false, reason: 'measurement_build_flag_disabled', controls };
  }
  if (runtime.controlVersion !== controls.controlVersion) {
    return { enabled: false, reason: 'measurement_control_version_mismatch', controls };
  }
  if (runtime.environment === 'production' || !controls.runtime.allowedEnvironments.includes(runtime.environment as 'test' | 'staging')) {
    return { enabled: false, reason: 'measurement_environment_not_allowed', controls };
  }
  if (!runtime.buildProfile || !controls.runtime.allowedBuildProfiles.includes(runtime.buildProfile as 'test' | 'preview')) {
    return { enabled: false, reason: 'measurement_build_profile_not_allowed', controls };
  }
  const expiresAt = controls.approval.expiresAt ? new Date(controls.approval.expiresAt).getTime() : Number.NaN;
  const approvedAt = controls.approval.approvedAt ? new Date(controls.approval.approvedAt).getTime() : Number.NaN;
  if (
    controls.approval.status !== 'approved' ||
    !controls.approval.approvalId ||
    !controls.approval.approvedAt ||
    !controls.approval.expiresAt ||
    !Number.isFinite(approvedAt) ||
    !Number.isFinite(expiresAt) ||
    approvedAt > now.getTime() ||
    expiresAt <= approvedAt ||
    expiresAt <= now.getTime()
  ) {
    return { enabled: false, reason: 'measurement_approval_missing_or_expired', controls };
  }
  if (!controls.consent.requiredVersion || controls.retention.hours === null) {
    return { enabled: false, reason: 'measurement_consent_or_retention_unapproved', controls };
  }
  return { enabled: true, controls };
}

export function getMeasurementModeDecision(now = new Date()): MeasurementModeDecision {
  return evaluateMeasurementMode({
    enabled: env.measurement.moderatedTestMode,
    controlVersion: env.measurement.controlVersion,
    environment: env.environment,
    buildProfile: env.buildProfile,
  }, rawControls, now);
}
