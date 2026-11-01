/** Bounded screen09 service/native checks. Local labelled fixtures, zero providers. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadEnvConfig } from '@next/env';
import { SignJWT } from 'jose';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConstructionService } from '@/lib/construction/service';
import { ConstructionReportService } from '@/lib/construction/report-service';
import { ensureFollowupBinding, enqueueReport } from '@/lib/construction/report-store';
import { processConstructionReport, deliverConstructionReports } from '@/lib/construction/report-worker';
import { latestReportPeriod } from '@/lib/construction/report-calendar';
import { readStageSettings } from '@/lib/construction/stages-store';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { runAssistantRetention } from '@/lib/assistant/retention/service';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

loadEnvConfig(process.cwd(), true);
const root = path.resolve('..'), eid = '1454', pid = '248', bid = '50';
const output = path.resolve(process.argv.find(s => s.startsWith('--output='))?.slice(9) || '../tmp/v1-02-followup-settings/http-01');
const nativeScript = process.argv.find(s => s.startsWith('--native-script='))?.slice(16);
const migrateOnly = process.argv.includes('--migrate-only');
const cleanupOnly = process.argv.find(s => s.startsWith('--cleanup-only='))?.slice(15);
const continueFrom = process.argv.find(s => s.startsWith('--continue-from='))?.slice(16);
const afterDelete = process.argv.find(s => s.startsWith('--after-delete='))?.slice(15);
const retentionOnly = process.argv.find(s => s.startsWith('--retention-only='))?.slice(17);
let previousDelete: Row | undefined;
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Keep each original batch'); fs.mkdirSync(output, { recursive: true });
const fixedChecks = ['labelled fixtures and original authority', 'minimal management for customer and four staff roles',
  'personal CAS preferences and same-key receipt', 'muted stage daily weekly reports are saved without unread or insertion',
  'hidden visibility and future-only reception', 'stop resume same destination and deleted new generation',
  'actual retained tombstone management and human-mode renewal', 'current member customer and tenant denial', 'accounting and cleanup'];
const report: Row = { startedAt: new Date().toISOString(), fixedChecks, checks: [] };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const owner = new ConstructionService({ enterpriseId: eid, adminId: '5410' }), policy = new ConstructionReportService(owner.actor);
const read = <T>(work: Parameters<typeof withTenantTransaction<T>>[1]) => withTenantTransaction(eid, work);
const accounts: Row[] = [], users: Row[] = [], bindings: Row[] = [], runs: string[] = [];
const actors: Array<{ name: string; id: string; uid: string; role: string; token: string; entry?: string }> = [];
let release: (() => Promise<void>) | undefined, projectBefore: Row | undefined, policyBefore: Row | undefined;
let originalCid = '', memberBefore: Row | undefined, staged = false;
const files = execFileSync('rg', ['--files', 'admin/src/lib', 'admin/src/db', 'admin/drizzle',
  'admin/src/app/api/miniprogram', 'miniprogram'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).map(p => p.replaceAll('\\', '/'));
files.push('admin/scripts/xiaok-v1-02-followup-settings-check.ts', 'admin/scripts/assistant-acceptance-safety.mjs',
  'admin/src/lib/miniprogram-auth.ts', 'admin/src/lib/miniprogram-jwt.ts', 'admin/package.json', 'admin/package-lock.json', 'admin/tsconfig.json', 'admin/.env.local');
if (nativeScript) files.push(path.relative(root, path.resolve(nativeScript)).replaceAll('\\', '/'),
  'admin/scripts/wechatide-native-client.ts', 'tmp/wechat-devtools-version-test/window.ps1');
const binding = () => Object.fromEntries([...new Set(files)].sort().map(p => [p, createHash('sha256').update(fs.readFileSync(path.join(root, p))).digest('hex')]));
const before = binding();
const getBinding = (id = bid) => read(async tx => (await one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${id}`))!);
const getConversation = (cid: string) => read(async tx => (await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${eid} and id=${cid}`))!);
const accounting = () => withPlatformTransaction(async tx => ({ providerMax: String((await one(tx, sql`select coalesce(max(id),0) id from app.ai_provider_attempts`))!.id),
  knowledgeMax: String((await one(tx, sql`select coalesce(max(id),0) id from app.assistant_knowledge_attempts`))!.id),
  unknown: await one(tx, sql`select status,input_tokens from app.assistant_knowledge_attempts where id=3753`) }));
async function step(name: string, fn: () => Promise<unknown>) {
  try { const data = await fn(); (report.checks as Row[]).push({ name, passed: true, data }); console.log(name + ': PASS'); return data; }
  catch (e) { (report.checks as Row[]).push({ name, passed: false, error: (e as Error).message }); throw e; } finally { save(); }
}
async function http(name: string, route = '', body?: Row, requestKey = randomUUID(), expected = 200) {
  const a = actors.find(a => a.name === name)!;
  const response = await fetch('http://127.0.0.1:3006/api/miniprogram/assistant/followups' + route, {
    method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + a.token, ...(a.entry ? { 'X-Assistant-Entry': a.entry } : {}), ...(body ? { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  const data = await response.json(); assert.equal(response.status, expected, name + ' ' + route + ': ' + (data.code || data.error || ''));
  return expected === 200 ? data.data : data;
}
async function change(action: string, requestKey = randomUUID()) {
  const b = await getBinding(); return http('designer', '/' + bid + '/' + action, { expectedVersion: Number(b.version) }, requestKey);
}
async function preferences(value: Row, name = 'designer', id = bid) {
  const b = await getBinding(id); return http(name, '/' + id + '/preferences', { expectedVersion: Number(b.version), preferences: value });
}
const all = (v: boolean) => ({ stage: v, daily: v, weekly: v });
async function enqueue(kind: 'daily' | 'weekly' | 'stage', day = '2026-11-25') {
  const period = latestReportPeriod(kind === 'weekly' ? 'weekly' : 'daily', new Date(day + 'T20:00:00+08:00'), kind === 'weekly' ? '08:00' : '20:00');
  const result = await read(async tx => {
    const b = (await one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${bid} for update`))!;
    const settings = (await one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid} for update`))!;
    if (kind === 'stage') {
      const event = (await one(tx, sql`select e.* from app.domain_event_outbox e join app.construction_projects p
        on p.enterprise_id=e.enterprise_id and p.id::text=e.aggregate_id and p.progress_revision=e.aggregate_version
        where e.enterprise_id=${eid} and p.id=${pid} and e.type='construction.stage.updated.v1' order by e.id desc limit 1`))!;
      assert.ok(event, 'Retained synthetic current stage event'); const at = new Date(String(event.created_at));
      return enqueueReport(tx, eid, b, settings, { kind, start: at, end: at, cutoff: new Date(at.getTime() + 1), scheduledAt: at, stageEventId: String(event.id) });
    }
    return enqueueReport(tx, eid, b, settings, period);
  });
  assert.ok(result, 'New scoped report expected'); runs.push(result.runId); report.runs = runs; save(); return result;
}
async function drain() {
  for (let n = 0; n < 30; n++) {
    const active = await read(tx => rows(tx, sql`select id from app.assistant_runs where enterprise_id=${eid}
      and ${JSON.stringify(runs)}::jsonb ? id::text and status in ('queued','running')`));
    if (!active.length) return;
    const lease = await claimJob(); if (lease) { assert.ok(lease.enterpriseId === eid && runs.includes(lease.runId)); await processConstructionReport(lease); }
    else await new Promise(resolve => setTimeout(resolve, 100));
  } throw Error('Bounded local drain exceeded');
}
async function retention() {
  const b = await getBinding(), cid = String(b.conversation_id);
  assert.equal(b.status, 'deleted');
  assert.ok(((await getConversation(cid)).entry_snapshot as Row).followupGeneration, 'Retain only a renewed synthetic destination');
  await read(async tx => {
    const s = (await one(tx, sql`select retention_days from app.assistant_enterprise_settings where enterprise_id=${eid}`))!;
    await tx.execute(sql`update app.assistant_conversations set updated_at=now()-(${Number(s.retention_days) + 1}::integer * interval '1 day') where enterprise_id=${eid} and id=${cid}`);
    await tx.execute(sql`update app.admin_users set menu_permissions=array_append(coalesce(menu_permissions,array[]::text[]),'assistant-retention') where id=5410 and enterprise_id=${eid}`);
  });
  const afterConversationId = (BigInt(cid) - 1n).toString();
  const dry = await runAssistantRetention({ enterpriseId: eid, adminId: '5410', afterConversationId });
  assert.deepEqual(dry.candidates.map(c => c.conversationId), [cid]); assert.ok(dry.candidates[0].eligible);
  const applied = await runAssistantRetention({ enterpriseId: eid, adminId: '5410', afterConversationId, mode: 'apply' });
  assert.equal(applied.applied.conversations, 1); report.retention = { dry, applied }; save(); return cid;
}
async function configure(enabled: boolean) {
  const s = await policy.settings(); return policy.configure({ expectedVersion: Number(s.version), enabled, dailyTime: '20:00', weeklyTime: '08:00', projectIds: [pid], stageKeys: [] }, randomUUID());
}
async function member(active: boolean) {
  const p = (await owner.execute('detail', { projectId: pid })).project as Row;
  return owner.execute('member', { projectId: pid, expectedVersion: p.version, adminId: '5419', role: memberBefore!.role, active, workLabel: memberBefore!.work_label }, randomUUID());
}
async function main() {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(process.argv.includes('--development') && ['localhost','127.0.0.1'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
  release = await lockAssistantAcceptance(JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL);
  assert.equal((await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`)))!.n, 0);
  report.accountingBefore = await accounting();
  if (retentionOnly) {
    const file = path.resolve(retentionOnly), previous = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(previous.checks[1].passed); assert.match(previous.checks[1].name, /deleted-generation remainder/);
    const old = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'binding.json'), 'utf8'));
    assert.deepEqual(Object.keys(old.before).filter(f => before[f] !== old.before[f]), ['admin/scripts/xiaok-v1-02-followup-settings-check.ts']);
    report.reusedEvidence = { file, checks: previous.checks.slice(0, 2), earlier: previous.reusedEvidence,
      sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), changed: ['admin/scripts/xiaok-v1-02-followup-settings-check.ts'] };
  }
  if (afterDelete) {
    const previousPath = path.resolve(afterDelete), previous = JSON.parse(fs.readFileSync(previousPath, 'utf8'));
    assert.ok(previous.checks.slice(0, 3).every((c: Row) => c.passed));
    assert.match(previous.error, /assistant_resource_not_found/);
    const old = JSON.parse(fs.readFileSync(path.join(path.dirname(previousPath), 'binding.json'), 'utf8'));
    assert.deepEqual(Object.keys(old.before).filter(f => before[f] !== old.before[f]), ['admin/scripts/xiaok-v1-02-followup-settings-check.ts']);
    previousDelete = previous; report.reusedEvidence = { file: previousPath, sha256: createHash('sha256').update(fs.readFileSync(previousPath)).digest('hex'),
      checks: previous.checks.slice(0, 3), earlier: previous.reusedEvidence, changed: ['admin/scripts/xiaok-v1-02-followup-settings-check.ts'] };
  }
  if (continueFrom) {
    const previousPath = path.resolve(continueFrom), previous = JSON.parse(fs.readFileSync(previousPath, 'utf8'));
    assert.ok(previous.checks.slice(0, 3).every((c: Row) => c.passed));
    assert.match(previous.error, /Retained synthetic current stage event/);
    const old = JSON.parse(fs.readFileSync(path.join(path.dirname(previousPath), 'binding.json'), 'utf8'));
    const changed = Object.keys(old.before).filter(f => before[f] !== old.before[f]);
    assert.deepEqual(changed, ['admin/scripts/xiaok-v1-02-followup-settings-check.ts']);
    report.reusedEvidence = { file: previousPath, sha256: createHash('sha256').update(fs.readFileSync(previousPath)).digest('hex'),
      checks: previous.checks.slice(1, 3), changed };
  }
  if (cleanupOnly) {
    const saved = JSON.parse(fs.readFileSync(path.resolve(cleanupOnly), 'utf8'));
    for (const a of saved.accounts) { assert.match(String(a.username), /^synthetic-v1-02-/); assert.equal(a.status, 'disabled'); accounts.push(a); }
    users.push(...saved.users); report.cleanupOnly = { source: path.resolve(cleanupOnly), accountIds: accounts.map(a => String(a.id)) }; return;
  }
  if (migrateOnly) {
    const url = new URL(process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL!);
    assert.ok(['localhost','127.0.0.1'].includes(url.hostname) && url.port === '5432' && url.pathname === '/smart_floor_planner');
    const x = spawnSync(process.execPath, ['scripts/postgres-migrate.mjs'], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true });
    fs.writeFileSync(path.join(output, 'migration.log'), x.stdout + x.stderr); assert.equal(x.status, 0, x.stderr);
    report.migration = await read(tx => rows(tx, sql`select column_name from information_schema.columns where table_schema='app'
      and table_name='construction_followup_bindings' and column_name in ('remind_stage','remind_daily','remind_weekly','list_hidden')`));
    assert.equal((report.migration as Row[]).length, 4); return;
  }
  await step(fixedChecks[0], async () => {
    await withPlatformTransaction(async tx => {
      for (const [id, name] of [['5410','boss'],['5411','worker'],['5413','admin'],['5414','super'],['5419','designer']]) {
        const a = (await one(tx, sql`select * from app.admin_users where id=${id}`))!;
        assert.match(String(a.username), /^synthetic-v1-02-/); assert.equal(a.status, 'disabled'); accounts.push(a);
        const u = (await one(tx, sql`select id::text,phone,context_version from app.users where id=${String(a.user_id)}`))!; users.push(u);
        fs.writeFileSync(path.join(output, 'fixtures-before.private.json'), JSON.stringify({ accounts, users }, null, 2));
        await tx.execute(sql`update app.admin_users set status='active' where id=${id}`);
        if (!u.phone) await tx.execute(sql`update app.users set phone=${'199' + String(u.id).padStart(8, '0')} where id=${String(u.id)}`);
        actors.push({ name, id, uid: String(a.user_id), role: String(a.role), token: '' });
      }
      const u = (await one(tx, sql`select id::text,context_version from app.users where id=3914`))!;
      actors.push({ name: 'customer', id: '3914', uid: '3914', role: 'user', token: '' }); assert.ok(u);
    });
    for (const a of actors) {
      const u = (await withPlatformTransaction(tx => one(tx, sql`select context_version from app.users where id=${a.uid}`)))!;
      a.token = await new SignJWT({ sub: a.uid, id: a.uid, mode: a.name === 'customer' ? 'customer' : 'staff', role: a.role,
        ...(a.name !== 'customer' ? { staffId: a.id } : {}), enterpriseId: eid, contextVersion: Number(u.context_version), source: 'password' })
        .setProtectedHeader({ alg: 'HS256' }).setSubject(a.uid).setIssuedAt().setAudience('miniprogram').setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    }
    projectBefore = (await owner.execute('detail', { projectId: pid })).project as Row;
    assert.match(String(projectBefore.name), /^合成测试/); assert.equal(projectBefore.status, 'archived');
    await owner.execute('update', { projectId: pid, expectedVersion: projectBefore.version, name: projectBefore.name, status: 'active', customerAccess: true }, randomUUID());
    const customer = actors.find(a => a.name === 'customer')!;
    const entryResponse = await fetch('http://127.0.0.1:3006/api/miniprogram/assistant/entry-context', { method: 'POST',
      headers: { Authorization: 'Bearer ' + customer.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId: String(projectBefore.lead_id) }), signal: AbortSignal.timeout(30000) });
    const entry = await entryResponse.json(); assert.equal(entryResponse.status, 200, entry.error); customer.entry = entry.data.entryToken;
    policyBefore = await policy.settings(); assert.equal(policyBefore.enabled, false);
    bindings.push(...await read(tx => rows(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id in (27,29,30,50,57,58)`)));
    const b = await getBinding(); assert.equal(b.admin_id, '5419'); assert.ok(['stopped','deleted'].includes(String(b.status))); originalCid = String(b.conversation_id);
    memberBefore = await read(tx => one(tx, sql`select role,active,work_label from app.construction_members where enterprise_id=${eid} and project_id=${pid} and admin_id=5419`));
    assert.equal(memberBefore!.active, true); staged = true;
    report.fixtures = { enterpriseId: eid, projectId: pid, bindingId: bid, originalCid, adminIds: accounts.map(a => String(a.id)) };
    await configure(true); await change('resume'); return report.fixtures;
  });
  if (nativeScript) {
    const native = (await import(pathToFileURL(path.resolve(nativeScript)).href)).default;
    report.native = await native({ root, output, actors, enterpriseId: eid, bindingId: bid, retention,
      conversationId: String((await getBinding()).conversation_id), leadId: String(projectBefore!.lead_id), visualOnly: process.argv.includes('--visual-only') }); return;
  }
  if (!continueFrom && !afterDelete && !retentionOnly) await step(fixedChecks[1], async () => {
    for (const a of actors) {
      const m = await http(a.name, '/manage'); assert.ok(m.items.length > 0);
      for (const b of m.items) assert.deepEqual(Object.keys(b).sort(), ['bindingId','hidden','preferences','retentionRedacted','status','title','version'].sort());
      assert.ok(!JSON.stringify(m).includes('records')); assert.ok(!JSON.stringify(m).includes('unread'));
    } return { roles: actors.map(a => a.name), contentHydration: false };
  });
  if (!continueFrom && !afterDelete && !retentionOnly) await step(fixedChecks[2], async () => {
    const b = await getBinding(), body = { expectedVersion: Number(b.version), preferences: all(false) }, key = randomUUID();
    const result = await http('designer', '/' + bid + '/preferences', body, key);
    assert.deepEqual(await http('designer', '/' + bid + '/preferences', body, key), result);
    await http('designer', '/' + bid + '/preferences', body, randomUUID(), 409);
    await http('designer', '/' + bid + '/preferences', { ...body, preferences: { daily: false, stage: true } }, randomUUID(), 422);
    const c = await getConversation(String(b.conversation_id));
    assert.equal(String(c.id), originalCid); await preferences(all(false), 'customer', '27');
    return { sameKeyStable: true, destinationUnchanged: true, customerPreferences: true };
  });
  if (continueFrom) await preferences(all(false));
  let mutedDaily = '';
  if (!afterDelete && !retentionOnly) await step(fixedChecks[3], async () => {
    // Reactivating the retained project advances its revision. Establish a real
    // current stage event through the original service instead of fabricating one.
    const current = (await owner.execute('detail', { projectId: pid })).project as Row;
    const stages = await read(tx => readStageSettings(tx, eid));
    const alternate = stages.stages.find(s => s.key !== current.current_stage_key)!; assert.ok(alternate);
    for (const stageKey of [alternate.key, String(current.current_stage_key)]) {
      const p = (await owner.execute('detail', { projectId: pid })).project as Row;
      await owner.execute('progress', { projectId: pid, expectedVersion: p.version, stageKey, note: current.progress_note || '', sendReminder: false }, randomUUID());
    }
    const before = await read(tx => one(tx, sql`select count(*)::int n from app.assistant_messages where enterprise_id=${eid} and conversation_id=${originalCid}`));
    const saved = []; for (const kind of ['stage','daily','weekly'] as const) saved.push(await enqueue(kind));
    mutedDaily = saved[1].reportId; await drain(); assert.equal(await deliverConstructionReports(eid), 0);
    for (const r of saved) { const detail = await http('designer', '/' + bid + '/reports/' + r.reportId); assert.equal(detail.state, 'facts_ready'); assert.equal(detail.deliveryState, 'muted'); }
    const d = await http('designer', '/' + bid + '/reports/' + mutedDaily);
    await http('designer', '/' + bid + '/reports/' + mutedDaily + '/acknowledge', { revision: 1, readToken: d.readToken });
    assert.ok((await http('designer', '/' + bid + '/reports/' + mutedDaily)).readAt);
    const after = await read(tx => one(tx, sql`select count(*)::int n from app.assistant_messages where enterprise_id=${eid} and conversation_id=${originalCid}`)); assert.deepEqual(after, before);
    return { reports: saved, mutedHistoryReadable: true, noInsertedMessage: true };
  });
  if (!afterDelete && !retentionOnly) await step(fixedChecks[4], async () => {
    const c = await getConversation(originalCid); await change('archive'); assert.equal((await getBinding()).list_hidden, true);
    assert.deepEqual(await getConversation(originalCid), c, 'Hide must not mutate/cancel the conversation');
    await preferences(all(true)); assert.equal(await deliverConstructionReports(eid), 0); assert.equal((await getBinding()).list_hidden, true);
    const r = await enqueue('daily', '2026-11-26'); await drain(); assert.equal(await deliverConstructionReports(eid), 1); assert.equal(await deliverConstructionReports(eid), 0);
    assert.equal((await getBinding()).list_hidden, false); assert.equal((await http('designer', '/' + bid + '/reports/' + mutedDaily)).deliveryState, 'muted');
    return { futureReport: r, oldMutedNotReplayed: true, realDeliveryUnhides: true };
  });
  if (!afterDelete && !retentionOnly) await step(fixedChecks[5], async () => {
    await change('stop'); await change('resume'); assert.equal(String((await getBinding()).conversation_id), originalCid);
    const queued = await enqueue('daily', '2026-11-27'); await change('delete');
    assert.ok(!(await http('designer')).items.some((b: Row) => b.bindingId === bid));
    assert.equal((await http('designer', '/manage')).items.find((b: Row) => b.bindingId === bid).status, 'deleted');
    const b = await getBinding(); await read(async tx => { const found = await ensureFollowupBinding(tx, eid, { kind: 'admin', id: '5419', audience: 'designer' }); assert.equal(found.status, 'deleted'); });
    const body = { expectedVersion: Number(b.version) }, key = randomUUID();
    const [a, replay] = await Promise.all([http('designer', '/' + bid + '/resume', body, key), http('designer', '/' + bid + '/resume', body, key)]);
    assert.deepEqual(a, replay); assert.notEqual(a.conversationId, originalCid); await drain();
    const failed = await read(tx => one(tx, sql`select status,error_code from app.assistant_runs where enterprise_id=${eid} and id=${queued.runId}`)); assert.equal(failed!.status, 'failed'); assert.equal(failed!.error_code, 'assistant_resource_not_found');
    await http('designer', '/' + bid + '/reports/' + mutedDaily, undefined, undefined, 404);
    assert.deepEqual((await http('designer', '/' + bid + '/reports')).items, []);
    const list = (await http('designer')).items.find((b: Row) => b.bindingId === bid); assert.equal(list.unreadMessages, 0); assert.equal(list.unreadReports, 0);
    return { previous: originalCid, current: a.conversationId, sameKeyConcurrent: true, staleRun: failed };
  });
  if (afterDelete) await step('deleted-generation remainder; reuse original concurrent resume and saved facts', async () => {
    const oldCid = String((previousDelete!.fixtures as Row).originalCid), b = await getBinding(); assert.notEqual(String(b.conversation_id), oldCid);
    const oldRuns = previousDelete!.runs as string[], staleRun = oldRuns.at(-1)!;
    const failed = await read(tx => one(tx, sql`select status,error_code from app.assistant_runs where enterprise_id=${eid} and id=${staleRun}`));
    assert.deepEqual(failed, { status: 'failed', error_code: 'assistant_resource_not_found' });
    const saved = (previousDelete!.checks as Row[])[1].data as Row, reports = saved.reports as Row[];
    for (const r of reports) await http('designer', '/' + bid + '/reports/' + r.reportId, undefined, undefined, 404);
    assert.deepEqual((await http('designer', '/' + bid + '/reports')).items, []);
    const list = (await http('designer')).items.find((b: Row) => b.bindingId === bid);
    assert.equal(list.unreadMessages, 0); assert.equal(list.unreadReports, 0); assert.equal(list.latestReport, null);
    return { oldCid, currentCid: String(b.conversation_id), failed, oldReportsHidden: reports.map(r => r.reportId), noOldUnread: true };
  });
  await step(fixedChecks[6], async () => {
    const b = await getBinding(); await read(tx => tx.execute(sql`update app.assistant_conversations set mode='human' where enterprise_id=${eid} and id=${String(b.conversation_id)}`));
    await change('delete'); const retainedCid = await retention();
    const m = (await http('designer', '/manage')).items.find((b: Row) => b.bindingId === bid); assert.equal(m.retentionRedacted, true);
    await http('designer', '/' + bid, undefined, undefined, 404); const resumed = await change('resume'); assert.notEqual(resumed.conversationId, retainedCid);
    assert.equal((await getConversation(resumed.conversationId)).mode, 'human'); assert.equal((await getConversation(retainedCid)).entry_snapshot && ((await getConversation(retainedCid)).entry_snapshot as Row).retentionRedacted, true);
    return { retainedCid, current: resumed.conversationId, mode: 'human', oldContextCopied: false };
  });
  await step(fixedChecks[7], async () => {
    await http('boss', '/' + bid + '/preferences', { expectedVersion: Number((await getBinding()).version), preferences: all(true) }, randomUUID(), 404);
    await http('designer', '/manage?enterpriseId=2759', undefined, undefined, 422);
    const foreign = await withTenantTransaction('2759', tx => one(tx, sql`select count(*)::int n from app.construction_followup_bindings where enterprise_id=${eid} and id=${bid}`));
    assert.equal(foreign!.n, 0, 'Original forced RLS rejects a foreign binding');
    const wrongContext = await read(tx => one(tx, sql`select app.assistant_followup_binding_access('user',3914,2759,27) allowed`));
    assert.equal(wrongContext!.allowed, false, 'The factored rule rejects a foreign current context');
    await member(false); assert.deepEqual((await http('designer', '/manage')).items, []);
    await http('designer', '/' + bid + '/resume', { expectedVersion: Number((await getBinding()).version) }, randomUUID(), 404); await member(true);
    const p = (await owner.execute('detail', { projectId: pid })).project as Row;
    await owner.execute('update', { projectId: pid, expectedVersion: p.version, name: p.name, status: 'active', customerAccess: false }, randomUUID());
    assert.deepEqual((await http('customer', '/manage')).items, []);
    await http('customer', '/27/preferences', { expectedVersion: Number((await getBinding('27')).version), preferences: all(true) }, randomUUID(), 404);
    return { otherPrincipalDenied: true, revokedMemberDenied: true, removedCustomerDenied: true, bodyTenantDenied: true };
  });
}

main().catch(e => { report.error = (e as Error).stack; process.exitCode = 1; }).finally(async () => {
  try {
    if (!release) return;
    if (staged) {
      await read(async tx => {
        for (const runId of runs) {
          await tx.execute(sql`update app.assistant_jobs set status='cancelled',lease_token=null,lease_expires_at=null,last_error='synthetic_fixture_closed' where enterprise_id=${eid} and run_id=${runId} and status in ('queued','running')`);
          await tx.execute(sql`update app.assistant_runs set status='cancelled',error_code='synthetic_fixture_closed',completed_at=now() where enterprise_id=${eid} and id=${runId} and status in ('queued','running')`);
        }
        for (const b of bindings) await tx.execute(sql`update app.construction_followup_bindings set status=case when status='deleted' then status else ${String(b.status)} end,remind_stage=${b.remind_stage as boolean},
          remind_daily=${b.remind_daily as boolean},remind_weekly=${b.remind_weekly as boolean},list_hidden=case when status='deleted' then true else ${b.list_hidden as boolean} end,
          version=version+1 where enterprise_id=${eid} and id=${String(b.id)}`);
        await tx.execute(sql`update app.assistant_conversations set mode='ai' where enterprise_id=${eid} and id=${String((await getBinding()).conversation_id)}`);
      });
      const m = await read(tx => one(tx, sql`select active from app.construction_members where enterprise_id=${eid} and project_id=${pid} and admin_id=5419`));
      if (m?.active !== memberBefore?.active) await member(Boolean(memberBefore!.active));
      const s = await policy.settings();
      await policy.configure({ expectedVersion: Number(s.version), enabled: false, dailyTime: policyBefore!.daily_time, weeklyTime: policyBefore!.weekly_time,
        projectIds: policyBefore!.project_ids, stageKeys: policyBefore!.stage_keys }, randomUUID());
    }
    if (projectBefore) { const p = (await owner.execute('detail', { projectId: pid })).project as Row;
      await owner.execute('update', { projectId: pid, expectedVersion: p.version, name: projectBefore.name, status: projectBefore.status, customerAccess: projectBefore.customer_access }, randomUUID()); }
    await withPlatformTransaction(async tx => {
      for (const a of accounts) await tx.execute(sql`update app.admin_users set status=${String(a.status)},
        menu_permissions=${a.menu_permissions === null ? sql`null` : sql`array(select jsonb_array_elements_text(${JSON.stringify(a.menu_permissions)}::jsonb))`},
        must_change_password=${a.must_change_password as boolean} where id=${String(a.id)}`);
      for (const u of users) await tx.execute(sql`update app.users set phone=${u.phone as string | null} where id=${String(u.id)}`);
    });
    report.accountingAfter = await accounting(); assert.deepEqual(report.accountingAfter, report.accountingBefore);
    report.cleanup = await withPlatformTransaction(async tx => ({ queue: await one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`),
      policy: await one(tx, sql`select enabled,version from app.construction_report_settings where enterprise_id=${eid}`), accounts: await rows(tx, sql`select id::text,status from app.admin_users where id in (5410,5411,5413,5414,5419)`) }));
    assert.equal(((report.cleanup as Row).queue as Row).n, 0); assert.equal(((report.cleanup as Row).policy as Row).enabled, false);
    if (!report.error && !migrateOnly && !cleanupOnly) await step(fixedChecks[8], async () => ({ providerDelta: 0, knowledgeDelta: 0, restored: true }));
  } catch (e) { report.cleanupError = (e as Error).stack; process.exitCode = 1; }
  finally {
    const after = binding(), drift = Object.keys(before).filter(f => before[f] !== after[f]);
    fs.writeFileSync(path.join(output, 'binding.json'), JSON.stringify({ before, after, drift }, null, 2)); if (drift.length) { report.drift = drift; process.exitCode = 1; }
    if (release) await release(); await closePostgresPool(); report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ output, passed: !report.error && !report.cleanupError && !drift.length, checks: (report.checks as Row[]).length, error: report.error, cleanupError: report.cleanupError, drift }));
  }
});
