/** Bounded boss scheduled-semantics evaluation. The production tick's exact
 * discoverFollowups/enqueueReport calls run inside one tenant transaction that
 * is always rolled back, so no report, message or job reaches a real owner
 * destination. Verifies discovery->boss binding->due period->one enqueue per
 * period->dedup and the enterprise-wide project scope; body/delivery reuse the
 * four-role weekly evidence. Zero model and Embedding calls. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { getPostgresPool, resolvePostgresRuntimeConfig, closePostgresPool } from '@/lib/postgresql';
import { withPlatformTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { discoverFollowups, enqueueReport } from '@/lib/construction/report-store';
import { followupProjects } from '@/lib/construction/report-scope';
import { latestReportPeriod, nextReportAt } from '@/lib/construction/report-calendar';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development'));
const eid = '1454', root = path.resolve('..');
const target = new URL(resolvePostgresRuntimeConfig().connectionString);
assert.ok(['localhost', '127.0.0.1'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner',
  'The probe binds the isolated local development database');
const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/v1-02-live-reports/boss-scheduled-probe01');
assert.ok(!fs.existsSync(path.join(output, 'evidence.json')), 'Retain every original probe attempt');
fs.mkdirSync(output, { recursive: true });
const prefix = 'synthetic-boss-probe-' + randomUUID();
const counts = () => withPlatformTransaction(async tx => {
  const oneCount = async (table: string) => (await one(tx, sql`select count(*)::int n from ${sql.raw('app.' + table)} where enterprise_id=${eid}`))!.n;
  return {
    bindings: await oneCount('construction_followup_bindings'), reports: await oneCount('construction_reports'),
    versions: await oneCount('construction_report_versions'), deliveries: await oneCount('construction_report_deliveries'),
    runs: await oneCount('assistant_runs'), jobs: await oneCount('assistant_jobs'),
    conversations: await oneCount('assistant_conversations'), participants: await oneCount('assistant_participants'),
    messages: await oneCount('assistant_messages'), admins: await oneCount('admin_users'), projects: await oneCount('construction_projects'),
  };
});
let release: (() => Promise<void>) | undefined;
async function main() {
  const control = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL;
  release = await lockAssistantAcceptance(control, { waitForLock: true });
  const before = await counts();
  const settingsBefore = (await withPlatformTransaction(tx => one(tx, sql`select enabled,audiences,version,dispatch_epoch from app.construction_report_settings where enterprise_id=${eid}`)))!;
  const client = await getPostgresPool().connect();
  const evidence: Row = { startedAt: new Date().toISOString(), prefix, eid, settingsBefore, before, committed: false,
    mechanism: 'production report tick calls (discoverFollowups + enqueueReport) inside one always-rolled-back tenant transaction' };
  let reportId = '', adminId = '';
  try {
    await client.query('begin');
    await client.query(`select set_config('app.current_enterprise_id',$1,true), set_config('app.is_platform_admin','false',true)`, [eid]);
    const tx = drizzle(client, { schema });
    const admin = (await one(tx, sql`insert into app.admin_users(enterprise_id,username,display_name,password_hash,role,status,must_change_password)
      values(${eid},${prefix + ':boss'},'合成定时语义探针·老板','unusable-local-probe','enterprise_admin','active',false) returning *`))!;
    adminId = String(admin.id);
    const lead = (await one(tx, sql`insert into app.leads(enterprise_id,name,phone,source)
      values(${eid},${prefix + ':lead'},${'137' + String(Date.now()).slice(-8)},'natural') returning *`))!;
    const projects: Row[] = [];
    for (const stage of ['utilities', 'installation']) projects.push((await one(tx, sql`insert into app.construction_projects(enterprise_id,lead_id,name,status,current_stage_key,customer_access)
      values(${eid},${String(lead.id)},${prefix + ':' + stage},'active',${stage},false) returning *`))!);
    // Stage the daily occurrence to the current Shanghai minute so the due
    // period ends today and contains the probe writes, like the tick scope.
    const now = new Date(), stagedClock = new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(11, 16);
    await tx.execute(sql`update app.construction_report_settings set enabled=true,daily_time=${stagedClock},weekly_time='23:59',weekly_day=1,
      audiences=${JSON.stringify(['customer', 'worker', 'designer', 'boss'])}::jsonb,project_ids='[]'::jsonb,stage_keys='[]'::jsonb,
      stage_enabled=false,next_daily_at=${new Date(now.getTime() - 60000)},next_weekly_at=${new Date(now.getTime() + 86400000)} where enterprise_id=${eid}`);
    const settings = (await one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid} for update`))!;
    evidence.staged = { adminId, projectIds: projects.map(p => String(p.id)), audiences: settings.audiences,
      nextDailyAt: settings.next_daily_at, dailyTime: settings.daily_time, shanghaiClock: stagedClock };
    const bindings = await discoverFollowups(tx, eid, settings);
    const probeBoss = bindings.find(b => String(b.admin_id) === adminId && b.audience === 'boss');
    assert.ok(probeBoss, 'discovery maps the enterprise administrator to a boss destination');
    assert.equal(probeBoss!.status, 'enabled');
    assert.equal(probeBoss!.scope_key, 'enterprise');
    evidence.bossBinding = { id: String(probeBoss!.id), conversationId: String(probeBoss!.conversation_id), scopeKey: probeBoss!.scope_key };
    evidence.otherBossDestinations = bindings.filter(b => b.audience === 'boss' && String(b.admin_id) !== adminId)
      .map(b => ({ id: String(b.id), adminId: String(b.admin_id), status: b.status }));
    const time = String(settings.daily_time), weeklyDay = Number(settings.weekly_day || 1);
    const period = latestReportPeriod('daily', now, time, weeklyDay);
    assert.ok(new Date(String(settings.next_daily_at)) <= now, 'the staged occurrence is due');
    assert.ok(period.end.getTime() <= now.getTime() && period.end.getTime() > now.getTime() - 3600000,
      'the due period ends at the staged occurrence of today');
    assert.ok(nextReportAt('daily', now, time, weeklyDay).getTime() > now.getTime(), 'the next occurrence moves past now');
    const queued = await enqueueReport(tx, eid, probeBoss!, settings, period);
    assert.ok(queued, 'the tick enqueues the boss daily');
    reportId = String(queued!.reportId);
    const report = (await one(tx, sql`select * from app.construction_reports where enterprise_id=${eid} and id=${reportId}`))!;
    assert.equal(report.kind, 'daily');
    assert.equal(String(report.binding_id), String(probeBoss!.id));
    assert.equal(new Date(String(report.period_start)).getTime(), period.start.getTime());
    assert.equal(new Date(String(report.period_end)).getTime(), period.end.getTime());
    assert.equal(new Date(String(report.cutoff_at)).getTime(), period.cutoff.getTime());
    assert.equal(new Date(String(report.scheduled_at)).getTime(), period.scheduledAt.getTime());
    const run = (await one(tx, sql`select * from app.assistant_runs where enterprise_id=${eid} and id=${String(queued!.runId)}`))!;
    assert.equal(run.trigger_kind, 'scheduled_task');
    assert.equal(run.purpose, 'construction.report.facts');
    assert.equal(String(run.conversation_id), String(probeBoss!.conversation_id));
    const policy = run.policy_snapshot as Row;
    assert.equal(String(policy.reportId), reportId);
    assert.equal(Number(policy.revision), 1);
    assert.ok(((policy.scope as Row).audiences as string[]).includes('boss'), 'the run freezes the boss audience in scope');
    const job = (await one(tx, sql`select * from app.assistant_jobs where enterprise_id=${eid} and run_id=${String(queued!.runId)}`))!;
    assert.equal(job.kind, 'chat_turn');
    assert.equal(job.dedupe_key, 'construction-report:' + reportId + ':1');
    const version = (await one(tx, sql`select * from app.construction_report_versions where enterprise_id=${eid} and report_id=${reportId} and revision=1`))!;
    assert.equal(version.status, 'queued');
    assert.equal((await enqueueReport(tx, eid, probeBoss!, settings, period)), null);
    const duplicate = await one(tx, sql`select count(*)::int n from app.construction_reports where enterprise_id=${eid} and binding_id=${String(probeBoss!.id)}`);
    assert.equal(duplicate!.n, 1, 'one report per destination and period key');
    const scope = await followupProjects(tx, eid, probeBoss!, true, [], []);
    const scopeIds = scope.map(p => String(p.id));
    assert.ok(projects.every(p => scopeIds.includes(String(p.id))), 'the boss scope covers every active project of the enterprise');
    evidence.result = { reportId, runId: String(queued!.runId), period: { start: period.start.toISOString(), end: period.end.toISOString(),
      cutoff: period.cutoff.toISOString(), scheduledAt: period.scheduledAt.toISOString() }, dedupSecondEnqueue: null,
      bossScope: { projects: scopeIds.length, includesProbeProjects: projects.every(p => scopeIds.includes(String(p.id))) },
      runScope: { audiences: (policy.scope as Row).audiences, projectIds: (policy.scope as Row).project_ids, stageKeys: (policy.scope as Row).stage_keys } };
  } finally {
    await client.query('rollback').catch(() => undefined);
    client.release();
  }
  const after = await counts();
  assert.deepEqual(after, before, 'the rolled-back probe persists no binding, report, run, job, conversation or message');
  const settingsAfter = (await withPlatformTransaction(tx => one(tx, sql`select enabled,audiences,version,dispatch_epoch from app.construction_report_settings where enterprise_id=${eid}`)))!;
  assert.deepEqual(settingsAfter, settingsBefore, 'report settings are unchanged');
  const residue = await withPlatformTransaction(async tx => ({
    admin: (await one(tx, sql`select count(*)::int n from app.admin_users where enterprise_id=${eid} and username=${prefix + ':boss'}`))!.n,
    report: (await one(tx, sql`select count(*)::int n from app.construction_reports where enterprise_id=${eid} and id=${Number(reportId)}`))!.n,
  }));
  assert.deepEqual(residue, { admin: 0, report: 0 });
  evidence.after = after; evidence.settingsAfter = settingsAfter; evidence.residue = residue; evidence.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ bossBinding: evidence.bossBinding, result: evidence.result, residue: evidence.residue }, null, 1));
}
main().catch(e => { console.error('FATAL', String(e?.stack || e?.message || e).split('\n').slice(0, 8).join('\n')); process.exitCode = 1; })
  .finally(async () => { await release?.().catch(() => undefined); await closePostgresPool().catch(() => undefined); });
