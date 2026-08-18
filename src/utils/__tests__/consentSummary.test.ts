import { describe, expect, it } from 'vitest';

import type { Provider } from '../../lib/catalog';
import type { DraftData } from '../draftStorage';
import { buildConsentSummary } from '../consentSummary';

const provider: Provider = {
  id: '1195',
  name: 'National GBV Toll-Free Helpline (HAK 1195)',
  type: 'Hotline',
  languages: ['English', 'Swahili'],
  services: ['GBV support', 'Referral services'],
  channels: { call: true, whatsapp: false, sms: true },
  phone: '1195',
  hours: '24/7',
  metadata: { reviewStatus: 'Listed support provider' },
};

function buildDraft(overrides: Partial<DraftData> = {}): DraftData {
  return {
    id: 'draft-1',
    createdAt: new Date('2026-06-05T09:00:00.000Z'),
    updatedAt: new Date('2026-06-05T09:15:00.000Z'),
    incidentDescription: 'Unsafe conduct on a bus route.',
    patterns: ['verbal_harassment'],
    selectedTags: ['harassment'],
    location: {
      description: 'Near the stage',
      address: 'Nairobi CBD',
      type: 'public_transport',
      coordinates: { latitude: -1.286389, longitude: 36.817223 },
    },
    datetime: {
      date: '2026-06-05',
      time: '09:00',
      accuracy: 'approximate',
    },
    mediaFiles: [
      {
        id: 'photo-1',
        type: 'photo',
        uri: 'file:///photo.jpg',
        fileName: 'photo.jpg',
        size: 1024,
        timestamp: new Date('2026-06-05T09:05:00.000Z'),
      },
    ],
    privacySettings: {
      blurFaces: true,
      removeMetadata: true,
      encryptFiles: true,
    },
    ...overrides,
  };
}

function keyValue(summary: ReturnType<typeof buildConsentSummary>, label: string): string {
  const item = summary.keyPoints.find(point => point.label === label);
  if (!item) throw new Error(`Missing key point ${label}`);
  return item.value;
}

describe('consent summary model', () => {
  it('summarizes save-private as local-only with evidence excluded from upload', () => {
    const summary = buildConsentSummary({
      draft: buildDraft({ selectedPathway: 'save-private' }),
      pathway: 'save-private',
      isOnline: false,
    });

    expect(summary.validation).toEqual({ valid: true });
    expect(summary.checklistTitle).toBe('What stays on this device');
    expect(summary.primaryButtonLabel).toBe('Save privately');
    expect(keyValue(summary, 'Recipient')).toBe('No recipient - saved on this device only.');
    expect(keyValue(summary, 'Outcome')).toContain('does not submit or queue');
    expect(keyValue(summary, 'Evidence behavior')).toContain('not included');
    expect(summary.consentStatement).toContain('does not send it now');
  });

  it('summarizes referral without a support brief as provider and channel only', () => {
    const draft = buildDraft({
      includeBrief: false,
      referralSelection: {
        providerId: provider.id,
        providerName: provider.name,
        providerType: provider.type,
        selectedChannel: 'call',
        includeBrief: false,
        phone: provider.phone,
        serviceScope: provider.services,
        availability: provider.hours,
        catalogSource: 'seed',
        catalogLastUpdated: null,
        selectedAt: '2026-06-05T09:10:00.000Z',
      },
    });

    const summary = buildConsentSummary({
      draft,
      pathway: 'referral',
      isOnline: true,
      catalogProvider: provider,
    });

    expect(summary.validation).toEqual({ valid: true });
    expect(keyValue(summary, 'Recipient')).toContain(provider.name);
    expect(keyValue(summary, 'Data categories')).toBe('Provider ID, contact channel, brief preference');
    expect(keyValue(summary, 'Location behavior')).toBe('Location is not included in this saved referral choice.');
    expect(keyValue(summary, 'Evidence behavior')).toContain('not included');
    expect(summary.checklistItems.map(item => item.label)).toEqual(['Provider', 'Contact channel', 'Support brief']);
    expect(summary.checklistItems[2].details?.[0]).toContain('Incident details');
  });

  it('summarizes a pending provider without implying that a contact channel is available', () => {
    const draft = buildDraft({
      includeBrief: false,
      referralSelection: {
        providerId: 'legal-1',
        providerName: 'FIDA Kenya',
        providerType: 'Legal aid',
        contactStatus: 'pending',
        includeBrief: false,
        serviceScope: ['Legal aid'],
        reviewStatus: 'Contact details pending manual verification',
        selectedAt: '2026-08-15T00:00:00.000Z',
      },
    });

    const summary = buildConsentSummary({
      draft,
      pathway: 'referral',
      isOnline: true,
    });

    expect(summary.validation).toEqual({ valid: true });
    expect(keyValue(summary, 'Recipient')).toContain('contact actions remain unavailable');
    expect(keyValue(summary, 'Data categories')).toBe('Provider ID, provider review status, brief preference');
    expect(summary.checklistItems.find(item => item.label === 'Contact channel')?.value)
      .toBe('Unavailable while provider review is pending');
  });

  it('summarizes anonymous map as a minimized local record with no evidence upload', () => {
    const summary = buildConsentSummary({
      draft: buildDraft(),
      pathway: 'anonymous-map',
      isOnline: false,
    });

    expect(summary.validation).toEqual({ valid: true });
    expect(keyValue(summary, 'Recipient')).toContain('Local SafeRide map record');
    expect(keyValue(summary, 'Data categories')).toBe(
      'local map update record, saved draft ID, saved location object, time/duration/ongoing fields if provided, raw category/tag values, draft timestamps',
    );
    expect(keyValue(summary, 'Location behavior')).toContain('stay exactly as saved');
    expect(keyValue(summary, 'Evidence behavior')).toContain('not included');
    expect(keyValue(summary, 'Outcome')).toContain('Saves a local map record');
    expect(summary.checklistItems.map(item => item.label)).toEqual(['When', 'Where', 'Incident category', 'Sharing limits']);
    const sharingLimits = summary.checklistItems.find(item => item.label === 'Sharing limits');
    expect(sharingLimits?.value).toContain('Evidence files, statement text, and incident narrative are not sent');
    expect(sharingLimits?.details).toContain('The record is saved locally with this draft. No signed-in case-service upload runs from this step.');
    expect(summary.redactionChips).toBeUndefined();
    expect(summary.editActions.map(action => action.route)).not.toContain('EvidenceDetail');
  });

  it('shows exact minimized fields and fail-closed offline behavior only after RSI activation', () => {
    const online = buildConsentSummary({
      draft: buildDraft(), pathway: 'anonymous-map', isOnline: true,
      anonymousSignalSharing: { enabled: true, consentVersion: 'synthetic-consent-v1' },
    });
    expect(online.primaryButtonLabel).toBe('Share minimized map signal');
    expect(keyValue(online, 'Data categories')).toBe(
      'approved coarse-cell ID, fixed time bucket, controlled category, consent and policy version',
    );
    expect(keyValue(online, 'Location behavior')).toContain('transformed on this device');
    expect(online.consentStatement).toContain('synthetic-consent-v1');
    expect(JSON.stringify(online)).toContain('exact coordinates');

    const offline = buildConsentSummary({
      draft: buildDraft(), pathway: 'anonymous-map', isOnline: false,
      anonymousSignalSharing: { enabled: true, consentVersion: 'synthetic-consent-v1' },
    });
    expect(offline.validation).toMatchObject({ valid: false, code: 'anonymous-map-online-required' });
    expect(offline.offlineBadge).toBe('Signal not shared while offline');
  });

  it('summarizes escalation packet redaction, contact preference, and local offline save', () => {
    const summary = buildConsentSummary({
      draft: buildDraft({
        textEvidence: 'Mary Jones shared +254712345678 and vehicle KDD 123A.',
        escalationData: {
          redactionLevel: 'heavy',
          vehiclePlate: 'KDD 123A',
          saccoOperator: 'Super Metro',
          contactPreference: 'alias',
          alias: 'MJ',
        },
      }),
      pathway: 'escalate',
      isOnline: false,
    });

    expect(summary.validation).toEqual({ valid: true });
    expect(keyValue(summary, 'Recipient')).toBe('Local escalation packet. Online intake must be available before it can be sent.');
    expect(keyValue(summary, 'Offline behavior')).toContain('saved locally');
    expect(summary.offlineBadge).toContain('Saved locally');
    expect(summary.redactionChips).toContain('Packet text redacted for names, contact values, plates, and exact location');
    expect(summary.checklistItems.find(item => item.label === 'Redaction level')?.value).toBe('Heavy');
    expect(summary.checklistItems.find(item => item.label === 'Your identity')?.value).toBe('Alias: MJ');
    expect(summary.checklistItems.find(item => item.label === 'Where')?.value).toContain('exact details redacted');
    expect(summary.checklistItems.find(item => item.label === 'Statement')?.value).not.toContain('Mary Jones');
    expect(summary.checklistItems.find(item => item.label === 'Statement')?.value).not.toContain('+254712345678');
  });
});
