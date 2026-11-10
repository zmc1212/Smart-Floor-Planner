/** Read-only: dump selected run steps' input summary and private checkpoint. */
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { rows } from '@/db/repositories/assistant-repository';
loadEnvConfig(process.cwd(), true);
async function main() {
  const eid = '1454';
  const [runId, ...seqs] = process.argv.slice(2);
  const limit = Number(process.env.DUMP_LIMIT || 4000);
  const all = await withTenantTransaction(eid, tx => rows(tx, sql`select step_seq,kind,status,input_summary,private_checkpoint
    from app.assistant_run_steps where enterprise_id=${eid} and run_id=${runId} order by step_seq`));
  for (const step of all as Array<Record<string, any>>) {
    if (seqs.length && !seqs.includes(String(step.step_seq))) continue;
    console.log(`=== ${step.step_seq} ${step.kind} ${step.status}`);
    console.log('summary', JSON.stringify(step.input_summary));
    console.log('checkpoint', JSON.stringify(step.private_checkpoint).slice(0, limit));
  }
}
main();
