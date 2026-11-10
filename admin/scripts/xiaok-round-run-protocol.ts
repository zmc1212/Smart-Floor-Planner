import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';

loadEnvConfig(process.cwd(), true);
async function main() {
  const runs = await withTenantTransaction('1454', tx => rows(tx, sql`select id,status,error_code,
    policy_snapshot->'agentRuntime'->>'protocol' protocol,
    policy_snapshot->'agentRuntime'->>'pipeline' pipeline,
    left(policy_snapshot::text, 300) snapshot
    from app.assistant_runs where enterprise_id='1454' and id in (2603,2604,2606,2608,2609,2610,2611,2612,2613,2614) order by id`));
  console.log('RUNS ' + JSON.stringify(runs, null, 1));
}
main().finally(() => closePostgresPool());
