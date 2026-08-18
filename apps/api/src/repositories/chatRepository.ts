import { query } from '../plugins/db.js';

export type ChatSessionRow = {
  id: string;
  owner_id: string;
  mode: string | null;
  created_at: string;
  last_activity: string;
};

export type ChatMessageRow = {
  id: string;
  session_id: string;
  owner_id: string | null;
  role: string;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export async function getOrCreateSession(ownerId: string, mode = 'legal-aid'): Promise<ChatSessionRow> {
  const existing = await query<ChatSessionRow>(
    `
      select *
      from saferide.chat_sessions
      where owner_id = $1 and mode is not distinct from $2
      order by last_activity desc
      limit 1
    `,
    [ownerId, mode],
  );

  if (existing.rows[0]) return existing.rows[0];

  const created = await query<ChatSessionRow>(
    `
      insert into saferide.chat_sessions (owner_id, mode)
      values ($1, $2)
      returning *
    `,
    [ownerId, mode],
  );
  return created.rows[0];
}

export async function createSession(ownerId: string, mode = 'legal-aid'): Promise<ChatSessionRow> {
  const { rows } = await query<ChatSessionRow>(
    `
      insert into saferide.chat_sessions (owner_id, mode)
      values ($1, $2)
      returning *
    `,
    [ownerId, mode],
  );
  return rows[0];
}

export async function listSessions(ownerId: string): Promise<ChatSessionRow[]> {
  const { rows } = await query<ChatSessionRow>(
    `
      select *
      from saferide.chat_sessions
      where owner_id = $1
      order by last_activity desc
    `,
    [ownerId],
  );
  return rows;
}

export async function isChatSessionOwnedBy(ownerId: string, sessionId: string): Promise<boolean> {
  const { rows } = await query<{ id: string }>(
    `
      select id
      from saferide.chat_sessions
      where id = $1 and owner_id = $2
      limit 1
    `,
    [sessionId, ownerId],
  );
  return rows.length === 1;
}

export async function deleteSession(ownerId: string, sessionId: string): Promise<boolean> {
  const { rows } = await query<{ id: string }>(
    `
      delete from saferide.chat_sessions
      where id = $1 and owner_id = $2
      returning id
    `,
    [sessionId, ownerId],
  );
  return rows.length > 0;
}

export async function listMessages(ownerId: string, sessionId: string): Promise<ChatMessageRow[]> {
  const { rows } = await query<ChatMessageRow>(
    `
      select m.*
      from saferide.chat_messages m
      join saferide.chat_sessions s on s.id = m.session_id
      where s.owner_id = $1 and m.session_id = $2
      order by m.created_at asc
    `,
    [ownerId, sessionId],
  );
  return rows;
}

export async function insertMessage(params: {
  ownerId: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: Record<string, unknown> | null;
}): Promise<ChatMessageRow | null> {
  const { rows } = await query<ChatMessageRow>(
    `
      insert into saferide.chat_messages (session_id, owner_id, role, content, metadata)
      select $2, $1, $3, $4, $5
      from saferide.chat_sessions
      where id = $2 and owner_id = $1
      returning *
    `,
    [params.ownerId, params.sessionId, params.role, params.content, params.metadata ?? null],
  );

  if (!rows[0]) return null;

  await query(
    `
      update saferide.chat_sessions
      set last_activity = now()
      where id = $1 and owner_id = $2
    `,
    [params.sessionId, params.ownerId],
  );

  return rows[0];
}
