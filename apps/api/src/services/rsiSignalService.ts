import { parseRsiControls, type RsiControls } from '../config/rsiControls.js';
import {
  rsiSignalBatchSchema,
  rsiSignalSchema,
  rsiSignalSubmissionSchema,
} from '../contracts/rsiContracts.js';

export { rsiSignalSchema } from '../contracts/rsiContracts.js';
export type MinimizedRsiSignal = {
  areaId: string;
  areaType: 'coarse_cell' | 'corridor';
  areaDefinitionVersion: string;
  timeBucket: Date;
  timeBucketMinutes: number;
  category: string;
  configVersion: string;
  policyVersion: string;
  consentVersion: string;
  expiresAt: Date;
};

export type ValidatedRsiSignalSubmission = {
  consentRecordId: string;
  ingestionId: string;
  signals: MinimizedRsiSignal[];
};

function isAlignedBucket(value: Date, bucketMinutes: number): boolean {
  const bucketMs = bucketMinutes * 60 * 1000;
  return value.getTime() % bucketMs === 0;
}

export function validateAndMinimizeRsiSignal(
  input: unknown,
  controls: RsiControls,
  now = new Date(),
): MinimizedRsiSignal {
  const signal = rsiSignalSchema.parse(input);
  controls = parseRsiControls(controls);
  const retentionDays = controls.rawSignalRetention.durationDays;
  if (
    controls.activation.signalIngestion.status !== 'enabled' ||
    controls.approval.status !== 'approved' ||
    !controls.approval.approvalId ||
    !controls.approval.expiresAt ||
    new Date(controls.approval.expiresAt).getTime() <= now.getTime() ||
    controls.rawSignalRetention.status !== 'approved' ||
    !retentionDays ||
    !controls.consent.requiredVersion
  ) {
    throw new Error('RSI signal ingestion is not approved');
  }
  if (signal.configVersion !== controls.controlVersion || signal.policyVersion !== controls.controlVersion) {
    throw new Error('RSI signal control version does not match');
  }
  if (signal.consentVersion !== controls.consent.requiredVersion) {
    throw new Error('RSI signal consent version does not match');
  }
  if (!controls.fixedBuckets.allowedAreaTypes.includes(signal.area.type)) {
    throw new Error('RSI area type is not approved');
  }
  if (!controls.fixedBuckets.allowedAreaIds.includes(signal.area.id)) {
    throw new Error('RSI area is not approved');
  }
  if (!controls.fixedBuckets.categories.includes(signal.category)) {
    throw new Error('RSI category is not approved');
  }
  const timeBucket = new Date(signal.timeBucket);
  if (!isAlignedBucket(timeBucket, controls.fixedBuckets.timeBucketMinutes)) {
    throw new Error('RSI time bucket is not aligned to the approved fixed interval');
  }
  if (timeBucket.getTime() > now.getTime() + controls.fixedBuckets.timeBucketMinutes * 60 * 1000) {
    throw new Error('RSI time bucket is in the future');
  }

  const expiresAt = new Date(now);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + retentionDays);
  return {
    areaId: signal.area.id,
    areaType: signal.area.type,
    areaDefinitionVersion: controls.fixedBuckets.areaDefinitionVersion,
    timeBucket,
    timeBucketMinutes: controls.fixedBuckets.timeBucketMinutes,
    category: signal.category,
    configVersion: signal.configVersion,
    policyVersion: signal.policyVersion,
    consentVersion: signal.consentVersion,
    expiresAt,
  };
}

export function validateAndMinimizeRsiSignalBatch(
  input: unknown,
  controls: RsiControls,
  now = new Date(),
): MinimizedRsiSignal[] {
  const batch = rsiSignalBatchSchema.parse(input);
  return batch.signals.map(signal => validateAndMinimizeRsiSignal(signal, controls, now));
}

export function validateRsiSignalSubmission(
  input: unknown,
  controls: RsiControls,
  now = new Date(),
): ValidatedRsiSignalSubmission {
  const submission = rsiSignalSubmissionSchema.parse(input);
  if (submission.consent.version !== submission.signal.consentVersion) {
    throw new Error('RSI consent checkpoint does not match the signal consent version');
  }
  return {
    consentRecordId: submission.consent.recordId,
    ingestionId: submission.ingestionId,
    signals: [validateAndMinimizeRsiSignal(submission.signal, controls, now)],
  };
}

export function validateRsiSignalBatchSubmission(
  input: unknown,
  controls: RsiControls,
  now = new Date(),
): ValidatedRsiSignalSubmission {
  const submission = rsiSignalBatchSchema.parse(input);
  if (submission.signals.some(signal => signal.consentVersion !== submission.consent.version)) {
    throw new Error('RSI consent checkpoint does not match every signal consent version');
  }
  return {
    consentRecordId: submission.consent.recordId,
    ingestionId: submission.ingestionId,
    signals: submission.signals.map(signal => validateAndMinimizeRsiSignal(signal, controls, now)),
  };
}

export const RSI_SIGNAL_FORBIDDEN_FIELDS = [
  'narrative', 'incidentDescription', 'evidence', 'mediaFiles', 'name', 'phone', 'email',
  'latitude', 'longitude', 'coordinates', 'userId', 'ownerId', 'accountId', 'caseId', 'draftId',
] as const;

export function findForbiddenRsiFields(value: unknown, path = '$'): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => findForbiddenRsiFields(item, `${path}[${index}]`));
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
    const nextPath = `${path}.${key}`;
    return [
      ...(RSI_SIGNAL_FORBIDDEN_FIELDS.includes(key as typeof RSI_SIGNAL_FORBIDDEN_FIELDS[number]) ? [nextPath] : []),
      ...findForbiddenRsiFields(nested, nextPath),
    ];
  });
}
