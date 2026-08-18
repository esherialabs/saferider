import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const dateTime = z.string().datetime();
const verificationSchema = z.object({
  status: z.literal('verified'),
  reviewerId: z.string().min(3),
  reviewerRole: z.string().min(3),
  reviewedAt: dateTime,
}).passthrough();
const activeProviderSchema = z.object({
  stableId: z.string().min(3),
  status: z.literal('active'),
  expiresAt: dateTime,
  hours: z.object({ verification: verificationSchema }).passthrough(),
  eligibility: z.object({ verification: verificationSchema }).passthrough(),
  contacts: z.array(z.object({ verification: verificationSchema }).passthrough()),
}).passthrough();
const activePackSchema = z.object({
  schema: z.literal('com.saferide.provider-directory-pack'),
  schemaVersion: z.literal(1),
  packId: z.string().min(3),
  version: z.string().min(5),
  status: z.literal('active'),
  updatedAt: dateTime,
  expiresAt: dateTime,
  providers: z.array(activeProviderSchema).min(1),
}).passthrough();
const approvedEvidenceSchema = z.object({
  status: z.literal('approved'),
  reviewerId: z.string().min(3),
  reviewedAt: dateTime,
  expiresAt: dateTime,
  artifactSha256: sha256,
}).passthrough();
const approvedManifestSchema = z.object({
  schema: z.literal('com.saferide.provider-pack-manifest'),
  schemaVersion: z.literal(1),
  packId: z.string().min(3),
  packVersion: z.string().min(5),
  packSha256: sha256,
  hashCanonicalization: z.literal('sorted-json-v1'),
  expiresAt: dateTime,
  status: z.literal('approved'),
  attestation: approvedEvidenceSchema,
  partnerValidation: approvedEvidenceSchema.extend({ partnerId: z.string().min(3) }),
  release: z.object({
    status: z.literal('approved'),
    rolloutPercent: z.number().int().min(1).max(100),
    immutableRevision: z.string().regex(/^[a-f0-9]{40}$/),
  }).strict(),
}).passthrough();
const controlsSchema = z.object({
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
  approvedPackSha256: sha256.nullable(),
  approvedManifestSha256: sha256.nullable(),
  rollbackApprovedPacks: z.array(z.unknown()),
  immutableRevision: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
  validFrom: dateTime.nullable(),
  validUntil: dateTime.nullable(),
}).strict();

export type ProviderPackDistributionDecision =
  | { enabled: true; pack: unknown; manifest: unknown; controlVersion: string }
  | { enabled: false; reason: 'controls-unavailable' | 'not-approved' | 'invalid-artifacts' | 'expired' | 'hash-mismatch' };

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite provider pack value');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map(key =>
      `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
    ).join(',')}}`;
  }
  throw new Error('Unsupported provider pack value');
}

export function canonicalProviderArtifactSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function current(value: string, now: Date): boolean {
  return Date.parse(value) > now.getTime();
}

export function evaluateProviderPackDistribution({
  controls: controlsInput,
  pack: packInput,
  manifest: manifestInput,
  now = new Date(),
}: {
  controls: unknown;
  pack: unknown;
  manifest: unknown;
  now?: Date;
}): ProviderPackDistributionDecision {
  const controlsResult = controlsSchema.safeParse(controlsInput);
  if (!controlsResult.success) return { enabled: false, reason: 'controls-unavailable' };
  const controls = controlsResult.data;
  if (controls.activation.status !== 'enabled' || controls.rolloutPercent < 1) {
    return { enabled: false, reason: 'not-approved' };
  }
  if (!controls.validFrom || !controls.validUntil || Date.parse(controls.validFrom) > now.getTime() || !current(controls.validUntil, now)) {
    return { enabled: false, reason: 'expired' };
  }
  const packResult = activePackSchema.safeParse(packInput);
  const manifestResult = approvedManifestSchema.safeParse(manifestInput);
  if (!packResult.success || !manifestResult.success) return { enabled: false, reason: 'invalid-artifacts' };
  const pack = packResult.data;
  const manifest = manifestResult.data;
  if (
    !current(pack.expiresAt, now) ||
    !current(manifest.expiresAt, now) ||
    !current(manifest.attestation.expiresAt, now) ||
    !current(manifest.partnerValidation.expiresAt, now) ||
    pack.providers.some(provider => !current(provider.expiresAt, now))
  ) return { enabled: false, reason: 'expired' };
  if (manifest.attestation.reviewerId === manifest.partnerValidation.reviewerId) {
    return { enabled: false, reason: 'invalid-artifacts' };
  }
  const packSha = canonicalProviderArtifactSha256(packInput);
  const manifestSha = canonicalProviderArtifactSha256(manifestInput);
  if (
    manifest.packId !== pack.packId ||
    manifest.packVersion !== pack.version ||
    manifest.packSha256 !== packSha ||
    controls.approvedPackId !== pack.packId ||
    controls.approvedPackVersion !== pack.version ||
    controls.approvedPackSha256 !== packSha ||
    controls.approvedManifestSha256 !== manifestSha ||
    controls.rolloutPercent !== manifest.release.rolloutPercent ||
    controls.immutableRevision !== manifest.release.immutableRevision
  ) return { enabled: false, reason: 'hash-mismatch' };
  return { enabled: true, pack: packInput, manifest: manifestInput, controlVersion: controls.controlVersion };
}

function findFile(configured: string | undefined, candidates: string[]): string | null {
  const paths = configured ? [resolve(configured)] : candidates.map(candidate => resolve(process.cwd(), candidate));
  return paths.find(existsSync) ?? null;
}

function readJson(filePath: string | null): unknown {
  if (!filePath) throw new Error('Provider pack file unavailable');
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function loadProviderPackDistribution(now = new Date()): ProviderPackDistributionDecision {
  try {
    const controlsPath = findFile(process.env.SAFERIDE_PROVIDER_PACK_CONTROLS_PATH, [
      'config/providers/provider-pack-rollout.v1.json',
      '../../config/providers/provider-pack-rollout.v1.json',
    ]);
    const controls = readJson(controlsPath);
    const parsedControls = controlsSchema.safeParse(controls);
    if (!parsedControls.success) return { enabled: false, reason: 'controls-unavailable' };
    if (parsedControls.data.activation.status !== 'enabled') return { enabled: false, reason: 'not-approved' };
    const packPath = findFile(process.env.SAFERIDE_PROVIDER_PACK_PATH, [
      'data/providers/provider-pack.v1.json',
      '../../data/providers/provider-pack.v1.json',
    ]);
    const manifestPath = findFile(process.env.SAFERIDE_PROVIDER_PACK_MANIFEST_PATH, [
      'data/providers/provider-pack.v1.manifest.json',
      '../../data/providers/provider-pack.v1.manifest.json',
    ]);
    return evaluateProviderPackDistribution({
      controls,
      pack: readJson(packPath),
      manifest: readJson(manifestPath),
      now,
    });
  } catch {
    return { enabled: false, reason: 'controls-unavailable' };
  }
}
