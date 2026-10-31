/** Bounded real-domain history checks. No model, ingestion or native UI claim. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadEnvConfig } from '@next/env';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import type { ActorContext } from '@/lib/assistant/contracts';
import { appendMessage, ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { ConstructionService } from '@/lib/construction/service';
import { ConstructionReportService } from '@/lib/construction/report-service';
import { SiteChatService, recordVersion } from '@/lib/construction/site-chat';
import { executeSiteIssue, parseSiteVersions, readSiteIssue, type SiteIssueCommand } from '@/lib/construction/site-issues';
import { grantMaterial } from '@/lib/construction/site-materials';
import { executePlanCommand, PlanCustomerService } from '@/lib/construction/site-plans';
import { executeSiteResolution, type ResolutionCommand } from '@/lib/construction/site-resolution';
import { FollowupService } from '@/lib/construction/followup-service';
import { enqueueReport } from '@/lib/construction/report-store';
import { processConstructionReport, deliverConstructionReports } from '@/lib/construction/report-worker';
import { collectReportItems, reportItemsAvailable } from '@/lib/construction/report-items';
import type { ReportFacts } from '@/lib/construction/report-scope';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

loadEnvConfig(process.cwd(), true);
const root = path.resolve('..'), eid = '1454';
const output = path.resolve(process.argv.find(v => v.startsWith('--output='))?.slice(9) || '../tmp/v1-02-report-items/service-01');
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Retain every original batch');
fs.mkdirSync(output, { recursive: true });
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tmp/v1-02-proactive-foundation/service-02/report.json'), 'utf8'));
const [ownerId, workerId, designerId] = fixture.fixture.admins as string[];
const [uid] = fixture.fixture.users as string[], [pid, otherPid] = fixture.fixture.projects as string[];
const owner = new ConstructionService({ enterpriseId: eid, adminId: ownerId }), config = new ConstructionReportService(owner.actor);
const staff = new SiteChatService({ enterpriseId: eid, adminId: designerId });
const day = process.argv.find(v => v.startsWith('--day='))?.slice(6) || '2026-11-10';
assert.match(day, /^\d{4}-\d{2}-\d{2}$/);
const start = new Date(day + 'T00:00:00+08:00'), cutoff = new Date(day + 'T20:00:00+08:00');
const before = new Date(cutoff.getTime() - 3600000), after = new Date(cutoff.getTime() + 3600000);
const prefix = 'synthetic-v1-02-items-' + randomUUID();
const report: Row = { startedAt: new Date().toISOString(), prefix, fixedPeriod: { start, cutoff }, fixture: { reused: fixture.prefix, ownerId, workerId, designerId, uid, pid, otherPid }, checks: [] };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const read = <T>(fn: Parameters<typeof withTenantTransaction<T>>[1]) => withTenantTransaction(eid, fn);
const sourcePaths = execFileSync('rg', ['--files', 'admin/src/lib/assistant', 'admin/src/lib/construction', 'admin/src/db', 'admin/src/lib/ai', 'admin/drizzle'], { cwd: root, encoding: 'utf8' })
  .trim().split(/\r?\n/).map(p => p.replaceAll('\\', '/')).filter(p => !p.includes('/__tests__/'));
sourcePaths.push('admin/scripts/xiaok-v1-02-report-items-check.ts', 'admin/scripts/assistant-acceptance-safety.mjs',
  'admin/package.json', 'admin/package-lock.json', 'admin/tsconfig.json', 'admin/.env.local');
const binding = () => Object.fromEntries(sourcePaths.sort().map(p => [p, createHash('sha256').update(fs.readFileSync(path.join(root, p))).digest('hex')]));
const bound = binding();
async function step(name: string, fn: () => Promise<unknown>) {
  try { const result = await fn(); (report.checks as Row[]).push({ name, passed: true, result }); console.log(name + ': PASS'); return result; }
  catch (error) { (report.checks as Row[]).push({ name, passed: false, error: (error as Error).message }); throw error; }
  finally { save(); }
}
async function accounting() {
  return withPlatformTransaction(async tx => ({ providerMax: String((await one(tx, sql`select coalesce(max(id),0) id from app.ai_provider_attempts`))!.id),
    knowledgeMax: String((await one(tx, sql`select coalesce(max(id),0) id from app.assistant_knowledge_attempts`))!.id),
    unknown3753: await one(tx, sql`select id::text,status from app.assistant_knowledge_attempts where id=3753`) }));
}
let release: (() => Promise<void>) | undefined, settingsBefore: Row | undefined, activated = false;
let customer!: ActorContext, cid = '', roomId = '';
const activeBindings: Row[] = [], services: FollowupService[] = [], reports: Row[] = [];
async function member(aid: string, active: boolean, role = 'designer', at?: Date) {
  const old = await read(tx => one(tx, sql`select coalesce(max(id),0)::text id from app.construction_audits where enterprise_id=${eid} and project_id=${pid}`));
  const result = await owner.execute('member', { projectId: pid, expectedVersion: ((await owner.execute('detail', { projectId: pid })).project as Row).version,
    adminId: aid, role, active, workLabel: '合成报告历史验收' }, randomUUID());
  if (at) await read(async tx => {
    const audit = await one(tx, sql`select id,created_at from app.construction_audits where enterprise_id=${eid} and project_id=${pid}
      and id>${String(old!.id)} and action='member' and snapshot->>'adminId'=${aid} and snapshot->>'active'=${String(active)} order by id desc limit 1`);
    assert.ok(audit, 'Only the newly written synthetic membership audit may use the controlled clock');
    await tx.execute(sql`update app.construction_audits set created_at=${at} where enterprise_id=${eid} and project_id=${pid} and id=${String(audit.id)}`);
    report.clockedAudits = [...((report.clockedAudits as Row[] | undefined) || []), { id: String(audit.id), originalAt: audit.created_at, controlledAt: at }]; save();
  });
  return result;
}
async function record(label: string, completed = false) {
  const row = await staff.withWriteScope(pid, async (tx, c) => {
    const m = await appendMessage(tx, staff.actor, String(c.id), { author: 'admin', clientMessageId: randomUUID(), purpose: 'site.source',
      content: { version: 1, blocks: [{ type: 'text', text: prefix + '：' + label }] } });
    const r = (await one(tx, sql`insert into app.construction_site_records(enterprise_id,project_id,conversation_id,source_message_id,author_id,status,data)
      values(${eid},${pid},${String(c.id)},${String(m.id)},${designerId},'draft',${JSON.stringify({ title: '合成测试·' + label, roomId,
        completed: completed ? label : '', pending: completed ? '' : label, coordination: '', note: '确定性测试资料，不是实际施工/报价或模型生成' })}::jsonb) returning *`))!;
    await recordVersion(tx, eid, r, designerId, 'organized'); return r;
  });
  const edited = await staff.mutate(pid, String(row.id), 'edit', { expectedVersion: Number(row.version), data: row.data }, randomUUID());
  await new SiteChatService(owner.actor).mutate(pid, String(row.id), 'publish', { expectedVersion: Number(edited.version), audience: 'internal' }, randomUUID());
  await read(tx => tx.execute(sql`update app.construction_site_records set published_at=${new Date(start.getTime() + 3600000)} where enterprise_id=${eid} and id=${String(row.id)}`));
  return String(row.id);
}
async function action(cmd: SiteIssueCommand | ResolutionCommand, at: Date) {
  const service = 'target' in cmd || cmd.action === 'implement' ? staff : new SiteChatService(owner.actor);
  const versions = parseSiteVersions((await service.read(pid)).versions);
  return service.withWriteScope(pid, async (tx, c, _p, permission) => {
    const m = await appendMessage(tx, service.actor, String(c.id), { author: 'admin', clientMessageId: randomUUID(), purpose: 'site.source',
      content: { version: 1, blocks: [{ type: 'text', text: prefix + ' 合成明确操作：' + JSON.stringify(cmd) }] } });
    const result = 'target' in cmd ? await executeSiteIssue(tx, service.actor, pid, String(m.id), cmd, versions, permission.manage)
      : await executeSiteResolution(tx, service.actor, pid, String(m.id), cmd, versions, permission.manage);
    await tx.execute(sql`update app.domain_event_outbox set created_at=${at} where enterprise_id=${eid} and correlation_id=${String(m.id)}`);
    return result as Row;
  });
}
async function issue(rid: string, at: Date, reply = false) {
  const opened = await action({ action: 'open', target: rid, value: '合成测试：点位需核对，没有已确认期限' }, at);
  await action({ action: 'claim', target: String(opened.issueId), value: '' }, at);
  if (reply) await action({ action: 'reply', target: String(opened.issueId), value: '合成测试：已有回复，尚未解决' }, at);
  return String(opened.issueId);
}
async function plan(issueId: string, label: string, approvedAt: Date) {
  const media = await staff.upload(pid, randomUUID(), await sharp({ create: { width: 96, height: 72, channels: 3, background: '#c9dfd0' } }).png().toBuffer());
  const versions = parseSiteVersions((await staff.read(pid)).versions);
  const p = await staff.withWriteScope(pid, async (tx, c, _p, permission) => {
    const m = await appendMessage(tx, staff.actor, String(c.id), { author: 'admin', clientMessageId: randomUUID(), purpose: 'site.source', content: { version: 1, blocks: [{ type: 'text', text: prefix + label }] } });
    const result = await executePlanCommand(tx, staff.actor, pid, String(m.id), { action: 'publish', issueId, title: '合成测试·' + label,
      difference: '合成示例：只核对本版本点位；不是施工或验收许可', costDeltaCents: 10000, scheduleDeltaDays: 1 }, [String(media.id)], versions, permission.manage);
    await tx.execute(sql`update app.domain_event_outbox set created_at=${before} where enterprise_id=${eid} and id=${result.id}`);
    return result;
  });
  const s = new PlanCustomerService(customer, cid);
  await s.decide(p.id, 'preview', { expectedRevision: (await s.read(p.id)).revision }, randomUUID());
  await s.decide(p.id, 'approve', { expectedRevision: (await s.read(p.id)).revision }, randomUUID());
  await read(tx => tx.execute(sql`update app.domain_event_outbox set created_at=${approvedAt} where enterprise_id=${eid}
    and type='construction.plan.status.v1' and aggregate_id=${p.id}`));
  return { id: p.id, mediaId: String(media.id) };
}
async function main() {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(process.argv.includes('--development') && ['localhost', '127.0.0.1'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
  release = await lockAssistantAcceptance(JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL, { waitForLock: true });
  assert.equal((await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`)))!.n, 0);
  report.accountingBefore = await accounting();
  const reentry = process.argv.find(v => v.startsWith('--recheck-revocation='))?.slice(21);
  if (reentry) {
    const sourcePath = path.resolve(reentry), allowed = path.resolve(root, 'tmp/v1-02-report-items') + path.sep;
    assert.ok(sourcePath.startsWith(allowed));
    const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    assert.equal(source.fixture.pid, pid); assert.equal(source.fixture.ownerId, ownerId); assert.equal(source.fixture.reused, fixture.prefix);
    settingsBefore = await read(tx => one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid}`)); assert.ok(!settingsBefore?.enabled);
    await read(tx => tx.execute(sql`update app.admin_users set status='active' where enterprise_id=${eid} and id in (${ownerId},${workerId},${designerId})`)); activated = true;
    for (const p of [pid, otherPid]) await owner.execute('update', { projectId: p, expectedVersion: ((await owner.execute('detail', { projectId: p })).project as Row).version,
      name: '合成测试·V1-02历史报告', status: 'active', customerAccess: true }, randomUUID());
    const reportId = String(source.ownedReports[3].reportId), bindingId = String(source.fixture.bindingIds[3]);
    const service = new FollowupService({ enterpriseId: eid, principal: { kind: 'admin', adminId: ownerId }, contextVersion: 0, capabilities: ['assistant.followup.self'] });
    report.reusedEvidence = { source: path.relative(root, sourcePath), reportId, bindingId, reason: 'Align new synthetic membership audit times with the original future event clock; retain original failed batch and snapshots' };
    await step('saved report reentry before and after correctly clocked source-owner removal/regrant', async () => {
      const before = await service.detail(bindingId, reportId) as Row;
      assert.ok((before.facts as ReportFacts).projects.some(p => p.id === pid));
      const saved = await read(tx => one(tx, sql`select facts_hash,facts from app.construction_report_versions where enterprise_id=${eid} and report_id=${reportId} and revision=1`));
      const auditAt = new Date(new Date(source.fixedPeriod.cutoff).getTime() + 7200000);
      await member(designerId, false, 'designer', auditAt); await member(designerId, true, 'designer', new Date(auditAt.getTime() + 1000));
      const hidden = await service.detail(bindingId, reportId) as Row;
      assert.ok(!(hidden.facts as ReportFacts)?.projects.some(p => p.id === pid));
      assert.deepEqual(await read(tx => one(tx, sql`select facts_hash,facts from app.construction_report_versions where enterprise_id=${eid} and report_id=${reportId} and revision=1`)), saved);
      return { reportId, snapshotHash: saved!.facts_hash, hiddenProject: pid, removalDoesNotResurrectOnRejoin: true };
    });
    await step('no provider/knowledge calls or queued jobs during the targeted recheck', async () => {
      report.accountingAfter = await accounting(); assert.deepEqual(report.accountingAfter, report.accountingBefore);
      assert.equal((await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`)))!.n, 0);
      return report.accountingAfter;
    });
    return;
  }
  await step('reuse labelled Weiyun records and original domain services', async () => {
    assert.equal((await read(tx => one(tx, sql`select name from app.enterprises where id=${eid}`)))!.name, '微云');
    settingsBefore = await read(tx => one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid}`)); assert.ok(!settingsBefore?.enabled);
    for (const aid of [ownerId, workerId, designerId]) {
      const a = await read(tx => one(tx, sql`select username,status from app.admin_users where enterprise_id=${eid} and id=${aid}`));
      assert.ok(String(a?.username).startsWith(fixture.prefix)); assert.equal(a?.status, 'disabled');
    }
    for (const p of [pid, otherPid]) assert.ok(String((await read(tx => one(tx, sql`select name from app.construction_projects where enterprise_id=${eid} and id=${p}`)))!.name).startsWith('合成测试'));
    await read(tx => tx.execute(sql`update app.admin_users set status='active' where enterprise_id=${eid} and id in (${ownerId},${workerId},${designerId})`)); activated = true;
    for (const p of [pid, otherPid]) await owner.execute('update', { projectId: p, expectedVersion: ((await owner.execute('detail', { projectId: p })).project as Row).version,
      name: '合成测试·V1-02历史报告', status: 'active', customerAccess: true }, randomUUID());
    await member(workerId, true, 'manager'); await member(designerId, true);
    customer = { enterpriseId: eid, principal: { kind: 'user', userId: uid }, contextVersion: Number((await withPlatformTransaction(tx => one(tx, sql`select context_version from app.users where id=${uid}`)))!.context_version), capabilities: ['assistant.chat.self'] };
    cid = String((await new ConversationService(customer).create(randomUUID())).id);
    roomId = String(((await staff.read(pid)).rooms as Row[])[0].id);
    await read(async tx => {
      const repo = new AssistantRepository(tx, customer), c = await repo.conversation(cid);
      const m = await appendMessage(tx, customer, cid, { author: 'user', clientMessageId: randomUUID(), content: { version: 1, blocks: [{ type: 'text', text: prefix + ' 合成需求，明确只共享此节选供项目成员核对' }] } });
      await grantMaterial(tx, customer, c, m, { project_id: pid, room_id: roomId, room_name: '客厅', project_name: '合成测试·V1-02历史报告' }, 'need', '合成测试：插座需核对，不是施工许可。', null);
    });
    const actors: ActorContext[] = [{ ...customer, capabilities: ['assistant.followup.self'] }, ...[workerId, designerId, ownerId].map(adminId => ({ enterpriseId: eid, principal: { kind: 'admin' as const, adminId }, contextVersion: 0, capabilities: ['assistant.followup.self'] }))];
    for (const actor of actors) {
      const s = new FollowupService(actor), key = actor.principal.kind === 'user' ? 'user:' + uid : 'admin:' + actor.principal.adminId;
      const b = (await read(tx => one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and principal_key=${key}
        ${actor.principal.kind === 'user' ? sql`and project_id=${pid}` : sql``} order by id desc limit 1`)))!;
      assert.ok(b); activeBindings.push(b); await s.change(String(b.id), 'resume', Number(b.version), randomUUID()); services.push(s);
    }
    await config.configure({ expectedVersion: Number(settingsBefore?.version || 0), enabled: true, dailyTime: '20:00', weeklyTime: '08:00', projectIds: [pid, otherPid], stageKeys: [] }, randomUUID());
    report.fixture = { ...(report.fixture as Row), conversationId: cid, roomId, bindingIds: activeBindings.map(b => String(b.id)) }; return report.fixture;
  });
  const carry = await issue(await record('期前遗留'), new Date(start.getTime() - 3600000));
  const future = await issue(await record('截止后才有回复'), before);
  const ready = await issue(await record('已确认方案事项'), before, true), late = await issue(await record('截止后同意的方案事项'), before, true);
  const a = await plan(ready, '截止前已同意', before), b = await plan(late, '截止后才同意', cutoff);
  await action({ action: 'reply', target: future, value: '这条回复发生在截止后，不能进入旧报告' }, after);
  const evidence = await record('合成落实证据', true), evidenceMedia = await staff.upload(pid, randomUUID(), await sharp({ create: { width: 96, height: 72, channels: 3, background: '#dce9e0' } }).png().toBuffer());
  await read(tx => tx.execute(sql`insert into app.construction_site_attachments(enterprise_id,project_id,record_id,media_id,position) values(${eid},${pid},${evidence},${String(evidenceMedia.id)},0)`));
  for (const cmd of [{ action: 'implement', issueId: ready, planId: a.id, recordId: evidence, conclusion: '合成测试：记录落实，不代表验收' },
    { action: 'resolve', issueId: ready, conclusion: '合成测试：正式解决', excerpt: '合成结果节选', originals: false },
    { action: 'close', issueId: ready, conclusion: '合成测试：正式关闭', excerpt: '合成结果节选', originals: false }] as ResolutionCommand[]) await action(cmd, after);
  report.sources = { carry, future, ready, late, a, b, evidence };
  await step('exclusive cutoff keeps prior issue revisions and only prior confirmed arrangements', async () => {
    const items = await staff.withReadScope(pid, tx => collectReportItems(tx, eid, pid, start, cutoff, async () => true));
    assert.equal(items.issues.find(i => i.id === future)!.status, 'awaiting_owner');
    assert.equal(items.issues.find(i => i.id === ready)!.status, 'awaiting_review');
    assert.equal(items.issues.find(i => i.id === carry)!.carriedOver, true);
    assert.deepEqual(items.arrangements.map(p => p.id), [a.id]);
    assert.equal((await staff.withReadScope(pid, tx => readSiteIssue(tx, eid, pid, ready)))!.status, 'closed');
    assert.ok(!JSON.stringify(items).includes('这条回复发生在截止后')); return items;
  });
  await step('actual queue writes, local Worker completion and private four-role readback', async () => {
    const settings = await config.settings();
    for (const b of activeBindings) {
      const binding = (await read(tx => one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${String(b.id)}`)))!;
      const result = await read(tx => enqueueReport(tx, eid, binding, settings, { kind: 'daily', start, end: cutoff, cutoff, scheduledAt: cutoff })); assert.ok(result); reports.push(result);
    }
    report.ownedReports = reports; save();
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const active = await read(tx => rows(tx, sql`select id,status from app.assistant_runs where enterprise_id=${eid}
        and ${JSON.stringify(reports.map(r => String(r.runId)))}::jsonb ? id::text and status in ('queued','running')`));
      if (!active.length) break;
      const lease = await claimJob(); if (lease) { assert.ok(reports.some(r => r.runId === lease.runId)); await processConstructionReport(lease); }
      else await new Promise(resolve => setTimeout(resolve, 50));
    }
    await deliverConstructionReports(eid);
    for (let i = 0; i < services.length; i++) {
      const d = await services[i].detail(String(activeBindings[i].id), String(reports[i].reportId)) as Row;
      assert.equal(d.available, true); assert.equal(d.state, 'facts_ready'); const facts = d.facts as ReportFacts;
      assert.equal(facts.issuesStatus, i ? 'aggregated' : 'original_consultation_only');
      const p = facts.projects.find(p => p.id === pid)!; assert.ok(p);
      if (i) { assert.equal(p.issues!.find(x => x.id === future)!.revision, 2); assert.deepEqual(p.arrangements!.map(x => x.id), [a.id]); }
      else { assert.equal(p.issues, undefined); assert.equal(p.arrangements, undefined); assert.ok(!JSON.stringify(facts).includes('合成明确操作')); }
      assert.equal((await services[i].list()).items.find(b => b.bindingId === String(activeBindings[i].id))!.unreadReports > 0, true);
    }
    return { reports, providerCalls: 0, ui: 'not exercised' };
  });
  await step('persisted history stays immutable after later progress and duplicate generation', async () => {
    const original = await read(tx => one(tx, sql`select facts_hash,facts from app.construction_report_versions where enterprise_id=${eid} and report_id=${String(reports[3].reportId)} and revision=1`));
    await action({ action: 'reply', target: future, value: '又一次截止后回复' }, new Date(after.getTime() + 1000));
    const d = await services[3].detail(String(activeBindings[3].id), String(reports[3].reportId)) as Row;
    assert.equal((d.facts as ReportFacts).projects.find(p => p.id === pid)!.issues!.find(i => i.id === future)!.revision, 2);
    const saved = await read(tx => one(tx, sql`select facts_hash,facts from app.construction_report_versions where enterprise_id=${eid} and report_id=${String(reports[3].reportId)} and revision=1`)); assert.deepEqual(saved, original);
    const current = (await read(tx => one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${String(activeBindings[3].id)}`)))!;
    assert.equal(await read(async tx => enqueueReport(tx, eid, current, await config.settings(), { kind: 'daily', start, end: cutoff, cutoff, scheduledAt: cutoff })), null);
    assert.equal(await deliverConstructionReports(eid), 0); return { reportId: reports[3].reportId, factsHash: saved!.facts_hash };
  });
  await step('same recipient and foreign tenant cannot read another private binding', async () => {
    await assert.rejects(services[0].detail(String(activeBindings[3].id), String(reports[3].reportId)));
    const other = String((await withPlatformTransaction(tx => one(tx, sql`select id from app.enterprises where id<>${eid} order by id limit 1`)))!.id);
    await assert.rejects(new FollowupService({ ...customer, enterpriseId: other, capabilities: ['assistant.followup.self'] }).detail(String(activeBindings[0].id), String(reports[0].reportId)));
    return { tenant: eid, deniedControlTenant: other };
  });
  await step('withdrawn arrangement and removed/rejoined source owner invalidate saved sections', async () => {
    const later = new Date(after.getTime() + 2000);
    const items = await staff.withReadScope(pid, tx => collectReportItems(tx, eid, pid, start, later, async () => true));
    assert.ok(items.arrangements.some(p => p.id === b.id));
    const versions = parseSiteVersions((await staff.read(pid)).versions);
    await staff.withWriteScope(pid, async (tx, c, _p, permission) => {
      const m = await appendMessage(tx, staff.actor, String(c.id), { author: 'admin', clientMessageId: randomUUID(), purpose: 'site.source', content: { version: 1, blocks: [{ type: 'text', text: prefix + '明确撤回合成方案' }] } });
      await executePlanCommand(tx, staff.actor, pid, String(m.id), { action: 'withdraw', versionId: b.id, reason: '合成测试撤回' }, [], versions, permission.manage);
    });
    assert.equal(await staff.withReadScope(pid, tx => reportItemsAvailable(tx, eid, pid, { ...items, issues: [], arrangements: items.arrangements.filter(p => p.id === b.id) }, async () => true)), false);
    await member(designerId, false, 'designer', new Date(after.getTime() + 5000)); await member(designerId, true, 'designer', new Date(after.getTime() + 6000));
    const d = await services[3].detail(String(activeBindings[3].id), String(reports[3].reportId)) as Row;
    assert.ok(!(d.facts as ReportFacts)?.projects.some(p => p.id === pid));
    return { planId: b.id, removedThenRejoined: designerId, hiddenProject: pid };
  });
  await step('provider/knowledge calls remain unchanged and original unknown is retained', async () => {
    report.accountingAfter = await accounting(); assert.deepEqual(report.accountingAfter, report.accountingBefore); return report.accountingAfter;
  });
}
async function run() {
  try { await main(); }
  catch (error) { report.error = (error as Error).stack; console.error((error as Error).message); process.exitCode = 1; }
  finally {
    try {
      if (activated) {
        const s = await config.settings();
        await config.configure({ expectedVersion: Number(s.version), enabled: false, dailyTime: String(settingsBefore?.daily_time || '20:00'), weeklyTime: String(settingsBefore?.weekly_time || '08:00'),
          projectIds: settingsBefore?.project_ids || [], stageKeys: settingsBefore?.stage_keys || [] }, randomUUID());
        for (const p of [pid, otherPid]) await owner.execute('update', { projectId: p, expectedVersion: ((await owner.execute('detail', { projectId: p })).project as Row).version,
          name: '合成测试·V1-02已归档', status: 'archived', customerAccess: false }, randomUUID());
        await read(async tx => {
          for (const b of activeBindings) await tx.execute(sql`update app.construction_followup_bindings set status='stopped',version=version+1 where enterprise_id=${eid} and id=${String(b.id)}`);
          await tx.execute(sql`update app.admin_users set status='disabled' where enterprise_id=${eid} and id in (${ownerId},${workerId},${designerId})`);
          for (const r of reports) {
            await tx.execute(sql`update app.assistant_jobs set status='cancelled',lease_token=null,lease_expires_at=null where enterprise_id=${eid} and run_id=${String(r.runId)} and status in ('queued','running')`);
            await tx.execute(sql`update app.assistant_runs set status='cancelled',completed_at=now() where enterprise_id=${eid} and id=${String(r.runId)} and status in ('queued','running')`);
          }
        });
      }
      const current = binding(), drift = Object.keys(bound).filter(p => bound[p] !== current[p]);
      fs.writeFileSync(path.join(output, 'binding.json'), JSON.stringify({ before: bound, after: current, drift }, null, 2)); assert.deepEqual(drift, []);
      report.cleanup = { policyDisabled: true, projectsArchived: activated ? [pid, otherPid] : [], accountsDisabled: activated ? [ownerId, workerId, designerId] : [], drift };
    } catch (error) { report.cleanupError = (error as Error).stack; process.exitCode = 1; }
    finally { if (release) await release(); await closePostgresPool(); report.finishedAt = new Date().toISOString(); save(); }
  }
}
void run().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
