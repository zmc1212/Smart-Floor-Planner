import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';

loadEnvConfig(process.cwd(), true);
async function main() {
  const records = await withTenantTransaction('1454', tx => rows(tx, sql`select table_name from information_schema.tables
    where table_schema='app' and table_name like 'construction%record%'`));
  console.log(JSON.stringify(records));
  for (const t of ['construction_records', 'construction_site_records', 'construction_project_records']) {
    try {
      const c = await withTenantTransaction('1454', tx => rows(tx, sql`select id,project_id,created_at from app.${sql.raw(t)}
        where enterprise_id='1454' and project_id=237 order by id desc limit 5`));
      console.log(t, JSON.stringify(c));
    } catch (e) { console.log(t, 'n/a', (e as Error).message.slice(0, 80)); }
  }
}
main().finally(() => closePostgresPool());
