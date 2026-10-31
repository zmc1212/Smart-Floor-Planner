/** Fixed deterministic retention-generation checks. Reuse labelled Weiyun
 * fixtures and old evidence; no model, ingestion or native automation. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import type { ActorContext } from '@/lib/assistant/contracts';
import { runAssistantRetention } from '@/lib/assistant/retention/service';
import { ConstructionService } from '@/lib/construction/service';
import { ConstructionReportService } from '@/lib/construction/report-service';
import { FollowupService } from '@/lib/construction/followup-service';
import { enqueueReport, ensureFollowupBinding } from '@/lib/construction/report-store';
import { advanceConstructionReports, deliverConstructionReports } from '@/lib/construction/report-worker';
import { latestReportPeriod } from '@/lib/construction/report-calendar';
import { dailySupplementCandidates } from '@/lib/construction/report-supplements';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

loadEnvConfig(process.cwd(), true);
const root = path.resolve('..'), eid = '1454', projects = ['248', '249'], admins = ['5410', '5411'];
const output = path.resolve(process.argv.find(v => v.startsWith('--output='))?.slice(9) || '../tmp/v1-02-retention-reopen/service-01');
const finishCleanup = process.argv.find(v => v.startsWith('--finish-cleanup='))?.slice(17);
const receiptReplayOnly = process.argv.find(v => v.startsWith('--receipt-replay-only='))?.slice(22);
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Never overwrite an original batch');
fs.mkdirSync(output, { recursive: true });
const report: Row = { startedAt: new Date().toISOString(), scope: 'explicit self-resume after retention; current conversation generation only',
  fixedChecks: ['existing redaction and archived denial', 'automatic no-resurrection', 'authority/version/write gates', 'concurrent explicit resume',
    'same-period queue/delivery/read', 'failed local task fencing', 'real targeted retention', 'deleted retained resume and stale work', 'fresh reentry', 'accounting/source binding'], checks: [] };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function step(name: string, work: () => Promise<unknown>) {
  try { const result = await work(); (report.checks as Row[]).push({ name, passed: true, result }); console.log(name + ': PASS'); return result; }
  catch (error) { (report.checks as Row[]).push({ name, passed: false, error: (error as Error).message }); throw error; }
  finally { save(); }
}
const files = execFileSync('rg', ['--files', 'admin/src/lib/assistant', 'admin/src/lib/construction', 'admin/src/db', 'admin/src/lib/ai', 'admin/drizzle'], { cwd: root, encoding: 'utf8' })
  .trim().split(/\r?\n/).map(f => f.replaceAll('\\', '/'));
files.push('admin/src/app/api/internal/assistant/jobs/run/route.ts', 'admin/scripts/xiaok-v1-02-retention-reopen-check.ts',
  'admin/scripts/assistant-acceptance-safety.mjs', 'admin/package.json', 'admin/package-lock.json', 'admin/tsconfig.json', 'admin/.env.local');
const binding = () => Object.fromEntries([...new Set(files)].sort().map(f => [f, createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')]));
const bound = binding();
function bindCheck() { const after = binding(), drift = Object.keys(bound).filter(f => bound[f] !== after[f]);
  fs.writeFileSync(path.join(output, 'binding.json'), JSON.stringify({ before: bound, after, drift }, null, 2)); assert.deepEqual(drift, []); }
const read = <T>(work: Parameters<typeof withTenantTransaction<T>>[1]) => withTenantTransaction(eid, work);
const actor = (adminId: string): ActorContext => ({ enterpriseId: eid, principal: { kind: 'admin', adminId }, contextVersion: 0, capabilities: ['assistant.followup.self'] });
const owner = new ConstructionService({ enterpriseId: eid, adminId: admins[0] }), config = new ConstructionReportService(owner.actor);
const boss = new FollowupService(actor(admins[0]));
let customer!: FollowupService, policyBefore: Row | undefined, assistantBefore: Row | undefined, setup = false;
let release: (() => Promise<void>) | undefined, afterConversationId = '', customerId = '', firstResumeKey = '', firstSeenKey = '';
const muted: Row[] = [], originalBindings: Row[] = [], projectBefore: Row[] = [], ownRuns: string[] = [], expectedFailures: string[] = [];
let period!: ReturnType<typeof latestReportPeriod>, currentCustomer!: Row, currentBoss!: Row, firstCustomerReport!: Row, failedReport!: Row;
const getBinding = (bid: string) => read(async tx => (await one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${bid}`))!);
const getConversation = (cid: string) => read(async tx => (await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${eid} and id=${cid}`))!);
const accounting = () => withPlatformTransaction(async tx => ({
  providerMax: String((await one(tx, sql`select coalesce(max(id),0) id from app.ai_provider_attempts`))!.id),
  knowledgeMax: String((await one(tx, sql`select coalesce(max(id),0) id from app.assistant_knowledge_attempts`))!.id),
  attempt3753: await one(tx, sql`select id::text,status,input_tokens from app.assistant_knowledge_attempts where id=3753`),
}));
const reportHistory = () => read(tx => rows(tx, sql`select r.id::text,r.latest_revision,v.revision,v.facts_hash,v.facts from app.construction_reports r
  join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id
  where r.enterprise_id=${eid} and r.id in (82,83,84,85) order by r.id,v.revision`));
async function configure(enabled = true) {
  const s = await config.settings(); return config.configure({ expectedVersion: Number(s.version), enabled, dailyTime: '20:00', weeklyTime: '08:00', projectIds: projects, stageKeys: [] }, randomUUID(), period.start);
}
async function enqueue(bid: string, selected = period) {
  const r = await read(async tx => enqueueReport(tx, eid, (await one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${bid} for update`))!,
    (await one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid} for update`))!, selected));
  if (r) ownRuns.push(r.runId); return r;
}
async function drain() {
  for (let n = 0; n < 20; n++) {
    const found = await read(tx => rows(tx, sql`select id::text,status,error_code from app.assistant_runs where enterprise_id=${eid} and ${JSON.stringify(ownRuns)}::jsonb ? id::text order by id`));
    report.ownedRuns = found; save();
    for (const r of found) if (['failed', 'indeterminate', 'cancelled'].includes(String(r.status))) {
      assert.ok(expectedFailures.includes(String(r.id)), 'Retain unexpected failures; never regenerate'); assert.equal(r.status, 'failed'); assert.equal(r.error_code, 'context_changed');
    }
    if (!found.some(r => ['queued', 'running'].includes(String(r.status)))) return;
    const response = await fetch('http://localhost:3006/api/internal/assistant/jobs/run', { method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET! }, signal: AbortSignal.timeout(180000) });
    assert.ok(response.ok); const body = await response.json(); assert.equal(body.success, true); assert.ok(body.data.constructionReportChecks);
  }
  throw Error('Owned original jobs remain active after bounded drain');
}
async function deny(work: () => Promise<unknown>, code: string) {
  await assert.rejects(work, error => (error as { code?: string }).code === code);
}
async function main() {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(process.argv.includes('--development') && ['localhost', '127.0.0.1'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
  const control = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL;
  release = await lockAssistantAcceptance(control);
  assert.equal((await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`)))?.n, 0);
  report.accountingBefore = await accounting(); report.historyBefore = await reportHistory(); bindCheck();
  await step('retained labelled destinations deny archived reopening without writes', async () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tmp/v1-02-first-enable/service-01/report.json'), 'utf8'));
    policyBefore = await read(tx => one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid}`)); assert.equal(policyBefore?.enabled, false);
    assistantBefore = await read(tx => one(tx, sql`select enabled,retention_days from app.assistant_enterprise_settings where enterprise_id=${eid}`)); assert.equal(assistantBefore?.enabled, true);
    await withPlatformTransaction(async tx => { for (const aid of admins) {
      const a = (await one(tx, sql`select username,status,menu_permissions from app.admin_users where id=${aid} and enterprise_id=${eid}`))!;
      assert.ok(String(a.username).startsWith(fixture.prefix)); assert.equal(a.status, 'disabled');
      if (aid === admins[0]) report.operatorMenusBefore = a.menu_permissions;
      await tx.execute(sql`update app.admin_users set status='active' where id=${aid}`);
    } }); setup = true;
    originalBindings.push(...await read(tx => rows(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id in (27,29) order by id`)));
    assert.equal(originalBindings.length, 2);
    for (const b of originalBindings) { assert.equal(b.status, 'stopped'); assert.equal((await getConversation(String(b.conversation_id))).entry_snapshot && ((await getConversation(String(b.conversation_id))).entry_snapshot as Row).retentionRedacted, true); }
    customerId = String(originalBindings[0].user_id);
    const cv = await withPlatformTransaction(tx => one(tx, sql`select context_version from app.users where id=${customerId}`));
    customer = new FollowupService({ enterpriseId: eid, principal: { kind: 'user', userId: customerId }, contextVersion: Number(cv!.context_version), capabilities: ['assistant.followup.self'] });
    const old = (await read(tx => one(tx, sql`select id,period_start,scheduled_at from app.construction_reports
      where enterprise_id=${eid} and kind='daily' and binding_id=29 order by id limit 1`)))!;
    assert.ok(old, 'Use the actual retained boss report, not another audience report ID'); report.originalBossReportId = String(old.id);
    period = latestReportPeriod('daily', new Date(String(old.scheduled_at)), '20:00'); assert.equal(period.start.toISOString(), new Date(String(old.period_start)).toISOString());
    const count = Number((await read(tx => one(tx, sql`select count(*)::int n from app.assistant_conversations where enterprise_id=${eid}`)))!.n);
    await deny(() => customer.change('27', 'resume', Number(originalBindings[0].version), randomUUID()), 'assistant_resource_not_found');
    assert.equal(Number((await read(tx => one(tx, sql`select count(*)::int n from app.assistant_conversations where enterprise_id=${eid}`)))!.n), count);
    for (const pid of projects) { const p = (await owner.execute('detail', { projectId: pid })).project as Row; assert.equal(p.status, 'archived'); projectBefore.push(p);
      await owner.execute('update', { projectId: pid, expectedVersion: p.version, name: p.name, status: 'active', customerAccess: true }, randomUUID()); }
    await read(async tx => { for (const a of await rows(tx, sql`select id from app.admin_users where enterprise_id=${eid} and role='enterprise_admin' and status='active' and id<>${admins[0]}`)) {
      assert.ok(!await one(tx, sql`select id from app.construction_followup_bindings where enterprise_id=${eid} and principal_key=${'admin:' + String(a.id)} and audience='boss'`));
      const b = await ensureFollowupBinding(tx, eid, { kind: 'admin', id: String(a.id), audience: 'boss' }); muted.push(b);
      await tx.execute(sql`update app.construction_followup_bindings set status='stopped' where enterprise_id=${eid} and id=${String(b.id)}`);
    } });
    afterConversationId = String((await read(tx => one(tx, sql`select max(id) id from app.assistant_conversations where enterprise_id=${eid}`)))!.id);
    report.fixture = { enterpriseId: eid, projects, admins, customerId, originalBindings, projectBefore, muted, afterConversationId, period };
    return { archivedDenied: true, originalBindings: originalBindings.map(b => ({ id: b.id, conversationId: b.conversation_id })) };
  });
  await step('configuration discovery tick and ordinary open never revive retention', async () => {
    await configure(); const tick = await advanceConstructionReports(period.end, eid); assert.deepEqual(tick, { queued: 0, errors: [] });
    await deny(() => boss.open(randomUUID()), 'assistant_resource_not_found'); await deny(() => customer.open(randomUUID(), projects[0]), 'assistant_resource_not_found');
    for (const b of originalBindings) assert.deepEqual(await getBinding(String(b.id)), b);
    assert.deepEqual((await boss.list()).items, []); assert.deepEqual((await customer.list()).items, []);
    return { tick, noAutomaticReopening: true };
  });
  await step('self authority expected version and assistant write gates remain enforced', async () => {
    await deny(() => boss.change('27', 'resume', Number(originalBindings[0].version), randomUUID()), 'assistant_resource_not_found');
    await deny(() => customer.change('27', 'resume', Number(originalBindings[0].version) + 1, randomUUID()), 'version_conflict');
    await read(tx => tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${eid}`));
    try { await deny(() => boss.change('29', 'resume', Number(originalBindings[1].version), randomUUID()), 'assistant_disabled'); }
    finally { await read(tx => tx.execute(sql`update app.assistant_enterprise_settings set enabled=true where enterprise_id=${eid}`)); }
    assert.equal((await withTenantTransaction('1', tx => one(tx, sql`select count(*)::int n from app.construction_followup_bindings where enterprise_id=${eid}`)))!.n, 0);
    for (const b of originalBindings) assert.deepEqual(await getBinding(String(b.id)), b);
    return { wrongPrincipalDenied: true, staleVersionDenied: true, disabledDenied: true, tenantRls: true };
  });
  await step('concurrent explicit self resumes rotate once and expose no old history', async () => {
    firstResumeKey = randomUUID(); const oldBoss = await getConversation(String(originalBindings[1].conversation_id)); report.originalBossMode = oldBoss.mode;
    await read(tx => tx.execute(sql`update app.assistant_conversations set mode='human' where enterprise_id=${eid} and id=${String(oldBoss.id)}`));
    const key = randomUUID();
    const result = await Promise.all([boss.change('29', 'resume', Number(originalBindings[1].version), key), boss.change('29', 'resume', Number(originalBindings[1].version), key),
      customer.change('27', 'resume', Number(originalBindings[0].version), firstResumeKey), customer.change('27', 'resume', Number(originalBindings[0].version), firstResumeKey)]);
    assert.deepEqual(result[0], result[1]); assert.deepEqual(result[2], result[3]); currentBoss = result[0]; currentCustomer = result[2];
    for (const [i, s, current] of [[0, customer, currentCustomer], [1, boss, currentBoss]] as const) {
      const old = originalBindings[i], next = await getConversation(String(current.conversationId)); assert.notEqual(next.id, old.conversation_id);
      assert.equal(next.title, ''); assert.equal(next.status, 'open'); assert.ok(!(next.entry_snapshot as Row).retentionRedacted); assert.ok((next.entry_snapshot as Row).followupGeneration);
      assert.equal((await getConversation(String(old.conversation_id))).entry_snapshot && ((await getConversation(String(old.conversation_id))).entry_snapshot as Row).retentionRedacted, true);
      assert.deepEqual((await s.reports(String(old.id))).items, []);
      if (i === 1) await deny(() => s.detail(String(old.id), String(report.originalBossReportId)), 'assistant_resource_not_found');
      const item = (await s.list()).items[0]; assert.equal(item.unreadReports, 0); assert.equal(item.unreadMessages, 0); assert.equal(item.unreadTruncated, false);
      await read(async tx => { await assert.rejects(() => new AssistantRepository(tx, s.actor).conversation(String(old.conversation_id)), /assistant_resource_not_found/); });
    }
    assert.equal((await getConversation(String(currentBoss.conversationId))).mode, 'human');
    assert.equal(Number((await read(tx => one(tx, sql`select count(*)::int n from app.assistant_conversations where enterprise_id=${eid} and id>${afterConversationId}`)))!.n), 2);
    return { customer: currentCustomer, boss: currentBoss, humanModePreserved: true };
  });
  await step('same-period fresh reports deduplicate save deliver and acknowledge only current generation', async () => {
    const key = randomUUID(); const opened = await customer.open(key, projects[0]); assert.equal(opened.conversationId, currentCustomer.conversationId);
    assert.deepEqual(await customer.open(key, projects[0]), opened);
    const attempts = await Promise.all([enqueue('27'), enqueue('27')]); assert.equal(attempts.filter(Boolean).length, 1); firstCustomerReport = attempts.find(Boolean)!;
    const bossReport = (await enqueue('29'))!; assert.ok(bossReport); assert.notEqual(bossReport.reportId, report.originalBossReportId);
    await drain(); await deliverConstructionReports(eid);
    const cv = await customer.detail('27', String(firstCustomerReport.reportId)) as Row; assert.equal(cv.state, 'facts_ready'); assert.equal(cv.deliveryState, 'delivered'); assert.ok(cv.sequence);
    const bv = await boss.detail('29', bossReport.reportId) as Row; assert.equal(bv.deliveryState, 'held'); assert.equal(bv.sequence, null);
    await customer.acknowledge('27', String(firstCustomerReport.reportId), 1, String(cv.readToken), randomUUID());
    assert.equal((await customer.list()).items[0].unreadReports, 0); assert.equal((await customer.list()).items[0].unreadMessages, 1);
    firstSeenKey = randomUUID();
    await deny(() => customer.seen('27', String(cv.sequence), randomUUID()), 'context_changed');
    await customer.seen('27', String(cv.sequence), firstSeenKey, String(currentCustomer.conversationId)); assert.equal((await customer.list()).items[0].unreadMessages, 0);
    await read(tx => tx.execute(sql`update app.assistant_conversations set mode='ai' where enterprise_id=${eid} and id=${String(currentBoss.conversationId)}`));
    assert.equal(await deliverConstructionReports(eid), 1); assert.equal(await deliverConstructionReports(eid), 0);
    assert.deepEqual(await reportHistory(), report.historyBefore); report.firstReports = { customer: firstCustomerReport, boss: bossReport };
    return { newCustomerReport: firstCustomerReport, newBossReport: bossReport, duplicateTasks: 0, noOldHistory: true };
  });
  await step('stopping fences a queued original local run and resume retains its failure', async () => {
    failedReport = (await enqueue('27', latestReportPeriod('daily', new Date(period.end.getTime() + 86400000), '20:00')))!; expectedFailures.push(String(failedReport.runId));
    let b = await getBinding('27'); await customer.change('27', 'stop', Number(b.version), randomUUID()); await drain();
    b = await getBinding('27'); const resumed = await customer.change('27', 'resume', Number(b.version), randomUUID()); assert.equal(resumed.conversationId, currentCustomer.conversationId);
    const state = await customer.detail('27', String(failedReport.reportId)) as Row; assert.equal(state.state, 'failed'); assert.equal(state.errorCode, 'context_changed');
    return { failedOriginal: failedReport, ordinaryResumeRotates: false };
  });
  await step('real scoped retention redacts a deleted destination while preserving its held report', async () => {
    await read(tx => tx.execute(sql`update app.assistant_conversations set mode='human' where enterprise_id=${eid} and id=${String(currentCustomer.conversationId)}`));
    const correction = await config.correct(String(firstCustomerReport.reportId), 1, randomUUID(), new Date(period.end.getTime() + 3600000)); ownRuns.push(String(correction.runId));
    await drain(); await deliverConstructionReports(eid); assert.equal((await customer.detail('27', String(firstCustomerReport.reportId)) as Row).deliveryState, 'held');
    const b = await getBinding('27'); await customer.change('27', 'delete', Number(b.version), randomUUID());
    await read(async tx => {
      await tx.execute(sql`update app.admin_users set menu_permissions=array_append(coalesce(menu_permissions,array[]::text[]),'assistant-retention') where enterprise_id=${eid} and id=${admins[0]}`);
      await tx.execute(sql`update app.assistant_conversations set updated_at=now()-(${Number(assistantBefore!.retention_days) + 1}::integer * interval '1 day')
        where enterprise_id=${eid} and id=${String(currentCustomer.conversationId)}`);
    });
    const dry = await runAssistantRetention({ enterpriseId: eid, adminId: admins[0], afterConversationId });
    assert.deepEqual(dry.candidates.map(c => c.conversationId), [String(currentCustomer.conversationId)]); assert.ok(dry.candidates[0].eligible);
    const applied = await runAssistantRetention({ enterpriseId: eid, adminId: admins[0], afterConversationId, mode: 'apply' }); assert.equal(applied.applied.conversations, 1);
    report.retention = { dry, applied }; assert.deepEqual((await customer.list()).items, []);
    const before = await getBinding('27'); await configure(); assert.deepEqual(await getBinding('27'), before);
    assert.deepEqual(await advanceConstructionReports(new Date(period.end.getTime() + 3600000), eid), { queued: 0, errors: [] });
    return { conversationId: currentCustomer.conversationId, actualRetainedConversations: applied.applied.conversations, heldOriginalPreserved: true };
  });
  await step('explicit deleted-retained resume excludes stale corrections retry receipts and held deliveries', async () => {
    const b = await getBinding('27'), previous = String(currentCustomer.conversationId); assert.equal(b.status, 'deleted');
    currentCustomer = await customer.change('27', 'resume', Number(b.version), randomUUID()); assert.notEqual(currentCustomer.conversationId, previous);
    assert.deepEqual((await customer.reports('27')).items, []); assert.equal((await customer.list()).items[0].unreadMessages, 0);
    await deny(() => customer.detail('27', String(firstCustomerReport.reportId)), 'assistant_resource_not_found');
    await deny(() => customer.retry('27', String(failedReport.reportId), 1, randomUUID()), 'context_changed');
    await deny(() => config.correct(String(firstCustomerReport.reportId), 2, randomUUID()), 'context_changed');
    await deny(() => customer.change('27', 'resume', Number(originalBindings[0].version), firstResumeKey), 'context_changed');
    await deny(() => customer.acknowledge('27', '82', 1, 'old-token', randomUUID()), 'assistant_resource_not_found');
    await deny(() => customer.seen('27', '1', randomUUID()), 'context_changed');
    assert.equal(await deliverConstructionReports(eid), 0);
    const oldDelivery = await read(tx => one(tx, sql`select state from app.construction_report_deliveries where enterprise_id=${eid} and report_id=${String(firstCustomerReport.reportId)} and revision=2`));
    assert.equal(oldDelivery!.state, 'revoked');
    const candidates = await read(tx => rows(tx, sql`select r.id ${dailySupplementCandidates(eid, new Date(period.start.getTime() + 86400000))}`));
    assert.ok(!candidates.some(r => String(r.id) === String(firstCustomerReport.reportId)));
    return { currentCustomer, oldHeldDelivery: oldDelivery, oldReportsReadable: false, oldJobsRetryable: false, oldCorrections: false };
  });
  await step('new generation same-period report persists reentry without old unread or context', async () => {
    const newest = (await enqueue('27'))!; assert.ok(newest); assert.notEqual(newest.reportId, firstCustomerReport.reportId); await drain(); await deliverConstructionReports(eid);
    assert.equal((await customer.detail('27', newest.reportId) as Row).deliveryState, 'held');
    await read(tx => tx.execute(sql`update app.assistant_conversations set mode='ai' where enterprise_id=${eid} and id=${String(currentCustomer.conversationId)}`));
    assert.equal(await deliverConstructionReports(eid), 1); assert.equal(await deliverConstructionReports(eid), 0);
    const reentry = new FollowupService(customer.actor); assert.equal((await reentry.reports('27')).items.length, 1);
    const item = (await reentry.list()).items[0]; assert.equal(item.unreadReports, 1); assert.equal(item.unreadMessages, 1); assert.equal(item.unreadTruncated, false);
    const messages = await read(tx => rows(tx, sql`select content from app.assistant_messages where enterprise_id=${eid} and conversation_id=${String(currentCustomer.conversationId)}`));
    assert.equal(messages.length, 1); assert.deepEqual(messages[0].content, { version: 1, blocks: [{ type: 'text', text: `report:${newest.reportId}:1` }] });
    assert.equal((await getBinding('27')).last_read_seq, '0'); assert.deepEqual(await reportHistory(), report.historyBefore);
    const seq = String((await reentry.detail('27', newest.reportId)).sequence);
    await deny(() => customer.seen('27', seq, firstSeenKey, String(firstCustomerReport.conversationId)), 'context_changed');
    await deny(() => customer.seen('27', seq, firstSeenKey, String(currentCustomer.conversationId)), 'idempotency_conflict');
    assert.equal((await reentry.list()).items[0].unreadMessages, 1);
    await customer.seen('27', seq, randomUUID(), String(currentCustomer.conversationId)); assert.equal((await reentry.list()).items[0].unreadMessages, 0);
    report.newestReport = newest; return { newest, reentryReports: 1, unreadReports: 1, unreadMessages: 1, sourceFactsUnchanged: true };
  });
  await step('no model ingestion attempt or unknown-cost reset and stable source binding', async () => {
    report.accountingAfter = await accounting(); assert.deepEqual(report.accountingAfter, report.accountingBefore); bindCheck(); return report.accountingAfter;
  }); report.passed = true;
}
async function cleanupRemainder(previousPath: string) {
  const previousFile = path.resolve(previousPath), previous = JSON.parse(fs.readFileSync(previousFile, 'utf8'));
  assert.ok(previous.passed && previous.cleanupError && previous.checks.length === 10 && previous.checks.every((c: Row) => c.passed));
  const previousBinding = JSON.parse(fs.readFileSync(path.join(path.dirname(previousFile), 'binding.json'), 'utf8'));
  const changed = Object.keys(previousBinding.before).filter(f => previousBinding.before[f] !== bound[f]);
  assert.deepEqual(changed, ['admin/scripts/xiaok-v1-02-retention-reopen-check.ts']);
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(process.argv.includes('--development') && ['localhost', '127.0.0.1'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
  const control = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL;
  release = await lockAssistantAcceptance(control);
  assert.equal((await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`)))?.n, 0);
  report.scope = 'cleanup remainder only; reuse original ten successful business checks without replay';
  report.reusedEvidence = { path: previousFile, sha256: createHash('sha256').update(fs.readFileSync(previousFile)).digest('hex'), changed, checks: previous.checks.map((c: Row) => c.name) };
  originalBindings.push(...previous.fixture.originalBindings); ownRuns.push(...previous.ownedRuns.map((r: Row) => String(r.id)));
  assistantBefore = { enabled: true }; policyBefore = await config.settings(); assert.equal(policyBefore.enabled, false);
  report.operatorMenusBefore = previous.operatorMenusBefore; report.originalBossMode = previous.originalBossMode;
  for (const pid of projects) { const p = (await owner.execute('detail', { projectId: pid })).project as Row; projectBefore.push({ ...p, status: 'archived', customer_access: false }); }
  // The failed batch predates persisted cleanup inputs. Its exact empty
  // suppression was separately inspected; never select other owners by guess.
  const suppression = await getBinding('36'); assert.equal(suppression.principal_key, 'admin:2853'); assert.equal(suppression.conversation_id, '875'); assert.equal(suppression.status, 'stopped');
  assert.ok(new Date(String(suppression.created_at)) >= new Date(previous.startedAt) && new Date(String(suppression.created_at)) <= new Date(previous.finishedAt)); muted.push(suppression);
  report.accountingBefore = await accounting(); assert.deepEqual(report.accountingBefore, previous.accountingAfter); setup = true;
  await step('reuse unchanged product evidence and finish only owned cleanup', async () => ({ reusedChecks: 10, rerunBusinessChecks: 0, productDrift: [], muted: muted.map(b => String(b.id)) }));
  report.passed = true;
}
async function receiptReplay(previousPath: string) {
  const previousFile = path.resolve(previousPath), previous = JSON.parse(fs.readFileSync(previousFile, 'utf8'));
  assert.ok(previous.passed && previous.cleanup && !previous.cleanupError);
  const previousBinding = JSON.parse(fs.readFileSync(path.join(path.dirname(previousFile), 'binding.json'), 'utf8'));
  const changed = Object.keys(previousBinding.before).filter(f => previousBinding.before[f] !== bound[f]);
  assert.deepEqual(changed, ['admin/scripts/xiaok-v1-02-retention-reopen-check.ts', 'admin/src/lib/construction/followup-service.ts', 'admin/src/lib/construction/report-service.ts']);
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(process.argv.includes('--development') && ['localhost', '127.0.0.1'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
  const control = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL;
  release = await lockAssistantAcceptance(control);
  assert.equal((await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`)))?.n, 0);
  report.scope = 'only actual retry/correction idempotency receipts crossing retention; reuse the previous ten checks';
  report.reusedEvidence = { path: previousFile, sha256: createHash('sha256').update(fs.readFileSync(previousFile)).digest('hex'), changed,
    impact: 'retry prevalidation and correction postvalidation only; unchanged generation, role, fact and unread checks reused' };
  policyBefore = await read(tx => one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid}`)); assert.equal(policyBefore!.enabled, false);
  assistantBefore = await read(tx => one(tx, sql`select enabled,retention_days from app.assistant_enterprise_settings where enterprise_id=${eid}`)); assert.equal(assistantBefore!.enabled, true);
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tmp/v1-02-first-enable/service-01/report.json'), 'utf8'));
  await withPlatformTransaction(async tx => { for (const aid of admins) {
    const a = (await one(tx, sql`select username,status,menu_permissions from app.admin_users where enterprise_id=${eid} and id=${aid}`))!;
    assert.ok(String(a.username).startsWith(fixture.prefix)); assert.equal(a.status, 'disabled'); if (aid === admins[0]) report.operatorMenusBefore = a.menu_permissions;
    await tx.execute(sql`update app.admin_users set status='active' where id=${aid}`);
  } }); setup = true;
  originalBindings.push(await getBinding('27'), await getBinding('29')); customerId = String(originalBindings[0].user_id);
  const cv = await withPlatformTransaction(tx => one(tx, sql`select context_version from app.users where id=${customerId}`));
  customer = new FollowupService({ enterpriseId: eid, principal: { kind: 'user', userId: customerId }, contextVersion: Number(cv!.context_version), capabilities: ['assistant.followup.self'] });
  for (const pid of projects) { const p = (await owner.execute('detail', { projectId: pid })).project as Row; assert.equal(p.status, 'archived'); projectBefore.push(p);
    await owner.execute('update', { projectId: pid, expectedVersion: p.version, name: p.name, status: 'active', customerAccess: true }, randomUUID()); }
  await read(async tx => { for (const a of await rows(tx, sql`select id from app.admin_users where enterprise_id=${eid} and role='enterprise_admin' and status='active' and id<>${admins[0]}`)) {
    assert.ok(!await one(tx, sql`select id from app.construction_followup_bindings where enterprise_id=${eid} and principal_key=${'admin:' + String(a.id)} and audience='boss'`));
    const b = await ensureFollowupBinding(tx, eid, { kind: 'admin', id: String(a.id), audience: 'boss' }); muted.push(b);
    await tx.execute(sql`update app.construction_followup_bindings set status='stopped' where enterprise_id=${eid} and id=${String(b.id)}`);
  } });
  const old = (await read(tx => one(tx, sql`select id,scheduled_at from app.construction_reports where enterprise_id=${eid} and id=96 and binding_id=27`)))!; assert.ok(old);
  period = latestReportPeriod('daily', new Date(String(old.scheduled_at)), '20:00');
  await configure(); currentCustomer = await customer.change('27', 'resume', Number(originalBindings[0].version), randomUUID());
  afterConversationId = String(BigInt(String(currentCustomer.conversationId)) - 1n);
  report.fixture = { projects, admins, originalBindings, projectBefore, muted, currentCustomer, afterConversationId }; report.accountingBefore = await accounting(); report.historyBefore = await reportHistory();
  let retryKey = '', correctionKey = '', retried!: Row;
  await step('real same-generation failed-job retry and correction persist original receipts', async () => {
    failedReport = (await enqueue('27', latestReportPeriod('daily', new Date(period.end.getTime() + 2 * 86400000), '20:00')))!; expectedFailures.push(String(failedReport.runId));
    let b = await getBinding('27'); await customer.change('27', 'stop', Number(b.version), randomUUID()); await drain(); b = await getBinding('27');
    await customer.change('27', 'resume', Number(b.version), randomUUID()); retryKey = randomUUID();
    retried = await customer.retry('27', String(failedReport.reportId), 1, retryKey); assert.equal(retried.runId, failedReport.runId);
    assert.deepEqual(await customer.retry('27', String(failedReport.reportId), 1, retryKey), retried); await drain();
    assert.equal((await customer.detail('27', String(failedReport.reportId))).state, 'facts_ready');
    await read(tx => tx.execute(sql`update app.assistant_conversations set mode='human' where enterprise_id=${eid} and id=${String(currentCustomer.conversationId)}`));
    correctionKey = randomUUID(); const correction = await config.correct('96', 1, correctionKey, new Date(period.end.getTime() + 3600000)); ownRuns.push(String(correction.runId));
    assert.deepEqual(await config.correct('96', 1, correctionKey), correction); await drain(); await deliverConstructionReports(eid);
    report.receipts = { retryKey, correctionKey, retry: retried, correction }; return { retry: retried, correction, realReceiptKeysSaved: true };
  });
  await step('actual retention then explicit renewal rejects original receipt replay before any redispatch', async () => {
    let b = await getBinding('27'); const previousConversation = String(b.conversation_id); await customer.change('27', 'delete', Number(b.version), randomUUID());
    await read(async tx => {
      await tx.execute(sql`update app.admin_users set menu_permissions=array_append(coalesce(menu_permissions,array[]::text[]),'assistant-retention') where enterprise_id=${eid} and id=${admins[0]}`);
      await tx.execute(sql`update app.assistant_conversations set updated_at=now()-(${Number(assistantBefore!.retention_days) + 1}::integer * interval '1 day') where enterprise_id=${eid} and id=${previousConversation}`);
    });
    const dry = await runAssistantRetention({ enterpriseId: eid, adminId: admins[0], afterConversationId }); assert.deepEqual(dry.candidates.map(c => c.conversationId), [previousConversation]); assert.ok(dry.candidates[0].eligible);
    const applied = await runAssistantRetention({ enterpriseId: eid, adminId: admins[0], afterConversationId, mode: 'apply' }); assert.equal(applied.applied.conversations, 1); report.retention = { dry, applied };
    b = await getBinding('27'); currentCustomer = await customer.change('27', 'resume', Number(b.version), randomUUID()); assert.notEqual(currentCustomer.conversationId, previousConversation);
    const before = Number((await read(tx => one(tx, sql`select count(*)::int n from app.assistant_runs where enterprise_id=${eid}`)))!.n);
    await deny(() => customer.retry('27', String(failedReport.reportId), 1, retryKey), 'context_changed');
    await deny(() => config.correct('96', 1, correctionKey), 'context_changed');
    assert.equal(Number((await read(tx => one(tx, sql`select count(*)::int n from app.assistant_runs where enterprise_id=${eid}`)))!.n), before);
    assert.equal((await read(tx => one(tx, sql`select status from app.assistant_runs where enterprise_id=${eid} and id=${String(retried.runId)}`)))!.status, 'succeeded');
    assert.equal((await read(tx => one(tx, sql`select latest_revision from app.construction_reports where enterprise_id=${eid} and id=96`)))!.latest_revision, 2);
    assert.equal(await deliverConstructionReports(eid), 0); assert.deepEqual((await customer.reports('27')).items, []); assert.equal((await customer.list()).items[0].unreadMessages, 0);
    return { newConversationId: currentCustomer.conversationId, oldRetryReceiptRejected: true, oldCorrectionReceiptRejected: true, newRuns: 0, oldPendingDelivered: 0 };
  });
  await step('receipt fencing preserves original business facts usage and bound source', async () => {
    assert.deepEqual(await reportHistory(), report.historyBefore); report.accountingAfter = await accounting(); assert.deepEqual(report.accountingAfter, report.accountingBefore); bindCheck(); return report.accountingAfter;
  }); report.passed = true;
}
async function run() {
  try { if (finishCleanup) await cleanupRemainder(finishCleanup); else if (receiptReplayOnly) await receiptReplay(receiptReplayOnly); else await main(); }
  catch (error) { report.error = (error as Error).stack; process.exitCode = 1; console.error((error as Error).message); }
  finally {
    try {
      if (setup) {
        if (assistantBefore) await read(tx => tx.execute(sql`update app.assistant_enterprise_settings set enabled=${Boolean(assistantBefore!.enabled)} where enterprise_id=${eid}`));
        if (policyBefore) { const s = await config.settings(); await config.configure({ expectedVersion: Number(s.version), enabled: false, dailyTime: String(policyBefore.daily_time),
          weeklyTime: String(policyBefore.weekly_time), projectIds: policyBefore.project_ids, stageKeys: policyBefore.stage_keys }, randomUUID()); }
        for (const p of projectBefore) await owner.execute('update', { projectId: String(p.id), expectedVersion: ((await owner.execute('detail', { projectId: String(p.id) })).project as Row).version,
          name: p.name, status: p.status, customerAccess: p.customer_access }, randomUUID());
        await read(async tx => {
          for (const b of originalBindings) await tx.execute(sql`update app.construction_followup_bindings set status='stopped',version=version+1 where enterprise_id=${eid} and id=${String(b.id)} and status<>'deleted'`);
          if (report.originalBossMode) await tx.execute(sql`update app.assistant_conversations set mode=${String(report.originalBossMode)} where enterprise_id=${eid} and id=${String(originalBindings[1].conversation_id)}`);
          for (const b of muted) { assert.equal((await one(tx, sql`select count(*)::int n from app.assistant_messages where enterprise_id=${eid} and conversation_id=${String(b.conversation_id)}`))!.n, 0);
            await tx.execute(sql`delete from app.construction_followup_bindings where enterprise_id=${eid} and id=${String(b.id)}`);
            await tx.execute(sql`delete from app.assistant_participants where enterprise_id=${eid} and conversation_id=${String(b.conversation_id)}`);
            await tx.execute(sql`delete from app.assistant_conversations where enterprise_id=${eid} and id=${String(b.conversation_id)}`); }
          for (const rid of ownRuns) {
            await tx.execute(sql`update app.assistant_jobs set status='cancelled',lease_token=null,lease_expires_at=null,last_error='synthetic_fixture_closed' where enterprise_id=${eid} and run_id=${rid} and status in ('queued','running')`);
            await tx.execute(sql`update app.assistant_runs set status='cancelled',error_code='synthetic_fixture_closed',completed_at=now() where enterprise_id=${eid} and id=${rid} and status in ('queued','running')`);
          }
          if (report.operatorMenusBefore !== undefined) await tx.execute(sql`update app.admin_users set menu_permissions=
            case when ${JSON.stringify(report.operatorMenusBefore)}::jsonb='null'::jsonb then null
              else array(select jsonb_array_elements_text(${JSON.stringify(report.operatorMenusBefore)}::jsonb)) end
            where enterprise_id=${eid} and id=${admins[0]}`);
        });
        await withPlatformTransaction(async tx => { for (const aid of admins) await tx.execute(sql`update app.admin_users set status='disabled' where id=${aid}`); });
      }
      bindCheck();
      if (setup) {
        const verified = await withPlatformTransaction(async tx => ({
          queuedRunning: Number((await one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`))!.n),
          settings: await one(tx, sql`select enabled,version from app.construction_report_settings where enterprise_id=${eid}`),
          assistant: await one(tx, sql`select enabled from app.assistant_enterprise_settings where enterprise_id=${eid}`),
          projects: await rows(tx, sql`select id::text,status,customer_access from app.construction_projects where enterprise_id=${eid} and ${JSON.stringify(projects)}::jsonb ? id::text order by id`),
          accounts: await rows(tx, sql`select id::text,status from app.admin_users where ${JSON.stringify(admins)}::jsonb ? id::text order by id`),
          bindings: await rows(tx, sql`select id::text,status,conversation_id::text from app.construction_followup_bindings where enterprise_id=${eid} and id in (27,29) order by id`),
        }));
        assert.equal(verified.queuedRunning, 0); assert.equal(verified.settings!.enabled, false); assert.equal(verified.assistant!.enabled, true);
        assert.ok(verified.projects.every(p => p.status === 'archived' && p.customer_access === false)); assert.ok(verified.accounts.every(a => a.status === 'disabled'));
        assert.ok(verified.bindings.every(b => b.status === 'stopped')); report.cleanup = verified;
        report.accountingAfter = await accounting(); if (report.accountingBefore) assert.deepEqual(report.accountingAfter, report.accountingBefore);
      }
    } catch (error) { report.cleanupError = (error as Error).stack; process.exitCode = 1; }
    finally { if (release) await release(); await closePostgresPool(); report.finishedAt = new Date().toISOString(); save(); }
  }
}
void run().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
