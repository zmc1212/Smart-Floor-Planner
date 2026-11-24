/** One-shot environment probe for the 20261121 agent-evaluation round:
 * confirms the approved remote development primary behind the 5432 forward,
 * its migration level, the labelled 1454 fixtures and the construction tables
 * both acceptance scripts need. Read-only; exits nonzero on any missing
 * precondition so the auto-resume driver stops before dispatching tests. */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd(), true);
import { withPlatformTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { sql } from 'drizzle-orm';

async function main() {
  const target = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.port !== '5432' || target.pathname !== '/smart_floor_planner')
    throw new Error('DATABASE_URL must stay on localhost:5432/smart_floor_planner');
  const q = <T>(fn: () => Promise<T>, label: string) => fn().catch((e: Error) => { throw new Error(label + ': ' + e.message); });
  const migrations = await q(() => withPlatformTransaction(tx => one(tx,
    sql`select count(*)::int n from app.__drizzle_migrations`)), 'migrations');
  const constructionTables = await q(() => withPlatformTransaction(tx => one(tx,
    sql`select count(*)::int n from information_schema.tables where table_schema='app' and table_name like 'construction%'`)), 'construction tables');
  const enterprise = await q(() => withPlatformTransaction(tx => one(tx,
    sql`select id,name from app.enterprises where id=1454`)), 'enterprise 1454');
  const fixtures = await q(() => withPlatformTransaction(tx => one(tx,
    sql`select (select count(*)::int from app.users where id=645) customer,
      (select count(*)::int from app.leads where enterprise_id=1454 and id=3132 and archived_at is null) lead,
      (select count(*)::int from app.construction_projects where enterprise_id=1454 and id=237 and status='active') project,
      (select count(*)::int from app.admin_users where enterprise_id=1454 and id=2853) owner,
      (select count(*)::int from app.assistant_jobs where status in ('queued','running')) busyJobs,
      (select count(*)::int from app.assistant_enterprise_settings where enterprise_id=1454) settings`)), 'fixtures');
  const knowledge = await q(() => withPlatformTransaction(tx => rows(tx,
    sql`select count(*)::int n from information_schema.tables where table_schema='app' and table_name like '%knowledge%'`)), 'knowledge tables');
  const result = { migrations: migrations!.n, constructionTables: constructionTables!.n,
    knowledgeTables: knowledge.reduce((a, r) => a + Number((r as Record<string, unknown>).n || 0), 0),
    enterprise: enterprise!, fixtures: fixtures! };
  console.log(JSON.stringify(result));
  if (Number(constructionTables!.n) === 0) throw new Error('The 5432 target has no construction tables — the tunnel is not on the approved development primary');
  if (!enterprise) throw new Error('Enterprise 1454 missing');
  const f = fixtures as unknown as Record<string, number>;
  for (const [key, expected] of [['customer', 1], ['lead', 1], ['project', 1], ['owner', 1], ['settings', 1]] as const)
    if (Number(f[key]) !== expected) throw new Error('Fixture ' + key + ' count ' + f[key] + ' != ' + expected);
  if (Number(f.busyJobs) !== 0) throw new Error('Assistant queue is not idle: ' + f.busyJobs + ' active jobs');
  console.log('DB-PROBE-OK');
}
main().catch((error: Error) => { console.error('DB-PROBE-FAIL: ' + error.message); process.exitCode = 1; })
  .finally(() => closePostgresPool());
