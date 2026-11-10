import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';

loadEnvConfig(process.cwd(), true);
async function main() {
  const messages = await withTenantTransaction('1454', tx => rows(tx, sql`select id,seq,author_kind,run_id,created_at,
    substr(content::text,1,120) content from app.assistant_messages where enterprise_id='1454' and conversation_id=1522
    and id>=12670 order by id`));
  const runs = await withTenantTransaction('1454', tx => rows(tx, sql`select id,purpose,status,error_code,created_at,
    output_message_id from app.assistant_runs where enterprise_id='1454' and conversation_id=1522 order by id desc limit 8`));
  console.log(JSON.stringify({ messages, runs }, null, 1));
}
main().finally(() => closePostgresPool());
