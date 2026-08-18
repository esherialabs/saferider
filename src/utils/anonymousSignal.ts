import type { DraftData } from './draftStorage';

export const ANONYMOUS_SIGNAL_FORBIDDEN_KEYS = new Set([
  'narrative',
  'incidentDescription',
  'textEvidence',
  'evidence',
  'mediaFiles',
  'userId',
  'ownerId',
  'accountId',
  'contact',
  'phone',
  'email',
  'latitude',
  'longitude',
  'coordinates',
  'caseId',
  'draftId',
]);

export type AnonymousSignalConfig = {
  enabled: boolean;
  configVersion: string;
  policyVersion: string;
  consentVersion: string | null;
  areaDefinitionVersion: string;
  privacyApprovalId: string | null;
  cellSizeDegrees: number;
  timeBucketMinutes: number;
  allowedAreaIds: string[];
  allowedCategories: string[];
};

export type AnonymousSignal = {
  schemaVersion: '1.0';
  configVersion: string;
  policyVersion: string;
  consentVersion: string;
  area: { type: 'coarse_cell'; id: string };
  timeBucket: string;
  category: string;
};

export const DISABLED_ANONYMOUS_SIGNAL_CONFIG: AnonymousSignalConfig = {
  enabled: false,
  configVersion: 'anonymous-signal.pending-privacy-review.1',
  policyVersion: 'anonymous-signal.pending-privacy-review.1',
  consentVersion: null,
  areaDefinitionVersion: 'pending-privacy-review',
  privacyApprovalId: null,
  cellSizeDegrees: 0.05,
  timeBucketMinutes: 60,
  allowedAreaIds: [],
  allowedCategories: [],
};

function assertFiniteCoordinates(latitude: number, longitude: number): void {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error('Saved coordinates are invalid.');
  }
}

function buildCoarseCellId(latitude: number, longitude: number, cellSizeDegrees: number): string {
  if (!Number.isFinite(cellSizeDegrees) || cellSizeDegrees < 0.01) {
    throw new Error('Anonymous signal cell size is not privacy-safe.');
  }
  const latitudeCell = Math.floor((latitude + 90) / cellSizeDegrees);
  const longitudeCell = Math.floor((longitude + 180) / cellSizeDegrees);
  return `cell-${latitudeCell}-${longitudeCell}`;
}

function buildTimeBucket(date: string, time: string, bucketMinutes: number): string {
  if (!Number.isInteger(bucketMinutes) || bucketMinutes < 30 || 1440 % bucketMinutes !== 0) {
    throw new Error('Anonymous signal time bucket is not privacy-safe.');
  }
  const normalizedTime = /^\d{2}:\d{2}$/.test(time) ? time : '00:00';
  const timestamp = new Date(`${date}T${normalizedTime}:00.000Z`);
  if (Number.isNaN(timestamp.getTime())) throw new Error('Saved incident time is invalid.');
  const bucketMs = bucketMinutes * 60 * 1000;
  return new Date(Math.floor(timestamp.getTime() / bucketMs) * bucketMs).toISOString();
}

export function buildAnonymousSignals(draft: DraftData, config: AnonymousSignalConfig): AnonymousSignal[] {
  if (
    !config.enabled ||
    !config.privacyApprovalId ||
    !config.consentVersion ||
    config.areaDefinitionVersion === 'pending-privacy-review'
  ) {
    throw new Error('Anonymous signal ingestion is disabled pending privacy approval.');
  }
  if (!config.configVersion || config.configVersion !== config.policyVersion) {
    throw new Error('Anonymous signal control versions are missing or inconsistent.');
  }
  const coordinates = draft.location?.coordinates;
  if (!coordinates) throw new Error('Anonymous signal requires a location that can be transformed on-device.');
  if (!draft.datetime?.date) throw new Error('Anonymous signal requires an incident date.');
  assertFiniteCoordinates(coordinates.latitude, coordinates.longitude);
  const incidentDate = draft.datetime.date;
  const incidentTime = draft.datetime.time ?? '00:00';

  const coarseCellId = buildCoarseCellId(coordinates.latitude, coordinates.longitude, config.cellSizeDegrees);
  if (!config.allowedAreaIds.includes(coarseCellId)) {
    throw new Error('Anonymous signal location is outside the approved area definitions.');
  }

  const allowedCategories = new Set(config.allowedCategories);
  const categories = Array.from(new Set([
    ...(draft.patterns ?? []),
    ...(draft.selectedTags ?? []),
    ...(draft.acceptedSuggestions ?? []),
  ])).filter(category => allowedCategories.has(category)).slice(0, 8);
  if (categories.length === 0) throw new Error('Anonymous signal has no approved category.');

  return categories.map(category => ({
    schemaVersion: '1.0',
    configVersion: config.configVersion,
    policyVersion: config.policyVersion,
    consentVersion: config.consentVersion!,
    area: { type: 'coarse_cell', id: coarseCellId },
    timeBucket: buildTimeBucket(incidentDate, incidentTime, config.timeBucketMinutes),
    category,
  }));
}

export function getAnonymousSignalForbiddenPaths(value: unknown, path = '$'): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => getAnonymousSignalForbiddenPaths(item, `${path}[${index}]`));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
    const currentPath = `${path}.${key}`;
    return [
      ...(ANONYMOUS_SIGNAL_FORBIDDEN_KEYS.has(key) ? [currentPath] : []),
      ...getAnonymousSignalForbiddenPaths(nested, currentPath),
    ];
  });
}
