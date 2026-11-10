import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { rows } from '@/db/repositories/assistant-repository';
loadEnvConfig(process.cwd(), true);
async function main() {
  const eid = '1454';
  console.log(JSON.stringify(await withTenantTransaction(eid, tx => rows(tx, sql`select id,status,error_code from app.assistant_runs where enterprise_id=${eid} and conversation_id='1522' order by id desc limit 2`))));
  console.log(JSON.stringify(await withTenantTransaction(eid, tx => rows(tx, sql`select id,status,attempts from app.assistant_jobs where enterprise_id=${eid} order by id desc limit 2`))));
}
main();
