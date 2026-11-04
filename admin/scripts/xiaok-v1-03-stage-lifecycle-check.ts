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
const ownedBindingIds = new Set(bindingIds);
const prefix = retained.prefix;
const recipientLifecycle = process.argv.includes('--recipient-lifecycle');
const earlyStages = process.argv.includes('--early-stage-reminders');
assert.ok(!(earlyStages && recipientLifecycle));
const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/v1-03-stage-coverage/reminder-lifecycle-01');
fs.mkdirSync(output, { recursive: true });
const evidence = path.join(output, 'report.json');
const log: Row = { scope: recipientLifecycle ? 'V1-03 household and membership boundaries in isolated clone; body transport double only'
  : earlyStages ? 'V1-03 preparation and design reminders with no eligible evidence; isolated transport doubles only'
    : 'V1-03 current stage events and private delivery in isolated clone; body transport double only', checks: [], fixture: retained.fixture };
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
let extraLead: string | undefined;
let restoreMembership: (() => Promise<unknown>) | undefined;
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
    assert.ok(ownedBindingIds.has(String(run.binding_id)), 'Do not process an unowned job');
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
async function checkRecipients() {
  const customer = bindings.find(b => String(b.project_id) === projects[0])!;
  const other = bindings.find(b => String(b.project_id) === projects[1])!;
  const designer = bindings.find(b => b.audience === 'designer')!;
  await step('one homeowner receives and reopens two project-specific reminders; the other household stays private', async () => {
    extraLead = String((await read(tx => one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
      values(${eid},${String(customer.user_id)},${prefix+':lead:additional:'+randomUUID()},'13800000000','natural') returning id`)))!.id);
    const additional = String((await owner.execute('create', { leadId: extraLead, name: '合成验收·甲户第二套房', managerId: admins[1], rooms: ['厨房'] }, randomUUID())).id);
    revivedProjects.add(additional);
    const first = await service(customer).open(randomUUID(), projects[0]);
    const second = await service(customer).open(randomUUID(), additional);
    const firstBinding = String(first.bindingId), secondBinding = String(second.bindingId);
    const found = await read(tx => one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${secondBinding}`));
    assert.ok(found);
    resumedBindings.push(found);
    ownedBindingIds.add(secondBinding);
    assert.notEqual(first.conversationId, second.conversationId);
    assert.deepEqual((await service(customer).context(firstBinding)).projects.map(p => p.id), [projects[0]]);
    assert.deepEqual((await service(customer).context(secondBinding)).projects.map(p => p.id), [additional]);
    await assert.rejects(service(customer).context(firstBinding, { projectId: additional }), /construction_not_found/);
    await assert.rejects(service(other).context(secondBinding), /assistant_resource_not_found/);
    const { version, enabled, stageEnabled, dailyTime, weeklyTime, weeklyDay, projectIds, stageKeys, audiences, inactivePolicy } = reportPlanDto(await plan.settings(), eid);
    const activePlan = { enabled, stageEnabled, dailyTime, weeklyTime, weeklyDay, projectIds, stageKeys, audiences, inactivePolicy };
    await plan.configure({ ...activePlan, expectedVersion: version, projectIds: [projects[0], additional], audiences: ['customer'] }, randomUUID());
    const eventA = await progress(projects[0], 'design');
    const eventB = await progress(additional, 'furnishing');
    assert.equal(await tick(), 2);
    await drain();
    assert.equal(await deliverConstructionReports(eid), 2);
    const [receiptA] = await reports(eventA), [receiptB] = await reports(eventB);
    assert.deepEqual([receiptA.binding_id, receiptB.binding_id], [firstBinding, secondBinding]);
    assert.ok(receiptA.message_id && receiptB.message_id);
    for (const [bindingId, receipt, pid] of [[firstBinding, receiptA, projects[0]], [secondBinding, receiptB, additional]] as const) {
      const detail = await service(customer).detail(bindingId, String(receipt.id));
      assert.deepEqual(detail.facts?.projects.map(p => p.id), [pid]);
      assert.ok(detail.readToken);
      await service(customer).acknowledge(bindingId, String(receipt.id), 1, detail.readToken, randomUUID());
      assert.ok((await service(customer).detail(bindingId, String(receipt.id))).readAt);
    }
    await assert.rejects(service(customer).detail(firstBinding, String(receiptB.id)), /assistant_resource_not_found/);
    await assert.rejects(service(other).detail(secondBinding, String(receiptB.id)), /assistant_resource_not_found/);
    await status(additional, 'archived');
    await plan.configure({ ...activePlan, expectedVersion: Number((await plan.settings()).version) }, randomUUID());
    assert.deepEqual((await service(customer).list()).items.filter(b => b.bindingId === firstBinding || b.bindingId === secondBinding)
      .map(b => b.bindingId), [firstBinding]);
    return { projects: [projects[0], additional], conversations: [first.conversationId, second.conversationId], reports: [receiptA.id, receiptB.id], otherDenied: true };
  });
  await step('removing and regranting one project cannot deliver its queued reminder; the other project still arrives', async () => {
    const designerId = String(designer.admin_id);
    const setMembership = async (active: boolean) => owner.execute('member', { projectId: projects[0], expectedVersion: (await detail(projects[0])).version,
      adminId: designerId, role: 'designer', active, workLabel: '合成实模验收' }, randomUUID());
    const old = await progress(projects[0], 'installation');
    const independent = await progress(projects[1], 'utilities');
    assert.equal(await tick(), 8);
    restoreMembership = () => setMembership(true);
    await setMembership(false);
    assert.deepEqual((await service(designer).context(String(designer.id))).projects.map(p => p.id), [projects[1]]);
    await setMembership(true); restoreMembership = undefined;
    await drain();
    const delivered = await deliverConstructionReports(eid);
    const previous = (await reports(old)).find(r => r.binding_id === String(designer.id))!;
    const kept = (await reports(independent)).find(r => r.binding_id === String(designer.id))!;
    log.membershipObservation = { old: previous, independent: kept, delivered }; save();
    assert.equal(previous.status, 'failed');
    assert.equal(previous.error_code, 'context_changed');
    assert.equal(previous.body_run_id, null);
    assert.equal(previous.message_id, null);
    assert.equal(kept.delivery_state, 'delivered');
    assert.equal(delivered, 7);
    const followup = service(designer), bid = String(designer.id);
    assert.ok(!(await followup.reports(bid)).items.some(r => r.reportId === previous.id));
    const saved = await followup.detail(bid, String(kept.id));
    assert.deepEqual(saved.facts?.projects.map(p => p.id), [projects[1]]);
    assert.ok(saved.readToken);
    await followup.acknowledge(bid, String(kept.id), 1, saved.readToken, randomUUID());
    assert.ok((await service(designer).detail(bid, String(kept.id))).readAt);
    const inFlight = await progress(projects[0], 'painting');
    assert.equal(await tick(), 4); await drain(4);
    restoreMembership = () => setMembership(true);
    await setMembership(false);
    await setMembership(true); restoreMembership = undefined;
    const before = modelDoubles;
    await drain();
    assert.equal(modelDoubles - before, 3);
    assert.equal(await deliverConstructionReports(eid), 3);
    const revoked = (await reports(inFlight)).find(r => r.binding_id === bid)!;
    assert.equal(revoked.delivery_state, 'revoked');
    assert.equal(revoked.message_id, null);
    assert.deepEqual(await read(tx => one(tx, sql`select status,error_code from app.assistant_runs
      where enterprise_id=${eid} and id=${String(revoked.body_run_id)}`)), { status: 'failed', error_code: 'context_changed' });
    const fresh = await progress(projects[0], 'demolition');
    assert.equal(await tick(), 4); await drain(); assert.equal(await deliverConstructionReports(eid), 4);
    const replacement = (await reports(fresh)).find(r => r.binding_id === bid)!;
    assert.ok(replacement.message_id);
    assert.deepEqual((await service(designer).detail(bid, String(replacement.id))).facts?.projects.map(p => p.id), [projects[0]]);
    return { old: previous.id, revokedBeforeBody: revoked.id, independent: kept.id, newAfterRegrant: replacement.id };
  });
}
async function checkEarlyStages() {
  await step('preparation and design deliver separately to all four roles when workmanship is unavailable', async () => {
    const stages = [[projects[0], 'preparation'], [projects[1], 'design']] as const;
    const events = [];
    for (const [project, stage] of stages) events.push(await progress(project, stage));
    assert.equal(await tick(), 8);
    assert.equal(await tick(), 0);
    await drain();
    assert.equal(modelDoubles, 8);
    assert.equal(await deliverConstructionReports(eid), 8);
    assert.equal(await deliverConstructionReports(eid), 0);
    const destinations = new Set<string>();
    const deliveries = [];
    for (const [index, [projectId, stageKey]] of stages.entries()) {
      const saved = await reports(events[index]);
      const audiences: string[] = [];
      for (const receipt of saved) {
        const bindingId = String(receipt.binding_id), reportId = String(receipt.id);
        const recipient = bindings.find(b => String(b.id) === bindingId);
        assert.ok(recipient && receipt.body_run_id && receipt.message_id);
        assert.equal(receipt.delivery_state, 'delivered');
        audiences.push(String(recipient.audience)); destinations.add(bindingId);
        const followup = service(recipient);
        const view = await followup.detail(bindingId, reportId, 1);
        assert.deepEqual(view.facts?.projects.map(p => [p.id, p.stageKey, p.stageEvents[0]?.id]), [[projectId, stageKey, events[index].id]]);
        assert.ok('body' in view && view.contentStatus === 'composed' && view.readToken);
        assert.deepEqual(view.body.map(p => ({ projectId: p.projectId, standards: p.standards, sources: p.knowledgeSources })),
          [{ projectId, standards: [], sources: [] }]);
        await followup.acknowledge(bindingId, reportId, 1, view.readToken, randomUUID());
        const reopened = (await service(recipient).reports(bindingId)).items.find(item => item.reportId === reportId) as Row | undefined;
        assert.ok(reopened?.readAt);
        const wrongHome = bindings.find(b => b.audience === 'customer' && String(b.project_id) !== projectId)!;
        await assert.rejects(service(wrongHome).detail(bindingId, reportId, 1), /assistant_resource_not_found/);
        deliveries.push({ projectId, stageKey, audience: recipient.audience, bindingId, reportId });
      }
      assert.deepEqual(audiences.sort(), ['boss', 'customer', 'designer', 'worker']);
    }
    assert.equal(destinations.size, 5);
    return deliveries;
  });
}
async function main() {
  assert.equal(new URL(resolvePostgresRuntimeConfig().connectionString).pathname, url.pathname);
  release = await lockAssistantAcceptance(target, { waitForLock: true });
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
      await progress(projectId, earlyStages && projectId === projects[0] ? 'design' : 'preparation');
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
  if (recipientLifecycle) {
    await checkRecipients();
    log.passed = true;
    return;
  }
  if (earlyStages) {
    await checkEarlyStages();
    log.passed = true;
    return;
  }
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
  await restoreMembership?.();
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
  if (extraLead) await read(tx => tx.execute(sql`update app.leads set archived_at=now() where enterprise_id=${eid}
    and id=${extraLead} and name like ${prefix+':lead:additional:%'}`));
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
