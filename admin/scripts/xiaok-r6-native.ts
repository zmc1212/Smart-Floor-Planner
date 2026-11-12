import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { assistantHttp } from '@/lib/assistant/application/http';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { closePostgresPool } from '@/lib/postgresql';
import { wechatideNativeClient } from './wechatide-native-client';

type NativeData = Record<string, unknown>;
type WindowBounds = { Left: number; Right: number; Top: number; Bottom: number };
type MiniMessage = { id: string; available: boolean; blocks?: { text?: string }[] };
type NativeRequest = { url: string; fail?: (error: { errMsg: string }) => void };
type NativeWx = {
  request(options: NativeRequest): { abort(): void };
  downloadFile(options: NativeRequest): { abort(): void };
  getStorageSync(key: string): unknown;
  setStorageSync(key: string, value: unknown): void;
  removeStorageSync(key: string): void;
};
type NativeApp = {
  globalData: { token: unknown; bootstrap: unknown };
  hydrateStoredSession(): Promise<unknown>;
  __qaR6?: {
    id: string;
    request: NativeWx['request']; download: NativeWx['downloadFile']; get: NativeWx['getStorageSync'];
    set: NativeWx['setStorageSync']; remove: NativeWx['removeStorageSync']; token: unknown; bootstrap: unknown;
    hydrate: NativeApp['hydrateStoredSession']; memory: Map<string, unknown>;
  };
};
declare const wx: NativeWx;
declare function getApp(): NativeApp;
const base = '/api/miniprogram/assistant';
const project = resolve('../miniprogram'), route = 'packages/assistant/chat/chat';
const fixtureFile = process.env.XIAOK_R6_NATIVE_FIXTURE!;
const output = resolve(process.env.XIAOK_R6_NATIVE_OUTPUT!);
const windowHandle = Number(process.env.XIAOK_R6_NATIVE_WINDOW);
const target = new URL(process.env.XIAOK_R6_DATABASE_URL!);
assert.equal(target.protocol, 'postgresql:');
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.username, 'sfp_app');
assert.match(target.pathname, /^\/xiaok_r6_acceptance(?:_[a-z0-9]+)?$/);
assert.ok(Number(target.port) >= 49152 && !target.search && !target.hash);
assert.ok(Number.isSafeInteger(windowHandle) && windowHandle > 0);
const fixture = JSON.parse(readFileSync(fixtureFile, 'utf8')) as { cid: string; ownerId: string; projectId: string; evidenceRecord: string; mediaId: string };
assert.ok(Object.values(fixture).every(value => /^[1-9]\d*$/.test(value)));
mkdirSync(output, { recursive: true });
process.env.DATABASE_URL = target.href;
process.env.NATIVE_WORKFLOW_DELEGATION_ENABLED = '1';
process.env.NATIVE_WORKFLOW_DELEGATION_ENTERPRISE_IDS = '1454';
const client = new pg.Client({ connectionString: target.href });
const native = wechatideNativeClient(project, output);
const injectionId = randomUUID();
const checks: NativeData[] = [];
const http: { method: string; path: string; status: number; bytes: number }[] = [];
let server: ReturnType<typeof createServer> | undefined;
let installed = false, error: string | null = null, restored = false;

function binding() {
  const names = execFileSync('git', ['ls-files','-c','-o','--exclude-standard','-z','--','src','drizzle','scripts','package-lock.json','../miniprogram'])
    .toString().split('\0').filter(Boolean).sort();
  const hash = createHash('sha256');
  for (const name of names) hash.update(name).update('\0').update(readFileSync(name)).update('\0');
  return { files: names.length, hash: hash.digest('hex') };
}

async function waitFor<T>(what: string, get: () => Promise<T | undefined>) {
  for (let tries = 0; tries < 16; tries++) {
    const result = await get();
    if (result) return result;
    await delay(600);
  }
  throw Error('Stable wait expired: ' + what);
}

async function verifyNativeRuntime() {
  const list = await native.call('project_list');
  assert.equal(list.projects.filter((p: { projectPath: string }) => resolve(p.projectPath).toLowerCase() === project.toLowerCase()).length, 1);
  const placement = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-File', resolve('scripts/wechatide-window-state.ps1')],
    { encoding: 'utf8', windowsHide: true }));
  const window = placement.Windows.find((item: { Handle: number }) => item.Handle === windowHandle);
  assert.ok(window && !window.Minimized);
  const b = window.Bounds as WindowBounds;
  assert.ok(placement.Screens.some(({ Primary, Bounds }: { Primary: boolean; Bounds: WindowBounds }) => !Primary
    && b.Left >= Bounds.Left && b.Right <= Bounds.Right && b.Top >= Bounds.Top && b.Bottom <= Bounds.Bottom));
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await native.call('simulator_refresh', { project });
      await delay(attempt ? 7500 : 5000);
      const info = await native.systemInfo();
      assert.deepEqual([info.windowWidth, info.windowHeight, info.SDKVersion], [390, 844, '3.17.2']);
      const page = await native.currentPage();
      assert.ok(page && Object.keys(await page.data()).length && await page.$('view'));
      checks.push({ name: 'live Stable runtime', window: windowHandle, project, logical: [390, 844], sdk: info.SDKVersion, page: page.path });
      return;
    } catch (cause) {
      checks.push({ name: 'runtime attempt', status: 'failed', attempt: attempt + 1, error: String(cause) });
      if (attempt === 1) throw cause;
    }
  }
}

async function main() {
  await client.connect();
  assert.equal((await client.query("select pg_try_advisory_lock(hashtext('assistant_isolated_acceptance')) as owned")).rows[0].owned, true);
  assert.equal((await withPlatformTransaction(tx => one(tx, sql`select count(*)::int as n from app.assistant_jobs where status in ('queued','running')`)))?.n, 0);
  const expected = await withPlatformTransaction(tx => one(tx, sql`select d.evidence->>'messageId' as message_id
    from app.native_workflow_delegations d join app.construction_projects p on p.enterprise_id=d.enterprise_id and p.id=d.project_id
    where d.enterprise_id=1454 and d.conversation_id=${fixture.cid} and d.owner_id=${fixture.ownerId}
      and d.project_id=${fixture.projectId} and p.name like 'R6 合成 %' and d.current_status='completed'`));
  assert.ok(expected?.message_id, 'Missing R6 original completed consultation');
  await verifyNativeRuntime();
  const token = await signMiniProgramToken({ sub: fixture.ownerId, id: fixture.ownerId, mode: 'customer', role: 'user',
    contextVersion: 1, source: 'wechat' });
  server = createServer(async (incoming, response) => {
    try {
      const url = new URL(incoming.url!, 'http://127.0.0.1');
      if (!url.pathname.startsWith(base + '/') || incoming.headers.authorization !== 'Bearer ' + token) {
        response.writeHead(404).end();
        return;
      }
      const method = incoming.method!;
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const result = await assistantHttp(new Request(url, { method, headers: incoming.headers as HeadersInit,
        ...(method === 'POST' ? { body: new Uint8Array(Buffer.concat(chunks)) } : {}) }), url.pathname.slice(base.length + 1).split('/'));
      const bytes = Buffer.from(await result.arrayBuffer());
      if (method === 'POST' && url.pathname.endsWith('/messages') && result.ok) assert.equal(JSON.parse(bytes.toString()).data.runId, null);
      http.push({ method, path: url.pathname, status: result.status, bytes: bytes.length });
      response.writeHead(result.status, Object.fromEntries(result.headers.entries())).end(bytes);
    } catch {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  });
  await new Promise<void>((ready, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', ready); });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  installed = true;
  await native.evaluate((config: { cid: string; token: string; origin: string; base: string; id: string }) => {
    const app = getApp();
    if (Object.keys(app).some(key => key.startsWith('__qa'))) throw Error('A native test controller owns this window');
    const state: NonNullable<NativeApp['__qaR6']> = { id: config.id, request: wx.request, download: wx.downloadFile,
      get: wx.getStorageSync, set: wx.setStorageSync, remove: wx.removeStorageSync,
      token: app.globalData.token, bootstrap: app.globalData.bootstrap, hydrate: app.hydrateStoredSession, memory: new Map() };
    app.__qaR6 = state;
    app.hydrateStoredSession = async () => {};
    app.globalData.token = config.token;
    app.globalData.bootstrap = { current: { mode: 'customer', role: 'user', context: { enterpriseId: '1454' } } };
    state.memory.set('token', config.token);
    wx.getStorageSync = key => state.memory.has(key) ? state.memory.get(key) : key === 'assistant-pending-v1' ? undefined : state.get.call(wx, key);
    wx.setStorageSync = (key, value) => { state.memory.set(key, value); };
    wx.removeStorageSync = key => { state.memory.delete(key); };
    const transport = {
      rewrite(url: string) {
        const path = url.slice(url.indexOf('/api/'));
        const conversation = config.base + '/conversations/' + config.cid;
        return path === conversation || path.startsWith(conversation + '/') || path === config.base + '/entry-context'
          ? config.origin + path : null;
      },
    };
    wx.request = options => {
      const url = transport.rewrite(options.url);
      if (url) return state.request.call(wx, { ...options, url });
      options.fail?.({ errMsg: 'isolated native transport' });
      return { abort() {} } as ReturnType<typeof wx.request>;
    };
    wx.downloadFile = options => {
      const url = transport.rewrite(options.url);
      if (url) return state.download.call(wx, { ...options, url });
      options.fail?.({ errMsg: 'isolated native media transport' });
      return { abort() {} } as ReturnType<typeof wx.downloadFile>;
    };
    return true;
  }, { cid: fixture.cid, token, origin: 'http://127.0.0.1:' + address.port, base, id: injectionId });
  const open = async () => {
    await native.reLaunch('/' + route + '?conversationId=' + fixture.cid);
    return waitFor('C01 visible and ready', async () => {
      const page = await native.currentPage();
      if (page?.path !== route) return;
      const data = await page.data();
      if (!data.loading && !data.fatal && data.canSend) return page;
    });
  };
  const page = await open();
  const readResult = async () => waitFor('formal result and authenticated original image', async () => {
    const data = await page.data();
    const result = (data.messages as MiniMessage[]).find(item => item.id === expected.message_id && item.available !== false);
    if (result?.blocks?.some(block => block.text?.includes('卫生间水管根部处理已由项目团队现场复核'))
      && Object.keys(data.siteRecordPaths || {}).some(key => key.startsWith(fixture.evidenceRecord + '_') && key.endsWith('_' + fixture.mediaId))) {
      return result;
    }
  });
  const result = await readResult();
  assert.ok(await page.$('.site-record-photos .message-photo'));
  assert.ok(http.some(call => call.path.includes('/construction-records/' + fixture.evidenceRecord + '/media/') && call.status === 200 && call.bytes > 0));
  checks.push({ name: 'original C01 result and protected photo', resultId: result.id });
  const editor = await page.$('.composer-input'), send = await page.$('.send-button');
  assert.ok(editor && send);
  const earlier = new Set(((await page.data()).messages as MiniMessage[]).map(message => message.id));
  await editor.input('查看委托');
  assert.equal((await page.data()).draft, '查看委托');
  await send.tap();
  const status = await waitFor('persisted delegation status', async () => {
    const messages = (await page.data()).messages as MiniMessage[];
    return messages.find(message => !earlier.has(message.id) && message.blocks?.some(block =>
      block.text === '卫生间 · 水管根部处理：有权人员已复核并授权回传原事项结论'));
  });
  assert.ok(http.some(call => call.method === 'POST' && call.path.endsWith('/messages') && call.status === 202));
  checks.push({ name: 'C01 actual status send', id: status.id });
  const reopened = await open();
  await readResult();
  assert.ok(((await reopened.data()).messages as MiniMessage[]).some(message => message.id === status.id));
  assert.equal((await native.pageStack()).at(-1)?.path, route);
  const screenshot = resolve(output, 'c01-review-reentry.png');
  await native.screenshot({ path: screenshot });
  const bytes = readFileSync(screenshot);
  checks.push({ name: 'C01 persistent reentry', cid: fixture.cid, route, screenshot, encoded: [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] });
}

const before = binding();
main().catch(cause => { error = String(cause); }).finally(async () => {
  try {
    if (installed) {
      restored = await native.evaluate((id: string) => {
        const app = getApp(), state = app.__qaR6;
        if (state?.id !== id) return false;
        wx.request = state.request; wx.downloadFile = state.download;
        wx.getStorageSync = state.get; wx.setStorageSync = state.set; wx.removeStorageSync = state.remove;
        app.globalData.token = state.token; app.globalData.bootstrap = state.bootstrap; app.hydrateStoredSession = state.hydrate;
        delete app.__qaR6;
        return true;
      }, injectionId);
      if (restored) await native.reLaunch('/pages/index/index');
    }
  } catch (cause) { error ??= String(cause); }
  finally {
    await native.disconnect();
    if (server) await new Promise<void>(ready => server!.close(() => ready()));
    await client.end().catch(() => undefined);
    await closePostgresPool();
    const after = binding();
    const passed = !error && restored && before.hash === after.hash;
    const report = { passed, error, restored, before, after, checks, http };
    writeFileSync(resolve(output, 'verification.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    console.log(JSON.stringify(report));
    if (!passed) process.exitCode = 1;
  }
});
