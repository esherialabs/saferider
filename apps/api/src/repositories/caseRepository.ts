import { pool, query } from '../plugins/db.js';

export type CaseRow = {
  id: string;
  owner_id: string;
  draft_id: string | null;
  pathway: string | null;
  status: string;
  summary: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type AttachmentRow = {
  id: string;
  owner_id: string;
  draft_id: string | null;
  case_id: string | null;
  bucket: string;
  bucket_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  expected_sha256: string | null;
  upload_manifest: Record<string, unknown>;
  retention: Record<string, unknown>;
  retention_policy_id: string | null;
  antivirus_status: string;
  quarantine_status: string;
  scan_evidence: Record<string, unknown> | null;
  status: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type CaseEventRow = {
  id: string;
  case_id: string;
  owner_id: string | null;
  event_type: string;
  payload: Record<string, unknown> | null;
  request_id: string | null;
  created_at: string;
};

export class CaseSubmissionConflictError extends Error {
  constructor() {
    super('Case submission idempotency or consent identity conflicts with an existing record');
    this.name = 'CaseSubmissionConflictError';
  }
}

export async function submitCaseTransaction(params: {
  ownerId: string;
  draftId?: string | null;
  pathway: string;
  summary: Record<string, unknown>;
  lifecyclePayload: Record<string, unknown>;
  consentRecordId: string;
  consentPurpose: 'pathway_submission';
  consentVersion: string;
  idempotencyKey: string;
  requestId: string;
  policyVersion: string;
}): Promise<CaseRow> {
  const client = await pool.connect();
  try {
    await client.query('begin');

    const consent = await client.query<{ id: string }>(
      `
        insert into saferide.consent_records (
          id, owner_id, purpose, consent_version, status, granted_at
        ) values ($1, $2, $3, $4, 'granted', now())
        on conflict (id) do update
          set id = excluded.id
          where saferide.consent_records.owner_id = excluded.owner_id
            and saferide.consent_records.purpose = excluded.purpose
            and saferide.consent_records.consent_version = excluded.consent_version
            and saferide.consent_records.status = 'granted'
        returning id
      `,
      [params.consentRecordId, params.ownerId, params.consentPurpose, params.consentVersion],
    );
    if (consent.rows.length !== 1) throw new CaseSubmissionConflictError();

    const submitted = await client.query<CaseRow>(
      `
        insert into saferide.cases (
          owner_id, draft_id, pathway, summary, consent_record_id, submission_idempotency_key
        )
        select
          $1,
          owned_draft.id,
          $3, $4, $5, $6
        from (select $2::text as requested_id) input
        left join saferide.drafts owned_draft
          on owned_draft.owner_id = $1 and owned_draft.id = input.requested_id
        where input.requested_id is null or owned_draft.id is not null
        on conflict (owner_id, submission_idempotency_key) where submission_idempotency_key is not null
        do update set submission_idempotency_key = excluded.submission_idempotency_key
          where saferide.cases.draft_id is not distinct from excluded.draft_id
            and saferide.cases.pathway is not distinct from excluded.pathway
            and saferide.cases.summary = excluded.summary
            and saferide.cases.consent_record_id = excluded.consent_record_id
        returning *
      `,
      [
        params.ownerId,
        params.draftId ?? null,
        params.pathway,
        params.summary,
        params.consentRecordId,
        params.idempotencyKey,
      ],
    );
    const caseRecord = submitted.rows[0];
    if (!caseRecord) throw new CaseSubmissionConflictError();

    await client.query(
      `
        insert into saferide.case_events (case_id, owner_id, event_type, payload, request_id)
        values ($1, $2, 'submission', $3, $4)
        on conflict (case_id, event_type) where event_type = 'submission' do nothing
      `,
      [caseRecord.id, params.ownerId, params.lifecyclePayload, params.requestId],
    );

    if (params.draftId) {
      await client.query(
        `
          update saferide.drafts
          set status = 'submitted', updated_at = now()
          where owner_id = $1 and id = $2
        `,
        [params.ownerId, params.draftId],
      );
    }

    await client.query(
      `
        insert into saferide.audit_events (
          action, resource_type, request_id, outcome, policy_version
        ) values ('case.create', 'case', $1, 'success', $2)
      `,
      [params.requestId, params.policyVersion],
    );

    await client.query('commit');
    return caseRecord;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function listCases(ownerId: string): Promise<CaseRow[]> {
  const { rows } = await query<CaseRow>(
    `
      select *
      from saferide.cases
      where owner_id = $1
      order by created_at desc
    `,
    [ownerId],
  );
  return rows;
}

export async function createCase(params: {
  ownerId: string;
  draftId?: string | null;
  pathway?: string | null;
  summary?: Record<string, unknown> | null;
}): Promise<CaseRow> {
  const { rows } = await query<CaseRow>(
    `
      insert into saferide.cases (owner_id, draft_id, pathway, summary)
      values (
        $1,
        (select id from saferide.drafts where owner_id = $1 and id = $2),
        $3,
        $4
      )
      returning *
    `,
    [params.ownerId, params.draftId ?? null, params.pathway ?? null, params.summary ?? null],
  );
  return rows[0];
}

export async function getCase(ownerId: string, caseId: string): Promise<CaseRow | null> {
  const { rows } = await query<CaseRow>(
    `
      select *
      from saferide.cases
      where owner_id = $1 and id = $2
      limit 1
    `,
    [ownerId, caseId],
  );
  return rows[0] ?? null;
}

export async function markDraftSubmitted(ownerId: string, draftId?: string | null): Promise<void> {
  if (!draftId) return;
  await query(
    `
      update saferide.drafts
      set status = 'submitted',
          updated_at = now()
      where owner_id = $1 and id = $2
    `,
    [ownerId, draftId],
  );
}

export async function createCaseEvent(params: {
  ownerId: string;
  caseId: string;
  eventType: string;
  payload?: Record<string, unknown> | null;
  requestId?: string | null;
}): Promise<CaseEventRow> {
  const { rows } = await query<CaseEventRow>(
    `
      insert into saferide.case_events (case_id, owner_id, event_type, payload, request_id)
      values ($1, $2, $3, $4, $5)
      returning *
    `,
    [params.caseId, params.ownerId, params.eventType, params.payload ?? null, params.requestId ?? null],
  );
  return rows[0];
}

export async function listCaseEvents(ownerId: string, caseId: string): Promise<CaseEventRow[]> {
  const { rows } = await query<CaseEventRow>(
    `
      select event.*
      from saferide.case_events event
      join saferide.cases case_record on case_record.id = event.case_id
      where case_record.owner_id = $1 and event.case_id = $2
      order by event.created_at asc
    `,
    [ownerId, caseId],
  );
  return rows;
}

export async function listAttachments(ownerId: string, caseId: string): Promise<AttachmentRow[]> {
  const { rows } = await query<AttachmentRow>(
    `
      select *
      from saferide.attachments
      where owner_id = $1 and case_id = $2
      order by created_at asc
    `,
    [ownerId, caseId],
  );
  return rows;
}

export async function createPendingAttachment(params: {
  ownerId: string;
  caseId: string;
  draftId?: string | null;
  bucket: string;
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  expectedSha256?: string | null;
  uploadManifest: Record<string, unknown>;
  retentionPolicyId: string;
  metadata?: Record<string, unknown> | null;
}): Promise<AttachmentRow> {
  const { rows } = await query<AttachmentRow>(
    `
      insert into saferide.attachments (
        owner_id, case_id, draft_id, bucket, bucket_path, mime_type, size_bytes,
        expected_sha256, upload_manifest, retention, retention_policy_id,
        quarantine_status, antivirus_status, metadata
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{}'::jsonb, $10,
        'quarantined', 'not_scanned', $11)
      returning *
    `,
    [
      params.ownerId,
      params.caseId,
      params.draftId ?? null,
      params.bucket,
      params.objectKey,
      params.mimeType,
      params.sizeBytes,
      params.expectedSha256 ?? null,
      params.uploadManifest,
      params.retentionPolicyId,
      params.metadata ?? null,
    ],
  );
  return rows[0];
}

export async function completeAttachment(params: {
  ownerId: string;
  attachmentId: string;
  sha256: string;
  sizeBytes: number;
  status: 'uploaded' | 'hash_mismatch' | 'rejected';
}): Promise<AttachmentRow | null> {
  const { rows } = await query<AttachmentRow>(
    `
      update saferide.attachments
      set sha256 = $3,
          size_bytes = $4,
          status = $5,
          antivirus_status = case when $5 = 'uploaded' then 'pending' else 'not_scanned' end,
          quarantine_status = case when $5 = 'uploaded' then 'quarantined' else 'rejected' end,
          updated_at = now()
      where owner_id = $1 and id = $2
      returning *
    `,
    [params.ownerId, params.attachmentId, params.sha256, params.sizeBytes, params.status],
  );
  return rows[0] ?? null;
}

export async function recordAttachmentMalwareScan(params: {
  ownerId: string;
  attachmentId: string;
  result: 'clean' | 'rejected';
  objectSha256: string;
  scanEvidence: Record<string, unknown>;
}): Promise<AttachmentRow | null> {
  const { rows } = await query<AttachmentRow>(
    `
      update saferide.attachments
      set antivirus_status = $3,
          quarantine_status = case when $3 = 'clean' then 'released' else 'rejected' end,
          scan_evidence = $4,
          updated_at = now()
      where owner_id = $1 and id = $2 and status = 'uploaded' and sha256 = $5
      returning *
    `,
    [params.ownerId, params.attachmentId, params.result, params.scanEvidence, params.objectSha256],
  );
  return rows[0] ?? null;
}
