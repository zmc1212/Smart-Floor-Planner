import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows } from './assistant-repository';

const runtimeTables = [
  'native_workflow_runs',
  'native_workflow_schedule_runs',
  'native_workflow_report_batches',
  'native_workflow_schedule_controls',
  'native_workflow_schedule_ledgers',
  'native_workflow_durable_tasks',
] as const;

/** Runs inside the existing authorized enterprise reset/purge transaction.
 * Select the exact tenant for these policies while retaining platform scope
 * for the surrounding reset operations. */
export async function nativeWorkflowCleanup(
  tx: PostgresTransaction, enterpriseId: bigint, action: 'count' | 'delete',
) {
  const previous = await one<{ scope: string | null }>(tx, sql`
    select current_setting('app.current_enterprise_id', true) as scope`);
  await tx.execute(sql`select set_config('app.current_enterprise_id',${enterpriseId.toString()},true)`);
  const present = await rows<{ name: string }>(tx, sql`select relname as name from pg_class
    where relnamespace='app'::regnamespace and relname in (
      ${sql.join(runtimeTables.map((name) => sql`${name}`), sql`,`)})`);
  const tables = new Set(present.map((row) => row.name));
  const result = [];
  for (const table of runtimeTables) {
    if (!tables.has(table)) continue;
    const relation = sql`app.${sql.identifier(table)}`;
    const count = action === 'delete'
      ? (await tx.execute(sql`delete from ${relation} where enterprise_id=${enterpriseId}`)).rowCount ?? 0
      : Number((await one(tx, sql`select count(*) as n from ${relation} where enterprise_id=${enterpriseId}`))?.n ?? 0);
    result.push({ table, label: table, count });
  }
  // The surrounding transaction rolls back on a failed operation or restore.
  await tx.execute(sql`select set_config('app.current_enterprise_id',${previous?.scope ?? ''},true)`);
  return result;
}
