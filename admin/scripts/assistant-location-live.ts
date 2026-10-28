/** Fixed location acceptance: two natural journeys, each twice. Synthetic data,
 * isolated DB/Next, one Stable controller, original attempts and costs retained. */
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { loadEnvConfig } from '@next/env';
import { SignJWT } from 'jose';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { closePostgresPool } from '@/lib/postgresql';
import { deletePortfolioData } from '@/db/repositories/portfolio-cleanup';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { LocationService } from '@/lib/assistant/location/service';
import { PortfolioService } from '@/lib/portfolio/service';
import { ConstructionService } from '@/lib/construction/service';
import { SiteChatService } from '@/lib/construction/site-chat';
import { PublicMaterialService } from '@/lib/construction/public-service';
import { PublicCustomerService } from '@/lib/construction/public-customer';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { parseAgentUsage } from '@/lib/ai/providers/agent-chat';
import { fingerprint, type ActorContext } from '@/lib/assistant/contracts';
import { bindBailianReviewTestRuntime } from './bailian-review-test-runtime';
import { reviewBudget, type RetainedReviewHold } from './assistant-review-budget';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
import { wechatideNativeClient } from './wechatide-native-client';

type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Native SDK DTOs and evidence packets.
declare const wx: Data;
declare function getApp(): Data;
declare function getCurrentPages(): Data[];
const root = path.resolve(process.cwd(), '..'); loadEnvConfig(process.cwd(), true);
process.env.DATABASE_URL = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, '')).DATABASE_URL;
const runId = 'location-live-' + new Date().toISOString().replace(/[:.]/g, '-'), output = path.join(root, 'tmp', runId);
fs.mkdirSync(output);
const ledger = path.join(root, 'tmp/agent-contract/trial-' + runId + '.json');
const report: Data = { scope: 'Nearby public sites and designer discovery, each twice, no city/style supplied by customer. Stable first pair; service second pair. No image semantics or D2 replay.',
  configurationBinding: 'tsconfig runtime options and non-generated includes are bound; regenerated .next type-output include paths are excluded prospectively. Full raw tsconfig/next-env hashes are retained separately.',
  authorization: { model: 'qwen3.8-flash', cumulativeCapMicros: 100000000, fixedJourneys: 4, maximumDispatches: 12 }, calls: [], cases: [], native: [], captures: [], fixture: {}, cleaned: false, restored: false };
const save = () => fs.writeFileSync(ledger, JSON.stringify(report, null, 2));
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const hash = (file: string) => createHash('sha256').update(new Uint8Array(fs.readFileSync(file))).digest('hex');
const sourceFolders = ['admin/src/lib/assistant', 'admin/src/lib/portfolio', 'admin/src/lib/construction', 'admin/src/lib/map-services', 'admin/src/lib/ai', 'admin/src/db', 'miniprogram/packages/assistant'];
function binding() { const result: Record<string, string> = {}; const walk = (file: string) => { const full = path.join(root, file); if (!fs.existsSync(full)) return;
  if (fs.statSync(full).isDirectory()) { for (const child of fs.readdirSync(full)) if (child !== '__tests__') walk(file + '/' + child); }
  else if (file === 'admin/tsconfig.json') { const value = JSON.parse(fs.readFileSync(full, 'utf8')); value.include = (value.include || []).filter((item: string) => !item.startsWith('.next'));
    result[file + '#runtime'] = fingerprint(value); }
  else result[file] = hash(full); };
  [...sourceFolders, 'admin/scripts/assistant-location-live.ts', 'admin/scripts/wechatide-native-client.ts', 'admin/scripts/bailian-review-test-runtime.ts',
    'admin/scripts/assistant-review-budget.ts', 'admin/scripts/assistant-acceptance-safety.mjs', 'admin/scripts/wechatide-window-state.ps1', 'admin/tsconfig.json', 'admin/next.config.ts', 'admin/.env.local', 'admin/.env.development', 'admin/package-lock.json',
    'miniprogram/app.json', 'miniprogram/app.js', 'miniprogram/utils/api.js', 'miniprogram/utils/session.js', 'miniprogram/utils/public-site-client.js',
    'miniprogram/project.config.json', 'miniprogram/project.private.config.json', 'tmp/xiaok-vector/connection.private.json', 'tmp/xiaok-intelligent-consult/.env.qwen37'].forEach(walk); return result; }
function holds(): RetainedReviewHold[] { return ['tmp/anythingllm-pilot', 'tmp/agent-comparison', 'tmp/agent-diagnosis', 'tmp/agent-contract'].flatMap(dir => fs.readdirSync(path.join(root, dir)).filter(f => /^trial-.*\.json$/.test(f))
  .flatMap(f => (JSON.parse(fs.readFileSync(path.join(root, dir, f), 'utf8')).calls || []).filter((c: Data) => c.status !== 'succeeded').map((c: Data) => ({ id: c.id, runId: c.runId, reservedTokens: c.reservedTokens })))); }
const questions = ['我想先去附近工地看看，有在施工的可以了解吗？', '看看适合我的设计师，风格我还没想好'];
const originalFetch = globalThis.fetch;
let release: ((() => Promise<void>) & { assertHeld?: () => Promise<void> }) | undefined, restore: (() => Promise<unknown>) | undefined, next: cp.ChildProcess | undefined;
let actor: ActorContext, eid = '', ownerId = '', visitorId = '', manager = '', designer = '', projectId = '', site: Row = {}, activeCase = '';
const mp = wechatideNativeClient(path.join(root, 'miniprogram'), output); let installed = false;

async function fixtures() {
  const prefix = 'SYNTHETIC-LOCATION-' + randomUUID();
  await withPlatformTransaction(async tx => {
    eid = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix},${prefix},'active') returning id`))!.id);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
      values(${eid},true,100,12000000,1000000000,30,${JSON.stringify({ runtime: 'langgraph-v1', model: 'qwen3.8-flash', providerKey: 'dashscope', imageInput: false, tools: true, probeVersion: 'location-live-v1' })}::jsonb)`);
    for (const role of ['enterprise_admin', 'designer']) { const admin = (await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
      values(${eid},${prefix + role},'synthetic-only',${role},'active',false,${role === 'designer' ? '测试设计师林工' : '测试经理'}) returning id`))!;
      if (role === 'designer') designer = String(admin.id); else manager = String(admin.id); }
    for (const label of ['owner', 'visitor']) { const user = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix + label},1) returning id`))!.id);
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${user},${prefix + label})`); if (label === 'owner') ownerId = user; else visitorId = user; }
  });
  actor = { enterpriseId: eid, principal: { kind: 'user', userId: visitorId }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
  const cid = String((await new ConversationService(actor).create(randomUUID())).id);
  const located = await new LocationService(actor, cid).locate({ latitude: 30.642, longitude: 111.345, coordinateSystem: 'gcj02' });
  const region = located.region; assert.equal(region.cityName, '宜昌市'); report.region = region;
  const portfolio = new PortfolioService({ enterpriseId: eid, adminId: designer });
  await portfolio.execute('saveProfile', { expectedVersion: 0, content: { bio: '合成测试资料', cities: [{ code: region.cityCode, name: region.cityName, districts: [] }], styles: ['原木风'], layoutSpecialties: ['三居'], featuredWorkIds: [] } }, randomUUID());
  const work = await portfolio.execute('create', { content: { title: 'SYNTHETIC 原木客厅' } }, randomUUID());
  const wid = String(work.id), image = (await sharp({ create: { width: 480, height: 320, channels: 3, background: '#cadcc9' } }).png().toBuffer()).toString('base64');
  const upload = await portfolio.execute('upload', { workId: wid, expectedVersion: 1, imageBase64: image }, randomUUID());
  await portfolio.execute('save', { workId: wid, expectedVersion: 1, content: { title: 'SYNTHETIC 原木客厅', description: '隔离回归合成案例，仅作推荐链路测试。', primaryStyle: '原木风', cityCode: region.cityCode,
    cityName: region.cityName, district: region.district, authorRole: '主创设计', source: '自制合成测试图', authorization: '测试展示', showOnProfile: true, recommendable: true,
    images: [{ assetId: String(upload.assetId), kind: 'render', aiGenerated: true, showroom: false, caption: '合成测试图' }], coverAssetId: String(upload.assetId) } }, randomUUID());
  await portfolio.execute('submit', { workId: wid, expectedVersion: 2 }, randomUUID());
  await new PortfolioService({ enterpriseId: eid, adminId: manager }).execute('publish', { workId: wid, expectedVersion: 3 }, randomUUID());
  const leadId = await withPlatformTransaction(async tx => String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
    values(${eid},${ownerId},'SYNTHETIC私有业主','13980001234','natural') returning id`))!.id));
  projectId = String((await new ConstructionService({ enterpriseId: eid, adminId: manager }).execute('create', { leadId, name: 'SYNTHETIC私有项目', managerId: manager, rooms: [] }, randomUUID())).id);
  const shared = new SiteChatService({ enterpriseId: eid, adminId: manager });
  const recordId = String((await shared.send(projectId, { text: '客厅线管已铺好，底盒未固定，等设计师核对。', mediaIds: [] }, randomUUID())).recordId);
  await shared.mutate(projectId, recordId, 'edit', { expectedVersion: 1, data: { title: '水电预留核对', roomId: null, completed: '线管已铺好', pending: '底盒未固定', coordination: '请设计师核对点位', note: '' } }, randomUUID());
  await shared.mutate(projectId, recordId, 'publish', { expectedVersion: 2, audience: 'customer' }, randomUUID());
  const materials = new PublicMaterialService({ enterpriseId: eid, adminId: manager }), view = await materials.read(projectId), source = (view.sourceItems as Row[]).find(s => s.id === recordId)!;
  site = await materials.save(projectId, { expectedRevision: view.revision, material: { name: 'SYNTHETIC 附近水电工地', cityCode: region.cityCode, district: region.district,
    sources: [{ kind: source.kind, id: source.id, sourceHash: source.sourceHash, text: source.text }], photos: [] } }, randomUUID());
  site = await materials.mutate(projectId, 'submit', { versionId: site.versionId, expectedRevision: site.revision }, randomUUID());
  const owner: ActorContext = { ...actor, principal: { kind: 'user', userId: ownerId } }, ownerCid = String((await new ConversationService(owner).create(randomUUID())).id), consent = new PublicCustomerService(owner, ownerCid);
  site = await consent.decide(String(site.id), 'preview', { versionId: site.versionId, expectedRevision: site.revision }, randomUUID());
  site = await consent.decide(String(site.id), 'approve', { versionId: site.versionId, expectedRevision: site.revision }, randomUUID());
  site = await materials.mutate(projectId, 'publish', { versionId: site.versionId, expectedRevision: site.revision }, randomUUID());
  report.fixture = { enterpriseId: eid, ownerId, visitorId, manager, designer, projectId, workId: wid, conversationId: cid, siteId: site.id }; save(); return cid;
}
async function processQueued(expectedRunId: string) {
  await release?.assertHeld?.();
  // Live C01 polls share the settings lock. Like the real Worker, honor SKIP
  // LOCKED and wait for the owner rather than treating contention as no job.
  let lease: Awaited<ReturnType<typeof claimJob>> = null;
  for (let attempt = 0; attempt < 25 && !lease; attempt++) {
    lease = await claimJob(); if (!lease) { report.claimWaits = (report.claimWaits || 0) + 1; await delay(600); }
  }
  assert.ok(lease); assert.equal(lease.enterpriseId, eid); assert.equal(lease.runId, expectedRunId);
  activeCase = lease.runId;
  await processAgentAnswer(lease);
  const service = new ConversationService(actor), run = await service.run(lease.runId);
  const messages = await service.messages(String(run.conversationId), undefined, 30), response = messages.items.find(item => String(item.id) === run.outputMessageId);
  const original = await withTenantTransaction(eid, tx => one(tx, sql`select m.content from app.assistant_messages m join app.assistant_runs r
    on r.enterprise_id=m.enterprise_id and r.trigger_message_id=m.id where r.enterprise_id=${eid} and r.id=${lease!.runId}`));
  const question = ((original?.content as Data)?.blocks || []).map((b: Data) => b.text || '').join(''), answer = JSON.stringify(response);
  const result = { runId: lease.runId, run, question, response, configuredModel: true, passed: false }; report.cases.push(result); save();
  assert.equal(run.status, 'succeeded', JSON.stringify(run)); assert.ok(questions.includes(question));
  assert.doesNotMatch(answer, /13980001234|SYNTHETIC私有业主|SYNTHETIC私有项目/);
  if (question === questions[0]) assert.match(answer, /附近水电工地|底盒未固定/);
  else assert.ok((response as Data)?.designerRecommendation?.items?.length === 1, answer);
  result.passed = true; save(); return run;
}
async function waitPage(predicate: (data: Data) => boolean, idle = false) {
  for (let i = 0; i < 35; i++) { if (report.infrastructureError) throw Error(report.infrastructureError); const page = await mp.currentPage(); if (page?.path === 'packages/assistant/chat/chat') {
    const data = await page.data(); report.lastNativeState = { draft: data.draft, loading: data.loading, busy: data.busy, canSend: data.canSend, readOnly: data.readOnly,
      pendingSend: data.pendingSend, pendingAction: data.pendingAction, generating: data.generating, run: data.run, error: data.error, fatal: data.fatal,
      portfolioItems: data.portfolioItems, portfolioNotice: data.portfolioNotice, portfolioLoading: data.portfolioLoading, hasDesignerRecommendation: data.hasDesignerRecommendation };
    if (!data.loading && predicate(data) && (!idle || await mp.evaluate(() => { const p = getCurrentPages().at(-1);
      return !!p && !p.location?.pending && !p.controller?.refreshFlight && !p._locatingDesigners; }))) return { page, data };
  } await delay(600); }
  save();
  throw Error('C01 state did not settle');
}
async function capture(name: string) { assert.equal((await mp.currentPage())?.path, 'packages/assistant/chat/chat'); const file = path.join(output, name + '.png'); await mp.screenshot({ path: file }); report.captures.push({ route: 'packages/assistant/chat/chat', file, sha256: hash(file) }); save(); }
async function native(cid: string) {
  const state = JSON.parse((await promisify(cp.execFile)('powershell.exe', ['-NoProfile', '-File', path.join(root, 'admin/scripts/wechatide-window-state.ps1')], { windowsHide: true, timeout: 10000 })).stdout.replace(/^\uFEFF/, ''));
  const windows = state.Windows.filter((w: Data) => w.Title === 'WeChat Web Devtools'); assert.equal(windows.length, 1);
  // Minimized windows report -32000 screen coordinates; read their normal
  // placement without restoring, moving or focusing the user's window.
  const b = windows[0].Minimized ? windows[0].NormalBounds : windows[0].Bounds, x = (b.Left + b.Right) / 2, y = (b.Top + b.Bottom) / 2;
  assert.ok(state.Screens.some((s: Data) => !s.Primary && x >= s.Bounds.X && x < s.Bounds.X + s.Bounds.Width && y >= s.Bounds.Y && y < s.Bounds.Y + s.Bounds.Height)); report.window = state;
  for (let attempt = 0; attempt < 2; attempt++) { await mp.call('simulator_refresh', { project: path.join(root, 'miniprogram') }); await delay(6000);
    try { const system = await mp.systemInfo(); assert.equal(system.windowWidth, 390); assert.equal(system.windowHeight, 844); assert.ok(Object.keys(await (await mp.currentPage())!.data()).length); report.system = system; break; } catch (e) { if (attempt) throw e; report.initialFrozen = String(e); } }
  const token = await new SignJWT({ id: visitorId, contextVersion: 1, mode: 'customer', role: 'user', enterpriseId: eid, source: 'wechat' }).setProtectedHeader({ alg: 'HS256' }).setAudience('miniprogram').setSubject(visitorId).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET));
  installed = true;
  await mp.evaluate((config: Data) => { const app = getApp(); if (Object.keys(app).some(k => /^__qa/.test(k))) throw Error('Native controller busy');
    const saved: Data = { request: wx.request, download: wx.downloadFile, get: wx.getStorageSync, set: wx.setStorageSync, remove: wx.removeStorageSync, setting: wx.getSetting, location: wx.getLocation,
      token: app.globalData.token, bootstrap: app.globalData.bootstrap, hydrate: app.hydrateStoredSession, memory: new Map(), allowed: true, failFix: false };
    app.__qaLocation = saved; app.hydrateStoredSession = async () => {}; app.globalData.token = config.token; app.globalData.bootstrap = { current: { mode: 'customer', role: 'user', context: { enterpriseId: config.eid } } }; saved.memory.set('token', config.token);
    wx.getStorageSync = (key: string) => key.startsWith('assistant-') ? saved.memory.get(key) : saved.memory.has(key) ? saved.memory.get(key) : saved.get.call(wx, key);
    wx.setStorageSync = (key: string, value: unknown) => saved.memory.set(key, value); wx.removeStorageSync = (key: string) => saved.memory.delete(key);
    wx.getSetting = (o: Data) => o.success({ authSetting: { 'scope.userLocation': saved.allowed } });
    wx.getLocation = (o: Data) => { if (saved.failFix) o.fail({ errMsg: 'getLocation:fail synthetic failure' });
      else { saved.allowed = true; o.success({ latitude: 30.642, longitude: 111.345 }); } };
    saved.target = (raw: string) => { const i = raw.indexOf('/api/miniprogram/assistant/'); return i < 0 ? null : 'http://127.0.0.1:3114' + raw.slice(i); };
    wx.request = (o: Data) => { const url = saved.target(String(o.url)); if (!url) { o.fail?.({ errMsg: 'Synthetic-only transport' }); return { abort() {} }; } return saved.request.call(wx, { ...o, url }); };
    wx.downloadFile = (o: Data) => { const url = saved.target(String(o.url)); if (!url) { o.fail?.({ errMsg: 'Synthetic-only media' }); return { abort() {} }; } return saved.download.call(wx, { ...o, url }); };
  }, { token, eid });
  const route = '/packages/assistant/chat/chat?conversationId=' + cid;
  await mp.redirectTo(route); let view = await waitPage(d => !!d.conversation);
  for (let index = 0; index < 2; index++) {
    // A transport-only SDK reconnect stays inside this exact bound batch. Reuse
    // its persisted successful answer instead of sampling the model again.
    const completed = report.cases.find((item: Data) => item.passed && item.question === questions[index] && String(item.run.conversationId) === cid);
    if (completed) view = await waitPage(d => d.messages.some((m: Data) => String(m.id) === String(completed.response.id)) && !d.generating);
    else {
      view = await waitPage(d => !!d.conversation && d.canSend && !d.busy && !d.generating && !d.pendingSend && !d.pendingAction && !d.readOnly && !d.fatal, true);
      const input = await view.page.$('.composer-input'); assert.ok(input); await input.input(questions[index]);
      view = await waitPage(d => d.draft === questions[index] && d.canSend && !d.busy && !d.generating && !d.pendingSend && !d.pendingAction && !d.readOnly && !d.fatal, true);
      const send = await view.page.$('.send-button'); assert.ok(send); await send.tap(); const queued = await waitPage(d => !!d.run && d.run.status === 'queued');
      assert.equal((await new LocationService(actor, cid).read()).region?.cityCode, '420500', 'Fixed trial requires a still-authorized region before provider dispatch');
      await processQueued(String(queued.data.run.id)); view = await waitPage(d => d.run?.status === 'succeeded' && !d.generating);
    }
    if (!index) {
      assert.equal(view.data.publicItems.length, 1); assert.equal(view.data.publicItems[0].id, String(site.id)); await capture('nearby-public-sites');
      view = await waitPage(d => d.portfolioItems.length === 1 && !d.portfolioLoading); await capture('location-designers');
      for (const mode of ['denied', 'failure', 'recovered']) {
        if (report.native.some((item: Data) => item.name === mode && item.passed)) continue;
        await new LocationService(actor, cid).clear();
        await mp.evaluate((mode: string) => { getApp().__qaLocation.allowed = mode === 'denied' ? false : undefined; getApp().__qaLocation.failFix = mode === 'failure'; }, mode);
        await mp.redirectTo(route); view = await waitPage(d => !!d.conversation && d.messages.length >= 2 && !d.portfolioItems.length && !d.portfolioLoading && !d.generating, true);
        // Stable's selector bridge supports descendant selectors. Wait for the
        // empty recommendation state before selecting its sole action, so the
        // designer-profile action from the preceding page cannot be tapped.
        let action = await view.page.$('.portfolio-recommendations .notice-action');
        for (let attempt = 0; attempt < 10 && !action; attempt++) { await delay(300); action = await view.page.$('.portfolio-recommendations .notice-action'); }
        if (!action) await capture('missing-location-action-' + mode);
        assert.ok(action, 'Existing C01 recommendation action in ' + mode); await action.tap();
        view = await waitPage(d => mode === 'recovered' ? d.portfolioItems.length === 1 && !d.portfolioLoading : !d.portfolioLoading && !!d.portfolioNotice);
        if (mode !== 'recovered') { assert.equal(view.data.portfolioItems.length, 0); assert.equal((await new LocationService(actor, cid).read()).region, null); }
        else { assert.equal(await mp.evaluate(() => getApp().__qaLocation.allowed), true); assert.equal((await new LocationService(actor, cid).read()).region?.cityCode, '420500'); }
        await capture('location-' + mode); report.native.push({ name: mode, passed: true }); save();
      }
    } else { assert.equal(view.data.hasDesignerRecommendation, true); await capture('agent-location-designers'); }
  }
  await mp.redirectTo(route); view = await waitPage(d => d.hasDesignerRecommendation); assert.equal(view.data.conversation.id, cid);
  report.native.push({ name: 'actual inputs/taps, service results, region failure/recovery and persisted same-chat reentry', passed: true }); save();
}
async function cleanupFixture() {
  if (!eid) return;
  await withPlatformTransaction(async tx => {
    assert.match(String((await one(tx, sql`select name from app.enterprises where id=${eid}`))?.name), /^SYNTHETIC-LOCATION-/);
    // Exact owned synthetic tenant only. Optional recording tables are absent in
    // this evaluation schema; no production cleanup behavior is changed here.
    const tables = ['construction_recordings', 'construction_camera_recording_periods', 'construction_camera_recording_policies', 'construction_camera_controls', 'construction_camera_snapshots', 'construction_camera_sessions', 'construction_camera_entries', 'construction_camera_bindings', 'construction_cameras', 'construction_public_sites', 'construction_public_audits', 'construction_public_media', 'construction_public_sources', 'construction_public_versions', 'construction_site_attachments', 'construction_site_record_versions', 'construction_site_records', 'construction_site_media', 'construction_watches', 'construction_chats', 'construction_stage_assignments', 'construction_links', 'construction_audits', 'construction_visits', 'construction_plans', 'construction_rooms', 'construction_members', 'construction_projects', 'construction_stage_settings'];
    for (const table of tables) if ((await one(tx, sql`select to_regclass(${'app.' + table}) present`))?.present) await tx.execute(sql`delete from ${sql.raw('app.' + table)} where enterprise_id=${eid}`);
    await deletePortfolioData(tx, BigInt(eid)); await deleteAssistantData(tx, BigInt(eid)); await tx.execute(sql`delete from app.leads where enterprise_id=${eid}`);
    await tx.execute(sql`delete from app.admin_users where enterprise_id=${eid}`); await tx.execute(sql`delete from app.users where id in (${ownerId},${visitorId})`); await tx.execute(sql`delete from app.enterprises where id=${eid}`);
  }); report.cleaned = true;
}
async function main() {
  try {
    release = await lockAssistantAcceptance(process.env.DATABASE_URL, { waitForLock: true, onLockError: (error: Error) => { report.infrastructureError = String(error); save(); } });
    const bound = await bindBailianReviewTestRuntime(root, ledger); restore = bound.restore; report.runtime = bound.receipt;
    const cid = await fixtures();
    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname !== 'dashscope.aliyuncs.com') return originalFetch(input, init);
      if (report.infrastructureError) throw Error(report.infrastructureError);
      await release?.assertHeld?.();
      assert.ok(report.calls.length < 12); reviewBudget(root).assertReservation(0, 72000, holds());
      const call: Data = { id: runId + ':' + (report.calls.length + 1), runId: activeCase, status: 'unknown', reservedTokens: 72000 };
      report.calls.push(call); save(); const wire = path.join(output, 'wire-' + report.calls.length + '.json'), packet: Data = { body: JSON.parse(String(init?.body)), caseId: activeCase };
      fs.writeFileSync(wire, JSON.stringify(packet, null, 2));
      const response = await originalFetch(input, init), raw = await response.clone().text(); packet.status = response.status; packet.rawResponse = raw;
      const usage = response.ok ? parseAgentUsage(JSON.parse(raw).usage) : null; if (usage) { call.status = 'succeeded'; call.usage = { total_tokens: usage.inputTokens + usage.outputTokens }; }
      fs.writeFileSync(wire, JSON.stringify(packet, null, 2)); save(); return response;
    };
    await promisify(cp.execFile)(process.execPath, ['scripts/prune-next-cache.mjs'], { windowsHide: true });
    next = cp.spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '-H', '127.0.0.1', '-p', '3114'], { env: { ...process.env, NEXT_DIST_DIR: '.next/location-isolated' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const log = fs.createWriteStream(path.join(output, 'next.log')); next.stdout!.pipe(log); next.stderr!.pipe(log);
    for (let i = 0; i < 80; i++) { try { if ((await originalFetch('http://localhost:3114/api/health')).ok) break; } catch {} if (i === 79) throw Error('Isolated service unavailable'); await delay(1000); }
    assert.equal((await originalFetch('http://localhost:3114/api/miniprogram/assistant/conversations')).status, 401, 'Warm the actual API before native requests');
    report.before = binding(); report.rawConfigBefore = { tsconfig: hash('tsconfig.json'), nextEnv: hash('next-env.d.ts') }; save();
    try { await native(cid); } catch (error) {
      const sdkError = error as Data;
      if (!String(sdkError.cmd || '').includes('skill-index.js') || (!sdkError.killed && sdkError.signal !== 'SIGTERM')) throw error;
      await release?.assertHeld?.();
      report.sdkRecovery = { originalError: String(sdkError.stack || error), action: 'one fresh compile/reconnect; reuse only this batch persisted successes, never resend a model question' }; save();
      await mp.evaluate(() => { const app = getApp(), s = app.__qaLocation; if (!s) return;
        wx.request = s.request; wx.downloadFile = s.download; wx.getStorageSync = s.get; wx.setStorageSync = s.set; wx.removeStorageSync = s.remove;
        wx.getSetting = s.setting; wx.getLocation = s.location; app.globalData.token = s.token; app.globalData.bootstrap = s.bootstrap; app.hydrateStoredSession = s.hydrate; delete app.__qaLocation;
      });
      // native() begins with explicit compilation and live viewport/page checks.
      await native(cid);
    }
    const nextCid = String((await new ConversationService(actor).create(randomUUID())).id);
    await new LocationService(actor, nextCid).locate({ latitude: 30.642, longitude: 111.345, coordinateSystem: 'gcj02' });
    for (const question of questions) { const sent = await new ConversationService(actor).send(nextCid, randomUUID(), { version: 1, blocks: [{ type: 'text', text: question }] }); activeCase = String(sent.runId); await processQueued(activeCase); }
    const detail = await new ConversationService(actor).messages(nextCid, undefined, 30); report.serviceReentry = detail;
    assert.ok(JSON.stringify(detail).includes('SYNTHETIC 附近水电工地')); assert.ok(JSON.stringify(detail).includes('designerRecommendation'));
    report.passed = true;
  } catch (error) { report.error = String((error as Error).stack || error); process.exitCode = 1; }
  finally {
    globalThis.fetch = originalFetch;
    try { if (installed) report.nativeRestored = await mp.evaluate(() => { const app = getApp(), s = app.__qaLocation; if (!s) return false;
      wx.request = s.request; wx.downloadFile = s.download; wx.getStorageSync = s.get; wx.setStorageSync = s.set; wx.removeStorageSync = s.remove; wx.getSetting = s.setting; wx.getLocation = s.location;
      app.globalData.token = s.token; app.globalData.bootstrap = s.bootstrap; app.hydrateStoredSession = s.hydrate; delete app.__qaLocation; return true; });
      if (report.nativeRestored === true) await mp.reLaunch('/pages/index/index'); await mp.disconnect(); } catch (error) { report.nativeCleanupError = String(error); process.exitCode = 1; }
    if (report.before) { report.after = binding(); report.rawConfigAfter = { tsconfig: hash('tsconfig.json'), nextEnv: hash('next-env.d.ts') };
      report.drift = Object.keys(report.before).filter(file => report.before[file] !== report.after[file]); if (report.drift.length) process.exitCode = 1; }
    if (next?.pid && next.exitCode === null && next.signalCode === null) cp.spawnSync('taskkill', ['/PID', String(next.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    if (report.infrastructureError) { await release?.(); release = await lockAssistantAcceptance(process.env.DATABASE_URL, { waitForLock: true }); }
    try { if (eid) { report.originals = await withTenantTransaction(eid, async tx => ({ runs: await rows(tx, sql`select * from app.assistant_runs where enterprise_id=${eid}`),
      jobs: await rows(tx, sql`select * from app.assistant_jobs where enterprise_id=${eid}`), messages: await rows(tx, sql`select * from app.assistant_messages where enterprise_id=${eid}`),
      steps: await rows(tx, sql`select * from app.assistant_run_steps where enterprise_id=${eid}`), attempts: await rows(tx, sql`select * from app.ai_provider_attempts where enterprise_id=${eid}`) })); } await cleanupFixture(); } catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
    try { if (restore) { await restore(); report.restored = true; } } catch (error) { report.restoreError = String(error); process.exitCode = 1; }
    // Remove this server's generated type paths without overwriting changes
    // made before the lock was acquired or by another task's configuration.
    const config = JSON.parse(fs.readFileSync('tsconfig.json', 'utf8')), includes = config.include || [];
    config.include = includes.filter((item: string) => !item.startsWith('.next/location-isolated/') && !item.startsWith('.next/location-build/'));
    if (config.include.length !== includes.length) fs.writeFileSync('tsconfig.json', JSON.stringify(config, null, 2) + '\n');
    const envFile = fs.readFileSync('next-env.d.ts', 'utf8');
    if (envFile.includes('.next/location-isolated/')) {
      const ts = await import('typescript');
      for (const routeFile of ['.next/dev/types/routes.d.ts', '.next/types/routes.d.ts']) if (fs.existsSync(routeFile)) {
        const parsed = ts.createSourceFile(routeFile, fs.readFileSync(routeFile, 'utf8'), ts.ScriptTarget.Latest) as unknown as Data;
        if (parsed.parseDiagnostics.length) continue;
        fs.writeFileSync('next-env.d.ts', envFile.replace(/\.next\/location-isolated\/(?:dev\/)?types\/routes\.d\.ts/g, routeFile)); report.generatedTypesRestored = routeFile; break;
      }
    }
    await closePostgresPool(); await release?.(); report.budgetAfter = reviewBudget(root).usedMicros; save();
    console.log(JSON.stringify({ output, passed: report.passed, error: report.error, cleanupError: report.cleanupError, calls: report.calls.length, cases: report.cases.length, native: report.native, drift: report.drift, cleaned: report.cleaned, restored: report.restored, budgetAfter: report.budgetAfter }));
  }
}
void main();
