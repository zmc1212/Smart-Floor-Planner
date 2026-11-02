/** Bounded original-report facts follow-up. Never generates/retries report bodies. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { AdminUserRepository } from '@/db/repositories/admin-user-repository';
import { MiniProgramIdentityRepository } from '@/db/repositories/miniprogram-identity-repository';
import { UserRepository } from '@/db/repositories/user-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { type ActorContext } from '@/lib/assistant/contracts';
import { ConversationService, cancelRuns } from '@/lib/assistant/core/conversation';
import { assistantDailyLimitsEnabled } from '@/lib/assistant/core/daily-limits';
import { ConstructionService } from '@/lib/construction/service';
import { FollowupService } from '@/lib/construction/followup-service';
import { ReportContextService } from '@/lib/construction/report-context';
import { queryReportFollowups } from '@/lib/assistant/agent/report-context';
import { SignJWT } from 'jose';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

loadEnvConfig(process.cwd(), true);
const root = path.resolve('..'), eid = '1454';
assert.ok(process.argv.includes('--development'));
const configured = process.argv.includes('--configured-model');
const serialReview = process.argv.includes('--serial-first-draft-review');
assert.ok(configured || process.argv.includes('--preflight-only'));
const target = new URL(resolvePostgresRuntimeConfig().connectionString);
assert.ok(['localhost', '127.0.0.1'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
assert.equal(assistantDailyLimitsEnabled(), false);
const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/v1-02-live-followups/preflight-01');
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Keep every original batch');
fs.mkdirSync(output, { recursive: true });
const nativeScript = process.argv.find(a => a.startsWith('--native-script='))?.slice(16);
if (configured) assert.ok(nativeScript, 'Bind the planned native input/reentry scope before dispatch');
const log: Row = { startedAt: new Date().toISOString(), owner: '01a19ca6-854b-7893-a1d1-1381a1c64810',
  scope: 'Selected retained owner61/staff63 original facts only, independent of stopped report-body acceptance',
  mechanism: 'report-originals-sourced-answer-v1; read-scope repairs2 and all old failures retained',
  serialFirstDraftReview: serialReview,
  fixedScope: { roles: ['customer', 'worker'], firstDraftsPerRole: 2, maxServiceRuns: 4, maxNativeRuns: 2,
    stop: 'First failed/unknown expectation, source/configuration drift or unavailable original; no sampling retries',
    serviceTrials: [
      { role: 'customer', text: '我看了这份日报，照明回路现在定下来了吗？我接下来该确认什么？' },
      { role: 'customer', text: '刚才说错了，我问的是客厅，不是卧室。要是周五要装灯，现在还缺哪一步？' },
      { role: 'worker', text: '这份日报里，插座这边现在能安排施工了吗？' },
      { role: 'worker', text: '我说的是A户，客户刚口头说可以往左挪一点。这样算确认了吗，下一步怎么接？' },
    ], nativeTrials: [
      { role: 'customer', text: '我回来再看这份日报，照明回路这件事还需要我确认什么？' },
      { role: 'worker', text: '我重新打开了这份日报，A户的插座位置接下来还要核对什么？' },
    ], expected: 'Frozen original/report cutoff, unresolved confirmation remains unresolved; user corrections are not published decisions; no invented deadline, construction completion, other-project/private leakage or report-body request' },
  checks: [], attempts: [], ownedRuns: [], modelCalls: configured ? null : 0, ingestionCalls: 0, reportBodyCalls: 0 };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(log, null, 2));
const read = <T>(fn: Parameters<typeof withTenantTransaction<T>>[1]) => withTenantTransaction(eid, fn);
const sourceFiles = execFileSync('rg', ['--files', 'admin/src/lib/assistant', 'admin/src/lib/construction', 'admin/src/lib/ai', 'admin/src/db', 'admin/drizzle', 'miniprogram'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/);
sourceFiles.push('admin/scripts/xiaok-v1-02-live-followups-check.ts', 'admin/scripts/assistant-acceptance-safety.mjs', 'admin/scripts/wechatide-native-client.ts',
  'admin/src/lib/platform-llm-config.ts', 'admin/.env.local', 'admin/package.json', 'admin/package-lock.json', 'admin/tsconfig.json',
  'tmp/xiaok-vector/connection.private.json', 'tmp/wechat-devtools-version-test/window.ps1', 'tmp/v1-02-conversation-list-visual/inspect-window.ps1',
  'design-references/xiaok-chat-redesign-20261029-v1/tab-context-v1/README.md',
  'design-references/xiaok-chat-redesign-20261029-v1/tab-context-v1/follow-up-v1/04-report-follow-up-v001.png',
  'design-references/xiaok-chat-redesign-20261029-v1/tab-context-v1/follow-up-v1/06-worker-follow-up-v001.png');
if (nativeScript) sourceFiles.push(path.resolve(nativeScript), 'D:/微信开发工具/微信web开发者工具/resources/app.asar', 'D:/微信开发工具/微信web开发者工具/微信开发者工具.exe');
const bind = () => Object.fromEntries([...new Set(sourceFiles)].sort().map(p => [p.replaceAll('\\', '/'), createHash('sha256').update(fs.readFileSync(path.isAbsolute(p) ? p : path.join(root, p))).digest('hex')]));
const before = bind();
const owner = new ConstructionService({ enterpriseId: eid, adminId: '5410' });
const actors: Row[] = [
  { name: 'customer', uid: '3912', bid: '22', cid: '855', rid: '61', pid: '247', revision: 1 },
  { name: 'worker', aid: '5406', role: 'construction_staff', bid: '24', cid: '857', rid: '63', pid: '246', revision: 1 },
];
const actor = (a: Row): ActorContext => ({ enterpriseId: eid, principal: a.name === 'customer' ? { kind: 'user', userId: String(a.uid) } : { kind: 'admin', adminId: String(a.aid) },
  contextVersion: Number(a.contextVersion || 0), capabilities: ['assistant.followup.self', ...(a.name === 'customer' ? ['assistant.chat.self'] : [])] });
let release: (() => Promise<void>) | undefined, accounts: Row[] = [], projects: Row[] = [], createdUser = '';
const selections: Row[] = [];
const ownedRuns: string[] = log.ownedRuns as string[];
const accounting = () => read(async tx => ({
  providerMax: String((await one(tx, sql`select coalesce(max(id),0) id from app.ai_provider_attempts`))!.id),
  knowledgeMax: String((await one(tx, sql`select coalesce(max(id),0) id from app.assistant_knowledge_attempts`))!.id),
  unknown3753: await one(tx, sql`select status,input_tokens::text,error_code from app.assistant_knowledge_attempts where id=3753 and enterprise_id=${eid}`),
  oldHolds: await rows(tx, sql`select id::text,run_id::text,status,version,reserved_tokens::text,settled_tokens::text,settled_cost_micros::text
    from app.assistant_quota_reservations where enterprise_id=${eid} and id<=1591 and status='reconciling' order by id`),
}));
const config = () => read(async tx => ({
  assistant: await one(tx, sql`select enabled,knowledge_epoch,active_index_profile_id::text,md5(agent_config::text) hash from app.assistant_enterprise_settings where enterprise_id=${eid}`),
  provider: await one(tx, sql`select md5(llm_config::text) hash from app.platform_configs where key='default'`),
  policy: await one(tx, sql`select enabled,version,dispatch_epoch from app.construction_report_settings where enterprise_id=${eid}`),
  published: await rows(tx, sql`select id::text,status,published_version_id::text from app.assistant_knowledge_documents where enterprise_id=${eid} and id in(404,405) order by id`),
  reports: await rows(tx, sql`select report_id::text,run_id::text,revision,facts_hash,body_run_id::text,body_attempts,knowledge_status from app.construction_report_versions where enterprise_id=${eid} and report_id in(61,63) order by report_id,revision`),
}));
async function idle() { assert.equal((await read(tx => one(tx, sql`select count(*)::int n from app.assistant_jobs where status in('queued','running')`)))!.n, 0); }
async function step(name: string, fn: () => Promise<unknown>) {
  try { const data = await fn(); (log.checks as Row[]).push({ name, passed: true, data }); return data; }
  catch (e) { (log.checks as Row[]).push({ name, passed: false, error: (e as Error).stack }); throw e; }
  finally { save(); console.log(name + ': ' + ((log.checks as Row[]).at(-1)!.passed ? 'PASS' : 'FAIL')); }
}
async function denied(fn: () => Promise<unknown>) {
  await assert.rejects(fn, e => ['assistant_resource_not_found', 'identity_context_invalid', 'assistant_capability_forbidden', 'context_changed'].includes(String((e as Row).code)));
}
async function inspectRun(a: Row, runId: string) {
  assert.ok(ownedRuns.includes(runId));
  const detail = await read(async tx => ({
    run: await one(tx, sql`select id::text,conversation_id::text,purpose,status,error_code,trigger_message_id::text from app.assistant_runs where enterprise_id=${eid} and id=${runId}`),
    steps: await rows(tx, sql`select step_seq,kind,capability_name,status,input_summary,source_refs,private_checkpoint from app.assistant_run_steps where enterprise_id=${eid} and run_id=${runId} order by step_seq`),
    usage: await rows(tx, sql`select category,quantity::text,cost_micros::text,currency,measurement_kind,input_tokens::text,output_tokens::text from app.assistant_usage_records where enterprise_id=${eid} and run_id=${runId} order by id`),
  }));
  const file = path.join(output, 'run-' + runId + '.json');
  fs.writeFileSync(file, JSON.stringify(detail, null, 2));
  if (['queued', 'running'].includes(String(detail.run?.status))) return null;
  const messages = await new ConversationService(actor(a)).messages(String(a.cid));
  const raw = await read(tx => one(tx, sql`select id::text,content from app.assistant_messages where enterprise_id=${eid} and run_id=${runId} and author_kind='assistant' order by id desc limit 1`));
  Object.assign(detail, { messages, raw }); fs.writeFileSync(file, JSON.stringify(detail, null, 2));
  assert.equal(detail.run?.status, 'succeeded', 'Original configured-model first draft: ' + JSON.stringify(detail.run));
  assert.equal(detail.steps.filter(s => s.kind === 'agent_validation' && s.status === 'failed').length, 0,
    'A repaired final is not a passing first draft; retain it and stop this fixed batch');
  const source = detail.steps.find(s => Number(s.step_seq) === 740)?.private_checkpoint as Row | undefined;
  assert.equal(((source?.snapshot as Row)?.reportReference as Row)?.selection && (((source!.snapshot as Row).reportReference as Row).selection as Row).reportId, a.rid);
  assert.ok(raw, 'No injected or guard-only answer');
  const message = messages.items.find(m => m.id === raw.id);
  assert.ok(message?.available, 'Saved model-derived answer must survive ordinary projection');
  const text = ((raw.content as Row).blocks as Row[]).map(b => b.text || '').join('\n');
  assert.doesNotMatch(text, /^报告所选项目：/, 'A raw snapshot display is not a natural answer to the question');
  assert.match(text, a.name === 'customer' ? /照明|回路|灯/ : /插座/);
  assert.match(text, /确认|核对|待|没有|未/);
  if (a.name === 'customer') assert.doesNotMatch(text, /内部交接|A户|插座位置仍待客户/);
  return { runId, messageId: raw.id, text, source: (source?.snapshot as Row)?.reportReference, usage: detail.usage };
}
async function waitRun(a: Row, runId: string) {
  const end = Date.now() + 300000;
  while (Date.now() < end) {
    const result = await inspectRun(a, runId);
    if (result) {
      if (serialReview) {
        // The serial Codex controller reviews the saved first draft before the
        // next send. This is evidence review, never a user approval/model call.
        const reviewFile = path.join(output, 'review-' + runId + '.json');
        log.pendingFirstDraftReview = { role: a.name, runId, messageId: result.messageId, text: result.text,
          expected: (log.fixedScope as Row).expected, reviewFile }; save();
        console.log('FIRST_DRAFT_REVIEW ' + runId);
        const reviewEnd = Date.now() + 300000;
        while (!fs.existsSync(reviewFile) && Date.now() < reviewEnd) await new Promise(resolve => setTimeout(resolve, 500));
        assert.ok(fs.existsSync(reviewFile), 'Saved first draft review did not arrive; stop without another send');
        const verdict = JSON.parse(fs.readFileSync(reviewFile, 'utf8'));
        assert.equal(String(verdict.runId), runId); assert.equal(verdict.reviewer, log.owner);
        (log.firstDraftReviews as Row[] || (log.firstDraftReviews = []) as Row[]).push(verdict);
        log.pendingFirstDraftReview = null; save();
        assert.equal(verdict.accepted, true, 'Original first draft business expectation failed: ' + verdict.reason);
      }
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw Error('Original run remains unresolved; preserve unknown outcome without a retry: ' + runId);
}
async function registerRun(a: Row, runId: string, text: string, transport: string, messageId?: string) {
  assert.ok(!ownedRuns.includes(runId), 'Only first admission is registered');
  assert.ok(ownedRuns.length < 6, 'Fixed bounded scope');
  ownedRuns.push(runId); (log.attempts as Row[]).push({ role: a.name, runId, text, transport, messageId }); save();
}
async function main() {
  release = await lockAssistantAcceptance(JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL);
  await idle(); log.accountingBefore = await accounting(); log.configBefore = await config();
  assert.equal(((log.configBefore as Row).policy as Row).enabled, false);
  await step('snapshot retained labelled controls and reopen only required historical context', async () => {
    accounts = await withPlatformTransaction(tx => rows(tx, sql`select id::text,username,status,user_id::text from app.admin_users where id in(5406,5410) order by id`));
    assert.equal(accounts.length, 2); for (const a of accounts) { assert.match(String(a.username), /^synthetic-v1-02-/); assert.equal(a.status, 'disabled'); }
    projects = await read(tx => rows(tx, sql`select id::text,name,status,customer_access,version from app.construction_projects where enterprise_id=${eid} and id in(246,247) order by id`));
    assert.equal(projects.length, 2); for (const p of projects) { assert.match(String(p.name), /^合成测试/); assert.equal(p.status, 'archived'); }
    log.controlBefore = { accounts, projects }; save();
    await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status='active' where id in(5406,5410)`));
    for (const p of projects) await owner.execute('update', { projectId: p.id, expectedVersion: p.version, name: p.name, status: 'active', customerAccess: true }, randomUUID());
    for (const a of actors) {
      if (a.name === 'customer') a.contextVersion = Number((await withPlatformTransaction(tx => one(tx, sql`select context_version from app.users where id=${String(a.uid)}`)))!.context_version);
      const context = new ReportContextService(actor(a), String(a.cid)), initial = await context.read();
      selections.push({ name: a.name, selection: initial.selected ? { bindingId: initial.selected.bindingId, reportId: initial.selected.reportId, revision: initial.selected.revision, projectId: initial.selected.projectId } : null });
      const selected = await context.select(randomUUID(), { expectedVersion: initial.version, selection: { bindingId: a.bid, reportId: a.rid, revision: a.revision, projectId: a.pid } });
      assert.equal(selected.selected?.reportId, a.rid);
      const detail = await new FollowupService(actor(a)).detail(String(a.bid), String(a.rid), 1);
      assert.ok(detail.available && detail.facts?.projects.some(p => p.id === a.pid));
      assert.equal(detail.contentStatus, 'facts_only');
      const persisted = await new ConversationService(actor(a)).detail(String(a.cid));
      assert.equal(persisted.reportContext.selected?.reportId, a.rid); a.selection = selected.selected;
    }
    return { reports: actors.map(a => ({ role: a.name, reportId: a.rid, projectId: a.pid })), frozenOriginals: true, bodyDispatch: 0, bindingsRemainStopped: true };
  });
  await step('original recipient, cross-tenant and staff private-conversation guards', async () => {
    const c = actors[0], s = actors[1];
    await denied(() => new ReportContextService(actor(c), String(s.cid)).read());
    await denied(() => new ReportContextService(actor(s), String(c.cid)).read());
    await denied(() => new ReportContextService({ ...actor(c), enterpriseId: '1455' }, String(c.cid)).read());
    return { rejected: 3, writesOrProviderCalls: 0 };
  });
  await step('rollback-only report query adapter revalidates originals, cached results and recipient scope', async () => {
    const checked: Row[] = [];
    for (const a of actors) {
      const runId = (((log.configBefore as Row).reports as Row[]).find(r => r.report_id === a.rid))!.run_id;
      const rollback = new Error('intentional_adaptor_probe_rollback');
      try {
        await read(async tx => {
          const c = (await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${eid} and id=${String(a.cid)}`))!;
          const snapshot: Row & { reportReference?: { selection: { reportId: string } } } = await queryReportFollowups(tx, actor(a), c, String(runId), 7777);
          assert.deepEqual(await queryReportFollowups(tx, actor(a), c, String(runId), 7777), snapshot);
          assert.equal(snapshot.reportReference?.selection.reportId, a.rid);
          assert.ok((snapshot.data as Row[]).every(p => p.id === a.pid));
          const other = actors.find(other => other.name !== a.name)!;
          await denied(() => queryReportFollowups(tx, actor(other), c, String(runId), 7778));
          if (a.name === 'customer') await tx.execute(sql`update app.construction_projects set customer_access=false where enterprise_id=${eid} and id=${String(a.pid)}`);
          else await tx.execute(sql`update app.construction_members set active=false where enterprise_id=${eid} and project_id=${String(a.pid)} and admin_id=${String(a.aid)}`);
          await denied(() => queryReportFollowups(tx, actor(a), c, String(runId), 7777));
          checked.push({ role: a.name, freshAndCached: true, wrongRecipientDenied: true, cachedReadAfterRevocationDenied: true });
          throw rollback;
        });
      } catch (e) { if (e !== rollback) throw e; }
      assert.equal((await read(tx => one(tx, sql`select count(*)::int n from app.assistant_run_steps where enterprise_id=${eid} and run_id=${String(runId)} and step_seq in(7777,7778)`)))!.n, 0);
    }
    return { checked, temporaryRowsRolledBack: true, originalRunsNotResumed: true, providerCalls: 0 };
  });
  if (!configured) { log.passed = true; return; }
  for (const trial of (log.fixedScope as Row).serviceTrials as Row[]) {
    const a = actors.find(a => a.name === trial.role)!;
    await step('configured original factual first draft ' + a.name + ' ' + ((log.attempts as Row[]).filter(x => x.role === a.name).length + 1), async () => {
      await idle(); assert.deepEqual(await config(), log.configBefore);
      const chat = new ConversationService(actor(a)), context = await new ReportContextService(actor(a), String(a.cid)).read();
      assert.equal(context.selected?.reportId, a.rid);
      const receipt = await chat.send(String(a.cid), randomUUID(), { version: 1, reportContextVersion: context.version, blocks: [{ type: 'text', text: trial.text }] });
      assert.ok(receipt.runId); await registerRun(a, String(receipt.runId), String(trial.text), 'original ConversationService', String(receipt.messageId));
      const result = await waitRun(a, String(receipt.runId));
      assert.equal((await new ReportContextService(actor(a), String(a.cid)).read()).selected?.reportId, a.rid);
      return result;
    });
  }
  await step('signed retained recipient identities for native input and persisted reentry', async () => {
    const staff = actors[1];
    const user = await withPlatformTransaction(async tx => {
      const account = await new AdminUserRepository(tx).findById(BigInt(String(staff.aid))); assert.ok(account);
      const mini = new MiniProgramIdentityRepository(tx), user = await mini.ensureStaffUser(account);
      if (!accounts.find(a => a.id === staff.aid)?.user_id) createdUser = String(user.id);
      await new UserRepository(tx).update(user.id, { phone: '199' + String(user.id).padStart(8, '0') });
      assert.ok(await mini.selectContext(user.id, { mode: 'staff', staffId: BigInt(String(staff.aid)), enterpriseId: BigInt(eid) }));
      return user;
    });
    staff.uid = String(user.id); staff.contextVersion = Number(user.contextVersion);
    for (const a of actors) a.token = await new SignJWT({ sub: String(a.uid), id: String(a.uid), mode: a.name === 'customer' ? 'customer' : 'staff', role: a.name === 'customer' ? 'user' : a.role,
      ...(a.aid ? { staffId: a.aid } : {}), enterpriseId: eid, contextVersion: a.contextVersion, source: 'password' }).setProtectedHeader({ alg: 'HS256' })
      .setSubject(String(a.uid)).setIssuedAt().setAudience('miniprogram').setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET));
    return { memoryOnlyTokens: true, originalUsers: [actors[0].uid], newSyntheticStaffUser: createdUser || null };
  });
  const native = (await import(pathToFileURL(path.resolve(nativeScript!)).href)).default;
  log.native = await native({ root, output, actors, trials: (log.fixedScope as Row).nativeTrials, registerRun, waitRun, idle });
  log.passed = true;
}
async function execute() {
try { await main(); }
catch (e) { log.passed = false; log.error = (e as Error).stack; process.exitCode = 1; }
finally {
  const cleanup: Row[] = [];
  const clean = async (name: string, fn: () => Promise<unknown>) => { try { cleanup.push({ name, passed: true, data: await fn() }); } catch (e) { cleanup.push({ name, passed: false, error: (e as Error).stack }); process.exitCode = 1; } save(); };
  try {
    if (release) {
      for (const a of actors) await clean('owned undispatched run cleanup ' + a.name, () => read(async tx => {
        for (const runId of ownedRuns) {
          const r = await one(tx, sql`select status,conversation_id::text from app.assistant_runs where enterprise_id=${eid} and id=${runId}`);
          if (r && r.conversation_id === a.cid && ['queued', 'running'].includes(String(r.status))) await cancelRuns(tx, actor(a), String(a.cid), runId, true);
        }
        return true;
      }));
      for (const saved of selections) await clean('restore explicit selection ' + saved.name, async () => {
        const a = actors.find(a => a.name === saved.name)!, service = new ReportContextService(actor(a), String(a.cid));
        const current = await service.read(); return service.select(randomUUID(), { expectedVersion: current.version, selection: saved.selection });
      });
      for (const p of projects) await clean('restore project semantic state ' + p.id, async () => {
        const current = (await owner.execute('detail', { projectId: p.id })).project as Row;
        return owner.execute('update', { projectId: p.id, expectedVersion: current.version, name: p.name, status: p.status, customerAccess: p.customer_access }, randomUUID());
      });
      if (accounts.length) await clean('restore retained account state and revoke new synthetic staff session', () => withPlatformTransaction(async tx => {
        for (const a of accounts) await tx.execute(sql`update app.admin_users set status=${a.status},user_id=${a.user_id || null} where id=${a.id}`);
        if (createdUser) await tx.execute(sql`update app.users set phone=null,context_version=context_version+1 where id=${createdUser}`);
        return { restored: accounts.map(a => a.id), newSyntheticUserRevoked: createdUser || null };
      }));
      await clean('final configuration, original ledger and idle queue', async () => {
        await idle(); const after = await accounting(), configuration = await config();
        assert.deepEqual(configuration, log.configBefore);
        assert.deepEqual(after.oldHolds, (log.accountingBefore as Row).oldHolds);
        assert.deepEqual(after.unknown3753, (log.accountingBefore as Row).unknown3753);
        if (!configured) { assert.equal(after.providerMax, (log.accountingBefore as Row).providerMax); assert.equal(after.knowledgeMax, (log.accountingBefore as Row).knowledgeMax); }
        log.accountingAfter = after; log.configAfter = configuration;
        log.providerAttempts = await read(tx => rows(tx, sql`select id::text,assistant_run_id::text,remote_model,status,accepted,error_code,estimated_cost,actual_cost
          from app.ai_provider_attempts where enterprise_id=${eid} and ${JSON.stringify(ownedRuns)}::jsonb ? assistant_run_id::text order by id`));
        log.modelCalls = (log.providerAttempts as Row[]).length;
        log.controlAfter = await read(tx => rows(tx, sql`select id::text,name,status,customer_access,version from app.construction_projects where enterprise_id=${eid} and id in(246,247) order by id`));
        return { queue: 0, originalUnknownAndHoldsUnchanged: true, reportBodiesAndConfigUnchanged: true };
      });
    }
    const after = bind(), drift = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(p => before[p] !== after[p]);
    fs.writeFileSync(path.join(output, 'binding.json'), JSON.stringify({ before, after, drift }, null, 2));
    log.drift = drift; log.cleanupChecks = cleanup; log.cleanup = cleanup.every(c => c.passed); log.finishedAt = new Date().toISOString();
    if (drift.length || !log.cleanup) { log.passed = false; process.exitCode = 1; }
    save();
  } finally { await closePostgresPool(); await release?.(); }
}
}
execute().catch(e => { console.error((e as Error).stack); process.exitCode = 1; });
