import type { DraftData } from './draftStorage';

export interface StatementReviewDraft {
  id: string;
  content: string;
  tags: string[];
  sources: string[];
  timestamp: string;
  isEdited: boolean;
  wordCount: number;
  readingTime: number;
}

interface StatementContentResult {
  content: string;
  sources: string[];
}

type DraftMediaFile = NonNullable<DraftData['mediaFiles']>[number];

export function buildStatementReviewFromDraft(draft: DraftData | null | undefined): StatementReviewDraft | null {
  if (!draft) return null;

  const result = buildStatementContentFromDraft(draft);
  if (!result) return null;

  const wordCount = countStatementWords(result.content);

  return {
    id: draft.id,
    content: result.content,
    tags: buildStatementReviewTags(draft),
    sources: result.sources.length ? result.sources : ['Saved draft fields'],
    timestamp: formatTimestamp(draft.updatedAt),
    isEdited: Boolean(normalizeText(draft.textEvidence)),
    wordCount,
    readingTime: getStatementReadingTime(wordCount),
  };
}

export function buildStatementReviewTags(draft: DraftData): string[] {
  return unique([
    ...(draft.selectedTags ?? []),
    ...(draft.acceptedSuggestions ?? []),
    ...(draft.patterns ?? []),
    ...(draft.customTags ?? []),
  ]);
}

export function buildTranscriptSuggestions(draft: DraftData): string[] {
  const transcripts = (draft.mediaFiles ?? [])
    .map(file => normalizeText(file.transcript))
    .filter((text): text is string => Boolean(text));

  return unique(
    transcripts.flatMap(text =>
      text
        .split(/(?<=[.!?])\s+/)
        .map(sentence => sentence.trim())
        .filter(sentence => sentence.length >= 20),
    ),
  ).slice(0, 8);
}

export function countStatementWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function getStatementReadingTime(wordCount: number): number {
  return Math.max(1, Math.ceil(wordCount / 200));
}

export function formatStatementTagLabel(tag: string): string {
  return tag
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function buildStatementContentFromDraft(draft: DraftData): StatementContentResult | null {
  if (!hasStatementAnchor(draft)) return null;

  const paragraphs: string[] = [];
  const sources: string[] = [];

  const textEvidence = normalizeText(draft.textEvidence);
  const incidentDescription = normalizeText(draft.incidentDescription);

  const textEvidenceIsCompiled = textEvidence ? hasCompiledStatementSections(textEvidence) : false;

  if (textEvidence) {
    paragraphs.push(textEvidence);
    sources.push(textEvidenceIsCompiled ? 'Saved edited statement' : 'Saved statement or text evidence');
  }

  if (textEvidenceIsCompiled) {
    return {
      content: paragraphs.join('\n\n').trim(),
      sources: unique(sources),
    };
  }

  if (incidentDescription && !sameText(incidentDescription, textEvidence)) {
    addSection(paragraphs, 'Incident description', incidentDescription);
    sources.push('Incident description');
  }

  const whenWhere = buildWhenWhereSection(draft);
  if (whenWhere) {
    addSection(paragraphs, 'When and where', whenWhere);
    sources.push('Date, time, and location fields');
  }

  const impact = buildImpactSection(draft);
  if (impact) {
    addSection(paragraphs, 'Impact and safety context', impact);
    sources.push('Impact and safety fields');
  }

  const tags = buildTagsSection(draft);
  if (tags) {
    addSection(paragraphs, 'Review tags and patterns', tags);
    sources.push('Saved tags and pattern fields');
  }

  const evidence = buildEvidenceSection(draft.mediaFiles ?? []);
  if (evidence) {
    addSection(paragraphs, 'Evidence saved with this draft', evidence);
    sources.push('Evidence metadata');
  }

  const support = buildSupportSection(draft);
  if (support) {
    addSection(paragraphs, 'Support pathway details', support);
    sources.push('Pathway and provider fields');
  }

  const escalation = buildEscalationSection(draft.escalationData);
  if (escalation) {
    addSection(paragraphs, 'Escalation details', escalation);
    sources.push('Escalation fields');
  }

  const notes = buildNotesSection(draft.followUpAnswers);
  if (notes) {
    addSection(paragraphs, 'Additional saved notes', notes);
    sources.push('Follow-up answers');
  }

  const content = paragraphs.join('\n\n').trim();
  if (!content) return null;

  return {
    content,
    sources: unique(sources),
  };
}

function hasStatementAnchor(draft: DraftData): boolean {
  return Boolean(
    normalizeText(draft.textEvidence) ||
      normalizeText(draft.incidentDescription) ||
      normalizeText(draft.impactSummary) ||
      normalizeText(draft.witnessDetails) ||
      draft.witnesses === true ||
      draft.immediateHelp === true ||
      (draft.mediaFiles ?? []).some(hasMeaningfulEvidence) ||
      hasMeaningfulNotes(draft.followUpAnswers) ||
      normalizeText(draft.escalationData?.vehiclePlate) ||
      normalizeText(draft.escalationData?.saccoOperator) ||
      normalizeText(draft.escalationData?.alias) ||
      normalizeText(draft.selectedPathway) ||
      normalizeText(draft.selectedProvider) ||
      normalizeText(draft.selectedChannel) ||
      normalizeText(draft.fallbackNumber) ||
      Boolean(draft.referralSelection),
  );
}

function hasMeaningfulEvidence(file: DraftMediaFile): boolean {
  return Boolean(
    normalizeText(file.fileName) ||
      normalizeText(file.description) ||
      normalizeText(file.transcript) ||
      normalizeText(file.checksum),
  );
}

function buildWhenWhereSection(draft: DraftData): string | null {
  const parts: string[] = [];
  const date = normalizeText(draft.datetime?.date);
  const time = normalizeTime(draft.datetime?.time);
  const accuracy = normalizeText(draft.datetime?.accuracy);
  const when = [date, time].filter(Boolean).join(' ');

  if (when) {
    parts.push(`Date/time: ${accuracy ? `${when} (${accuracy})` : when}`);
  }

  const duration = normalizeText(draft.duration);
  if (duration) {
    parts.push(`Duration: ${duration}`);
  }

  if (typeof draft.isOngoing === 'boolean') {
    parts.push(`Ongoing: ${draft.isOngoing ? 'yes' : 'no'}`);
  }

  const locationParts = [
    normalizeText(draft.location?.description),
    normalizeText(draft.location?.address),
    normalizeText(draft.location?.type),
  ].filter((value): value is string => Boolean(value));

  if (draft.location?.coordinates) {
    locationParts.push(
      `Coordinates: ${draft.location.coordinates.latitude}, ${draft.location.coordinates.longitude}`,
    );
  }

  if (locationParts.length) {
    parts.push(`Location: ${locationParts.join(' | ')}`);
  }

  return parts.length ? parts.join('; ') : null;
}

function buildImpactSection(draft: DraftData): string | null {
  const parts: string[] = [];

  if (draft.impactLevel) {
    parts.push(`Impact level: ${draft.impactLevel}`);
  }

  const impactSummary = normalizeText(draft.impactSummary);
  if (impactSummary) {
    parts.push(`Impact: ${impactSummary}`);
  }

  if (draft.witnesses === true) {
    parts.push(
      normalizeText(draft.witnessDetails)
        ? `Witness details: ${normalizeText(draft.witnessDetails)}`
        : 'Witnesses recorded without details',
    );
  } else if (draft.witnesses === false) {
    parts.push('No witnesses recorded in this draft');
  }

  if (typeof draft.immediateHelp === 'boolean') {
    parts.push(`Immediate help requested: ${draft.immediateHelp ? 'yes' : 'no'}`);
  }

  return parts.length ? parts.join('; ') : null;
}

function buildTagsSection(draft: DraftData): string | null {
  const savedTags = unique([
    ...(draft.selectedTags ?? []),
    ...(draft.acceptedSuggestions ?? []),
    ...(draft.customTags ?? []),
  ]).map(formatStatementTagLabel);
  const patterns = unique(draft.patterns ?? []).map(formatStatementTagLabel);
  const parts: string[] = [];

  if (savedTags.length) {
    parts.push(`Tags: ${savedTags.join(', ')}`);
  }

  if (patterns.length) {
    parts.push(`Patterns: ${patterns.join(', ')}`);
  }

  return parts.length ? parts.join('; ') : null;
}

function buildEvidenceSection(mediaFiles: DraftMediaFile[]): string | null {
  const items = mediaFiles
    .filter(hasMeaningfulEvidence)
    .map((file, index) => formatEvidenceItem(file, index));

  return items.length ? items.join('; ') : null;
}

function formatEvidenceItem(file: DraftMediaFile, index: number): string {
  const parts = [`${formatStatementTagLabel(file.type)} evidence ${index + 1}`];
  const fileName = normalizeText(file.fileName);
  const description = normalizeText(file.description);
  const transcript = normalizeText(file.transcript);
  const checksum = normalizeText(file.checksum);

  if (fileName) {
    parts.push(`file "${fileName}"`);
  }

  if (Number.isFinite(file.size) && file.size > 0) {
    parts.push(`size ${formatBytes(file.size)}`);
  }

  const capturedAt = toIsoString(file.timestamp);
  if (capturedAt) {
    parts.push(`captured ${capturedAt}`);
  }

  if (description) {
    parts.push(`description: ${description}`);
  }

  if (checksum) {
    parts.push('checksum recorded');
  }

  if (transcript) {
    parts.push(`transcript saved (${countStatementWords(transcript)} words)`);
  }

  return parts.join(', ');
}

function buildSupportSection(draft: DraftData): string | null {
  const parts: string[] = [];
  const pathway = normalizeText(draft.selectedPathway);

  if (pathway) {
    parts.push(`Selected pathway: ${formatStatementTagLabel(pathway)}`);
  }

  if (draft.referralSelection) {
    const referral = draft.referralSelection;
    parts.push(`Provider: ${referral.providerName} (${referral.providerType})`);
    if (referral.selectedChannel) {
      parts.push(`Contact channel selected: ${formatStatementTagLabel(referral.selectedChannel)}`);
    } else {
      parts.push('Contact channel unavailable while provider review is pending');
    }
    parts.push(`Brief included: ${referral.includeBrief ? 'yes' : 'no'}`);

    if (referral.serviceScope.length) {
      parts.push(`Services: ${referral.serviceScope.join(', ')}`);
    }

    if (normalizeText(referral.coverage)) {
      parts.push(`Coverage: ${normalizeText(referral.coverage)}`);
    }
  } else {
    const provider = normalizeText(draft.selectedProvider);
    const channel = normalizeText(draft.selectedChannel);
    const fallbackNumber = normalizeText(draft.fallbackNumber);

    if (provider) {
      parts.push(`Selected provider: ${provider}`);
    }

    if (channel) {
      parts.push(`Contact channel selected: ${formatStatementTagLabel(channel)}`);
    }

    if (typeof draft.includeBrief === 'boolean') {
      parts.push(`Brief included: ${draft.includeBrief ? 'yes' : 'no'}`);
    }

    if (fallbackNumber) {
      parts.push(`Fallback contact saved: ${fallbackNumber}`);
    }
  }

  return parts.length ? parts.join('; ') : null;
}

function buildEscalationSection(escalationData?: DraftData['escalationData']): string | null {
  if (!escalationData) return null;

  const parts: string[] = [];
  const redactionLevel = normalizeText(escalationData.redactionLevel);
  const vehiclePlate = normalizeText(escalationData.vehiclePlate);
  const saccoOperator = normalizeText(escalationData.saccoOperator);
  const contactPreference = normalizeText(escalationData.contactPreference);
  const alias = normalizeText(escalationData.alias);

  if (redactionLevel) {
    parts.push(`Redaction level selected: ${redactionLevel}`);
  }

  if (vehiclePlate) {
    parts.push(`Vehicle plate: ${vehiclePlate}`);
  }

  if (saccoOperator) {
    parts.push(`Operator: ${saccoOperator}`);
  }

  if (contactPreference) {
    parts.push(`Contact preference: ${contactPreference}`);
  }

  if (alias) {
    parts.push(`Alias saved: ${alias}`);
  }

  return parts.length ? parts.join('; ') : null;
}

function buildNotesSection(followUpAnswers?: Record<string, string>): string | null {
  if (!followUpAnswers) return null;

  const answers = Object.entries(followUpAnswers)
    .map(([key, value]) => {
      const text = normalizeText(value);
      return text ? `${formatAnswerKey(key)}: ${text}` : null;
    })
    .filter((value): value is string => Boolean(value));

  return answers.length ? answers.join('; ') : null;
}

function hasMeaningfulNotes(followUpAnswers?: Record<string, string>): boolean {
  return Boolean(
    followUpAnswers &&
      Object.values(followUpAnswers).some(value => Boolean(normalizeText(value))),
  );
}

function formatAnswerKey(key: string): string {
  return formatStatementTagLabel(
    key
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' '),
  );
}

function addSection(paragraphs: string[], label: string, text: string): void {
  paragraphs.push(`${label}: ${text}`);
}

function hasCompiledStatementSections(text: string): boolean {
  return [
    'Incident description:',
    'When and where:',
    'Impact and safety context:',
    'Review tags and patterns:',
    'Evidence saved with this draft:',
    'Support pathway details:',
    'Escalation details:',
    'Additional saved notes:',
  ].some(label => text.includes(label));
}

function formatTimestamp(value?: Date | string | null): string {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toLocaleString() : date.toLocaleString();
}

function normalizeText(value?: string | null): string | undefined {
  const text = value?.trim();
  return text || undefined;
}

function normalizeTime(value?: string | null): string | undefined {
  const time = normalizeText(value);
  return time && time !== '--:--' ? time : undefined;
}

function sameText(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

function toIsoString(value?: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return 'Unknown';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
  return `${Math.round(size / (1024 * 102.4)) / 10} MB`;
}
