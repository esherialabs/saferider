import type { CatalogLoadSource, TipCard } from '../lib/catalog';
import type { ReferralSelectionData } from './draftStorage';
import { CHANNEL_LABELS, formatCatalogTimestamp } from './referralSupport';

export type CatalogRefreshSnapshot = {
  label: string;
  source: CatalogLoadSource;
  lastUpdated: string | null;
  itemCount: number;
  error?: unknown;
};

export type CatalogRefreshSummary = {
  title: string;
  message: string;
  variant: 'success' | 'warning' | 'info' | 'error';
};

export type ReportSupportInput = {
  patterns: string[];
  severity: 'low' | 'medium' | 'high';
  immediateHelp: boolean;
};

export function buildCatalogStatusLine(snapshot: CatalogRefreshSnapshot): string {
  const { label, source, lastUpdated, itemCount, error } = snapshot;
  const resolvedLabel = label.trim() || 'Catalog';

  if (itemCount === 0) {
    return error
      ? `${resolvedLabel}: unavailable; no saved or bundled entries loaded.`
      : `${resolvedLabel}: no entries available.`;
  }

  if (source === 'remote') {
    return lastUpdated
      ? `${resolvedLabel}: refreshed ${formatCatalogTimestamp(lastUpdated)}.`
      : `${resolvedLabel}: refreshed from the service.`;
  }

  if (source === 'cache') {
    return lastUpdated
      ? `${resolvedLabel}: showing saved entries from ${formatCatalogTimestamp(lastUpdated)}.`
      : `${resolvedLabel}: showing saved entries.`;
  }

  if (error) {
    return `${resolvedLabel}: update failed; bundled entries are shown.`;
  }

  return `${resolvedLabel}: showing bundled entries until an online refresh succeeds.`;
}

export function buildCatalogRefreshSummary(snapshots: CatalogRefreshSnapshot[]): CatalogRefreshSummary {
  if (snapshots.length === 0) {
    return {
      title: 'Catalog status unavailable',
      message: 'Catalog status could not be checked right now.',
      variant: 'error',
    };
  }

  const lines = snapshots.map(buildCatalogStatusLine);
  const allEmpty = snapshots.every(snapshot => snapshot.itemCount === 0);
  const allRemote = snapshots.every(snapshot => snapshot.source === 'remote' && snapshot.itemCount > 0);
  const hasError = snapshots.some(snapshot => snapshot.error);
  const hasCache = snapshots.some(snapshot => snapshot.source === 'cache' && snapshot.itemCount > 0);
  const hasSeed = snapshots.some(snapshot => snapshot.source === 'seed' && snapshot.itemCount > 0);

  if (allEmpty) {
    return {
      title: 'Catalogs unavailable',
      message: lines.join(' '),
      variant: 'error',
    };
  }

  if (allRemote) {
    return {
      title: 'Catalogs refreshed',
      message: lines.join(' '),
      variant: 'success',
    };
  }

  if (hasError || hasCache || hasSeed) {
    return {
      title: hasError ? 'Saved catalogs shown' : 'Catalog status updated',
      message: lines.join(' '),
      variant: hasError || hasSeed ? 'warning' : 'info',
    };
  }

  return {
    title: 'Catalog status updated',
    message: lines.join(' '),
    variant: 'info',
  };
}

export function buildCatalogFreshnessSummary({
  providersLastUpdated,
  tipsLastUpdated,
  legalTagsLastUpdated,
}: {
  providersLastUpdated: string | null;
  tipsLastUpdated: string | null;
  legalTagsLastUpdated: string | null;
}): string {
  const updated = [
    providersLastUpdated ? `providers ${formatCatalogTimestamp(providersLastUpdated)}` : null,
    tipsLastUpdated ? `tips ${formatCatalogTimestamp(tipsLastUpdated)}` : null,
    legalTagsLastUpdated ? `rights tags ${formatCatalogTimestamp(legalTagsLastUpdated)}` : null,
  ].filter(Boolean);

  if (updated.length === 0) {
    return 'Using bundled support, tips, and rights catalogs until an online refresh succeeds.';
  }

  return `Saved catalog timestamps: ${updated.join('; ')}. Bundled entries are used where no saved update exists.`;
}

function normalizeTipText(tip: TipCard): string {
  return [
    tip.id,
    tip.title,
    tip.body,
    tip.category,
    ...tip.tags,
  ].join(' ').toLowerCase();
}

function scoreTipForReport(tip: TipCard, input: ReportSupportInput): number {
  const text = normalizeTipText(tip);
  let score = 0;

  if (input.immediateHelp && /1195|hotline|support|referral/.test(text)) {
    score += 12;
  }

  if (input.severity === 'high' && /medical|pep|evidence|safety|hotline|p3/.test(text)) {
    score += 5;
  }

  if (input.patterns.some(pattern => ['sexual_harassment', 'physical_threat', 'physical_assault'].includes(pattern))) {
    if (/medical|pep|evidence|p3|rights|consent/.test(text)) {
      score += 5;
    }
  }

  if (input.patterns.some(pattern => ['stalking', 'following', 'blocking_path'].includes(pattern))) {
    if (/safety|planning|reporting|hotline|documentation/.test(text)) {
      score += 4;
    }
  }

  if (input.patterns.some(pattern => ['verbal_harassment', 'discrimination', 'workplace_retaliation'].includes(pattern))) {
    if (/rights|reporting|documentation|consent/.test(text)) {
      score += 3;
    }
  }

  if (/rights|consent/.test(text)) {
    score += 1;
  }

  return score;
}

export function getReportSupportTips(
  tips: TipCard[],
  input: ReportSupportInput,
  limit: number = 3,
): TipCard[] {
  return tips
    .map((tip, index) => ({ tip, index, score: scoreTipForReport(tip, input) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(entry => entry.tip);
}

export function buildReferralCaseSupportDetails(selection: ReferralSelectionData): string[] {
  const details = [
    `Provider: ${selection.providerName}`,
    selection.selectedChannel
      ? `Channel: ${CHANNEL_LABELS[selection.selectedChannel]}`
      : 'Contact action: unavailable until this listing is reviewed',
    selection.includeBrief
      ? 'Support brief: included by consent'
      : 'Support brief: not included by preference',
  ];

  if (selection.phone) {
    details.push(`Listed phone: ${selection.phone}`);
  }

  if (selection.serviceScope.length > 0) {
    details.push(`Scope: ${selection.serviceScope.join(', ')}`);
  }

  if (selection.coverage) {
    details.push(`Coverage: ${selection.coverage}`);
  }

  if (selection.availability) {
    details.push(`Availability: ${selection.availability}`);
  }

  if (selection.reviewStatus) {
    details.push(`Catalog note: ${selection.reviewStatus}`);
  }

  if (selection.catalogSource === 'cache' || selection.catalogSource === 'rollback') {
    details.push(
      selection.catalogLastUpdated
        ? `Catalog: ${selection.catalogSource === 'rollback' ? 'previous verified' : 'saved'} listing from ${formatCatalogTimestamp(selection.catalogLastUpdated)}`
        : `Catalog: ${selection.catalogSource === 'rollback' ? 'previous verified' : 'saved'} listing`,
    );
  } else if (selection.catalogSource === 'seed') {
    details.push('Catalog: bundled listing');
  } else if (selection.catalogSource === 'remote') {
    details.push(
      selection.catalogLastUpdated
        ? `Catalog: refreshed listing from ${formatCatalogTimestamp(selection.catalogLastUpdated)}`
        : 'Catalog: refreshed listing',
    );
  }

  details.push('Provider receipt is not confirmed from this case view.');

  return details;
}
