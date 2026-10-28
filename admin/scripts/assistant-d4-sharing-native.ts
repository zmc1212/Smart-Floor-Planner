/* eslint-disable @typescript-eslint/no-explicit-any -- Stable SDK payloads and synthetic fixture DTOs. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import http from 'node:http';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { loadEnvConfig } from '@next/env';
import { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { rows } from '@/db/repositories/assistant-repository';
import { withTenantTransaction, withPlatformTransaction } from '@/db/transaction';
import { closePostgresPool } from '@/lib/postgresql';
import { assistantHttp } from '@/lib/assistant/application/http';
import { GET as constructionHttp } from '@/app/api/miniprogram/construction/[[...path]]/route';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { nativeFinalProtocol } from '@/lib/assistant/agent/native-final';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { safeText, type MessageContent } from '@/lib/assistant/contracts';
import { parseAgentUsage } from '@/lib/ai/providers/agent-chat';
import { AssistantMediaService } from '@/lib/assistant/media/service';
import { reviewBudget, type RetainedReviewHold } from './assistant-review-budget';
import { bindBailianReviewTestRuntime } from './bailian-review-test-runtime';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
import { D4SharingFixture } from './assistant-d4-sharing-fixture';
import { wechatideNativeClient } from './wechatide-native-client';

type Row = Record<string, any>;
declare const wx: Row;
declare function getApp(): Row;
declare function getCurrentPages(): Row[];
const root = path.resolve(process.cwd(), '..'); loadEnvConfig(process.cwd(), true);
process.env.DATABASE_URL = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, '')).DATABASE_URL;
const name = process.argv[2]; assert.match(name, /^d4-sharing-native-[a-z0-9-]{5,80}$/);
assert.ok(process.argv.includes('--live'), 'Explicit bounded configured-model run required');
const resumeName = process.argv.includes('--resume-needs') ? process.argv[process.argv.indexOf('--resume-needs') + 1] : '';
const drawingsOnly = process.argv.includes('--drawings-only');
assert.ok(!(resumeName && drawingsOnly));
if (resumeName) assert.match(resumeName, /^d4-sharing-native-[a-z0-9-]{5,80}$/);
const previous = resumeName ? JSON.parse(fs.readFileSync(path.join(root, 'tmp', resumeName, 'report.json'), 'utf8')) : null;
if (previous) { assert.ok(previous.finished); assert.deepEqual(previous.drift, []); }
const output = path.join(root, 'tmp', name); fs.mkdirSync(output);
const ledger = path.join(root, 'tmp/agent-contract/trial-' + name + '.json');
const project = path.join(root, 'miniprogram'), mp = wechatideNativeClient(project, output), execFile = promisify(cp.execFile);
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const cases = [
  { kind: 'need', text: '测试工地甲的书房准备靠窗放两个人的书桌，电脑和台灯要留插座。把这段发给设计师看看。', expectedTerms: [['靠窗'], ['两个人'], ['书桌'], ['电脑'], ['台灯'], ['插座']] },
  { kind: 'need', text: '我在测试工地甲那套，书房想沿窗做双人办公位，先把这个需求给设计师看一下。', expectedTerms: [['沿窗'], ['双人'], ['办公']] },
  { kind: 'drawing', text: '这是测试工地甲书房的插座点位参考图，先给设计师看。', expectedTerms: [['插座'], ['点位'], ['参考图']] },
  { kind: 'drawing', text: '测试工地甲书房这张是我画的点位草图，帮我转给设计师核对。', expectedTerms: [['点位'], ['草图']] },
];
const report: Row = { delivery: 'D4', scope: 'Two natural material-sharing cores, each two fixed first-draft trials; all inputs through existing Stable C01, actual configured Qwen Worker, exact team consent, S04 readback, reentry and revocation. No image interpretation/D2 rerun.',
  started: new Date().toISOString(), cases, trials: [], calls: [], captures: [], checks: [], before: {}, after: {}, drift: [], passed: false,
  capturePolicy: 'Representative shared states in the first trial of each core; both repetitions still use actual client inputs/writes/reentry.',
  authorization: { cumulativeCapMicros: 100000000, model: 'qwen3.8-flash', fixedRuns: 4, maxDispatches: 16, reservedTokensPerDispatch: 64000 }, budgetBefore: reviewBudget(root).usedMicros };
if (previous) { report.scope = 'Zero-model client/service adoption replay of the two exact recorded prepare-material tool calls in their original consultations. The original Qwen first drafts remain separate and unchanged; replay is not a new semantic trial.'; report.sourceEvidence = resumeName; report.authorization.fixedRuns = 0; report.authorization.maxDispatches = 0; }
if (drawingsOnly) { report.scope = 'The two originally fixed drawing inputs only; previously attempted need originals are not sampled again.'; report.authorization.fixedRuns = 2; }
const save = () => { fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); fs.writeFileSync(ledger, JSON.stringify(report, null, 2)); };
const binding = () => {
  const files: string[] = [];
  for (const dir of ['admin/src/lib/assistant', 'admin/src/lib/construction', 'admin/src/lib/ai/providers', 'admin/src/db', 'admin/src/app/api/miniprogram/construction', 'miniprogram/packages/assistant', 'miniprogram/packages/construction']) {
    const walk = (folder: string) => { for (const item of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
      const file = folder + '/' + item.name; if (item.isDirectory()) walk(file); else if (/\.(?:ts|js|mjs|json|wxml|less|png)$/.test(file)) files.push(file);
    } }; walk(dir);
  }
  files.push('admin/scripts/assistant-d4-sharing-native.ts', 'admin/scripts/assistant-d4-sharing-fixture.ts', 'admin/scripts/wechatide-native-client.ts',
    'admin/scripts/wechatide-window-state.ps1', 'admin/scripts/assistant-acceptance-safety.mjs', 'admin/scripts/assistant-review-budget.ts', 'admin/scripts/bailian-review-test-runtime.ts',
    'admin/src/lib/miniprogram-jwt.ts', 'admin/src/lib/miniprogram-auth.ts', 'admin/src/lib/miniprogram-identity-context.ts', 'admin/src/lib/admin-user-roles.ts',
    'admin/package-lock.json', path.relative(root, process.env.TSX_TSCONFIG_PATH || path.join(root, 'admin/tsconfig.json')), 'admin/.env.local', 'tmp/xiaok-vector/connection.private.json', 'tmp/xiaok-intelligent-consult/.env.qwen37', 'miniprogram/utils/api.js',
    'admin/scripts/assistant-d4-native-run.mjs', 'admin/scripts/assistant-d4-runtime-config.mjs');
  return Object.fromEntries(files.filter(f => fs.existsSync(path.join(root, f))).map(f => [f, hash(fs.readFileSync(path.join(root, f)))]));
};
const retained: RetainedReviewHold[] = ['tmp/anythingllm-pilot', 'tmp/agent-comparison', 'tmp/agent-diagnosis', 'tmp/agent-contract']
  .flatMap(dir => fs.readdirSync(path.join(root, dir)).filter(file => /^trial-.*\.json$/.test(file)).flatMap(file =>
    (JSON.parse(fs.readFileSync(path.join(root, dir, file), 'utf8')).calls || []).filter((c: Row) => c.status !== 'succeeded')
      .map((c: Row) => ({ id: c.id, runId: c.runId, reservedTokens: c.reservedTokens }))));
const originalFetch = globalThis.fetch;
let release: (() => Promise<void>) | undefined, restore: (() => Promise<unknown>) | undefined, server: http.Server | undefined;
let installed = false, picker = false, fixture: D4SharingFixture | undefined, activeTrial: Row | undefined;
let processing: Promise<void> | undefined;
const scheduledRuns = new Map<string, Promise<void>>();
const tokens: string[] = [];
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor<T>(read: () => Promise<T>, label: string): Promise<NonNullable<T>> {
  const until = Date.now() + 120000;
  while (Date.now() < until) { if (report.processorError) throw Error(report.processorError); const value = await read(); if (value) return value as NonNullable<T>; await delay(500); }
  throw Error('D4 native timed out: ' + label);
}
async function windowCheck() {
  const r = await execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'admin/scripts/wechatide-window-state.ps1')], { windowsHide: true, timeout: 10000 });
  const state = JSON.parse(r.stdout.replace(/^\uFEFF/, '').trim()), windows = state.Windows.filter((w: Row) => ['WeChat Web Devtools', 'miniprogram'].includes(w.Title));
  assert.equal(windows.length, 1);
  assert.ok(state.Windows.every((w: Row) => w.Handle === windows[0].Handle || (!w.Title && w.ProcessId === windows[0].ProcessId
    && w.Bounds.Right - w.Bounds.Left < 300 && w.Bounds.Bottom - w.Bounds.Top < 100)), 'No second or ambiguous project window');
  const b = windows[0].Minimized ? windows[0].NormalBounds : windows[0].Bounds, x = (b.Left + b.Right) / 2, y = (b.Top + b.Bottom) / 2;
  report.window = state; report.windowPlacementSource = windows[0].Minimized ? 'verified normal bounds; remains minimized' : 'visible bounds';
  assert.ok(state.Screens.some((s: Row) => !s.Primary && x >= s.Bounds.X && x < s.Bounds.X + s.Bounds.Width && y >= s.Bounds.Y && y < s.Bounds.Y + s.Bounds.Height));
  report.window = state;
}
async function pageAt(route = 'packages/assistant/chat/chat') {
  return waitFor(async () => { const page = await mp.currentPage(); if (page?.path !== route) return null;
    const data = await page.data(); assert.ok(!data.needsLogin && !data.fatal, JSON.stringify({ needsLogin: data.needsLogin, fatal: data.fatal, error: data.error }));
    return !data.loading ? page : null; }, route);
}
async function capture(label: string, route = 'packages/assistant/chat/chat') {
  if (activeTrial && [1,3].includes(activeTrial.index)) return;
  await windowCheck(); const stack = await mp.evaluate(() => getCurrentPages().map(page => page.route));
  assert.equal(stack.at(-1), route); assert.equal((await mp.currentPage())?.path, route);
  const file = path.join(output, label + '.png'); await mp.screenshot({ path: file }); const data = fs.readFileSync(file);
  report.captures.push({ file, route, stack, logical: [390, 844], encoded: [data.readUInt32BE(16), data.readUInt32BE(20)] }); save();
}
async function customerSession(token: string, f: D4SharingFixture) {
  await mp.evaluate((c: Row) => { const app = getApp(), state = app.__qaD4Sharing; state.memory.clear(); state.memory.set('token', c.token);
    app.globalData.token = c.token; app.globalData.bootstrap = { current: { mode: 'customer', role: 'user', capabilities: ['customer.service', 'customer.projects', 'account'], context: { enterpriseId: c.eid } } };
  }, { token, eid: f.eid });
  await mp.redirectTo('/packages/assistant/chat/chat?conversationId=' + f.conversationId); await pageAt();
}
async function staffSession(token: string, f: D4SharingFixture) {
  await mp.evaluate((c: Row) => { const app = getApp(); app.__qaD4Sharing.memory.set('token', c.token); app.globalData.token = c.token;
    app.globalData.bootstrap = { current: { mode: 'staff', role: 'designer', capabilities: ['construction.projects'], context: { enterpriseId: c.eid, staffId: c.aid, staffRole: 'designer' } } };
  }, { token, eid: f.eid, aid: f.memberIds[0] });
  await mp.redirectTo('/packages/construction/chat/chat?projectId=' + f.projectId);
  return pageAt('packages/construction/chat/chat');
}
async function deactivateFixture(f: D4SharingFixture) {
  // Retain labelled original attempts/data for billing and serial continuation,
  // while revoking every synthetic session and preventing later execution.
  return withPlatformTransaction(async tx => {
    for (const eid of f.enterpriseIds) {
      await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${eid}`);
      await tx.execute(sql`update app.admin_users set status='disabled' where enterprise_id=${eid}`);
      await tx.execute(sql`update app.assistant_jobs set status='cancelled',lease_token=null,lease_expires_at=null where enterprise_id=${eid} and status in ('queued','running')`);
      await tx.execute(sql`update app.assistant_runs set status='cancelled',updated_at=now() where enterprise_id=${eid} and status in ('queued','running')`);
    }
    for (const uid of f.userIds) await tx.execute(sql`update app.users set context_version=context_version+1 where id=${uid}`);
    for (const aid of f.platformIds) await tx.execute(sql`update app.admin_users set status='disabled' where id=${aid}`);
    const [state] = await rows(tx, sql`select
      (select count(*)::int from app.admin_users where enterprise_id=${f.eid} and status='active') active_staff,
      (select count(*)::int from app.assistant_runs where enterprise_id=${f.eid} and status in ('queued','running')) active_runs`);
    assert.equal(state.active_staff, 0); assert.equal(state.active_runs, 0);
    return { retainedForEvidence: true, enterpriseIds: f.enterpriseIds, identitiesRevoked: true, ...state };
  });
}
async function sendText(text: string, lost = false) {
  const page = await pageAt();
  await waitFor(async () => { const d = await page.data(); return d.canSend && !d.loading && !d.busy && !d.generating && !d.uncertainRun && !d.pendingSend && !d.readOnly; }, 'ready actual composer');
  const before = new Set((await page.data()).messages.map((m: Row) => String(m.id)));
  await (await page.$('.composer-input'))!.input(text);
  await waitFor(async () => (await page.data()).draft === text, 'rendered exact input before tapping send');
  if (lost) await mp.evaluate(() => { getApp().__qaD4Sharing.dropMessage = true; });
  await (await page.$('.send-button'))!.tap();
  if (lost) {
    await waitFor(async () => (await page.data()).pendingSend, 'retained original key after lost response');
    await capture('need-01-lost-receipt');
    await (await page.$('.pending-message button'))!.tap();
  }
  await waitFor(async () => { const d = await page.data(); return !d.busy && !d.pendingSend && !d.generating
    && d.messages.some((m: Row) => !before.has(String(m.id)) && (m.isUser || m.authorKind === 'user') && m.content?.blocks?.some((b: Row) => b.type === 'text' && b.text === text)); }, 'new original message, Worker and persisted feedback');
  await processing;
}
async function processRun(runId: string) {
  assert.ok(fixture && activeTrial);
  // API polling may briefly hold the settings row; SKIP LOCKED legitimately returns null.
  const lease = await waitFor(() => claimJob(), 'owned queued job after transient settings lock');
  assert.equal(lease.runId, runId); assert.equal(lease.enterpriseId, fixture.eid);
  activeTrial.runId = runId; save();
  if (previous) {
    const originals = previous.calls.filter((c: Row) => c.trial === activeTrial!.index);
    const calls = originals.flatMap((c: Row) => {
      const index = previous.calls.findIndex((row: Row) => row.id === c.id);
      const wire = JSON.parse(fs.readFileSync(path.join(root, 'tmp', resumeName, `wire-${index + 1}.json`), 'utf8'));
      return (JSON.parse(wire.rawResponse).choices[0].message.tool_calls || []).filter((t: Row) => t.function.name === 'prepare_material_share');
    });
    assert.equal(calls.length, 1); const original = calls[0];
    activeTrial.recordedToolCall = { source: resumeName, id: original.id, argumentsHash: hash(original.function.arguments) }; save();
    let replayed = false;
    await processAgentAnswer(lease, { model: async () => {
      assert.ok(!replayed, 'Recorded tool adoption must finish without synthesizing another model response'); replayed = true;
      return { text: '', toolCalls: [{ id: original.id, name: original.function.name, arguments: original.function.arguments }],
        finishReason: 'tool_calls', providerRequestId: 'recorded-replay:' + original.id, usage: { inputTokens: 0, outputTokens: 0 } };
    } });
  } else await processAgentAnswer(lease); // Actual configured transport for the fixed first-draft trials.
}
async function main() {
  report.importedSource = binding();
  save();
  try {
    release = await lockAssistantAcceptance(process.env.DATABASE_URL!, { waitForLock: true });
    const afterWait = binding(); report.preImportDrift = Object.keys(report.importedSource).filter(file => report.importedSource[file] !== afterWait[file]);
    assert.deepEqual(report.preImportDrift, [], 'Sources changed after module import while waiting for the lock');
    if (!previous) { const bound = await bindBailianReviewTestRuntime(root, path.join(output, 'runtime.json')); restore = bound.restore; report.runtime = bound.receipt; }
    await windowCheck();
    for (let attempt = 0; attempt < 2; attempt++) {
      try { report.compilation = { project, result: await mp.call('simulator_refresh', { project }) }; await delay(6000);
        const info = await mp.systemInfo(), page = await mp.currentPage(); assert.ok(page && Object.keys(await page.data()).length);
        assert.equal(info.windowWidth, 390); assert.equal(info.windowHeight, 844); report.system = info; break;
      } catch (error) { if (attempt) throw error; report.initialFrozen = String(error); }
    }
    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (['localhost','127.0.0.1'].includes(url.hostname)) return originalFetch(input, init);
      assert.ok(!previous, 'Remote dispatch is forbidden during original-result continuation');
      assert.equal(url.hostname, 'dashscope.aliyuncs.com', 'No unapproved model, embedding or fallback call');
      assert.ok(activeTrial && activeTrial.runId); assert.ok(report.calls.length < 16, 'Fixed dispatch cap');
      reviewBudget(root).assertReservation(0, 64000, retained);
      const call: Row = { id: name + ':' + report.calls.length, runId: activeTrial.runId, trial: activeTrial.index, status: 'reserved', reservedTokens: 64000 };
      report.calls.push(call); save();
      const body = JSON.parse(String(init?.body)); assert.equal(body.model, 'qwen3.8-flash');
      const wire: Row = { url: url.href, body, requestHash: hash(JSON.stringify(body)), callId: call.id };
      const file = path.join(output, 'wire-' + report.calls.length + '.json'); fs.writeFileSync(file, JSON.stringify(wire, null, 2));
      try {
        const response = await originalFetch(input, init), raw = await response.clone().text(); wire.status = response.status; wire.rawResponse = raw;
        if (response.ok) { const usage = parseAgentUsage(JSON.parse(raw).usage); if (usage) { call.usage = { total_tokens: usage.inputTokens + usage.outputTokens }; call.status = 'succeeded'; } }
        if (call.status !== 'succeeded') call.status = 'unknown';
        fs.writeFileSync(file, JSON.stringify(wire, null, 2)); save(); return response;
      } catch (error) { call.status = 'unknown'; call.error = String(error); save(); throw error; }
    };
    server = http.createServer(async (incoming, response) => {
      response.on('error', error => { report.httpResponseError = String(error); save(); });
      try {
        assert.ok(tokens.some(token => incoming.headers.authorization === 'Bearer ' + token));
        const parts: Buffer[] = []; let size = 0; for await (const part of incoming) { size += part.length; assert.ok(size < 6 * 1024 * 1024); parts.push(Buffer.from(part)); }
        const request = new NextRequest('http://127.0.0.1:3114' + incoming.url, { method: incoming.method, headers: incoming.headers as HeadersInit,
          ...(['POST','PATCH'].includes(incoming.method || '') ? { body: new Uint8Array(Buffer.concat(parts)) } : {}) });
        const pathname = new URL(request.url).pathname;
        const result = pathname.startsWith('/api/miniprogram/assistant/')
          ? await assistantHttp(request, pathname.slice('/api/miniprogram/assistant/'.length).split('/'))
          : await constructionHttp(request, { params: Promise.resolve({ path: pathname.slice('/api/miniprogram/construction/'.length).split('/') }) });
        const bytes = Buffer.from(await result.arrayBuffer());
        response.writeHead(result.status, Object.fromEntries(result.headers.entries())); response.end(bytes);
        if (result.ok && incoming.method === 'POST' && /\/conversations\/\d+\/messages$/.test(pathname)) {
          const sent = JSON.parse(bytes.toString()).data;
          if (sent?.runId && !scheduledRuns.has(String(sent.runId))) {
            const task = (processing || Promise.resolve()).then(() => processRun(String(sent.runId))).catch(error => { report.processorError = String(error.stack || error); save(); });
            scheduledRuns.set(String(sent.runId), task); processing = task;
            void task.finally(() => { if (processing === task) processing = undefined; });
          }
        }
      } catch (error) { report.httpBridgeError = String(error); save(); if (!response.writableEnded) { if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: String(error) })); } }
    });
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(3114, '127.0.0.1', resolve); });
    const diagram = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="white"/><path d="M70 60H570V420H70Z M70 220H250" fill="none" stroke="#344a40" stroke-width="7"/><path d="M130 64h24v20h-24z M330 398h24v20h-24z" fill="#bd453c"/><text x="100" y="370" font-size="25">SYNTHETIC STUDY POINTS</text></svg>')).jpeg().toBuffer();
    installed = true;
    await mp.evaluate((config: Row) => {
      const app = getApp(); if (Object.keys(app).some(key => /^__qa/.test(key))) throw Error('Another native controller owns the runtime');
      const s: Row = { request: wx.request, download: wx.downloadFile, get: wx.getStorageSync, set: wx.setStorageSync, remove: wx.removeStorageSync,
        token: app.globalData.token, bootstrap: app.globalData.bootstrap, hydrate: app.hydrateStoredSession, memory: new Map(), requests: [], dropMessage: false,
        filePath: wx.env.USER_DATA_PATH + '/qa-d4-sharing-' + config.nonce + '.jpg' };
      app.__qaD4Sharing = s; app.hydrateStoredSession = async () => {};
      wx.getStorageSync = (key: string) => key.startsWith('assistant-') ? s.memory.get(key) : s.memory.has(key) ? s.memory.get(key) : s.get.call(wx, key);
      wx.setStorageSync = (key: string, value: unknown) => s.memory.set(key, value); wx.removeStorageSync = (key: string) => s.memory.delete(key);
      s.target = (raw: string) => { const index = raw.indexOf('/api/miniprogram/'); return index < 0 ? null : 'http://127.0.0.1:3114' + raw.slice(index); };
      wx.request = (o: Row) => {
        const url = s.target(String(o.url)); if (!url) { o.fail?.({ errMsg: 'Synthetic-only transport' }); return { abort() {} }; }
        const headers = o.header || o.headers || {}, row: Row = { path: url.slice('http://127.0.0.1:3114'.length), method: o.method || 'GET',
          key: Object.entries(headers).find(([key]) => key.toLowerCase() === 'idempotency-key')?.[1] }; s.requests.push(row);
        return s.request.call(wx, { ...o, url, success(r: Row) { row.status = r.statusCode;
          if (s.dropMessage && row.method === 'POST' && /\/assistant\/conversations\/\d+\/messages$/.test(row.path) && r.statusCode >= 200 && r.statusCode < 300) { s.dropMessage = false; row.dropped = true; o.fail?.({ errMsg: 'request:fail simulated response loss' }); return; }
          o.success?.(r); } });
      };
      wx.downloadFile = (o: Row) => { const url = s.target(String(o.url)); if (!url) { o.fail?.({ errMsg: 'Synthetic-only download' }); return { abort() {} }; } return s.download.call(wx, { ...o, url }); };
      wx.getFileSystemManager().writeFileSync(s.filePath, config.photo, 'base64');
    }, { nonce: randomUUID(), photo: diagram.toString('base64') });
    report.before = binding(); save();
    for (const [index, item] of cases.entries()) {
      if (drawingsOnly && index < 2 || previous && index > 1) continue;
      if (report.calls.some((c: Row) => c.status !== 'succeeded')) break;
      const f = new D4SharingFixture(); fixture = f;
      const trial: Row = { index, kind: item.kind, text: item.text, passed: false }; activeTrial = trial; report.trials.push(trial); save();
      try {
        if (previous) {
          const original = JSON.parse(fs.readFileSync(path.join(root, 'tmp', resumeName, `case-${index + 1}-originals.json`), 'utf8'));
          Object.assign(f, original.fixture);
          await withPlatformTransaction(async tx => {
            const labelled = await rows(tx, sql`select id from app.enterprises where id=${f.eid} and code like 'synthetic-d4-sharing-%'`); assert.equal(labelled.length, 1);
            await tx.execute(sql`update app.assistant_enterprise_settings set enabled=true where enterprise_id=${f.eid}`);
            await tx.execute(sql`update app.admin_users set status='active' where enterprise_id=${f.eid} and username like 'synthetic-d4-sharing-%'`);
          });
          trial.originalRunId = previous.trials[index].runId;
          trial.firstVisibleReply = previous.trials[index].firstVisibleReply; trial.preparedSelection = previous.trials[index].preparedSelection;
        } else await f.create({ runtime: 'langgraph-v1', model: 'qwen3.8-flash', providerKey: 'dashscope', tools: true, imageInput: false, structuredFinal: nativeFinalProtocol, probeVersion: 'd4-sharing-fixed' });
        const versions = await withPlatformTransaction(tx => rows(tx, sql`select id::text,context_version from app.users where id in (${f.userIds[0]},${f.userIds[1]})`));
        const contextVersion = (uid: string) => Number(versions.find(v => v.id === uid)!.context_version);
        if (previous) { const actor = f.actor; Object.defineProperty(f, 'actor', { get: () => ({ ...actor, contextVersion: contextVersion(f.userIds[0]) }) }); }
        const token = await signMiniProgramToken({ sub: f.userIds[0], id: f.userIds[0], contextVersion: contextVersion(f.userIds[0]), mode: 'customer', role: 'user', enterpriseId: f.eid, source: 'wechat' }); tokens.push(token);
        await withPlatformTransaction(async tx => { await tx.execute(sql`update app.users set role='staff',phone=${'199' + f.userIds[1].padStart(8, '0')} where id=${f.userIds[1]}`); await tx.execute(sql`update app.admin_users set user_id=${f.userIds[1]} where id=${f.memberIds[0]} and enterprise_id=${f.eid}`); });
        const staffToken = await signMiniProgramToken({ sub: f.userIds[1], id: f.userIds[1], contextVersion: contextVersion(f.userIds[1]), mode: 'staff', role: 'designer', staffRole: 'designer', staffId: f.memberIds[0], enterpriseId: f.eid, source: 'wechat' }); tokens.push(staffToken);
        const staffPreflight = await originalFetch('http://127.0.0.1:3114/api/miniprogram/construction/projects/' + f.projectId + '/chat?limit=30', { headers: { Authorization: 'Bearer ' + staffToken } });
        const staffBody = await staffPreflight.json(); trial.staffPreflight = { status: staffPreflight.status, success: staffBody.success, error: staffBody.error };
        assert.ok(staffPreflight.ok && staffBody.success, JSON.stringify(trial.staffPreflight));
        const initialSite = await staffSession(staffToken, f);
        assert.ok((await initialSite.$('.composer-input')) && !JSON.stringify((await initialSite.data()).items).includes('PRIVATE_DO_NOT_SHARE'));
        await customerSession(token, f);
        if (index === 0) await capture('c01-entry-preflight');
        if (item.kind === 'drawing') {
          const filePath = await mp.evaluate(() => getApp().__qaD4Sharing.filePath);
          await mp.mockWxMethod('chooseMedia', { tempFiles: [{ tempFilePath: filePath, size: diagram.length, fileType: 'image' }], type: 'image' }); picker = true;
          const page = await pageAt(); await (await page.$('.media-button[aria-label="本次图片资料"]'))!.tap();
          await waitFor(async () => { const d = await page.data(); return !d.mediaBusy && !d.mediaPending && d.messages.some((m: Row) => m.mediaId); }, 'actual own image upload');
          await mp.restoreWxMethod('chooseMedia'); picker = false;
        }
        await sendText(item.text);
        const run = await f.chat.run(String(trial.runId)); trial.run = run;
        assert.equal(run.status, 'succeeded', JSON.stringify(run));
        const messages = await f.chat.messages(f.conversationId, undefined, 100), answer = messages.items.find(m => String(m.id) === run.outputMessageId)!;
        trial.firstVisibleReply = safeText(answer.content as MessageContent); trial.replyOrigin = 'server-owned exact material preview; raw model tool calls retained in wire/steps';
        assert.match(trial.firstVisibleReply, /尚未共享/); assert.match(trial.firstVisibleReply, /不能只开放给某位设计师/); assert.doesNotMatch(trial.firstVisibleReply, /PRIVATE_DO_NOT_SHARE/);
        assert.equal((await f.sources()).sources.length, 0);
        const prepared = await withTenantTransaction(f.eid, tx => rows(tx, sql`select payload from app.domain_event_outbox where enterprise_id=${f.eid}
          and type='construction.material.proposed.v1' and payload->>'runId'=${String(trial.runId)} order by id desc limit 1`));
        const selection = prepared[0]?.payload as Row | undefined; assert.ok(selection);
        assert.equal(selection.kind, item.kind); assert.equal(selection.projectId, f.projectId); assert.equal(selection.roomId, f.roomId);
        for (const group of item.expectedTerms) assert.ok(group.some(term => selection.excerpt.includes(term)), 'preview omitted requested source detail: ' + group.join('/'));
        trial.preparedSelection = { kind: selection.kind, excerpt: selection.excerpt, projectId: selection.projectId, roomId: selection.roomId };
        await capture(`case-${index + 1}-private-preview`);
        await mp.redirectTo('/packages/assistant/chat/chat?conversationId=' + f.conversationId); await pageAt();
        assert.ok(JSON.stringify((await (await pageAt()).data()).messages).includes('尚未共享'));
        await sendText('可以，把这次资料共享给这个项目团队。', index === 0);
        const sources = (await f.sources()).sources; assert.equal(sources.length, 1); const grant = sources[0];
        assert.equal(grant.kind, item.kind); assert.ok(grant.text && item.text.includes(grant.text));
        assert.equal(grant.conversationId, f.conversationId); assert.notEqual(grant.sourceMessageId, grant.consentMessageId);
        trial.grant = grant;
        if (item.kind === 'drawing') {
          assert.ok(grant.mediaId);
          assert.deepEqual(await f.site().materialMedia(f.projectId, grant.id, grant.mediaId!), await new AssistantMediaService(f.actor).read(f.conversationId, grant.mediaId!));
        }
        await capture(`case-${index + 1}-shared-receipt`);
        const site = await staffSession(staffToken, f); await (await site.$('.composer-input'))!.input('帮我找书房的需求和图纸'); await (await site.$('.send'))!.tap();
        await waitFor(async () => { const d = await site.data(); return !d.busy && !d.pending && JSON.stringify(d.items).includes(grant.text); }, 'S04 actual team lookup');
        assert.ok(!JSON.stringify((await site.data()).items).includes('PRIVATE_DO_NOT_SHARE'));
        await capture(`case-${index + 1}-team-read`, 'packages/construction/chat/chat');
        await customerSession(token, f); await sendText('停止共享这次资料。');
        assert.equal((await f.sources()).sources.length, 0);
        if (grant.mediaId) await assert.rejects(f.site().materialMedia(f.projectId, grant.id, grant.mediaId));
        const revokedSite = await staffSession(staffToken, f), revokedData = await revokedSite.data();
        assert.ok(!JSON.stringify(revokedData.items).includes(grant.text), 'old derived team answer must be unavailable');
        assert.match(JSON.stringify(revokedData.items), /关联资料已变化/);
        await capture(`case-${index + 1}-team-revoked-reentry`, 'packages/construction/chat/chat');
        await customerSession(token, f);
        await mp.redirectTo('/packages/assistant/chat/chat?conversationId=' + f.conversationId); await pageAt();
        assert.ok(JSON.stringify((await (await pageAt()).data()).messages).includes('已撤回'));
        await capture(`case-${index + 1}-revoked-reentry`);
        trial.passed = true;
      } catch (error) { trial.error = String((error as Error).stack || error);
        if (!report.calls.some((c: Row) => c.trial === index)) { report.preflightStopped = true; break; }
      }
      finally {
        if (picker) { await mp.restoreWxMethod('chooseMedia'); picker = false; }
        await processing;
        if (f.eid) {
          const trace = await f.snapshot(), checkpoints = trace.steps.filter(s => s.kind === 'agent_checkpoint').map(s => s.private_checkpoint as Row);
          trial.modelProtocol = { argumentRepairs: Math.max(0, ...checkpoints.map(c => Number(c.argumentFailures || 0))),
            finalRepairs: Math.max(0, ...checkpoints.map(c => Number(c.validationRepairs || 0))),
            selectedKinds: trace.events.filter(e => e.type === 'construction.material.proposed.v1').map(e => (e.payload as Row).kind),
            dispatches: report.calls.filter((c: Row) => c.trial === index).length };
          fs.writeFileSync(path.join(output, `case-${index + 1}-originals.json`), JSON.stringify({ ...trace,
            attempts: await withTenantTransaction(f.eid, tx => rows(tx, sql`select id::text,status,accepted,metadata,error_code from app.ai_provider_attempts where enterprise_id=${f.eid} order by id`)),
            usage: await withTenantTransaction(f.eid, tx => rows(tx, sql`select run_id::text,measurement_kind,input_tokens,output_tokens from app.assistant_usage_records where enterprise_id=${f.eid} order by id`)) }, null, 2));
        }
        await mp.reLaunch('/pages/index/index'); trial.cleanup = await deactivateFixture(f); fixture = undefined; save();
      }
    }
    report.passed = report.trials.length === (previous || drawingsOnly ? 2 : 4) && report.trials.every((t: Row) => t.passed);
  } catch (error) { report.error = String((error as Error).stack || error); }
  finally {
    const errors: string[] = [];
    try { await processing; } catch (e) { errors.push(String(e)); }
    try { if (picker) await mp.restoreWxMethod('chooseMedia'); } catch (e) { errors.push(String(e)); }
    try { if (installed) report.restoration = await mp.evaluate(() => {
      const app = getApp(), s = app.__qaD4Sharing; if (!s) return { restored: false };
      wx.request = s.request; wx.downloadFile = s.download; wx.getStorageSync = s.get; wx.setStorageSync = s.set; wx.removeStorageSync = s.remove;
      app.globalData.token = s.token; app.globalData.bootstrap = s.bootstrap; app.hydrateStoredSession = s.hydrate;
      try { wx.getFileSystemManager().unlinkSync(s.filePath); } catch { /* Already cleared. */ }
      delete app.__qaD4Sharing; return { restored: true, requests: s.requests };
    }); } catch (e) { errors.push(String(e)); }
    try { if (installed) await mp.reLaunch('/pages/index/index'); await mp.disconnect(); } catch (e) { errors.push(String(e)); }
    try { if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); } } catch (e) { errors.push(String(e)); }
    globalThis.fetch = originalFetch;
    try { if (fixture) report.finalFixtureCleanup = await deactivateFixture(fixture); } catch (e) { errors.push(String(e)); }
    try { if (restore) report.runtimeRestored = await restore(); } catch (e) { errors.push(String(e)); }
    report.bindingStatus = Object.keys(report.before).length ? 'checked' : 'not_started';
    report.after = report.bindingStatus === 'checked' ? binding() : {};
    report.drift = [...new Set([...Object.keys(report.before), ...Object.keys(report.after)])].filter(f => report.before[f] !== report.after[f]);
    report.cleanupErrors = errors; report.budgetAfter = reviewBudget(root).usedMicros; report.finished = new Date().toISOString();
    report.passed = report.passed && !errors.length && !report.drift.length && report.restoration?.restored;
    save(); await release?.(); await closePostgresPool(); process.exitCode = report.passed ? 0 : 1;
    console.log(JSON.stringify({ output, passed: report.passed, trials: report.trials.map((t: Row) => ({ index: t.index, passed: t.passed, error: t.error })), calls: report.calls.length, captures: report.captures.length, drift: report.drift, cleanupErrors: errors, error: report.error }));
  }
}
void main();
