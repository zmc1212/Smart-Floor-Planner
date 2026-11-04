import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { withTenantTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import type { ActorContext } from '@/lib/assistant/contracts';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { cancelRuns } from '@/lib/assistant/core/conversation';
import { ConstructionService } from '@/lib/construction/service';
import { ConstructionReportService, reportPlanDto } from '@/lib/construction/report-service';
import { advanceConstructionReports, deliverConstructionReports, processConstructionReport } from '@/lib/construction/report-worker';
import { processReportComposition } from '@/lib/construction/report-body-worker';
import { FollowupService } from '@/lib/construction/followup-service';
import { currentStageEvent } from '@/lib/construction/stage-events';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

// Use retained, labelled construction fixtures only in the isolated clone.
loadEnvConfig(process.cwd(), true);
const root = path.resolve('..'), eid = '1454';
const target = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL;
const url = new URL(target);
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '55432' && url.pathname === '/xiaok_embedding_eval');
process.env.DATABASE_URL = target;
const retained = JSON.parse(fs.readFileSync(path.resolve(process.argv.find(a => a.startsWith('--fixture='))?.slice(10)
  || '../tmp/v1-02-live-reports/terminal-scheduler05/report.json'), 'utf8'));
assert.ok(retained.cleanup === true && retained.prefix.startsWith('synthetic-report-composition-'));
const { projects, admins, users, bindingIds } = retained.fixture as { projects: string[]; admins: string[]; users: string[]; bindingIds: string[] };
assert.equal(projects.length, 2);
assert.equal(bindingIds.length, 5);
const prefix = retained.prefix;
const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/v1-03-stage-coverage/reminder-lifecycle-01');
fs.mkdirSync(output, { recursive: true });
const evidence = path.join(output, 'report.json');
const log: Row = { scope: 'V1-03 current stage events and private delivery in isolated clone; body transport double only', checks: [], fixture: retained.fixture };
fs.writeFileSync(evidence, JSON.stringify(log), { flag: 'wx' });
const save = () => fs.writeFileSync(evidence, JSON.stringify(log, null, 2));
const read = <T>(work: Parameters<typeof withTenantTransaction<T>>[1]) => withTenantTransaction(eid, work);
const owner = new ConstructionService({ enterpriseId: eid, adminId: admins[0] });
const plan = new ConstructionReportService(owner.actor);
const files = execFileSync('rg', ['--files', 'admin/src/lib/assistant', 'admin/src/lib/construction', 'admin/src/lib/ai', 'admin/src/db', 'admin/drizzle'],
  { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).map(p => p.replaceAll('\\', '/'));
files.push('admin/scripts/xiaok-v1-03-stage-lifecycle-check.ts', 'admin/scripts/assistant-acceptance-safety.mjs',
  'admin/package.json', 'admin/package-lock.json', 'admin/.env.local', 'tmp/xiaok-vector/connection.private.json',
  path.relative(root, path.resolve(process.argv.find(a => a.startsWith('--fixture='))?.slice(10)
    || '../tmp/v1-02-live-reports/terminal-scheduler05/report.json')));
const hashes = () => Object.fromEntries(files.sort().map(p => [p, createHash('sha256').update(fs.readFileSync(path.join(root, p))).digest('hex')]));
let release: (() => Promise<void>) | undefined, before: ReturnType<typeof hashes> | undefined, policy: Row | undefined;
let enabledByUs = false, assistantEnabledByUs = false, modelDoubles = 0;
const revivedProjects = new Set<string>(), revivedAdmins = new Set<string>(), resumedBindings: Row[] = [];
const bindings: Row[] = [];
let heldBoss: Row | undefined;
const actor = (b: Row): ActorContext => ({ enterpriseId: eid, principal: b.user_id ? { kind: 'user', userId: String(b.user_id) }
  : { kind: 'admin', adminId: String(b.admin_id) }, contextVersion: b.user_id ? 1 : 0, capabilities: ['assistant.followup.self'] });
const service = (b: Row) => new FollowupService(actor(b));
const bossMode = (b: Row, mode: 'ai' | 'human') => read(tx => tx.execute(sql`update app.assistant_conversations set mode=${mode}
  where enterprise_id=${eid} and id=${String(b.conversation_id)} and purpose='construction_followup'`));
const detail = async (projectId: string) => (await owner.execute('detail', { projectId })).project as Row;
const status = async (projectId: string, next: 'active' | 'paused' | 'archived') => {
  const p = await detail(projectId);
  return owner.execute('update', { projectId, expectedVersion: p.version, name: p.name, status: next, customerAccess: next !== 'archived' }, randomUUID());
};
const progress = async (projectId: string, stageKey: string, note = '合成阶段提醒生命周期检查') => {
  const p = await detail(projectId);
  await owner.execute('progress', { projectId, expectedVersion: p.version, stageKey, note, sendReminder: false }, randomUUID());
  return (await read(tx => one(tx, sql`select id::text,aggregate_version,created_at from app.domain_event_outbox where enterprise_id=${eid}
    and aggregate_id=${projectId} and type='construction.stage.updated.v1' order by aggregate_version desc limit 1`)))!;
};
const reports = (event: Row) => read(tx => rows(tx, sql`select r.id::text,r.binding_id::text,v.run_id::text,v.body_run_id::text,run.status,run.error_code,
    d.state as delivery_state,d.message_id::text from app.construction_reports r join app.construction_report_versions v
    on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=r.latest_revision
    join app.assistant_runs run on run.enterprise_id=v.enterprise_id and run.id=v.run_id
    left join app.construction_report_deliveries d on d.enterprise_id=r.enterprise_id and d.report_id=r.id and d.revision=v.revision
    where r.enterprise_id=${eid} and r.stage_event_id=${String(event.id)} order by r.binding_id`));
const tick = async () => {
  const at = (await read(tx => one(tx, sql`select clock_timestamp() as now`)))!.now;
  const result = await advanceConstructionReports(new Date(String(at)), eid);
  assert.deepEqual(result.errors, []);
  return result.queued;
};
const step = async (name: string, work: () => Promise<unknown>) => {
  try { (log.checks as Row[]).push({ name, passed: true, result: await work() }); console.log(name + ': PASS'); }
  catch (error) { (log.checks as Row[]).push({ name, passed: false, error: (error as Error).stack }); throw error; }
  finally { save(); }
};
async function drain(factsOnly = 0, forbidBody = false) {
  for (let i = 0; i < (factsOnly || 50); i++) {
    const lease = await claimJob();
    if (!lease) { assert.equal(factsOnly, 0, 'Expected all fixed facts jobs'); return; }
    assert.equal(lease.enterpriseId, eid);
    const run = (await read(tx => one(tx, sql`select r.purpose,p.binding_id::text from app.assistant_runs r join app.construction_report_versions v
      on v.enterprise_id=r.enterprise_id and (v.run_id=r.id or v.body_run_id=r.id)
      join app.construction_reports p on p.enterprise_id=v.enterprise_id and p.id=v.report_id where r.enterprise_id=${eid} and r.id=${lease.runId}`)))!;
    assert.ok(bindingIds.includes(String(run.binding_id)), 'Do not process an unowned job');
    if (run.purpose === 'construction.report.facts') await processConstructionReport(lease);
    else {
      assert.equal(factsOnly, 0);
      assert.equal(run.purpose, 'construction.report.compose');
      await processReportComposition(lease, {
        retriever: { retrieve: async () => { assert.ok(!forbidBody, 'Stale stage should fail before retrieval'); return []; } },
        model: async () => {
          modelDoubles++;
          assert.ok(!forbidBody, 'Stale stage should fail before dispatch');
          return { text: '', toolCalls: [{ id: 'isolated-stage-final', name: 'final_response', arguments: '{"P1_guidance":"review_original"}' }],
            finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 12, outputTokens: 4 } };
        },
      });
    }
  }
  assert.ok(factsOnly, 'Owned queue should drain');
}
async function main() {
  assert.equal(new URL(resolvePostgresRuntimeConfig().connectionString).pathname, url.pathname);
  release = await lockAssistantAcceptance(target);
  before = hashes();
  await step('reactivate only labelled fixtures; existing policy and queue idle', async () => {
    assert.equal((await read(tx => one(tx, sql`select name from app.enterprises where id=${eid}`)))?.name, '微云');
    assert.equal((await read(tx => one(tx, sql`select count(*)::int n from app.construction_report_deliveries
      where enterprise_id=${eid} and state in ('pending','held')`)))?.n, 0);
    const a = await read(tx => one(tx, sql`select enabled from app.assistant_enterprise_settings where enterprise_id=${eid}`));
    assert.equal(a?.enabled, false);
    assert.equal((await read(tx => one(tx, sql`select enabled from app.construction_report_settings where enterprise_id=${eid}`)))?.enabled, false);
    assert.equal((await read(tx => one(tx, sql`select count(*)::int n from app.construction_followup_bindings where enterprise_id=${eid}
      and audience='boss' and status='enabled' and admin_id<>${admins[0]}`)))?.n, 0);
    for (const id of admins) {
      assert.ok(await read(tx => one(tx, sql`update app.admin_users set status='active' where enterprise_id=${eid} and id=${id}
        and username like ${prefix+':%'} and status='disabled' returning id`)));
      revivedAdmins.add(id);
    }
    for (const projectId of projects) {
      assert.ok(await read(tx => one(tx, sql`select p.id from app.construction_projects p join app.leads l
        on l.enterprise_id=p.enterprise_id and l.id=p.lead_id where p.enterprise_id=${eid} and p.id=${projectId}
        and p.status='archived' and l.name like ${prefix+':lead:%'}`)));
      await status(projectId, 'active'); revivedProjects.add(projectId);
      await progress(projectId, 'preparation');
    }
    policy = await plan.settings();
    await read(tx => tx.execute(sql`update app.assistant_enterprise_settings set enabled=true where enterprise_id=${eid}`));
    assistantEnabledByUs = true;
    const { dailyTime, weeklyTime, weeklyDay, audiences, inactivePolicy } = reportPlanDto(policy, eid);
    await plan.configure({ dailyTime, weeklyTime, weeklyDay, audiences, inactivePolicy, expectedVersion: Number(policy.version),
      enabled: true, stageEnabled: true, projectIds: projects, stageKeys: [] }, randomUUID());
    enabledByUs = true;
    for (const id of bindingIds) {
      const b = (await read(tx => one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${id}`)))!;
      assert.equal(b.status, 'stopped');
      assert.ok(users.includes(String(b.user_id)) || admins.includes(String(b.admin_id)));
      await service(b).change(id, 'resume', Number(b.version), randomUUID());
      resumedBindings.push(b);
      bindings.push((await read(tx => one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${id}`)))!);
    }
    return { projects, bindingIds };
  });
  const boss = bindings.find(b => b.audience === 'boss')!, customerA = bindings.find(b => String(b.project_id) === projects[0])!;
  let originalA!: Row, originalB!: Row;
  await step('separate current reminders reach all five private destinations; held boss receives both projects', async () => {
    originalA = await progress(projects[0], 'installation');
    originalB = await progress(projects[1], 'utilities');
    await progress(projects[1], 'utilities', '合成：只改备注，不改变阶段事件');
    assert.equal(await tick(), 8); assert.equal(await tick(), 0);
    await drain();
    heldBoss = boss; await bossMode(boss, 'human');
    assert.equal(await deliverConstructionReports(eid), 6);
    for (const event of [originalA, originalB]) {
      const rr = await reports(event);
      assert.equal(rr.length, 4);
      assert.equal(rr.find(r => r.binding_id === String(boss.id))?.delivery_state, 'held');
    }
    await bossMode(boss, 'ai'); heldBoss = undefined;
    assert.equal(await deliverConstructionReports(eid), 2);
    for (const event of [originalA, originalB]) assert.ok((await reports(event)).every(r => r.delivery_state === 'delivered' && r.message_id));
    assert.equal(await deliverConstructionReports(eid), 0);
    return { events: [originalA.id, originalB.id], recipientMessages: 8, bossProjects: 2, modelDoubles };
  });
  await step('the delivered revision stays visible while a valid correction is queued', async () => {
    const old = (await reports(originalA)).find(r => r.binding_id === String(customerA.id))!;
    const bid = String(customerA.id), rid = String(old.id);
    const revised = await plan.correct(rid, 1, randomUUID());
    assert.equal(revised.revision, 2);
    const item = async () => (await service(customerA).reports(bid)).items.find(r => r.reportId === rid);
    assert.equal((await item())?.revision, 1);
    await drain(); assert.equal(await deliverConstructionReports(eid), 1);
    assert.equal((await item())?.revision, 2);
    return { reportId: rid, whileQueued: 1, afterDelivery: 2 };
  });
  await step('rollback before delivery revokes the old event without deleting history or dispatching stale composition', async () => {
    const old = await progress(projects[0], 'masonry_carpentry');
    assert.equal(await tick(), 4);
    await drain(4);
    const fresh = await progress(projects[0], 'installation');
    assert.notEqual(old.id, fresh.id);
    assert.equal(await deliverConstructionReports(eid), 0);
    await drain(0, true);
    const obsolete = await reports(old);
    assert.ok(obsolete.every(r => r.delivery_state === 'revoked' && r.message_id === null));
    for (const row of obsolete) assert.deepEqual(await read(tx => one(tx, sql`select status,error_code from app.assistant_runs
      where enterprise_id=${eid} and id=${String(row.body_run_id)}`)), { status: 'failed', error_code: 'context_changed' });
    const stageList = (await service(customerA).reports(String(customerA.id))).items;
    const prior = (await reports(originalA)).find(r => r.binding_id === String(customerA.id))!;
    assert.ok(stageList.some(r => r.reportId === prior.id && r.revision === 2 && r.available));
    assert.ok(!stageList.some(r => obsolete.some(o => o.id === r.reportId)));
    await assert.rejects(plan.correct(String(prior.id), 2, randomUUID()), /context_changed/);
    assert.equal(await tick(), 4); await drain();
    assert.equal(await deliverConstructionReports(eid), 4);
    return { old: old.id, fresh: fresh.id, historicalReport: prior.id };
  });
  await step('pause then resume with unchanged stage does not revive previously queued reminder', async () => {
    const old = await progress(projects[1], 'masonry_carpentry');
    assert.equal(await tick(), 4);
    await status(projects[1], 'paused'); await status(projects[1], 'active');
    assert.ok(await read(tx => currentStageEvent(tx, eid, String(old.id))), 'Original same-key check would accept the event');
    await drain();
    assert.ok((await reports(old)).every(r => r.status === 'failed' && r.error_code === 'context_changed' && r.body_run_id === null));
    assert.equal(await deliverConstructionReports(eid), 0);
    assert.equal(await tick(), 0);
    const next = await progress(projects[1], 'utilities');
    assert.equal(await tick(), 4); await drain();
    assert.equal(await deliverConstructionReports(eid), 4);
    return { originalSameKeyCheck: true, expiredEvent: old.id, acceptedAfterNewEvent: next.id };
  });
  await step('completion and move-in do not send reminders; previous receipt remains available until archive', async () => {
    const completion = await progress(projects[0], 'completion');
    assert.equal(await tick(), 0);
    const moveIn = await progress(projects[0], 'move_in');
    assert.equal(await tick(), 0);
    assert.deepEqual(await reports(completion), []); assert.deepEqual(await reports(moveIn), []);
    const saved = (await reports(originalA)).find(r => r.binding_id === String(customerA.id))!;
    const view = await service(customerA).detail(String(customerA.id), String(saved.id), 2);
    assert.ok(view.available && view.readToken);
    await service(customerA).acknowledge(String(customerA.id), String(saved.id), 2, view.readToken, randomUUID());
    assert.ok((await service(customerA).detail(String(customerA.id), String(saved.id), 2)).readAt);
    await status(projects[0], 'archived');
    const denied = await service(customerA).detail(String(customerA.id), String(saved.id), 1).then(r => !r.available, (error: Error) => /not_found/.test(error.message));
    assert.ok(denied);
    return { completion: completion.id, moveIn: moveIn.id, historicalRead: saved.id, archiveDenied: denied };
  });
  log.passed = true;
}
async function cleanup() {
  if (!release) return;
  if (heldBoss) await bossMode(heldBoss, 'ai');
  if (enabledByUs && policy) {
    const { enabled, stageEnabled, dailyTime, weeklyTime, weeklyDay, projectIds, stageKeys, audiences, inactivePolicy } = reportPlanDto(policy, eid);
    await plan.configure({ enabled, stageEnabled, dailyTime, weeklyTime, weeklyDay, projectIds, stageKeys, audiences, inactivePolicy,
      expectedVersion: Number((await plan.settings()).version) }, randomUUID());
  }
  for (const b of resumedBindings) {
    await read(async tx => {
      await cancelRuns(tx, actor(b), String(b.conversation_id));
      await tx.execute(sql`update app.construction_followup_bindings set status='stopped',version=version+1
        where enterprise_id=${eid} and id=${String(b.id)} and conversation_id=${String(b.conversation_id)}`);
      await tx.execute(sql`update app.construction_report_deliveries set state='revoked'
        where enterprise_id=${eid} and binding_id=${String(b.id)} and state in ('pending','held')`);
    });
  }
  for (const p of revivedProjects) if ((await detail(p)).status !== 'archived') await status(p, 'archived');
  for (const id of revivedAdmins) await read(tx => tx.execute(sql`update app.admin_users set status='disabled'
    where enterprise_id=${eid} and id=${id} and username like ${prefix+':%'}`));
  if (assistantEnabledByUs) await read(tx => tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${eid}`));
  const after = hashes(), drift = Object.keys(after).filter(file => before?.[file] !== after[file]);
  fs.writeFileSync(path.join(output, 'binding.json'), JSON.stringify({ before, after, drift }, null, 2));
  log.cleanup = true; log.drift = drift; log.modelDoubles = modelDoubles;
  assert.deepEqual(drift, []);
}
main().catch(e => { log.passed = false; log.error = e.stack; process.exitCode = 1; }).finally(async () => {
  try { await cleanup(); } catch (e) { log.cleanupError = (e as Error).stack; process.exitCode = 1; }
  finally { try { await closePostgresPool(); } finally { await release?.(); save(); } }
});
