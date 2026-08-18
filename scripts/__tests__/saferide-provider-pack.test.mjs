import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalSha256, findForbiddenProviderPackField, getProviderPackReleaseBlockers } from '../lib/saferide-provider-pack.mjs';
import {
  readProviderPackBundle,
  runProviderPackCheck,
  validateProviderPackRuntimeImage,
} from '../saferide-provider-pack-check.mjs';

function clone(value) {
  return structuredClone(value);
}

test('checked-in candidate is schema-valid, hash-bound, current, and fail closed', () => {
  const result = runProviderPackCheck({ now: new Date('2026-07-30T12:00:00.000Z') });
  assert.deepEqual(result.errors, []);
  assert.equal(result.pack.status, 'candidate');
  assert.equal(result.controls.activation.status, 'disabled');
  assert.equal(result.controls.rolloutPercent, 0);
  assert.deepEqual(result.controls.closedLoopClaims, {
    providerReceipt: false,
    appointmentAttendance: false,
    reason: 'No provider receipt or appointment-attendance integration exists.',
  });
  assert.ok(result.pack.providers.every(provider => provider.status === 'pending_verification'));
});

test('API runtime image includes the reviewed provider controls and pack artifacts', () => {
  assert.deepEqual(validateProviderPackRuntimeImage(), []);
  assert.deepEqual(
    validateProviderPackRuntimeImage('COPY config/providers ./config/providers'),
    ['API runtime image is missing: COPY data/providers ./data/providers'],
  );
});

test('pack tampering and unknown source references fail integrity and semantic gates', () => {
  const bundle = readProviderPackBundle({ now: new Date('2026-07-30T12:00:00.000Z') });
  const pack = clone(bundle.pack);
  pack.providers[0].contacts[0].value = 'synthetic-changed-value';
  pack.providers[0].contacts[0].sourceId = 'missing-source';
  const result = runProviderPackCheck({ ...bundle, pack });
  assert.ok(result.errors.includes('manifest pack SHA-256 does not match canonical pack bytes'));
  assert.ok(result.errors.some(error => error.includes('contact references an unknown source')));
});

test('provider packs reject survivor, exact-location, and closed-loop payload fields', () => {
  const bundle = readProviderPackBundle({ now: new Date('2026-07-30T12:00:00.000Z') });
  assert.equal(findForbiddenProviderPackField(bundle.pack), null);
  const changed = clone(bundle.pack);
  changed.providers[0].referralPayload = { narrative: 'synthetic forbidden field' };
  const result = runProviderPackCheck({ ...bundle, pack: changed });
  assert.ok(result.errors.some(error => error.includes('forbidden sensitive or closed-loop field')));
});

test('active records cannot bypass attributable contact and eligibility verification', () => {
  const bundle = readProviderPackBundle({ now: new Date('2026-07-30T12:00:00.000Z') });
  const pack = clone(bundle.pack);
  pack.status = 'active';
  pack.providers[0].status = 'active';
  const manifest = clone(bundle.manifest);
  manifest.status = 'approved';
  manifest.packSha256 = canonicalSha256(pack);
  const result = runProviderPackCheck({ ...bundle, pack, manifest });
  assert.ok(result.errors.some(error => error.includes('active eligibility requires attributable verification')));
  assert.ok(result.errors.some(error => error.includes('active contact requires attributable verification')));
});

test('checked-in release gate reports external approval and rollout blockers', () => {
  const result = runProviderPackCheck({ release: true, now: new Date('2026-07-30T12:00:00.000Z') });
  assert.ok(result.errors.includes('provider pack status must be active'));
  assert.ok(result.errors.includes('partner-validation evidence must be approved'));
  assert.ok(result.errors.includes('release-attestation evidence must be approved'));
  assert.ok(result.errors.includes('remote provider-pack distribution must be explicitly enabled'));
});

test('release gate accepts a complete synthetic, hash-bound, independently reviewed bundle', () => {
  const bundle = readProviderPackBundle({ now: new Date('2026-08-01T00:00:00.000Z') });
  const pack = clone(bundle.pack);
  pack.status = 'active';
  for (const provider of pack.providers) {
    provider.status = 'active';
    for (const verification of [provider.hours.verification, provider.eligibility.verification, ...provider.contacts.map(contact => contact.verification)]) {
      verification.status = 'verified';
      verification.reviewerId = 'synthetic-content-reviewer';
      verification.reviewedAt = '2026-07-31T10:00:00.000Z';
    }
  }
  const packSha256 = canonicalSha256(pack);
  const partnerApproval = {
    ...clone(bundle.partnerApproval), status: 'approved', packSha256,
    organizationId: 'synthetic-partner-organization',
    reviewerId: 'synthetic-partner-reviewer', reviewedAt: '2026-07-31T11:00:00.000Z',
    expiresAt: '2026-08-29T00:00:00.000Z', artifactReference: 'synthetic://partner-validation',
    artifactSha256: 'a'.repeat(64),
  };
  const attestation = {
    ...clone(bundle.attestation), status: 'approved', packSha256,
    reviewerId: 'synthetic-release-reviewer', reviewedAt: '2026-07-31T12:00:00.000Z',
    expiresAt: '2026-08-29T00:00:00.000Z', artifactReference: 'synthetic://release-attestation',
    artifactSha256: 'b'.repeat(64),
  };
  const manifest = clone(bundle.manifest);
  manifest.status = 'approved';
  manifest.packSha256 = packSha256;
  manifest.attestation = {
    ...manifest.attestation, status: 'approved', reviewerId: attestation.reviewerId,
    reviewedAt: attestation.reviewedAt, expiresAt: attestation.expiresAt,
    artifactSha256: attestation.artifactSha256,
  };
  manifest.partnerValidation = {
    ...manifest.partnerValidation, status: 'approved', partnerId: partnerApproval.organizationId,
    reviewerId: partnerApproval.reviewerId, reviewedAt: partnerApproval.reviewedAt,
    expiresAt: partnerApproval.expiresAt, artifactSha256: partnerApproval.artifactSha256,
  };
  manifest.release = { status: 'approved', rolloutPercent: 10, immutableRevision: 'c'.repeat(40) };
  const controls = {
    ...clone(bundle.controls), activation: { status: 'enabled', reason: null }, rolloutPercent: 10,
    approvedPackId: pack.packId, approvedPackVersion: pack.version, approvedPackSha256: packSha256,
    approvedManifestSha256: canonicalSha256(manifest), rollbackApprovedPacks: [], immutableRevision: 'c'.repeat(40),
    validFrom: '2026-07-31T00:00:00.000Z', validUntil: '2026-08-29T00:00:00.000Z',
  };
  assert.deepEqual(getProviderPackReleaseBlockers({ pack, manifest, controls, partnerApproval, attestation, now: bundle.now }), []);
});
