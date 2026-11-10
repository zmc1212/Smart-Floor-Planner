/* Inspect the customer follow-up conversation bound to project 237. */
import assert from 'node:assert/strict';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';

loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development'));

async function main() {
  const eid = '1454';
  const c = await withTenantTransaction(eid, tx => one(tx, sql`select c.id,c.purpose,c.mode,c.status,c.title,c.updated_at,c.entry_snapshot
    from app.assistant_conversations c where c.enterprise_id=${eid} and c.id='1522'`));
  console.log(JSON.stringify(c, null, 2));
  const m = await withTenantTransaction(eid, tx => rows(tx, sql`select id,seq,author_kind,user_id,admin_id,substr(content::text,1,160) content,created_at
    from app.assistant_messages where enterprise_id=${eid} and conversation_id='1522' order by seq desc limit 8`));
  console.log(JSON.stringify(m, null, 2));
}
main().finally(() => closePostgresPool());
