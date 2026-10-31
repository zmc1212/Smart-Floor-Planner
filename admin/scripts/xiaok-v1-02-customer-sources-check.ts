/** Bounded customer-publication integration. Real local writes/queue/receipts;
 * no model, ingestion, native UI or production rollout. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadEnvConfig } from '@next/env';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import type { ActorContext } from '@/lib/assistant/contracts';
import { appendMessage, ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { ConstructionService } from '@/lib/construction/service';
import { ConstructionReportService } from '@/lib/construction/report-service';
import { FollowupService } from '@/lib/construction/followup-service';
import { enqueueReport, ensureFollowupBinding } from '@/lib/construction/report-store';
import { processConstructionReport, deliverConstructionReports } from '@/lib/construction/report-worker';
import { latestReportPeriod } from '@/lib/construction/report-calendar';
import { collectReportFacts } from '@/lib/construction/report-scope';
import { SiteChatService, recordVersion } from '@/lib/construction/site-chat';
import { executeSiteIssue, parseSiteVersions, type SiteIssueCommand } from '@/lib/construction/site-issues';
import { grantMaterial } from '@/lib/construction/site-materials';
import { executePlanCommand, PlanCustomerService, customerPlans, syncPlans } from '@/lib/construction/site-plans';
import { customerSiteResults, syncSiteResults } from '@/lib/construction/site-results';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

loadEnvConfig(process.cwd(), true);
const root = path.resolve('..'), eid = '1454', pid = '248', otherPid = '249', aid = '5410', bid = '27';
const output = path.resolve(process.argv.find(v => v.startsWith('--output='))?.slice(9) || '../tmp/v1-02-customer-sources/service-01');
const resumeFrom = process.argv.find(v => v.startsWith('--resume='))?.slice(9);
const continueHeld = process.argv.find(v => v.startsWith('--continue-held='))?.slice(16);
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Retain original batches');
fs.mkdirSync(output, { recursive: true });
const prefix = 'synthetic-v1-02-customer-sources-' + randomUUID();
const daily = latestReportPeriod('daily', new Date('2026-12-04T20:00:00+08:00'), '20:00');
const weekly = latestReportPeriod('weekly', new Date('2026-12-07T08:00:00+08:00'), '08:00');
const report: Row = { startedAt: new Date().toISOString(), prefix, fixedPeriods: { daily, weekly },
  fixedChecks: ['labelled setup', 'customer original consultation grants stay scoped', 'exact publication selection and historical carryover',
    'real daily save delivery and reentry', 'real weekly save and recipient denial', 'withdrawn carryover read and pending delivery revocation',
    'bounded candidate truncation', 'unchanged accounting and original reports'], checks: [] };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const files = execFileSync('rg', ['--files', 'admin/src/lib/assistant', 'admin/src/lib/construction', 'admin/src/db', 'admin/src/lib/ai', 'admin/drizzle'], { cwd: root, encoding: 'utf8' })
  .trim().split(/\r?\n/).map(f => f.replaceAll('\\', '/'));
files.push('admin/scripts/xiaok-v1-02-customer-sources-check.ts', 'admin/scripts/assistant-acceptance-safety.mjs',
  'admin/package.json', 'admin/package-lock.json', 'admin/tsconfig.json', 'admin/.env.local');
const binding = () => Object.fromEntries([...new Set(files)].sort().map(f => [f, createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')]));
const bound = binding();
function bindCheck() { const after = binding(), drift = Object.keys(bound).filter(f => bound[f] !== after[f]);
  fs.writeFileSync(path.join(output, 'binding.json'), JSON.stringify({ before: bound, after, drift }, null, 2)); assert.deepEqual(drift, []); }
const read = <T>(fn: Parameters<typeof withTenantTransaction<T>>[1]) => withTenantTransaction(eid, fn);
const owner = new ConstructionService({ enterpriseId: eid, adminId: aid }), config = new ConstructionReportService(owner.actor);
const site = new SiteChatService(owner.actor);
const ownRuns: string[] = [], projectBefore: Row[] = [], muted: Row[] = [];
let release: (() => Promise<void>) | undefined, setup = false, settingsBefore: Row | undefined, adminBefore: Row | undefined;
let modeBefore: string | undefined, continued: Row | undefined;
let actor!: ActorContext, customer!: FollowupService, destination!: Row, uid = '', cid = '', roomId = '', roomName = '', carryover = '', current = '';
type QueuedReport = NonNullable<Awaited<ReturnType<typeof enqueueReport>>>;
let savedDaily!: QueuedReport, savedWeekly!: QueuedReport;
async function step(name: string, work: () => Promise<unknown>) {
  try { const result = await work(); (report.checks as Row[]).push({ name, passed: true, result }); console.log(name + ': PASS'); return result; }
  catch (error) { (report.checks as Row[]).push({ name, passed: false, error: (error as Error).message }); throw error; }
  finally { save(); }
}
const accounting = () => withPlatformTransaction(async tx => ({
  providerMax: String((await one(tx, sql`select coalesce(max(id),0) id from app.ai_provider_attempts`))!.id),
  knowledgeMax: String((await one(tx, sql`select coalesce(max(id),0) id from app.assistant_knowledge_attempts`))!.id),
  attempt3753: await one(tx, sql`select id::text,status,input_tokens from app.assistant_knowledge_attempts where id=3753`),
}));
const history = () => read(tx => rows(tx, sql`select v.report_id::text,v.revision,v.facts_hash from app.construction_report_versions v
  where v.enterprise_id=${eid} and v.report_id in (82,83,84,85,92,94,95,96,97) order by v.report_id,v.revision`));
const getBinding = () => read(async tx => (await one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${bid}`))!);
async function record(label: string, at: Date, audience = 'customer', pending = label, coordination = '', projectId = pid, draft = false) {
  const r = await site.withWriteScope(projectId, async (tx, c) => {
    const message = await appendMessage(tx, site.actor, String(c.id), { author: 'admin', clientMessageId: randomUUID(), purpose: 'site.source',
      content: { version: 1, blocks: [{ type: 'text', text: prefix + ' 合成原材料 ' + label }] } });
    const row = (await one(tx, sql`insert into app.construction_site_records(enterprise_id,project_id,conversation_id,source_message_id,author_id,status,data)
      values(${eid},${projectId},${String(c.id)},${String(message.id)},${aid},'draft',${JSON.stringify({ title: '合成测试·' + label,
        roomId: projectId === pid ? roomId : null, completed: '', pending, coordination, note: '合成测试，不是实际施工/报价/许可。' })}::jsonb) returning *`))!;
    await recordVersion(tx, eid, row, aid, 'organized'); return row;
  });
  const edited = await site.mutate(projectId, String(r.id), 'edit', { expectedVersion: Number(r.version), data: r.data }, randomUUID());
  if (!draft) {
    await site.mutate(projectId, String(r.id), 'publish', { expectedVersion: Number(edited.version), audience }, randomUUID());
    await read(async tx => {
      await tx.execute(sql`update app.construction_site_records set published_at=${at} where enterprise_id=${eid} and id=${String(r.id)}`);
      await tx.execute(sql`update app.construction_site_record_versions set created_at=${at} where enterprise_id=${eid} and record_id=${String(r.id)} and action='publish'`);
      await tx.execute(sql`update app.domain_event_outbox set created_at=${at} where enterprise_id=${eid} and type='construction.record.publish.v1' and aggregate_id=${String(r.id)}`);
    });
  }
  return String(r.id);
}
async function action(cmd: SiteIssueCommand, at: Date) {
  const versions = parseSiteVersions((await site.read(pid)).versions);
  return site.withWriteScope(pid, async (tx, c, _p, permission) => {
    const message = await appendMessage(tx, site.actor, String(c.id), { author: 'admin', clientMessageId: randomUUID(), purpose: 'site.source',
      content: { version: 1, blocks: [{ type: 'text', text: prefix + ' INTERNAL_ONLY ' + JSON.stringify(cmd) }] } });
    const result = await executeSiteIssue(tx, site.actor, pid, String(message.id), cmd, versions, permission.manage);
    await tx.execute(sql`update app.domain_event_outbox set created_at=${at} where enterprise_id=${eid} and correlation_id=${String(message.id)}`);
    return result as Row;
  });
}
async function queue(period: typeof daily) {
  const queued = await read(async tx => enqueueReport(tx, eid, (await one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${bid} for update`))!,
    (await one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid} for update`))!, period));
  assert.ok(queued); ownRuns.push(queued.runId); report.ownedRuns = ownRuns; save();
  // The original queue/lease/completion services are exercised directly. Refuse
  // to process any foreign run; never route a test job to a provider.
  for (let i = 0; i < 10; i++) {
    const status = await read(tx => one(tx, sql`select status,error_code from app.assistant_runs where enterprise_id=${eid} and id=${queued.runId}`));
    if (status?.status === 'succeeded') return queued;
    assert.ok(['queued','running'].includes(String(status?.status)), JSON.stringify(status));
    const lease = await claimJob();
    if (lease) { assert.ok(ownRuns.includes(lease.runId) && lease.enterpriseId === eid, 'Global idle queue must contain only owned local report jobs'); await processConstructionReport(lease); }
    else await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw Error('Original queued local run did not finish within bounded drain');
}
async function facts(period = daily) {
  return read(async tx => collectReportFacts(tx, eid, await getBindingIn(tx), { ...period, period_start: period.start, period_end: period.end, cutoff_at: period.cutoff },
    { project_ids: [pid], stage_keys: [] }));
}
async function getBindingIn(tx: PostgresTransaction) {
  return (await one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${bid}`))!;
}
async function main() {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(process.argv.includes('--development') && ['localhost','127.0.0.1'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
  release = await lockAssistantAcceptance(JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL);
  assert.equal((await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`)))!.n, 0);
  report.accountingBefore = await accounting(); report.historyBefore = await history(); bindCheck();
  await step('labelled Weiyun fixtures and original destination services', async () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tmp/v1-02-first-enable/service-01/report.json'), 'utf8'));
    settingsBefore = await read(tx => one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid}`)); assert.equal(settingsBefore?.enabled, false);
    adminBefore = await withPlatformTransaction(tx => one(tx, sql`select username,status from app.admin_users where id=${aid}`));
    assert.ok(String(adminBefore?.username).startsWith(fixture.prefix)); assert.equal(adminBefore?.status, 'disabled');
    setup = true; await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status='active' where id=${aid}`));
    for (const projectId of [pid, otherPid]) { const p = (await owner.execute('detail', { projectId })).project as Row;
      assert.ok(String(p.name).startsWith('合成测试')); assert.equal(p.status, 'archived'); projectBefore.push(p);
      await owner.execute('update', { projectId, expectedVersion: p.version, name: p.name, status: 'active', customerAccess: true }, randomUUID()); }
    uid = String((await getBinding()).user_id);
    actor = { enterpriseId: eid, principal: { kind: 'user', userId: uid },
      contextVersion: Number((await withPlatformTransaction(tx => one(tx, sql`select context_version from app.users where id=${uid}`)))!.context_version), capabilities: ['assistant.chat.self'] };
    customer = new FollowupService({ ...actor, capabilities: ['assistant.followup.self'] });
    destination = await customer.change(bid, 'resume', Number((await getBinding()).version), randomUUID());
    const detail = await owner.execute('detail', { projectId: pid }), room = (detail.rooms as Row[])[0]; roomId = String(room.id); roomName = String(room.name);
    for (const a of await read(tx => rows(tx, sql`select id from app.admin_users where enterprise_id=${eid} and role='enterprise_admin' and status='active' and id<>${aid}`))) {
      await read(async tx => {
        assert.ok(!await one(tx, sql`select id from app.construction_followup_bindings where enterprise_id=${eid} and principal_key=${'admin:' + String(a.id)} and audience='boss'`));
        const b = await ensureFollowupBinding(tx, eid, { kind: 'admin', id: String(a.id), audience: 'boss' }); muted.push(b);
        await tx.execute(sql`update app.construction_followup_bindings set status='stopped' where enterprise_id=${eid} and id=${String(b.id)}`);
      });
    }
    await config.configure({ expectedVersion: Number((await config.settings()).version), enabled: true, dailyTime: '20:00', weeklyTime: '08:00', projectIds: [pid, otherPid], stageKeys: [] }, randomUUID(), daily.start);
    report.fixture = { eid, pid, otherPid, aid, uid, bindingId: bid, destination, projectBefore, mutedBindingIds: muted.map(b => String(b.id)) };
    return report.fixture;
  });
  const before = new Date(daily.cutoff.getTime() - 3600000), older = new Date(daily.start.getTime() - 3600000);
  if (resumeFrom) {
    const source = path.resolve(resumeFrom); assert.ok(source.startsWith(path.join(root, 'tmp/v1-02-customer-sources') + path.sep));
    const previous = JSON.parse(fs.readFileSync(source, 'utf8'));
    assert.equal(previous.fixture.uid, uid); assert.equal(previous.fixture.pid, pid); assert.equal(previous.checks[1].passed, true);
    const previousBinding = JSON.parse(fs.readFileSync(path.join(path.dirname(source), 'binding.json'), 'utf8'));
    assert.deepEqual(previousBinding.drift, []);
    const changed = Object.keys(previousBinding.after).filter(f => previousBinding.after[f] !== bound[f]);
    assert.deepEqual(changed, ['admin/scripts/xiaok-v1-02-customer-sources-check.ts']);
    report.reusedEvidence = { source: path.relative(root, source), checks: [previous.checks[1].name], reason: 'Correct the driver actor purpose; product sources unchanged, reuse original publications' };
    report.records = previous.records; carryover = previous.records.carryover; current = previous.records.current;
    const p = (await facts()).projects[0]; assert.ok(p.publishedRecordItems!.some(i => i.recordId === carryover)); assert.ok(p.publishedRecordItems!.some(i => i.recordId === current));
  } else {
  await step('exact customer publications exclude draft internal other-recipient cutoff and empty fields', async () => {
    carryover = await record('期前原记录仍列待核对', older, 'customer', '期前待核对原文，未记负责人或期限', '等待核对原文');
    current = await record('期内公开待核对', before, 'customer', '期内待核对原文');
    const boundary = await record('CUTOFF_ONLY', daily.cutoff), internal = await record('INTERNAL_ONLY_RECORD', before, 'internal');
    const foreign = await record('OTHER_CUSTOMER_ONLY', before, 'customer', 'OTHER_CUSTOMER_ONLY', '', otherPid);
    const draft = await record('DRAFT_ONLY', before, 'customer', 'DRAFT_ONLY', '', pid, true);
    const empty = await record('EMPTY_FIELDS_ONLY', before, 'customer', '', '');
    const f = await facts(), p = f.projects.find(p => p.id === pid)!;
    assert.equal(f.issuesStatus, 'published_records_only'); assert.equal(f.arrangementsStatus, 'original_consultation_only');
    const items = p.publishedRecordItems!;
    assert.equal(items.find(i => i.recordId === carryover)!.carriedOver, true); assert.equal(items.find(i => i.recordId === current)!.carriedOver, false);
    assert.equal(items.find(i => i.recordId === carryover)!.coordination, '等待核对原文');
    for (const id of [boundary, internal, foreign, draft, empty]) assert.ok(!items.some(i => i.recordId === id));
    assert.ok(!JSON.stringify(f).includes('INTERNAL_ONLY_RECORD')); assert.ok(!JSON.stringify(f).includes('OTHER_CUSTOMER_ONLY'));
    assert.ok(!p.records.some(r => r.id === carryover)); assert.equal(p.issues, undefined); assert.equal(p.arrangements, undefined);
    report.records = { carryover, current, boundary, internal, foreign, draft, empty }; return { items, records: p.records.map(r => r.id) };
  });
  }
  if (continueHeld) {
    const source = path.resolve(continueHeld); assert.ok(source.startsWith(path.join(root, 'tmp/v1-02-customer-sources') + path.sep));
    continued = JSON.parse(fs.readFileSync(source, 'utf8')) as Row;
    assert.equal(((continued.checks as Row[])[1]).passed, true);
    const previousBinding = JSON.parse(fs.readFileSync(path.join(path.dirname(source), 'binding.json'), 'utf8'));
    assert.deepEqual(previousBinding.drift, []);
    assert.deepEqual(Object.keys(previousBinding.after).filter(f => previousBinding.after[f] !== bound[f]), ['admin/scripts/xiaok-v1-02-customer-sources-check.ts']);
    report.originalConsultation = continued.originalConsultation; report.reusedGrantEvidence = { source: path.relative(root, source), check: (continued.checks as Row[])[1].name };
    cid = String((continued.originalConsultation as Row).cid);
  } else {
  await step('real team return and exact plan remain accessible only in their original consultation', async () => {
    cid = String((await new ConversationService(actor).create(randomUUID())).id);
    await read(async tx => { const c = await new AssistantRepository(tx, actor).conversation(cid);
      const message = await appendMessage(tx, actor, cid, { author: 'user', clientMessageId: randomUUID(),
        content: { version: 1, blocks: [{ type: 'text', text: prefix + ' CONSULTATION_PRIVATE 原咨询需求' }] } });
      await grantMaterial(tx, actor, c, message, { project_id: pid, room_id: roomId, room_name: roomName, project_name: '合成测试' }, 'need', '原咨询明确授权需求节选', null); });
    const issue = await action({ action: 'open', target: current, value: 'INTERNAL_ONLY_REQUEST' }, before), issueId = String(issue.issueId);
    await action({ action: 'claim', target: issueId, value: '' }, before);
    await action({ action: 'reply', target: issueId, value: 'INTERNAL_ONLY_REPLY' }, before);
    await action({ action: 'return', target: issueId, value: 'ORIGINAL_CONSULTATION_RETURN_ONLY' }, before);
    await read(async tx => { const c = await new AssistantRepository(tx, actor).conversation(cid); await syncSiteResults(tx, actor, c); });
    assert.ok((await read(tx => customerSiteResults(tx, eid, uid, cid))).some(r => r.issueId === issueId));
    assert.deepEqual(await read(tx => customerSiteResults(tx, eid, uid, String(destination.conversationId))), []);
    const media = await site.upload(pid, randomUUID(), await sharp({ create: { width: 96, height: 72, channels: 3, background: '#c9dfd0' } }).png().toBuffer());
    const versions = parseSiteVersions((await site.read(pid)).versions);
    const plan = await site.withWriteScope(pid, async (tx, c, _p, permission) => {
      const message = await appendMessage(tx, site.actor, String(c.id), { author: 'admin', clientMessageId: randomUUID(), purpose: 'site.source', content: { version: 1, blocks: [{ type: 'text', text: prefix + ' PLAN_SOURCE_ONLY' }] } });
      return executePlanCommand(tx, site.actor, pid, String(message.id), { action: 'publish', issueId, title: 'ORIGINAL_CONSULTATION_PLAN_ONLY', difference: '仅原咨询方案，不是跟进授权', costDeltaCents: 10000, scheduleDeltaDays: 1 }, [String(media.id)], versions, permission.manage);
    });
    const planCustomer = new PlanCustomerService(actor, cid); assert.equal((await planCustomer.read(plan.id)).id, plan.id);
    await planCustomer.decide(plan.id, 'preview', { expectedRevision: (await planCustomer.read(plan.id)).revision }, randomUUID());
    await planCustomer.decide(plan.id, 'approve', { expectedRevision: (await planCustomer.read(plan.id)).revision }, randomUUID());
    await read(async tx => { const c = await new AssistantRepository(tx, actor).conversation(cid); await syncPlans(tx, actor, c); });
    assert.ok((await read(tx => customerPlans(tx, eid, uid, cid))).some(p => p.id === plan.id && p.status === 'approved'));
    await assert.rejects(() => new PlanCustomerService(actor, String(destination.conversationId)).read(plan.id), e => (e as { code: string }).code === 'assistant_resource_not_found');
    assert.deepEqual(await read(tx => customerPlans(tx, eid, uid, String(destination.conversationId))), []);
    const f = await facts(); for (const sentinel of ['INTERNAL_ONLY_REQUEST','INTERNAL_ONLY_REPLY','ORIGINAL_CONSULTATION_RETURN_ONLY','ORIGINAL_CONSULTATION_PLAN_ONLY','CONSULTATION_PRIVATE']) assert.ok(!JSON.stringify(f).includes(sentinel));
    report.originalConsultation = { cid, issueId, planId: plan.id }; return report.originalConsultation;
  });
  }
  await step('original local daily queue saves delivers and reenters an immutable fact version', async () => {
    const c = (await read(tx => one(tx, sql`select mode from app.assistant_conversations where enterprise_id=${eid} and id=${String(destination.conversationId)}`)))!;
    modeBefore = String(c.mode); report.modeBefore = modeBefore;
    if (continued) {
      assert.equal(modeBefore, 'human');
      const run = String((continued.ownedRuns as string[])[0]);
      const saved = (await read(tx => one(tx, sql`select r.id::text as "reportId",v.revision,run.id::text as "runId",run.conversation_id::text as "conversationId",run.status,d.state
        from app.construction_reports r join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id
        join app.assistant_runs run on run.enterprise_id=v.enterprise_id and run.id=v.run_id
        join app.construction_report_deliveries d on d.enterprise_id=v.enterprise_id and d.report_id=v.report_id and d.revision=v.revision
        where r.enterprise_id=${eid} and r.binding_id=${bid} and run.id=${run} and r.period_start=${daily.start} and r.cutoff_at=${daily.cutoff}`)))!;
      assert.equal(saved.status, 'succeeded'); assert.equal(saved.state, 'held'); assert.equal(saved.conversationId, destination.conversationId);
      savedDaily = { reportId: String(saved.reportId), revision: Number(saved.revision), runId: run, conversationId: String(saved.conversationId) }; ownRuns.push(run);
      report.reusedHeldRun = { ...savedDaily, originalState: saved.state };
    }
    // This labelled destination deliberately starts in human mode. Control only
    // this synthetic mode to test delivery, and restore it in finally.
    await read(tx => tx.execute(sql`update app.assistant_conversations set mode='ai' where enterprise_id=${eid} and id=${String(destination.conversationId)}`));
    if (!continued) savedDaily = await queue(daily);
    assert.equal(await deliverConstructionReports(eid), 1);
    const detail = await customer.detail(bid, savedDaily.reportId); assert.equal(detail.available, true); assert.equal(detail.contentStatus, 'facts_only');
    assert.equal(detail.facts!.knowledgeStatus, 'not_generated'); assert.ok(detail.facts!.projects[0].publishedRecordItems!.some(i => i.recordId === carryover));
    const saved = await read(tx => one(tx, sql`select facts_hash,facts from app.construction_report_versions where enterprise_id=${eid} and report_id=${savedDaily.reportId} and revision=1`));
    report.dailyOriginal = saved; report.dailyDetail = detail;
    assert.deepEqual((await customer.detail(bid, savedDaily.reportId)).facts, detail.facts); assert.equal(await deliverConstructionReports(eid), 0);
    const message = await read(tx => one(tx, sql`select m.content from app.assistant_messages m join app.construction_report_deliveries d
      on d.enterprise_id=m.enterprise_id and d.message_id=m.id where d.enterprise_id=${eid} and d.report_id=${savedDaily.reportId}`));
    assert.equal(JSON.stringify(message!.content).includes('期前待核对原文'), false);
    return { queued: savedDaily, detailState: detail.state, snapshotHash: saved!.facts_hash, contentStatus: detail.contentStatus };
  });
  await step('weekly saved source scope and foreign recipient tenant denial', async () => {
    savedWeekly = await queue(weekly); const detail = await customer.detail(bid, savedWeekly.reportId);
    assert.equal(detail.available, true); assert.ok(detail.facts!.projects[0].publishedRecordItems!.some(i => i.recordId === current));
    const stranger = { ...actor, capabilities: ['assistant.followup.self'], principal: { kind: 'user' as const, userId: '3915' }, contextVersion: Number((await withPlatformTransaction(tx => one(tx, sql`select context_version from app.users where id=3915`)))!.context_version) };
    await assert.rejects(() => new FollowupService(stranger).detail(bid, savedDaily.reportId));
    await assert.rejects(() => new FollowupService({ ...actor, capabilities: ['assistant.followup.self'], enterpriseId: '2505' }).detail(bid, savedDaily.reportId));
    report.weeklyOriginal = await read(tx => one(tx, sql`select facts_hash,facts from app.construction_report_versions where enterprise_id=${eid} and report_id=${savedWeekly.reportId} and revision=1`));
    assert.ok('deliveryState' in detail);
    return { queued: savedWeekly, deliveryState: detail.deliveryState, deniedOtherCustomer: true, deniedOtherTenant: true };
  });
  await step('withdrawn carryover hides saved sections and revokes pending delivery without rewriting facts', async () => {
    const r = (await read(tx => one(tx, sql`select version from app.construction_site_records where enterprise_id=${eid} and id=${carryover}`)))!;
    await site.mutate(pid, carryover, 'withdraw', { expectedVersion: Number(r.version), reason: prefix + ' 撤回合成原件' }, randomUUID());
    assert.equal((await customer.detail(bid, savedDaily.reportId)).available, false);
    assert.equal((await customer.detail(bid, savedWeekly.reportId)).available, false);
    assert.equal(await deliverConstructionReports(eid), 0);
    const state = await read(tx => one(tx, sql`select state,message_id from app.construction_report_deliveries where enterprise_id=${eid} and report_id=${savedWeekly.reportId}`));
    assert.equal(state!.state, 'revoked'); assert.equal(state!.message_id, null);
    for (const [queued, original] of [[savedDaily, report.dailyOriginal], [savedWeekly, report.weeklyOriginal]] as [Row, Row][]) {
      assert.deepEqual(await read(tx => one(tx, sql`select facts_hash,facts from app.construction_report_versions where enterprise_id=${eid} and report_id=${queued.reportId} and revision=1`)), original);
    }
    return { dailyHidden: true, weeklyHidden: true, pendingState: state!.state, originalFactsUnchanged: true };
  });
  await step('customer publication candidate bound retains explicit truncation', async () => {
    const existing = (await facts()).projects[0].publishedRecordItems!.length;
    for (let i = existing; i < 51; i++) await record('有界候选' + i, new Date(before.getTime() + i), 'customer', '合成待核对候选' + i);
    const p = (await facts()).projects[0]; assert.equal(p.publishedRecordItems!.length, 50); assert.equal(p.publishedRecordItemsTruncated, true);
    return { count: p.publishedRecordItems!.length, truncated: p.publishedRecordItemsTruncated };
  });
  await step('original report history accounting and bound sources stay unchanged', async () => {
    report.accountingAfter = await accounting(); assert.deepEqual(report.accountingAfter, report.accountingBefore); assert.deepEqual(await history(), report.historyBefore); bindCheck();
    return report.accountingAfter;
  }); report.passed = true;
}
async function run() {
  try { await main(); } catch (error) { report.error = (error as Error).stack; console.error((error as Error).message); process.exitCode = 1; }
  finally {
    try {
      if (setup) {
        if (settingsBefore) await config.configure({ expectedVersion: Number((await config.settings()).version), enabled: false,
          dailyTime: settingsBefore.daily_time, weeklyTime: settingsBefore.weekly_time, projectIds: settingsBefore.project_ids, stageKeys: settingsBefore.stage_keys }, randomUUID());
        await read(async tx => {
          if (modeBefore && destination) await tx.execute(sql`update app.assistant_conversations set mode=${modeBefore} where enterprise_id=${eid} and id=${String(destination.conversationId)}`);
          await tx.execute(sql`update app.construction_followup_bindings set status='stopped',version=version+1 where enterprise_id=${eid} and id=${bid} and status<>'deleted'`);
          for (const run of ownRuns) {
            await tx.execute(sql`update app.assistant_jobs set status='cancelled',lease_token=null,lease_expires_at=null,last_error='synthetic_fixture_closed' where enterprise_id=${eid} and run_id=${run} and status in ('queued','running')`);
            await tx.execute(sql`update app.assistant_runs set status='cancelled',error_code='synthetic_fixture_closed',completed_at=now() where enterprise_id=${eid} and id=${run} and status in ('queued','running')`);
          }
          for (const b of muted) {
            assert.equal((await one(tx, sql`select count(*)::int n from app.assistant_messages where enterprise_id=${eid} and conversation_id=${String(b.conversation_id)}`))!.n, 0);
            await tx.execute(sql`delete from app.construction_followup_bindings where enterprise_id=${eid} and id=${String(b.id)}`);
            await tx.execute(sql`delete from app.assistant_participants where enterprise_id=${eid} and conversation_id=${String(b.conversation_id)}`);
            await tx.execute(sql`delete from app.assistant_conversations where enterprise_id=${eid} and id=${String(b.conversation_id)}`);
          }
        });
        for (const p of projectBefore) await owner.execute('update', { projectId: String(p.id), expectedVersion: ((await owner.execute('detail', { projectId: String(p.id) })).project as Row).version,
          name: p.name, status: p.status, customerAccess: p.customer_access }, randomUUID());
        if (adminBefore) await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status=${String(adminBefore!.status)} where id=${aid}`));
        report.cleanup = await withPlatformTransaction(async tx => ({
          queuedRunning: Number((await one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`))!.n),
          settings: await one(tx, sql`select enabled,version from app.construction_report_settings where enterprise_id=${eid}`),
          admin: await one(tx, sql`select status from app.admin_users where id=${aid}`),
          projects: await rows(tx, sql`select id::text,status,customer_access from app.construction_projects where enterprise_id=${eid} and id in (248,249)`),
          destination: await one(tx, sql`select status,conversation_id::text from app.construction_followup_bindings where enterprise_id=${eid} and id=${bid}`),
        }));
        const cleaned = report.cleanup as Row; assert.equal(cleaned.queuedRunning, 0); assert.equal((cleaned.settings as Row).enabled, false);
        assert.equal((cleaned.admin as Row).status, 'disabled'); assert.equal((cleaned.destination as Row).status, 'stopped');
        assert.ok((cleaned.projects as Row[]).every(p => p.status === 'archived' && p.customer_access === false));
        report.accountingAfter = await accounting(); assert.deepEqual(report.accountingAfter, report.accountingBefore);
      }
      bindCheck();
    } catch (error) { report.cleanupError = (error as Error).stack; process.exitCode = 1; }
    finally { if (release) await release(); await closePostgresPool(); report.finishedAt = new Date().toISOString(); save(); }
  }
}
void run().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
