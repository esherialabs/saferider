import { query } from '../plugins/db.js';

export async function auditEvent(params: {
  action: string;
  resourceClass: string;
  requestId?: string | null;
  outcome: 'success' | 'denied' | 'failed';
  policyVersion: string;
}): Promise<void> {
  await query(
    `
      insert into saferide.audit_events (
        action, resource_type, request_id, outcome, policy_version
      )
      values ($1, $2, $3, $4, $5)
    `,
    [
      params.action,
      params.resourceClass,
      params.requestId ?? null,
      params.outcome,
      params.policyVersion,
    ],
  );
}
