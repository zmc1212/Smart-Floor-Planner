import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';

/** Called under the existing enterprise-settings row lock by both allocators.
 * Unknown dispatches retain their full hold across days; no guessed billing. */
export async function portfolioCopyBudget(tx: PostgresTransaction, enterpriseId: string) {
  if (!(await one(tx, sql`select to_regclass('app.assistant_model_tasks') is not null as ready`))?.ready) return { requests: 0, tokens: 0, cost: 0 };
  return (await one(tx, sql`select count(*) requests,coalesce(sum(reserved_tokens),0) tokens,coalesce(sum(reserved_cost_micros),0) cost
    from app.assistant_model_tasks where enterprise_id=${enterpriseId} and kind='portfolio_copy'
    and (state!='cancelled' or authorization_id is not null)
    and (created_at>=(now() at time zone 'UTC')::date at time zone 'UTC' or authorization_id is not null or state in ('prepared','running','submitting','indeterminate'))`))!;
}
