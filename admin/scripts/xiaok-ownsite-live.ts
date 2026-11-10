import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { rows } from '@/db/repositories/assistant-repository';

loadEnvConfig(process.cwd(), true);
const eid = '1454';
async function main() {
  const runs = await withTenantTransaction(eid, tx => rows(tx, sql`select id,status,error_code,created_at,completed_at
    from app.assistant_runs where enterprise_id=${eid} and conversation_id='1522' order by id desc limit 3`));
  const runId = process.argv[2] || '2705';
  const steps = await withTenantTransaction(eid, tx => rows(tx, sql`select step_seq,kind,capability_name,status,input_summary,private_checkpoint
    from app.assistant_run_steps where enterprise_id=${eid} and run_id=${runId} order by step_seq`));
  console.log(JSON.stringify({ runs, steps }, null, 1));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
