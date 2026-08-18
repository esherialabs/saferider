import type { DraftData } from './draftStorage';
import { summarizeEvidencePrivacyRequests } from './evidencePrivacyStatus';

export type EscalationRedactionLevel = 'none' | 'light' | 'heavy';

export interface EscalationPacketEvidenceItem {
  id: string;
  type: string;
  label: string;
  sizeBytes?: number;
  capturedAt?: string;
  checksum?: string;
  description?: string;
  transcript?: string;
  metadataStatus: string;
  privacyRequests: string[];
}

export interface EscalationPacket {
  version: '1.0';
  generatedAt: string;
  pathway: 'escalate';
  redactionLevel: EscalationRedactionLevel;
  contact: {
    preference: 'alias' | 'none';
    alias?: string;
    label: string;
  };
  content: {
    timeRange: string;
    location: string;
    incidentDescription: string;
    statement: string;
    impactSummary?: string;
    witnessDetails?: string;
    tags: string[];
    patterns: string[];
    transportIdentifiers: string[];
  };
  evidenceManifest: EscalationPacketEvidenceItem[];
  redaction: {
    appliedLabels: string[];
    textFields: string[];
    evidenceMetadata: string;
    mediaProcessing: string[];
  };
}

export type EscalationHandoffState = 'available' | 'queued' | 'failed' | 'unavailable';

export interface EscalationHandoffStatus {
  send: {
    state: EscalationHandoffState;
    label: string;
    reason?: string;
  };
  share: {
    state: EscalationHandoffState;
    label: string;
    reason?: string;
  };
}

const NAME_PATTERN = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
const PHONE_PATTERN = /\b\+?\d[\d\s().-]{7,}\d\b/g;
const PLATE_PATTERN = /\b[A-Z]{2,}\s?\d{2,}[A-Z]?\b/g;

function normalizeLevel(level?: EscalationRedactionLevel): EscalationRedactionLevel {
  return level ?? 'light';
}

export function formatEscalationTagLabel(tag: string): string {
  return tag
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function normalizeText(value?: string | null): string | undefined {
  const text = value?.trim();
  return text || undefined;
}

export function redactEscalationText(
  value: string,
  level: EscalationRedactionLevel,
): string {
  if (level === 'none') return value;

  let redacted = value
    .replace(NAME_PATTERN, '[redacted name]')
    .replace(PHONE_PATTERN, '[redacted contact]');

  if (level === 'heavy') {
    redacted = redacted.replace(PLATE_PATTERN, '[redacted vehicle plate]');
  }

  return redacted;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactDraftText(
  value: string,
  draft: DraftData,
  level: EscalationRedactionLevel,
): string {
  let redacted = redactEscalationText(value, level);

  if (level !== 'heavy') {
    return redacted;
  }

  const locationValues = [
    draft.location?.description,
    draft.location?.address,
    draft.location?.type,
  ]
    .map(normalizeText)
    .filter((item): item is string => Boolean(item))
    .sort((a, b) => b.length - a.length);

  for (const locationValue of locationValues) {
    redacted = redacted.replace(new RegExp(escapeRegExp(locationValue), 'gi'), '[redacted location]');
  }

  return redacted;
}

function buildTimeRange(draft: DraftData): string {
  const date = normalizeText(draft.datetime?.date);
  const time = draft.datetime?.time && draft.datetime.time !== '--:--'
    ? draft.datetime.time
    : undefined;
  const accuracy = normalizeText(draft.datetime?.accuracy);

  const parts = [date, time].filter(Boolean);
  const range = parts.length ? parts.join(' ') : 'Not provided';
  return accuracy && range !== 'Not provided' ? `${range} (${accuracy})` : range;
}

function buildLocation(draft: DraftData, level: EscalationRedactionLevel): string {
  const location = draft.location;
  if (!location) return 'Not provided';

  if (level === 'heavy') {
    const type = normalizeText(location.type);
    return type ? `${formatEscalationTagLabel(type)} location, exact details redacted` : 'Exact location redacted';
  }

  const parts = [
    normalizeText(location.description),
    normalizeText(location.address),
    normalizeText(location.type),
  ].filter(Boolean);

  if (location.coordinates) {
    parts.push(`Coordinates: ${location.coordinates.latitude}, ${location.coordinates.longitude}`);
  }

  return parts.length ? parts.join(' | ') : 'Not provided';
}

function buildTags(draft: DraftData): string[] {
  const tags = new Set<string>();
  (draft.selectedTags ?? []).forEach(tag => tags.add(formatEscalationTagLabel(tag)));
  (draft.acceptedSuggestions ?? []).forEach(tag => tags.add(formatEscalationTagLabel(tag)));
  (draft.customTags ?? []).forEach(tag => tags.add(formatEscalationTagLabel(tag)));
  return Array.from(tags);
}

function buildPatterns(draft: DraftData): string[] {
  return (draft.patterns ?? []).map(formatEscalationTagLabel);
}

function buildTransportIdentifiers(
  escalationData: NonNullable<DraftData['escalationData']> | undefined,
  level: EscalationRedactionLevel,
): string[] {
  const identifiers: string[] = [];
  const vehiclePlate = normalizeText(escalationData?.vehiclePlate);
  const operator = normalizeText(escalationData?.saccoOperator);

  if (vehiclePlate) {
    identifiers.push(
      level === 'heavy'
        ? 'Vehicle plate: [redacted vehicle plate]'
        : `Vehicle plate: ${redactEscalationText(vehiclePlate, level)}`,
    );
  }

  if (operator) {
    identifiers.push(`Operator: ${redactEscalationText(operator, level)}`);
  }

  return identifiers;
}

function buildPrivacyRequests(privacySettings?: DraftData['privacySettings']): string[] {
  return summarizeEvidencePrivacyRequests(privacySettings);
}

function evidenceMetadataStatus(level: EscalationRedactionLevel): string {
  if (level === 'heavy') {
    return 'File name and checksum withheld from packet metadata';
  }
  if (level === 'light') {
    return 'Text metadata redacted for names and contact values';
  }
  return 'Packet metadata included from saved draft fields';
}

const SAFE_UPLOAD_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'mp4', 'mov', 'm4a', 'mp3', 'wav', 'pdf', 'doc', 'docx']);

function extensionFromMimeType(mimeType?: string): string | null {
  switch (mimeType?.toLowerCase()) {
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

function getSafeUploadExtension(media: NonNullable<DraftData['mediaFiles']>[number]): string {
  const mimeExtension = extensionFromMimeType(media.mimeType);
  if (mimeExtension) return `.${mimeExtension}`;

  const fileExtension = media.fileName?.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '');
  return fileExtension && SAFE_UPLOAD_EXTENSIONS.has(fileExtension) ? `.${fileExtension}` : '';
}

function buildGenericUploadFileName(
  media: NonNullable<DraftData['mediaFiles']>[number],
  evidenceIndex: number,
): string {
  const type = ['photo', 'video', 'audio', 'document'].includes(media.type) ? media.type : 'evidence';
  return `${type}-${evidenceIndex + 1}`;
}

function buildPacketEvidenceLabel(
  media: NonNullable<DraftData['mediaFiles']>[number],
  evidenceIndex: number,
  level: EscalationRedactionLevel,
): string {
  const rawFileName = media.fileName || media.id || `evidence-${evidenceIndex + 1}`;
  if (level === 'heavy') {
    return `${formatEscalationTagLabel(media.type)} evidence ${evidenceIndex + 1}`;
  }
  return level === 'none' ? rawFileName : redactEscalationText(rawFileName, level);
}

export function buildEscalationEvidenceUploadDescriptor({
  media,
  evidenceIndex,
  redactionLevel,
  privacySettings,
}: {
  media: NonNullable<DraftData['mediaFiles']>[number];
  evidenceIndex: number;
  redactionLevel: EscalationRedactionLevel;
  privacySettings?: DraftData['privacySettings'];
}): { fileName: string; metadata: Record<string, unknown> } {
  const level = normalizeLevel(redactionLevel);
  const uploadFileName = `${buildGenericUploadFileName(media, evidenceIndex)}${getSafeUploadExtension(media)}`;

  const metadata: Record<string, unknown> = {
    mediaType: media.type,
    packetRedactionLevel: level,
    displayName: uploadFileName,
    packetMetadataStatus: evidenceMetadataStatus(level),
    privacyRequests: buildPrivacyRequests(privacySettings),
  };

  return {
    fileName: uploadFileName,
    metadata,
  };
}

function buildEvidenceManifest(
  draft: DraftData,
  level: EscalationRedactionLevel,
): EscalationPacketEvidenceItem[] {
  return (draft.mediaFiles ?? []).map((media, index) => {
    const label = buildPacketEvidenceLabel(media, index, level);

    return {
      id: level === 'heavy' ? `${media.type}-${index + 1}` : media.id,
      type: media.type,
      label,
      sizeBytes: media.size,
      capturedAt: media.timestamp instanceof Date ? media.timestamp.toISOString() : String(media.timestamp),
      checksum: level === 'heavy' ? undefined : media.checksum,
      description: normalizeText(media.description)
        ? redactDraftText(normalizeText(media.description)!, draft, level)
        : undefined,
      transcript: normalizeText(media.transcript)
        ? redactDraftText(normalizeText(media.transcript)!, draft, level)
        : undefined,
      metadataStatus: evidenceMetadataStatus(level),
      privacyRequests: buildPrivacyRequests(draft.privacySettings),
    };
  });
}

function buildRedactionLabels(
  draft: DraftData,
  level: EscalationRedactionLevel,
): EscalationPacket['redaction'] {
  const appliedLabels: string[] = [];
  const textFields: string[] = [];

  if (level === 'none') {
    appliedLabels.push('No packet text redaction selected');
  } else if (level === 'light') {
    appliedLabels.push('Packet text redacted for names and contact values');
    textFields.push('incident description', 'statement', 'witness details', 'evidence descriptions');
  } else {
    appliedLabels.push('Packet text redacted for names, contact values, plates, and exact location');
    textFields.push('incident description', 'statement', 'witness details', 'location', 'transport identifiers', 'evidence metadata');
  }

  const mediaProcessing = buildPrivacyRequests(draft.privacySettings);
  appliedLabels.push(...mediaProcessing);

  return {
    appliedLabels,
    textFields,
    evidenceMetadata: evidenceMetadataStatus(level),
    mediaProcessing,
  };
}

export function buildEscalationPacket(
  draft: DraftData,
  options: { generatedAt?: string } = {},
): EscalationPacket {
  const escalationData = draft.escalationData;
  const redactionLevel = normalizeLevel(escalationData?.redactionLevel);
  const incidentDescription = normalizeText(draft.incidentDescription);
  const textEvidence = normalizeText(draft.textEvidence);
  const statementSource = textEvidence || incidentDescription;
  const alias = normalizeText(escalationData?.alias);
  const contactPreference = escalationData?.contactPreference === 'alias' ? 'alias' : 'none';

  return {
    version: '1.0',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    pathway: 'escalate',
    redactionLevel,
    contact: {
      preference: contactPreference,
      alias: contactPreference === 'alias' ? alias : undefined,
      label: contactPreference === 'alias'
        ? alias ? `Alias: ${alias}` : 'Alias requested but not provided'
        : 'No follow-up contact requested',
    },
    content: {
      timeRange: buildTimeRange(draft),
      location: buildLocation(draft, redactionLevel),
      incidentDescription: incidentDescription
        ? redactDraftText(incidentDescription, draft, redactionLevel)
        : 'No incident description recorded in this draft.',
      statement: statementSource
        ? redactDraftText(statementSource, draft, redactionLevel)
        : 'No statement text recorded in this draft.',
      impactSummary: normalizeText(draft.impactSummary)
        ? redactDraftText(normalizeText(draft.impactSummary)!, draft, redactionLevel)
        : undefined,
      witnessDetails: draft.witnesses
        ? (normalizeText(draft.witnessDetails) ? redactDraftText(normalizeText(draft.witnessDetails)!, draft, redactionLevel) : undefined) ?? 'Witnesses recorded without details'
        : undefined,
      tags: buildTags(draft),
      patterns: buildPatterns(draft),
      transportIdentifiers: buildTransportIdentifiers(escalationData, redactionLevel),
    },
    evidenceManifest: buildEvidenceManifest(draft, redactionLevel),
    redaction: buildRedactionLabels(draft, redactionLevel),
  };
}

export function buildEscalationHandoffStatus({
  isOnline,
  hasCaseServiceEndpoint = true,
  shareSheetAvailable = false,
  packetReady = true,
  failureReason,
}: {
  isOnline: boolean;
  hasCaseServiceEndpoint?: boolean;
  shareSheetAvailable?: boolean;
  packetReady?: boolean;
  failureReason?: string;
}): EscalationHandoffStatus {
  let send: EscalationHandoffStatus['send'];

  if (failureReason) {
    send = {
      state: 'failed',
      label: 'Submission failed',
      reason: failureReason,
    };
  } else if (!packetReady) {
    send = {
      state: 'unavailable',
      label: 'Packet unavailable',
      reason: 'No saved draft was found for this escalation.',
    };
  } else if (!hasCaseServiceEndpoint) {
    send = {
      state: 'unavailable',
      label: 'Sending unavailable',
      reason: 'No reviewed escalation endpoint is configured for this release.',
    };
  } else if (isOnline) {
    send = {
      state: 'available',
      label: 'Available after consent',
      reason: 'The packet will be sent through the SafeRide case service.',
    };
  } else {
    send = {
      state: 'queued',
      label: 'Queues after consent',
      reason: 'The saved packet will wait in the offline queue until the device is online.',
    };
  }

  return {
    send,
    share: shareSheetAvailable
      ? {
          state: 'available',
          label: 'Share sheet available',
          reason: 'A local packet file can be shared by choosing an app.',
        }
      : {
          state: 'unavailable',
          label: 'Separate share unavailable',
          reason: 'This release sends escalation packets through consent and the case service; separate packet export is not enabled.',
        },
  };
}
