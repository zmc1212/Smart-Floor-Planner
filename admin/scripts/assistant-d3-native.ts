/* eslint-disable @typescript-eslint/no-explicit-any -- Stable DevTools RPC and synthetic service DTOs. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import cp from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { PortfolioService } from '@/lib/portfolio/service';
import { PortfolioCatalog } from '@/lib/portfolio/catalog';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { HandoffService } from '@/lib/assistant/handoff/service';
import { HandoffWorkflow } from '@/lib/assistant/handoff/workflow';
import { AssistantMediaService } from '@/lib/assistant/media/service';
import { assistantHttp } from '@/lib/assistant/application/http';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { fingerprint, type ActorContext } from '@/lib/assistant/contracts';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
import { wechatideNativeClient } from './wechatide-native-client';

type Row = Record<string, any>;
declare const wx: Row;
declare function getApp(): Row;
declare function getCurrentPages(): Row[];
const root = path.resolve(process.cwd(), '..'); loadEnvConfig(process.cwd(), true);
process.env.DATABASE_URL = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, '')).DATABASE_URL;
const name = process.argv[2]; assert.match(name, /^d3-[a-z0-9-]{5,75}$/);
const staffNative = process.argv.includes('--staff-native');
const output = path.join(root, 'tmp', name); assert.ok(!fs.existsSync(output)); fs.mkdirSync(output, { recursive: true });
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
function binding() {
  const files: string[] = [];
  const walk = (folder: string) => { for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
    const file = folder + '/' + entry.name; if (entry.isDirectory()) walk(file); else if (/\.(?:ts|js|mjs|json|wxml|less)$/.test(file)) files.push(file);
  } };
  for (const folder of ['admin/src/lib/assistant', 'admin/src/lib/portfolio', 'admin/src/db', 'miniprogram/packages/assistant']) walk(folder);
  files.push('admin/scripts/assistant-d3-native.ts', 'admin/scripts/wechatide-native-client.ts', 'admin/scripts/wechatide-window-state.ps1',
    'admin/scripts/assistant-acceptance-safety.mjs', 'admin/src/lib/miniprogram-jwt.ts', 'admin/src/lib/miniprogram-auth.ts',
    'admin/src/lib/miniprogram-identity-context.ts', 'admin/src/db/postgres-dto.ts', 'admin/src/lib/postgresql.ts', 'admin/src/lib/admin-user-roles.ts',
    'admin/package-lock.json', 'admin/tsconfig.json', 'admin/.env.local', 'tmp/xiaok-vector/connection.private.json', 'miniprogram/utils/api.js',
    'miniprogram/test/assistant-handoff.test.js', 'miniprogram/test/assistant-media.test.js', 'miniprogram/test/assistant-portfolio.test.js');
  return Object.fromEntries([...new Set(files)].filter(file => fs.existsSync(path.join(root, file))).map(file => [file, hash(fs.readFileSync(path.join(root, file)))]));
}
const report: Row = { delivery: 'D3', scope: 'Actual Stable client/content entry/contact/human continuation; no generated reply, model or embedding calls',
  staffNative, started: new Date().toISOString(), before: binding(), checks: [], captures: [], requests: [], externalCalls: 0, passed: false };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const fixture: Row = { enterpriseId: '', userIds: [], staffIds: [], conversationIds: [], leadIds: [] };
const tokens: string[] = [];
const previousFetch = globalThis.fetch, previousRollout = process.env.ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS;
const mp = wechatideNativeClient(path.join(root, 'miniprogram'), output), execFile = promisify(cp.execFile);
let release: (() => Promise<void>) | undefined, server: http.Server | undefined, installed = false, picker = false, modal = false;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor<T>(read: () => Promise<T>, label: string): Promise<NonNullable<T>> {
  for (let i = 0; i < 70; i++) { const value = await read(); if (value) return value as NonNullable<T>; await delay(250); }
  throw Error('D3 native timeout: ' + label);
}
async function step(name: string, work: () => Promise<unknown>) {
  const check: Row = { name, passed: false }; report.checks.push(check); save();
  try { check.result = await work(); check.passed = true; } catch (error) { check.error = String((error as Error).stack || error); throw error; } finally { save(); }
}
const customer = (index = 0): ActorContext => ({ enterpriseId: fixture.enterpriseId, principal: { kind: 'user', userId: fixture.userIds[index] }, contextVersion: 1, capabilities: ['assistant.chat.self'] });
const staff = (): ActorContext => ({ enterpriseId: fixture.enterpriseId, principal: { kind: 'admin', adminId: fixture.staffIds[1] }, contextVersion: 0, capabilities: ['assistant.handoff.staff'] });
async function createFixture() {
  const prefix = 'synthetic-' + name + '-' + randomUUID();
  await withPlatformTransaction(async tx => {
    fixture.enterpriseId = String((await one(tx, sql`insert into app.enterprises(name,code,status) values('测试专用 · D3原生接待',${prefix},'active') returning id`))!.id);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
      values(${fixture.enterpriseId},true,100,12000000,100000000,30,'{"runtime":"langgraph-v1","providerKey":"synthetic-no-dispatch","model":"synthetic-no-dispatch","tools":true,"imageInput":false,"probeVersion":"d3-native"}'::jsonb)`);
    for (let i = 0; i < 3; i++) {
      const uid = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix + '-customer-' + i},1) returning id`))!.id);
      fixture.userIds.push(uid); await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${prefix + i})`);
    }
    for (const role of ['enterprise_admin', 'designer']) fixture.staffIds.push(String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
      values(${fixture.enterpriseId},${prefix + role},'unusable-synthetic',${role},'active',false,${role === 'designer' ? '测试设计师甲' : '测试负责人'}) returning id`))!.id));
    if (staffNative) {
      fixture.staffUserId = String((await one(tx, sql`insert into app.users(nickname,role,context_version) values(${prefix + '-staff-native'},'staff',1) returning id`))!.id);
      fixture.userIds.push(fixture.staffUserId);
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${fixture.staffUserId},${prefix + '-staff-native'})`);
      await tx.execute(sql`update app.admin_users set user_id=${fixture.staffUserId} where id=${fixture.staffIds[1]}`);
    }
    for (let i = 0; i < 2; i++) fixture.leadIds.push(String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source,assigned_to)
      values(${fixture.enterpriseId},${fixture.userIds[i]},'测试专用 · 既有客户','13000000000','manual',${fixture.staffIds[1]}) returning id`))!.id));
  });
  report.fixture = fixture; save();
  process.env.ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS = fixture.enterpriseId;
  const author = new PortfolioService({ enterpriseId: fixture.enterpriseId, adminId: fixture.staffIds[1] });
  const owner = new PortfolioService({ enterpriseId: fixture.enterpriseId, adminId: fixture.staffIds[0] });
  const op = (service: PortfolioService, action: string, body: Row) => service.execute(action, body, randomUUID());
  const work = await op(author, 'create', { content: { title: '测试专用 · 原木厨房收纳' } }); fixture.workId = String(work.id);
  const bytes = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#d8dfd5' } }).jpeg().toBuffer();
  const asset = await op(author, 'upload', { workId: fixture.workId, expectedVersion: 1, imageBase64: bytes.toString('base64') });
  const content = { title: '测试专用 · 原木厨房收纳', description: '明确合成的厨房收纳和动线展示，仅用于隔离原生接待验证。', primaryStyle: '原木风',
    cityCode: '330100', cityName: '杭州市', district: '', authorRole: '主创设计', source: 'SYNTHETIC TEST ONLY', authorization: '合成作者授权本隔离测试展示',
    showOnProfile: true, images: [{ assetId: String(asset.assetId), kind: 'render', aiGenerated: true, showroom: false, caption: '合成测试图' }], coverAssetId: String(asset.assetId) };
  await op(author, 'save', { workId: fixture.workId, expectedVersion: 1, content }); await op(author, 'submit', { workId: fixture.workId, expectedVersion: 2 });
  await op(owner, 'publish', { workId: fixture.workId, expectedVersion: 3 });
  fixture.versionId = String(((await op(author, 'detail', { workId: fixture.workId })).work as Row).published_version_id);
  for (const uid of fixture.userIds.slice(0, 2)) tokens.push(await signMiniProgramToken({ sub: uid, id: uid, contextVersion: 1, mode: 'customer', role: 'user', enterpriseId: fixture.enterpriseId, source: 'wechat' }));
  if (staffNative) tokens.push(await signMiniProgramToken({ sub: fixture.staffUserId, id: fixture.staffUserId, contextVersion: 1, mode: 'staff', role: 'designer', staffRole: 'designer', staffId: fixture.staffIds[1], enterpriseId: fixture.enterpriseId, source: 'wechat' }));
  const base = String((await new ConversationService(customer()).create(randomUUID())).id); fixture.conversationIds.push(base);
  const share = await new PortfolioCatalog(customer(), base).share(fixture.workId, fixture.versionId);
  fixture.sharePathHash = hash(share.path); fixture.sharePath = share.path;
  report.fixture = { ...fixture, sharePath: undefined }; save();
}
async function verifyWindow() {
  const result = await execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'admin/scripts/wechatide-window-state.ps1')], { windowsHide: true, timeout: 10000 });
  const state = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim()), windows = state.Windows.filter((item: Row) => item.Title === 'WeChat Web Devtools');
  assert.equal(windows.length, 1); const b = windows[0].Bounds, x = (b.Left + b.Right) / 2, y = (b.Top + b.Bottom) / 2;
  assert.ok(state.Screens.some((screen: Row) => !screen.Primary && x >= screen.Bounds.X && x < screen.Bounds.X + screen.Bounds.Width && y >= screen.Bounds.Y && y < screen.Bounds.Y + screen.Bounds.Height));
  report.window = state; save();
}
async function pageAt(route: string, ready?: (data: Row) => boolean) {
  return waitFor(async () => { const page = await mp.currentPage(); if (page?.path !== route) return null;
    const data = await page.data(); assert.ok(!data.fatal && !data.needsLogin, 'current synthetic identity must remain valid');
    return !data.loading && (!ready || ready(data)) ? page : null; }, route);
}
async function capture(name: string, route: string) {
  await verifyWindow(); const stack = await mp.evaluate(() => getCurrentPages().map(page => page.route));
  assert.equal(stack.at(-1), route); assert.equal((await mp.currentPage())?.path, route);
  const file = path.join(output, name + '.png'); await mp.screenshot({ path: file }); const bytes = fs.readFileSync(file);
  report.captures.push({ name, file, route, stack, logical: [390, 844], encoded: [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] }); save();
}
async function openChat(id: string) { await mp.redirectTo('/packages/assistant/chat/chat?conversationId=' + id); return pageAt('packages/assistant/chat/chat', data => String(data.conversation?.id) === id); }
async function sendText(text: string) {
  const page = await pageAt('packages/assistant/chat/chat'); await (await page.$('.composer-input'))!.input(text); await (await page.$('.send-button'))!.tap();
  await waitFor(async () => { const data = await page.data(); return !data.busy && !data.pendingSend && JSON.stringify(data.messages).includes(text); }, 'actual customer message/readback');
}
async function main() {
  save();
  try {
    release = await lockAssistantAcceptance(process.env.DATABASE_URL!);
    globalThis.fetch = async () => { report.externalCalls++; throw Error('D3 native human path forbids model/embedding/network inference'); };
    await createFixture();
    const beforeLeads = await withTenantTransaction(fixture.enterpriseId, tx => rows(tx, sql`select * from app.leads where enterprise_id=${fixture.enterpriseId} order by id`));
    await step('Stable exact project on the secondary monitor compiles fresh at390x844', async () => {
      await verifyWindow(); let info: Row = {};
      for (let i = 0; i < 2; i++) { await mp.call('simulator_refresh', { project: path.join(root, 'miniprogram') }); await delay(6000);
        try { info = await mp.systemInfo(); const page = await mp.currentPage(); assert.ok(page && Object.keys(await page.data()).length); assert.equal(info.windowWidth, 390); assert.equal(info.windowHeight, 844); break; }
        catch (error) { if (i) throw error; report.initialFrozenRuntime = String(error); }
      }
      report.system = info; return { project: path.join(root, 'miniprogram'), SDKVersion: info.SDKVersion, freshCompile: true };
    });
    server = http.createServer(async (incoming, response) => {
      try {
        assert.ok(tokens.some(token => incoming.headers.authorization === 'Bearer ' + token), 'synthetic native identity required');
        const prefix = '/api/miniprogram/assistant/'; assert.ok(incoming.url?.startsWith(prefix));
        const parts: Buffer[] = []; let size = 0; for await (const part of incoming) { size += part.length; assert.ok(size <= 6 * 1024 * 1024); parts.push(Buffer.from(part)); }
        const request = new Request('http://127.0.0.1:3108' + incoming.url, { method: incoming.method, headers: incoming.headers as HeadersInit,
          ...(['POST','PATCH'].includes(incoming.method || '') ? { body: Buffer.concat(parts).toString('utf8') } : {}) });
        const result = await assistantHttp(request, new URL(request.url).pathname.slice(prefix.length).split('/')), bytes = Buffer.from(await result.arrayBuffer());
        if (incoming.method === 'POST' && incoming.url === prefix + 'conversations' && result.ok) { const data = JSON.parse(bytes.toString()).data; if (!fixture.conversationIds.includes(String(data.id))) fixture.conversationIds.push(String(data.id)); }
        response.writeHead(result.status, Object.fromEntries(result.headers.entries())); response.end(bytes);
      } catch (error) { response.writeHead(500, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: String(error) })); }
    });
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(3108, '127.0.0.1', resolve); });
    const photo = fs.readFileSync(path.join(root, 'tmp/xiaok-vector/renovation-photos/window.jpg'));
    installed = true;
    await mp.evaluate((config: Row) => {
      const app = getApp(); if (Object.keys(app).some(key => /^__qa(?:ReviewNative|Shared|Materials|C05|Synthesis|History|D2|D3)/.test(key))) throw Error('Another native controller is active');
      const state: Row = { request: wx.request, download: wx.downloadFile, get: wx.getStorageSync, set: wx.setStorageSync, remove: wx.removeStorageSync,
        token: app.globalData.token, bootstrap: app.globalData.bootstrap, hydrate: app.hydrateStoredSession, memory: new Map(), requests: [], dropContact: true,
        filePath: wx.env.USER_DATA_PATH + '/qa-d3-' + config.nonce + '.jpg' };
      app.__qaD3 = state; app.hydrateStoredSession = async () => {}; app.globalData.token = config.token;
      app.globalData.bootstrap = { current: { mode: 'customer', role: 'user', context: { enterpriseId: config.enterpriseId } } }; state.memory.set('token', config.token);
      wx.getStorageSync = (key: string) => key.startsWith('assistant-') ? state.memory.get(key) : state.memory.has(key) ? state.memory.get(key) : state.get.call(wx, key);
      wx.setStorageSync = (key: string, value: unknown) => state.memory.set(key, value); wx.removeStorageSync = (key: string) => state.memory.delete(key);
      state.target = (raw: string) => { const index = raw.indexOf('/api/miniprogram/assistant/'); return index < 0 ? null : 'http://127.0.0.1:3108' + raw.slice(index); };
      wx.request = (options: Row) => {
        const url = state.target(String(options.url)); if (!url) { options.fail?.({ errMsg: 'Synthetic-only transport' }); return { abort() {} }; }
        const headers = options.header || options.headers || {}, key = Object.entries(headers).find(([k]) => k.toLowerCase() === 'idempotency-key')?.[1];
        const row: Row = { path: url.slice('http://127.0.0.1:3108'.length), method: options.method || 'GET', idempotencyKey: key }; state.requests.push(row);
        return state.request.call(wx, { ...options, url, success(result: Row) { row.status = result.statusCode;
          if (state.dropContact && row.method === 'POST' && /\/contact$/.test(row.path) && result.statusCode === 200) { state.dropContact = false; row.dropped = true; options.fail?.({ errMsg: 'request:fail simulated response loss' }); return; }
          options.success?.(result); } });
      };
      wx.downloadFile = (options: Row) => { const url = state.target(String(options.url)); if (!url) { options.fail?.({ errMsg: 'Synthetic-only download' }); return { abort() {} }; } return state.download.call(wx, { ...options, url }); };
      wx.getFileSystemManager().writeFileSync(state.filePath, config.photo, 'base64');
    }, { token: tokens[0], enterpriseId: fixture.enterpriseId, photo: photo.toString('base64'), nonce: randomUUID() });
    let firstId = '', mediaId = '';
    await step('signed designer share opens its own studio/work and recovers one actual contact with the original key', async () => {
      await mp.redirectTo(fixture.sharePath); const studio = await pageAt('packages/assistant/designer/designer', data => !!data.featuredWork && Object.keys(data.images || {}).length > 0);
      firstId = String((await studio.data()).conversationId); assert.ok(fixture.conversationIds.includes(firstId));
      await capture('d01-signed-entry', 'packages/assistant/designer/designer'); await (await studio.$('.studio-window'))!.tap();
      const work = await pageAt('packages/assistant/work/work', data => data.work?.id === fixture.workId && Object.keys(data.images || {}).length > 0);
      await mp.pageScrollTo(100000); await delay(250);
      await (await work.$('.secondary-action'))!.tap();
      await waitFor(async () => (await work.data()).pendingAction === 'contact', 'contact response loss retained pending key');
      await mp.pageScrollTo(0); await delay(250);
      await capture('d02-contact-unknown', 'packages/assistant/work/work'); await (await work.$('.notice button'))!.tap();
      const chat = await pageAt('packages/assistant/chat/chat', data => data.conversation?.mode === 'handoff_requested');
      assert.equal(String((await chat.data()).conversation.id), firstId);
      const requests = await mp.evaluate(() => getApp().__qaD3.requests.filter((request: Row) => /\/contact$/.test(request.path)));
      assert.equal(requests.length, 2); assert.ok(requests[0].dropped); assert.equal(requests[0].idempotencyKey, requests[1].idempotencyKey);
      const handoff = await new HandoffWorkflow(customer()).customerRead(firstId);
      assert.equal(handoff.handoff!.contactConsent, false); assert.equal(handoff.handoff!.phone, '');
      assert.equal((handoff.handoff!.source as Row).kind, 'portfolio_content');
      await capture('c01-designer-waiting', 'packages/assistant/chat/chat'); return { conversationId: firstId, contactWrites: 1, originalKeyRecovery: true, phone: 'not shared' };
    });
    await step('waiting customer adds original text/photo; actual designer reads them and replies in the same chat with AI paused', async () => {
      await sendText('这是我新房厨房的窗边，锅具比较多，想先聊聊怎么收纳。');
      const filePath = await mp.evaluate(() => getApp().__qaD3.filePath);
      await mp.mockWxMethod('chooseMedia', { tempFiles: [{ tempFilePath: filePath, size: photo.length, fileType: 'image' }], type: 'image' }); picker = true;
      const page = await pageAt('packages/assistant/chat/chat'); await (await page.$('.media-button[aria-label="本次图片资料"]'))!.tap();
      await waitFor(async () => { const data = await page.data(); return !data.mediaBusy && !data.mediaPending && data.messages.some((item: Row) => item.mediaId); }, 'actual image persisted during waiting');
      await mp.restoreWxMethod('chooseMedia'); picker = false;
      const current = await new HandoffWorkflow(customer()).customerRead(firstId); assert.equal(current.mode, 'handoff_requested');
      const reception = new HandoffService(staff());
      if (staffNative) {
        await mp.evaluate((config: Row) => {
          const app = getApp(); app.globalData.token = config.token; app.__qaD3.memory.set('token', config.token);
          app.globalData.bootstrap = { current: { mode: 'staff', role: 'designer', context: { enterpriseId: config.enterpriseId, staffId: config.staffId, staffRole: 'designer' } } };
        }, { token: tokens[2], enterpriseId: fixture.enterpriseId, staffId: fixture.staffIds[1] });
        await mp.redirectTo('/packages/assistant/handoff/handoff?staff=1');
        const queue = await pageAt('packages/assistant/handoff/handoff', data => data.items.some((item: Row) => item.conversationId === firstId));
        assert.ok(!JSON.stringify((await queue.data()).items).includes('锅具比较多'), 'pre-claim queue is metadata only');
        await capture('s01-queue', 'packages/assistant/handoff/handoff');
        await (await queue.$('.queue-item[data-id="' + firstId + '"]'))!.tap();
        const preview = await pageAt('packages/assistant/handoff/handoff', data => data.detail?.handoff?.state === 'waiting');
        await mp.pageScrollTo(100000); await delay(250); await (await preview.$('.primary[data-action="claim"]'))!.tap();
        const active = await pageAt('packages/assistant/handoff/handoff', data => data.detail?.handoff?.state === 'active' && JSON.stringify(data.messages).includes('锅具比较多'));
        await mp.pageScrollTo(0); await capture('s01-originals', 'packages/assistant/handoff/handoff');
        await (await active.$('.workspace-tabs button[data-tab="media"]'))!.tap();
        const materials = await pageAt('packages/assistant/handoff/handoff', data => data.tab === 'media' && data.mediaItems.length === 1 && Object.keys(data.mediaPaths || {}).length === 1);
        const initialMedia = await materials.data(); mediaId = initialMedia.mediaItems[0].id;
        const initialPath = initialMedia.mediaPaths[mediaId];
        await delay(6500); // Cross two actual HandoffController poll intervals.
        const stableMedia = await materials.data();
        assert.equal(stableMedia.mediaPaths[mediaId], initialPath, 'unchanged authorized photo must survive polling');
        assert.equal(stableMedia.mediaLoading, false); assert.equal(stableMedia.mediaError, '');
        assert.ok(await materials.$('.media-thumb'), 'actual image element must be rendered');
        report.staffMediaStability = { preservedAcrossPolls: true, rendered: true };
        await capture('s01-owned-photo', 'packages/assistant/handoff/handoff');
        await (await materials.$('.workspace-tabs button[data-tab="chat"]'))!.tap();
        const chat = await pageAt('packages/assistant/handoff/handoff', data => data.tab === 'chat');
        await (await chat.$('.reply-input'))!.input('看到你发的窗边照片了，我们先核对水槽和常用锅具的位置。');
        await (await chat.$('.send-button'))!.tap();
        await waitFor(async () => { const data = await chat.data(); return !data.busy && JSON.stringify(data.messages).includes('看到你发的窗边照片了'); }, 'actual S01 reply write');
        await capture('s01-replied', 'packages/assistant/handoff/handoff');
      } else await reception.staffWrite(firstId, randomUUID(), { action: 'claim' });
      const packet = await reception.staffRead(firstId); assert.match(JSON.stringify(packet), /锅具比较多/);
      const media = await new AssistantMediaService(staff()).list(firstId); assert.equal(media.items.length, 1); mediaId = media.items[0].id;
      assert.ok((await new AssistantMediaService(staff()).read(firstId, mediaId)).data.length);
      if (!staffNative) await reception.staffWrite(firstId, randomUUID(), { action: 'reply', text: '看到你发的窗边照片了，我们先核对水槽和常用锅具的位置。' });
      else await mp.evaluate((config: Row) => {
        const app = getApp(); app.globalData.token = config.token; app.__qaD3.memory.set('token', config.token);
        app.globalData.bootstrap = { current: { mode: 'customer', role: 'user', context: { enterpriseId: config.enterpriseId } } };
      }, { token: tokens[0], enterpriseId: fixture.enterpriseId });
      const reopened = await openChat(firstId); const data = await reopened.data(); assert.equal(data.conversation.mode, 'human');
      assert.match(JSON.stringify(data.messages), /看到你发的窗边照片了/); await capture('c01-human-reentry', 'packages/assistant/chat/chat');
      return { actualMessage: true, actualMedia: mediaId, staffReadAndReply: true, staffNative, sameConversation: true, mode: 'human' };
    });
    await step('a separate company-channel customer can wait and cancel without a phone or another customer materials', async () => {
      await mp.evaluate((config: Row) => { const app = getApp(); app.globalData.token = config.token; app.__qaD3.memory.set('token', config.token); }, { token: tokens[1] });
      await mp.redirectTo('/packages/assistant/chat/chat?publicEnterpriseId=' + fixture.enterpriseId);
      const page = await pageAt('packages/assistant/chat/chat'); await (await page.$('.designer-entry'))!.tap();
      const waiting = await pageAt('packages/assistant/chat/chat', data => data.conversation?.mode === 'handoff_requested'), id = String((await waiting.data()).conversation.id);
      assert.notEqual(id, firstId); await sendText('我想先聊厨房收纳，暂时不留电话。');
      const view = await waiting.data(); assert.ok(!JSON.stringify(view.messages).includes('这是我新房厨房的窗边'));
      const current = await new HandoffWorkflow(customer(1)).customerRead(id);
      assert.equal((current.handoff!.source as Row).kind, 'public_site_entry'); assert.equal(current.handoff!.contactConsent, false); assert.equal(current.handoff!.phone, '');
      await capture('c01-company-waiting', 'packages/assistant/chat/chat');
      await mp.mockWxMethod('showModal', { confirm: true, cancel: false }); modal = true;
      await (await waiting.$('.conversation-tools .text-action'))!.tap();
      await waitFor(async () => (await waiting.data()).conversation?.mode === 'ai', 'actual cancel returns to AI mode');
      await mp.restoreWxMethod('showModal'); modal = false;
      const reentry = await openChat(id); assert.equal((await reentry.data()).conversation.mode, 'ai');
      await capture('c01-company-cancelled', 'packages/assistant/chat/chat');
      return { conversationId: id, channel: 'public_site_entry', noPhone: true, cancelledAndReentered: true, platformConfirmation: 'DevTools showModal response stub; actual button/service write' };
    });
    await step('withdrawn publication and revoked staff identity lose media access without changing leads or commissions', async () => {
      const owner = new PortfolioService({ enterpriseId: fixture.enterpriseId, adminId: fixture.staffIds[0] });
      const detail = await owner.execute('detail', { workId: fixture.workId }); await owner.execute('withdraw', { workId: fixture.workId, expectedVersion: (detail.work as Row).version }, randomUUID());
      await mp.evaluate((config: Row) => { const app = getApp(); app.globalData.token = config.token; app.__qaD3.memory.set('token', config.token); }, { token: tokens[0] });
      await mp.redirectTo('/packages/assistant/work/work?conversationId=' + firstId + '&workId=' + fixture.workId + '&versionId=' + fixture.versionId);
      const unavailable = await pageAt('packages/assistant/work/work', data => data.unavailable); assert.deepEqual((await unavailable.data()).images, {});
      await capture('d02-withdrawn', 'packages/assistant/work/work');
      await withTenantTransaction(fixture.enterpriseId, async tx => tx.execute(sql`update app.admin_users set status='disabled' where id=${fixture.staffIds[1]}`));
      await assert.rejects(new HandoffService(staff()).staffRead(firstId), /assistant_capability_forbidden|assistant_resource_not_found/);
      await assert.rejects(new AssistantMediaService(staff()).read(firstId, mediaId), /assistant_capability_forbidden|assistant_resource_not_found/);
      if (staffNative) {
        await mp.evaluate((config: Row) => {
          const app = getApp(); app.globalData.token = config.token; app.__qaD3.memory.set('token', config.token);
          app.globalData.bootstrap = { current: { mode: 'staff', role: 'designer', context: { enterpriseId: config.enterpriseId, staffId: config.staffId } } };
        }, { token: tokens[2], enterpriseId: fixture.enterpriseId, staffId: fixture.staffIds[1] });
        await mp.redirectTo('/packages/assistant/handoff/handoff?staff=1&conversationId=' + firstId);
        await waitFor(async () => { const page = await mp.currentPage(); if (page?.path !== 'packages/assistant/handoff/handoff') return false;
          const data = await page.data(); return data.fatal && !data.detail && !Object.keys(data.mediaPaths || {}).length; }, 'S01 revoked identity clears private content');
        await capture('s01-revoked', 'packages/assistant/handoff/handoff');
      }
      await assert.rejects(new ConversationService(customer(2)).detail(firstId), /assistant_resource_not_found/);
      const afterLeads = await withTenantTransaction(fixture.enterpriseId, tx => rows(tx, sql`select * from app.leads where enterprise_id=${fixture.enterpriseId} order by id`));
      assert.equal(fingerprint(afterLeads), fingerprint(beforeLeads));
      const attempts = await withTenantTransaction(fixture.enterpriseId, tx => rows(tx, sql`select id from app.ai_provider_attempts where enterprise_id=${fixture.enterpriseId}`));
      assert.equal(attempts.length, 0); assert.equal(report.externalCalls, 0);
      return { publication: 'unavailable', staffAndOtherCustomer: 'denied', originalLeadsAndAssignmentCommissionFields: 'unchanged', providerAttempts: 0 };
    });
    report.passed = true;
  } catch (error) { report.error = String((error as Error).stack || error); process.exitCode = 1; }
  finally {
    const errors: string[] = [];
    try { if (picker) await mp.restoreWxMethod('chooseMedia'); if (modal) await mp.restoreWxMethod('showModal'); } catch (error) { errors.push(String(error)); }
    try { if (installed) report.restoration = await mp.evaluate(() => {
      const app = getApp(), state = app.__qaD3; if (!state) return { restored: false };
      wx.request = state.request; wx.downloadFile = state.download; wx.getStorageSync = state.get; wx.setStorageSync = state.set; wx.removeStorageSync = state.remove;
      app.globalData.token = state.token; app.globalData.bootstrap = state.bootstrap; app.hydrateStoredSession = state.hydrate;
      try { wx.getFileSystemManager().unlinkSync(state.filePath); } catch { /* Already removed. */ }
      delete app.__qaD3; return { restored: true, requests: state.requests };
    }); } catch (error) { errors.push(String(error)); }
    try { if (installed) await mp.reLaunch('/pages/index/index'); await mp.disconnect(); } catch (error) { errors.push(String(error)); }
    try { if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); } } catch (error) { errors.push(String(error)); }
    try { if (fixture.enterpriseId) await withPlatformTransaction(async tx => {
      await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${fixture.enterpriseId}`);
      await tx.execute(sql`update app.assistant_jobs set status='cancelled',lease_token=null,lease_expires_at=null where enterprise_id=${fixture.enterpriseId} and status in ('queued','running')`);
      await tx.execute(sql`update app.assistant_runs set status='cancelled',updated_at=now() where enterprise_id=${fixture.enterpriseId} and status in ('queued','running')`);
      for (const uid of fixture.userIds) await tx.execute(sql`update app.users set context_version=context_version+1 where id=${uid}`);
      for (const aid of fixture.staffIds) await tx.execute(sql`update app.admin_users set status='disabled' where id=${aid}`);
    }); report.fixtureCleaned = !!fixture.enterpriseId; } catch (error) { errors.push(String(error)); }
    if (previousRollout === undefined) delete process.env.ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS; else process.env.ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS = previousRollout;
    globalThis.fetch = previousFetch;
    try { if (release) await release(); await closePostgresPool(); } catch (error) { errors.push(String(error)); }
    report.requests = report.restoration?.requests || []; report.fixture = { ...fixture, sharePath: undefined };
    report.after = binding(); report.drift = Object.keys(report.before).filter(file => report.before[file] !== report.after[file]); report.cleanupErrors = errors;
    if (errors.length || report.drift.length) { report.passed = false; process.exitCode = 1; }
    save(); console.log(JSON.stringify({ output, passed: report.passed, checks: report.checks.length, captures: report.captures.length, error: report.error ?? null, drift: report.drift, cleanupErrors: errors }));
  }
}
void main();
