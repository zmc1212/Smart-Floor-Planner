import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd(), true);
import { sql } from 'drizzle-orm';
import { withPlatformTransaction } from '@/db/transaction';
import { rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
async function main() {
  const jobs = await withPlatformTransaction(tx => rows(tx, sql`select j.id,j.enterprise_id,j.status,j.attempts,j.last_error,j.created_at,j.updated_at
    from app.assistant_jobs j join app.enterprises e on e.id=j.enterprise_id
    where e.name like '[synthetic-recovery-decoy]%' order by j.id desc limit 4`));
  console.log(JSON.stringify(jobs, null, 1));
  await closePostgresPool();
}
main();
