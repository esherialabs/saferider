import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

const activationSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('enabled'), reason: z.null() }).strict(),
  z.object({ status: z.literal('disabled'), reason: z.string().min(1) }).strict(),
]);

const nullablePositive = z.number().positive().nullable();
const nullableProbability = z.number().positive().lt(1).nullable();
const nullablePositiveInteger = z.number().int().positive().nullable();
const areaId = z.string().regex(/^(cell-\d+-\d+|corridor-[a-z0-9-]+)$/);

const rsiControlsSchema = z.object({
  schema: z.literal('com.saferide.rsi-privacy-controls'),
  schemaVersion: z.literal(1),
  controlVersion: z.string().min(1),
  activation: z.object({
    signalIngestion: activationSchema,
    releaseGeneration: activationSchema,
    retentionExecution: activationSchema,
    operatorRead: activationSchema,
    export: activationSchema,
    dashboard: activationSchema,
  }).strict(),
  approval: z.object({
    status: z.enum(['pending', 'approved', 'expired', 'revoked']),
    approvalId: z.string().min(1).nullable(),
    approvedByRole: z.string().min(1).nullable(),
    approvedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime().nullable(),
    minimumCount: z.number().int().min(2).nullable(),
  }).strict(),
  fixedBuckets: z.object({
    areaDefinitionVersion: z.string().min(1),
    allowedAreaIds: z.array(areaId).max(500),
    allowedAreaTypes: z.array(z.enum(['corridor', 'coarse_cell'])).min(1),
    timeBucketMinutes: z.number().int().min(30).max(1440).refine(value => 1440 % value === 0),
    releaseCadenceHours: z.number().int().min(1).max(24 * 31),
    categories: z.array(z.string().regex(/^[a-z0-9_]+$/)).min(1).max(100),
  }).strict(),
  spatialTransform: z.object({
    status: z.enum(['pending_approval', 'approved', 'revoked']),
    executionBoundary: z.literal('on_device'),
    implementationVersion: z.string().min(1).max(120),
    coarseCellSizeDegrees: z.number().min(0.01).max(10).nullable(),
    rawCoordinatesTransmitted: z.literal(false),
  }).strict(),
  consent: z.object({
    requiredPurpose: z.literal('anonymous_aggregate'),
    requiredVersion: z.string().min(1).nullable(),
  }).strict(),
  queryPolicy: z.object({
    viewId: z.string().regex(/^[a-z0-9-]+$/),
    allowedQueryKeys: z.tuple([z.literal('releaseId'), z.literal('viewId')]),
    operatorRole: z.literal('rsi_operator'),
    requestsPerMinute: z.number().int().min(1).max(600),
    maxRows: z.number().int().min(1).max(5000),
  }).strict(),
  differentialPrivacy: z.object({
    status: z.enum(['not_approved', 'approved', 'revoked']),
    epsilon: nullablePositive,
    delta: nullableProbability,
    sensitivity: nullablePositive,
    clipping: nullablePositive,
    composition: z.string().min(1).nullable(),
    releaseCadenceHours: nullablePositiveInteger,
    noiseMemoizationRequired: z.literal(true),
  }).strict(),
  rawSignalRetention: z.object({
    status: z.enum(['pending_legal', 'approved', 'revoked']),
    durationDays: z.number().int().positive().nullable(),
  }).strict(),
  syntheticTestProfile: z.object({
    testOnly: z.literal(true),
    profileId: z.string().min(1),
    minimumCount: z.number().int().min(2),
    timeBucketMinutes: z.number().int().min(30).max(1440).refine(value => 1440 % value === 0),
    releaseCadenceHours: z.number().int().positive(),
    allowedAreaIds: z.array(areaId).min(3),
    categories: z.array(z.string().regex(/^[a-z0-9_]+$/)).min(2),
  }).strict(),
}).strict();

export type RsiControls = z.infer<typeof rsiControlsSchema>;
export type RsiCapability = keyof RsiControls['activation'];
export const ACTIVE_RSI_CONTROL_VERSION = 'rsi-privacy-controls.2026-07-30.1';

let cachedControls: RsiControls | null = null;

function validateApprovalConsistency(controls: RsiControls): void {
  const anyApprovalDependentCapabilityEnabled = Object.entries(controls.activation).some(
    ([capability, activation]) => capability !== 'retentionExecution' && activation.status === 'enabled',
  );
  const approval = controls.approval;
  const approvalFields = [
    approval.approvalId,
    approval.approvedByRole,
    approval.approvedAt,
    approval.expiresAt,
    approval.minimumCount,
  ];
  if (approval.status === 'pending' && approvalFields.some(value => value !== null)) {
    throw new Error('Pending RSI approval cannot contain approval evidence');
  }
  if (approval.status !== 'pending' && approvalFields.some(value => value === null)) {
    throw new Error('Resolved RSI approval requires complete attributable evidence');
  }
  if (
    approval.approvedAt &&
    approval.expiresAt &&
    new Date(approval.expiresAt).getTime() <= new Date(approval.approvedAt).getTime()
  ) {
    throw new Error('RSI approval validity window is invalid');
  }

  const retention = controls.rawSignalRetention;
  if ((retention.status === 'approved') !== (retention.durationDays !== null)) {
    throw new Error('RSI raw-signal retention duration must exist only while approved');
  }

  const transform = controls.spatialTransform;
  if ((transform.status === 'approved') !== (transform.coarseCellSizeDegrees !== null)) {
    throw new Error('RSI coarse-location transform parameters must exist only while approved');
  }

  const dp = controls.differentialPrivacy;
  const dpFields = [dp.epsilon, dp.delta, dp.sensitivity, dp.clipping, dp.composition, dp.releaseCadenceHours];
  if (dp.status === 'not_approved' && dpFields.some(value => value !== null)) {
    throw new Error('Unapproved RSI differential privacy cannot contain parameters');
  }
  if (dp.status !== 'not_approved' && dpFields.some(value => value === null)) {
    throw new Error('Approved or revoked RSI differential privacy requires complete attributable parameters');
  }
  if (dp.releaseCadenceHours !== null && dp.releaseCadenceHours !== controls.fixedBuckets.releaseCadenceHours) {
    throw new Error('RSI differential-privacy cadence must match the fixed release cadence');
  }

  if (new Set(controls.fixedBuckets.allowedAreaIds).size !== controls.fixedBuckets.allowedAreaIds.length) {
    throw new Error('RSI area allowlist contains duplicates');
  }
  if (new Set(controls.fixedBuckets.allowedAreaTypes).size !== controls.fixedBuckets.allowedAreaTypes.length) {
    throw new Error('RSI area-type allowlist contains duplicates');
  }
  if (new Set(controls.fixedBuckets.categories).size !== controls.fixedBuckets.categories.length) {
    throw new Error('RSI category allowlist contains duplicates');
  }
  for (const id of controls.fixedBuckets.allowedAreaIds) {
    const type = id.startsWith('cell-') ? 'coarse_cell' : 'corridor';
    if (!controls.fixedBuckets.allowedAreaTypes.includes(type)) {
      throw new Error('RSI area allowlist contains an ID whose type is not approved');
    }
  }
  if ((controls.fixedBuckets.releaseCadenceHours * 60) % controls.fixedBuckets.timeBucketMinutes !== 0) {
    throw new Error('RSI time buckets must divide the fixed release cadence');
  }
  const fixedGridCellCount = controls.fixedBuckets.allowedAreaIds.length *
    controls.fixedBuckets.categories.length *
    ((controls.fixedBuckets.releaseCadenceHours * 60) / controls.fixedBuckets.timeBucketMinutes);
  if (
    controls.activation.releaseGeneration.status === 'enabled' &&
    fixedGridCellCount > controls.queryPolicy.maxRows
  ) {
    throw new Error('Enabled RSI fixed release grid exceeds the public row bound');
  }
  if (
    new Set(controls.syntheticTestProfile.allowedAreaIds).size !== controls.syntheticTestProfile.allowedAreaIds.length ||
    new Set(controls.syntheticTestProfile.categories).size !== controls.syntheticTestProfile.categories.length
  ) {
    throw new Error('RSI synthetic profile contains duplicate dimensions');
  }
  if ((controls.syntheticTestProfile.releaseCadenceHours * 60) % controls.syntheticTestProfile.timeBucketMinutes !== 0) {
    throw new Error('RSI synthetic time buckets must divide its release cadence');
  }

  if (!anyApprovalDependentCapabilityEnabled) return;
  if (
    approval.status !== 'approved' ||
    controls.fixedBuckets.allowedAreaIds.length === 0 ||
    !controls.consent.requiredVersion ||
    retention.status !== 'approved'
  ) {
    throw new Error('Enabled RSI capabilities require complete attributable privacy, consent, area, and retention approval');
  }
  if (controls.activation.signalIngestion.status === 'enabled' && transform.status !== 'approved') {
    throw new Error('RSI signal ingestion requires an approved on-device spatial transform');
  }
  if (controls.activation.dashboard.status === 'enabled' && dp.status !== 'approved') {
    throw new Error('RSI dashboard requires approved differential-privacy parameters');
  }
}

export function parseRsiControls(value: unknown): RsiControls {
  const controls = rsiControlsSchema.parse(value);
  validateApprovalConsistency(controls);
  return controls;
}

export function loadRsiControls(): RsiControls {
  if (cachedControls) return cachedControls;
  const configuredPath = process.env.SAFERIDE_RSI_CONTROLS_PATH;
  const candidates = configuredPath
    ? [resolve(configuredPath)]
    : [
        resolve(process.cwd(), 'config/rsi/rsi-privacy-controls.v1.json'),
        resolve(process.cwd(), '../../config/rsi/rsi-privacy-controls.v1.json'),
      ];
  const controlsPath = candidates.find(existsSync);
  if (!controlsPath) throw new Error('RSI privacy control manifest is unavailable');
  const controls = parseRsiControls(JSON.parse(readFileSync(controlsPath, 'utf8')));
  if (controls.controlVersion !== ACTIVE_RSI_CONTROL_VERSION) {
    throw new Error('RSI control version does not match the compiled API contract');
  }
  cachedControls = controls;
  return controls;
}

export function getRsiCapabilityDecision(
  capability: RsiCapability,
  now = new Date(),
): { enabled: true; controls: RsiControls } | { enabled: false; reason: string } {
  try {
    const controls = loadRsiControls();
    const activation = controls.activation[capability];
    if (activation.status !== 'enabled') return { enabled: false, reason: activation.reason ?? 'not_approved' };
    if (capability === 'retentionExecution') {
      if (controls.rawSignalRetention.status !== 'approved' || !controls.rawSignalRetention.durationDays) {
        return { enabled: false, reason: 'legal_retention_approval_missing' };
      }
      return { enabled: true, controls };
    }
    if (
      controls.approval.status !== 'approved' ||
      !controls.approval.expiresAt ||
      !Number.isFinite(new Date(controls.approval.expiresAt).getTime()) ||
      new Date(controls.approval.expiresAt).getTime() <= now.getTime()
    ) {
      return { enabled: false, reason: 'privacy_approval_missing_or_expired' };
    }
    return { enabled: true, controls };
  } catch {
    return { enabled: false, reason: 'rsi_controls_unavailable' };
  }
}

export function resetRsiControlsForTests(): void {
  cachedControls = null;
}
