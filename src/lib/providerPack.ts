import { sha256 } from '@noble/hashes/sha2.js';
import { z } from 'zod';

import providerPackRaw from '../../data/providers/provider-pack.v1.json';
import providerManifestRaw from '../../data/providers/provider-pack.v1.manifest.json';
import rolloutControlsRaw from '../../config/providers/provider-pack-rollout.v1.json';
import { utf8ToBytes } from './utf8';

const dateTime = z.string().datetime();
const verificationSchema = z.object({
  status: z.enum(['pending', 'verified', 'expired', 'revoked']),
  reviewerId: z.string().min(3).nullable(),
  reviewerRole: z.string().min(3),
  reviewedAt: dateTime.nullable(),
}).strict();

const sourcedStatementSchema = z.object({
  summary: z.string().min(1),
  sourceIds: z.array(z.string().min(3)).min(1),
  verification: verificationSchema,
}).strict();

const providerRecordSchema = z.object({
  stableId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
  name: z.string().min(2),
  serviceCategory: z.enum(['hotline', 'gbv_center', 'legal_aid', 'medical', 'psychosocial', 'shelter', 'other']),
  coverage: z.object({
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    kind: z.enum(['national', 'county', 'subcounty', 'facility', 'remote']),
    areas: z.array(z.string().min(1)).min(1),
    summary: z.string().min(1),
  }).strict(),
  hours: sourcedStatementSchema,
  eligibility: sourcedStatementSchema,
  contacts: z.array(z.object({
    channel: z.enum(['call', 'sms', 'whatsapp', 'email', 'web', 'in_person']),
    value: z.string().min(1),
    sourceId: z.string().min(3),
    verification: verificationSchema,
  }).strict()),
  languages: z.array(z.string().regex(/^[a-z]{2,3}$/)).min(1),
  services: z.array(z.string().min(1)).min(1),
  sources: z.array(z.object({
    sourceId: z.string().min(3),
    title: z.string().min(1),
    publisher: z.string().min(1),
    url: z.string().url().refine(value => value.startsWith('https://')),
    accessedAt: dateTime,
  }).strict()).min(1),
  status: z.enum(['pending_verification', 'active', 'suspended', 'expired', 'removed']),
  updatedAt: dateTime,
  expiresAt: dateTime,
}).strict();

const providerPackSchema = z.object({
  schema: z.literal('com.saferide.provider-directory-pack'),
  schemaVersion: z.literal(1),
  packId: z.string().min(3),
  version: z.string().min(5),
  jurisdiction: z.string().regex(/^[A-Z]{2}$/),
  status: z.enum(['candidate', 'active', 'revoked']),
  updatedAt: dateTime,
  expiresAt: dateTime,
  providers: z.array(providerRecordSchema).min(1),
}).strict();

const evidencePointerSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'expired', 'revoked']),
  evidenceId: z.string().min(3),
  evidencePath: z.string().min(3),
  reviewerId: z.string().min(3).nullable(),
  reviewedAt: dateTime.nullable(),
  expiresAt: dateTime.nullable(),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
}).strict();

const providerManifestSchema = z.object({
  schema: z.literal('com.saferide.provider-pack-manifest'),
  schemaVersion: z.literal(1),
  manifestId: z.string().min(3),
  packId: z.string().min(3),
  packVersion: z.string().min(5),
  packSha256: z.string().regex(/^[a-f0-9]{64}$/),
  hashCanonicalization: z.literal('sorted-json-v1'),
  createdAt: dateTime,
  expiresAt: dateTime,
  status: z.enum(['candidate', 'approved', 'revoked']),
  attestation: evidencePointerSchema,
  partnerValidation: evidencePointerSchema.extend({ partnerId: z.string().min(3).nullable() }).strict(),
  changelog: z.array(z.string().min(1)).min(1),
  rollback: z.object({
    strategy: z.literal('last-known-good'),
    reference: z.literal('provider-pack-cache/previous-valid'),
    previousPackVersion: z.string().min(5).nullable(),
    previousPackSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  }).strict(),
  release: z.object({
    status: z.enum(['blocked', 'approved', 'revoked']),
    rolloutPercent: z.number().int().min(0).max(100),
    immutableRevision: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
  }).strict(),
}).strict();

const approvedPackPointerSchema = z.object({
  packId: z.string().min(3),
  packVersion: z.string().min(5),
  packSha256: z.string().regex(/^[a-f0-9]{64}$/),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  validUntil: dateTime,
}).strict();

const rolloutControlsSchema = z.object({
  schema: z.literal('com.saferide.provider-pack-rollout'),
  schemaVersion: z.literal(1),
  controlVersion: z.string().min(3),
  activation: z.object({
    status: z.enum(['disabled', 'enabled', 'revoked']),
    reason: z.string().min(1).nullable(),
  }).strict(),
  closedLoopClaims: z.object({
    providerReceipt: z.literal(false),
    appointmentAttendance: z.literal(false),
    reason: z.string().min(1),
  }).strict(),
  rolloutPercent: z.number().int().min(0).max(100),
  approvedPackId: z.string().min(3).nullable(),
  approvedPackVersion: z.string().min(5).nullable(),
  approvedPackSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  approvedManifestSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  rollbackApprovedPacks: z.array(approvedPackPointerSchema),
  immutableRevision: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
  validFrom: dateTime.nullable(),
  validUntil: dateTime.nullable(),
}).strict();

export type ProviderPack = z.infer<typeof providerPackSchema>;
export type ProviderPackManifest = z.infer<typeof providerManifestSchema>;
export type ProviderPackRolloutControls = z.infer<typeof rolloutControlsSchema>;
export type ProviderPackRecord = z.infer<typeof providerRecordSchema>;
export type ProviderPackFreshness = 'current' | 'stale' | 'expired';
export type ProviderPackTrust = 'approved' | 'pending' | 'revoked' | 'invalid';

export interface VerifiedProviderPack {
  pack: ProviderPack;
  manifest: ProviderPackManifest;
  packSha256: string;
  manifestSha256: string;
}

export interface ProviderPackAssessment extends VerifiedProviderPack {
  freshness: ProviderPackFreshness;
  trust: ProviderPackTrust;
  contactActionsAllowed: boolean;
  approvedAsRollback: boolean;
}

export type ProviderPackVerificationResult =
  | { ok: true; value: VerifiedProviderPack }
  | { ok: false; code: 'invalid-shape' | 'identity-mismatch' | 'hash-mismatch' | 'invalid-references' };

function bytesToHex(bytes: Uint8Array): string {
  let output = '';
  for (const byte of bytes) output += byte.toString(16).padStart(2, '0');
  return output;
}

export function canonicalProviderPackJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Provider pack canonical JSON cannot contain non-finite numbers.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalProviderPackJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalProviderPackJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  throw new Error('Provider pack canonical JSON contains an unsupported value.');
}

export function canonicalProviderPackSha256(value: unknown): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalProviderPackJson(value))));
}

function hasValidReferences(pack: ProviderPack): boolean {
  if (new Set(pack.providers.map(provider => provider.stableId)).size !== pack.providers.length) return false;
  return pack.providers.every(provider => {
    const sourceIds = provider.sources.map(source => source.sourceId);
    const sources = new Set(sourceIds);
    if (sources.size !== sourceIds.length) return false;
    const references = [
      ...provider.hours.sourceIds,
      ...provider.eligibility.sourceIds,
      ...provider.contacts.map(contact => contact.sourceId),
    ];
    return references.every(sourceId => sources.has(sourceId));
  });
}

export function verifyProviderPack(packInput: unknown, manifestInput: unknown): ProviderPackVerificationResult {
  const parsedPack = providerPackSchema.safeParse(packInput);
  const parsedManifest = providerManifestSchema.safeParse(manifestInput);
  if (!parsedPack.success || !parsedManifest.success) return { ok: false, code: 'invalid-shape' };
  const pack = parsedPack.data;
  const manifest = parsedManifest.data;
  if (manifest.packId !== pack.packId || manifest.packVersion !== pack.version || manifest.expiresAt !== pack.expiresAt) {
    return { ok: false, code: 'identity-mismatch' };
  }
  const packSha256 = canonicalProviderPackSha256(pack);
  if (manifest.packSha256 !== packSha256) return { ok: false, code: 'hash-mismatch' };
  if (!hasValidReferences(pack)) return { ok: false, code: 'invalid-references' };
  return {
    ok: true,
    value: { pack, manifest, packSha256, manifestSha256: canonicalProviderPackSha256(manifest) },
  };
}

function dateIsCurrent(value: string | null, now: Date): boolean {
  return Boolean(value && Date.parse(value) > now.getTime());
}

function getFreshness(expiresAt: string, now: Date): ProviderPackFreshness {
  const remaining = Date.parse(expiresAt) - now.getTime();
  if (remaining <= 0) return 'expired';
  return remaining <= 7 * 24 * 60 * 60 * 1000 ? 'stale' : 'current';
}

function evidenceIsApproved(pointer: z.infer<typeof evidencePointerSchema>, now: Date): boolean {
  return pointer.status === 'approved' && Boolean(
    pointer.reviewerId &&
    pointer.reviewedAt &&
    pointer.artifactSha256 &&
    dateIsCurrent(pointer.expiresAt, now),
  );
}

function controlsApproveBundle(
  controls: ProviderPackRolloutControls,
  verified: VerifiedProviderPack,
  now: Date,
): { approved: boolean; rollback: boolean } {
  if (
    controls.activation.status !== 'enabled' ||
    controls.rolloutPercent < 1 ||
    !controls.immutableRevision ||
    !controls.validFrom ||
    Date.parse(controls.validFrom) > now.getTime() ||
    !dateIsCurrent(controls.validUntil, now)
  ) return { approved: false, rollback: false };

  const isCurrent =
    controls.approvedPackId === verified.pack.packId &&
    controls.approvedPackVersion === verified.pack.version &&
    controls.approvedPackSha256 === verified.packSha256 &&
    controls.approvedManifestSha256 === verified.manifestSha256;
  if (isCurrent) return { approved: true, rollback: false };
  const rollback = controls.rollbackApprovedPacks.some(pointer =>
    pointer.packId === verified.pack.packId &&
    pointer.packVersion === verified.pack.version &&
    pointer.packSha256 === verified.packSha256 &&
    pointer.manifestSha256 === verified.manifestSha256 &&
    dateIsCurrent(pointer.validUntil, now),
  );
  return { approved: rollback, rollback };
}

export function parseProviderPackRolloutControls(input: unknown): ProviderPackRolloutControls | null {
  const parsed = rolloutControlsSchema.safeParse(input);
  if (!parsed.success) return null;
  const controls = parsed.data;
  if (controls.activation.status === 'disabled') {
    const evidencePresent = Boolean(
      controls.approvedPackId || controls.approvedPackVersion || controls.approvedPackSha256 ||
      controls.approvedManifestSha256 || controls.immutableRevision || controls.validFrom || controls.validUntil ||
      controls.rollbackApprovedPacks.length,
    );
    if (!controls.activation.reason || controls.rolloutPercent !== 0 || evidencePresent) return null;
  }
  return controls;
}

export function assessProviderPack(
  verified: VerifiedProviderPack,
  controlsInput: unknown = rolloutControlsRaw,
  now = new Date(),
): ProviderPackAssessment {
  const controls = parseProviderPackRolloutControls(controlsInput);
  const freshness = getFreshness(verified.pack.expiresAt, now);
  const approval = controls ? controlsApproveBundle(controls, verified, now) : { approved: false, rollback: false };
  const revoked = verified.pack.status === 'revoked' || verified.manifest.status === 'revoked' || verified.manifest.release.status === 'revoked';
  const approved =
    !revoked &&
    freshness !== 'expired' &&
    verified.pack.status === 'active' &&
    verified.manifest.status === 'approved' &&
    verified.manifest.release.status === 'approved' &&
    verified.manifest.release.immutableRevision === controls?.immutableRevision &&
    verified.manifest.release.rolloutPercent === controls?.rolloutPercent &&
    evidenceIsApproved(verified.manifest.attestation, now) &&
    evidenceIsApproved(verified.manifest.partnerValidation, now) &&
    Boolean(verified.manifest.partnerValidation.partnerId) &&
    approval.approved;
  const trust: ProviderPackTrust = revoked ? 'revoked' : approved ? 'approved' : 'pending';
  return {
    ...verified,
    freshness,
    trust,
    contactActionsAllowed: approved,
    approvedAsRollback: approved && approval.rollback,
  };
}

export function inspectProviderPack(
  packInput: unknown,
  manifestInput: unknown,
  controlsInput: unknown = rolloutControlsRaw,
  now = new Date(),
): ProviderPackAssessment | null {
  const verified = verifyProviderPack(packInput, manifestInput);
  return verified.ok ? assessProviderPack(verified.value, controlsInput, now) : null;
}

export function getBundledProviderPack(now = new Date()): ProviderPackAssessment | null {
  return inspectProviderPack(providerPackRaw, providerManifestRaw, rolloutControlsRaw, now);
}

export function getProviderPackRolloutControls(): ProviderPackRolloutControls | null {
  return parseProviderPackRolloutControls(rolloutControlsRaw);
}

export function isProviderPackRemoteRefreshEligible(
  bucket: number,
  now = new Date(),
  controlsInput: unknown = rolloutControlsRaw,
): boolean {
  const controls = parseProviderPackRolloutControls(controlsInput);
  return Boolean(
    controls &&
    controls.activation.status === 'enabled' &&
    controls.rolloutPercent > bucket &&
    bucket >= 0 && bucket < 100 &&
    controls.validFrom && Date.parse(controls.validFrom) <= now.getTime() &&
    dateIsCurrent(controls.validUntil, now),
  );
}

export function isProviderRecordActionable(record: ProviderPackRecord, assessment: ProviderPackAssessment, now = new Date()): boolean {
  if (!assessment.contactActionsAllowed || record.status !== 'active' || !dateIsCurrent(record.expiresAt, now)) return false;
  return record.hours.verification.status === 'verified' &&
    record.eligibility.verification.status === 'verified' &&
    Boolean(record.hours.verification.reviewerId && record.eligibility.verification.reviewerId);
}

export const providerPackTesting = {
  packSchema: providerPackSchema,
  manifestSchema: providerManifestSchema,
  rolloutControlsSchema,
};
