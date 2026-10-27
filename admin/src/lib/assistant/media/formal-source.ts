import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { parseFormalSurveyLayout } from '@/lib/survey-graph';
import { id } from '../contracts';

export type FormalSource = { leadId: string; floorPlanId: string; layoutHash: string; roomId: string; name: string };

/** Shared by attachment, private reads and Agent checkpoint rehydration. */
export async function ownedFormalPlan(tx: PostgresTransaction, enterpriseId: string, userId: string, leadId: string) {
  const plan = await one(tx, sql`select f.id,f.name,f.layout_data from app.leads l join app.floor_plans f
    on f.enterprise_id=l.enterprise_id and f.id=l.primary_floor_plan_id
    where l.enterprise_id=${enterpriseId} and l.id=${id(leadId)} and l.customer_user_id=${userId}
      and l.archived_at is null and f.status='completed' for share of l,f`);
  return plan && parseFormalSurveyLayout(plan.layout_data) ? plan : null;
}

export async function formalMediaSourceAvailable(tx: PostgresTransaction, enterpriseId: string, media: Row) {
  const source = media.source_ref as FormalSource | null;
  if (!source) return true;
  // Bad provenance must not become a broader read or a malformed SQL identifier.
  try { id(source.leadId); id(source.floorPlanId); } catch { return false; }
  const plan = await ownedFormalPlan(tx, enterpriseId, String(media.customer_user_id), source.leadId);
  // The pixels describe an immutable historical snapshot. A valid later edit
  // preserves it; hash/room changes do not silently replace or revoke that image.
  return !!plan && String(plan.id) === source.floorPlanId;
}
