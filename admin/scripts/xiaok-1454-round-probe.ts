/* Read-only probe for the 1454 customer round: project, followup bindings,
 * customer conversation, delivered reports and queue state. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';

loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development'));
const eid = '1454';
const out = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/xiaok-1454-customer-test-20261110/probe.json');
const target = new URL(process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
const t = <T>(fn: Parameters<typeof withTenantTransaction<T>>[1]) => withTenantTransaction(eid, fn);
const pOne = (q: ReturnType<typeof sql>) => withPlatformTransaction(tx => one(tx, q));

async function main() {
  const report: Row = { at: new Date().toISOString(), enterpriseId: eid };
  report.project = await t(tx => one(tx, sql`select p.id,p.name,p.status,p.current_stage_key,p.version,p.customer_access,
    p.lead_id,l.customer_user_id,l.archived_at,p.updated_at
    from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where p.enterprise_id=${eid} and p.id='237'`));
  report.customer = await pOne(sql`select id,context_version,nickname from app.users where id='645'`);
  report.bindings = await t(tx => rows(tx, sql`select id,audience,project_id,user_id,admin_id,status,conversation_id,version,list_hidden,created_at,updated_at
    from app.construction_followup_bindings where enterprise_id=${eid} and user_id='645' order by id`));
  report.conversations = await t(tx => rows(tx, sql`select c.id,c.purpose,c.mode,c.status,c.updated_at,
    (select p.user_id from app.assistant_participants p where p.enterprise_id=c.enterprise_id and p.conversation_id=c.id
      and p.principal_kind='user' order by p.id limit 1) customer_user_id,
    (select count(*) from app.assistant_messages m where m.enterprise_id=c.enterprise_id and m.conversation_id=c.id) messages,
    (select max(m.created_at) from app.assistant_messages m where m.enterprise_id=c.enterprise_id and m.conversation_id=c.id) last_message_at
    from app.assistant_conversations c where c.enterprise_id=${eid}
      and (exists (select 1 from app.assistant_participants p where p.enterprise_id=c.enterprise_id
            and p.conversation_id=c.id and p.user_id='645')
        or exists (select 1 from app.construction_followup_bindings b where b.enterprise_id=${eid}
            and b.user_id='645' and b.conversation_id=c.id))
    order by c.updated_at desc limit 12`));
  report.reports = await t(tx => rows(tx, sql`select r.id,r.kind,r.binding_id,r.latest_revision,r.created_at,
    d.state delivery_state,d.read_at,v.body_run_id,br.status body_status
    from app.construction_reports r
    left join app.construction_report_deliveries d on d.enterprise_id=r.enterprise_id and d.report_id=r.id
      and d.revision=r.latest_revision and d.binding_id=r.binding_id
    left join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=r.latest_revision
    left join app.assistant_runs br on br.enterprise_id=v.enterprise_id and br.id=v.body_run_id
    where r.enterprise_id=${eid} and r.binding_id='422' order by r.created_at desc limit 10`));
  report.settings = await t(tx => one(tx, sql`select version,enabled,daily_time,weekly_time,weekly_day,project_ids,audiences,
    next_daily_at,next_weekly_at,inactive_policy from app.construction_report_settings where enterprise_id=${eid}`));
  report.queue = await pOne(sql`select count(*) filter (where status in ('queued','running')) active,
    count(*) filter (where status='running') running from app.assistant_jobs`);
  report.assistantSettings = await pOne(sql`select policy_version,agent_config from app.assistant_enterprise_settings where enterprise_id=${eid}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().finally(() => closePostgresPool());
