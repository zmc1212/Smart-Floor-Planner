import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';

/** A stored owner name is history; current reception also requires this request's live grant. */
export async function currentHandoffOwner(tx: PostgresTransaction, enterpriseId: string, conversationId: string,
  handoff?: { state?: unknown; ownerId?: unknown; requestId?: unknown }) {
  if (handoff?.state !== 'active' || !handoff.ownerId || !handoff.requestId) return null;
  return one(tx, sql`select a.id,a.display_name,a.username from app.admin_users a
    join app.assistant_participants p on p.enterprise_id=a.enterprise_id and p.admin_id=a.id
    where a.enterprise_id=${enterpriseId} and a.id=${String(handoff.ownerId)} and a.status='active'
      and a.role in ('designer','enterprise_admin') and not a.must_change_password
      and p.conversation_id=${conversationId} and p.status='active' and p.participant_role='handoff_staff'
      and p.grant_basis->>'requestId'=${String(handoff.requestId)} for share of a,p`);
}
