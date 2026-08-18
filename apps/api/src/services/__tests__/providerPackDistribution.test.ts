import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  canonicalProviderArtifactSha256,
  evaluateProviderPackDistribution,
  loadProviderPackDistribution,
} from '../providerPackDistribution';

function readJson(relativePath: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8')) as Record<string, any>;
}

function approvedSyntheticBundle() {
  const pack = readJson('data/providers/provider-pack.v1.json');
  pack.status = 'active';
  for (const provider of pack.providers) {
    provider.status = 'active';
    for (const verification of [provider.hours.verification, provider.eligibility.verification, ...provider.contacts.map((contact: any) => contact.verification)]) {
      verification.status = 'verified';
      verification.reviewerId = 'synthetic-content-reviewer';
      verification.reviewedAt = '2026-07-31T10:00:00.000Z';
    }
  }
  const manifest = readJson('data/providers/provider-pack.v1.manifest.json');
  manifest.status = 'approved';
  manifest.packSha256 = canonicalProviderArtifactSha256(pack);
  manifest.attestation = {
    ...manifest.attestation,
    status: 'approved', reviewerId: 'synthetic-release-reviewer', reviewedAt: '2026-07-31T12:00:00.000Z',
    expiresAt: '2026-08-29T00:00:00.000Z', artifactSha256: 'a'.repeat(64),
  };
  manifest.partnerValidation = {
    ...manifest.partnerValidation,
    status: 'approved', partnerId: 'synthetic-partner-organization', reviewerId: 'synthetic-partner-reviewer',
    reviewedAt: '2026-07-31T11:00:00.000Z', expiresAt: '2026-08-29T00:00:00.000Z', artifactSha256: 'b'.repeat(64),
  };
  manifest.release = { status: 'approved', rolloutPercent: 10, immutableRevision: 'c'.repeat(40) };
  const controls = {
    ...readJson('config/providers/provider-pack-rollout.v1.json'),
    activation: { status: 'enabled', reason: null },
    rolloutPercent: 10,
    approvedPackId: pack.packId,
    approvedPackVersion: pack.version,
    approvedPackSha256: canonicalProviderArtifactSha256(pack),
    approvedManifestSha256: canonicalProviderArtifactSha256(manifest),
    immutableRevision: 'c'.repeat(40),
    validFrom: '2026-07-31T00:00:00.000Z',
    validUntil: '2026-08-29T00:00:00.000Z',
  };
  return { pack, manifest, controls };
}

describe('provider pack API distribution gate', () => {
  it('stays disabled under checked-in controls without reading or serving provider rows', () => {
    expect(loadProviderPackDistribution(new Date('2026-07-30T12:00:00.000Z'))).toEqual({
      enabled: false,
      reason: 'not-approved',
    });
  });

  it('accepts only a current exact hash-bound synthetic approved bundle', () => {
    const bundle = approvedSyntheticBundle();
    expect(evaluateProviderPackDistribution({
      ...bundle,
      now: new Date('2026-08-01T00:00:00.000Z'),
    })).toMatchObject({ enabled: true, controlVersion: bundle.controls.controlVersion });

    bundle.pack.providers[0].services.push('Unapproved change');
    expect(evaluateProviderPackDistribution({
      ...bundle,
      now: new Date('2026-08-01T00:00:00.000Z'),
    })).toEqual({ enabled: false, reason: 'hash-mismatch' });
  });

  it('rejects expired approval evidence even when hashes otherwise match', () => {
    const bundle = approvedSyntheticBundle();
    expect(evaluateProviderPackDistribution({
      ...bundle,
      now: new Date('2026-08-30T00:00:00.000Z'),
    })).toEqual({ enabled: false, reason: 'expired' });
  });
});
