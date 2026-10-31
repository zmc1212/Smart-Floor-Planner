/** V1-02 deterministic service acceptance. No Agent/knowledge/provider invocation
 * and no claim of native or full four-role business acceptance. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { type ActorContext } from '@/lib/assistant/contracts';
import { appendMessage, ConversationService } from '@/lib/assistant/core/conversation';
import { ConstructionService } from '@/lib/construction/service';
import { SiteChatService, recordVersion } from '@/lib/construction/site-chat';
import { ConstructionReportService } from '@/lib/construction/report-service';
import { FollowupService } from '@/lib/construction/followup-service';
import { advanceConstructionReports, deliverConstructionReports } from '@/lib/construction/report-worker';
import { enqueueReport, ensureFollowupBinding } from '@/lib/construction/report-store';
import { latestReportPeriod, nextReportAt } from '@/lib/construction/report-calendar';
import type { ReportFacts } from '@/lib/construction/report-scope';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

loadEnvConfig(process.cwd(), true);
const root = path.resolve('..'), eid = '1454';
const output = path.resolve(process.argv.find(v => v.startsWith('--output='))?.slice(9) || '../tmp/v1-02-proactive-foundation/service-01');
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Retain original failed/successful batches; repeats require a named reason and new output');
fs.mkdirSync(output, { recursive: true });
const prefix = 'synthetic-v1-02-' + randomUUID();
const boundariesOnly = process.argv.includes('--delivery-boundaries-only');
const firstEnableOnly = process.argv.includes('--first-enable-only');
assert.ok(!firstEnableOnly || !boundariesOnly, 'Keep fixed acceptance scopes separate');
const report: { checks: Row[]; fixture: Row; [key: string]: unknown } = { startedAt: new Date().toISOString(), prefix, enterpriseId: eid,
  scope: firstEnableOnly ? 'first valid enablement binding discovery only; no report/model/native run' : boundariesOnly ? 'stage timestamp and stop/resume delivery boundaries only; reuse service-02 for unchanged scope' : 'fixed deterministic backend matrix', checks: [], fixture: {} };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const step = async (name: string, work: () => Promise<unknown>) => {
  try { const result = await work(); report.checks.push({ name, passed: true, result }); console.log(name + ': PASS'); return result; }
  catch (error) { report.checks.push({ name, passed: false, error: (error as Error).message }); throw error; }
  finally { save(); }
};
const sourcePaths = execFileSync('rg', ['--files', 'admin/src/lib/assistant', 'admin/src/lib/construction', 'admin/src/db', 'admin/src/lib/ai', 'admin/drizzle'], { cwd: root, encoding: 'utf8' })
  .trim().split(/\r?\n/).map(p => p.replaceAll('\\', '/')).filter(p => !p.includes('/__tests__/'));
sourcePaths.push('admin/src/app/api/internal/assistant/jobs/run/route.ts', 'admin/scripts/xiaok-v1-02-reports-check.ts', 'admin/scripts/assistant-acceptance-safety.mjs',
  'admin/package.json', 'admin/package-lock.json', 'admin/tsconfig.json', 'admin/.env.local');
const binding = () => Object.fromEntries([...new Set(sourcePaths)].filter(f => fs.existsSync(path.join(root, f))).sort().map(f => [f, createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')]));
const beforeBinding = binding();
const bindCheck = () => {
  const after = binding(), drift = Object.keys(beforeBinding).filter(f => beforeBinding[f] !== after[f]);
  fs.writeFileSync(path.join(output, 'binding.json'), JSON.stringify({ before: beforeBinding, after, drift }, null, 2)); assert.deepEqual(drift, []);
};
let release: (() => Promise<void>) | undefined, settingsBefore: Row | undefined;
let assistantEnabledBefore: boolean | undefined, enabledInput!: Row, enabledKey = '';
const users: string[] = [], admins: string[] = [], projects: string[] = [], muted: Row[] = [], fixtureBindings: string[] = [];
const read = <T>(work: Parameters<typeof withTenantTransaction<T>>[1]) => withTenantTransaction(eid, work);
const staffActor = (adminId: string): ActorContext => ({ enterpriseId: eid, principal: { kind: 'admin', adminId }, contextVersion: 0, capabilities: ['assistant.followup.self'] });
const customerActor = (i = 0): ActorContext => ({ enterpriseId: eid, principal: { kind: 'user', userId: users[i] }, contextVersion: 1, capabilities: ['assistant.followup.self'] });
let owner!: ConstructionService, config!: ConstructionReportService;
const baseline = async () => withPlatformTransaction(async tx => ({
  providerMax: String((await one(tx, sql`select coalesce(max(id),0) id from app.ai_provider_attempts`))!.id),
  knowledgeMax: String((await one(tx, sql`select coalesce(max(id),0) id from app.assistant_knowledge_attempts`))!.id),
  closure3753: await one(tx, sql`select id::text,status from app.assistant_knowledge_attempts where id=3753`),
}));
async function drain() {
  const started = Date.now();
  while (Date.now() - started < 120000) {
    const active = await read(tx => one(tx, sql`select count(*)::int n from app.assistant_runs r join app.construction_report_versions v
      on v.enterprise_id=r.enterprise_id and v.run_id=r.id join app.construction_reports p on p.enterprise_id=v.enterprise_id and p.id=v.report_id
      where r.enterprise_id=${eid} and ${JSON.stringify(fixtureBindings)}::jsonb ? p.binding_id::text and r.status in ('queued','running')`));
    if (!active?.n) return;
    const response = await fetch('http://localhost:3006/api/internal/assistant/jobs/run', { method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET! }, signal: AbortSignal.timeout(180000) });
    assert.ok(response.ok, 'Real Worker endpoint must remain available');
    const body = await response.json(); assert.equal(body.success, true); assert.ok(body.data.constructionReportChecks, 'Worker must load the bound new assembly');
  }
  throw Error('Owned local report jobs remain active; keep original runs for recovery');
}
async function originalRecord(pid: string, text: string, audience: 'customer' | 'internal', at: Date) {
  const staff = new SiteChatService({ enterpriseId: eid, adminId: admins[1] });
  const r = await staff.withWriteScope(pid, async (tx, c) => {
    const message = await appendMessage(tx, staff.actor, String(c.id), { author: 'admin', clientMessageId: randomUUID(), purpose: 'site.source', content: { version: 1, blocks: [{ type: 'text', text }] } });
    // Labelled deterministic input draft, not a fabricated model completion.
    const row = (await one(tx, sql`insert into app.construction_site_records(enterprise_id,project_id,conversation_id,source_message_id,author_id,status,data)
      values(${eid},${pid},${String(c.id)},${String(message.id)},${admins[1]},'draft',
      ${JSON.stringify({ title: '合成测试·现场原记录', roomId: null, completed: '', pending: text, coordination: '', note: '自动报告工程夹具，无模型生成' })}::jsonb) returning *`))!;
    await recordVersion(tx, eid, row, admins[1], 'organized'); return row;
  });
  const manager = new SiteChatService(owner.actor);
  await manager.mutate(pid, String(r.id), 'publish', { expectedVersion: Number(r.version), audience }, randomUUID());
  await read(tx => tx.execute(sql`update app.construction_site_records set published_at=${at} where enterprise_id=${eid} and id=${String(r.id)}`));
  return String(r.id);
}
async function main() {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(process.argv.includes('--development') && ['localhost','127.0.0.1'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
  const control = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL;
  release = await lockAssistantAcceptance(control, { waitForLock: true });
  assert.equal((await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`)))?.n, 0);
  report.accountingBefore = await baseline(); bindCheck();
  await step('Weiyun scope, disabled policy and labelled fixture services', async () => {
    assert.equal((await read(tx => one(tx, sql`select name from app.enterprises where id=${eid}`)))?.name, '微云');
    settingsBefore = await read(tx => one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid}`));
    assert.ok(!settingsBefore?.enabled, 'Never replace a live report policy for acceptance');
    await withPlatformTransaction(async tx => {
      for (let i = 0; i < 3; i++) {
        const uid = String((await one(tx, sql`insert into app.users(nickname,phone,context_version) values(${prefix + ':customer:' + i},${'139' + String(Date.now()).slice(-7) + i},1) returning id`))!.id); users.push(uid);
        await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${prefix + ':' + i})`);
      }
      for (const [i, role] of ['enterprise_admin','construction_staff','designer','admin','super_admin'].entries()) admins.push(String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,display_name,password_hash,role,status,must_change_password)
        values(${i < 3 ? eid : null},${prefix + ':' + role},${'合成测试·' + role},'unusable-local-fixture',${role},'active',false) returning id`))!.id));
    });
    owner = new ConstructionService({ enterpriseId: eid, adminId: admins[0] }); config = new ConstructionReportService(owner.actor);
    for (let i = 0; i < 2; i++) {
      const lead = (await read(tx => one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(${eid},${users[i]},${prefix + ':lead:' + i},${'138' + String(Date.now()).slice(-7) + i},'natural') returning id`)))!;
      const pid = String((await owner.execute('create', { leadId: String(lead.id), name: '合成测试·V1-02工地' + i, managerId: admins[1], rooms: ['客厅'] }, randomUUID())).id); projects.push(pid);
      await owner.execute('member', { projectId: pid, expectedVersion: ((await owner.execute('detail', { projectId: pid })).project as Row).version,
        adminId: admins[2], role: 'designer', active: true, workLabel: '合成验收' }, randomUUID());
    }
    // Mute only newly created empty test bindings for non-fixture owners. No real
    // messages, existing preferences or existing conversations are changed.
    await read(async tx => {
      const others = await rows(tx, sql`select id from app.admin_users where enterprise_id=${eid} and role='enterprise_admin' and status='active' and id<>${admins[0]}`);
      for (const a of others) {
        assert.ok(!await one(tx, sql`select id from app.construction_followup_bindings where enterprise_id=${eid} and principal_key=${'admin:' + String(a.id)} and audience='boss'`), 'Existing owner follow-up requires a separate fixture scope');
        const b = await ensureFollowupBinding(tx, eid, { kind: 'admin', id: String(a.id), audience: 'boss' }); muted.push(b);
        await tx.execute(sql`update app.construction_followup_bindings set status='stopped' where enterprise_id=${eid} and id=${String(b.id)}`);
      }
    });
    report.fixture = { users, admins, projects, mutedBindingIds: muted.map(b => String(b.id)) };
    enabledInput = { expectedVersion: Number(settingsBefore?.version || 0), enabled: true, dailyTime: '20:00', weeklyTime: '08:00', projectIds: projects, stageKeys: firstEnableOnly ? [] : ['utilities'] }; enabledKey = randomUUID();
    if (firstEnableOnly) {
      assistantEnabledBefore = Boolean((await read(tx => one(tx, sql`select enabled from app.assistant_enterprise_settings where enterprise_id=${eid}`)))?.enabled);
      assert.equal(assistantEnabledBefore, true);
      await read(tx => tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${eid}`));
      const deferred = await config.configure(enabledInput, randomUUID());
      const premature = await read(tx => rows(tx, sql`select id from app.construction_followup_bindings where enterprise_id=${eid}
        and (user_id in (${users[0]},${users[1]}) or admin_id in (${admins[0]},${admins[1]},${admins[2]}))`));
      assert.equal(premature.length, 0, 'Disabled assistant cannot create follow-up destinations');
      await read(tx => tx.execute(sql`update app.assistant_enterprise_settings set enabled=${assistantEnabledBefore} where enterprise_id=${eid}`));
      enabledInput = { ...enabledInput, expectedVersion: Number(deferred.version) };
      report.assistantDisabledGate = { noPrematureBindings: true, policyRetained: deferred.enabled };
    }
    const policy = await config.configure(enabledInput, enabledKey);
    return { users, admins, projects, nextDaily: policy.next_daily_at, nextWeekly: policy.next_weekly_at };
  });
  if (firstEnableOnly) {
    const bindings = await read(tx => rows(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid}
      and (user_id in (${users[0]},${users[1]}) or admin_id in (${admins[0]},${admins[1]},${admins[2]})) order by id`));
    fixtureBindings.push(...bindings.map(b => String(b.id))); report.fixture.bindingIds = fixtureBindings;
    const services = [new FollowupService(customerActor()), new FollowupService(staffActor(admins[1])), new FollowupService(staffActor(admins[2])), new FollowupService(staffActor(admins[0]))];
    await step('enablement alone discovers four private audiences before any due tick or client open', async () => {
      assert.equal(bindings.length, 5); assert.deepEqual(bindings.map(b => b.audience).sort(), ['boss','customer','customer','designer','worker']);
      for (const s of services) assert.equal((await s.list()).items.length, 1);
      assert.equal((await read(tx => one(tx, sql`select count(*)::int n from app.construction_reports where enterprise_id=${eid}
        and ${JSON.stringify(fixtureBindings)}::jsonb ? binding_id::text`)))!.n, 0);
      assert.equal((await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`)))!.n, 0);
      return { bindings: fixtureBindings, reportCount: 0, dueTick: false, clientOpen: false };
    });
    await step('same-key policy reentry and staff denial preserve binding identity', async () => {
      const saved = await config.settings(), repeat = await config.configure(enabledInput, enabledKey); assert.equal(repeat.version, saved.version);
      await assert.rejects(new ConstructionReportService({ enterpriseId: eid, adminId: admins[1] }).configure({ ...enabledInput, expectedVersion: saved.version }, randomUUID()));
      const ids = await read(tx => rows(tx, sql`select id::text from app.construction_followup_bindings where enterprise_id=${eid}
        and (user_id in (${users[0]},${users[1]}) or admin_id in (${admins[0]},${admins[1]},${admins[2]})) order by id`));
      assert.deepEqual(ids.map(b => b.id), fixtureBindings); return { sameVersion: repeat.version, duplicateBindings: 0, workerDenied: true };
    });
    await step('reconfiguration cannot revive stopped, deleted or retention-redacted destinations', async () => {
      const worker = bindings.find(b => b.audience === 'worker')!, designer = bindings.find(b => b.audience === 'designer')!, customer = bindings.find(b => String(b.user_id) === users[0])!;
      await services[1].change(String(worker.id), 'stop', Number(worker.version), randomUUID());
      await services[2].change(String(designer.id), 'delete', Number(designer.version), randomUUID());
      await read(tx => tx.execute(sql`update app.assistant_conversations set entry_snapshot=entry_snapshot || '{"retentionRedacted":true}'::jsonb
        where enterprise_id=${eid} and id=${String(customer.conversation_id)}`));
      const current = await config.settings();
      await config.configure({ ...enabledInput, expectedVersion: Number(current.version), dailyTime: '21:00' }, randomUUID());
      const result = await read(tx => rows(tx, sql`select id::text,status,conversation_id::text from app.construction_followup_bindings where enterprise_id=${eid}
        and ${JSON.stringify(fixtureBindings)}::jsonb ? id::text order by id`));
      assert.deepEqual(result.map(b => b.id), fixtureBindings);
      assert.equal(result.find(b => b.id === String(worker.id))!.status, 'stopped'); assert.equal(result.find(b => b.id === String(designer.id))!.status, 'deleted');
      assert.equal(result.find(b => b.id === String(customer.id))!.conversation_id, String(customer.conversation_id));
      assert.equal((await services[0].list()).items.length, 0);
      assert.equal((await services[2].list()).items.length, 0); return { identitiesUnchanged: true, stopped: worker.id, deleted: designer.id, redacted: customer.id };
    });
    await step('binding-only discovery adds no model/knowledge attempts and keeps source stable', async () => {
      report.accountingAfter = await baseline(); assert.deepEqual(report.accountingAfter, report.accountingBefore); bindCheck();
      return { providerCalls: 0, knowledgeCalls: 0, reportCount: 0, closure3753Unchanged: true, drift: [] };
    });
    report.passed = true; return;
  }
  const policy = await config.settings(), dailyAt = new Date(String(policy.next_daily_at)), period = latestReportPeriod('daily', dailyAt, '20:00');
  const weeklyAt = nextReportAt('weekly', dailyAt, '08:00');
  if (boundariesOnly) {
    const opened = await new FollowupService(customerActor()).open(randomUUID(), projects[0]);
    await read(tx => tx.execute(sql`update app.assistant_conversations set mode='human' where enterprise_id=${eid} and id=${String(opened.conversationId)}`));
  }
  const recordIds: string[] = [];
  await step('real stage changes and explicit record publication without model dispatch', async () => {
    for (const pid of projects) await owner.execute('progress', { projectId: pid, expectedVersion: ((await owner.execute('detail', { projectId: pid })).project as Row).version,
      stageKey: 'utilities', note: '合成测试：实际确认水电阶段', sendReminder: false }, randomUUID());
    recordIds.push(await originalRecord(projects[0], 'A户插座位置仍待客户确认，不代表已确认。', 'customer', new Date(period.start.getTime() + 10 * 3600000)));
    recordIds.push(await originalRecord(projects[0], '内部交接草稿只在内部发布，不给业主。', 'internal', new Date(period.start.getTime() + 11 * 3600000)));
    recordIds.push(await originalRecord(projects[1], 'B户照明回路待设计师核对，未记录完成期限。', 'customer', new Date(period.start.getTime() + 12 * 3600000)));
    await Promise.all([advanceConstructionReports(dailyAt, eid), advanceConstructionReports(dailyAt, eid), advanceConstructionReports(dailyAt, eid)]);
    const bindings = await read(tx => rows(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid}
      and (user_id in (${users[0]},${users[1]}) or admin_id in (${admins[0]},${admins[1]},${admins[2]}))`));
    fixtureBindings.push(...bindings.map(b => String(b.id))); report.fixture.bindingIds = fixtureBindings;
    await drain(); await deliverConstructionReports(eid);
    assert.equal(bindings.length, 5); return { recordIds, bindings: bindings.map(b => ({ id: String(b.id), audience: b.audience, conversationId: String(b.conversation_id) })) };
  });
  const services = [new FollowupService(customerActor()), new FollowupService(staffActor(admins[1])), new FollowupService(staffActor(admins[2])), new FollowupService(staffActor(admins[0]))];
  const bindings = await Promise.all(services.map(async s => (await s.list()).items[0]));
  const dailyViews = await Promise.all(services.map(async (s, i) => ((await s.reports(bindings[i].bindingId)).items as Row[]).find(r => r.kind === 'daily')!));
  if (boundariesOnly) {
    await step('stage cutoff retains the actual microsecond source event and its recorded stage', async () => {
      const stage = ((await services[0].reports(bindings[0].bindingId)).items as Row[]).find(r => r.kind === 'stage')!;
      const project = (stage.facts as ReportFacts).projects[0];
      assert.equal(project.stageKey, 'utilities');
      const event = (await read(tx => one(tx, sql`select stage_event_id::text from app.construction_reports where enterprise_id=${eid} and id=${String(stage.reportId)}`)))!;
      assert.ok(project.stageEvents.some(e => e.id === event.stage_event_id));
      return { reportId: stage.reportId, sourceEventId: event.stage_event_id, stageKey: project.stageKey };
    });
    await step('stop/resume after generation revokes the prior pending delivery without erasing its facts', async () => {
      let b = (await services[0].list()).items[0];
      assert.equal((await services[0].detail(b.bindingId, String(dailyViews[0].reportId)) as Row).deliveryState, 'held');
      await services[0].change(b.bindingId, 'stop', b.version, randomUUID()); b = (await services[0].list()).items[0];
      await services[0].change(b.bindingId, 'resume', b.version, randomUUID());
      await read(tx => tx.execute(sql`update app.assistant_conversations set mode='ai' where enterprise_id=${eid} and id=${b.conversationId}`));
      await deliverConstructionReports(eid);
      const view = await services[0].detail(b.bindingId, String(dailyViews[0].reportId));
      assert.equal(view.state, 'facts_ready'); assert.equal((view as Row).deliveryState, 'revoked'); assert.equal(view.sequence, null);
      return { reportId: view.reportId, factsRetained: true, priorDeliveryRevoked: true, messageInserted: false };
    });
    await step('retention marker prevents report rehydration, unread metadata and new scheduling', async () => {
      const boss = services[3], b = (await boss.list()).items[0], rid = String(dailyViews[3].reportId);
      assert.equal((await boss.detail(b.bindingId, rid)).available, true);
      await boss.change(b.bindingId, 'archive', b.version, randomUUID());
      // Apply the exact existing retention service marker to this owned fixture.
      // This is compatibility evidence, not a whole-tenant retention apply run.
      await read(tx => tx.execute(sql`update app.assistant_conversations set entry_snapshot='{"retentionRedacted":true,"retentionVersion":1}'::jsonb
        where enterprise_id=${eid} and id=${b.conversationId}`));
      await assert.rejects(() => boss.detail(b.bindingId, rid), /assistant_resource_not_found/);
      assert.equal((await boss.list()).items.length, 0);
      const attempted = await read(async tx => {
        const binding = (await one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${b.bindingId}`))!;
        return enqueueReport(tx, eid, binding, policy, latestReportPeriod('daily', new Date(dailyAt.getTime() + 86400000), '20:00'));
      });
      assert.equal(attempted, null); await deliverConstructionReports(eid);
      return { reportRehydrated: false, unreadMetadataVisible: false, newTaskCreated: false, underlyingBusinessRecordsDeleted: false };
    });
    await step('boundary checks preserve provider/knowledge attempts and the fixed source binding', async () => {
      report.accountingAfter = await baseline(); assert.deepEqual(report.accountingAfter, report.accountingBefore); bindCheck();
      return { providerCalls: 0, knowledgeCalls: 0, drift: [] };
    });
    report.passed = true;
    return;
  }
  await step('four private audiences, two project groups, internal exclusion and no shared destination', async () => {
    assert.deepEqual((dailyViews[0].facts as ReportFacts).projects.map(p => p.id), [projects[0]]);
    assert.equal((dailyViews[0].facts as ReportFacts).projects[0].records.length, 1);
    for (const view of dailyViews.slice(1)) {
      assert.deepEqual((view.facts as ReportFacts).projects.map(p => p.id), projects);
      assert.equal((view.facts as ReportFacts).projects[0].records.length, 2);
      assert.equal(view.contentStatus, 'facts_only');
    }
    assert.equal(new Set(bindings.map(b => b.conversationId)).size, 4);
    const wrong = new FollowupService(customerActor(1));
    await assert.rejects(() => wrong.detail(bindings[0].bindingId, String(dailyViews[0].reportId)));
    const shared = await read(tx => rows(tx, sql`select conversation_id::text from app.construction_chats where enterprise_id=${eid} and project_id in (${projects[0]},${projects[1]})`));
    assert.ok(bindings.every(b => !shared.some(c => c.conversation_id === b.conversationId)));
    assert.equal((await withTenantTransaction('2567', tx => one(tx, sql`select count(*)::int n from app.construction_reports where enterprise_id=${eid}`)))?.n, 0);
    return { privateDestinations: 4, projectGroups: 2, customerInternalExcluded: true, currentSourceIds: recordIds };
  });
  await step('unread, detail, report acknowledgement and conversation visibility stay distinct', async () => {
    const s = services[0], b = bindings[0], d = dailyViews[0];
    const before = (await s.list()).items[0]; assert.ok(before.unreadReports >= 1);
    const detail = await s.detail(b.bindingId, String(d.reportId)); assert.equal((await s.list()).items[0].unreadReports, before.unreadReports);
    const k = randomUUID(), first = await s.acknowledge(b.bindingId, String(d.reportId), Number(d.revision), String(detail.readToken), k);
    assert.deepEqual(await s.acknowledge(b.bindingId, String(d.reportId), Number(d.revision), String(detail.readToken), k), first);
    assert.equal((await s.list()).items[0].unreadReports, before.unreadReports - 1);
    assert.equal((await s.list()).items[0].unreadMessages, before.unreadMessages);
    await s.seen(b.bindingId, String(detail.sequence), randomUUID());
    const reentry = new FollowupService(customerActor()); assert.ok((await reentry.detail(b.bindingId, String(d.reportId))).readAt);
    return { readOnList: false, readOnDetail: false, explicitAck: true, persistedReentry: true };
  });
  await step('ordinary new consultations and repeated ticks never change the fixed destination', async () => {
    const cid = bindings[0].conversationId;
    await new ConversationService({ ...customerActor(), capabilities: ['assistant.chat.self'] }).create(randomUUID());
    await advanceConstructionReports(dailyAt, eid); await Promise.all([deliverConstructionReports(eid), deliverConstructionReports(eid)]);
    assert.equal((await services[0].list()).items[0].conversationId, cid);
    const duplicates = await read(tx => rows(tx, sql`select report_id,revision,binding_id,count(*) from app.construction_report_deliveries
      where enterprise_id=${eid} group by report_id,revision,binding_id having count(*)>1`)); assert.equal(duplicates.length, 0);
    return { sameDestination: cid, duplicateDeliveries: 0 };
  });
  await step('management inheritance uses the selected tenant without knowledge-preview grants', async () => {
    for (const aid of [admins[0], admins[3], admins[4]]) assert.equal((await new ConstructionReportService({ enterpriseId: eid, adminId: aid }).settings()).enabled, true);
    await assert.rejects(() => new ConstructionReportService({ enterpriseId: eid, adminId: admins[1] }).settings());
    const opened = await new FollowupService(staffActor(admins[3])).open(randomUUID()); fixtureBindings.push(String(opened.bindingId));
    assert.notEqual(opened.conversationId, bindings[3].conversationId);
    return { ownerAdminSuperAdmin: true, workerConfigDenied: true, platformOptInIsPrivate: true };
  });
  await step('daily correction retains the old snapshot and adds a distinct supplemental version', async () => {
    const rid = String(dailyViews[0].reportId);
    const old = await read(tx => one(tx, sql`select facts_hash from app.construction_report_versions where enterprise_id=${eid} and report_id=${rid} and revision=1`));
    const lateId = await originalRecord(projects[0], '补记：开关高度仍待本人确认。', 'customer', new Date(dailyAt.getTime() + 3600000)); recordIds.push(lateId);
    const k = randomUUID(), corrected = await config.correct(rid, 1, k, new Date(dailyAt.getTime() + 2 * 3600000));
    assert.deepEqual(await config.correct(rid, 1, k, new Date(dailyAt.getTime() + 3 * 3600000)), corrected);
    await drain(); await deliverConstructionReports(eid);
    const current = await services[0].detail(bindings[0].bindingId, rid, 2); assert.equal(current.revision, 2);
    assert.ok(current.facts!.projects[0].records.some(r => r.id === lateId));
    assert.equal((await read(tx => one(tx, sql`select facts_hash from app.construction_report_versions where enterprise_id=${eid} and report_id=${rid} and revision=1`)))?.facts_hash, old?.facts_hash);
    return { sameReportId: rid, revision: 2, immutableOriginal: true, lateRecordId: lateId };
  });
  await step('weekly runs persist while the recipient is in human mode and deliver after resume', async () => {
    await read(tx => tx.execute(sql`update app.assistant_conversations set mode='human' where enterprise_id=${eid} and id=${bindings[3].conversationId}`));
    await advanceConstructionReports(weeklyAt, eid); await drain(); await deliverConstructionReports(eid);
    const weekly = ((await services[3].reports(bindings[3].bindingId)).items as Row[]).find(r => r.kind === 'weekly')!;
    assert.equal(weekly.state, 'facts_ready'); assert.equal(weekly.deliveryState, 'held');
    assert.equal((weekly.facts as ReportFacts).projects.length, 2);
    await read(tx => tx.execute(sql`update app.assistant_conversations set mode='ai' where enterprise_id=${eid} and id=${bindings[3].conversationId}`));
    await deliverConstructionReports(eid); assert.equal((await services[3].detail(bindings[3].bindingId, String(weekly.reportId)) as Row).deliveryState, 'delivered');
    return { independentWeeklyPeriod: true, heldWithoutAiResume: true, deliveredAfterExplicitResume: true };
  });
  await step('no-record daily stays truthful; archive reopens only on a real new delivery', async () => {
    const boss = (await services[3].list()).items[0]; await services[3].change(boss.bindingId, 'archive', boss.version, randomUUID());
    const next = new Date(weeklyAt.getTime() + 2 * 86400000 + 12 * 3600000);
    await advanceConstructionReports(next, eid); await drain(); await deliverConstructionReports(eid);
    const view = ((await services[3].reports(boss.bindingId)).items as Row[]).find(r => r.kind === 'daily')!;
    assert.ok((view.facts as ReportFacts).projects.every(p => p.noPublishedRecords && p.records.length === 0));
    assert.equal((await services[3].list()).items[0].conversationStatus, 'open');
    report.fixture.recoveryClock = next.toISOString();
    return { noRecordedProgressIsNotNoConstruction: true, sameConversation: boss.conversationId };
  });
  await step('expired lease recovery commits once; a known local authorization failure keeps its original retry job', async () => {
    const b = await read(tx => one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${bindings[0].bindingId}`));
    const next = new Date(String(report.fixture.recoveryClock));
    const leaseRun = await read(async tx => {
      await one(tx, sql`select id from app.assistant_enterprise_settings where enterprise_id=${eid} for update`);
      const created = await enqueueReport(tx, eid, b!, policy, latestReportPeriod('daily', new Date(next.getTime() + 86400000), '20:00'));
      assert.ok(created);
      await tx.execute(sql`update app.assistant_jobs set status='running',attempts=1,lease_token='synthetic-lost-controller',lease_expires_at=now()-interval '1 second' where enterprise_id=${eid} and run_id=${created.runId}`);
      await tx.execute(sql`update app.assistant_runs set status='running' where enterprise_id=${eid} and id=${created.runId}`); return created;
    });
    await drain(); assert.equal((await services[0].detail(bindings[0].bindingId, leaseRun.reportId)).state, 'facts_ready');
    const failed = await read(async tx => {
      await one(tx, sql`select id from app.assistant_enterprise_settings where enterprise_id=${eid} for update`);
      const created = await enqueueReport(tx, eid, b!, policy, latestReportPeriod('daily', new Date(next.getTime() + 2 * 86400000), '20:00')); assert.ok(created);
      await tx.execute(sql`update app.assistant_jobs set available_at=now()+interval '1 hour' where enterprise_id=${eid} and run_id=${created.runId}`); return created;
    });
    let current = (await services[0].list()).items[0]; await services[0].change(current.bindingId, 'stop', current.version, randomUUID());
    await read(tx => tx.execute(sql`update app.assistant_jobs set available_at=now() where enterprise_id=${eid} and run_id=${failed.runId}`)); await drain();
    assert.equal((await services[0].detail(bindings[0].bindingId, failed.reportId)).state, 'failed');
    current = (await services[0].list()).items[0]; await services[0].change(current.bindingId, 'resume', current.version, randomUUID());
    const retryKey = randomUUID(), retried = await services[0].retry(current.bindingId, failed.reportId, 1, retryKey);
    assert.equal(retried.runId, failed.runId); assert.deepEqual(await services[0].retry(current.bindingId, failed.reportId, 1, retryKey), retried);
    await drain(); await deliverConstructionReports(eid);
    return { expiredLeaseRun: leaseRun.runId, originalRetriedRun: failed.runId, providerStarted: false };
  });
  await step('member removal and original withdrawal hide names, counts, summaries and old read tokens', async () => {
    await owner.execute('member', { projectId: projects[0], expectedVersion: ((await owner.execute('detail', { projectId: projects[0] })).project as Row).version,
      adminId: admins[2], role: 'designer', active: false, workLabel: '合成验收' }, randomUUID());
    const designer = await services[2].detail(bindings[2].bindingId, String(dailyViews[2].reportId));
    assert.deepEqual(designer.facts!.projects.map(p => p.id), [projects[1]]);
    const r = await read(tx => one(tx, sql`select version from app.construction_site_records where enterprise_id=${eid} and id=${recordIds[0]}`));
    await new SiteChatService(owner.actor).mutate(projects[0], recordIds[0], 'withdraw', { expectedVersion: Number(r!.version), reason: '合成测试·撤回原记录' }, randomUUID());
    const withdrawn = await services[0].detail(bindings[0].bindingId, String(dailyViews[0].reportId), 1);
    assert.equal(withdrawn.available, false); assert.equal(withdrawn.facts, null); assert.equal(withdrawn.sequence, null);
    const messages = await read(tx => rows(tx, sql`select content from app.assistant_messages where enterprise_id=${eid} and conversation_id=${bindings[0].conversationId}`));
    assert.ok(!JSON.stringify(messages).includes('A户插座')); return { memberProjectHidden: projects[0], withdrawnReportUnavailable: true, noCachedSummary: true };
  });
  await step('stop and delete survive rediscovery; same-key delete recovers without rebuilding the chat', async () => {
    let b = (await services[1].list()).items[0]; const k = randomUUID();
    const deleted = await services[1].change(b.bindingId, 'delete', b.version, k);
    assert.deepEqual(await services[1].change(b.bindingId, 'delete', b.version, k), deleted);
    const oldCount = Number((await read(tx => one(tx, sql`select count(*) n from app.construction_followup_bindings where enterprise_id=${eid} and principal_key=${'admin:' + admins[1]}`)))!.n);
    await advanceConstructionReports(new Date(new Date(String(report.fixture.recoveryClock)).getTime() + 10 * 86400000), eid); await drain();
    assert.equal((await services[1].list()).items.length, 0);
    assert.equal(Number((await read(tx => one(tx, sql`select count(*) n from app.construction_followup_bindings where enterprise_id=${eid} and principal_key=${'admin:' + admins[1]}`)))!.n), oldCount);
    b = (await services[0].list()).items[0]; await services[0].change(b.bindingId, 'stop', b.version, randomUUID());
    return { deletedBindingId: deleted.bindingId, autoRecreated: false, otherRecipientsUnaffected: true };
  });
  await step('no new provider/knowledge attempts and source binding remain unchanged', async () => {
    await drain(); report.accountingAfter = await baseline(); assert.deepEqual(report.accountingAfter, report.accountingBefore); bindCheck();
    return { providerCalls: 0, knowledgeCalls: 0, closure3753Unchanged: true, drift: [] };
  });
  report.passed = true;
}
async function run() {
try { await main(); }
catch (error) { report.error = (error as Error).stack; process.exitCode = 1; console.error((error as Error).message); }
finally {
  try {
    if (config && owner) {
      const s = await config.settings();
      await config.configure({ expectedVersion: Number(s.version), enabled: false, dailyTime: String(settingsBefore?.daily_time || '20:00'), weeklyTime: String(settingsBefore?.weekly_time || '08:00'),
        projectIds: settingsBefore?.project_ids || [], stageKeys: settingsBefore?.stage_keys || [] }, randomUUID());
      for (const pid of projects) await owner.execute('update', { projectId: pid, expectedVersion: ((await owner.execute('detail', { projectId: pid })).project as Row).version,
        name: '合成测试·V1-02已归档', status: 'archived', customerAccess: false }, randomUUID());
    }
    await withPlatformTransaction(async tx => {
      if (assistantEnabledBefore !== undefined) await tx.execute(sql`update app.assistant_enterprise_settings set enabled=${assistantEnabledBefore} where enterprise_id=${eid}`);
      for (const b of muted) {
        assert.equal(Number((await one(tx, sql`select count(*) n from app.assistant_messages where enterprise_id=${eid} and conversation_id=${String(b.conversation_id)}`))!.n), 0);
        await tx.execute(sql`delete from app.construction_followup_bindings where enterprise_id=${eid} and id=${String(b.id)}`);
        await tx.execute(sql`delete from app.assistant_participants where enterprise_id=${eid} and conversation_id=${String(b.conversation_id)}`);
        await tx.execute(sql`delete from app.assistant_conversations where enterprise_id=${eid} and id=${String(b.conversation_id)}`);
      }
      for (const bid of fixtureBindings) await tx.execute(sql`update app.construction_followup_bindings set status='stopped',version=version+1 where enterprise_id=${eid} and id=${bid} and status<>'deleted'`);
      for (const aid of admins) await tx.execute(sql`update app.admin_users set status='disabled' where id=${aid}`);
      for (const uid of users) await tx.execute(sql`update app.users set context_version=context_version+1 where id=${uid}`);
      await tx.execute(sql`update app.assistant_jobs j set status='cancelled',lease_token=null,lease_expires_at=null,last_error='synthetic_fixture_closed'
        from app.construction_report_versions v join app.construction_reports r on r.enterprise_id=v.enterprise_id and r.id=v.report_id
        where j.enterprise_id=${eid} and j.run_id=v.run_id and ${JSON.stringify(fixtureBindings)}::jsonb ? r.binding_id::text and j.status in ('queued','running')`);
      await tx.execute(sql`update app.assistant_runs r set status='cancelled',error_code='synthetic_fixture_closed',completed_at=now()
        from app.assistant_jobs j where r.enterprise_id=${eid} and r.id=j.run_id and j.last_error='synthetic_fixture_closed' and r.status in ('queued','running')`);
    });
    bindCheck(); report.cleanup = { policyDisabled: true, projectsArchived: projects, accountsDisabled: admins, mutedRealOwnersRestored: true };
  } catch (error) { report.cleanupError = (error as Error).message; process.exitCode = 1; }
  finally { if (release) await release(); await closePostgresPool(); report.finishedAt = new Date().toISOString(); save(); }
}
}
void run().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
