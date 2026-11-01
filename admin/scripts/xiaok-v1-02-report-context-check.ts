/** Approved04 deterministic context contract. Real local writes, no provider or ingestion dispatch. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { ConstructionService } from '@/lib/construction/service';
import { SiteChatService, recordVersion } from '@/lib/construction/site-chat';
import { ConstructionReportService, reportPlanDto } from '@/lib/construction/report-service';
import { FollowupService } from '@/lib/construction/followup-service';
import { ReportContextService } from '@/lib/construction/report-context';
import { reportContextView, privateReportReply } from '@/lib/construction/report-reference';
import { enqueueReport } from '@/lib/construction/report-store';
import { processConstructionReport, deliverConstructionReports } from '@/lib/construction/report-worker';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { ConversationService, appendMessage } from '@/lib/assistant/core/conversation';
import { boundReportContext } from '@/lib/assistant/agent/report-context';
import { businessSnapshotAvailable } from '@/lib/assistant/agent/business-tools';
import { HandoffService } from '@/lib/assistant/handoff/service';
import { type ActorContext } from '@/lib/assistant/contracts';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development'));
const root = path.resolve('..'), eid = '1454', output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/v1-02-report-followup/service-01');
const resume = process.argv.find(a => a.startsWith('--resume='))?.slice(9);
const adapterScript = process.argv.find(a => a.startsWith('--adapter-script='))?.slice(17);
const database = new URL(process.env.DATABASE_URL!);
assert.ok(['localhost','127.0.0.1'].includes(database.hostname) && database.port === '5432' && database.pathname === '/smart_floor_planner');
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Never overwrite an original batch'); fs.mkdirSync(output, { recursive: true });
const report: Row = { startedAt: new Date().toISOString(), modelCalls: 0, ingestionCalls: 0, scope: 'customer04 report reference only; no semantic/scheduler/native acceptance', checks: [] };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const read = <T>(fn: Parameters<typeof withTenantTransaction<T>>[1]) => withTenantTransaction(eid, fn);
const sourceFiles = execFileSync('rg', ['--files','admin/src/lib/assistant','admin/src/lib/construction','admin/src/db','admin/drizzle'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/);
sourceFiles.push('admin/scripts/xiaok-v1-02-report-context-check.ts','admin/scripts/assistant-acceptance-safety.mjs','admin/.env.local','admin/package.json','admin/package-lock.json','admin/tsconfig.json');
sourceFiles.push('tmp/xiaok-vector/connection.private.json');
if (adapterScript) {
  assert.ok(!resume, 'New adapter/native fixtures do not revive withdrawn service fixtures');
  sourceFiles.push(path.relative(root, path.resolve(adapterScript)));
  sourceFiles.push(...execFileSync('rg', ['--files','miniprogram'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/));
  sourceFiles.push('admin/scripts/wechatide-native-client.ts','tmp/v1-02-human-takeover/host-passive.ps1','tmp/wechat-devtools-version-test/window.ps1',
    'tmp/v1-02-report-followup/native.cjs','design-references/xiaok-chat-redesign-20261029-v1/tab-context-v1/README.md',
    'design-references/xiaok-chat-redesign-20261029-v1/tab-context-v1/follow-up-v1/04-report-follow-up-v001.png',
    'D:/微信开发工具/微信web开发者工具/resources/app.asar','D:/微信开发工具/微信web开发者工具/微信开发者工具.exe');
  if (process.argv.includes('--staff-native')) sourceFiles.push('tmp/v1-02-staff-followup/native.cjs',
    'design-references/xiaok-chat-redesign-20261029-v1/tab-context-v1/follow-up-v1/06-worker-follow-up-v001.png',
    'design-references/xiaok-chat-redesign-20261029-v1/tab-context-v1/follow-up-v1/07-designer-follow-up-v002.png');
  const staffNativeScript = process.argv.find(a => a.startsWith('--staff-native-script='))?.slice(22);
  if (staffNativeScript) sourceFiles.push(path.resolve(staffNativeScript),
    'design-references/xiaok-chat-redesign-20261029-v1/tab-context-v1/follow-up-v1/08-boss-weekly-digest-v003.png');
  if (process.argv.includes('--owner-daily-visual')) sourceFiles.push('design-references/xiaok-chat-redesign-20261029-v1/tab-context-v1/follow-up-v1/02-follow-up-chat-v002.png');
  if (process.argv.includes('--owner-detail-visual')) sourceFiles.push('design-references/xiaok-chat-redesign-20261029-v1/tab-context-v1/follow-up-v1/03-report-detail-v001.png', 'tmp/v1-02-report-detail-visual/regions-03.json');
}
const bind = () => Object.fromEntries(sourceFiles.sort().map(f => [f.replaceAll('\\','/'), createHash('sha256').update(fs.readFileSync(path.isAbsolute(f) ? f : path.join(root,f))).digest('hex')]));
const before = bind();
const owner = new ConstructionService({ enterpriseId: eid, adminId: '5410' }), site = new SiteChatService(owner.actor), plan = new ConstructionReportService(owner.actor);
let release: (() => Promise<void>) | undefined, account: Row | undefined, policy: Row | undefined;
let pid = '', bid = '', cid = '', rid = '', recordId = '', topicId = '';
let queuedReportRun = '';
let actor: ActorContext, ordinary: ActorContext, activeRun = '', snapshot: Awaited<ReturnType<typeof boundReportContext>>;
const accounting = () => withPlatformTransaction(async tx => ({ providerMax: String((await one(tx, sql`select coalesce(max(id),0) id from app.ai_provider_attempts`))!.id),
  knowledgeMax: String((await one(tx, sql`select coalesce(max(id),0) id from app.assistant_knowledge_attempts`))!.id),
  stopped: await one(tx, sql`select status,input_tokens from app.assistant_knowledge_attempts where id=3753`) }));
async function step(name: string, fn: () => Promise<unknown>) {
  try { const data = await fn(); (report.checks as Row[]).push({ name, passed: true, data }); return data; }
  catch (e) { (report.checks as Row[]).push({ name, passed: false, error: (e as Error).stack }); throw e; }
  finally { save(); console.log(name + ': ' + ((report.checks as Row[]).at(-1)!.passed ? 'PASS' : 'FAIL')); }
}
async function denied(fn: () => Promise<unknown>) { await assert.rejects(fn, e => ['assistant_resource_not_found','context_changed','version_conflict','conversation_read_only','identity_context_invalid','assistant_capability_forbidden'].includes(String((e as Row).code))); }
async function projectState(status: string, customerAccess: boolean) {
  const p = (await owner.execute('detail', { projectId: pid })).project as Row;
  return owner.execute('update', { projectId: pid, expectedVersion: p.version, name: p.name, status, customerAccess }, randomUUID());
}
async function main() {
  release = await lockAssistantAcceptance(JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL, { waitForLock: true });
  assert.equal((await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.assistant_jobs where status in('queued','running')`)))!.n, 0);
  report.accountingBefore = await accounting();
  await step('labelled project, published original and real fact report', async () => {
    await withPlatformTransaction(async tx => {
      account = await one(tx, sql`select id,username,status from app.admin_users where id=5410`);
      assert.match(String(account!.username), /^synthetic-v1-02-/); assert.equal(account!.status, 'disabled');
      await tx.execute(sql`update app.admin_users set status='active' where id=5410`);
      const user = (await one(tx, sql`select context_version from app.users where id=3914`))!;
      actor = { enterpriseId: eid, principal: { kind: 'user', userId: '3914' }, contextVersion: Number(user.context_version), capabilities: ['assistant.chat.self','assistant.followup.self'] };
      ordinary = { ...actor, capabilities: ['assistant.chat.self'] };
    });
    policy = await plan.settings(); assert.equal(policy.enabled, false);
    if (resume) {
      const oldPath = path.resolve(resume), old = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
      assert.equal(old.cleanup, true); assert.deepEqual(old.drift, []); assert.ok(old.checks.slice(0,2).every((c: Row) => c.passed));
      const originalBinding = JSON.parse(fs.readFileSync(path.join(path.dirname(oldPath), 'binding.json'), 'utf8')).before;
      const changed = Object.keys(originalBinding).filter(f => before[f] !== originalBinding[f]);
      assert.deepEqual(changed, ['admin/scripts/xiaok-v1-02-report-context-check.ts']);
      pid = old.projectId; bid = old.bindingId; cid = old.conversationId; rid = old.reportId; recordId = old.recordId;
      Object.assign(report, { projectId: pid, bindingId: bid, conversationId: cid, reportId: rid, recordId,
        reuse: { source: oldPath, checks: old.checks.slice(0,2), changed, originalFailure: old.error } }); save();
      await projectState('active', true);
      const binding = await new FollowupService(actor).context(bid);
      if (binding.status === 'stopped') await new FollowupService(actor).change(bid, 'resume', Number(binding.version), randomUUID());
      assert.equal((await new FollowupService(actor).detail(bid, rid, 1)).available, true);
      return { reusedFixture: true, projectId: pid, reportId: rid };
    }
    const created = await owner.execute('create', { leadId: '3143', name: '合成测试04·报告引用', managerId: '5410', rooms: ['厨房'] }, randomUUID());
    pid = String(created.id); report.projectId = pid; save(); await projectState('active', true);
    const detail = await owner.execute('detail', { projectId: pid }), p = detail.project as Row, roomId = String((detail.rooms as Row[])[0].id);
    await owner.execute('progress', { projectId: pid, expectedVersion: p.version, stageKey: 'utilities', note: '合成测试04：水电阶段，原始事实不是工程验收', sendReminder: false }, randomUUID());
    const original = await site.withWriteScope(pid, async (tx, c) => {
      const source = await appendMessage(tx, site.actor, String(c.id), { author: 'admin', clientMessageId: randomUUID(), purpose: 'site.source',
        content: { version: 1, blocks: [{ type: 'text', text: '厨房线路走向已经核对，台面插座的位置还没定，先不要施工。' }] } });
      const row = (await one(tx, sql`insert into app.construction_site_records(enterprise_id,project_id,conversation_id,source_message_id,author_id,status,data)
        values(${eid},${pid},${String(c.id)},${String(source.id)},5410,'draft',${JSON.stringify({ title: '合成测试04·厨房记录', roomId,
          completed: '厨房线路走向已核对', pending: '台面插座位置待本人确认', coordination: '确认前不要施工', note: '合成测试资料' })}::jsonb) returning *`))!;
      await recordVersion(tx, eid, row, '5410', 'organized'); return row;
    });
    recordId = String(original.id); report.recordId = recordId; save();
    const edited = await site.mutate(pid, recordId, 'edit', { expectedVersion: Number(original.version), data: original.data }, randomUUID());
    await site.mutate(pid, recordId, 'publish', { expectedVersion: Number(edited.version), audience: 'customer' }, randomUUID());
    const opened = await new FollowupService(actor).open(randomUUID(), pid); bid = String(opened.bindingId); cid = String(opened.conversationId);
    Object.assign(report, { bindingId: bid, conversationId: cid }); save();
    const dto = reportPlanDto(policy, eid);
    await plan.configure({ expectedVersion: dto.version, enabled: true, stageEnabled: false, projectIds: [pid], stageKeys: [], audiences: ['customer'],
      dailyTime: '20:00', weeklyTime: '08:00', weeklyDay: 1, inactivePolicy: 'pause_inactive' }, randomUUID());
    // Local host and PostgreSQL clocks differ. The fact cutoff must follow the
    // original's actual database publication, never a guessed JS wall clock.
    const clock = (await read(tx => one(tx, sql`select date_trunc('day',clock_timestamp() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai' as start,
      clock_timestamp()+interval '1 millisecond' as cutoff`)))!;
    const cutoff = new Date(String(clock.cutoff)), start = new Date(String(clock.start)); report.fixtureClock = { source: 'database', start, cutoff };
    const made = await read(async tx => enqueueReport(tx, eid, (await one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${bid}`))!,
      (await one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid}`))!, { kind: 'daily', start, end: cutoff, cutoff, scheduledAt: cutoff }));
    assert.ok(made); rid = made.reportId; report.reportId = rid; save();
    let job = await claimJob();
    for (let n = 0; !job && n < 50; n++) { await new Promise(resolve => setTimeout(resolve, 100)); job = await claimJob(); }
    assert.equal(job?.runId, made.runId); await processConstructionReport(job!); await deliverConstructionReports(eid);
    const view = await new FollowupService(actor).detail(bid, rid, 1);
    assert.ok(view.available && view.facts?.projects[0].records.some(r => r.id === recordId));
    if (!adapterScript) {
    const queued = await read(async tx => enqueueReport(tx, eid, (await one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${bid}`))!,
      (await one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid}`))!, { kind: 'weekly', start, end: cutoff, cutoff, scheduledAt: cutoff }));
    assert.ok(queued); queuedReportRun = queued.runId; report.queuedReportRun = queuedReportRun; save();
    }
    return { projectId: pid, reportId: rid, originalId: recordId };
  });
  if (adapterScript) {
    report.scope = '04 new citation/run adapter engineering checks and native independent reference journey only; existing service06 and semantic/quota batches are not replayed';
    const adapter = (await import(pathToFileURL(path.resolve(adapterScript)).href)).default;
    report.adapters = await adapter({ root, output, actor, ordinary, pid, bid, cid, rid, recordId, owner, site, read, step, report, save,
      onTopic: (id: string) => { topicId = id; report.topicId = id; save(); } });
    report.passed = true; report.deliveryComplete = false; return;
  }
  const context = new ReportContextService(actor, cid), choice = { bindingId: bid, reportId: rid, revision: 1, projectId: pid };
  if (!resume) await step('exact selection write, readback, replay, conflict and no delivery rebind', async () => {
    const beforeBinding = await read(tx => one(tx, sql`select version,conversation_id from app.construction_followup_bindings where enterprise_id=${eid} and id=${bid}`));
    const requestKey = randomUUID(), body = { expectedVersion: 0, selection: choice };
    const first = await context.select(requestKey, body); assert.deepEqual(await context.select(requestKey, body), first);
    if (queuedReportRun) {
      const job = await claimJob(); assert.equal(job?.runId, queuedReportRun); await processConstructionReport(job!);
      const completed = await read(tx => one(tx, sql`select status,error_code from app.assistant_runs where enterprise_id=${eid} and id=${queuedReportRun}`));
      assert.equal(completed?.status, 'succeeded');
      report.reportJobSurvivesSelection = { runId: queuedReportRun, ...completed }; queuedReportRun = '';
    }
    assert.deepEqual(await context.read(), first); assert.equal(first.selected?.projectName, '合成测试04·报告引用');
    await denied(() => context.select(randomUUID(), { expectedVersion: 0, selection: null }));
    await denied(() => context.select(randomUUID(), { expectedVersion: 1, selection: { ...choice, projectId: '1' } }));
    assert.deepEqual(await read(tx => one(tx, sql`select version,conversation_id from app.construction_followup_bindings where enterprise_id=${eid} and id=${bid}`)), beforeBinding);
    return { version: first.version, factsHash: first.selected?.factsHash };
  });
  await step('original quota guard and rollback-only source protocol checks', async () => {
    const chat = new ConversationService(actor);
    await denied(() => chat.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '厨房还有什么要我核对？' }] }));
    await assert.rejects(async () => {
      const unexpected = await chat.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '厨房还有什么要我核对？' }], reportContextVersion: 1 });
      activeRun = String(unexpected.runId); report.unexpectedRun = activeRun; save();
      throw new Error('Unexpected quota unlock; stop and cancel the owned undispatched run.');
    },
      e => (e as Row).code === 'assistant_quota_exceeded');
    report.semanticSend = { status: 'blocked', code: 'assistant_quota_exceeded', normalJourneyPassed: false, modelCalls: 0,
      evidence: 'quota-diagnostic-01.log', heldTokens: 2004000, dailyTokens: 1200000, inheritedUnknownsUnchanged: true };
    // This rollback fixture tests the original source/checkpoint protocol only.
    // It never queues a job/reserves quota, cannot dispatch a provider, and is
    // not an accepted send or a semantic/user-journey result.
    const rollback = new Error('rollback-only source fixture');
    await assert.rejects(() => read(async tx => {
      const c = (await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${eid} and id=${cid}`))!;
      const run = (await one(tx, sql`insert into app.assistant_runs(enterprise_id,conversation_id,trigger_kind,trigger_schedule_key,purpose,status,policy_snapshot,context_revision,knowledge_epoch)
        values(${eid},${cid},'scheduled_task',${'synthetic-04-rollback:' + randomUUID()},'reply','cancelled','{}'::jsonb,${Number(c.context_revision)},1) returning id`))!;
      snapshot = await boundReportContext(tx, actor, c, String(run.id));
      assert.deepEqual(await boundReportContext(tx, actor, c, String(run.id)), snapshot);
      const message = await appendMessage(tx, actor, cid, { author: 'assistant', runId: String(run.id),
        content: { version: 1, blocks: [{ type: 'text', text: '合成测试04·回滚的报告派生回复夹具' }] } });
      const shareable = await one(tx, sql`select id from app.assistant_messages where enterprise_id=${eid} and id=${String(message.id)} and not ${privateReportReply}`);
      assert.equal(shareable, undefined); throw rollback;
    }), e => e === rollback);
    assert.ok(snapshot?.snapshot.displayText.includes('台面插座位置待本人确认')); assert.ok(await read(tx => businessSnapshotAvailable(tx, eid, snapshot!.snapshot)));
    return { originalFactBound: true, sameSourceResume: true, receptionQueryExcludesDerivedFixture: true, rollbackOnly: true, providerDispatched: false };
  });
  await step('explicit ordinary topic preserves fixed destination and revalidates owner', async () => {
    const k = randomUUID(), topic = await context.topic(k); topicId = String(topic.id); report.topicId = topicId; save();
    assert.equal((await context.topic(k)).id, topicId); assert.equal(topic.purpose, 'customer_consultation');
    const detail = await new ConversationService(ordinary).detail(topicId); assert.equal(detail.reportContext.selected?.reportId, rid);
    assert.equal((await new FollowupService(actor).context(bid)).conversationId, cid);
    const other = { ...ordinary, principal: { kind: 'user' as const, userId: '3915' } };
    await denied(() => new ReportContextService(other, topicId).read());
    await denied(() => new ReportContextService({ ...ordinary, enterpriseId: '1455' }, topicId).read());
    return { topicId, sameFollowupConversation: cid };
  });
  await step('human reception keeps source selection read-only until explicit end', async () => {
    await new HandoffService(actor).customerWrite(cid, randomUUID(), { action: 'request', consent: true });
    const staff = new HandoffService({ enterpriseId: eid, principal: { kind: 'admin', adminId: '5410' }, contextVersion: 0, capabilities: ['assistant.handoff.staff'] });
    await staff.staffWrite(cid, randomUUID(), { action: 'claim' });
    assert.equal((await staff.staffRead(cid)).mode, 'human');
    await denied(() => context.select(randomUUID(), { expectedVersion: 1, selection: null }));
    await new HandoffService(actor).customerWrite(cid, randomUUID(), { action: 'end' });
    return { modePauseAndExplicitEnd: true, actualModelReplyPacketIntegration: 'unverified_no_accepted_send' };
  });
  await step('source withdrawal invalidates both old report references and saved business snapshots', async () => {
    const current = await read(tx => one(tx, sql`select version from app.construction_site_records where enterprise_id=${eid} and id=${recordId}`));
    await site.mutate(pid, recordId, 'withdraw', { expectedVersion: Number(current!.version), reason: '合成测试04来源撤回' }, randomUUID());
    const view = await context.read(); assert.equal(view.invalidated, true); assert.equal(view.selected, null);
    assert.equal(await read(tx => businessSnapshotAvailable(tx, eid, snapshot!.snapshot)), false);
    assert.equal((await new ConversationService(ordinary).detail(topicId)).reportContext.selected, null);
    const c = await read(tx => one(tx, sql`select * from app.assistant_conversations where enterprise_id=${eid} and id=${cid}`));
    assert.equal((await read(tx => reportContextView(tx, actor, c!))).selected, null);
    await denied(() => context.topic(randomUUID()));
    const cleared = await context.select(randomUUID(), { expectedVersion: 1, selection: null }); assert.equal(cleared.selected, null);
    await denied(() => new ConversationService(actor).send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '继续问这份报告' }], reportContextVersion: 1 }));
    return { invalidated: true, removable: true };
  });
  report.passed = true; report.deliveryComplete = false; report.pending = ['accepted normal AI send under original quota','two configured-model first drafts per fixed semantic case','Stable native source/ordinary-topic/rendered reply and recovery'];
}
async function execute() {
try { await main(); }
catch (e) { report.passed = false; report.error = (e as Error).stack; process.exitCode = 1; }
finally {
  try {
    if (adapterScript && cid && actor!) {
      const current = await new ConversationService(actor).detail(cid);
      if (['human','handoff_requested'].includes(String(current.mode))) await new HandoffService(actor).customerWrite(cid, randomUUID(), { action: current.mode === 'human' ? 'end' : 'cancel' });
    }
    if (adapterScript && recordId) {
      const source = await read(tx => one(tx, sql`select version,status from app.construction_site_records where enterprise_id=${eid} and id=${recordId}`));
      if (source?.status === 'published') await site.mutate(pid, recordId, 'withdraw', { expectedVersion: Number(source.version), reason: '合成04独立引用验收清理' }, randomUUID());
    }
    if (activeRun && actor!) await new ConversationService(actor).run(activeRun, 'cancel', randomUUID());
    if (bid && actor!) { const b = await new FollowupService(actor).context(bid); if (b.status === 'enabled') await new FollowupService(actor).change(bid, 'stop', Number(b.version), randomUUID()); }
    if (topicId && ordinary!) { const chat = new ConversationService(ordinary), c = await chat.detail(topicId); if (c.status === 'open') await chat.archive(topicId, Number(c.version), randomUUID()); }
    if (pid && account) await projectState('archived', false);
    if (policy) { const current = reportPlanDto(await plan.settings(), eid), saved = reportPlanDto(policy, eid);
      await plan.configure({ expectedVersion: current.version, enabled: saved.enabled, stageEnabled: saved.stageEnabled, projectIds: saved.projectIds,
        stageKeys: saved.stageKeys, audiences: saved.audiences, dailyTime: saved.dailyTime, weeklyTime: saved.weeklyTime, weeklyDay: saved.weeklyDay, inactivePolicy: saved.inactivePolicy }, randomUUID()); }
    if (account) await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status=${String(account!.status)} where id=5410 and username=${String(account!.username)}`));
    report.accountingAfter = await accounting(); if (report.accountingBefore) assert.deepEqual(report.accountingAfter, report.accountingBefore);
    report.queue = await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.assistant_jobs where status in('queued','running')`));
    assert.equal((report.queue as Row).n, 0); report.cleanup = true;
  } catch (e) { report.cleanup = false; report.cleanupError = (e as Error).stack; process.exitCode = 1; }
  const after = bind(); report.drift = Object.keys(before).filter(f => before[f] !== after[f]);
  if ((report.drift as string[]).length) { report.passed = false; process.exitCode = 1; }
  fs.writeFileSync(path.join(output,'binding.json'), JSON.stringify({ before, after }, null, 2));
  report.finishedAt = new Date().toISOString(); save();
  if (release) await release(); await closePostgresPool();
  console.log(JSON.stringify({ passed: report.passed, cleanup: report.cleanup, checks: (report.checks as Row[]).length, drift: report.drift }));
}
}
void execute().catch(error => { console.error(error); process.exitCode = 1; });
