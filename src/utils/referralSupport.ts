import type { Provider, ProviderPackDisplayStatus } from '../lib/catalog';
import type { PathwayType } from '../types/pathways';
import type { DraftData, ReferralSelectionData } from './draftStorage';
import { getCompletedStepsBeforeConsent } from '../navigation/reportPathwayFlow';

export type ReferralContactChannel = 'call' | 'whatsapp' | 'sms';
export type ProviderCatalogSource = 'remote' | 'cache' | 'rollback' | 'seed';

export interface ProviderFilter {
  id: string;
  active: boolean;
}

export const CHANNEL_LABELS: Record<ReferralContactChannel, string> = {
  call: 'Phone call',
  whatsapp: 'WhatsApp message',
  sms: 'SMS message',
};

export function buildReferralContactUrl(
  channel: ReferralContactChannel,
  phone: string | null | undefined,
): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 3 || digits.length > 15) return null;
  const dialNumber = trimmed.startsWith('+') ? `+${digits}` : digits;
  if (channel === 'whatsapp') {
    if (digits.length < 7) return null;
    return `https://wa.me/${digits}`;
  }
  return channel === 'sms' ? `sms:${dialNumber}` : `tel:${dialNumber}`;
}

export function getAvailableReferralChannels(provider: Provider): ReferralContactChannel[] {
  if (provider.contactStatus !== 'verified') return [];
  return (['call', 'whatsapp', 'sms'] as ReferralContactChannel[]).filter(channel => provider.channels[channel]);
}

export function getProviderCoverageLabel(provider: Provider): string | undefined {
  const parts = [provider.address, provider.distance && provider.distance !== '—' ? provider.distance : undefined]
    .filter(Boolean);
  return parts.length ? parts.join(' - ') : undefined;
}

export function getProviderAvailabilityLabel(provider: Provider): string | undefined {
  return provider.hours?.trim() || undefined;
}

export function getProviderReviewLabel(provider: Provider): string {
  return provider.metadata?.reviewStatus?.trim() || 'Listed support provider';
}

export function isSourceLinkedProvider(provider: Provider): boolean {
  return Boolean(provider.metadata?.sources?.length);
}

export function isProviderContactActionable(provider: Provider): boolean {
  return provider.contactStatus === 'verified' && getAvailableReferralChannels(provider).length > 0;
}

export function shouldIncludeReferralBrief(
  draft: Pick<DraftData, 'includeBrief' | 'referralSelection'>,
): boolean {
  if (typeof draft.referralSelection?.includeBrief === 'boolean') {
    return draft.referralSelection.includeBrief;
  }

  return draft.includeBrief !== false;
}

export function shouldIncludeDraftBriefDetails(
  pathway: PathwayType,
  draft: Pick<DraftData, 'includeBrief' | 'referralSelection'>,
): boolean {
  if (pathway === 'anonymous-map') {
    return false;
  }

  return pathway !== 'referral' || shouldIncludeReferralBrief(draft);
}

export function filterReferralProviders(
  providers: Provider[],
  searchQuery: string,
  filters: ProviderFilter[],
): Provider[] {
  const query = searchQuery.trim().toLowerCase();
  const activeFilters = filters.filter(filter => filter.active);

  return providers.filter(provider => {
    const searchable = [
      provider.name,
      provider.type,
      provider.address,
      provider.eligibility,
      provider.safetyPhrase,
      provider.metadata?.reviewStatus,
      provider.metadata?.notes,
      ...provider.services,
      ...provider.languages,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (query && !searchable.includes(query)) {
      return false;
    }

    if (!activeFilters.length) {
      return true;
    }

    return activeFilters.every(filter => {
      switch (filter.id) {
        case 'open':
          return provider.isOpen === true;
        case 'hotline':
          return provider.type === 'Hotline';
        case 'gbv':
          return provider.type === 'GBV center';
        case 'legal':
          return provider.type === 'Legal aid';
        case 'counselling':
          return provider.services.some(service => service.toLowerCase().includes('counsel'));
        case 'near': {
          if (!provider.distance || provider.distance === '—') return false;
          const distanceValue = parseFloat(provider.distance);
          return !Number.isNaN(distanceValue) && distanceValue < 2;
        }
        default:
          return true;
      }
    });
  });
}

export function buildReferralSelectionData({
  provider,
  selectedChannel,
  includeBrief,
  catalogSource,
  catalogLastUpdated,
  selectedAt,
}: {
  provider: Provider;
  selectedChannel: ReferralContactChannel | null;
  includeBrief: boolean;
  catalogSource: ProviderCatalogSource;
  catalogLastUpdated: string | null;
  selectedAt: string;
}): ReferralSelectionData {
  return {
    providerId: provider.id,
    providerName: provider.name,
    providerType: provider.type,
    ...(selectedChannel ? { selectedChannel } : {}),
    contactStatus: provider.contactStatus,
    includeBrief,
    phone: provider.phone,
    address: provider.address,
    serviceScope: provider.services,
    coverage: getProviderCoverageLabel(provider),
    availability: getProviderAvailabilityLabel(provider),
    safetyPhrase: provider.safetyPhrase,
    reviewStatus: provider.metadata?.reviewStatus,
    catalogSource,
    catalogLastUpdated,
    catalogPackVersion: provider.packVersion,
    listingExpiresAt: provider.expiresAt,
    selectedAt,
  };
}

export function buildReferralDraftUpdate({
  draftId,
  provider,
  selectedChannel,
  includeBrief,
  catalogSource,
  catalogLastUpdated,
  selectedAt = new Date().toISOString(),
}: {
  draftId: string;
  provider: Provider;
  selectedChannel: ReferralContactChannel | null;
  includeBrief: boolean;
  catalogSource: ProviderCatalogSource;
  catalogLastUpdated: string | null;
  selectedAt?: string;
}): Partial<DraftData> & { id: string } {
  return {
    id: draftId,
    selectedPathway: 'referral',
    selectedProvider: provider.id,
    selectedChannel: selectedChannel ?? undefined,
    includeBrief,
    referralSelection: buildReferralSelectionData({
      provider,
      selectedChannel,
      includeBrief,
      catalogSource,
      catalogLastUpdated,
      selectedAt,
    }),
    completedSteps: getCompletedStepsBeforeConsent('referral'),
    currentStep: 'ConsentGate',
    updatedAt: new Date(selectedAt),
  };
}

export function buildProviderCatalogStatus({
  isOnline,
  source,
  lastUpdated,
  providerCount,
  providerPack,
}: {
  isOnline: boolean;
  source: ProviderCatalogSource;
  lastUpdated: string | null;
  providerCount: number;
  providerPack?: ProviderPackDisplayStatus;
}): string {
  if (providerPack?.integrity === 'invalid') {
    return 'Provider pack failed integrity checks. No catalog contact action is available.';
  }
  if (providerPack?.freshness === 'expired') {
    return 'Provider listings are expired. Details may be viewed, but contact actions are unavailable.';
  }
  if (providerPack?.trust === 'revoked') {
    return 'Provider pack was revoked. Contact actions are unavailable.';
  }
  if (providerPack?.rollbackUsed) {
    return lastUpdated
      ? `Current update failed checks. Showing the previous verified pack from ${formatCatalogTimestamp(lastUpdated)}.`
      : 'Current update failed checks. Showing the previous verified provider pack.';
  }
  if (providerPack?.trust === 'pending') {
    return providerPack.freshness === 'stale'
      ? 'Bundled listings are stale and still awaiting accountable review. Contact actions are unavailable.'
      : 'Bundled listings await accountable provider review. Contact actions are unavailable.';
  }
  if (providerCount === 0) {
    return isOnline
      ? 'Provider list is empty. Try updating the catalog or save a fallback contact.'
      : 'Provider list is unavailable offline. Saved contacts may still appear.';
  }

  if (!isOnline && (source === 'cache' || source === 'rollback')) {
    return lastUpdated
      ? `Showing saved provider listings from ${formatCatalogTimestamp(lastUpdated)}.`
      : 'Showing saved provider listings.';
  }

  if (!isOnline && source === 'seed') {
    return 'Offline - showing bundled provider listings. Confirm details before sharing.';
  }

  if (source === 'seed') {
    return 'Showing bundled provider listings. Update the catalog when online.';
  }

  if (lastUpdated) {
    return `Provider catalog updated ${formatCatalogTimestamp(lastUpdated)}.`;
  }

  return 'Provider catalog loaded.';
}

export function buildProviderConsentDetails(
  selection: ReferralSelectionData,
  fallbackProvider?: Provider,
): string[] {
  const details: string[] = [];
  if (selection.selectedChannel) {
    details.push(`Channel: ${CHANNEL_LABELS[selection.selectedChannel]}`);
  } else {
    details.push('Contact action: unavailable until this listing is reviewed');
  }
  details.push(selection.includeBrief ? 'Support brief requested' : 'No support brief requested');

  const phone = selection.phone ?? fallbackProvider?.phone;
  const coverage = selection.coverage ?? (fallbackProvider ? getProviderCoverageLabel(fallbackProvider) : undefined);
  const availability = selection.availability ?? (fallbackProvider ? getProviderAvailabilityLabel(fallbackProvider) : undefined);
  const reviewStatus = selection.reviewStatus ?? fallbackProvider?.metadata?.reviewStatus;
  const services = selection.serviceScope?.length ? selection.serviceScope : fallbackProvider?.services;

  if (phone) {
    details.push(`Phone: ${phone}`);
  }
  if (services?.length) {
    details.push(`Scope: ${services.join(', ')}`);
  }
  if (coverage) {
    details.push(`Coverage: ${coverage}`);
  }
  if (availability) {
    details.push(`Availability: ${availability}`);
  }
  if (reviewStatus) {
    details.push(`Catalog note: ${reviewStatus}`);
  }
  if (selection.catalogPackVersion) {
    details.push(`Provider pack: ${selection.catalogPackVersion}`);
  }
  if (selection.listingExpiresAt) {
    details.push(`Listing expires: ${formatCatalogTimestamp(selection.listingExpiresAt)}`);
  }
  if (selection.catalogSource === 'cache' || selection.catalogSource === 'rollback') {
    details.push(
      selection.catalogLastUpdated
        ? `Catalog: ${selection.catalogSource === 'rollback' ? 'previous verified' : 'saved'} listing from ${formatCatalogTimestamp(selection.catalogLastUpdated)}`
        : `Catalog: ${selection.catalogSource === 'rollback' ? 'previous verified' : 'saved'} listing`,
    );
  } else if (selection.catalogSource === 'seed') {
    details.push('Catalog: bundled listing');
  }

  return details;
}

export function formatCatalogTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}
