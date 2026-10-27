/* eslint-disable @typescript-eslint/no-explicit-any -- Stable DevTools RPC and Mini runtime objects. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import cp from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { assistantHttp } from '@/lib/assistant/application/http';
import { wechatideNativeClient } from './wechatide-native-client';

type Row = Record<string, any>;
declare const wx: Row;
declare function getApp(): Row;
declare function getCurrentPages(): Row[];
const execFile = promisify(cp.execFile);
const route = 'packages/assistant/chat/chat';
const apiOrigin = 'http://127.0.0.1:3108';
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor<T>(read: () => Promise<T>, label: string) {
  for (let attempt = 0; attempt < 50; attempt++) { const value = await read(); if (value) return value; await delay(200); }
  throw Error('Native timeout: ' + label);
}

/** Runs under the caller's existing acceptance lock and synthetic fixture.
 * Only file-picker/response-loss edges are mocked; writes use actual HTTP.
 * Worker output is deterministic and is never model-semantic evidence. */
export async function nativeImageAcceptance(input: {
  root: string; output: string; enterpriseId: string; conversationId: string; token: string; bytes: Buffer;
  runWorker(images: number, claims?: boolean): Promise<unknown>;
  record(name: string, work: () => Promise<unknown>): Promise<void>;
}) {
  const nativeOutput = path.join(input.output, 'native'); fs.mkdirSync(nativeOutput, { recursive: true });
  const project = path.join(input.root, 'miniprogram');
  const mp = wechatideNativeClient(project, nativeOutput);
  const report: Row = { project, controller: 'Stable registered CLI; deterministic Worker', checks: [], captures: [], requests: [] };
  const save = () => fs.writeFileSync(path.join(nativeOutput, 'report.json'), JSON.stringify(report, null, 2));
  let installed = false, server: http.Server | undefined, picker = false;
  const imageName = 'qa-d2-' + randomUUID() + '.jpg';
  async function verifyWindow() {
    const result = await execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(input.root, 'admin/scripts/wechatide-window-state.ps1')], { windowsHide: true, timeout: 10000 });
    const state = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
    const windows = state.Windows.filter((item: Row) => item.Title === 'WeChat Web Devtools');
    assert.equal(windows.length, 1, 'one existing Stable project window');
    const b = windows[0].Bounds, cx = (b.Left + b.Right) / 2, cy = (b.Top + b.Bottom) / 2;
    const screen = state.Screens.find((item: Row) => cx >= item.Bounds.X && cx < item.Bounds.X + item.Bounds.Width
      && cy >= item.Bounds.Y && cy < item.Bounds.Y + item.Bounds.Height);
    assert.ok(screen && !screen.Primary, 'verified project window remains on the secondary monitor');
    report.window = state; save(); return { secondaryMonitor: true, windowCount: 1 };
  }
  async function open() {
    await mp.redirectTo('/' + route + '?conversationId=' + input.conversationId);
    return waitFor(async () => {
      const page = await mp.currentPage(); if (!page || page.path !== route) return null;
      const data = await page.data(); assert.ok(!data.fatal, JSON.stringify({ fatal: data.fatal, error: data.error }));
      return !data.loading ? page : null;
    }, 'actual C01 route loaded');
  }
  async function capture(name: string) {
    await verifyWindow();
    const page = await mp.currentPage(), stack = await mp.evaluate(() => getCurrentPages().map(page => page.route));
    assert.equal(page?.path, route); assert.equal(stack.at(-1), route);
    const file = path.join(nativeOutput, name + '.png'); await mp.screenshot({ path: file });
    const bytes = fs.readFileSync(file); assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    const item = { name, file, route, stack, logical: [390, 844], encoded: [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] };
    report.captures.push(item); save(); return item;
  }
  async function sendText(text: string) {
    const page = await open();
    const before = await mp.evaluate(() => getApp().__qaD2.requests.filter((r: Row) => r.method === 'POST' && r.path.endsWith('/messages')).length);
    await (await page.$('.composer-input'))!.input(text);
    await (await page.$('.send-button'))!.tap();
    await waitFor(async () => {
      const requests = await mp.evaluate(() => getApp().__qaD2.requests.filter((r: Row) => r.method === 'POST' && r.path.endsWith('/messages')));
      return requests.length === before + 1 && requests.at(-1).status === 202;
    }, 'this exact C01 message service write');
  }
  try {
    await input.record('Stable secondary window, exact project, fresh compile and live 390x844 runtime', async () => {
      await verifyWindow();
      let system: Row | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        await mp.call('simulator_refresh', { project }); await delay(6000);
        try {
          const liveSystem = await mp.systemInfo(); system = liveSystem; const page = await mp.currentPage();
          assert.ok(page && Object.keys(await page.data()).length);
          assert.equal(liveSystem.windowWidth, 390); assert.equal(liveSystem.windowHeight, 844); assert.equal(liveSystem.SDKVersion, '3.17.2');
          report.compileAttempts = attempt + 1; break;
        } catch (error) { if (attempt === 1) throw error; report.initialRuntimeError = String(error); }
      }
      report.system = system; return { project, SDKVersion: system!.SDKVersion, logical: [390, 844], freshCompile: true };
    });
    server = http.createServer(async (incoming, response) => {
      try {
        const prefix = '/api/miniprogram/assistant/';
        if (!incoming.url?.startsWith(prefix)) { response.writeHead(404); response.end(); return; }
        const parts: Buffer[] = []; let size = 0;
        for await (const part of incoming) { size += part.length; assert.ok(size <= 6 * 1024 * 1024); parts.push(Buffer.from(part)); }
        const request = new Request(apiOrigin + incoming.url, { method: incoming.method, headers: incoming.headers as HeadersInit,
          ...(['POST', 'PATCH'].includes(incoming.method || '') ? { body: Buffer.concat(parts).toString('utf8') } : {}) });
        const result = await assistantHttp(request, new URL(request.url).pathname.slice(prefix.length).split('/'));
        response.writeHead(result.status, Object.fromEntries(result.headers.entries())); response.end(Buffer.from(await result.arrayBuffer()));
      } catch (error) { response.writeHead(500, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: String(error) })); }
    });
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(3108, '127.0.0.1', resolve); });
    installed = true;
    await mp.evaluate((config: Row) => {
      const app = getApp();
      if (Object.keys(app).some(key => /^__qa(?:ReviewNative|Shared|Materials|C05|Synthesis|History|D2)/.test(key))) throw Error('Another native controller is active');
      const state: Row = { request: wx.request, download: wx.downloadFile, get: wx.getStorageSync, set: wx.setStorageSync, remove: wx.removeStorageSync,
        token: app.globalData.token, bootstrap: app.globalData.bootstrap, hydrate: app.hydrateStoredSession,
        memory: new Map(), requests: [], dropUpload: true, filePath: wx.env.USER_DATA_PATH + '/' + config.imageName };
      app.__qaD2 = state; app.hydrateStoredSession = async () => {};
      app.globalData.token = config.token; app.globalData.bootstrap = { current: { mode: 'customer', role: 'user', context: { enterpriseId: config.enterpriseId } } };
      state.memory.set('token', config.token);
      wx.getStorageSync = (key: string) => key === 'assistant-pending-v1' ? state.memory.get(key) : state.memory.has(key) ? state.memory.get(key) : state.get.call(wx, key);
      wx.setStorageSync = (key: string, value: unknown) => state.memory.set(key, value);
      wx.removeStorageSync = (key: string) => state.memory.delete(key);
      state.target = (raw: string) => {
        const index = raw.indexOf('/api/'), full = index < 0 ? '' : raw.slice(index), clean = full.split('?')[0];
        const base = '/api/miniprogram/assistant', conversation = base + '/conversations/' + config.conversationId;
        if (!(clean === base + '/entry-context' || clean === base + '/conversations' || clean === conversation
          || clean.startsWith(conversation + '/') || /^\/api\/miniprogram\/assistant\/runs\/\d+(?:\/(?:retry|cancel))?$/.test(clean))) return null;
        return { url: config.apiOrigin + full, clean, conversation };
      };
      wx.request = (options: Row) => {
        const to = state.target(String(options.url)); if (!to) { options.fail?.({ errMsg: 'Synthetic-only transport refused request' }); return { abort() {} }; }
        const headers = options.header || options.headers || {}, key = Object.entries(headers).find(([name]) => name.toLowerCase() === 'idempotency-key')?.[1];
        const row: Row = { path: to.clean, method: options.method || 'GET', idempotencyKey: key ?? null, status: null, dropped: false };
        state.requests.push(row);
        return state.request.call(wx, { ...options, url: to.url, success(result: Row) {
          row.status = result.statusCode;
          if (state.dropUpload && row.path === to.conversation + '/media' && row.method === 'POST' && result.statusCode === 200) {
            state.dropUpload = false; row.dropped = true; options.fail?.({ errMsg: 'request:fail simulated response loss' }); return;
          }
          options.success?.(result);
        } });
      };
      wx.downloadFile = (options: Row) => { const to = state.target(String(options.url));
        if (!to) { options.fail?.({ errMsg: 'Synthetic-only download refused request' }); return { abort() {} }; }
        return state.download.call(wx, { ...options, url: to.url }); };
      wx.getFileSystemManager().writeFileSync(state.filePath, config.data, 'base64');
      return { installed: true, credentialsPersisted: false, filePath: state.filePath };
    }, { enterpriseId: input.enterpriseId, conversationId: input.conversationId, token: input.token,
      apiOrigin, imageName, data: input.bytes.toString('base64') });
    const filePath = await mp.evaluate(() => getApp().__qaD2.filePath);
    await mp.mockWxMethod('chooseMedia', { tempFiles: [{ tempFilePath: filePath, size: input.bytes.length, fileType: 'image' }], type: 'image' }); picker = true;
    await input.record('C01 actual image button uploads; lost response recovers the same key without duplicating media or job', async () => {
      await sendText('想把厨房的收纳安排得顺手些。');
      await input.runWorker(0, true);
      const page = await open(); const button = await page.$('.media-button[aria-label="本次图片资料"]'); assert.ok(button);
      await button.tap();
      await waitFor(async () => { const data = await page.data(); return data.mediaPending && !data.mediaBusy; }, 'uncertain image upload');
      const retry = await page.$('.composer-dock .notice-action'); assert.ok(retry); await retry.tap();
      await waitFor(async () => { const data = await page.data(); return !data.mediaPending && !data.mediaBusy; }, 'same-key image recovery');
      const requests = await mp.evaluate(() => getApp().__qaD2.requests);
      const uploads = requests.filter((request: Row) => request.method === 'POST' && request.path.endsWith('/media'));
      assert.equal(uploads.length, 2); assert.equal(uploads[0].dropped, true); assert.equal(uploads[0].idempotencyKey, uploads[1].idempotencyKey);
      await input.runWorker(1, true); const reopened = await open();
      const data = await reopened.data(); assert.ok(data.messages.some((message: Row) => message.mediaId && message.mediaAvailable));
      assert.match(JSON.stringify(data.messages), /合成测试答复/); await capture('c01-upload-recovery');
      return { uploads: 2, sameKey: true, actualPixels: true, persisted: true, priorTextClaimsPreserved: true };
    });
    await input.record('C01 actual follow-up input and persisted reentry reuse the authorized image', async () => {
      await sendText('换到窗边的话，收纳安排有什么要注意的？');
      await input.runWorker(1, true); const reopened = await open();
      assert.match(JSON.stringify((await reopened.data()).messages), /换到窗边的话/);
      await capture('c01-image-followup'); return { actualInput: true, actualWrite: true, reentry: true };
    });
    report.passed = true;
  } catch (error) { report.error = String((error as Error).stack || error); throw error; }
  finally {
    const errors: string[] = [];
    try { if (picker) await mp.restoreWxMethod('chooseMedia'); } catch (error) { errors.push(String(error)); }
    try { if (installed) report.restoration = await mp.evaluate(() => {
      const app = getApp(), state = app.__qaD2; if (!state) return { restored: false };
      wx.request = state.request; wx.downloadFile = state.download; wx.getStorageSync = state.get; wx.setStorageSync = state.set; wx.removeStorageSync = state.remove;
      app.globalData.token = state.token; app.globalData.bootstrap = state.bootstrap; app.hydrateStoredSession = state.hydrate;
      try { wx.getFileSystemManager().unlinkSync(state.filePath); } catch { /* Already disposed by the page. */ }
      delete app.__qaD2; return { restored: true, requests: state.requests };
    }); } catch (error) { errors.push(String(error)); }
    try { if (installed) await mp.reLaunch('/pages/index/index'); } catch (error) { errors.push(String(error)); }
    try { await mp.disconnect(); } catch (error) { errors.push(String(error)); }
    try { if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); } } catch (error) { errors.push(String(error)); }
    report.cleanupErrors = errors; if (errors.length) report.passed = false;
    save(); if (errors.length) throw Error('Native cleanup failed: ' + errors.join('; '));
  }
  return report;
}
