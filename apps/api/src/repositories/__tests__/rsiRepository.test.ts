import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MinimizedRsiSignal } from '../../services/rsiSignalService.js';
import {
  getPublicRsiRelease,
  publishDraftRsiRelease,
  revokePublishedRsiRelease,
  submitAnonymousRsiSignalsWithConsent,
} from '../rsiRepository.js';

const db = vi.hoisted(() => ({
  query: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
  connect: vi.fn(),
}));

vi.mock('../../plugins/db.js', () => ({
  query: db.query,
  pool: { connect: db.connect },
}));

function signal(category: string): MinimizedRsiSignal {
  return {
    areaId: 'cell-100-100', areaType: 'coarse_cell', areaDefinitionVersion: 'synthetic-area-v1',
    timeBucket: new Date('2026-07-30T10:00:00.000Z'), timeBucketMinutes: 60, category,
    configVersion: 'synthetic-control-v1', policyVersion: 'synthetic-control-v1',
    consentVersion: 'synthetic-consent-v1', expiresAt: new Date('2026-08-06T00:00:00.000Z'),
  };
}

const submission = {
  ownerId: '11111111-1111-4111-8111-111111111111',
  consentRecordId: '22222222-2222-4222-8222-222222222222',
  consentVersion: 'synthetic-consent-v1',
  ingestionId: '33333333-3333-4333-8333-333333333333',
};

describe('RSI repository privacy boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.connect.mockResolvedValue({ query: db.clientQuery, release: db.release });
  });

  it('commits consent and a complete minimized batch in one transaction without storing an owner on signals', async () => {
    db.clientQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});
    await expect(submitAnonymousRsiSignalsWithConsent({
      ...submission,
      signals: [signal('harassment'), signal('unsafe_driving')],
    })).resolves.toEqual({ status: 'accepted', replayed: false });
    const insertCalls = db.clientQuery.mock.calls.filter(call => String(call[0]).includes('anonymous_route_signals'));
    expect(insertCalls).toHaveLength(3);
    expect(insertCalls.every(call => !String(call[0]).includes('owner_id'))).toBe(true);
    expect(String(db.clientQuery.mock.calls[3][0])).toContain('consent_records');
    expect(db.clientQuery).toHaveBeenLastCalledWith('commit');
    expect(db.release).toHaveBeenCalledOnce();
  });

  it('rolls back both consent and every signal when one approved area definition is unavailable', async () => {
    db.clientQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({});
    await expect(submitAnonymousRsiSignalsWithConsent({
      ...submission,
      signals: [signal('harassment'), signal('unsafe_driving')],
    })).resolves.toEqual({ status: 'area_unavailable' });
    expect(db.clientQuery).toHaveBeenLastCalledWith('rollback');
    expect(db.clientQuery.mock.calls.some(call => call[0] === 'commit')).toBe(false);
    expect(db.release).toHaveBeenCalledOnce();
  });

  it('replays an identical ingestion without creating another consent or signal', async () => {
    const existing = [signal('harassment'), signal('unsafe_driving')].map(item => ({
      area_id: item.areaId,
      area_type: item.areaType,
      area_definition_version: item.areaDefinitionVersion,
      time_bucket: item.timeBucket,
      time_bucket_minutes: item.timeBucketMinutes,
      category: item.category,
      config_version: item.configVersion,
      policy_version: item.policyVersion,
      consent_version: item.consentVersion,
    }));
    db.clientQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: existing })
      .mockResolvedValueOnce({});
    await expect(submitAnonymousRsiSignalsWithConsent({
      ...submission,
      signals: [signal('harassment'), signal('unsafe_driving')],
    })).resolves.toEqual({ status: 'accepted', replayed: true });
    expect(db.clientQuery.mock.calls.map(call => String(call[0]))).toEqual([
      'begin', expect.stringContaining('where ingestion_id = $1'), 'rollback',
    ]);
  });

  it('rejects reuse of an ingestion identifier for different minimized dimensions', async () => {
    const item = signal('harassment');
    db.clientQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{
        area_id: item.areaId,
        area_type: item.areaType,
        area_definition_version: item.areaDefinitionVersion,
        time_bucket: item.timeBucket,
        time_bucket_minutes: item.timeBucketMinutes,
        category: 'different_category',
        config_version: item.configVersion,
        policy_version: item.policyVersion,
        consent_version: item.consentVersion,
      }] })
      .mockResolvedValueOnce({});
    await expect(submitAnonymousRsiSignalsWithConsent({
      ...submission,
      signals: [item],
    })).resolves.toEqual({ status: 'idempotency_conflict' });
  });

  it('rejects a consent UUID owned by a different account or in a withdrawn state', async () => {
    db.clientQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        owner_id: 'different-owner',
        purpose: 'anonymous_aggregate',
        consent_version: submission.consentVersion,
        status: 'withdrawn',
      }] })
      .mockResolvedValueOnce({});
    await expect(submitAnonymousRsiSignalsWithConsent({
      ...submission,
      signals: [signal('harassment')],
    })).resolves.toEqual({ status: 'consent_conflict' });
    expect(db.clientQuery).toHaveBeenLastCalledWith('rollback');
  });

  it('maps only the minimized public view and never returns counts, noise, or suppression reasons', async () => {
    db.query.mockResolvedValue({
      rows: [{
        release_id: '11111111-1111-4111-8111-111111111111', view_id: 'rsi-fixed-grid-v1',
        dp_status: 'not_approved', immutable_revision_sha256: 'a'.repeat(64), area_id: 'cell-100-100',
        time_bucket: '2026-07-30T10:00:00.000Z', category: 'harassment', state: 'suppressed', released_value: null,
      }],
    });
    const release = await getPublicRsiRelease('11111111-1111-4111-8111-111111111111', 500);
    expect(release?.cells[0]).toEqual({
      areaId: 'cell-100-100', timeBucket: '2026-07-30T10:00:00.000Z', category: 'harassment',
      state: 'suppressed', display: 'No data',
    });
    expect(JSON.stringify(release)).not.toMatch(/raw|noise|reason/i);
    expect(String(db.query.mock.calls[0][0])).toContain('saferide.rsi_public_release_cells');
  });

  it('publishes only with DP budget/noise consistency and supports explicit release revocation', async () => {
    db.query.mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 1 });
    await expect(publishDraftRsiRelease({
      releaseId: '11111111-1111-4111-8111-111111111111', revisionSha256: 'a'.repeat(64),
      publishedAt: new Date('2026-07-30T12:00:00.000Z'),
    })).resolves.toBe(true);
    const publishSql = String(db.query.mock.calls[0][0]);
    expect(publishSql).toContain('privacy_budget_ledger');
    expect(publishSql).toContain('memoized_noise is null');
    expect(publishSql).toContain('memoized_noise is not null');

    await expect(revokePublishedRsiRelease({
      releaseId: '11111111-1111-4111-8111-111111111111',
      revokedAt: new Date('2026-07-30T13:00:00.000Z'),
    })).resolves.toBe(true);
    expect(String(db.query.mock.calls[1][0])).toContain("status = 'revoked'");
  });
});
