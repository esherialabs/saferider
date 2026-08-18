const SAFE_MEDIA_TYPES = new Set(['photo', 'video', 'audio', 'document', 'file']);
const SAFE_REDACTION_LEVELS = new Set(['none', 'light', 'heavy']);
const SAFE_PRIVACY_STATUSES = new Set(['not_requested', 'requested', 'processing', 'processed', 'unavailable', 'failed']);
const SAFE_PRIVACY_FEATURES = ['faceBlur', 'metadataRemoval', 'fileEncryption'];
const SAFE_PACKET_METADATA_STATUSES = new Set([
  'File name and checksum withheld from packet metadata',
  'Text metadata redacted for names and contact values',
  'Packet metadata included from saved draft fields',
]);
const SAFE_PRIVACY_REQUESTS = new Set([
  'Face blur was requested, but this Expo build does not transform photo or video pixels.',
  'Metadata removal was requested, but raw evidence files are not stripped before local storage.',
  'File encryption was requested, but raw evidence files are not file-encrypted in this Expo build.',
]);
const SAFE_DISPLAY_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'mp4', 'mov', 'm4a', 'mp3', 'wav', 'pdf', 'doc', 'docx']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function extensionFromMimeType(mimeType: string): string | null {
  switch (mimeType.toLowerCase()) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/gif':
      return 'gif';
    case 'video/mp4':
      return 'mp4';
    case 'video/quicktime':
      return 'mov';
    case 'audio/mp4':
      return 'm4a';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/wav':
      return 'wav';
    case 'application/pdf':
      return 'pdf';
    case 'application/msword':
      return 'doc';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'docx';
    default:
      return null;
  }
}

function mediaTypeFromMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.startsWith('image/')) return 'photo';
  if (normalized.startsWith('video/')) return 'video';
  if (normalized.startsWith('audio/')) return 'audio';
  if (normalized === 'application/octet-stream') return 'file';
  return 'document';
}

function getSafeMediaType(metadata: Record<string, unknown>, mimeType: string): string {
  const candidate = typeof metadata.mediaType === 'string' ? metadata.mediaType.toLowerCase() : null;
  return candidate && SAFE_MEDIA_TYPES.has(candidate) ? candidate : mediaTypeFromMimeType(mimeType);
}

function buildGenericEvidenceDisplayName(mediaType: string, mimeType: string): string {
  const extension = extensionFromMimeType(mimeType);
  const baseName = `evidence-${SAFE_MEDIA_TYPES.has(mediaType) ? mediaType : 'file'}`;
  return extension ? `${baseName}.${extension}` : baseName;
}

function getSafeClientDisplayName(metadata: Record<string, unknown>, mimeType: string, mediaType: string): string | null {
  if (typeof metadata.displayName !== 'string') return null;

  const match = /^evidence-(photo|video|audio|document|file)(?:-\d+)?(?:\.([a-z0-9]{2,5}))?$/.exec(metadata.displayName);
  if (!match) return null;

  const [, displayMediaType, clientExtension] = match;
  if (displayMediaType !== mediaType) return null;

  const baseName = `evidence-${displayMediaType}`;
  const mimeExtension = extensionFromMimeType(mimeType);
  if (mimeExtension) return `${baseName}.${mimeExtension}`;

  return clientExtension && SAFE_DISPLAY_EXTENSIONS.has(clientExtension)
    ? `${baseName}.${clientExtension}`
    : baseName;
}

function sanitizePrivacyStatus(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;

  return SAFE_PRIVACY_FEATURES.reduce<Record<string, unknown>>((acc, feature) => {
    const entry = value[feature];
    const status = isRecord(entry) ? entry.status : entry;
    if (typeof status === 'string' && SAFE_PRIVACY_STATUSES.has(status)) {
      const result: Record<string, unknown> = { status };
      if (status === 'processed' && isRecord(entry)) {
        if (feature === 'faceBlur') {
          result.previewGenerated = entry.previewGenerated === true;
          result.userConfirmed = entry.userConfirmed === true;
          result.originalPreserved = entry.originalPreserved === true;
          if (typeof entry.confidence === 'number' && entry.confidence >= 0 && entry.confidence <= 1) {
            result.confidence = entry.confidence;
          }
        } else if (feature === 'metadataRemoval') {
          if (typeof entry.verifiedFileType === 'string') result.verifiedFileType = entry.verifiedFileType.slice(0, 120);
          if (entry.verificationMethod === 'before_after_metadata_diff') {
            result.verificationMethod = entry.verificationMethod;
          }
        } else if (feature === 'fileEncryption') {
          if (entry.algorithm === 'AES-256-GCM') result.algorithm = entry.algorithm;
          if (entry.keyManagement === 'device_keystore' || entry.keyManagement === 'recipient_envelope') {
            result.keyManagement = entry.keyManagement;
          }
          if (entry.sharingModel === 'device_only' || entry.sharingModel === 'recipient_wrapped_key') {
            result.sharingModel = entry.sharingModel;
          }
          if (typeof entry.keyReference === 'string') result.keyReference = entry.keyReference.slice(0, 120);
        }
      }
      acc[feature] = result;
    }
    return acc;
  }, {});
}

export function getEvidenceProcessingErrors(
  metadata: unknown,
  options: { allowProcessedClaims?: boolean } = {},
): string[] {
  if (!isRecord(metadata) || !isRecord(metadata.privacyStatus)) {
    return ['privacyStatus is required for every evidence upload'];
  }

  const errors: string[] = [];
  for (const feature of SAFE_PRIVACY_FEATURES) {
    const entry = metadata.privacyStatus[feature];
    if (!isRecord(entry)) {
      errors.push(`${feature} requires an explicit privacy status`);
      continue;
    }
    if (!SAFE_PRIVACY_STATUSES.has(String(entry.status))) {
      errors.push(`${feature} has an invalid privacy status`);
      continue;
    }
    if (['requested', 'processing', 'failed', 'unavailable'].includes(String(entry.status))) {
      errors.push(`${feature} is ${String(entry.status)}; upload requires not_requested or verified processed evidence`);
      continue;
    }
    if (entry.status !== 'processed') continue;
    if (options.allowProcessedClaims !== true) {
      errors.push(`${feature} processed claims are disabled pending device and security approval`);
      continue;
    }

    if (feature === 'faceBlur') {
      if (entry.previewGenerated !== true) errors.push('faceBlur processed requires a generated preview');
      if (typeof entry.confidence !== 'number' || entry.confidence < 0 || entry.confidence > 1) {
        errors.push('faceBlur processed requires confidence between 0 and 1');
      }
      if (entry.userConfirmed !== true) errors.push('faceBlur processed requires user confirmation');
      if (entry.originalPreserved !== true) errors.push('faceBlur processed requires original preservation');
    }
    if (feature === 'metadataRemoval') {
      if (typeof entry.verifiedFileType !== 'string' || !entry.verifiedFileType.trim()) {
        errors.push('metadataRemoval processed requires a verified file type');
      }
      if (entry.verificationMethod !== 'before_after_metadata_diff') {
        errors.push('metadataRemoval processed requires before/after verification');
      }
    }
    if (feature === 'fileEncryption') {
      if (entry.algorithm !== 'AES-256-GCM') errors.push('fileEncryption processed requires AES-256-GCM');
      if (!['device_keystore', 'recipient_envelope'].includes(String(entry.keyManagement))) {
        errors.push('fileEncryption processed requires an approved key-management model');
      }
      if (!['device_only', 'recipient_wrapped_key'].includes(String(entry.sharingModel))) {
        errors.push('fileEncryption processed requires an approved sharing model');
      }
      if (typeof entry.keyReference !== 'string' || !entry.keyReference.trim()) {
        errors.push('fileEncryption processed requires a non-secret key reference');
      }
    }
  }
  return errors;
}

function getSafePacketMetadataStatus(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_PACKET_METADATA_STATUSES.has(value) ? value : undefined;
}

function sanitizePrivacyRequests(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const requests = Array.from(new Set(
    value.filter((item): item is string => typeof item === 'string' && SAFE_PRIVACY_REQUESTS.has(item)),
  ));

  return requests.length > 0 ? requests : undefined;
}

export function buildSafeEvidenceMetadata(metadata: unknown, mimeType: string): Record<string, unknown> {
  const source = isRecord(metadata) ? metadata : {};
  const mediaType = getSafeMediaType(source, mimeType);
  const safeMetadata: Record<string, unknown> = {
    displayName: getSafeClientDisplayName(source, mimeType, mediaType) ?? buildGenericEvidenceDisplayName(mediaType, mimeType),
    mediaType,
  };

  const privacyStatus = sanitizePrivacyStatus(source.privacyStatus);
  if (privacyStatus && Object.keys(privacyStatus).length > 0) {
    safeMetadata.privacyStatus = privacyStatus;
  }

  if (typeof source.packetRedactionLevel === 'string' && SAFE_REDACTION_LEVELS.has(source.packetRedactionLevel)) {
    safeMetadata.packetRedactionLevel = source.packetRedactionLevel;
  }

  const packetMetadataStatus = getSafePacketMetadataStatus(source.packetMetadataStatus);
  if (packetMetadataStatus) {
    safeMetadata.packetMetadataStatus = packetMetadataStatus;
  }

  const privacyRequests = sanitizePrivacyRequests(source.privacyRequests);
  if (privacyRequests) {
    safeMetadata.privacyRequests = privacyRequests;
  }

  return safeMetadata;
}
