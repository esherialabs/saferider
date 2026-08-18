import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };
  return {
    client,
    pool: { connect: vi.fn(async () => client) },
    query: vi.fn(),
  };
});

vi.mock('../../plugins/db.js', () => ({
  pool: db.pool,
  query: db.query,
}));

import { CaseSubmissionConflictError, submitCaseTransaction } from '../caseRepository.js';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const CONSENT_ID = '22222222-2222-4222-8222-222222222222';

const params = {
  ownerId: 'owner-a',
  draftId: 'draft-a',
  pathway: 'referral',
  summary: { schemaVersion: '1.0', workflow: { workflowType: 'referral' } },
  lifecyclePayload: { schemaVersion: '1.0', workflowType: 'referral', status: 'submitted' },
  consentRecordId: CONSENT_ID,
  consentPurpose: 'pathway_submission' as const,
  consentVersion: 'pathway-consent.v1',
  idempotencyKey: CONSENT_ID,
  requestId: 'safe-request-id',
  policyVersion: 'privacy-controls.2026-07-30.2',
};

describe('atomic case submission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('commits server-timed consent, case, event, draft, and minimized audit together', async () => {
    const caseRecord = {
      id: CASE_ID,
      owner_id: 'owner-a',
      draft_id: 'draft-a',
      pathway: 'referral',
      status: 'submitted',
      summary: params.summary,
      created_at: '2026-07-31T00:00:00.000Z',
      updated_at: '2026-07-31T00:00:00.000Z',
    };
    db.client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: CONSENT_ID }] })
      .mockResolvedValueOnce({ rows: [caseRecord] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});

    await expect(submitCaseTransaction(params)).resolves.toEqual(caseRecord);

    const statements = db.client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements[0]).toBe('begin');
    expect(statements[1]).toContain("values ($1, $2, $3, $4, 'granted', now())");
    expect(statements[2]).toContain('on conflict (owner_id, submission_idempotency_key)');
    expect(statements[2]).toContain('saferide.cases.summary = excluded.summary');
    expect(statements[3]).toContain("on conflict (case_id, event_type) where event_type = 'submission'");
    expect(statements[4]).toContain("set status = 'submitted'");
    expect(statements[5]).toContain("values ('case.create', 'case', $1, 'success', $2)");
    expect(statements[6]).toBe('commit');
    expect(db.client.release).toHaveBeenCalledOnce();
  });

  it('rolls back when a consent UUID belongs to a different identity or state', async () => {
    db.client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({});

    await expect(submitCaseTransaction(params)).rejects.toBeInstanceOf(CaseSubmissionConflictError);
    expect(db.client.query.mock.calls.map(([sql]) => String(sql))).toEqual([
      'begin',
      expect.stringContaining('insert into saferide.consent_records'),
      'rollback',
    ]);
    expect(db.client.release).toHaveBeenCalledOnce();
  });

  it('rolls back every earlier write when case insertion fails', async () => {
    db.client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: CONSENT_ID }] })
      .mockRejectedValueOnce(new Error('synthetic database failure'))
      .mockResolvedValueOnce({});

    await expect(submitCaseTransaction(params)).rejects.toThrow('synthetic database failure');
    expect(db.client.query.mock.calls.at(-1)?.[0]).toBe('rollback');
    expect(db.client.release).toHaveBeenCalledOnce();
  });
});
