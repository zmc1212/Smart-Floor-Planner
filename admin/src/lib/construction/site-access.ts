import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';

/** A new membership grant never resurrects formal facts revoked by removal or loss of their required role. */
export async function siteAccessRevoked(tx: PostgresTransaction, eid: string, pid: string, actorIds: string[], since: Date,
  required: { reviewers?: string[]; managers?: string[] } = {}) {
  if (!actorIds.length) return false;
  return !!await one(tx, sql`select id from app.construction_audits where enterprise_id=${eid} and project_id=${pid}
    and action='member' and created_at>${since} and snapshot->>'adminId'=any(ARRAY(select jsonb_array_elements_text(${JSON.stringify(actorIds)}::jsonb)))
    and (snapshot->>'active'='false' or snapshot->>'role'='observer'
      or (snapshot->>'adminId'=any(ARRAY(select jsonb_array_elements_text(${JSON.stringify(required.reviewers || [])}::jsonb)))
        and snapshot->>'previousRole' in ('manager','designer') and snapshot->>'role' not in ('manager','designer'))
      or (snapshot->>'adminId'=any(ARRAY(select jsonb_array_elements_text(${JSON.stringify(required.managers || [])}::jsonb)))
        and snapshot->>'previousRole'='manager' and snapshot->>'role'<>'manager')) limit 1`);
}
