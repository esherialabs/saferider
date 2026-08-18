export type EvidencePrivacyProcessingStatus =
  | 'not_requested'
  | 'requested'
  | 'processing'
  | 'processed'
  | 'unavailable'
  | 'failed';

export type EvidencePrivacyFeature = 'faceBlur' | 'metadataRemoval' | 'fileEncryption';

export interface EvidencePrivacySettings {
  blurFaces?: boolean;
  removeMetadata?: boolean;
  encryptFiles?: boolean;
}

export interface EvidencePrivacyStatusEntry {
  status: EvidencePrivacyProcessingStatus;
  reason: string;
  updatedAt?: string;
  previewGenerated?: boolean;
  confidence?: number;
  userConfirmed?: boolean;
  originalPreserved?: boolean;
  verifiedFileType?: string;
  verificationMethod?: 'before_after_metadata_diff';
  algorithm?: 'AES-256-GCM';
  keyManagement?: 'device_keystore' | 'recipient_envelope';
  sharingModel?: 'device_only' | 'recipient_wrapped_key';
  keyReference?: string;
}

export type EvidencePrivacyStatusMap = Record<EvidencePrivacyFeature, EvidencePrivacyStatusEntry>;

export interface EvidenceMediaPrivacyInput {
  id?: string;
  type?: 'photo' | 'audio' | 'video' | 'document' | string;
  privacyStatus?: Partial<Record<EvidencePrivacyFeature, Partial<EvidencePrivacyStatusEntry> | EvidencePrivacyProcessingStatus>>;
  uploadedAt?: Date | string;
  storagePath?: string;
  uploadStatus?: 'pending' | 'uploaded' | 'failed';
  uploadError?: string;
}

export interface EvidencePrivacyDisplayItem {
  feature: EvidencePrivacyFeature | 'upload';
  label: string;
  status: EvidencePrivacyProcessingStatus;
  description: string;
}

export const EVIDENCE_PRIVACY_FEATURES: EvidencePrivacyFeature[] = [
  'faceBlur',
  'metadataRemoval',
  'fileEncryption',
];

export const SAFE_DEFAULT_EVIDENCE_PRIVACY_SETTINGS: Required<EvidencePrivacySettings> = {
  blurFaces: false,
  removeMetadata: false,
  encryptFiles: false,
};

const FEATURE_LABELS: Record<EvidencePrivacyFeature, string> = {
  faceBlur: 'Blur',
  metadataRemoval: 'Metadata',
  fileEncryption: 'Encrypt',
};

const FEATURE_REQUEST_KEYS: Record<EvidencePrivacyFeature, keyof Required<EvidencePrivacySettings>> = {
  faceBlur: 'blurFaces',
  metadataRemoval: 'removeMetadata',
  fileEncryption: 'encryptFiles',
};

const UNSUPPORTED_REASONS: Record<EvidencePrivacyFeature, string> = {
  faceBlur: 'Face blur was requested, but this Expo build does not transform photo or video pixels.',
  metadataRemoval: 'Metadata removal was requested, but raw evidence files are not stripped before local storage.',
  fileEncryption: 'File encryption was requested, but raw evidence files are not file-encrypted in this Expo build.',
};

const NOT_REQUESTED_REASONS: Record<EvidencePrivacyFeature, string> = {
  faceBlur: 'Face blur was not requested for this evidence item.',
  metadataRemoval: 'Metadata removal was not requested for this evidence item.',
  fileEncryption: 'File encryption was not requested for this evidence item.',
};

export function normalizeEvidencePrivacySettings(
  settings?: EvidencePrivacySettings | null,
): Required<EvidencePrivacySettings> {
  return {
    ...SAFE_DEFAULT_EVIDENCE_PRIVACY_SETTINGS,
    ...(settings ?? {}),
  };
}

export function resolveEvidencePrivacySettingsForDraft(
  settings?: EvidencePrivacySettings | null,
): Required<EvidencePrivacySettings> {
  return settings
    ? normalizeEvidencePrivacySettings(settings)
    : SAFE_DEFAULT_EVIDENCE_PRIVACY_SETTINGS;
}

function normalizeExistingStatus(
  existing: Partial<EvidencePrivacyStatusEntry> | EvidencePrivacyProcessingStatus | undefined,
): Partial<EvidencePrivacyStatusEntry> | undefined {
  if (!existing) return undefined;
  if (typeof existing === 'string') {
    return { status: existing };
  }
  return existing;
}

function requestedStatusForFeature(
  feature: EvidencePrivacyFeature,
  mediaType?: EvidenceMediaPrivacyInput['type'],
): EvidencePrivacyStatusEntry {
  if (feature === 'faceBlur' && mediaType !== 'photo' && mediaType !== 'video') {
    return {
      status: 'unavailable',
      reason: 'Face blur only applies to photo or video evidence.',
    };
  }

  return {
    status: 'requested',
    reason: UNSUPPORTED_REASONS[feature],
  };
}

export function buildEvidencePrivacyStatus(
  media: EvidenceMediaPrivacyInput = {},
  settings?: EvidencePrivacySettings | null,
): EvidencePrivacyStatusMap {
  const normalizedSettings = normalizeEvidencePrivacySettings(settings);

  return EVIDENCE_PRIVACY_FEATURES.reduce((acc, feature) => {
    const requested = normalizedSettings[FEATURE_REQUEST_KEYS[feature]];
    const existing = normalizeExistingStatus(media.privacyStatus?.[feature]);

    if (!requested) {
      acc[feature] = {
        status: 'not_requested',
        reason: NOT_REQUESTED_REASONS[feature],
      };
      return acc;
    }

    if (existing?.status === 'processing' || existing?.status === 'processed' || existing?.status === 'failed') {
      acc[feature] = {
        ...existing,
        status: existing.status,
        reason: existing.reason ?? requestedStatusForFeature(feature, media.type).reason,
        updatedAt: existing.updatedAt,
      };
      return acc;
    }

    acc[feature] = requestedStatusForFeature(feature, media.type);
    return acc;
  }, {} as EvidencePrivacyStatusMap);
}

export function withEvidencePrivacyStatus<T extends EvidenceMediaPrivacyInput>(
  media: T,
  settings?: EvidencePrivacySettings | null,
): T & { privacyStatus: EvidencePrivacyStatusMap } {
  return {
    ...media,
    privacyStatus: buildEvidencePrivacyStatus(media, settings),
  };
}

export function normalizeMediaPrivacyStatuses<T extends EvidenceMediaPrivacyInput>(
  mediaFiles: T[] | undefined,
  settings?: EvidencePrivacySettings | null,
): Array<T & { privacyStatus: EvidencePrivacyStatusMap }> | undefined {
  if (!Array.isArray(mediaFiles)) return undefined;
  return mediaFiles.map(media => withEvidencePrivacyStatus(media, settings));
}

export function getEvidenceUploadStatus(
  media: EvidenceMediaPrivacyInput,
  options: { included: boolean },
): EvidencePrivacyDisplayItem {
  if (!options.included) {
    return {
      feature: 'upload',
      label: 'Upload not included',
      status: 'not_requested',
      description: 'This pathway or preference does not include this evidence file for upload.',
    };
  }

  if (media.uploadStatus === 'failed') {
    return {
      feature: 'upload',
      label: 'Upload failed',
      status: 'failed',
      description: media.uploadError ?? 'The evidence upload did not complete.',
    };
  }

  if (media.uploadStatus === 'uploaded' || media.uploadedAt || media.storagePath) {
    return {
      feature: 'upload',
      label: 'Upload completed',
      status: 'processed',
      description: 'The case service reported this evidence file as uploaded.',
    };
  }

  return {
    feature: 'upload',
    label: 'Upload pending',
    status: 'requested',
    description: 'This evidence can be uploaded only after consent and a successful sync.',
  };
}

export function getEvidencePrivacyDisplayItems(
  media: EvidenceMediaPrivacyInput,
  settings?: EvidencePrivacySettings | null,
): EvidencePrivacyDisplayItem[] {
  const status = buildEvidencePrivacyStatus(media, settings);
  return EVIDENCE_PRIVACY_FEATURES.map(feature => ({
    feature,
    label: `${FEATURE_LABELS[feature]} ${formatStatusForLabel(status[feature].status)}`,
    status: status[feature].status,
    description: status[feature].reason,
  }));
}

export function getEvidencePrivacyStatusVariant(status: EvidencePrivacyProcessingStatus): 'secondary' | 'success' | 'warning' | 'destructive' | 'info' {
  switch (status) {
    case 'processed':
      return 'success';
    case 'failed':
      return 'destructive';
    case 'requested':
    case 'processing':
      return 'warning';
    case 'unavailable':
      return 'info';
    case 'not_requested':
    default:
      return 'secondary';
  }
}

export function summarizeEvidencePrivacyForConsent(
  mediaFiles: EvidenceMediaPrivacyInput[] | undefined,
  settings?: EvidencePrivacySettings | null,
  options: { uploadIncluded?: boolean } = {},
): string[] {
  if (!mediaFiles?.length) return [];

  return mediaFiles.map((media, index) => {
    const itemLabel = `${formatEvidenceType(media.type)} evidence ${index + 1}`;
    const privacyItems = getEvidencePrivacyDisplayItems(media, settings);
    const uploadItem = getEvidenceUploadStatus(media, { included: options.uploadIncluded ?? true });
    const statuses = [...privacyItems, uploadItem]
      .map(item => `${item.label}: ${item.description}`)
      .join('; ');
    return `${itemLabel}: ${statuses}`;
  });
}

export function summarizeEvidencePrivacyRequests(
  settings?: EvidencePrivacySettings | null,
): string[] {
  const normalizedSettings = normalizeEvidencePrivacySettings(settings);
  return EVIDENCE_PRIVACY_FEATURES
    .filter(feature => normalizedSettings[FEATURE_REQUEST_KEYS[feature]])
    .map(feature => UNSUPPORTED_REASONS[feature]);
}

export function buildEvidencePrivacyManifest(
  mediaFiles: EvidenceMediaPrivacyInput[] | undefined,
  settings?: EvidencePrivacySettings | null,
  options: { uploadIncluded?: boolean } = {},
): Array<{
  id?: string;
  type?: string;
  privacyStatus: EvidencePrivacyStatusMap;
  uploadStatus: EvidencePrivacyDisplayItem;
}> {
  return (mediaFiles ?? []).map(media => ({
    id: media.id,
    type: media.type,
    privacyStatus: buildEvidencePrivacyStatus(media, settings),
    uploadStatus: getEvidenceUploadStatus(media, { included: options.uploadIncluded ?? true }),
  }));
}

function formatStatusForLabel(status: EvidencePrivacyProcessingStatus): string {
  switch (status) {
    case 'processed':
      return 'processed';
    case 'failed':
      return 'failed';
    case 'requested':
      return 'requested';
    case 'processing':
      return 'processing';
    case 'unavailable':
      return 'unavailable';
    case 'not_requested':
    default:
      return 'not requested';
  }
}

function formatEvidenceType(type?: EvidenceMediaPrivacyInput['type']): string {
  if (!type) return 'Evidence';
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}
