import { describe, expect, it } from 'vitest';

import type { Provider } from '../../lib/catalog';
import {
  buildProviderCatalogStatus,
  buildProviderConsentDetails,
  buildReferralContactUrl,
  buildReferralDraftUpdate,
  filterReferralProviders,
  getAvailableReferralChannels,
  shouldIncludeDraftBriefDetails,
  shouldIncludeReferralBrief,
} from '../referralSupport';

const providers: Provider[] = [
  {
    id: '1195',
    name: 'National GBV Toll-Free Helpline (HAK 1195)',
    type: 'Hotline',
    distance: '—',
    hours: '24/7',
    isOpen: true,
    languages: ['EN', 'SW'],
    services: ['GBV support', 'Referral services'],
    channels: { call: true, whatsapp: false, sms: false },
    phone: '1195',
    contactStatus: 'verified',
    safetyPhrase: 'Ask for GBV support',
    metadata: {
      reviewStatus: 'Source-linked national helpline',
      sources: [{ title: 'HAK 1195', url: 'https://example.test/1195' }],
    },
  },
  {
    id: 'legal-1',
    name: 'FIDA Kenya',
    type: 'Legal aid',
    distance: '—',
    hours: 'Contact provider to confirm availability',
    isOpen: false,
    languages: ['EN'],
    services: ['Legal aid', 'Rights information'],
    channels: { call: false, whatsapp: false, sms: false },
    contactStatus: 'pending',
    address: 'Nairobi',
    metadata: {
      reviewStatus: 'Contact details pending manual verification',
    },
  },
];

describe('referral support helpers', () => {
  it('filters providers by search text and category without inventing matches', () => {
    expect(filterReferralProviders(providers, '1195', [])).toHaveLength(1);
    expect(filterReferralProviders(providers, 'counselling', [])).toEqual([]);
    expect(filterReferralProviders(providers, '', [{ id: 'legal', active: true }])).toEqual([providers[1]]);
    expect(filterReferralProviders(providers, '', [{ id: 'open', active: true }])).toEqual([providers[0]]);
  });

  it('returns only catalog-supported contact channels', () => {
    expect(getAvailableReferralChannels(providers[0])).toEqual(['call']);
    expect(getAvailableReferralChannels(providers[1])).toEqual([]);
  });

  it('builds content-free external contact URLs and rejects unsafe phone input', () => {
    expect(buildReferralContactUrl('call', '+254 700 000 000')).toBe('tel:+254700000000');
    expect(buildReferralContactUrl('sms', '+254 700 000 000')).toBe('sms:+254700000000');
    expect(buildReferralContactUrl('whatsapp', '+254 700 000 000')).toBe('https://wa.me/254700000000');
    expect(buildReferralContactUrl('whatsapp', '1195')).toBeNull();
    expect(buildReferralContactUrl('call', 'not-a-number')).toBeNull();
  });

  it('builds a draft update that preserves the referral provider/channel/brief contract', () => {
    const update = buildReferralDraftUpdate({
      draftId: 'draft-1',
      provider: providers[0],
      selectedChannel: 'call',
      includeBrief: false,
      catalogSource: 'cache',
      catalogLastUpdated: '2026-06-05T09:00:00.000Z',
      selectedAt: '2026-06-05T10:00:00.000Z',
    });

    expect(update).toMatchObject({
      id: 'draft-1',
      selectedPathway: 'referral',
      selectedProvider: '1195',
      selectedChannel: 'call',
      includeBrief: false,
      currentStep: 'ConsentGate',
      referralSelection: {
        providerId: '1195',
        providerName: 'National GBV Toll-Free Helpline (HAK 1195)',
        selectedChannel: 'call',
        includeBrief: false,
        phone: '1195',
        serviceScope: ['GBV support', 'Referral services'],
        availability: '24/7',
        catalogSource: 'cache',
      },
    });
    expect(update.completedSteps).toContain('ReferralPicker');
  });

  it('uses honest catalog status language for cache, seed, offline, and empty states', () => {
    expect(buildProviderCatalogStatus({
      isOnline: false,
      source: 'cache',
      lastUpdated: '2026-06-05T09:00:00.000Z',
      providerCount: 2,
    })).toContain('Showing saved provider listings');

    expect(buildProviderCatalogStatus({
      isOnline: false,
      source: 'seed',
      lastUpdated: null,
      providerCount: 2,
    })).toContain('bundled provider listings');

    expect(buildProviderCatalogStatus({
      isOnline: false,
      source: 'seed',
      lastUpdated: null,
      providerCount: 0,
    })).toBe('Provider list is unavailable offline. Saved contacts may still appear.');

    expect(buildProviderCatalogStatus({
      isOnline: true,
      source: 'seed',
      lastUpdated: '2026-07-30T00:00:00.000Z',
      providerCount: 4,
      providerPack: {
        version: '1.0.0-candidate.1', integrity: 'verified', freshness: 'current',
        trust: 'pending', expiresAt: '2026-08-30T00:00:00.000Z', rollbackUsed: false,
      },
    })).toContain('await accountable provider review');

    expect(buildProviderCatalogStatus({
      isOnline: true,
      source: 'rollback',
      lastUpdated: '2026-07-30T00:00:00.000Z',
      providerCount: 4,
      providerPack: {
        version: '1.0.0', integrity: 'verified', freshness: 'current',
        trust: 'approved', expiresAt: '2026-08-30T00:00:00.000Z', rollbackUsed: true,
      },
    })).toContain('previous verified pack');
  });

  it('summarizes selected provider details for consent review', () => {
    const update = buildReferralDraftUpdate({
      draftId: 'draft-1',
      provider: providers[0],
      selectedChannel: 'call',
      includeBrief: true,
      catalogSource: 'seed',
      catalogLastUpdated: null,
      selectedAt: '2026-06-05T10:00:00.000Z',
    });

    expect(buildProviderConsentDetails(update.referralSelection!)).toEqual([
      'Channel: Phone call',
      'Support brief requested',
      'Phone: 1195',
      'Scope: GBV support, Referral services',
      'Availability: 24/7',
      'Catalog note: Source-linked national helpline',
      'Catalog: bundled listing',
    ]);
  });

  it('saves a pending provider for review without inventing a contact channel', () => {
    const update = buildReferralDraftUpdate({
      draftId: 'draft-2',
      provider: providers[1],
      selectedChannel: null,
      includeBrief: false,
      catalogSource: 'seed',
      catalogLastUpdated: null,
      selectedAt: '2026-08-15T00:00:00.000Z',
    });

    expect(update).toMatchObject({
      id: 'draft-2',
      selectedProvider: 'legal-1',
      selectedChannel: undefined,
      referralSelection: {
        providerId: 'legal-1',
        providerName: 'FIDA Kenya',
        contactStatus: 'pending',
        includeBrief: false,
      },
    });
    expect(buildProviderConsentDetails(update.referralSelection!)).toContain(
      'Contact action: unavailable until this listing is reviewed',
    );
  });

  it('resolves referral brief inclusion from the saved referral snapshot first', () => {
    expect(shouldIncludeReferralBrief({ includeBrief: true })).toBe(true);
    expect(shouldIncludeReferralBrief({ includeBrief: false })).toBe(false);
    expect(shouldIncludeReferralBrief({
      includeBrief: true,
      referralSelection: {
        providerId: '1195',
        providerName: 'National GBV Toll-Free Helpline (HAK 1195)',
        providerType: 'Hotline',
        selectedChannel: 'call',
        includeBrief: false,
        serviceScope: ['GBV support'],
        selectedAt: '2026-06-05T10:00:00.000Z',
      },
    })).toBe(false);
  });

  it('omits draft details for anonymous-map and referral submissions that opt out', () => {
    expect(shouldIncludeDraftBriefDetails('referral', { includeBrief: false })).toBe(false);
    expect(shouldIncludeDraftBriefDetails('referral', { includeBrief: true })).toBe(true);
    expect(shouldIncludeDraftBriefDetails('anonymous-map', { includeBrief: false })).toBe(false);
  });
});
