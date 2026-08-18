import { query } from '../plugins/db.js';

export type DraftRow = {
  id: string;
  owner_id: string;
  payload: Record<string, unknown>;
  status: string;
  last_autosave: string | null;
  created_at: string;
  updated_at: string;
};

export async function listDrafts(ownerId: string): Promise<DraftRow[]> {
  const { rows } = await query<DraftRow>(
    `
      select *
      from saferide.drafts
      where owner_id = $1
      order by updated_at desc
    `,
    [ownerId],
  );
  return rows;
}

export async function getDraft(ownerId: string, draftId: string): Promise<DraftRow | null> {
  const { rows } = await query<DraftRow>(
    `
      select *
      from saferide.drafts
      where owner_id = $1 and id = $2
      limit 1
    `,
    [ownerId, draftId],
  );
  return rows[0] ?? null;
}

export async function upsertDraft(params: {
  ownerId: string;
  id: string;
  payload: Record<string, unknown>;
  status?: string;
  lastAutosave?: string | null;
}): Promise<DraftRow> {
  const { rows } = await query<DraftRow>(
    `
      insert into saferide.drafts (id, owner_id, payload, status, last_autosave)
      values ($1, $2, $3, coalesce($4::saferide.draft_status, 'draft'), $5)
      on conflict (id) do update
      set payload = excluded.payload,
          status = excluded.status,
          last_autosave = excluded.last_autosave,
          updated_at = now()
      where saferide.drafts.owner_id = excluded.owner_id
      returning *
    `,
    [params.id, params.ownerId, params.payload, params.status ?? 'draft', params.lastAutosave ?? null],
  );
  return rows[0];
}

export async function deleteDraft(ownerId: string, draftId: string): Promise<boolean> {
  const result = await query(
    `
      delete from saferide.drafts
      where owner_id = $1 and id = $2
    `,
    [ownerId, draftId],
  );
  return (result.rowCount ?? 0) > 0;
}
