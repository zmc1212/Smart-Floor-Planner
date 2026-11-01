/** Bounded, zero-provider real HTTP/client fixture. Retains every labelled batch. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadEnvConfig } from '@next/env';
import { SignJWT } from 'jose';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { AdminUserRepository, MiniProgramIdentityRepository } from '@/db/repositories';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { appendMessage } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { ConstructionService } from '@/lib/construction/service';
import { ConstructionReportService } from '@/lib/construction/report-service';
import { SiteChatService, recordVersion } from '@/lib/construction/site-chat';
import { enqueueReport, ensureFollowupBinding } from '@/lib/construction/report-store';
import { deliverConstructionReports, processConstructionReport } from '@/lib/construction/report-worker';
import { latestReportPeriod } from '@/lib/construction/report-calendar';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

loadEnvConfig(process.cwd(), true);
const root = path.resolve('..'), eid = '1454', aid = '5410', uid = '3914', pid = '248', otherPid = '249';
const out = path.resolve(process.argv.find(v => v.startsWith('--output='))?.slice(9) || '../tmp/v1-02-followup-client/http-01');
assert.ok(!fs.existsSync(path.join(out, 'report.json')), 'Retain original output');
fs.mkdirSync(out, { recursive: true });
const prefix = 'synthetic-v1-02-followup-client-' + randomUUID();
const reuse = process.argv.find(v => v.startsWith('--reuse-fixture='))?.slice(16);
const continueFrom = process.argv.find(v => v.startsWith('--continue-from='))?.slice(16);
const continueNative = process.argv.find(v => v.startsWith('--continue-native='))?.slice(18);
const continuedPath = continueFrom || continueNative;
const continued = continuedPath ? JSON.parse(fs.readFileSync(path.resolve(continuedPath), 'utf8')) : null;
const nativeScript = process.argv.find(v => v.startsWith('--native-script='))?.slice(16);
const day = process.argv.find(v => v.startsWith('--day='))?.slice(6) || '2026-11-01';
assert.match(day, /^\d{4}-\d{2}-\d{2}$/);
const daily = latestReportPeriod('daily', new Date(day + 'T20:00:00+08:00'), '20:00');
const weekly = latestReportPeriod('weekly', new Date(daily.end.getTime() + 7 * 86400000), '08:00');
const report: Row = { prefix, startedAt: new Date().toISOString(), periods: { daily, weekly },
  fixedChecks: ['labelled fixtures and current clock', 'real Mini identities and role boundaries', 'published originals and photos',
    'queue save delivery and human hold', 'four recipient HTTP projections', 'message visibility versus report read',
    'same-key lost-receipt recovery', 'archive stop resume and ordinary-chat isolation', 'member revocation and rejoin',
    'source withdrawal and photo denial', 'HTTP validation and current identity versions', 'accounting and cleanup'], checks: [] };
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const files = execFileSync('rg', ['--files', 'admin/src/lib/assistant', 'admin/src/lib/construction', 'admin/src/lib/ai', 'admin/src/db', 'admin/drizzle', 'miniprogram'], { cwd: root, encoding: 'utf8' })
  .trim().split(/\r?\n/).map(f => f.replaceAll('\\', '/'));
files.push('admin/scripts/xiaok-v1-02-followup-client-check.ts', 'admin/scripts/assistant-acceptance-safety.mjs',
  'admin/src/lib/miniprogram-jwt.ts', 'admin/src/lib/miniprogram-auth.ts', 'admin/package.json', 'admin/package-lock.json',
  'admin/tsconfig.json', 'admin/.env.local');
if (nativeScript) files.push(path.relative(root, path.resolve(nativeScript)).replaceAll('\\', '/'));
const binding = () => Object.fromEntries([...new Set(files)].sort().map(f => [f, createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')]));
const before = binding();
const boundCheck = () => { const after = binding(), drift = Object.keys(before).filter(f => before[f] !== after[f]);
  fs.writeFileSync(path.join(out, 'binding.json'), JSON.stringify({ before, after, drift }, null, 2)); assert.deepEqual(drift, []); };
const read = <T>(work: Parameters<typeof withTenantTransaction<T>>[1]) => withTenantTransaction(eid, work);
const owner = new ConstructionService({ enterpriseId: eid, adminId: aid }), site = new SiteChatService(owner.actor);
const config = new ConstructionReportService(owner.actor);
const tokens: Record<string, string> = {}, entries: Record<string, string> = {};
const ownedRuns: string[] = [], ownedRecords: Array<{ projectId: string; id: string }> = [], muted: Row[] = [], projectBefore: Row[] = [], accountBefore: Row[] = [];
const actors: Array<{ name: string; adminId?: string; userId: string; bindingId: string; conversationId: string }> = [];
const staffUsersBefore: Row[] = [];
const savedReports: Array<{ name: string; kind: string; bindingId: string; reportId: string; revision: number; runId: string }> = [];
let release: (() => Promise<void>) | undefined, settingsBefore: Row | undefined, setup = false, designerId = '', modeBefore = 'human';
const accounting = () => withPlatformTransaction(async tx => ({
  providerMax: String((await one(tx, sql`select coalesce(max(id),0) id from app.ai_provider_attempts`))!.id),
  knowledgeMax: String((await one(tx, sql`select coalesce(max(id),0) id from app.assistant_knowledge_attempts`))!.id),
  attempt3753: await one(tx, sql`select id::text,status,input_tokens from app.assistant_knowledge_attempts where id=3753`),
}));
async function step(name: string, fn: () => Promise<unknown>) {
  try { const result = await fn(); (report.checks as Row[]).push({ name, passed: true, result }); console.log(name + ': PASS'); return result; }
  catch (error) { (report.checks as Row[]).push({ name, passed: false, error: (error as Error).message }); throw error; }
  finally { save(); }
}
async function http(name: string, suffix: string, body?: Row, requestKey?: string, expected = 200, extra: Record<string, string> = {}) {
  const response = await fetch('http://127.0.0.1:3006/api/miniprogram/assistant' + suffix, {
    method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + tokens[name], ...(entries[name] ? { 'X-Assistant-Entry': entries[name] } : {}),
      ...(body ? { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey || randomUUID() } : {}), ...extra },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
  });
  if (response.headers.get('content-type')?.startsWith('image/')) {
    assert.equal(response.status, expected); return { bytes: Buffer.from(await response.arrayBuffer()), mime: response.headers.get('content-type') };
  }
  const result = await response.json() as Row;
  assert.equal(response.status, expected, `${name} ${suffix}: ${JSON.stringify(result)}`);
  return expected === 200 ? result.data as Row : result;
}
async function sign(name: string, userId: string, adminId?: string, contextVersion?: number) {
  const user = await withPlatformTransaction(tx => one(tx, sql`select context_version from app.users where id=${userId}`));
  const staff = adminId ? await withPlatformTransaction(tx => one(tx, sql`select role from app.admin_users where id=${adminId}`)) : null;
  // Match miniprogram-jwt's public claims, with the secret read after loadEnvConfig.
  // A transitive static import can otherwise cache its fallback before this driver loads env.
  tokens[name] = await new SignJWT({ sub: userId, id: userId, mode: adminId ? 'staff' : 'customer',
    role: staff ? staff.role as 'designer' : 'user', staffId: adminId, enterpriseId: eid,
    contextVersion: contextVersion ?? Number(user!.context_version), source: 'password' })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuedAt().setAudience('miniprogram').setExpirationTime('1h')
    .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
  if (!adminId) {
    const entry = await http(name, '/entry-context', { leadId: userId === uid ? String(report.leadId) : String(report.otherLeadId) });
    entries[name] = String(entry.entryToken);
  }
}
async function change(name: string, action: string, key = randomUUID()) {
  const a = actors.find(a => a.name === name)!;
  const c = await http(name, '/followups/' + a.bindingId);
  return http(name, `/followups/${a.bindingId}/${action}`, { expectedVersion: c.version }, key);
}
async function publication(projectId: string, label: string, audience: 'customer' | 'internal', photo = false) {
  const media = photo ? await site.upload(projectId, randomUUID(), await sharp({ create: { width: 160, height: 120, channels: 3, background: '#9bab91' } }).png().toBuffer()) : null;
  const room = ((await owner.execute('detail', { projectId })).rooms as Row[])[0];
  const r = await site.withWriteScope(projectId, async (tx, c) => {
    const message = await appendMessage(tx, site.actor, String(c.id), { author: 'admin', clientMessageId: randomUUID(), purpose: 'site.source',
      content: { version: 1, blocks: [{ type: 'text', text: prefix + ' 合成现场原话：' + label }] } });
    const row = (await one(tx, sql`insert into app.construction_site_records(enterprise_id,project_id,conversation_id,source_message_id,author_id,status,data)
      values(${eid},${projectId},${String(c.id)},${String(message.id)},${aid},'draft',${JSON.stringify({ title: '合成测试·' + label, roomId: String(room.id),
        completed: label, pending: '待现场人员核对，未记期限', coordination: '', note: '合成验收材料，不是实际施工结果。' })}::jsonb) returning *`))!;
    if (media) await tx.execute(sql`insert into app.construction_site_attachments(enterprise_id,project_id,record_id,media_id,position) values(${eid},${projectId},${String(row.id)},${media.id},0)`);
    await recordVersion(tx, eid, row, aid, 'organized'); return row;
  });
  ownedRecords.push({ projectId, id: String(r.id) }); report.records = ownedRecords; save();
  const edited = await site.mutate(projectId, String(r.id), 'edit', { expectedVersion: r.version, data: r.data }, randomUUID());
  await site.mutate(projectId, String(r.id), 'publish', { expectedVersion: edited.version, audience }, randomUUID());
  if (day !== '2026-11-01') await read(async tx => {
    const at = new Date(day + 'T12:00:00+08:00');
    await tx.execute(sql`update app.construction_site_records set published_at=${at} where enterprise_id=${eid} and id=${String(r.id)}`);
    await tx.execute(sql`update app.construction_site_record_versions set created_at=${at} where enterprise_id=${eid} and record_id=${String(r.id)} and action='publish'`);
    await tx.execute(sql`update app.domain_event_outbox set created_at=${at} where enterprise_id=${eid} and type='construction.record.publish.v1' and aggregate_id=${String(r.id)}`);
  });
  return { id: String(r.id), mediaId: media?.id };
}
async function drain() {
  for (let i = 0; i < 40; i++) {
    const active = await read(tx => rows(tx, sql`select id,status from app.assistant_runs where enterprise_id=${eid}
      and id=any(ARRAY(select jsonb_array_elements_text(${JSON.stringify(ownedRuns)}::jsonb))::bigint[]) and status in ('queued','running')`));
    if (!active.length) return;
    const lease = await claimJob();
    if (lease) { assert.ok(ownedRuns.includes(lease.runId) && lease.enterpriseId === eid, 'Idle guard: never process an unrelated run'); await processConstructionReport(lease); }
    else await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw Error('Bounded local report drain exhausted');
}
async function main() {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(process.argv.includes('--development') && ['localhost','127.0.0.1'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
  release = await lockAssistantAcceptance(JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL);
  assert.equal((await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`)))!.n, 0);
  report.accountingBefore = await accounting(); boundCheck();
  if (nativeScript) report.fixedChecks = ['same labelled development fixtures', 'new local daily/weekly facts for native-only scope',
    'Stable native source-bound interactions defined by native script', 'original accounting and cleanup'];
  if (continued) {
    const original = JSON.parse(fs.readFileSync(path.join(path.dirname(path.resolve(continuedPath!)), 'binding.json'), 'utf8'));
    assert.deepEqual(original.drift, []);
    const changed = Object.keys(original.after).filter(f => original.after[f] !== before[f]);
    assert.deepEqual(changed.sort(), ['admin/scripts/xiaok-v1-02-followup-client-check.ts', ...(continueNative ? [path.relative(root, path.resolve(nativeScript!)).replaceAll('\\', '/')] : [])].sort());
    const count = continueNative ? 4 : 7; assert.ok(continued.checks.slice(0, count).every((c: Row) => c.passed));
    report.reusedEvidence = { source: path.relative(root, path.resolve(continuedPath!)), checks: continued.checks.slice(0, count).map((c: Row) => c.name),
      changed, reason: continueNative ? 'Native-only driver correction: duplicate imported registry spellings are not project windows. Reuse saved facts; verify the one actual window.'
        : 'Driver-only correction: ordinary consultation POST requires entryToken in its body. Reuse saved reports and successful HTTP evidence.' };
  }
  await step('labelled fixtures and current clock', async () => {
    settingsBefore = (await read(tx => one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid}`)))!;
    assert.equal(settingsBefore.enabled, false);
    report.clock = await read(tx => one(tx, sql`select now()`));
    report.existingFutureAudits = await read(tx => rows(tx, sql`select id::text,created_at from app.construction_audits
      where enterprise_id=${eid} and project_id in (248,249) and action='member' and snapshot->>'adminId'='5412' and created_at>now()`));
    assert.ok((report.existingFutureAudits as Row[]).length, 'Do not rewrite previous synthetic audits');
    setup = true;
    await withPlatformTransaction(async tx => {
      for (const id of ['5410','5411','5412','5413','5414']) {
        const a = (await one(tx, sql`select * from app.admin_users where id=${id}`))!;
        assert.ok(String(a.username).startsWith('synthetic-v1-02-')); assert.equal(a.status, 'disabled'); accountBefore.push(a);
        await tx.execute(sql`update app.admin_users set status='active' where id=${id}`);
      }
      if (reuse) {
        const previous = JSON.parse(fs.readFileSync(path.resolve(reuse), 'utf8'));
        designerId = String(previous.fixture.designerId);
        const existing = (await one(tx, sql`select username,status from app.admin_users where enterprise_id=${eid} and id=${designerId}`))!;
        assert.ok(String(existing.username).startsWith('synthetic-v1-02-followup-client-')); assert.equal(existing.status, 'disabled');
        await tx.execute(sql`update app.admin_users set status='active' where enterprise_id=${eid} and id=${designerId}`);
        report.reusedFixture = path.relative(root, path.resolve(reuse));
      } else designerId = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,display_name,password_hash,role,status,must_change_password)
        values(${eid},${prefix + ':designer'},'合成测试·跟进设计师','unusable-local-fixture','designer','active',false) returning id`))!.id);
      report.createdDesignerId = designerId; save();
      for (const id of ['5410','5411','5413','5414',designerId]) {
        const a = (await new AdminUserRepository(tx).findById(BigInt(id)))!;
        const u = await new MiniProgramIdentityRepository(tx).ensureStaffUser(a);
        staffUsersBefore.push({ id: String(u.id), phone: u.phone });
        if (!u.phone) await tx.execute(sql`update app.users set phone=${'199' + String(u.id).padStart(8, '0')} where id=${String(u.id)}`);
        const name = id === aid ? 'boss' : id === '5411' ? 'worker' : id === designerId ? 'designer' : id === '5413' ? 'admin' : 'super_admin';
        actors.push({ name, adminId: id, userId: String(u.id), bindingId: '', conversationId: '' });
      }
    });
    for (const projectId of [pid, otherPid]) {
      const detail = await owner.execute('detail', { projectId }), p = detail.project as Row;
      assert.ok(String(p.name).startsWith('合成测试')); assert.equal(p.status, 'archived'); projectBefore.push(p);
      await owner.execute('update', { projectId, expectedVersion: p.version, name: projectId === pid ? '合成测试·跟进甲工地' : '合成测试·跟进乙工地', status: 'active', customerAccess: true }, randomUUID());
      const v = (await owner.execute('detail', { projectId })).project as Row;
      await owner.execute('member', { projectId, expectedVersion: v.version, adminId: designerId, role: 'designer', active: true, workLabel: '合成跟进HTTP验收' }, randomUUID());
      if (nativeScript && !continueNative) {
        const p2 = (await owner.execute('detail', { projectId })).project as Row;
        await owner.execute('progress', { projectId, expectedVersion: p2.version, stageKey: 'utilities', note: '合成测试·水电跟进', sendReminder: false }, randomUUID());
      }
    }
    const leads = await read(tx => rows(tx, sql`select id::text,customer_user_id::text from app.leads where enterprise_id=${eid} and customer_user_id in (3914,3915)`));
    report.leadId = leads.find(l => l.customer_user_id === uid)!.id; report.otherLeadId = leads.find(l => l.customer_user_id === '3915')!.id;
    // Suppress only freshly-created empty destinations of real owners, as prior fixtures do.
    await read(async tx => {
      for (const a of await rows(tx, sql`select id::text from app.admin_users where enterprise_id=${eid} and role='enterprise_admin' and status='active' and id<>${aid}`)) {
        assert.ok(!await one(tx, sql`select id from app.construction_followup_bindings where enterprise_id=${eid} and principal_key=${'admin:' + a.id} and audience='boss'`));
        const b = await ensureFollowupBinding(tx, eid, { kind: 'admin', id: String(a.id), audience: 'boss' }); muted.push(b);
        await tx.execute(sql`update app.construction_followup_bindings set status='stopped' where enterprise_id=${eid} and id=${String(b.id)}`);
      }
    });
    await config.configure({ expectedVersion: settingsBefore.version, enabled: true, dailyTime: '20:00', weeklyTime: '08:00', projectIds: [pid, otherPid], stageKeys: [] }, randomUUID(), daily.start);
    actors.unshift({ name: 'customer', userId: uid, bindingId: '27', conversationId: '880' });
    for (const a of actors) await sign(a.name, a.userId, a.adminId);
    for (const a of actors) {
      if (['admin','super_admin'].includes(a.name)) continue;
      const retained = await read(tx => one(tx, sql`select id::text,conversation_id::text,status,version from app.construction_followup_bindings
        where enterprise_id=${eid} and principal_key=${(a.adminId ? 'admin:' : 'user:') + (a.adminId || a.userId)}
        and scope_key=${a.adminId ? 'enterprise' : 'project:' + pid}`));
      if (retained) { a.bindingId = String(retained.id); a.conversationId = String(retained.conversation_id); }
      // The retained worker was explicitly deleted. Opening is never implicit
      // consent to restore it: this fixture explicitly exercises resume first.
      if (retained?.status === 'deleted') await http(a.name, `/followups/${retained.id}/resume`, { expectedVersion: retained.version });
      const b = await http(a.name, '/followups/open', a.adminId ? {} : { projectId: pid });
      a.bindingId = String(b.bindingId); a.conversationId = String(b.conversationId);
      if (b.status !== 'enabled') { const resumed = await http(a.name, `/followups/${b.bindingId}/resume`, { expectedVersion: b.version }); a.conversationId = String(resumed.conversationId); }
    }
    modeBefore = String((await read(tx => one(tx, sql`select mode from app.assistant_conversations where enterprise_id=${eid} and id=${actors[0].conversationId}`)))!.mode);
    report.fixture = { eid, pid, otherPid, designerId, actors, muted: muted.map(b => String(b.id)) }; return report.fixture;
  });
  if (!continued) await step('real Mini identities and role boundaries', async () => {
    for (const a of actors) {
      if (['admin','super_admin'].includes(a.name)) {
        // Retain http-05's original unexpected403. The current Mini identity
        // contract has no selected tenant for global accounts; do not fabricate
        // employment or silently turn that unfinished client path into a pass.
        await http(a.name, '/followups/open', {}, undefined, 403);
        assert.equal((await new ConstructionReportService({ enterpriseId: eid, adminId: a.adminId! }).settings()).enabled, true);
        continue;
      }
      const c = await http(a.name, '/followups/' + a.bindingId);
      assert.equal(c.conversationId, a.conversationId); assert.equal((c.enterprise as Row).id, eid);
      if (a.name === 'boss') {
        assert.ok((c.projects as Row[]).some(p => p.id === pid) && (c.projects as Row[]).some(p => p.id === otherPid));
      } else assert.equal((c.projects as Row[]).length, a.name === 'customer' ? 1 : 2);
      if (a.name === 'worker') await http('worker', '/conversations', undefined, undefined, 401);
    }
    await sign('otherCustomer', '3915');
    await http('otherCustomer', '/followups/27', undefined, undefined, 404);
    await http('worker', '/followups/27', undefined, undefined, 404);
    report.knownGaps = ['Global admin/super_admin Mini identity lacks a selected-enterprise context; HTTP403 retained from http-05. Existing selected-tenant domain management works.'];
    return actors.map(a => ({ name: a.name, bindingId: a.bindingId }));
  });
  const published = (continued ? continued.checks.find((c: Row) => c.name === 'published originals and photos').result : await step('published originals and photos', async () => ({
    customer: await publication(pid, '甲工地已记录管线定位待核对', 'customer', true),
    internal: await publication(pid, 'INTERNAL_ONLY 内部准备记录', 'internal'),
    other: await publication(otherPid, '乙工地独立施工记录', 'customer'),
  }))) as { customer: { id: string; mediaId: string }; internal: { id: string }; other: { id: string } };
  if (continued) {
    savedReports.push(...continued.reports); report.reports = savedReports; report.knownGaps = continued.knownGaps;
    await read(tx => tx.execute(sql`update app.assistant_conversations set mode='ai' where enterprise_id=${eid} and id=${actors[0].conversationId}`));
  }
  if (!continued) await step('queue save delivery and human hold', async () => {
    const targets = actors.filter(a => ['customer','worker','designer','boss'].includes(a.name));
    for (const a of targets) for (const period of [daily, weekly]) {
      const q = await read(async tx => enqueueReport(tx, eid,
        (await one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${a.bindingId} for update`))!,
        (await one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid} for update`))!, period));
      assert.ok(q, 'Fixed period must be new'); ownedRuns.push(q.runId); savedReports.push({ name: a.name, kind: period.kind, bindingId: a.bindingId, ...q }); report.reports = savedReports; save();
    }
    await drain(); await deliverConstructionReports(eid);
    const held = await read(tx => rows(tx, sql`select d.state,v.status from app.construction_report_deliveries d join app.construction_report_versions v
      on v.enterprise_id=d.enterprise_id and v.report_id=d.report_id and v.revision=d.revision where d.enterprise_id=${eid}
      and v.run_id=any(ARRAY(select jsonb_array_elements_text(${JSON.stringify(ownedRuns)}::jsonb))::bigint[]) and d.binding_id=27`));
    assert.equal(modeBefore, 'human'); assert.ok(held.every(d => d.state === 'held' && d.status === 'facts_ready'));
    await read(tx => tx.execute(sql`update app.assistant_conversations set mode='ai' where enterprise_id=${eid} and id=${actors[0].conversationId}`));
    await deliverConstructionReports(eid);
    return { ownedRuns, humanHeld: held };
  });
  if (nativeScript) {
    const native = (await import(pathToFileURL(path.resolve(nativeScript)).href)).default;
    report.native = await native({ root, output: out, actors, tokens, enterpriseId: eid, leadId: String(report.leadId), published, reports: savedReports,
      http, setCustomerMode: (mode: string) => read(tx => tx.execute(sql`update app.assistant_conversations set mode=${mode} where enterprise_id=${eid} and id=${actors[0].conversationId}`)),
      withdraw: async () => {
        const r = (await read(tx => one(tx, sql`select version from app.construction_site_records where enterprise_id=${eid} and id=${published.customer.id}`)))!;
        await site.mutate(pid, published.customer.id, 'withdraw', { expectedVersion: r.version, reason: '合成原生撤回检查' }, randomUUID());
      } });
    return;
  }
  if (!continued) await step('four recipient HTTP projections', async () => {
    for (const a of actors.filter(a => ['customer','worker','designer','boss'].includes(a.name))) {
      for (const r of savedReports.filter(r => r.name === a.name)) {
        const d = await http(a.name, `/followups/${a.bindingId}/reports/${r.reportId}?revision=${r.revision}`);
        assert.equal(d.contentStatus, 'facts_only'); assert.equal(d.deliveryState, 'delivered'); assert.ok(d.sequence);
        const projects = (d.facts as Row).projects as Row[]; assert.equal(projects.length, a.name === 'customer' ? 1 : 2);
        if (a.name === 'customer') assert.ok(!JSON.stringify(d).includes('INTERNAL_ONLY'));
        const original = await http(a.name, `/followups/${a.bindingId}/reports/${r.reportId}/projects/${pid}/records/${published.customer.id}?revision=${r.revision}`);
        assert.equal(original.id, published.customer.id);
      }
    }
    const r = savedReports.find(r => r.name === 'customer' && r.kind === 'daily')!;
    const url = `/followups/27/reports/${r.reportId}/projects/${pid}/records/${published.customer.id}/media/${published.customer.mediaId}?revision=1`;
    const media = await http('customer', url); assert.ok((media.bytes as Buffer).length > 0); assert.ok(String(media.mime).startsWith('image/'));
    await http('otherCustomer', url, undefined, undefined, 404);
    await http('customer', `/followups/27/reports/${r.reportId}/projects/${pid}/records/${published.internal.id}?revision=1`, undefined, undefined, 404);
    return { originals: true, photoHash: createHash('sha256').update(media.bytes as Buffer).digest('hex') };
  });
  const dailyReport = savedReports.find(r => r.name === 'customer' && r.kind === 'daily')!;
  if (!continued) await step('message visibility versus report read', async () => {
    const first = await http('customer', `/followups/27/reports/${dailyReport.reportId}`);
    assert.equal(first.readAt, null);
    const seenKey = randomUUID();
    await http('customer', '/followups/27/seen', { conversationId: actors[0].conversationId, throughSequence: first.sequence }, seenKey);
    assert.equal((await http('customer', `/followups/27/reports/${dailyReport.reportId}`)).readAt, null);
    await http('customer', `/followups/27/reports/${dailyReport.reportId}/acknowledge`, { revision: 1, readToken: first.readToken });
    assert.ok((await http('customer', `/followups/27/reports/${dailyReport.reportId}`)).readAt);
    return { seenKey, reportId: dailyReport.reportId };
  });
  if (!continued) await step('same-key lost-receipt recovery', async () => {
    const a = actors.find(a => a.name === 'worker')!, key = randomUUID();
    const c = await http('worker', '/followups/' + a.bindingId), body = { expectedVersion: c.version };
    // Discard the first response as a lost local receipt, then use its exact key/body.
    await http('worker', `/followups/${a.bindingId}/stop`, body, key);
    const recovered = await http('worker', `/followups/${a.bindingId}/stop`, body, key);
    assert.equal(recovered.version, Number(c.version) + 1); await change('worker', 'resume');
    return { key, recovered };
  });
  await step('archive stop resume and ordinary-chat isolation', async () => {
    const destination = actors[0].conversationId;
    await change('customer', 'archive'); assert.equal((await http('customer', '/followups/27')).status, 'enabled');
    const normal = await http('customer', '/conversations', { entryToken: entries.customer }); assert.notEqual(normal.id, destination);
    assert.equal((await http('customer', '/followups/27')).conversationId, destination);
    await change('customer', 'stop'); await change('customer', 'resume');
    assert.equal((await http('customer', '/followups/27')).conversationId, destination);
    return { destination, normalId: normal.id };
  });
  await step('member revocation and rejoin', async () => {
    const a = actors.find(a => a.name === 'designer')!, r = savedReports.find(r => r.name === 'designer' && r.kind === 'daily')!;
    for (const active of [false, true]) {
      const p = (await owner.execute('detail', { projectId: pid })).project as Row;
      await owner.execute('member', { projectId: pid, expectedVersion: p.version, adminId: designerId, role: 'designer', active, workLabel: '合成HTTP撤权检查' }, randomUUID());
      const d = await http('designer', `/followups/${a.bindingId}/reports/${r.reportId}`);
      assert.ok(!((d.facts as Row).projects as Row[]).some(p => p.id === pid));
      await http('designer', `/followups/${a.bindingId}/reports/${r.reportId}/projects/${pid}/records/${published.customer.id}?revision=1`, undefined, undefined, 404);
    }
    return { bindingId: a.bindingId, oldSectionRemainsHidden: true };
  });
  await step('source withdrawal and photo denial', async () => {
    const row = (await read(tx => one(tx, sql`select version from app.construction_site_records where enterprise_id=${eid} and id=${published.customer.id}`)))!;
    await site.mutate(pid, published.customer.id, 'withdraw', { expectedVersion: row.version, reason: '合成HTTP撤回验收' }, randomUUID());
    const d = await http('customer', `/followups/27/reports/${dailyReport.reportId}`); assert.equal(d.available, false); assert.equal(d.facts, null);
    const base = `/followups/27/reports/${dailyReport.reportId}/projects/${pid}/records/${published.customer.id}`;
    await http('customer', base + '?revision=1', undefined, undefined, 404);
    await http('customer', base + `/media/${published.customer.mediaId}?revision=1`, undefined, undefined, 404);
    return { available: d.available };
  });
  await step('HTTP validation and current identity versions', async () => {
    await http('customer', '/followups?enterpriseId=1454', undefined, undefined, 422);
    await http('customer', '/followups/open', { projectId: pid, principal: { kind: 'admin', adminId: aid } }, undefined, 422);
    const a = actors.find(a => a.name === 'worker')!;
    await sign('staleWorker', a.userId, a.adminId, 0);
    await http('staleWorker', '/followups', undefined, undefined, 401);
    await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set must_change_password=true where id=5411`));
    try { await http('worker', '/followups', undefined, undefined, 403); }
    finally { await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set must_change_password=false where id=5411`)); }
    return { bodyIdentityIgnored: true, staleVersionDenied: true, passwordGate: true };
  });
}
async function run() {
  try { await main(); }
  catch (error) { report.error = (error as Error).stack; console.error((error as Error).message); process.exitCode = 1; }
  finally {
    try {
      if (setup) {
        if (settingsBefore) await config.configure({ expectedVersion: (await config.settings()).version, enabled: false,
          dailyTime: settingsBefore.daily_time, weeklyTime: settingsBefore.weekly_time, projectIds: settingsBefore.project_ids, stageKeys: settingsBefore.stage_keys }, randomUUID());
        await read(async tx => {
          if (actors[0]?.name === 'customer') await tx.execute(sql`update app.assistant_conversations set mode=${modeBefore} where enterprise_id=${eid} and id=${actors[0].conversationId}`);
          for (const a of actors.filter(a => a.bindingId)) {
            await tx.execute(sql`update app.construction_followup_bindings set status='stopped',version=version+1 where enterprise_id=${eid} and id=${a.bindingId} and status<>'deleted'`);
          }
          if (designerId) await tx.execute(sql`update app.construction_followup_bindings set status='stopped',version=version+1
            where enterprise_id=${eid} and admin_id=${designerId} and status<>'deleted'`);
          for (const runId of ownedRuns) {
            await tx.execute(sql`update app.assistant_jobs set status='cancelled',lease_token=null,lease_expires_at=null,last_error='synthetic_fixture_closed' where enterprise_id=${eid} and run_id=${runId} and status in ('queued','running')`);
            await tx.execute(sql`update app.assistant_runs set status='cancelled',error_code='synthetic_fixture_closed',completed_at=now() where enterprise_id=${eid} and id=${runId} and status in ('queued','running')`);
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
        await withPlatformTransaction(async tx => {
          for (const a of accountBefore) await tx.execute(sql`update app.admin_users set status=${String(a.status)},must_change_password=${a.must_change_password as boolean} where id=${String(a.id)}`);
          if (designerId) await tx.execute(sql`update app.admin_users set status='disabled' where id=${designerId}`);
          for (const u of staffUsersBefore) await tx.execute(sql`update app.users set phone=${u.phone || null} where id=${String(u.id)}`);
          for (const a of actors.filter(a => a.adminId)) await new MiniProgramIdentityRepository(tx).bumpContextVersion(BigInt(a.userId));
        });
        report.accountingAfter = await accounting(); assert.deepEqual(report.accountingAfter, report.accountingBefore);
        report.cleanup = await withPlatformTransaction(async tx => ({ queue: await one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`),
          policy: await one(tx, sql`select enabled,version from app.construction_report_settings where enterprise_id=${eid}`),
          projects: await rows(tx, sql`select id::text,status,customer_access from app.construction_projects where enterprise_id=${eid} and id in (248,249)`),
          accounts: await rows(tx, sql`select id::text,status from app.admin_users where id in (5410,5411,5412,5413,5414,${designerId || aid})`) }));
        assert.equal(((report.cleanup as Row).queue as Row).n, 0); assert.equal(((report.cleanup as Row).policy as Row).enabled, false);
      }
      boundCheck();
    } catch (error) { report.cleanupError = (error as Error).stack; console.error('cleanup: ' + (error as Error).message); process.exitCode = 1; }
    finally { if (release) await release(); await closePostgresPool(); report.finishedAt = new Date().toISOString(); save(); }
  }
}
void run();
