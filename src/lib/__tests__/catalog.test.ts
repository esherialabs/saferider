import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import packRaw from '../../../data/providers/provider-pack.v1.json';
import manifestRaw from '../../../data/providers/provider-pack.v1.manifest.json';

const httpMock = vi.hoisted(() => ({
  request: vi.fn(),
}));

vi.mock('../api/httpClient', () => ({
  request: httpMock.request,
}));

import {
  getProvidersLocalOnly,
  getProvidersLocalOnlyWithInfo,
  selectProviderPackForLocalUse,
  type Provider,
} from '../catalog';
import { canonicalProviderPackSha256, inspectProviderPack } from '../providerPack';

type ResettableAsyncStorage = typeof AsyncStorage & {
  __reset: () => void;
};

function approvedSyntheticBundle() {
  const pack: any = structuredClone(packRaw);
  pack.status = 'active' as const;
  for (const provider of pack.providers) {
    provider.status = 'active' as const;
    for (const verification of [
      provider.hours.verification,
      provider.eligibility.verification,
      ...provider.contacts.map((contact: any) => contact.verification),
    ]) {
      verification.status = 'verified' as const;
      verification.reviewerId = 'synthetic-content-reviewer';
      verification.reviewedAt = '2026-07-31T10:00:00.000Z';
    }
  }
  const packSha256 = canonicalProviderPackSha256(pack);
  const manifest: any = structuredClone(manifestRaw);
  manifest.status = 'approved' as const;
  manifest.packSha256 = packSha256;
  manifest.attestation = {
    ...manifest.attestation,
    status: 'approved' as const,
    reviewerId: 'synthetic-release-reviewer',
    reviewedAt: '2026-07-31T12:00:00.000Z',
    expiresAt: '2026-08-29T00:00:00.000Z',
    artifactSha256: 'a'.repeat(64),
  };
  manifest.partnerValidation = {
    ...manifest.partnerValidation,
    status: 'approved' as const,
    partnerId: 'synthetic-partner-organization',
    reviewerId: 'synthetic-partner-reviewer',
    reviewedAt: '2026-07-31T11:00:00.000Z',
    expiresAt: '2026-08-29T00:00:00.000Z',
    artifactSha256: 'b'.repeat(64),
  };
  manifest.release = {
    status: 'approved' as const,
    rolloutPercent: 10,
    immutableRevision: 'c'.repeat(40),
  };
  const controls = {
    schema: 'com.saferide.provider-pack-rollout' as const,
    schemaVersion: 1 as const,
    controlVersion: 'synthetic-control',
    activation: { status: 'enabled' as const, reason: null },
    closedLoopClaims: {
      providerReceipt: false as const,
      appointmentAttendance: false as const,
      reason: 'No synthetic closed-loop integration exists.',
    },
    rolloutPercent: 10,
    approvedPackId: pack.packId,
    approvedPackVersion: pack.version,
    approvedPackSha256: packSha256,
    approvedManifestSha256: canonicalProviderPackSha256(manifest),
    rollbackApprovedPacks: [],
    immutableRevision: 'c'.repeat(40),
    validFrom: '2026-07-31T00:00:00.000Z',
    validUntil: '2026-08-29T00:00:00.000Z',
  };
  const now = new Date('2026-08-01T00:00:00.000Z');
  const assessment = inspectProviderPack(pack, manifest, controls, now);
  if (!assessment) throw new Error('Synthetic approved pack fixture is invalid');
  return { pack, manifest, controls, assessment, now };
}

describe('versioned provider catalog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T12:00:00.000Z'));
    (AsyncStorage as ResettableAsyncStorage).__reset();
    httpMock.request.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('verifies and displays the bundled candidate without network access or contact actions', async () => {
    const result = await getProvidersLocalOnlyWithInfo();

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.source).toBe('seed');
    expect(result.providerPack).toMatchObject({
      integrity: 'verified',
      trust: 'pending',
      freshness: 'current',
      rollbackUsed: false,
    });
    expect(result.items.every(provider => provider.contactStatus === 'pending')).toBe(true);
    expect(result.items.every(provider => !provider.channels.call && !provider.phone)).toBe(true);
    expect(result.items.some(provider => provider.name === 'Human Rights Agenda (HURIA)')).toBe(true);
    expect(httpMock.request).not.toHaveBeenCalled();
  });

  it('does not migrate an unversioned legacy cache into the trusted provider path', async () => {
    const legacyProvider: Provider = {
      id: 'legacy-unverified',
      name: 'Legacy unverified listing',
      type: 'Legal aid',
      languages: ['English'],
      services: ['Legal support'],
      channels: { call: true, whatsapp: false, sms: true },
      phone: '000',
    };
    await AsyncStorage.setItem('@catalog_providers', JSON.stringify({
      items: [legacyProvider],
      lastUpdated: '2026-07-09T04:00:00.000Z',
    }));

    const providers = await getProvidersLocalOnly();

    expect(providers.some(provider => provider.id === legacyProvider.id)).toBe(false);
    expect(providers.every(provider => provider.contactStatus === 'pending')).toBe(true);
  });

  it('falls back to bundled data when a cached envelope is malformed', async () => {
    await AsyncStorage.setItem('@catalog_provider_pack_current_v1', '{malformed');

    const result = await getProvidersLocalOnlyWithInfo();

    expect(result.source).toBe('seed');
    expect(result.error).toMatchObject({ code: 'cached-pack-invalid' });
    expect(result.providerPack?.integrity).toBe('verified');
  });

  it('uses the previous approved pack when the current cache fails validation', () => {
    const { pack, manifest, controls, assessment, now } = approvedSyntheticBundle();
    expect(assessment.trust).toBe('approved');
    const rollbackControls = {
      ...controls,
      approvedPackId: 'synthetic-next-pack',
      approvedPackVersion: '2.0.0',
      approvedPackSha256: 'd'.repeat(64),
      approvedManifestSha256: 'e'.repeat(64),
      rollbackApprovedPacks: [{
        packId: pack.packId,
        packVersion: pack.version,
        packSha256: assessment.packSha256,
        manifestSha256: assessment.manifestSha256,
        validUntil: '2026-08-29T00:00:00.000Z',
      }],
    };
    const rollbackAssessment = inspectProviderPack(pack, manifest, rollbackControls, now);
    expect(rollbackAssessment).toMatchObject({ trust: 'approved', approvedAsRollback: true });
    const previousRaw = JSON.stringify({
      storageVersion: 1,
      pack,
      manifest,
      activatedAt: '2026-08-01T00:00:00.000Z',
    });
    const selection = selectProviderPackForLocalUse({
      currentRaw: '{malformed',
      previousRaw,
      bundled: null,
      controls: rollbackControls,
      now,
    });

    expect(selection.source).toBe('rollback');
    expect(selection.rollbackUsed).toBe(true);
    expect(selection.errorCode).toBe('cached-pack-invalid');
    expect(selection.assessment?.packSha256).toBe(rollbackAssessment?.packSha256);
  });
});
