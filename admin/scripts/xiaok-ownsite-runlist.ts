import assert from 'node:assert/strict';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';

loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development'));
const eid = '1454';
const target = new URL(process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');

async function main() {
  const data = await withTenantTransaction(eid, tx => rows(tx, sql`select r.id,r.status,r.conversation_id,r.trigger_message_id,
    r.policy_snapshot->>'protocol' protocol,r.policy_snapshot->>'reportCoordination' coordination,r.created_at,
    (select left(coalesce(m.content->'blocks'->0->>'text', m.content::text),90) from app.assistant_messages m
      where m.enterprise_id=r.enterprise_id and m.id=r.trigger_message_id) question
    from app.assistant_runs r where r.enterprise_id=${eid} and r.conversation_id='1522' order by r.id desc limit 15`));
  console.log(JSON.stringify(data, null, 1));
}
main().finally(() => closePostgresPool());
