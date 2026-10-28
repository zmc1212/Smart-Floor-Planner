/* eslint-disable @typescript-eslint/no-explicit-any -- Native SDK payloads and isolated fixture DTOs. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import cp from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { loadEnvConfig } from '@next/env';
import { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { rows } from '@/db/repositories/assistant-repository';
import { withTenantTransaction } from '@/db/transaction';
import { closePostgresPool } from '@/lib/postgresql';
import { assistantHttp } from '@/lib/assistant/application/http';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { processSiteRecord } from '@/lib/construction/site-worker';
import { deliverSiteNotifications } from '@/lib/construction/site-publications';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
import { D4SharingFixture } from './assistant-d4-sharing-fixture';
import { wechatideNativeClient } from './wechatide-native-client';

type Row = Record<string, any>;
declare const wx: Row;
declare function getApp(): Row;
declare function getCurrentPages(): Row[];
const admin = process.cwd(), root = path.dirname(admin); loadEnvConfig(admin, true);
process.env.DATABASE_URL = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, '')).DATABASE_URL;
const name = process.argv[2]; assert.match(name, /^d4-watch-native-[a-z0-9-]+$/);
const output = path.join(root, 'tmp', name); fs.mkdirSync(output);
const project = path.join(root, 'miniprogram'), mp = wechatideNativeClient(project, output), f = new D4SharingFixture();
const execFile = promisify(cp.execFile), originalFetch = globalThis.fetch;
const report: Row = { delivery: 'D4', scope: 'Deterministic natural watch clarification/cancel through existing C01 and real isolated HTTP/database/publication services; no model-semantic or image interpretation claim', started: new Date().toISOString(), checks: [], captures: [], providerCalls: 0, passed: false };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const binding = () => {
  const files: string[] = [];
  for (const dir of ['admin/src/lib/assistant', 'admin/src/lib/construction', 'admin/src/db', 'miniprogram/packages/assistant', 'miniprogram/packages/construction']) {
    const walk = (folder: string) => { for (const item of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
      const file = folder + '/' + item.name; if (item.isDirectory()) walk(file); else if (/\.(ts|js|json|less|wxml)$/.test(file)) files.push(file);
    } }; walk(dir);
  }
  files.push('admin/scripts/assistant-site-watch-native.ts', 'admin/scripts/assistant-site-watch-native.mjs', 'admin/scripts/assistant-d4-sharing-fixture.ts',
    'admin/scripts/wechatide-native-client.ts', 'admin/scripts/wechatide-window-state.ps1', 'admin/scripts/assistant-acceptance-safety.mjs', 'admin/scripts/assistant-d4-runtime-config.mjs',
    'admin/src/lib/miniprogram-jwt.ts', 'admin/src/lib/miniprogram-auth.ts', 'admin/src/lib/miniprogram-identity-context.ts', 'admin/src/lib/admin-user-roles.ts',
    'tmp/wechat-devtools-version-test/window.ps1', 'admin/package-lock.json', 'admin/.env.local', 'miniprogram/utils/api.js', 'tmp/xiaok-vector/connection.private.json', path.relative(root, process.env.TSX_TSCONFIG_PATH!));
  return Object.fromEntries([...new Set(files)].map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
};
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until<T>(read: () => Promise<T>, label: string) {
  const end = Date.now() + 45000;
  while (Date.now() < end) { const value = await read(); if (value) return value; await delay(300); }
  throw Error('Native watch timeout: ' + label);
}
async function pageAt() {
  return until(async () => { const page = await mp.currentPage(); if (page?.path !== 'packages/assistant/chat/chat') return null;
    const d = await page.data(); assert.ok(!d.fatal && !d.needsLogin); return !d.loading ? page : null; }, 'C01 live page');
}
async function send(text: string, lost = false) {
  const page = await pageAt(); await until(async () => { const d = await page.data(); return d.canSend && !d.busy && !d.pendingSend && !d.generating; }, 'composer ready');
  const old = new Set((await page.data()).messages.map((m: Row) => String(m.id)));
  await (await page.$('.composer-input'))!.input(text);
  await until(async () => (await page.data()).draft === text, 'actual input');
  if (lost) await mp.evaluate(() => { getApp().__qaD4Watch.drop = true; });
  await (await page.$('.send-button'))!.tap();
  if (lost) {
    await until(async () => (await page.data()).pendingSend, 'original key retained');
    await (await page.$('.pending-message button'))!.tap();
  }
  await until(async () => { const d = await page.data(); return !d.busy && !d.pendingSend && !d.generating
    && d.messages.some((m: Row) => !old.has(String(m.id)) && (m.isUser || m.authorKind === 'user') && m.content?.blocks?.some((b: Row) => b.text === text)); }, 'new persisted message and feedback');
}
const watches = () => withTenantTransaction(f.eid, tx => rows(tx, sql`select id::text,active,room_id::text from app.construction_watches where enterprise_id=${f.eid}`));
async function publish() {
  const bytes = await sharp({ create: { width: 48, height: 40, channels: 3, background: '#427511' } }).jpeg().toBuffer();
  const media = await f.site().upload(f.projectId, randomUUID(), bytes);
  const sent = await f.site().send(f.projectId, { text: '书房线管已经铺好，底盒还等设计师核对。', mediaIds: [String(media.id)] }, randomUUID());
  const lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
  await processSiteRecord(lease!, async () => ({ text: JSON.stringify({ title: '书房施工进展', roomId: f.roomId, completed: '线管已经铺好', pending: '底盒还等设计师核对', coordination: '', note: '' }), toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 } }));
  const record = ((await f.site().read(f.projectId)).items as Row[]).find(i => i.record.id === sent.recordId)!.record as Row;
  await f.site().mutate(f.projectId, String(sent.recordId), 'publish', { expectedVersion: record.version, audience: 'customer' }, randomUUID());
  await deliverSiteNotifications(); return String(sent.recordId);
}
async function capture(label: string) {
  assert.equal((await mp.currentPage())?.path, 'packages/assistant/chat/chat');
  const stack = await mp.evaluate(() => getCurrentPages().map(p => p.route)); assert.equal(stack.at(-1), 'packages/assistant/chat/chat');
  const file = path.join(output, label + '.png'); await mp.screenshot({ path: file }); const bytes = fs.readFileSync(file);
  const data = await (await mp.currentPage())!.data();
  report.captures.push({ file, route: stack.at(-1), conversationId: data.conversation?.id || null, stack, logical: [390, 844], encoded: [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] }); save();
}
let release: (() => Promise<void>) | undefined, server: http.Server | undefined, installed = false;
async function main() {
  report.imported = binding(); save();
  try {
    release = await lockAssistantAcceptance(process.env.DATABASE_URL!, { waitForLock: true });
    assert.deepEqual(binding(), report.imported, 'Source changed while waiting for native lock');
    report.exactProjectRead = { project, result: await mp.call('automation_runtime_info', { project, action: 'systemInfo' }) };
    const placement = await execFile('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe',
      ['-NoProfile', '-File', path.join(root, 'tmp/wechat-devtools-version-test/window.ps1'), '-Action', 'Place', '-IncludeHidden'], { windowsHide: true, timeout: 10000 });
    report.placement = JSON.parse(placement.stdout.replace(/^\uFEFF/, '')); assert.equal(report.placement.ProjectWindows, 1); assert.equal(report.placement.OnSecondary, true);
    const state = await execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'admin/scripts/wechatide-window-state.ps1')], { windowsHide: true, timeout: 10000 });
    report.window = JSON.parse(state.stdout.replace(/^\uFEFF/, '')); const windows = report.window.Windows.filter((w: Row) => ['miniprogram', 'WeChat Web Devtools'].includes(w.Title));
    assert.equal(windows.length, 1, 'One verified project window required'); const b = windows[0].Bounds;
    assert.ok(report.window.Screens.some((s: Row) => !s.Primary && b.Left >= s.Bounds.Left && b.Right <= s.Bounds.Right && b.Top >= s.Bounds.Top && b.Bottom <= s.Bounds.Bottom), 'Project window must be on secondary monitor');
    for (let attempt = 0; attempt < 2; attempt++) {
      try { report.compilation = await mp.call('simulator_refresh', { project }); await delay(5000);
        const info = await mp.systemInfo(); assert.equal(info.windowWidth, 390); assert.equal(info.windowHeight, 844);
        assert.ok(Object.keys((await mp.currentPage()) ? await (await mp.currentPage())!.data() : {}).length); report.system = info; break;
      } catch (error) { report.initialFrozen = String(error); if (attempt) throw error; }
    }
    report.before = binding(); save();
    await f.create({ runtime: 'langgraph-v1', providerKey: 'deepseek', model: 'deepseek-flash', tools: true, imageInput: true, probeVersion: 'watch-native-no-provider' });
    const token = await signMiniProgramToken({ sub: f.userIds[0], id: f.userIds[0], contextVersion: 1, mode: 'customer', role: 'user', enterpriseId: f.eid, source: 'wechat' });
    globalThis.fetch = async (input, init) => { const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url);
      assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'No external model/network in deterministic acceptance'); return originalFetch(input, init); };
    server = http.createServer(async (incoming, response) => {
      try {
        assert.equal(incoming.headers.authorization, 'Bearer ' + token);
        const parts: Buffer[] = []; for await (const chunk of incoming) parts.push(Buffer.from(chunk));
        const request = new NextRequest('http://127.0.0.1:3116' + incoming.url, { method: incoming.method, headers: incoming.headers as HeadersInit,
          ...(incoming.method === 'POST' ? { body: new Uint8Array(Buffer.concat(parts)) } : {}) });
        const pathname = new URL(request.url).pathname; assert.ok(pathname.startsWith('/api/miniprogram/assistant/'));
        const result = await assistantHttp(request, pathname.slice('/api/miniprogram/assistant/'.length).split('/'));
        const bytes = Buffer.from(await result.arrayBuffer());
        if (result.ok && incoming.method === 'POST' && /\/messages$/.test(pathname)) assert.equal(JSON.parse(bytes.toString()).data.runId, null, 'Watch command must not schedule model inference');
        response.writeHead(result.status, Object.fromEntries(result.headers.entries())); response.end(bytes);
      } catch (error) { report.bridgeError = String(error); if (!response.writableEnded) { response.writeHead(500, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: String(error) })); } }
    });
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(3116, '127.0.0.1', resolve); });
    await mp.evaluate((c: Row) => {
      const app = getApp(); if (Object.keys(app).some(k => /^__qa/.test(k))) throw Error('Another native controller owns the runtime');
      const state: Row = { request: wx.request, download: wx.downloadFile, get: wx.getStorageSync, set: wx.setStorageSync, remove: wx.removeStorageSync,
        token: app.globalData.token, bootstrap: app.globalData.bootstrap, hydrate: app.hydrateStoredSession, memory: new Map(), requests: [], drop: false };
      app.__qaD4Watch = state; app.hydrateStoredSession = async () => {};
      state.memory.set('token', c.token); app.globalData.token = c.token;
      app.globalData.bootstrap = { current: { mode: 'customer', role: 'user', capabilities: ['customer.service', 'customer.projects', 'account'], context: { enterpriseId: c.eid } } };
      wx.getStorageSync = (key: string) => key.startsWith('assistant-') ? state.memory.get(key) : state.memory.has(key) ? state.memory.get(key) : state.get.call(wx, key);
      wx.setStorageSync = (key: string, value: unknown) => state.memory.set(key, value); wx.removeStorageSync = (key: string) => state.memory.delete(key);
      wx.request = (o: Row) => { const i = String(o.url).indexOf('/api/miniprogram/assistant/');
        if (i < 0) { o.fail?.({ errMsg: 'Synthetic-only transport' }); return { abort() {} }; }
        const headers = o.header || o.headers || {}, row: Row = { path: String(o.url).slice(i), method: o.method || 'GET', key: Object.entries(headers).find(([key]) => key.toLowerCase() === 'idempotency-key')?.[1] }; state.requests.push(row);
        return state.request.call(wx, { ...o, url: 'http://127.0.0.1:3116' + row.path, success(r: Row) { row.status = r.statusCode;
          if (state.drop && row.method === 'POST' && /\/messages$/.test(row.path) && r.statusCode >= 200 && r.statusCode < 300) { state.drop = false; row.dropped = true; o.fail?.({ errMsg: 'request:fail simulated response loss' }); return; } o.success?.(r); } });
      };
      wx.downloadFile = (o: Row) => { const i = String(o.url).indexOf('/api/miniprogram/assistant/');
        if (i < 0) { o.fail?.({ errMsg: 'Synthetic-only download' }); return { abort() {} }; }
        const row: Row = { path: String(o.url).slice(i), method: 'DOWNLOAD' }; state.requests.push(row);
        return state.download.call(wx, { ...o, url: 'http://127.0.0.1:3116' + row.path, success(r: Row) { row.status = r.statusCode; o.success?.(r); } });
      };
    }, { token, eid: f.eid });
    installed = true;
    const enter = async (conversationId = f.conversationId) => { await mp.redirectTo('/packages/assistant/chat/chat?conversationId=' + conversationId); return pageAt(); };
    await enter(); await send('测试工地甲书房和客厅有新照片告诉我');
    assert.equal((await watches()).length, 0); await capture('clarification');
    await enter(); assert.ok(JSON.stringify((await (await pageAt()).data()).messages).includes('想关注哪个房间'));
    await send('就书房吧', true); const list = await watches(); assert.equal(list.length, 1); assert.equal(list[0].room_id, f.roomId); assert.ok(list[0].active);
    report.checks.push('Clarification, persisted reentry, real colloquial input, lost HTTP receipt and same-key recovery create one photo watch'); await capture('subscribed');
    const newer = String((await f.chat.create(randomUUID())).id); report.newerConversationId = newer;
    await enter(newer); await mp.reLaunch('/pages/index/index'); const recordId = await publish(); await enter(newer);
    const newerData = await (await pageAt()).data(); assert.equal(String(newerData.conversation.id), newer);
    assert.ok(!newerData.messages.some((m: Row) => (m.siteRecordList || []).some((r: Row) => String(r.id) === recordId)));
    assert.ok(!(await f.chat.messages(newer)).items.some(m => (m.siteRecord as Row)?.id === recordId));
    report.checks.push('A newer same-customer consultation neither steals the original offline notice nor consumes it on reentry');
    await capture('newer-consultation-no-notice'); await enter();
    assert.equal((await f.chat.messages(f.conversationId)).items.filter(m => (m.siteRecord as Row)?.id === recordId).length, 1);
    await until(async () => { const page = await pageAt(), data = await page.data();
      return !data.siteRecordError && Object.keys(data.siteRecordPaths || {}).some(key => key.startsWith(recordId + '_')) && await page.$('.site-record-photos .message-photo');
    }, 'authenticated original photo downloaded and rendered');
    await capture('published-reentry');
    report.checks.push('Real reviewed photo publication while C01 is closed delivers once; original media downloads and renders after reentry');
    await send('不用提醒了'); assert.ok((await watches()).every(w => !w.active)); await capture('cancelled');
    await mp.reLaunch('/pages/index/index'); const later = await publish(); await enter();
    assert.ok(!(await f.chat.messages(f.conversationId)).items.some(m => (m.siteRecord as Row)?.id === later));
    assert.ok(!(await (await pageAt()).data()).messages.some((m: Row) => m.siteWatch));
    report.checks.push('Natural cancellation persists, hides its action and blocks the next offline publication');
    await send('测试工地甲书房有新照片告诉我');
    const page = await pageAt(), watchMessage = (await page.data()).messages.findLast((m: Row) => m.siteWatch);
    assert.ok(watchMessage); await (await page.$(`button.notice-action[data-message="${watchMessage.id}"]`))!.tap();
    await until(async () => (await watches()).every(w => !w.active), 'existing cancel button');
    report.checks.push('Existing approved cancel action still works after resubscription');
    report.passed = true;
  } catch (error) { report.error = String((error as Error).stack || error); }
  finally {
    const errors: string[] = [];
    try { if (installed) { await mp.reLaunch('/pages/index/index'); report.restoration = await mp.evaluate(() => {
      const app = getApp(), s = app.__qaD4Watch; if (!s) return { restored: false };
      wx.request = s.request; wx.downloadFile = s.download; wx.getStorageSync = s.get; wx.setStorageSync = s.set; wx.removeStorageSync = s.remove;
      app.globalData.token = s.token; app.globalData.bootstrap = s.bootstrap; app.hydrateStoredSession = s.hydrate; delete app.__qaD4Watch;
      return { restored: true, requests: s.requests };
    }); } } catch (e) { errors.push(String(e)); }
    globalThis.fetch = originalFetch;
    try { if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); } } catch (e) { errors.push(String(e)); }
    try { if (f.eid) { fs.writeFileSync(path.join(output, 'fixture.json'), JSON.stringify({ ...(await f.snapshot()), watches: await watches() }, null, 2)); await f.cleanup(); report.fixtureCleaned = true; } } catch (e) { errors.push(String(e)); }
    report.after = binding(); report.drift = Object.keys(report.imported).filter(file => report.after[file] !== report.imported[file]);
    report.cleanupErrors = errors; report.finished = new Date().toISOString();
    report.passed = report.passed && !errors.length && !report.drift.length && report.restoration?.restored && !report.bridgeError;
    save(); await release?.(); await closePostgresPool(); process.exitCode = report.passed ? 0 : 1;
    console.log(JSON.stringify({ passed: report.passed, checks: report.checks, captures: report.captures.length, drift: report.drift, cleanupErrors: errors, error: report.error, output }));
  }
}
void main();
