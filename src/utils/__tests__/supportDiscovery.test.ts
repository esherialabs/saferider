import { describe, expect, it } from 'vitest';

import type { TipCard } from '../../lib/catalog';
import {
  buildCatalogRefreshSummary,
  buildCatalogStatusLine,
  buildReferralCaseSupportDetails,
  getReportSupportTips,
} from '../supportDiscovery';

const tips: TipCard[] = [
  {
    id: 'rights',
    title: 'Know your rights',
    body: 'You can request privacy and informed consent.',
    updated: '2026-06-05',
    category: 'Rights',
    tags: ['rights', 'consent'],
  },
  {
    id: 'pep',
    title: 'PEP and medical care',
    body: 'Ask a clinician about PEP within the time window.',
    updated: '2026-06-05',
    category: 'Medical care',
    tags: ['medical', 'PEP', 'time-sensitive'],
  },
  {
    id: 'hotline',
    title: 'Hotline: 1195',
    body: 'Call the Kenya GBV helpline for support and referrals.',
    updated: '2026-06-05',
    category: 'Emergency contacts',
    tags: ['hotline', 'support', 'referral'],
  },
  {
    id: 'documentation',
    title: 'Documentation checklist',
    body: 'Keep forms, evidence notes, and OB number together.',
    updated: '2026-06-05',
    category: 'Safety & evidence',
    tags: ['documentation', 'evidence'],
  },
];

describe('support discovery helpers', () => {
  it('uses truthful catalog status language for remote, cache, seed, and empty states', () => {
    expect(buildCatalogStatusLine({
      label: 'Providers',
      source: 'remote',
      lastUpdated: '2026-06-05T10:00:00.000Z',
      itemCount: 4,
    })).toContain('refreshed');

    expect(buildCatalogStatusLine({
      label: 'Tips',
      source: 'cache',
      lastUpdated: '2026-06-05T10:00:00.000Z',
      itemCount: 20,
    })).toContain('showing saved entries');

    expect(buildCatalogStatusLine({
      label: 'Rights tags',
      source: 'seed',
      lastUpdated: null,
      itemCount: 15,
      error: new Error('offline'),
    })).toBe('Rights tags: update failed; bundled entries are shown.');

    expect(buildCatalogStatusLine({
      label: 'Providers',
      source: 'seed',
      lastUpdated: null,
      itemCount: 0,
      error: new Error('missing'),
    })).toContain('unavailable');
  });

  it('summarizes mixed catalog refresh results without claiming every catalog refreshed', () => {
    const summary = buildCatalogRefreshSummary([
      { label: 'Providers', source: 'remote', lastUpdated: '2026-06-05T10:00:00.000Z', itemCount: 4 },
      { label: 'Tips', source: 'cache', lastUpdated: '2026-06-04T10:00:00.000Z', itemCount: 20 },
      { label: 'Rights tags', source: 'seed', lastUpdated: null, itemCount: 15, error: new Error('offline') },
    ]);

    expect(summary.title).toBe('Saved catalogs shown');
    expect(summary.variant).toBe('warning');
    expect(summary.message).toContain('Providers: refreshed');
    expect(summary.message).toContain('Tips: showing saved entries');
    expect(summary.message).toContain('Rights tags: update failed');
  });

  it('selects contextual report tips from the existing tips catalog', () => {
    const selected = getReportSupportTips(tips, {
      patterns: ['sexual_harassment'],
      severity: 'high',
      immediateHelp: true,
    });

    expect(selected.map(tip => tip.id)).toEqual(['hotline', 'pep', 'documentation']);
  });

  it('summarizes referral context without implying provider receipt', () => {
    const details = buildReferralCaseSupportDetails({
      providerId: '1195',
      providerName: 'National GBV Toll-Free Helpline',
      providerType: 'Hotline',
      selectedChannel: 'call',
      includeBrief: false,
      phone: '1195',
      serviceScope: ['GBV support', 'Referral services'],
      availability: '24/7',
      reviewStatus: 'Source-linked national helpline',
      catalogSource: 'seed',
      catalogLastUpdated: null,
      selectedAt: '2026-06-05T10:00:00.000Z',
    });

    expect(details).toContain('Support brief: not included by preference');
    expect(details).toContain('Catalog: bundled listing');
    expect(details.at(-1)).toBe('Provider receipt is not confirmed from this case view.');
    expect(details.join(' ')).not.toMatch(/verified|accepted|received/i);
  });
});
