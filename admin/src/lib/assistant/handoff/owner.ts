import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';

/** A stored owner name is history; current reception also requires this request's live grant. */
export async function currentHandoffOwner(tx: PostgresTransaction, enterpriseId: string, conversationId: string,
  handoff?: { state?: unknown; ownerId?: unknown; requestId?: unknown }) {
  if (handoff?.state !== 'active' || !handoff.ownerId || !handoff.requestId) return null;
  return one(tx, sql`select a.id,a.display_name,a.username from app.assistant_participants p
    cross join lateral app.assistant_handoff_staff_identity(p.admin_id,p.enterprise_id) a
    where p.enterprise_id=${enterpriseId} and p.admin_id=${String(handoff.ownerId)}
      and p.conversation_id=${conversationId} and p.status='active' and p.participant_role='handoff_staff'
      and p.grant_basis->>'requestId'=${String(handoff.requestId)} for share of p`);
}
