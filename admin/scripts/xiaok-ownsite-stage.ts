import assert from 'node:assert/strict';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';

loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development'));
const eid = '1454';
const target = new URL(process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
const text = (c: unknown) => {
  const v = c as Row;
  return Array.isArray(v?.blocks) ? v.blocks.map((b: Row) => b.text ?? '').join('\n') : JSON.stringify(v);
};

async function main() {
  const settings = await withTenantTransaction(eid, tx => one(tx, sql`select stages from app.construction_stage_settings where enterprise_id=${eid}`));
  const stages = (settings?.stages ?? []) as Row[];
  console.log('STAGES', JSON.stringify(stages.filter(s => ['furnishing','installation'].includes(String(s.key))), null, 1));
  const report = await withTenantTransaction(eid, tx => one(tx, sql`select r.id,v.body_run_id,v.body_status from app.construction_reports r
    join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=r.latest_revision
    where r.enterprise_id=${eid} and r.id='474'`));
  console.log('REPORT', JSON.stringify(report));
  if (report?.body_run_id) {
    const msgs = await withTenantTransaction(eid, tx => rows(tx, sql`select id,author_kind,content from app.assistant_messages
      where enterprise_id=${eid} and run_id=${String(report.body_run_id)} order by id`));
    console.log('BODY', JSON.stringify(msgs.map(m => ({ id: m.id, author: m.author_kind, text: text(m.content).slice(0, 500) })), null, 1));
  }
}
main().finally(() => closePostgresPool());
