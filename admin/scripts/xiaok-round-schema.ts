/* Print the live columns of the assistant/construction tables used by the round. */
import assert from 'node:assert/strict';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction } from '@/db/transaction';
import { rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';

loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development'));

async function main() {
  const tables = ['assistant_conversations', 'assistant_messages', 'assistant_participants',
    'construction_followup_bindings', 'construction_report_settings', 'construction_reports',
    'construction_report_versions', 'construction_report_deliveries'];
  const list = sql.join(tables.map(name => sql`${name}`), sql`, `);
  const out = await withPlatformTransaction(tx => rows(tx, sql`select table_name, ordinal_position, column_name, data_type
    from information_schema.columns where table_schema='app' and table_name in (${list})
    order by table_name, ordinal_position`));
  let current = '';
  for (const r of out) {
    if (r.table_name !== current) { current = String(r.table_name); console.log('\n== ' + current + ' =='); }
    console.log(String(r.column_name) + ' : ' + String(r.data_type));
  }
}
main().finally(() => closePostgresPool());
