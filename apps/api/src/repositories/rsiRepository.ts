import { createHash } from 'node:crypto';

import { pool, query } from '../plugins/db.js';
import type {
  PublicRsiCell,
  RsiAggregateCellInput,
  RsiRelease,
  RsiSuppressionDecision,
} from '../services/privacySuppressionService.js';
import type { MinimizedRsiSignal } from '../services/rsiSignalService.js';

export type PublicRsiReleaseRow = {
  release_id: string;
  view_id: string;
  dp_status: 'not_approved' | 'approved';
  immutable_revision_sha256: string;
  area_id: string;
  time_bucket: string;
  category: string;
  state: 'suppressed' | 'released';
  released_value: string | number | null;
};

export type AnonymousRsiSubmissionResult =
  | { status: 'accepted'; replayed: boolean }
  | { status: 'area_unavailable' | 'consent_conflict' | 'idempotency_conflict' };

type ExistingAnonymousSignal = {
  area_id: string;
  area_type: 'coarse_cell' | 'corridor';
  area_definition_version: string;
  time_bucket: Date | string;
  time_bucket_minutes: number;
  category: string;
  config_version: string;
  policy_version: string;
  consent_version: string;
};

function stableSignalKey(signal: MinimizedRsiSignal): string {
  return [
    signal.areaId,
    signal.areaType,
    signal.areaDefinitionVersion,
    signal.timeBucket.toISOString(),
    signal.timeBucketMinutes,
    signal.category,
    signal.configVersion,
    signal.policyVersion,
    signal.consentVersion,
  ].join('|');
}

function stableExistingSignalKey(signal: ExistingAnonymousSignal): string {
  return [
    signal.area_id,
    signal.area_type,
    signal.area_definition_version,
    new Date(signal.time_bucket).toISOString(),
    signal.time_bucket_minutes,
    signal.category,
    signal.config_version,
    signal.policy_version,
    signal.consent_version,
  ].join('|');
}

export async function submitAnonymousRsiSignalsWithConsent(params: {
  ownerId: string;
  consentRecordId: string;
  consentVersion: string;
  ingestionId: string;
  signals: MinimizedRsiSignal[];
}): Promise<AnonymousRsiSubmissionResult> {
  if (params.signals.length < 1 || params.signals.length > 8) {
    throw new Error('RSI signal batch size is invalid');
  }
  const client = await pool.connect();
  try {
    await client.query('begin');
    const existing = await client.query<ExistingAnonymousSignal>(
      `select area_id, area_type, area_definition_version, time_bucket, time_bucket_minutes,
         category, config_version, policy_version, consent_version
       from saferide.anonymous_route_signals
       where ingestion_id = $1
       order by area_id, time_bucket, category`,
      [params.ingestionId],
    );
    if (existing.rows.length > 0) {
      const expected = params.signals.map(stableSignalKey).sort();
      const stored = existing.rows.map(stableExistingSignalKey).sort();
      await client.query('rollback');
      if (expected.length !== stored.length || expected.some((value, index) => value !== stored[index])) {
        return { status: 'idempotency_conflict' };
      }
      return { status: 'accepted', replayed: true };
    }

    const consent = await client.query<{
      owner_id: string;
      purpose: string;
      consent_version: string;
      status: string;
    }>(
      `select owner_id, purpose, consent_version, status
       from saferide.consent_records where id = $1 for update`,
      [params.consentRecordId],
    );
    if (consent.rows.length > 0) {
      const record = consent.rows[0];
      if (
        record.owner_id !== params.ownerId ||
        record.purpose !== 'anonymous_aggregate' ||
        record.consent_version !== params.consentVersion ||
        record.status !== 'granted'
      ) {
        await client.query('rollback');
        return { status: 'consent_conflict' };
      }
    } else {
      await client.query(
        `insert into saferide.consent_records
          (id, owner_id, purpose, consent_version, status, granted_at)
         values ($1, $2, 'anonymous_aggregate', $3, 'granted', now())`,
        [params.consentRecordId, params.ownerId, params.consentVersion],
      );
    }

    for (const signal of params.signals) {
      const inserted = await client.query(
        `insert into saferide.anonymous_route_signals (
           ingestion_id, area_id, area_type, area_definition_version, time_bucket,
           time_bucket_minutes, category, config_version, policy_version, consent_version, expires_at
         )
         select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
         from saferide.corridor_definitions definition
         where definition.area_id = $2
           and definition.definition_version = $4
           and definition.area_type = $3
           and definition.approval_status = 'approved'
           and definition.expires_at > now()
         returning id`,
        [
          params.ingestionId, signal.areaId, signal.areaType, signal.areaDefinitionVersion,
          signal.timeBucket, signal.timeBucketMinutes, signal.category, signal.configVersion,
          signal.policyVersion, signal.consentVersion, signal.expiresAt,
        ],
      );
      if (inserted.rowCount !== 1) {
        await client.query('rollback');
        return { status: 'area_unavailable' };
      }
    }
    await client.query('commit');
    return { status: 'accepted', replayed: false };
  } catch (error) {
    await client.query('rollback');
    if ((error as { code?: string }).code === '23505') return { status: 'idempotency_conflict' };
    throw error;
  } finally {
    client.release();
  }
}

type MinimizedSignalRow = {
  area_id: string;
  area_type: 'coarse_cell' | 'corridor';
  area_definition_version: string;
  time_bucket: string;
  time_bucket_minutes: number;
  category: string;
  config_version: string;
  policy_version: string;
  consent_version: string;
  expires_at: string;
};

export async function listMinimizedRsiSignalsForWindow(params: {
  configVersion: string;
  windowStart: Date;
  windowEnd: Date;
}): Promise<MinimizedRsiSignal[]> {
  const { rows } = await query<MinimizedSignalRow>(
    `
      select area_id, area_type, area_definition_version, time_bucket, time_bucket_minutes,
        category, config_version, policy_version, consent_version, expires_at
      from saferide.anonymous_route_signals
      where config_version = $1 and time_bucket >= $2 and time_bucket < $3 and expires_at > now()
      order by area_id, time_bucket, category
    `,
    [params.configVersion, params.windowStart, params.windowEnd],
  );
  return rows.map(row => ({
    areaId: row.area_id,
    areaType: row.area_type,
    areaDefinitionVersion: row.area_definition_version,
    timeBucket: new Date(row.time_bucket),
    timeBucketMinutes: row.time_bucket_minutes,
    category: row.category,
    configVersion: row.config_version,
    policyVersion: row.policy_version,
    consentVersion: row.consent_version,
    expiresAt: new Date(row.expires_at),
  }));
}

export async function deleteExpiredAnonymousRsiSignals(now: Date): Promise<number> {
  const { rowCount } = await query(
    `delete from saferide.anonymous_route_signals where expires_at <= $1`,
    [now],
  );
  return rowCount ?? 0;
}

export async function createDraftRsiReleaseWindow(params: {
  releaseId: string;
  viewId: string;
  controlVersion: string;
  approvalId: string;
  areaDefinitionVersion: string;
  windowStart: Date;
  windowEnd: Date;
  releaseCadenceHours: number;
  adjacentWindowStatus: 'initial' | 'continuous';
  minimumCount: number;
  differentialPrivacy: null | Record<string, unknown>;
}): Promise<boolean> {
  const { rowCount } = await query(
    `
      insert into saferide.aggregate_release_windows (
        id, view_id, control_version, approval_id, area_definition_version,
        window_start, window_end, release_cadence_hours, minimum_count, dp_status,
        dp_parameters, adjacent_window_status
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      on conflict (id) do nothing
    `,
    [
      params.releaseId, params.viewId, params.controlVersion, params.approvalId,
      params.areaDefinitionVersion, params.windowStart, params.windowEnd,
      params.releaseCadenceHours, params.minimumCount,
      params.differentialPrivacy ? 'approved' : 'not_approved', params.differentialPrivacy,
      params.adjacentWindowStatus,
    ],
  );
  return rowCount === 1;
}

export async function recordRsiPrivacyBudget(params: {
  releaseId: string;
  epsilon: number;
  delta: number;
  sensitivity: number;
  clipping: number;
  composition: string;
  releaseCadenceHours: number;
  noiseSeedCommitmentSha256: string;
}): Promise<void> {
  await query(
    `insert into saferide.privacy_budget_ledger
      (release_id, epsilon, delta, sensitivity, clipping, composition, release_cadence_hours, noise_seed_commitment_sha256)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      params.releaseId, params.epsilon, params.delta, params.sensitivity, params.clipping,
      params.composition, params.releaseCadenceHours, params.noiseSeedCommitmentSha256,
    ],
  );
}

export async function getPublicRsiRelease(releaseId: string, maxRows: number): Promise<{
  revisionSha256: string;
  viewId: string;
  cells: PublicRsiCell[];
} | null> {
  const { rows } = await query<PublicRsiReleaseRow>(
    `
      select release_id, view_id, dp_status, immutable_revision_sha256, area_id, time_bucket,
        category, state, released_value
      from saferide.rsi_public_release_cells
      where release_id = $1
      order by area_id, time_bucket, category
      limit $2
    `,
    [releaseId, maxRows + 1],
  );
  if (rows.length === 0 || rows.length > maxRows) return null;
  return {
    revisionSha256: rows[0].immutable_revision_sha256,
    viewId: rows[0].view_id,
    cells: rows.map(row => {
      const dimensions = { areaId: row.area_id, timeBucket: new Date(row.time_bucket).toISOString(), category: row.category };
      if (row.state === 'suppressed') {
        return { ...dimensions, state: 'suppressed', display: 'No data' };
      }
      return { ...dimensions, state: 'released', value: Number(row.released_value), noiseMemoized: row.dp_status === 'approved' };
    }),
  };
}

export async function recordRsiOperatorAccess(params: {
  actorFingerprint: string;
  requestId: string;
  action: 'rsi.release.read' | 'rsi.release.export';
  releaseId: string;
  outcome: 'success' | 'denied' | 'failed';
  policyVersion: string;
}): Promise<void> {
  await query(
    `insert into saferide.operator_access_audit
      (actor_fingerprint, request_id, action, release_id, outcome, policy_version)
     values ($1, $2, $3, $4, $5, $6)`,
    [params.actorFingerprint, params.requestId, params.action, params.releaseId, params.outcome, params.policyVersion],
  );
}

function inputKey(cell: Pick<RsiAggregateCellInput, 'areaId' | 'timeBucket' | 'category'>): string {
  return `${cell.areaId}|${cell.timeBucket}|${cell.category}`;
}

export async function replaceDraftRsiReleaseCells(params: {
  release: RsiRelease;
  inputs: RsiAggregateCellInput[];
  decisions: RsiSuppressionDecision[];
}): Promise<void> {
  const inputMap = new Map(params.inputs.map(input => [inputKey(input), input]));
  const decisionMap = new Map(params.decisions.map(decision => [inputKey(decision), decision.reasons]));
  const client = await pool.connect();
  try {
    await client.query('begin');
    const locked = await client.query<{ status: string }>(
      `select status from saferide.aggregate_release_windows where id = $1 for update`,
      [params.release.releaseId],
    );
    if (locked.rows[0]?.status !== 'draft') throw new Error('Only draft RSI releases can be replaced');
    await client.query(`delete from saferide.rsi_aggregate_cells where release_id = $1`, [params.release.releaseId]);
    await client.query(`delete from saferide.suppression_decisions where release_id = $1`, [params.release.releaseId]);
    for (const cell of params.release.cells) {
      const input = inputMap.get(inputKey(cell));
      if (!input) throw new Error('RSI release cell is not bound to an aggregate input');
      const releasedValue = cell.state === 'released' ? cell.value : null;
      const noise = input.memoizedNoise?.value ?? null;
      const reasons = decisionMap.get(inputKey(cell)) ?? [];
      await client.query(
        `insert into saferide.rsi_aggregate_cells
          (release_id, area_id, time_bucket, category, state, suppression_reasons, raw_count,
           previous_raw_count, released_value, memoized_noise)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          params.release.releaseId, cell.areaId, cell.timeBucket, cell.category, cell.state,
          reasons, input.rawCount, input.previousRawCount ?? null, releasedValue, noise,
        ],
      );
      if (cell.state === 'suppressed') {
        const cellHash = createHash('sha256').update(inputKey(cell)).digest('hex');
        for (const reason of reasons) {
          await client.query(
            `insert into saferide.suppression_decisions (release_id, cell_key_sha256, reason)
             values ($1, $2, $3) on conflict do nothing`,
            [params.release.releaseId, cellHash, reason],
          );
        }
      }
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function publishDraftRsiRelease(params: {
  releaseId: string;
  revisionSha256: string;
  publishedAt: Date;
}): Promise<boolean> {
  const { rowCount } = await query(
    `
      update saferide.aggregate_release_windows release
      set status = 'published', immutable_revision_sha256 = $2, published_at = $3
      where release.id = $1 and release.status = 'draft'
        and exists (select 1 from saferide.rsi_aggregate_cells cell where cell.release_id = $1)
        and (
          release.dp_status = 'not_approved' or (
            exists (select 1 from saferide.privacy_budget_ledger budget where budget.release_id = $1) and
            not exists (
              select 1 from saferide.rsi_aggregate_cells cell
              where cell.release_id = $1 and cell.memoized_noise is null
            )
          )
        )
        and (
          release.dp_status = 'approved' or not exists (
            select 1 from saferide.rsi_aggregate_cells cell
            where cell.release_id = $1 and cell.memoized_noise is not null
          )
        )
        and (
          (release.adjacent_window_status = 'initial' and not exists (
            select 1 from saferide.rsi_aggregate_cells cell
            where cell.release_id = $1 and cell.previous_raw_count is not null
          )) or
          (release.adjacent_window_status = 'continuous' and not exists (
            select 1 from saferide.rsi_aggregate_cells cell
            where cell.release_id = $1 and cell.previous_raw_count is null
          ))
        )
    `,
    [params.releaseId, params.revisionSha256, params.publishedAt],
  );
  return rowCount === 1;
}

export async function revokePublishedRsiRelease(params: {
  releaseId: string;
  revokedAt: Date;
}): Promise<boolean> {
  const { rowCount } = await query(
    `update saferide.aggregate_release_windows
     set status = 'revoked', revoked_at = $2
     where id = $1 and status = 'published'`,
    [params.releaseId, params.revokedAt],
  );
  return rowCount === 1;
}
