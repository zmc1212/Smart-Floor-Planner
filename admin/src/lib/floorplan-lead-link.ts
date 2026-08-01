import { parsePostgresId } from '@/db/postgres-dto';
import { LeadRepository } from '@/db/repositories';
import type { PostgresTransaction } from '@/db/transaction';

export async function linkFloorPlanToLead(
  transaction: PostgresTransaction,
  leadId: unknown,
  floorPlanId: unknown,
  status?: string
) {
  const lead = await new LeadRepository(transaction).linkFloorPlan(
    parsePostgresId(leadId, 'leadId'),
    parsePostgresId(floorPlanId, 'floorPlanId'),
    status
  );
  return Boolean(lead);
}
