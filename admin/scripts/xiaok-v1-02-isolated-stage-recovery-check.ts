/** Isolated same-key scheduler recovery. No provider dispatch or native claim. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { type ActorContext } from '@/lib/assistant/contracts';
import { cancelRuns } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { ConstructionService } from '@/lib/construction/service';
import { ConstructionReportService, reportPlanDto } from '@/lib/construction/report-service';
import { FollowupService } from '@/lib/construction/followup-service';
import { advanceConstructionReports, processConstructionReport, deliverConstructionReports } from '@/lib/construction/report-worker';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development') && process.argv.includes('--isolated'));
const root = path.resolve('..'), eid = '1454';
const connectionFile = 'tmp/xiaok-vector/connection.private.json';
process.env.DATABASE_URL = JSON.parse(fs.readFileSync(path.join(root, connectionFile), 'utf8')).DATABASE_URL;
const target = new URL(resolvePostgresRuntimeConfig().connectionString);
assert.ok(['localhost', '127.0.0.1'].includes(target.hostname) && target.port === '55432' && target.pathname === '/xiaok_embedding_eval');
const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/v1-02-same-key-recovery/isolated-01');
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Preserve original outcomes');
fs.mkdirSync(output, { recursive: true });
const files = execFileSync('rg', ['--files', 'admin/src/lib/assistant', 'admin/src/lib/construction', 'admin/src/db', 'admin/drizzle'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/);
files.push('admin/scripts/xiaok-v1-02-isolated-stage-recovery-check.ts', 'admin/scripts/assistant-acceptance-safety.mjs', 'admin/package.json', 'admin/package-lock.json', 'admin/tsconfig.json', connectionFile);
const bind = () => Object.fromEntries(files.sort().map(f => [f, createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')]));
const before = bind(), checks: Row[] = [], fixture: Row = {};
const report: Row = { startedAt: new Date().toISOString(), scope: 'Existing isolated database, Weiyun1454, controlled same-key recovery; original primary same-key05 remains failed', checks, fixture, actualModelCalls: 0, ingestionCalls: 0 };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const read = <T>(fn: Parameters<typeof withTenantTransaction<T>>[1]) => withTenantTransaction(eid, fn);
let release: (() => Promise<void>) | undefined, assistant: Row | undefined, policy: Row | undefined;
let aid = '', uid = '', lid = '', pid = '', bid = '', cid = '';
let owner: ConstructionService, plan: ConstructionReportService, actor: ActorContext, followup: FollowupService;
const prefix = 'synthetic-same-key-' + randomUUID();
const baseline = () => withPlatformTransaction(async tx => ({
  provider: await one(tx, sql`select coalesce(max(id),0)::text id from app.ai_provider_attempts`),
  knowledge: await one(tx, sql`select coalesce(max(id),0)::text id from app.assistant_knowledge_attempts`),
}));
const progress = async (key: string, note: string) => {
  const p = (await owner.execute('detail', { projectId: pid })).project as Row;
  return owner.execute('progress', { projectId: pid, expectedVersion: p.version, stageKey: key, note, sendReminder: false }, randomUUID());
};
const event = () => read(tx => one(tx, sql`select id,aggregate_version,payload from app.domain_event_outbox
  where enterprise_id=${eid} and type='construction.stage.updated.v1' and aggregate_id=${pid} order by aggregate_version desc limit 1`));
const latest = () => read(tx => one(tx, sql`select r.id,r.stage_event_id,v.run_id from app.construction_reports r
  join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id
  where r.enterprise_id=${eid} and r.binding_id=${bid} and r.kind='stage' order by r.id desc limit 1`));
const tick = async () => {
  const clock = (await read(tx => one(tx, sql`select clock_timestamp()+interval '2 milliseconds' as now`)))!;
  const r = await advanceConstructionReports(new Date(String(clock.now)), eid); assert.deepEqual(r.errors, []); return r.queued;
};
async function step(name: string, fn: () => Promise<unknown>) {
  try { const data = await fn(); checks.push({ name, passed: true, data }); }
  catch (e) { checks.push({ name, passed: false, error: (e as Error).stack }); throw e; }
  finally { save(); console.log(name + ': ' + (checks.at(-1)!.passed ? 'PASS' : 'FAIL')); }
}
async function processFacts(r: Row) {
  let job = await claimJob();
  for (let n = 0; !job && n < 30; n++) { await new Promise(resolve => setTimeout(resolve, 100)); job = await claimJob(); }
  assert.equal(job?.runId, String(r.run_id)); await processConstructionReport(job!);
  // The existing completion service may admit a separate composition job.
  // This isolated engineering test never executes it or changes model config.
  const body = await read(tx => one(tx, sql`select body_run_id from app.construction_report_versions where enterprise_id=${eid} and report_id=${String(r.id)} and revision=1`));
  if (body?.body_run_id) await read(tx => cancelRuns(tx, actor, cid, String(body.body_run_id)));
  await deliverConstructionReports(eid);
  return followup.detail(bid, String(r.id), 1);
}
async function main() {
  release = await lockAssistantAcceptance(process.env.DATABASE_URL, { waitForLock: true });
  report.accountingBefore = await baseline();
  await step('isolated Weiyun, idle queue and separately labelled fixture with unchanged model configuration', async () => {
    const e = await read(tx => one(tx, sql`select name,status from app.enterprises where id=${eid}`));
    assert.equal(e?.name, '微云'); assert.equal(e!.status, 'active');
    assert.equal((await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`)))!.n, 0);
    assistant = await read(tx => one(tx, sql`select enabled,agent_config from app.assistant_enterprise_settings where enterprise_id=${eid}`));
    assert.ok(assistant); assert.equal(assistant.enabled, false);
    await withPlatformTransaction(async tx => {
      uid = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!.id);
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${prefix})`);
      aid = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
        values(${eid},${prefix},'unusable-synthetic','enterprise_admin','active',false,'合成调度核对负责人') returning id`))!.id);
      await tx.execute(sql`update app.assistant_enterprise_settings set enabled=true where enterprise_id=${eid}`);
    });
    owner = new ConstructionService({ enterpriseId: eid, adminId: aid }); plan = new ConstructionReportService(owner.actor);
    policy = await plan.settings(); assert.equal(policy.enabled, false);
    lid = await read(async tx => String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
      values(${eid},${uid},${prefix},'13800000000','natural') returning id`))!.id));
    pid = String((await owner.execute('create', { leadId: lid, name: '合成同key调度恢复', managerId: aid, rooms: ['合成厨房'] }, randomUUID())).id);
    const p = (await owner.execute('detail', { projectId: pid })).project as Row;
    await owner.execute('update', { projectId: pid, expectedVersion: p.version, name: p.name, status: 'active', customerAccess: true }, randomUUID());
    actor = { enterpriseId: eid, principal: { kind: 'user', userId: uid }, contextVersion: 1, capabilities: ['assistant.followup.self'] };
    followup = new FollowupService(actor); const b = await followup.open(randomUUID(), pid); bid = String(b.bindingId); cid = String(b.conversationId);
    const saved = reportPlanDto(policy, eid);
    await plan.configure({ expectedVersion: saved.version, enabled: true, stageEnabled: true, projectIds: [pid], stageKeys: [], audiences: ['customer'],
      dailyTime: saved.dailyTime, weeklyTime: saved.weeklyTime, weeklyDay: saved.weeklyDay, inactivePolicy: saved.inactivePolicy }, randomUUID());
    await read(tx => tx.execute(sql`update app.construction_report_settings set next_daily_at=clock_timestamp()+interval '100 years',next_weekly_at=clock_timestamp()+interval '100 years' where enterprise_id=${eid}`));
    Object.assign(fixture, { aid, uid, lid, pid, bid, cid }); save(); return fixture;
  });
  await step('leave and return to the same key rejects the old queued report and queues exactly one replacement', async () => {
    await progress('utilities', '合成旧水电事件'); const oldEvent = (await event())!; assert.equal(await tick(), 1); const old = (await latest())!;
    const stages = (await owner.execute('stages')).stages as Row[], other = stages.find(s => s.key !== 'utilities')!;
    await progress(String(other.key), '合成真实离开水电'); await progress('utilities', '合成新水电事件'); const currentEvent = (await event())!;
    assert.notEqual(String(oldEvent.id), String(currentEvent.id));
    const stale = await processFacts(old); assert.notEqual(stale.state, 'facts_ready'); assert.equal(stale.facts, null);
    const queued = await tick(); report.recovery = { oldReport: String(old.id), oldEvent: String(oldEvent.id), currentEvent: String(currentEvent.id), expectedQueued: 1, actualQueued: queued }; save();
    assert.equal(queued, 1); const current = (await latest())!; assert.notEqual(String(current.id), String(old.id));
    assert.equal(String(current.stage_event_id), String(currentEvent.id));
    const detail = await processFacts(current); assert.equal(detail.state, 'facts_ready'); assert.equal((detail as Row).deliveryState, 'delivered');
    assert.equal(detail.facts!.projects[0].stageKey, 'utilities'); assert.equal(detail.facts!.projects[0].progressRevision, Number(currentEvent.aggregate_version));
    fixture.currentReportId = String(current.id); fixture.currentEventId = String(currentEvent.id);
    return { ...report.recovery as Row, newReport: String(current.id), rejectedState: stale.state, replacementState: detail.state, replacementDelivered: true };
  });
  await step('duplicate ticks and a note after delivery keep one replacement and its frozen stage facts', async () => {
    assert.equal(await tick(), 0); const beforeDetail = await followup.detail(bid, String(fixture.currentReportId), 1);
    await progress('utilities', '合成仅补备注，不再创建恢复任务'); assert.equal(await tick(), 0);
    const afterDetail = await followup.detail(bid, String(fixture.currentReportId), 1); assert.equal(afterDetail.state, 'facts_ready');
    assert.deepEqual(afterDetail.facts, beforeDetail.facts);
    const deliveries = await read(tx => rows(tx, sql`select d.state from app.construction_report_deliveries d where d.enterprise_id=${eid} and d.binding_id=${bid}`));
    assert.equal(deliveries.filter(d => d.state === 'delivered').length, 1); return { duplicateQueued: 0, delivered: 1, frozenFactsUnchanged: true };
  });
  report.passed = true;
}
async function execute() {
  try { await main(); } catch (e) { report.passed = false; report.error = (e as Error).stack; process.exitCode = 1; }
  finally {
    try {
      if (cid && actor!) await read(tx => cancelRuns(tx, actor, cid));
      if (bid) { const b = await followup.context(bid); if (b.status === 'enabled') await followup.change(bid, 'stop', Number(b.version), randomUUID()); }
      if (pid) { const p = (await owner.execute('detail', { projectId: pid })).project as Row;
        await owner.execute('update', { projectId: pid, expectedVersion: p.version, name: p.name, status: 'archived', customerAccess: false }, randomUUID()); }
      if (lid) await read(tx => tx.execute(sql`update app.leads set archived_at=now() where enterprise_id=${eid} and id=${lid} and name=${prefix}`));
      if (policy) { const current = reportPlanDto(await plan.settings(), eid), saved = reportPlanDto(policy, eid);
        await plan.configure({ expectedVersion: current.version, enabled: saved.enabled, stageEnabled: saved.stageEnabled, projectIds: saved.projectIds, stageKeys: saved.stageKeys,
          audiences: saved.audiences, dailyTime: saved.dailyTime, weeklyTime: saved.weeklyTime, weeklyDay: saved.weeklyDay, inactivePolicy: saved.inactivePolicy }, randomUUID()); }
      if (assistant) { await read(tx => tx.execute(sql`update app.assistant_enterprise_settings set enabled=${Boolean(assistant!.enabled)} where enterprise_id=${eid}`));
        const restored = await read(tx => one(tx, sql`select enabled,agent_config from app.assistant_enterprise_settings where enterprise_id=${eid}`)); assert.deepEqual(restored, assistant); }
      if (aid) await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status='disabled' where id=${aid} and username=${prefix}`));
      if (uid) await withPlatformTransaction(tx => tx.execute(sql`update app.users set context_version=context_version+1 where id=${uid} and nickname=${prefix}`));
      report.accountingAfter = await baseline(); if (report.accountingBefore) assert.deepEqual(report.accountingAfter, report.accountingBefore);
      const queue = await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`));
      report.queue = queue; assert.equal(queue!.n, 0); report.cleanup = true;
    } catch (e) { report.cleanup = false; report.cleanupError = (e as Error).stack; process.exitCode = 1; }
    const after = bind(), drift = Object.keys(before).filter(f => before[f] !== after[f]); report.drift = drift;
    if (drift.length) { report.passed = false; process.exitCode = 1; }
    fs.writeFileSync(path.join(output, 'binding.json'), JSON.stringify({ before, after }, null, 2)); report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ passed: report.passed, checks: checks.length, cleanup: report.cleanup, drift }));
  }
}
void execute().finally(async () => {
  // A missing bound file or failed evidence write must release resources too.
  try { if (release) await release(); } finally { await closePostgresPool(); }
}).catch(e => { console.error(e); process.exitCode = 1; });
