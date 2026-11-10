/** Read-only: detail of failed run 2572 (missing_citation) and its conversation messages. */
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction } from '@/db/transaction';
import { rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';

loadEnvConfig(process.cwd(), true);
(async () => {
  const run = await withPlatformTransaction(tx => rows(tx, sql`select id::text, status, error_code, output_message_id::text, left(policy_snapshot::text, 700) policy from app.assistant_runs where id=2572`));
  const msgs = await withPlatformTransaction(tx => rows(tx, sql`select id::text, author_kind, left(content::text, 260) body
    from app.assistant_messages where conversation_id=1544 order by id`));
  const cites = await withPlatformTransaction(tx => rows(tx, sql`select message_id::text, source_kind from app.assistant_message_citations where conversation_id=1544`));
  console.log(JSON.stringify({ run, msgs, cites }, null, 1).slice(0, 2500));
  await closePostgresPool();
})().catch(e => { console.error(String(e.message).slice(0, 400)); process.exitCode = 1; });
