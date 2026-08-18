import type { Provider } from '../lib/catalog';
import type { PathwayType } from '../types/pathways';
import type { DraftData } from './draftStorage';
import { buildEscalationPacket } from './escalationPacket';
import type { EscalationPacket } from './escalationPacket';
import { getConsentValidation } from './consentReview';
import type { ConsentValidationResult } from './consentReview';
import { summarizeEvidencePrivacyForConsent } from './evidencePrivacyStatus';
import { buildProviderConsentDetails, shouldIncludeReferralBrief } from './referralSupport';

export type ConsentEditRoute =
  | 'ConsentGate'
  | 'WhatHappened'
  | 'WhereWhen'
  | 'EvidenceDetail'
  | 'ReferralPicker'
  | 'EscalationForm';

export interface ConsentChecklistItem {
  icon: string;
  label: string;
  value: string;
  details?: string[];
}

export interface ConsentKeyPoint {
  icon: string;
  label: string;
  value: string;
  details?: string[];
}

export interface ConsentEditAction {
  id: string;
  label: string;
  route: ConsentEditRoute;
}

export interface ConsentSummaryModel {
  title: string;
  subtitle: string;
  checklistTitle: string;
  primaryButtonLabel: string;
  consentStatement: string;
  keyPoints: ConsentKeyPoint[];
  checklistItems: ConsentChecklistItem[];
  editActions: ConsentEditAction[];
  redactionChips?: string[];
  redactionAction?: ConsentEditAction;
  retentionNoticeTitle: string;
  retentionNotice: string;
  offlineBadge?: string;
  validation: ConsentValidationResult;
}

export type AnonymousSignalSharingState = {
  enabled: boolean;
  consentVersion: string | null;
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DURATION_LABELS: Record<string, string> = {
  seconds: 'A few seconds',
  '1-5min': '1-5 minutes',
  '5-15min': '5-15 minutes',
  '15-30min': '15-30 minutes',
  '30-60min': '30-60 minutes',
  over_hour: 'Over 1 hour',
  ongoing: 'Ongoing or repeated',
  unsure: 'Unsure',
};

const ACCURACY_LABELS: Record<string, string> = {
  exact: 'Exact time',
  approximate: 'Approximate time',
  estimated: 'Estimated time',
  unsure: 'Unsure about time',
};

const LOCATION_CONTEXT_LABELS: Record<string, string> = {
  workplace: 'Workplace',
  public_transport: 'Public transportation',
  street: 'Street or sidewalk',
  business: 'Business or store',
  restaurant: 'Restaurant or bar',
  education: 'Educational institution',
  healthcare: 'Healthcare facility',
  government: 'Government building',
  residence: 'Private residence',
  online: 'Online / digital space',
  other: 'Other location',
};

const CHANNEL_LABELS: Record<'call' | 'whatsapp' | 'sms', string> = {
  call: 'Phone call',
  whatsapp: 'WhatsApp message',
  sms: 'SMS message',
};

const PATTERN_LABELS: Record<string, string> = {
  verbal_harassment: 'Verbal harassment',
  physical_threat: 'Physical threat',
  discrimination: 'Discrimination',
  sexual_harassment: 'Sexual harassment',
  workplace_retaliation: 'Workplace retaliation',
  stalking: 'Stalking or following',
  property_damage: 'Property damage',
  other: 'Other incident',
};

function formatDateString(dateStr?: string): string | undefined {
  if (!dateStr) return undefined;
  const [year, month, day] = dateStr.split('-').map(part => part.trim());
  if (!year || !month || !day) return dateStr;
  const monthIndex = Number(month) - 1;
  const monthLabel = MONTH_NAMES[monthIndex] ?? month;
  return `${monthLabel} ${Number(day)}, ${year}`;
}

function formatTimeString(timeStr?: string): string | undefined {
  if (!timeStr || timeStr === '--:--') return undefined;
  const [hourStr, minuteStr] = timeStr.split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return timeStr;
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minute.toString().padStart(2, '0')} ${period}`;
}

function truncate(text: string, maxLength = 140): string {
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}...`;
}

function formatTagLabel(tag: string): string {
  return tag
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function mapPatternsToLabels(patterns?: string[]): string[] {
  return (patterns ?? []).map(pattern => PATTERN_LABELS[pattern] ?? formatTagLabel(pattern));
}

function withDetails(item: ConsentChecklistItem, details?: string[] | null): ConsentChecklistItem {
  const detailArray = (details ?? []).filter(Boolean);
  return detailArray.length ? { ...item, details: detailArray } : item;
}

function buildWhenSummary(draft: DraftData): { value?: string; details: string[] } {
  const details: string[] = [];
  const datePart = formatDateString(draft.datetime?.date);
  const timePart = formatTimeString(draft.datetime?.time);

  if (!datePart && !timePart) {
    return { value: undefined, details };
  }

  if (draft.datetime?.accuracy) {
    details.push(ACCURACY_LABELS[draft.datetime.accuracy] ?? `Accuracy: ${draft.datetime.accuracy}`);
  }
  if (draft.duration) {
    details.push(`Duration: ${DURATION_LABELS[draft.duration] ?? draft.duration}`);
  }
  if (draft.isOngoing) {
    details.push('Marked as ongoing');
  }

  if (datePart && timePart) {
    return { value: `${datePart} at ${timePart}`, details };
  }

  return { value: datePart ?? timePart, details };
}

function buildLocationSummary(draft: DraftData): { value?: string; details: string[]; precision: string } {
  const location = draft.location;
  if (!location) {
    return { value: undefined, details: [], precision: 'No location saved in this draft.' };
  }

  const parts = [location.description, location.address].filter(Boolean);
  const details: string[] = [];

  if (parts.length > 1 && parts[1] !== parts[0]) {
    details.push(parts[1] as string);
  }
  if (location.type) {
    details.push(`Context: ${LOCATION_CONTEXT_LABELS[location.type] ?? formatTagLabel(location.type)}`);
  }
  if (location.coordinates) {
    details.push(
      `Saved coordinates included from draft (${location.coordinates.latitude.toFixed(5)}, ${location.coordinates.longitude.toFixed(5)}).`,
    );
  }

  const precision = location.coordinates
    ? 'Saved coordinates are included from the draft; no additional location lookup runs from consent.'
    : 'Only the saved description/address fields are included.';

  return {
    value: parts[0],
    details,
    precision,
  };
}

function buildIncidentSummary(draft: DraftData): { summary?: string; details: string[] } {
  const details: string[] = [];
  const description = draft.incidentDescription?.trim();
  const impact = draft.impactSummary?.trim();

  if (impact) {
    details.push(`Impact: ${impact}`);
  }
  if (draft.witnesses) {
    details.push(
      draft.witnessDetails?.trim()
        ? `Witness details: ${draft.witnessDetails.trim()}`
        : 'Witnesses recorded',
    );
  }
  if (draft.followUpAnswers && Object.keys(draft.followUpAnswers).length > 0) {
    details.push('Follow-up questions answered');
  }

  return {
    summary: description ? truncate(description, 140) : undefined,
    details,
  };
}

function buildStatementPreview(draft: DraftData): { summary?: string; details: string[] } {
  const primary = draft.textEvidence?.trim() || draft.incidentDescription?.trim();
  if (!primary) return { summary: undefined, details: [] };

  const details = [primary];
  if (draft.textEvidence && draft.incidentDescription && draft.textEvidence !== draft.incidentDescription) {
    details.push('Narrative entered separately from incident description.');
  }
  if (draft.impactSummary) {
    details.push(`Impact statement: ${draft.impactSummary}`);
  }

  return {
    summary: truncate(primary, 160),
    details,
  };
}

function summarizeAttachments(
  mediaFiles: DraftData['mediaFiles'],
  privacySettings: DraftData['privacySettings'],
  options: { uploadIncluded: boolean; localOnly?: boolean },
): { summary?: string; details: string[] } {
  if (!mediaFiles?.length) return { summary: undefined, details: [] };

  const counts: Record<string, number> = {};
  const privacyDetails = summarizeEvidencePrivacyForConsent(mediaFiles, privacySettings, {
    uploadIncluded: options.uploadIncluded,
  });
  const details: string[] = [];

  mediaFiles.forEach((file, index) => {
    counts[file.type] = (counts[file.type] ?? 0) + 1;
    const privacy = privacyDetails[index]?.replace(/^.*?: /, '');
    const prefix = options.localOnly ? 'Local only' : 'Evidence file';
    details.push(privacy ? `${prefix} - ${file.fileName}: ${privacy}` : `${prefix} - ${file.fileName}`);
  });

  const summary = Object.entries(counts)
    .map(([type, count]) => `${count} ${formatTagLabel(type)}${count > 1 ? 's' : ''}`)
    .join(', ');

  return { summary, details };
}

function summarizeEscalationEvidence(packet: EscalationPacket): { summary: string; details: string[] } {
  if (!packet.evidenceManifest.length) {
    return { summary: 'No evidence files recorded', details: ['No evidence files recorded in this draft.'] };
  }

  return {
    summary: `${packet.evidenceManifest.length} packet evidence item${packet.evidenceManifest.length === 1 ? '' : 's'}`,
    details: packet.evidenceManifest.map(item => {
      const checksum = item.checksum ? `; checksum ${item.checksum.slice(0, 16)}...` : '';
      const privacy = item.privacyRequests.length ? `; ${item.privacyRequests.join('; ')}` : '';
      return `${item.label}: ${item.metadataStatus}${checksum}${privacy}`;
    }),
  };
}

function buildRedactionChips(draft: DraftData, pathway: PathwayType): string[] {
  if (pathway === 'anonymous-map') {
    return [];
  }

  if (pathway === 'escalate') {
    return buildEscalationPacket(draft).redaction.appliedLabels;
  }

  const chips: string[] = [];
  if (draft.privacySettings?.blurFaces) {
    chips.push('Face blur requested, not processed');
  }
  if (draft.privacySettings?.removeMetadata) {
    chips.push('Metadata removal requested, not processed');
  }
  if (draft.privacySettings?.encryptFiles) {
    chips.push('File encryption requested, not processed');
  }
  return chips;
}

function getPathwayLabels(pathway: PathwayType, anonymousSignalSharing: AnonymousSignalSharingState): { title: string; primary: string; label: string } {
  switch (pathway) {
    case 'save-private':
      return {
        title: 'Review & consent - Save privately',
        primary: 'Save privately',
        label: 'Save privately',
      };
    case 'anonymous-map':
      return {
        title: 'Review & consent - Map update record',
        primary: anonymousSignalSharing.enabled ? 'Share minimized map signal' : 'Save map record',
        label: 'Map update record',
      };
    case 'referral':
      return {
        title: 'Review & consent - Get help referral',
        primary: 'Save referral choice',
        label: 'Get help referral',
      };
    case 'escalate':
      return {
        title: 'Review & consent - Escalation packet',
        primary: 'Save packet',
        label: 'Escalation packet',
      };
  }
}

function getDataCategories(
  pathway: PathwayType,
  draft: DraftData,
  includeBrief: boolean,
  anonymousSignalSharing: AnonymousSignalSharingState,
  hasContactChannel: boolean,
): string[] {
  if (pathway === 'save-private') {
    return ['Report details', 'saved evidence references', 'privacy requests', 'pathway choice'];
  }

  if (pathway === 'anonymous-map') {
    if (anonymousSignalSharing.enabled) {
      return ['approved coarse-cell ID', 'fixed time bucket', 'controlled category', 'consent and policy version'];
    }
    return [
      'local map update record',
      'saved draft ID',
      'saved location object',
      'time/duration/ongoing fields if provided',
      'raw category/tag values',
      'draft timestamps',
    ];
  }

  if (pathway === 'referral' && !includeBrief) {
    return hasContactChannel
      ? ['Provider ID', 'contact channel', 'brief preference']
      : ['Provider ID', 'provider review status', 'brief preference'];
  }

  if (pathway === 'referral') {
    return [
      'Provider ID',
      hasContactChannel ? 'contact channel' : 'provider review status',
      'selected categories',
      'date accuracy',
      'general location type',
      'ongoing status',
    ];
  }

  const categories = ['Incident summary', 'time', 'location', 'tags'];
  if (draft.mediaFiles?.length) categories.push('evidence files and privacy status');
  if (draft.textEvidence) categories.push('statement text');
  if (pathway === 'escalate') categories.push('redacted packet fields and escalation contact preference');
  return categories;
}

function getRecipient(
  pathway: PathwayType,
  anonymousSignalSharing: AnonymousSignalSharingState,
  providerName?: string,
  hasContactChannel = false,
): string {
  switch (pathway) {
    case 'save-private':
      return 'No recipient - saved on this device only.';
    case 'anonymous-map':
      return anonymousSignalSharing.enabled
        ? 'SafeRide anonymous aggregate service. Operator output remains threshold-suppressed and read-only.'
        : 'Local SafeRide map record. No live public map endpoint is configured in this release.';
    case 'referral':
      return providerName
        ? hasContactChannel
          ? `${providerName}. SafeRide saves the choice locally; contact happens through the channel you choose.`
          : `${providerName}. SafeRide saves this information locally; contact actions remain unavailable while review is pending.`
        : 'Selected support provider. SafeRide saves the choice locally.';
    case 'escalate':
      return 'Local escalation packet. Online intake must be available before it can be sent.';
  }
}

function getOutcome(
  pathway: PathwayType,
  isOnline: boolean,
  anonymousSignalSharing: AnonymousSignalSharingState,
  hasContactChannel = false,
): string {
  switch (pathway) {
    case 'save-private':
      return 'Saves the draft locally. This action does not submit or queue a network request.';
    case 'anonymous-map':
      return anonymousSignalSharing.enabled
        ? 'Saves the local record and sends only the reviewed minimized signals after versioned aggregate consent. It does not create a case.'
        : 'Saves a local map record. No API upload or live map update runs from this consent step.';
    case 'referral':
      if (!hasContactChannel) {
        return 'Saves the provider information locally. No call or message action is enabled for this listing.';
      }
      return isOnline
        ? 'Saves the provider and channel. Calls, SMS, or online channels are opened separately; provider receipt is not confirmed here.'
        : 'Saves the provider and channel. Calls or SMS can still be used where the device network supports them.';
    case 'escalate':
      return isOnline
        ? 'Saves the escalation packet locally. A no-sign-in online intake endpoint can be connected separately.'
        : 'Saves the escalation packet locally. Go online before sending it to an action service.';
  }
}

function getOfflineBehavior(
  pathway: PathwayType,
  isOnline: boolean,
  anonymousSignalSharing: AnonymousSignalSharingState,
  hasContactChannel = false,
): string {
  if (pathway === 'save-private') {
    return 'Works offline because nothing leaves this device.';
  }

  if (pathway === 'referral') {
    if (!hasContactChannel) {
      return 'Provider information is saved locally. No contact action is available for this listing.';
    }
    return isOnline
      ? 'Online channels such as WhatsApp need a connection; call or SMS can be used through the phone network.'
      : 'Referral details are saved offline. Use call or SMS if the provider lists them.';
  }

  if (pathway === 'escalate') {
    return isOnline
      ? 'The packet is saved locally. Sending requires a reachable intake service, but sign-in should not be required.'
      : 'The packet is saved locally. Sending to an action service needs a connection.';
  }

  return anonymousSignalSharing.enabled
    ? 'The local record can be saved offline, but the minimized signal is not queued or silently retried. Sharing requires an authenticated online request.'
    : 'Works offline because this consent step saves the map record locally.';
}

function getReversibility(pathway: PathwayType, anonymousSignalSharing: AnonymousSignalSharingState): string {
  if (pathway === 'save-private') {
    return 'You can reopen or delete the local draft later. This action does not create a remote case.';
  }

  if (pathway === 'anonymous-map') {
    return anonymousSignalSharing.enabled
      ? 'You can delete the local record and withdraw aggregate consent to stop future sharing. A signal already included in a privacy-protected aggregate cannot be singled out or recalled.'
      : 'You can review the saved local map record from Cases. This release does not publish a live public map from this step.';
  }

  return 'You can review the saved local pathway details from Cases. Calls, messages, or future online sends are separate actions.';
}

function getRetentionNotice(pathway: PathwayType, anonymousSignalSharing: AnonymousSignalSharingState): string {
  if (pathway === 'save-private') {
    return 'The report remains local to this app storage unless you later export, share, or choose another pathway. Local deletion is handled from Cases or Privacy & Data controls.';
  }

  if (pathway === 'anonymous-map') {
    return anonymousSignalSharing.enabled
      ? 'The local record follows local deletion controls. The minimized server signal follows the approved raw-signal retention period; released aggregate cells contain no account ID, narrative, evidence, or exact coordinates.'
      : 'SafeRide keeps the local map record with this draft. This release does not publish or update a live public map from this step.';
  }

  return 'SafeRide keeps the local pathway record with this draft. Local deletion removes the in-app copy, but it cannot undo calls, SMS, WhatsApp, or external sharing you start separately.';
}

function shouldIncludeEvidenceUpload(pathway: PathwayType, includeBrief: boolean): boolean {
  return false;
}

function getAnonymousMapLocationBehavior(
  locationSummary: { precision: string },
  anonymousSignalSharing: AnonymousSignalSharingState,
): string {
  if (anonymousSignalSharing.enabled) {
    return 'Exact coordinates are transformed on this device into an approved coarse-cell ID. Coordinates and saved location text are not sent.';
  }
  if (locationSummary.precision.startsWith('Saved coordinates')) {
    return 'Saved coordinates stay exactly as saved in the local map record; no live route-safety map is published in this release.';
  }

  return `${locationSummary.precision} Saved location text stays exactly as saved in the local map record; no live route-safety map is published in this release.`;
}

function buildBaseEditActions(pathway: PathwayType, includeBrief: boolean, hasEvidence: boolean): ConsentEditAction[] {
  // Pathway is chosen inline on the review page, so no "change
  // pathway" edit action is emitted here.
  const actions: ConsentEditAction[] = [
    { id: 'incident', label: 'Edit incident details', route: 'WhatHappened' },
    { id: 'location-time', label: 'Edit time or location', route: 'WhereWhen' },
  ];

  const evidenceCanAffectSubmission =
    pathway === 'save-private' ||
    pathway === 'escalate';

  if (hasEvidence && evidenceCanAffectSubmission) {
    actions.push({ id: 'evidence', label: 'Edit evidence and privacy requests', route: 'EvidenceDetail' });
  }
  if (pathway === 'referral') {
    actions.push({ id: 'provider', label: 'Change provider or channel', route: 'ReferralPicker' });
  }
  if (pathway === 'escalate') {
    actions.push({ id: 'escalation', label: 'Change escalation details', route: 'EscalationForm' });
  }

  return actions;
}

export function buildConsentSummary({
  draft,
  pathway,
  isOnline,
  catalogProvider,
  anonymousSignalSharing = { enabled: false, consentVersion: null },
}: {
  draft: DraftData | null;
  pathway: PathwayType;
  isOnline: boolean;
  catalogProvider?: Provider;
  anonymousSignalSharing?: AnonymousSignalSharingState;
}): ConsentSummaryModel {
  const labels = getPathwayLabels(pathway, anonymousSignalSharing);

  if (!draft) {
    return {
      title: labels.title,
      subtitle: 'SafeRide could not find this local draft on this phone.',
      checklistTitle: 'Review needs local details',
      primaryButtonLabel: labels.primary,
      consentStatement: 'I understand the report details must be saved locally before continuing.',
      keyPoints: [],
      checklistItems: [],
      editActions: [{ id: 'pathway', label: 'Review draft choice', route: 'ConsentGate' }],
      retentionNoticeTitle: 'Local details needed',
      retentionNotice: 'Nothing leaves this phone from this screen. Reopen the report editor so SafeRide can save the local draft before review.',
      validation: getConsentValidation(pathway, { draft }),
    };
  }

  const includeBrief = pathway === 'referral' ? shouldIncludeReferralBrief(draft) : true;
  const uploadIncluded = shouldIncludeEvidenceUpload(pathway, includeBrief);
  const whenSummary = buildWhenSummary(draft);
  const locationSummary = buildLocationSummary(draft);
  const incidentSummary = buildIncidentSummary(draft);
  const statementPreview = buildStatementPreview(draft);
  const patternLabels = mapPatternsToLabels(draft.patterns);
  const redactionChips = buildRedactionChips(draft, pathway);
  const escalationPacket = pathway === 'escalate' ? buildEscalationPacket(draft) : undefined;
  const escalationEvidence = escalationPacket ? summarizeEscalationEvidence(escalationPacket) : undefined;
  const attachmentSummary = summarizeAttachments(draft.mediaFiles, draft.privacySettings, {
    uploadIncluded,
    localOnly: pathway === 'save-private',
  });

  const tagSet = new Set<string>();
  (draft.acceptedSuggestions ?? []).forEach(tag => tagSet.add(formatTagLabel(tag)));
  (draft.selectedTags ?? []).forEach(tag => tagSet.add(formatTagLabel(tag)));
  (draft.customTags ?? []).forEach(tag => tagSet.add(formatTagLabel(tag)));
  const tagLabels = Array.from(tagSet);

  const referralSelection = draft.referralSelection;
  const selectedChannel = referralSelection?.selectedChannel ?? draft.selectedChannel;
  const providerName = referralSelection?.providerName ?? catalogProvider?.name;
  const providerDetails = referralSelection
    ? buildProviderConsentDetails(referralSelection, catalogProvider)
    : buildFallbackProviderDetails({ draft, catalogProvider, includeBrief });
  const contactMethod = selectedChannel ? CHANNEL_LABELS[selectedChannel] : undefined;
  const hasContactChannel = Boolean(contactMethod);
  const escalationExtras = escalationPacket?.content.transportIdentifiers ?? [];

  const dataCategories = getDataCategories(pathway, draft, includeBrief, anonymousSignalSharing, hasContactChannel);
  const recipient = getRecipient(pathway, anonymousSignalSharing, providerName, hasContactChannel);
  const outcome = getOutcome(pathway, isOnline, anonymousSignalSharing, hasContactChannel);
  const offlineBehavior = getOfflineBehavior(pathway, isOnline, anonymousSignalSharing, hasContactChannel);
  const reversibility = getReversibility(pathway, anonymousSignalSharing);
  const locationBehavior =
    pathway === 'referral' && !includeBrief
      ? 'Location is not included in this saved referral choice.'
      : pathway === 'referral'
        ? 'Only the general saved location type can be included in the support brief. Address, description, and coordinates remain local.'
      : pathway === 'anonymous-map'
        ? getAnonymousMapLocationBehavior(locationSummary, anonymousSignalSharing)
        : escalationPacket
          ? `Packet location preview: ${escalationPacket.content.location}`
          : locationSummary.precision;
  let validation = getConsentValidation(pathway, {
    draft,
    provider: providerName,
    selectedChannel,
  });
  if (validation.valid && pathway === 'anonymous-map' && anonymousSignalSharing.enabled && !isOnline) {
    validation = {
      valid: false,
      code: 'anonymous-map-online-required',
      message: 'Go online before sharing a minimized map signal. SafeRide will not queue or silently retry it.',
      actionLabel: 'Review connection',
      actionRoute: 'ConsentGate',
    };
  }

  const checklistItems = buildChecklistItems({
    pathway,
    includeBrief,
    whenSummary,
    locationSummary,
    incidentSummary,
    statementPreview,
    tagLabels,
    patternLabels,
    providerName,
    providerDetails,
    contactMethod,
    fallbackNumber: draft.fallbackNumber,
    escalationPacket,
    escalationEvidence,
    escalationExtras,
    attachmentSummary,
    anonymousSignalSharing,
  });

  const keyPoints: ConsentKeyPoint[] = [
    { icon: 'git-branch', label: 'Pathway', value: labels.label },
    { icon: 'business', label: 'Recipient', value: recipient },
    { icon: 'list', label: 'Data categories', value: dataCategories.join(', ') },
    {
      icon: 'location',
      label: 'Location behavior',
      value: locationBehavior,
    },
    {
      icon: 'cloud-upload',
      label: 'Evidence behavior',
      value: draft.mediaFiles?.length
        ? uploadIncluded ? 'Evidence can upload only after consent and successful sync.' : 'Evidence upload is not included from this consent step.'
        : 'No evidence files are saved in this draft.',
      details: attachmentSummary.details,
    },
    { icon: 'swap-horizontal', label: 'Outcome', value: outcome },
    { icon: 'cloud-offline', label: 'Offline behavior', value: offlineBehavior },
    { icon: 'refresh', label: 'Reversibility and limits', value: reversibility },
  ];

  const redactionAction = redactionChips.length
    ? pathway === 'escalate'
      ? { id: 'redaction', label: 'Change escalation redaction', route: 'EscalationForm' as const }
      : pathway === 'referral'
        ? undefined
        : { id: 'evidence-privacy', label: 'Change evidence privacy requests', route: 'EvidenceDetail' as const }
    : undefined;

  return {
    title: labels.title,
    subtitle: pathway === 'save-private'
      ? ''
      : 'Review what is saved before confirming',
    checklistTitle: pathway === 'save-private' ? 'What stays on this device' : 'What this saves',
    primaryButtonLabel: labels.primary,
    consentStatement: pathway === 'save-private'
      ? 'I understand this saves the report privately on this device and does not send it now.'
      : pathway === 'anonymous-map' && anonymousSignalSharing.enabled
        ? `I consent to share only the listed minimized fields under aggregate consent ${anonymousSignalSharing.consentVersion}; narrative, evidence, exact coordinates, contact details, and account ID are excluded from the aggregate dataset.`
      : 'I understand this saves the selected pathway locally. Calls, messages, or future online sends are separate actions.',
    keyPoints,
    checklistItems,
    editActions: buildBaseEditActions(pathway, includeBrief, Boolean(draft.mediaFiles?.length)),
    redactionChips: redactionChips.length ? redactionChips : undefined,
    redactionAction,
    retentionNoticeTitle: pathway === 'save-private' ? 'Local-only storage' : 'Retention and limits',
    retentionNotice: getRetentionNotice(pathway, anonymousSignalSharing),
    offlineBadge: !isOnline
      ? pathway === 'save-private'
        ? 'Saved locally while offline'
        : pathway === 'anonymous-map' && anonymousSignalSharing.enabled
          ? 'Signal not shared while offline'
        : pathway === 'escalate'
          ? 'Saved locally; sending needs online'
          : 'Saved locally while offline'
      : undefined,
    validation,
  };
}

function buildFallbackProviderDetails({
  draft,
  catalogProvider,
  includeBrief,
}: {
  draft: DraftData;
  catalogProvider?: Provider;
  includeBrief: boolean;
}): string[] {
  const details: string[] = [];
  const selectedChannel = draft.selectedChannel;
  if (selectedChannel) {
    details.push(`Channel: ${CHANNEL_LABELS[selectedChannel]}`);
  }
  details.push(includeBrief ? 'Support brief requested' : 'No support brief requested');

  if (catalogProvider?.phone) {
    details.push(`Phone: ${catalogProvider.phone}`);
  }
  if (catalogProvider?.services.length) {
    details.push(`Scope: ${catalogProvider.services.join(', ')}`);
  }
  if (catalogProvider?.address) {
    details.push(`Coverage: ${catalogProvider.address}`);
  }
  if (catalogProvider?.hours) {
    details.push(`Availability: ${catalogProvider.hours}`);
  }
  if (catalogProvider?.metadata?.reviewStatus) {
    details.push(`Catalog note: ${catalogProvider.metadata.reviewStatus}`);
  }
  if (!catalogProvider && draft.selectedProvider) {
    details.push('Provider details unavailable from the local catalog.');
  }

  return details;
}

function buildChecklistItems({
  pathway,
  includeBrief,
  whenSummary,
  locationSummary,
  incidentSummary,
  statementPreview,
  tagLabels,
  patternLabels,
  providerName,
  providerDetails,
  contactMethod,
  fallbackNumber,
  escalationPacket,
  escalationEvidence,
  escalationExtras,
  attachmentSummary,
  anonymousSignalSharing,
}: {
  pathway: PathwayType;
  includeBrief: boolean;
  whenSummary: { value?: string; details: string[] };
  locationSummary: { value?: string; details: string[] };
  incidentSummary: { summary?: string; details: string[] };
  statementPreview: { summary?: string; details: string[] };
  tagLabels: string[];
  patternLabels: string[];
  providerName?: string;
  providerDetails: string[];
  contactMethod?: string;
  fallbackNumber?: string;
  escalationPacket?: EscalationPacket;
  escalationEvidence?: { summary: string; details: string[] };
  escalationExtras: string[];
  attachmentSummary: { summary?: string; details: string[] };
  anonymousSignalSharing: AnonymousSignalSharingState;
}): ConsentChecklistItem[] {
  const whenItem = withDetails({ icon: 'time', label: 'When', value: whenSummary.value || 'Not specified' }, whenSummary.details);
  const whereItem = withDetails({ icon: 'location', label: 'Where', value: locationSummary.value || 'Not specified' }, locationSummary.details);
  const incidentItem = withDetails({ icon: 'document-text', label: 'What happened', value: incidentSummary.summary || 'Not included' }, incidentSummary.details);
  const attachmentsItem = withDetails({ icon: 'camera', label: 'Evidence', value: attachmentSummary.summary || 'None' }, attachmentSummary.details);
  const escalationWhenItem = escalationPacket
    ? { icon: 'time', label: 'When', value: escalationPacket.content.timeRange || 'Not specified' }
    : whenItem;
  const escalationWhereItem = escalationPacket
    ? { icon: 'location', label: 'Where', value: escalationPacket.content.location || 'Not specified' }
    : whereItem;
  const escalationIncidentItem = escalationPacket
    ? withDetails(
        { icon: 'document-text', label: 'What happened', value: truncate(escalationPacket.content.incidentDescription, 140) },
        [escalationPacket.content.incidentDescription],
      )
    : incidentItem;
  const escalationStatementItem = escalationPacket
    ? withDetails(
        { icon: 'mic', label: 'Statement', value: truncate(escalationPacket.content.statement, 160) },
        [escalationPacket.content.statement],
      )
    : withDetails({ icon: 'mic', label: 'Statement', value: statementPreview.summary || 'Not included' }, statementPreview.details);

  if (pathway === 'save-private') {
    return [
      whenItem,
      whereItem,
      incidentItem,
      withDetails({ icon: 'pricetag', label: 'Tags selected', value: tagLabels.length ? tagLabels.join(', ') : 'Not tagged' }, patternLabels),
      attachmentsItem,
    ];
  }

  if (pathway === 'anonymous-map') {
    const categoryLabels = Array.from(new Set([...tagLabels, ...patternLabels]));
    return [
      whenItem,
      whereItem,
      withDetails(
        { icon: 'pricetag', label: 'Incident category', value: categoryLabels.length ? categoryLabels.join(', ') : 'Not selected' },
        patternLabels,
      ),
      withDetails(
        {
          icon: 'shield-checkmark',
          label: 'Sharing limits',
          value: 'Evidence files, statement text, and incident narrative are not sent for this pathway.',
        },
        [
          ...(anonymousSignalSharing.enabled
            ? [
                'Only an approved coarse-cell ID, fixed time bucket, controlled category, and consent/policy versions are sent.',
                'Narrative, evidence, saved location text, exact coordinates, contact details, draft ID, case ID, and account ID are excluded.',
                'Below-threshold operator output displays No data; this does not promise that a public dashboard is active.',
              ]
            : [
                'The record is saved locally with this draft. No signed-in case-service upload runs from this step.',
                'Saved location text/coordinates and category tags remain exactly as saved in the local record.',
                'This release does not publish a live route-safety map.',
              ]),
        ],
      ),
    ];
  }

  if (pathway === 'referral') {
    const providerItem = withDetails({ icon: 'business', label: 'Provider', value: providerName || 'Not selected' }, providerDetails);
    const contactItem = withDetails(
      {
        icon: 'chatbubble',
        label: 'Contact channel',
        value: contactMethod || 'Unavailable while provider review is pending',
      },
      fallbackNumber ? [`Saved fallback contact: ${fallbackNumber}`] : undefined,
    );

    if (!includeBrief) {
      return [
        providerItem,
        contactItem,
        withDetails(
          { icon: 'document-text', label: 'Support brief', value: 'Not included by preference' },
          ['Incident details, time/location, tags, statement text, and evidence files are not included in this saved referral choice.'],
        ),
      ];
    }

    return [
      providerItem,
      contactItem,
      withDetails(
        { icon: 'document-text', label: 'Support brief', value: 'Minimized fields selected' },
        [
          'Selected incident categories only',
          'Incident date and accuracy only; clock time is excluded',
          'General location type only; address, description, and coordinates are excluded',
          'Ongoing status when saved',
          'Narrative, statement text, evidence, contact details, and the full provider record are excluded',
        ],
      ),
    ];
  }

  return [
    {
      icon: 'person',
      label: 'Your identity',
      value: escalationPacket?.contact.label || 'Anonymous',
    },
    {
      icon: 'shield',
      label: 'Redaction level',
      value: escalationPacket?.redactionLevel ? formatTagLabel(escalationPacket.redactionLevel) : 'Light',
    },
    escalationWhenItem,
    escalationWhereItem,
    withDetails(
      { icon: 'pricetag', label: 'Offence tags', value: tagLabels.length ? tagLabels.join(', ') : 'Not tagged' },
      escalationPacket?.content.patterns.length ? escalationPacket.content.patterns : patternLabels,
    ),
    escalationIncidentItem,
    escalationStatementItem,
    withDetails({ icon: 'car', label: 'Transport details', value: escalationExtras.length ? 'Included' : 'None' }, escalationExtras),
    withDetails({ icon: 'camera', label: 'Evidence', value: escalationEvidence?.summary || attachmentSummary.summary || 'None' }, escalationEvidence?.details ?? attachmentSummary.details),
  ];
}
