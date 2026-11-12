import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';

/** A new membership grant never resurrects formal facts revoked by removal or loss of their required role. */
export async function siteAccessRevoked(tx: PostgresTransaction, eid: string, pid: string, actorIds: string[], since: Date | string | { afterAuditId: string },
  required: { reviewers?: string[]; managers?: string[]; designers?: string[] } = {}) {
  if (!actorIds.length) return false;
  // Raw PostgreSQL timestamps can be strings, including microseconds. Keep
  // their precision instead of treating every non-Date as an audit receipt.
  const timestamp = since instanceof Date ? Number.isFinite(since.getTime()) ? since.toISOString() : null
    : typeof since === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(since)
      && Number.isFinite(Date.parse(since)) ? since : null;
  const auditId = since && typeof since === 'object' && 'afterAuditId' in since ? since.afterAuditId : undefined;
  if (!timestamp && (typeof auditId !== 'string' || !/^(?:0|[1-9]\d{0,18})$/.test(auditId)
    || BigInt(auditId) > BigInt('9223372036854775807'))) return true;
  const boundary = timestamp ? sql`created_at>${timestamp}::timestamptz` : sql`id>${auditId}`;
  return !!await one(tx, sql`select id from app.construction_audits where enterprise_id=${eid} and project_id=${pid}
    and action='member' and ${boundary}
    and snapshot->>'adminId'=any(ARRAY(select jsonb_array_elements_text(${JSON.stringify(actorIds)}::jsonb)))
    and (snapshot->>'active'='false' or snapshot->>'role'='observer'
      or (snapshot->>'adminId'=any(ARRAY(select jsonb_array_elements_text(${JSON.stringify(required.reviewers || [])}::jsonb)))
        and snapshot->>'previousRole' in ('manager','designer') and snapshot->>'role' not in ('manager','designer'))
      or (snapshot->>'adminId'=any(ARRAY(select jsonb_array_elements_text(${JSON.stringify(required.managers || [])}::jsonb)))
        and snapshot->>'previousRole'='manager' and snapshot->>'role'<>'manager')
      ${required.designers?.length ? sql`or (snapshot->>'adminId'=any(ARRAY(select jsonb_array_elements_text(${JSON.stringify(required.designers)}::jsonb)))
        and snapshot->>'previousRole'='designer' and snapshot->>'role'<>'designer')` : sql``}) limit 1`);
}
