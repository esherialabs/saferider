import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRandomBytesAsync } from 'expo-crypto';

import legalTagsSeed from '../../assets/data/legal_tags.json';
import tipsSeed from '../../assets/data/tips.json';
import { request } from './api/httpClient';
import {
  getBundledProviderPack,
  getProviderPackRolloutControls,
  inspectProviderPack,
  isProviderPackRemoteRefreshEligible,
  isProviderRecordActionable,
  type ProviderPack,
  type ProviderPackAssessment,
  type ProviderPackFreshness,
  type ProviderPackManifest,
  type ProviderPackTrust,
} from './providerPack';

export interface ProviderSource {
  title: string;
  url: string;
}

export interface Provider {
  id: string;
  name: string;
  type: 'Hotline' | 'GBV center' | 'Legal aid';
  distance?: string;
  hours?: string;
  isOpen?: boolean;
  languages: string[];
  services: string[];
  channels: { call: boolean; whatsapp: boolean; sms: boolean };
  phone?: string;
  address?: string;
  safetyPhrase?: string;
  contactStatus?: 'verified' | 'pending' | 'expired' | 'revoked';
  packVersion?: string;
  expiresAt?: string;
  eligibility?: string;
  metadata?: {
    reviewStatus?: string;
    notes?: string;
    sources?: ProviderSource[];
    recordStatus?: string;
    declaredChannels?: string[];
  };
}

export interface LegalTag {
  id: string;
  tag: string;
  description: string;
  category: string;
}

export interface TipCard {
  id: string;
  title: string;
  body: string;
  updated: string;
  category: string;
  tags: string[];
  hasCopySteps?: boolean;
  copySteps?: string[];
  sources?: { title: string; url: string }[];
}

type CacheEnvelope<T> = { items: T[]; lastUpdated: string };

export type CatalogLoadSource = 'remote' | 'cache' | 'rollback' | 'seed';

export interface ProviderPackDisplayStatus {
  version: string | null;
  integrity: 'verified' | 'invalid';
  freshness: ProviderPackFreshness | 'unknown';
  trust: ProviderPackTrust;
  expiresAt: string | null;
  rollbackUsed: boolean;
}

export interface CatalogLoadResult<T> {
  items: T[];
  source: CatalogLoadSource;
  lastUpdated: string | null;
  error?: unknown;
  providerPack?: ProviderPackDisplayStatus;
}

const KEYS = {
  legacyProviders: '@catalog_providers',
  providerPackCurrent: '@catalog_provider_pack_current_v1',
  providerPackPrevious: '@catalog_provider_pack_previous_v1',
  providerPackRolloutBucket: '@catalog_provider_pack_rollout_bucket_v1',
  legalTags: '@catalog_legal_tags',
  tips: '@catalog_tips',
} as const;

const REMOTE_CATALOG_REFRESH_ENABLED = false;

type LegalTagRow = {
  id: string;
  tag: string;
  description: string | null;
  category: string | null;
};

type TipRow = {
  id: string;
  title: string;
  body: string;
  category: string | null;
  updated_label: string | null;
  tags: string[] | null;
  copy_steps: string[] | null;
  has_copy_steps: boolean | null;
  sources: Array<{ title: string; url: string }> | null;
  updated_at: string;
};

type TipSeedRaw = TipCard;

function formatTipUpdatedLabel(value: string): string {
  let source = value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    source = `${value}T00:00:00Z`;
  }
  const date = new Date(source);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }
  return value;
}

const TIP_SEED_RAW: TipSeedRaw[] = (tipsSeed as TipSeedRaw[]).map(tip => ({
  ...tip,
  hasCopySteps: tip.hasCopySteps ?? Boolean(tip.copySteps?.length),
}));

const TIP_SEED_DISPLAY: TipCard[] = TIP_SEED_RAW.map(tip => ({
  ...tip,
  updated: formatTipUpdatedLabel(tip.updated),
  hasCopySteps: tip.hasCopySteps ?? Boolean(tip.copySteps?.length),
}));

async function getCached<T>(key: string): Promise<CacheEnvelope<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn(`Failed to read cache for ${key}:`, error);
    return null;
  }
}

async function setCached<T>(key: string, items: T[]): Promise<string> {
  const lastUpdated = new Date().toISOString();
  const envelope: CacheEnvelope<T> = { items, lastUpdated };
  try {
    await AsyncStorage.setItem(key, JSON.stringify(envelope));
  } catch (error) {
    console.warn(`Failed to write cache for ${key}:`, error);
  }
  return lastUpdated;
}

function mapLegalTag(row: LegalTagRow): LegalTag {
  return {
    id: row.id,
    tag: row.tag,
    description: row.description ?? '',
    category: row.category ?? '',
  };
}

function formatUpdatedLabel(row: TipRow): string {
  if (row.updated_label && row.updated_label.trim().length > 0) {
    return row.updated_label;
  }

  return formatTipUpdatedLabel(row.updated_at);
}

function mapTip(row: TipRow): TipCard {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    updated: formatUpdatedLabel(row),
    category: row.category ?? 'General',
    tags: row.tags ?? [],
    hasCopySteps: row.has_copy_steps ?? Boolean(row.copy_steps?.length),
    copySteps: row.copy_steps ?? undefined,
    sources: row.sources ?? undefined,
  };
}

type StoredProviderPack = {
  storageVersion: 1;
  pack: ProviderPack;
  manifest: ProviderPackManifest;
  activatedAt: string;
};

type ProviderPackSelection = {
  assessment: ProviderPackAssessment | null;
  source: CatalogLoadSource;
  rollbackUsed: boolean;
  errorCode?: ProviderPackErrorCode;
};

type ProviderPackErrorCode =
  | 'bundled-integrity-failed'
  | 'cached-pack-invalid'
  | 'rollout-disabled'
  | 'remote-unavailable'
  | 'remote-pack-rejected'
  | 'version-conflict';

export class ProviderPackCatalogError extends Error {
  readonly code: ProviderPackErrorCode;

  constructor(code: ProviderPackErrorCode) {
    super(`Provider directory unavailable: ${code}`);
    this.name = 'ProviderPackCatalogError';
    this.code = code;
  }
}

function providerType(category: ProviderPack['providers'][number]['serviceCategory']): Provider['type'] {
  if (category === 'hotline') return 'Hotline';
  if (category === 'legal_aid') return 'Legal aid';
  return 'GBV center';
}

function verifiedContact(contact: ProviderPack['providers'][number]['contacts'][number]): boolean {
  return contact.verification.status === 'verified' && Boolean(
    contact.verification.reviewerId && contact.verification.reviewedAt,
  );
}

export function mapProviderPackToProviders(
  assessment: ProviderPackAssessment,
  now = new Date(),
): Provider[] {
  return assessment.pack.providers
    .filter(record => record.status !== 'removed')
    .map(record => {
      const recordExpired = Date.parse(record.expiresAt) <= now.getTime();
      const recordActionable = isProviderRecordActionable(record, assessment, now);
      const activeContacts = recordActionable
        ? record.contacts.filter(verifiedContact)
        : [];
      const callContact = activeContacts.find(contact => contact.channel === 'call');
      const contactStatus: Provider['contactStatus'] =
        assessment.trust === 'revoked' || record.status === 'suspended'
          ? 'revoked'
          : recordExpired || record.status === 'expired' || assessment.freshness === 'expired'
            ? 'expired'
            : activeContacts.length > 0
              ? 'verified'
              : 'pending';
      const reviewStatus = contactStatus === 'verified'
        ? 'Partner-validated, current contact listing'
        : contactStatus === 'expired'
          ? 'Listing expired; contact actions are unavailable'
          : contactStatus === 'revoked'
            ? 'Listing revoked; contact actions are unavailable'
            : 'Contact and eligibility review pending; contact actions are unavailable';

      return {
        id: record.stableId,
        name: record.name,
        type: providerType(record.serviceCategory),
        distance: '—',
        hours: record.hours.summary,
        isOpen: recordActionable && /24\s*\/\s*7/.test(record.hours.summary),
        languages: record.languages.map(language => language.toUpperCase()),
        services: record.services,
        channels: {
          call: activeContacts.some(contact => contact.channel === 'call'),
          whatsapp: activeContacts.some(contact => contact.channel === 'whatsapp'),
          sms: activeContacts.some(contact => contact.channel === 'sms'),
        },
        phone: callContact?.value,
        address: record.coverage.summary,
        contactStatus,
        packVersion: assessment.pack.version,
        expiresAt: record.expiresAt,
        eligibility: record.eligibility.summary,
        metadata: {
          reviewStatus,
          notes: 'A listing does not mean the provider received a referral, accepted a case, or confirmed attendance.',
          sources: record.sources.map(source => ({ title: source.title, url: source.url })),
          recordStatus: record.status,
          declaredChannels: record.contacts.map(contact => contact.channel),
        },
      };
    });
}

function packDisplayStatus(
  assessment: ProviderPackAssessment | null,
  rollbackUsed: boolean,
): ProviderPackDisplayStatus {
  if (!assessment) {
    return {
      version: null,
      integrity: 'invalid',
      freshness: 'unknown',
      trust: 'invalid',
      expiresAt: null,
      rollbackUsed,
    };
  }
  return {
    version: assessment.pack.version,
    integrity: 'verified',
    freshness: assessment.freshness,
    trust: assessment.trust,
    expiresAt: assessment.pack.expiresAt,
    rollbackUsed,
  };
}

function packResult(
  selection: ProviderPackSelection,
  now = new Date(),
): CatalogLoadResult<Provider> {
  const { assessment, source, rollbackUsed, errorCode } = selection;
  return {
    items: assessment ? mapProviderPackToProviders(assessment, now) : [],
    source,
    lastUpdated: assessment?.pack.updatedAt ?? null,
    providerPack: packDisplayStatus(assessment, rollbackUsed),
    ...(errorCode ? { error: new ProviderPackCatalogError(errorCode) } : {}),
  };
}

function parseStoredProviderPack(
  raw: string | null,
  controls: unknown,
  now: Date,
): { stored: StoredProviderPack; assessment: ProviderPackAssessment } | null {
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as StoredProviderPack;
    if (stored.storageVersion !== 1 || typeof stored.activatedAt !== 'string') return null;
    const assessment = inspectProviderPack(stored.pack, stored.manifest, controls, now);
    if (!assessment || assessment.trust !== 'approved' || assessment.freshness === 'expired') return null;
    return { stored, assessment };
  } catch {
    return null;
  }
}

export function selectProviderPackForLocalUse({
  currentRaw,
  previousRaw,
  bundled,
  controls,
  now = new Date(),
}: {
  currentRaw: string | null;
  previousRaw: string | null;
  bundled: ProviderPackAssessment | null;
  controls: unknown;
  now?: Date;
}): ProviderPackSelection {
  const current = parseStoredProviderPack(currentRaw, controls, now);
  if (current) return { assessment: current.assessment, source: 'cache', rollbackUsed: false };
  const previous = parseStoredProviderPack(previousRaw, controls, now);
  if (previous) {
    return {
      assessment: previous.assessment,
      source: 'rollback',
      rollbackUsed: true,
      ...(currentRaw ? { errorCode: 'cached-pack-invalid' as const } : {}),
    };
  }
  if (bundled) {
    return {
      assessment: bundled,
      source: 'seed',
      rollbackUsed: false,
      ...(currentRaw || previousRaw ? { errorCode: 'cached-pack-invalid' as const } : {}),
    };
  }
  return { assessment: null, source: 'seed', rollbackUsed: false, errorCode: 'bundled-integrity-failed' };
}

async function readLocalProviderPack(now = new Date()): Promise<ProviderPackSelection> {
  const [currentRaw, previousRaw] = await Promise.all([
    AsyncStorage.getItem(KEYS.providerPackCurrent),
    AsyncStorage.getItem(KEYS.providerPackPrevious),
  ]);
  return selectProviderPackForLocalUse({
    currentRaw,
    previousRaw,
    bundled: getBundledProviderPack(now),
    controls: getProviderPackRolloutControls(),
    now,
  });
}

async function getProviderPackRolloutBucket(): Promise<number> {
  const stored = await AsyncStorage.getItem(KEYS.providerPackRolloutBucket);
  if (stored && /^(?:[0-9]|[1-9][0-9])$/.test(stored)) return Number(stored);
  const random = await getRandomBytesAsync(1);
  const bucket = random[0] % 100;
  await AsyncStorage.setItem(KEYS.providerPackRolloutBucket, String(bucket));
  return bucket;
}

async function fetchProviderPackFromApi(): Promise<{ pack: unknown; manifest: unknown }> {
  return request<{ pack: unknown; manifest: unknown }>({ path: '/provider-pack' });
}

function canPromoteProviderPack(
  current: ProviderPackAssessment | null,
  candidate: ProviderPackAssessment,
): boolean {
  if (candidate.trust !== 'approved' || candidate.freshness === 'expired') return false;
  if (!current || current.trust !== 'approved') return true;
  if (candidate.pack.version === current.pack.version) return candidate.packSha256 === current.packSha256;
  if (Date.parse(candidate.pack.updatedAt) > Date.parse(current.pack.updatedAt)) return true;
  return current.manifest.rollback.previousPackVersion === candidate.pack.version &&
    current.manifest.rollback.previousPackSha256 === candidate.packSha256;
}

async function activateProviderPack(
  candidate: ProviderPackAssessment,
  currentRaw: string | null,
  now: Date,
): Promise<void> {
  const envelope: StoredProviderPack = {
    storageVersion: 1,
    pack: candidate.pack,
    manifest: candidate.manifest,
    activatedAt: now.toISOString(),
  };
  const writes: [string, string][] = [[KEYS.providerPackCurrent, JSON.stringify(envelope)]];
  const current = parseStoredProviderPack(currentRaw, getProviderPackRolloutControls(), now);
  if (current && current.assessment.packSha256 !== candidate.packSha256) {
    writes.unshift([KEYS.providerPackPrevious, currentRaw!]);
  }
  await AsyncStorage.multiSet(writes);
}

async function fetchWithFallbackInfo<T>(
  fetchRemote: () => Promise<T[]>,
  seed: T[],
  cacheKey: string,
): Promise<CatalogLoadResult<T>> {
  if (!REMOTE_CATALOG_REFRESH_ENABLED) {
    return readLocalCatalogInfo(seed, cacheKey);
  }

  let fetchError: unknown;

  try {
    const remote = await fetchRemote();
    if (Array.isArray(remote) && remote.length > 0) {
      const lastUpdated = await setCached(cacheKey, remote);
      return { items: remote, source: 'remote', lastUpdated };
    }
  } catch (error) {
    fetchError = error;
    console.warn(`Catalog fetch failed for ${cacheKey}. Falling back to cache/seed.`, error);
  }

  const cached = await getCached<T>(cacheKey);
  if (cached && cached.items?.length) {
    return { items: cached.items, source: 'cache', lastUpdated: cached.lastUpdated, error: fetchError };
  }

  return { items: seed, source: 'seed', lastUpdated: null, error: fetchError };
}

async function readLocalCatalogInfo<T>(
  seed: T[],
  cacheKey: string,
): Promise<CatalogLoadResult<T>> {
  const cached = await getCached<T>(cacheKey);
  if (cached && cached.items?.length) {
    return { items: cached.items, source: 'cache', lastUpdated: cached.lastUpdated };
  }

  return { items: seed, source: 'seed', lastUpdated: null };
}

async function fetchLegalTagsFromApi(): Promise<LegalTag[]> {
  const response = await request<{ tags: LegalTagRow[] }>({ path: '/legal-tags' });
  return response.tags.map(mapLegalTag);
}

async function fetchTipsFromApi(): Promise<TipCard[]> {
  const response = await request<{ tips: TipRow[] }>({ path: '/tips' });
  return response.tips.map(mapTip);
}

// Providers
export async function getProviders(): Promise<Provider[]> {
  const result = await getProvidersWithInfo();
  return result.items;
}

export async function getProvidersLocalOnly(): Promise<Provider[]> {
  const result = await getProvidersLocalOnlyWithInfo();
  return result.items;
}

export async function getProvidersWithInfo(): Promise<CatalogLoadResult<Provider>> {
  const now = new Date();
  return packResult(await readLocalProviderPack(now), now);
}

export async function getProvidersLocalOnlyWithInfo(): Promise<CatalogLoadResult<Provider>> {
  return getProvidersWithInfo();
}

export async function refreshProviders(): Promise<{
  updated: boolean;
  items: Provider[];
  source: CatalogLoadSource;
  lastUpdated: string | null;
  providerPack?: ProviderPackDisplayStatus;
  error?: unknown;
}> {
  const now = new Date();
  const localSelection = await readLocalProviderPack(now);
  const localResult = packResult(localSelection, now);
  const controls = getProviderPackRolloutControls();
  if (!controls || controls.activation.status !== 'enabled') {
    return { ...localResult, updated: false, error: new ProviderPackCatalogError('rollout-disabled') };
  }
  const bucket = await getProviderPackRolloutBucket();
  if (!isProviderPackRemoteRefreshEligible(bucket, now)) {
    return { ...localResult, updated: false, error: new ProviderPackCatalogError('rollout-disabled') };
  }

  try {
    const response = await fetchProviderPackFromApi();
    const candidate = inspectProviderPack(response.pack, response.manifest, controls, now);
    if (!candidate || !canPromoteProviderPack(localSelection.assessment, candidate)) {
      return { ...localResult, updated: false, error: new ProviderPackCatalogError('remote-pack-rejected') };
    }
    const currentRaw = await AsyncStorage.getItem(KEYS.providerPackCurrent);
    if (
      localSelection.assessment?.pack.version === candidate.pack.version &&
      localSelection.assessment.packSha256 !== candidate.packSha256
    ) {
      return { ...localResult, updated: false, error: new ProviderPackCatalogError('version-conflict') };
    }
    await activateProviderPack(candidate, currentRaw, now);
    const result = packResult({ assessment: candidate, source: 'remote', rollbackUsed: false }, now);
    return { ...result, updated: true };
  } catch {
    return { ...localResult, updated: false, error: new ProviderPackCatalogError('remote-unavailable') };
  }
}

// Legal Tags
export async function getLegalTags(): Promise<LegalTag[]> {
  const result = await getLegalTagsWithInfo();
  return result.items;
}

export async function getLegalTagsWithInfo(): Promise<CatalogLoadResult<LegalTag>> {
  return fetchWithFallbackInfo<LegalTag>(
    fetchLegalTagsFromApi,
    legalTagsSeed as LegalTag[],
    KEYS.legalTags,
  );
}

export async function refreshLegalTags(): Promise<{ updated: boolean; items: LegalTag[]; source: CatalogLoadSource; lastUpdated: string | null; error?: unknown }> {
  const result = await getLegalTagsWithInfo();
  return {
    updated: result.source === 'remote',
    items: result.items,
    source: result.source,
    lastUpdated: result.lastUpdated,
    error: result.error,
  };
}

// Tips
export async function getTips(): Promise<TipCard[]> {
  const result = await getTipsWithInfo();
  return result.items;
}

export async function getTipsWithInfo(): Promise<CatalogLoadResult<TipCard>> {
  return fetchWithFallbackInfo<TipCard>(
    fetchTipsFromApi,
    TIP_SEED_DISPLAY,
    KEYS.tips,
  );
}

export async function refreshTips(): Promise<{ updated: boolean; items: TipCard[]; source: CatalogLoadSource; lastUpdated: string | null; error?: unknown }> {
  const result = await getTipsWithInfo();
  return {
    updated: result.source === 'remote',
    items: result.items,
    source: result.source,
    lastUpdated: result.lastUpdated,
    error: result.error,
  };
}

export async function getCatalogInfo() {
  const [p, t, l] = await Promise.all([
    getProvidersLocalOnlyWithInfo(),
    getCached<TipCard>(KEYS.tips),
    getCached<LegalTag>(KEYS.legalTags),
  ]);
  return {
    providersLastUpdated: p.lastUpdated,
    tipsLastUpdated: t?.lastUpdated || null,
    legalTagsLastUpdated: l?.lastUpdated || null,
  };
}
