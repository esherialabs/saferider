import { query } from '../plugins/db.js';

export async function listTips(): Promise<unknown[]> {
  const { rows } = await query(
    `
      select *
      from saferide.tips
      order by title asc
    `,
  );
  return rows;
}

export async function listLegalTags(): Promise<unknown[]> {
  const { rows } = await query(
    `
      select *
      from saferide.legal_tags
      order by tag asc
    `,
  );
  return rows;
}
