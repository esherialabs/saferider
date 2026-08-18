import crypto from 'node:crypto';

const SHA256 = /^[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;
const FORBIDDEN_PACK_FIELDS = new Set([
  'narrative', 'caseid', 'userid', 'survivorid', 'referralpayload', 'providerreceipt',
  'appointmentattendance', 'exactlocation', 'coordinates', 'latitude', 'longitude',
]);

export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Provider pack canonical JSON cannot contain non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  throw new Error(`Provider pack canonical JSON cannot encode ${typeof value}`);
}

export function canonicalSha256(value) {
  return crypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isCurrent(expiresAt, now) {
  return validDate(expiresAt) && Date.parse(expiresAt) > now.getTime();
}

function verified(value) {
  return value?.status === 'verified' && Boolean(value.reviewerId) && validDate(value.reviewedAt);
}

function unique(values) {
  return new Set(values).size === values.length;
}

function strictKeys(value, expected, label, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join('\n') !== wanted.join('\n')) errors.push(`${label} contains missing or unsupported fields`);
}

export function findForbiddenProviderPackField(value, prefix = '$') {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenProviderPackField(value[index], `${prefix}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (FORBIDDEN_PACK_FIELDS.has(normalized)) return `${prefix}.${key}`;
    const found = findForbiddenProviderPackField(child, `${prefix}.${key}`);
    if (found) return found;
  }
  return null;
}

export function validateProviderPackSemantics(pack, now = new Date()) {
  const errors = [];
  const forbiddenField = findForbiddenProviderPackField(pack);
  if (forbiddenField) errors.push(`provider pack contains forbidden sensitive or closed-loop field at ${forbiddenField}`);
  if (!validDate(pack?.updatedAt) || !validDate(pack?.expiresAt) || Date.parse(pack.updatedAt) >= Date.parse(pack.expiresAt)) {
    errors.push('pack freshness window is invalid');
  }
  if (!isCurrent(pack?.expiresAt, now)) errors.push('pack is expired');
  const providers = Array.isArray(pack?.providers) ? pack.providers : [];
  if (!unique(providers.map(provider => provider.stableId))) errors.push('provider stable IDs must be unique');

  for (const provider of providers) {
    const label = `provider ${provider.stableId ?? '<missing>'}`;
    if (!validDate(provider.updatedAt) || !validDate(provider.expiresAt) || Date.parse(provider.updatedAt) >= Date.parse(provider.expiresAt)) {
      errors.push(`${label} freshness window is invalid`);
    }
    if (Date.parse(provider.expiresAt) > Date.parse(pack.expiresAt)) errors.push(`${label} expiry exceeds pack expiry`);
    const sourceIds = (provider.sources ?? []).map(source => source.sourceId);
    if (!unique(sourceIds)) errors.push(`${label} source IDs must be unique`);
    const sourceSet = new Set(sourceIds);
    for (const sourceId of [...(provider.hours?.sourceIds ?? []), ...(provider.eligibility?.sourceIds ?? [])]) {
      if (!sourceSet.has(sourceId)) errors.push(`${label} references an unknown source`);
    }
    const channelKeys = [];
    for (const contact of provider.contacts ?? []) {
      if (!sourceSet.has(contact.sourceId)) errors.push(`${label} contact references an unknown source`);
      channelKeys.push(`${contact.channel}:${contact.value}`);
    }
    if (!unique(channelKeys)) errors.push(`${label} contains duplicate contact channels`);

    if (provider.status === 'active') {
      if (!isCurrent(provider.expiresAt, now)) errors.push(`${label} is active but expired`);
      if (!verified(provider.hours?.verification)) errors.push(`${label} active hours require attributable verification`);
      if (!verified(provider.eligibility?.verification)) errors.push(`${label} active eligibility requires attributable verification`);
      for (const contact of provider.contacts ?? []) {
        if (!verified(contact.verification)) errors.push(`${label} active contact requires attributable verification`);
      }
    }
  }
  return [...new Set(errors)];
}

export function validateManifestShape(manifest) {
  const errors = [];
  strictKeys(manifest, [
    'schema', 'schemaVersion', 'manifestId', 'packId', 'packVersion', 'packSha256',
    'hashCanonicalization', 'createdAt', 'expiresAt', 'status', 'attestation',
    'partnerValidation', 'changelog', 'rollback', 'release',
  ], 'manifest', errors);
  if (manifest?.schema !== 'com.saferide.provider-pack-manifest' || manifest?.schemaVersion !== 1) errors.push('manifest schema identity is invalid');
  if (!SHA256.test(manifest?.packSha256 ?? '')) errors.push('manifest pack SHA-256 is invalid');
  if (manifest?.hashCanonicalization !== 'sorted-json-v1') errors.push('manifest canonicalization is unsupported');
  if (!validDate(manifest?.createdAt) || !validDate(manifest?.expiresAt) || Date.parse(manifest.createdAt) >= Date.parse(manifest.expiresAt)) errors.push('manifest freshness window is invalid');
  if (!['candidate', 'approved', 'revoked'].includes(manifest?.status)) errors.push('manifest status is invalid');
  if (!Array.isArray(manifest?.changelog) || manifest.changelog.length === 0 || manifest.changelog.some(item => typeof item !== 'string' || !item.trim())) errors.push('manifest changelog is required');
  strictKeys(manifest?.attestation, ['status', 'evidenceId', 'evidencePath', 'reviewerId', 'reviewedAt', 'expiresAt', 'artifactSha256'], 'manifest attestation', errors);
  strictKeys(manifest?.partnerValidation, ['status', 'evidenceId', 'evidencePath', 'partnerId', 'reviewerId', 'reviewedAt', 'expiresAt', 'artifactSha256'], 'manifest partner validation', errors);
  strictKeys(manifest?.rollback, ['strategy', 'reference', 'previousPackVersion', 'previousPackSha256'], 'manifest rollback', errors);
  strictKeys(manifest?.release, ['status', 'rolloutPercent', 'immutableRevision'], 'manifest release', errors);
  if (manifest?.rollback?.strategy !== 'last-known-good' || manifest?.rollback?.reference !== 'provider-pack-cache/previous-valid') errors.push('manifest rollback must use the last-known-good cache');
  if (!['blocked', 'approved', 'revoked'].includes(manifest?.release?.status)) errors.push('manifest release status is invalid');
  if (!Number.isInteger(manifest?.release?.rolloutPercent) || manifest.release.rolloutPercent < 0 || manifest.release.rolloutPercent > 100) errors.push('manifest rollout percentage is invalid');
  return [...new Set(errors)];
}

export function validateRolloutControls(controls) {
  const errors = [];
  strictKeys(controls, [
    'schema', 'schemaVersion', 'controlVersion', 'activation', 'closedLoopClaims', 'rolloutPercent',
    'approvedPackId', 'approvedPackVersion', 'approvedPackSha256',
    'approvedManifestSha256', 'rollbackApprovedPacks', 'immutableRevision', 'validFrom', 'validUntil',
  ], 'rollout controls', errors);
  strictKeys(controls?.activation, ['status', 'reason'], 'rollout activation', errors);
  strictKeys(controls?.closedLoopClaims, ['providerReceipt', 'appointmentAttendance', 'reason'], 'closed-loop claim controls', errors);
  if (controls?.schema !== 'com.saferide.provider-pack-rollout' || controls?.schemaVersion !== 1) errors.push('rollout control schema identity is invalid');
  if (!['disabled', 'enabled', 'revoked'].includes(controls?.activation?.status)) errors.push('rollout activation status is invalid');
  if (!Number.isInteger(controls?.rolloutPercent) || controls.rolloutPercent < 0 || controls.rolloutPercent > 100) errors.push('rollout percentage is invalid');
  if (controls?.closedLoopClaims?.providerReceipt !== false || controls?.closedLoopClaims?.appointmentAttendance !== false || !controls?.closedLoopClaims?.reason) {
    errors.push('provider receipt and appointment attendance claims must remain disabled');
  }
  if (!Array.isArray(controls?.rollbackApprovedPacks)) errors.push('rollout rollback allowlist must be an array');
  for (const entry of controls?.rollbackApprovedPacks ?? []) {
    strictKeys(entry, ['packId', 'packVersion', 'packSha256', 'manifestSha256', 'validUntil'], 'rollout rollback entry', errors);
    if (!entry.packId || !entry.packVersion || !SHA256.test(entry.packSha256 ?? '') || !SHA256.test(entry.manifestSha256 ?? '') || !validDate(entry.validUntil)) {
      errors.push('rollout rollback entry is invalid');
    }
  }
  if (controls?.activation?.status === 'disabled') {
    if (!controls.activation.reason || controls.rolloutPercent !== 0) errors.push('disabled rollout requires a reason and zero percent');
    const evidenceFields = ['approvedPackId', 'approvedPackVersion', 'approvedPackSha256', 'approvedManifestSha256', 'immutableRevision', 'validFrom', 'validUntil'];
    if (evidenceFields.some(field => controls[field] !== null)) errors.push('disabled rollout cannot contain approval evidence');
    if (controls.rollbackApprovedPacks.length !== 0) errors.push('disabled rollout cannot approve rollback packs');
  }
  return [...new Set(errors)];
}

function approvalBlockers(approval, kind, pack, now) {
  const blockers = [];
  if (approval?.kind !== kind) blockers.push(`${kind} evidence kind is invalid`);
  if (approval?.status !== 'approved') blockers.push(`${kind} evidence must be approved`);
  if (approval?.packId !== pack?.packId || approval?.packVersion !== pack?.version) blockers.push(`${kind} evidence identifies a different pack`);
  if (approval?.packSha256 !== canonicalSha256(pack)) blockers.push(`${kind} evidence pack SHA-256 does not match`);
  if (kind === 'partner-validation' && !approval?.organizationId) blockers.push('partner-validation evidence requires an accountable partner organization');
  if (kind === 'release-attestation' && approval?.organizationId !== null) blockers.push('release-attestation evidence cannot impersonate a partner organization');
  if (!approval?.reviewerId || !validDate(approval?.reviewedAt)) blockers.push(`${kind} evidence requires an attributable reviewer`);
  if (!isCurrent(approval?.expiresAt, now)) blockers.push(`${kind} evidence is missing, invalid, or expired`);
  if (!approval?.artifactReference || !SHA256.test(approval?.artifactSha256 ?? '')) blockers.push(`${kind} requires a hash-bound external artifact`);
  return blockers;
}

export function validateProviderPackBundle({ pack, manifest, controls, partnerApproval, attestation, now = new Date(), schemaErrors = [], approvalSchemaErrors = [] }) {
  const errors = [
    ...schemaErrors,
    ...approvalSchemaErrors,
    ...validateProviderPackSemantics(pack, now),
    ...validateManifestShape(manifest),
    ...validateRolloutControls(controls),
  ];
  if (manifest?.packId !== pack?.packId || manifest?.packVersion !== pack?.version) errors.push('manifest identifies a different provider pack');
  if (manifest?.packSha256 !== canonicalSha256(pack)) errors.push('manifest pack SHA-256 does not match canonical pack bytes');
  if (manifest?.expiresAt !== pack?.expiresAt) errors.push('manifest and pack expiry must match');
  if (manifest?.status === 'approved' && pack?.status !== 'active') errors.push('approved manifest requires an active pack');
  if (manifest?.status === 'candidate' && pack?.status !== 'candidate') errors.push('candidate manifest requires a candidate pack');
  if (manifest?.attestation?.evidenceId !== attestation?.evidenceId || manifest?.partnerValidation?.evidenceId !== partnerApproval?.evidenceId) errors.push('manifest approval evidence IDs do not match');
  return [...new Set(errors)];
}

export function getProviderPackReleaseBlockers(bundle) {
  const { pack, manifest, controls, partnerApproval, attestation, now = new Date() } = bundle;
  const blockers = [...validateProviderPackBundle(bundle)];
  if (pack?.status !== 'active') blockers.push('provider pack status must be active');
  for (const provider of pack?.providers ?? []) {
    if (provider.status !== 'active') blockers.push(`provider ${provider.stableId} must be active`);
  }
  if (manifest?.status !== 'approved') blockers.push('provider pack manifest must be approved');
  if (manifest?.release?.status !== 'approved') blockers.push('manifest release decision must be approved');
  if (!REVISION.test(manifest?.release?.immutableRevision ?? '')) blockers.push('manifest release requires a full immutable revision');
  if ((manifest?.release?.rolloutPercent ?? 0) < 1) blockers.push('manifest release requires a staged rollout greater than zero');
  blockers.push(...approvalBlockers(partnerApproval, 'partner-validation', pack, now));
  blockers.push(...approvalBlockers(attestation, 'release-attestation', pack, now));
  if (partnerApproval?.reviewerId && partnerApproval.reviewerId === attestation?.reviewerId) blockers.push('partner validation and release attestation require distinct reviewers');
  if (manifest?.partnerValidation?.status !== 'approved' || manifest.partnerValidation.partnerId !== partnerApproval?.organizationId || manifest.partnerValidation.reviewerId !== partnerApproval?.reviewerId || manifest.partnerValidation.artifactSha256 !== partnerApproval?.artifactSha256) blockers.push('manifest partner validation does not bind the approved evidence');
  if (manifest?.attestation?.status !== 'approved' || manifest.attestation.reviewerId !== attestation?.reviewerId || manifest.attestation.artifactSha256 !== attestation?.artifactSha256) blockers.push('manifest attestation does not bind the approved evidence');
  if (controls?.activation?.status !== 'enabled') blockers.push('remote provider-pack distribution must be explicitly enabled');
  if (!REVISION.test(controls?.immutableRevision ?? '')) blockers.push('rollout controls require a full immutable revision');
  if ((controls?.rolloutPercent ?? 0) < 1 || controls?.rolloutPercent !== manifest?.release?.rolloutPercent) blockers.push('rollout controls must match the approved staged percentage');
  if (controls?.approvedPackId !== pack?.packId || controls?.approvedPackVersion !== pack?.version || controls?.approvedPackSha256 !== canonicalSha256(pack)) blockers.push('rollout controls do not bind the approved provider pack');
  if (controls?.approvedManifestSha256 !== canonicalSha256(manifest)) blockers.push('rollout controls do not bind the approved manifest');
  if (!validDate(controls?.validFrom) || !isCurrent(controls?.validUntil, now) || Date.parse(controls.validFrom) >= Date.parse(controls.validUntil)) blockers.push('rollout controls require a current validity window');
  return [...new Set(blockers)];
}
