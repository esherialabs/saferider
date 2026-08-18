import {
  getEvidencePrivacyDisplayItems,
  getEvidencePrivacyStatusVariant,
  getEvidenceUploadStatus,
  type EvidenceMediaPrivacyInput,
  type EvidencePrivacyDisplayItem,
  type EvidencePrivacyProcessingStatus,
  type EvidencePrivacySettings,
} from './evidencePrivacyStatus';

export type EvidenceVaultCaptureSource =
  | 'camera'
  | 'media_library'
  | 'screenshot_import'
  | 'document_picker'
  | 'microphone'
  | 'stealth_auto'
  | 'unknown';

export interface EvidenceVaultMediaInput extends EvidenceMediaPrivacyInput {
  uri?: string;
  fileName?: string;
  size?: number;
  timestamp?: Date | string;
  description?: string;
  checksum?: string;
  transcript?: string;
  captureSource?: EvidenceVaultCaptureSource | string;
  isFromStealth?: boolean;
}

export interface EvidenceVaultStatusItem {
  label: string;
  status: EvidencePrivacyProcessingStatus;
  description: string;
}

export interface EvidenceVaultDisplayItem {
  id?: string;
  title: string;
  typeLabel: string;
  sourceLabel: string;
  fileSizeLabel: string;
  timestampLabel: string;
  note: string;
  localStatus: EvidenceVaultStatusItem;
  uploadStatus: EvidencePrivacyDisplayItem;
  integrityStatus: EvidenceVaultStatusItem;
  transcriptionStatus?: EvidenceVaultStatusItem;
  privacyItems: EvidencePrivacyDisplayItem[];
}

export interface EvidenceVaultSummary {
  total: number;
  localOnly: number;
  queued: number;
  uploaded: number;
  failed: number;
  privacyRequested: number;
  transcriptsSaved: number;
  notesSaved: number;
}

export interface EvidenceVaultDraftUploadInclusionInput {
  selectedPathway?: string | null;
  includeBrief?: boolean | null;
  referralSelection?: {
    includeBrief?: boolean | null;
  } | null;
}

export interface BuildEvidenceVaultItemOptions {
  privacySettings?: EvidencePrivacySettings | null;
  uploadIncluded?: boolean;
  draftStatus?: 'draft' | 'queued' | 'submitted' | 'archived' | 'closed';
  isOnline?: boolean;
  transcriptionStatus?: 'idle' | 'loading' | 'success' | 'error';
  transcriptionError?: string;
}

export function buildEvidenceVaultItem(
  media: EvidenceVaultMediaInput,
  index: number,
  options: BuildEvidenceVaultItemOptions = {},
): EvidenceVaultDisplayItem {
  return {
    id: media.id,
    title: media.fileName?.trim() || `${formatEvidenceType(media.type)} evidence ${index + 1}`,
    typeLabel: formatEvidenceType(media.type),
    sourceLabel: getEvidenceCaptureSourceLabel(media),
    fileSizeLabel: formatFileSize(media.size),
    timestampLabel: formatEvidenceTimestamp(media.timestamp),
    note: media.description?.trim() ?? '',
    localStatus: getEvidenceLocalStatus(media),
    uploadStatus: getEvidenceVaultUploadStatus(media, options),
    integrityStatus: getEvidenceIntegrityStatus(media),
    transcriptionStatus: getEvidenceTranscriptionStatus(media, options),
    privacyItems: getEvidencePrivacyDisplayItems(media, options.privacySettings),
  };
}

export function buildEvidenceVaultSummary(
  mediaFiles: EvidenceVaultMediaInput[] | undefined,
  options: Pick<BuildEvidenceVaultItemOptions, 'privacySettings' | 'draftStatus' | 'isOnline' | 'uploadIncluded'> = {},
): EvidenceVaultSummary {
  const items = mediaFiles ?? [];

  return items.reduce<EvidenceVaultSummary>((summary, media, index) => {
    const item = buildEvidenceVaultItem(media, index, options);
    const isUploaded = item.uploadStatus.status === 'processed';
    const isFailed = item.uploadStatus.status === 'failed';
    const uploadIncluded = options.uploadIncluded ?? true;
    const isQueued = uploadIncluded && options.draftStatus === 'queued' && !isUploaded && !isFailed;
    const hasPrivacyRequest = item.privacyItems.some(statusItem => statusItem.status !== 'not_requested');

    return {
      total: summary.total + 1,
      localOnly: summary.localOnly + (item.localStatus.status === 'processed' && !isUploaded ? 1 : 0),
      queued: summary.queued + (isQueued ? 1 : 0),
      uploaded: summary.uploaded + (isUploaded ? 1 : 0),
      failed: summary.failed + (isFailed ? 1 : 0),
      privacyRequested: summary.privacyRequested + (hasPrivacyRequest ? 1 : 0),
      transcriptsSaved: summary.transcriptsSaved + (media.transcript?.trim() ? 1 : 0),
      notesSaved: summary.notesSaved + (media.description?.trim() ? 1 : 0),
    };
  }, {
    total: 0,
    localOnly: 0,
    queued: 0,
    uploaded: 0,
    failed: 0,
    privacyRequested: 0,
    transcriptsSaved: 0,
    notesSaved: 0,
  });
}

export function getEvidenceVaultStatusVariant(status: EvidencePrivacyProcessingStatus) {
  return getEvidencePrivacyStatusVariant(status);
}

export function getEvidenceVaultUploadIncludedForDraft(
  draft?: EvidenceVaultDraftUploadInclusionInput | null,
): boolean {
  const pathway = normalizePathway(draft?.selectedPathway);

  if (pathway === 'save-private' || pathway === 'anonymous-map') {
    return false;
  }

  if (pathway === 'referral') {
    if (typeof draft?.referralSelection?.includeBrief === 'boolean') {
      return draft.referralSelection.includeBrief;
    }

    return draft?.includeBrief !== false;
  }

  return true;
}

export function getEvidenceVaultMediaTypeFromPickerAsset(asset: {
  type?: string | null;
  mimeType?: string | null;
}): 'photo' | 'video' {
  if (asset.type === 'video' || asset.mimeType?.toLowerCase().startsWith('video/')) {
    return 'video';
  }

  return 'photo';
}

export function getEvidenceCaptureSourceLabel(media: EvidenceVaultMediaInput): string {
  const source = normalizeCaptureSource(media);
  switch (source) {
    case 'camera':
      return 'Camera capture';
    case 'media_library':
      return 'Media library import';
    case 'screenshot_import':
      return 'Screenshot import';
    case 'document_picker':
      return 'Document picker';
    case 'microphone':
      return 'Microphone recording';
    case 'stealth_auto':
      return 'Stealth trigger';
    case 'unknown':
    default:
      return 'Saved evidence';
  }
}

function normalizePathway(pathway?: string | null): 'save-private' | 'anonymous-map' | 'referral' | 'escalate' | undefined {
  switch (pathway) {
    case 'save-private':
    case 'anonymous-map':
    case 'referral':
    case 'escalate':
      return pathway;
    default:
      return undefined;
  }
}

function normalizeCaptureSource(media: EvidenceVaultMediaInput): EvidenceVaultCaptureSource {
  if (media.isFromStealth || media.captureSource === 'stealth_auto') {
    return 'stealth_auto';
  }

  if (
    media.captureSource === 'camera' ||
    media.captureSource === 'media_library' ||
    media.captureSource === 'screenshot_import' ||
    media.captureSource === 'document_picker' ||
    media.captureSource === 'microphone'
  ) {
    return media.captureSource;
  }

  return 'unknown';
}

function getEvidenceLocalStatus(media: EvidenceVaultMediaInput): EvidenceVaultStatusItem {
  if (media.uri?.trim()) {
    return {
      label: 'Local saved',
      status: 'processed',
      description: 'A local file reference is saved in this draft. The raw path is hidden here.',
    };
  }

  return {
    label: 'Local missing',
    status: 'failed',
    description: 'No local file reference is saved for this evidence item.',
  };
}

function getEvidenceVaultUploadStatus(
  media: EvidenceVaultMediaInput,
  options: BuildEvidenceVaultItemOptions,
): EvidencePrivacyDisplayItem {
  const uploadIncluded = options.uploadIncluded ?? true;
  const baseStatus = getEvidenceUploadStatus(media, { included: uploadIncluded });

  if (
    !uploadIncluded ||
    media.uploadStatus === 'failed' ||
    media.uploadStatus === 'uploaded' ||
    media.uploadedAt ||
    media.storagePath
  ) {
    return baseStatus;
  }

  if (options.draftStatus === 'queued') {
    return {
      feature: 'upload',
      label: 'Queued with draft',
      status: 'requested',
      description: 'This evidence is saved locally with a draft queued for sync.',
    };
  }

  if (options.isOnline === false) {
    return {
      feature: 'upload',
      label: 'Waiting for connection',
      status: 'requested',
      description: 'This evidence remains local until consent and a successful online sync.',
    };
  }

  return baseStatus;
}

function getEvidenceIntegrityStatus(media: EvidenceVaultMediaInput): EvidenceVaultStatusItem {
  if (media.checksum?.trim()) {
    return {
      label: 'Hash recorded',
      status: 'processed',
      description: `Checksum saved: ${formatShortChecksum(media.checksum)}.`,
    };
  }

  return {
    label: 'Hash unavailable',
    status: 'unavailable',
    description: 'No checksum is saved for this evidence item in the draft.',
  };
}

function getEvidenceTranscriptionStatus(
  media: EvidenceVaultMediaInput,
  options: BuildEvidenceVaultItemOptions,
): EvidenceVaultStatusItem | undefined {
  if (media.type !== 'audio') return undefined;

  if (options.transcriptionStatus === 'loading') {
    return {
      label: 'Transcript running',
      status: 'requested',
      description: 'Audio transcription is in progress.',
    };
  }

  if (options.transcriptionStatus === 'error') {
    return {
      label: 'Transcript failed',
      status: 'failed',
      description: options.transcriptionError ?? 'Audio transcription did not complete.',
    };
  }

  if (media.transcript?.trim()) {
    return {
      label: 'Transcript saved',
      status: 'processed',
      description: 'An editable transcript is saved with this audio item.',
    };
  }

  return {
    label: 'No transcript',
    status: 'not_requested',
    description: 'No transcript is saved for this audio item.',
  };
}

function formatEvidenceType(type?: EvidenceMediaPrivacyInput['type']): string {
  switch (type) {
    case 'photo':
      return 'Photo';
    case 'audio':
      return 'Audio';
    case 'video':
      return 'Video';
    case 'document':
      return 'Document';
    default:
      return 'Evidence';
  }
}

function formatFileSize(size?: number): string {
  if (!size || size <= 0) return 'Size unknown';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatEvidenceTimestamp(timestamp?: Date | string): string {
  if (!timestamp) return 'Time not recorded';
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Time not recorded';
  return date.toLocaleString();
}

function formatShortChecksum(checksum: string): string {
  const normalized = checksum.trim();
  if (normalized.length <= 16) return normalized;
  return `${normalized.slice(0, 12)}...${normalized.slice(-4)}`;
}
