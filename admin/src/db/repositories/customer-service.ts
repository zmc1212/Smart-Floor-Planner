import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';

export async function currentCustomerService(tx: PostgresTransaction, userId: bigint | string) {
  const { rows } = await tx.execute<{ enterprise_id: string | null; lead_id: string | null; ambiguous: boolean }>(sql`
    select enterprise_id::text, lead_id::text, ambiguous from app.assistant_customer_service(${userId}::bigint)
  `);
  const row = rows[0];
  return { enterpriseId: row.enterprise_id, leadId: row.lead_id, ambiguous: row.ambiguous };
}
