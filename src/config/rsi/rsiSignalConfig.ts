import { z } from 'zod';

import rsiControlsJson from '../../../config/rsi/rsi-privacy-controls.v1.json';
import {
  DISABLED_ANONYMOUS_SIGNAL_CONFIG,
  type AnonymousSignalConfig,
} from '../../utils/anonymousSignal';

const mobileRsiControlsSchema = z.object({
  controlVersion: z.string().min(1),
  activation: z.object({
    signalIngestion: z.discriminatedUnion('status', [
      z.object({ status: z.literal('enabled'), reason: z.null() }).strict(),
      z.object({ status: z.literal('disabled'), reason: z.string().min(1) }).strict(),
    ]),
  }).passthrough(),
  approval: z.object({
    status: z.enum(['pending', 'approved', 'expired', 'revoked']),
    approvalId: z.string().min(1).nullable(),
    expiresAt: z.string().datetime().nullable(),
  }).passthrough(),
  fixedBuckets: z.object({
    areaDefinitionVersion: z.string().min(1),
    allowedAreaIds: z.array(z.string().regex(/^(cell-\d+-\d+|corridor-[a-z0-9-]+)$/)),
    timeBucketMinutes: z.number().int().min(30).max(1440),
    categories: z.array(z.string().regex(/^[a-z0-9_]+$/)).min(1).max(100),
  }).passthrough(),
  spatialTransform: z.object({
    status: z.enum(['pending_approval', 'approved', 'revoked']),
    executionBoundary: z.literal('on_device'),
    implementationVersion: z.string().min(1),
    coarseCellSizeDegrees: z.number().min(0.01).max(10).nullable(),
    rawCoordinatesTransmitted: z.literal(false),
  }).strict(),
  consent: z.object({
    requiredPurpose: z.literal('anonymous_aggregate'),
    requiredVersion: z.string().min(1).nullable(),
  }).strict(),
}).passthrough();

export type MobileRsiSignalDecision =
  | { enabled: true; config: AnonymousSignalConfig }
  | { enabled: false; reason: string; config: AnonymousSignalConfig };

export function getMobileRsiSignalDecision(
  now = new Date(),
  rawControls: unknown = rsiControlsJson,
): MobileRsiSignalDecision {
  try {
    const controls = mobileRsiControlsSchema.parse(rawControls);
    const activation = controls.activation.signalIngestion;
    const disabledConfig: AnonymousSignalConfig = {
      ...DISABLED_ANONYMOUS_SIGNAL_CONFIG,
      configVersion: controls.controlVersion,
      policyVersion: controls.controlVersion,
      areaDefinitionVersion: controls.fixedBuckets.areaDefinitionVersion,
      timeBucketMinutes: controls.fixedBuckets.timeBucketMinutes,
      allowedAreaIds: [],
      allowedCategories: [],
    };
    if (activation.status !== 'enabled') {
      return { enabled: false, reason: activation.reason, config: disabledConfig };
    }
    const approvalExpiresAt = controls.approval.expiresAt
      ? new Date(controls.approval.expiresAt).getTime()
      : Number.NaN;
    if (
      controls.approval.status !== 'approved' ||
      !controls.approval.approvalId ||
      !controls.approval.expiresAt ||
      !Number.isFinite(approvalExpiresAt) ||
      approvalExpiresAt <= now.getTime() ||
      controls.spatialTransform.status !== 'approved' ||
      controls.spatialTransform.coarseCellSizeDegrees === null ||
      !controls.consent.requiredVersion
    ) {
      return { enabled: false, reason: 'rsi_mobile_approval_missing_or_expired', config: disabledConfig };
    }
    const allowedAreaIds = controls.fixedBuckets.allowedAreaIds.filter(id => id.startsWith('cell-'));
    if (allowedAreaIds.length === 0) {
      return { enabled: false, reason: 'rsi_mobile_coarse_area_allowlist_empty', config: disabledConfig };
    }
    return {
      enabled: true,
      config: {
        enabled: true,
        configVersion: controls.controlVersion,
        policyVersion: controls.controlVersion,
        consentVersion: controls.consent.requiredVersion,
        areaDefinitionVersion: controls.fixedBuckets.areaDefinitionVersion,
        privacyApprovalId: controls.approval.approvalId,
        cellSizeDegrees: controls.spatialTransform.coarseCellSizeDegrees,
        timeBucketMinutes: controls.fixedBuckets.timeBucketMinutes,
        allowedAreaIds,
        allowedCategories: controls.fixedBuckets.categories,
      },
    };
  } catch {
    return {
      enabled: false,
      reason: 'rsi_mobile_controls_invalid',
      config: DISABLED_ANONYMOUS_SIGNAL_CONFIG,
    };
  }
}
