import { query } from '../plugins/db.js';
import type { DsarRequestType } from '../services/privacyLifecycle.js';

export type DsarRequestRow = {
  id: string;
  owner_id: string;
  request_type: DsarRequestType;
  status: string;
  request_idempotency_key: string;
  due_at: string;
  sanitized_receipt: Record<string, unknown> | null;
  evidence_sha256: string | null;
  created_at: string;
  updated_at: string;
};

export async function createDsarRequest(params: {
  ownerId: string;
  requestType: DsarRequestType;
  idempotencyKey: string;
  dueAt: Date;
}): Promise<DsarRequestRow | null> {
  const { rows } = await query<DsarRequestRow>(
    `
      insert into saferide.dsar_requests (
        owner_id, request_type, status, request_idempotency_key, due_at
      ) values ($1, $2, 'requested', $3, $4)
      on conflict (owner_id, request_idempotency_key) do update
        set request_idempotency_key = excluded.request_idempotency_key
        where saferide.dsar_requests.request_type = excluded.request_type
      returning *
    `,
    [params.ownerId, params.requestType, params.idempotencyKey, params.dueAt],
  );
  return rows[0] ?? null;
}

export async function listDsarRequests(ownerId: string): Promise<DsarRequestRow[]> {
  const { rows } = await query<DsarRequestRow>(
    `select * from saferide.dsar_requests where owner_id = $1 order by created_at desc`,
    [ownerId],
  );
  return rows;
}

export async function createConsentRecord(params: {
  ownerId: string;
  purpose: string;
  consentVersion: string;
  grantedAt: Date;
}): Promise<Record<string, unknown>> {
  const { rows } = await query<Record<string, unknown>>(
    `
      insert into saferide.consent_records (
        owner_id, purpose, consent_version, status, granted_at
      ) values ($1, $2, $3, 'granted', $4)
      returning id, purpose, consent_version, status, granted_at, withdrawn_at,
        external_sharing_warning_acknowledged, created_at
    `,
    [params.ownerId, params.purpose, params.consentVersion, params.grantedAt],
  );
  return rows[0];
}

export async function listConsentHistory(ownerId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await query<Record<string, unknown>>(
    `
      select id, purpose, consent_version, status, granted_at, withdrawn_at,
        external_sharing_warning_acknowledged, created_at
      from saferide.consent_records
      where owner_id = $1
      order by created_at desc
    `,
    [ownerId],
  );
  return rows;
}

export async function hasActiveConsent(params: {
  ownerId: string;
  purpose: string;
  consentVersion: string;
}): Promise<boolean> {
  const { rows } = await query<{ exists: boolean }>(
    `
      select exists (
        select 1 from saferide.consent_records
        where owner_id = $1 and purpose = $2 and consent_version = $3 and status = 'granted'
      ) as exists
    `,
    [params.ownerId, params.purpose, params.consentVersion],
  );
  return rows[0]?.exists === true;
}

export async function withdrawConsent(params: {
  ownerId: string;
  consentId: string;
  withdrawnAt: Date;
}): Promise<Record<string, unknown> | null> {
  const { rows } = await query<Record<string, unknown>>(
    `
      update saferide.consent_records
      set status = 'withdrawn', withdrawn_at = coalesce(withdrawn_at, $3),
          external_sharing_warning_acknowledged = true
      where owner_id = $1 and id = $2
      returning id, purpose, consent_version, status, granted_at, withdrawn_at,
        external_sharing_warning_acknowledged, created_at
    `,
    [params.ownerId, params.consentId, params.withdrawnAt],
  );
  return rows[0] ?? null;
}

export async function createPolicyAcceptance(params: {
  ownerId: string;
  documentType: string;
  documentVersion: string;
  locale: string;
  contentSha256: string;
  acceptedAt: Date;
}): Promise<Record<string, unknown>> {
  const { rows } = await query<Record<string, unknown>>(
    `
      insert into saferide.policy_acceptances (
        owner_id, document_type, document_version, locale, content_sha256, accepted_at
      ) values ($1, $2, $3, $4, $5, $6)
      returning id, document_type, document_version, locale, content_sha256,
        accepted_at, withdrawn_at, withdrawal_effect
    `,
    [params.ownerId, params.documentType, params.documentVersion, params.locale, params.contentSha256, params.acceptedAt],
  );
  return rows[0];
}

export async function listPolicyAcceptances(ownerId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await query<Record<string, unknown>>(
    `
      select id, document_type, document_version, locale, content_sha256,
        accepted_at, withdrawn_at, withdrawal_effect
      from saferide.policy_acceptances
      where owner_id = $1
      order by accepted_at desc
    `,
    [ownerId],
  );
  return rows;
}
