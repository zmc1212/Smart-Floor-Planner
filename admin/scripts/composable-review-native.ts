/* eslint-disable @typescript-eslint/no-explicit-any -- Existing DevTools RPC and synthetic transport return dynamic runtime objects. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { ConversationService, appendMessage } from '@/lib/assistant/core/conversation';
import { RequirementService } from '@/lib/assistant/requirements/service';
import { RequirementWorkflow } from '@/lib/assistant/requirements/workflow';
import { requirementSources } from '@/lib/assistant/requirements/items';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { assistantHttp } from '@/lib/assistant/application/http';
import type { ActorContext } from '@/lib/assistant/contracts';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { businessReviewTools } from '@/lib/assistant/agent/review-tools';
import { wechatideNativeClient } from './wechatide-native-client';

type Row = Record<string, any>;
// These names exist only inside SDK evaluate callbacks in the Mini Program.
declare const wx: Row;
declare function getApp(): Row;
declare function getCurrentPages(): Row[];
const root = path.resolve(process.cwd(), '..');
const adminRoot = path.join(root, 'admin');
const dbConfig = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, ''));
assert.match(String(dbConfig.DATABASE_URL), /127\.0\.0\.1:55432\/xiaok_embedding_eval/);
loadEnvConfig(adminRoot, true);
process.env.DATABASE_URL = dbConfig.DATABASE_URL;

const route = 'packages/assistant/requirements/requirements';
const chatRoute = 'packages/assistant/chat/chat';
const outputName = process.argv[2] || `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const output = path.join(root, 'tmp/agent-contract', `composable-native-${outputName}`);
assert.ok(!fs.existsSync(output), `Output already exists: ${output}`);
fs.mkdirSync(output, { recursive: true });
const apiOrigin = 'http://127.0.0.1:3108';
const report: Row = {
  scope: 'D1 deterministic actual C01 input to Worker, proposal, C02 selective write, response-loss recovery and reentry; no provider model acceptance',
  started: new Date().toISOString(), checks: [], captures: [], requests: [], passed: false,
  provider: { modelCalls: 0, semanticJudgement: 'none; deterministic internal proposal only' },
};
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const load = createRequire(import.meta.url);

function binding() {
  const relative = [
    'admin/scripts/composable-review-native.ts',
    'admin/scripts/wechatide-native-client.ts',
    'admin/src/lib/assistant/requirements/service.ts',
    'admin/src/lib/assistant/requirements/review.ts',
    'admin/src/lib/assistant/requirements/items.ts',
    'admin/src/lib/assistant/requirements/automatic.ts',
    'miniprogram/packages/assistant/lib/requirements.js',
    'miniprogram/packages/assistant/lib/client.js',
    'miniprogram/packages/assistant/requirements/requirements.js',
    'miniprogram/packages/assistant/requirements/requirements.wxml',
    'miniprogram/packages/assistant/requirements/requirements.json',
    'miniprogram/packages/assistant/requirements/requirements.less',
    'miniprogram/packages/assistant/chat/chat.js',
    'miniprogram/packages/assistant/chat/chat.wxml',
    'miniprogram/utils/api.js',
    'admin/src/lib/assistant/application/http.ts',
    'admin/src/lib/assistant/application/auth.ts',
    'admin/src/lib/miniprogram-jwt.ts',
    'admin/scripts/assistant-acceptance-safety.mjs',
    'admin/.env',
    'admin/.env.local',
    'admin/package.json',
    'admin/package-lock.json',
    'admin/tsconfig.json',
    'tmp/wechat-automator-smoke-20261017/sdk-latest/package-lock.json',
    'miniprogram/project.config.json',
    'miniprogram/project.private.config.json',
    'tmp/xiaok-vector/connection.private.json',
  ];
  relative.push(...cp.execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z',
    'admin/src/lib/assistant', 'admin/src/db', 'admin/src/lib/postgresql.ts', 'admin/src/lib/miniprogram-*',
    'admin/package.json', 'admin/package-lock.json', 'admin/tsconfig.json', 'miniprogram/packages/assistant/lib',
    'miniprogram/packages/assistant/requirements', 'miniprogram/utils'], { cwd: root, windowsHide: true, encoding: 'utf8' }).split('\0').filter(Boolean));
  const addRuntime = (relativeRoot: string) => {
    const absoluteRoot = path.join(root, relativeRoot);
    if (!fs.existsSync(absoluteRoot)) return;
    for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
      const child = path.join(relativeRoot, entry.name);
      if (entry.isDirectory()) addRuntime(child);
      else if (/\.(?:js|json|cjs|mjs|d\.ts)$/u.test(entry.name)) relative.push(child.replaceAll('\\', '/'));
    }
  };
  addRuntime('tmp/wechat-automator-smoke-20261017/sdk-latest/node_modules/miniprogram-automator');
  const files = [...new Set(relative)].filter(file => fs.existsSync(path.join(root, file))).sort();
  return { ...Object.fromEntries(files.map(file => [file, hash(fs.readFileSync(path.join(root, file)))])),
    ...(process.argv.includes('--wechatide') ? Object.fromEntries([
      'D:/微信开发工具/微信web开发者工具/微信开发者工具.exe',
      'D:/微信开发工具/微信web开发者工具/resources/app.asar',
      'D:/微信开发工具/微信web开发者工具/resources/app.asar.unpacked/js/common/cli/skill-index.js',
    ].map(file => ['@StableCLI:' + file, hash(fs.readFileSync(file))])) : {}),
    '@node-runtime': hash(fs.readFileSync(process.execPath)) };
}

let release: (() => Promise<void>) | undefined;
let server: http.Server | undefined;
let mp: any;
let installed = false;
let fixture: Row | undefined;
let actor: ActorContext;
let token = '';
let otherToken = '';

async function step(name: string, work: () => Promise<unknown>) {
  try {
    const result = await work();
    report.checks.push({ name, passed: true, result });
    console.log(`${name}: PASS`);
    return result;
  } catch (error) {
    report.checks.push({ name, passed: false, error: String((error as Error).message || error) });
    throw error;
  } finally { save(); }
}

async function waitFor(read: () => Promise<any>, label: string, limit = 240) {
  for (let i = 0; i < limit; i++) {
    const value = await read();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw Error(`Timed out: ${label}`);
}

async function createFixture() {
  const code = `synthetic-review-native-${randomUUID()}`;
  const created = await withPlatformTransaction(async tx => {
    const enterprise = await one(tx, sql`insert into app.enterprises(name,code,status)
      values('测试专用 · 原生需求提案验收',${code},'active') returning id`);
    const user = await one(tx, sql`insert into app.users(nickname,context_version) values(${code},1) returning id`);
    const other = await one(tx, sql`insert into app.users(nickname,context_version) values(${code + '-other'},1) returning id`);
    const eid = String(enterprise!.id), uid = String(user!.id), oid = String(other!.id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${code}),(${oid},${code + '-other'})`);
    await tx.execute(sql`insert into app.assistant_enterprise_settings
      (enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
      values(${eid},true,100,200000,5000000,30,${JSON.stringify({ runtime: 'langgraph-v1', providerKey: 'dashscope', model: 'qwen3.7-flash', tools: true, imageInput: false, probeVersion: 'd1-native-deterministic' })}::jsonb)`);
    return { enterpriseId: eid, userId: uid, otherUserId: oid, code };
  });
  fixture = created;
  actor = { enterpriseId: created.enterpriseId, principal: { kind: 'user', userId: created.userId },
    contextVersion: 1, capabilities: ['assistant.chat.self'], entry: { kind: 'direct' } };
  process.env.ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS = created.enterpriseId;
  const conversation = await new ConversationService(actor).create(randomUUID());
  fixture.conversationId = String(conversation.id);

  token = await signMiniProgramToken({ sub: fixture.userId, id: fixture.userId, mode: 'customer', role: 'user',
    enterpriseId: fixture.enterpriseId, contextVersion: 1, source: 'wechat' });
  otherToken = await signMiniProgramToken({ sub: fixture.otherUserId, id: fixture.otherUserId, mode: 'customer', role: 'user',
    enterpriseId: fixture.enterpriseId, contextVersion: 1, source: 'wechat' });
  report.fixture = { enterpriseId: fixture.enterpriseId, userId: fixture.userId, otherUserId: fixture.otherUserId, conversationId: fixture.conversationId };
}

async function appendText(text: string) {
  assert.ok(fixture);
  let message: Row | undefined;
  await withTenantTransaction(fixture.enterpriseId, async tx => {
    message = await appendMessage(tx, actor, fixture!.conversationId, {
      author: 'user', clientMessageId: randomUUID(), content: { version: 1, blocks: [{ type: 'text', text }] },
    });
  });
  return { id: String(message!.id), seq: String(message!.seq) };
}

async function requirementRead() {
  assert.ok(fixture);
  return new RequirementService(actor).read(fixture.conversationId);
}

async function evidence() {
  assert.ok(fixture);
  return new RequirementService(actor).customerEvidence(fixture.conversationId);
}

async function summaryCount() {
  assert.ok(fixture);
  const row = await withTenantTransaction(fixture.enterpriseId, tx => one(tx, sql`select count(*)::int as n
    from app.assistant_requirement_summaries where enterprise_id=${fixture!.enterpriseId} and conversation_id=${fixture!.conversationId}`));
  return Number(row!.n);
}

async function startHttp() {
  server = http.createServer(async (incoming, response) => {
    try {
      const prefix = '/api/miniprogram/assistant/';
      if (!incoming.url?.startsWith(prefix)) { response.writeHead(404); response.end(); return; }
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of incoming) { const data = Buffer.from(chunk); size += data.length; assert.ok(size <= 64000); chunks.push(data); }
      const request = new Request(apiOrigin + incoming.url, {
        method: incoming.method || 'GET', headers: incoming.headers as HeadersInit,
        ...(['POST', 'PATCH'].includes(incoming.method || '') ? { body: Buffer.concat(chunks).toString('utf8') } : {}),
      });
      const responseValue = await assistantHttp(request, new URL(request.url).pathname.slice(prefix.length).split('/'));
      response.writeHead(responseValue.status, Object.fromEntries(responseValue.headers.entries()));
      response.end(Buffer.from(await responseValue.arrayBuffer()));
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ success: false, error: String((error as Error).message || error) }));
    }
  });
  await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(3108, '127.0.0.1', resolve); });
}

async function directApi(currentToken: string, pathName: string, method = 'GET', body?: Row) {
  const response = await fetch(apiOrigin + '/api/miniprogram/assistant' + pathName, {
    method, headers: { Authorization: `Bearer ${currentToken}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let parsed: Row = {};
  try { parsed = await response.json() as Row; } catch { /* keep status only */ }
  return { status: response.status, body: parsed };
}

async function compileAndConnect() {
  if (process.argv.includes('--wechatide')) {
    const projectPath = path.join(root, 'miniprogram');
    mp = wechatideNativeClient(projectPath, output);
    let firstError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      await mp.call('simulator_refresh', { project: projectPath });
      await new Promise(resolve => setTimeout(resolve, 6000));
      try {
        const system = await mp.systemInfo();
        assert.equal(system.windowWidth, 390); assert.equal(system.windowHeight, 844); assert.equal(system.SDKVersion, '3.17.2');
        const page = await mp.currentPage(); assert.ok(page && Object.keys(await page.data()).length > 0);
        return { projectPath, controller: 'Stable registered CLI 0.3.11; current Codex authorization',
          freshCompileTriggered: true, logical: [system.windowWidth, system.windowHeight], SDKVersion: system.SDKVersion,
          recovery: { attempted: attempt > 0, firstError } };
      } catch (error) {
        if (attempt === 1) throw error;
        firstError = String((error as Error).message || error);
      }
    }
    throw Error('Stable CLI runtime did not recover after explicit fresh compilation');
  }
  const sdk = load(path.join(root, 'tmp/wechat-automator-smoke-20261017/sdk-latest/node_modules/miniprogram-automator'));
  const { connect } = load(path.join(root, 'tmp/wechat-devtools-version-test/cdp.cjs'));
  const projectPath = path.win32.normalize(path.join(root, 'miniprogram'));
  const compileOnce = async () => {
    const inventory = await (await fetch('http://127.0.0.1:9431/json/list')).json() as Row[];
    const targets = inventory.filter(target => {
      if (!String(target.url).includes('electron-project.html')) return false;
      try { return path.win32.normalize(new URL(String(target.url)).searchParams.get('projectpath') || '') === projectPath; } catch { return false; }
    });
    assert.equal(targets.length, 1);
    const target = new URL(String(targets[0].url));
    assert.equal(target.searchParams.get('appVersion'), '2.02.2608080'); assert.equal(target.searchParams.get('autoPort'), '9420');
    const c = await connect(String(targets[0].url));
    try {
      assert.equal(c.target.id, targets[0].id);
      await c.evaluate(`(()=>{const b=[...document.querySelectorAll('[title="编译"]')].filter(e=>e.getBoundingClientRect().width>0);if(b.length!==1)throw Error('Compile action not unique');b[0].click();return true;})()`);
      await new Promise(resolve => setTimeout(resolve, 6000));
    } finally { c.close(); }
    return { endpoint: 'ws://127.0.0.1:9420', appVersion: target.searchParams.get('appVersion'), targetId: targets[0].id };
  };
  let compiled: Row | undefined, system: Row | undefined, firstError = '';
  const recovery: Row = { attempted: false };
  // A Stable compile can leave the existing SDK socket alive while the new
  // bundle is settling. Match the verified workflow: disconnect once, issue a
  // fresh exact-project compile, then reconnect once and recheck the viewport.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 1) {
      recovery.attempted = true; recovery.firstError = firstError;
      if (mp) { await mp.disconnect(); mp = undefined; }
    }
    compiled = await compileOnce();
    try {
      mp = await sdk.connect({ wsEndpoint: compiled.endpoint });
      system = await mp.systemInfo();
      assert.ok(await (await mp.currentPage()).data());
      break;
    } catch (error) {
      firstError = String((error as Error).message || error);
      if (mp) { await mp.disconnect().catch(() => {}); mp = undefined; }
      if (attempt === 1) throw error;
    }
  }
  if (!compiled || !system || !mp) throw Error('Stable SDK connection did not recover');
  assert.equal(system.windowWidth, 390); assert.equal(system.windowHeight, 844); assert.equal(system.SDKVersion, '3.17.2');
  return { projectPath, appVersion: compiled.appVersion, targetId: compiled.targetId, SDKVersion: system.SDKVersion, recovery };
}

async function installTransport() {
  assert.ok(fixture && mp);
  const result = await mp.evaluate((config: Row) => {
    const app = getApp();
    if (app.__qaReviewNative || app.__qaShared || app.__qaMaterials || app.__qaC05 || app.__qaSynthesis || app.__qaHistory) throw Error('Another native controller is active');
    const state: Row = { request: wx.request, get: wx.getStorageSync, set: wx.setStorageSync, remove: wx.removeStorageSync,
      token: app.globalData.token, bootstrap: app.globalData.bootstrap, hydrate: app.hydrateStoredSession,
      memory: new Map(), requests: [], dropNextApply: false };
    app.__qaReviewNative = state; app.hydrateStoredSession = async () => {};
    app.globalData.token = config.token; app.globalData.bootstrap = { current: { mode: 'customer', role: 'user', context: { enterpriseId: config.enterpriseId } } };
    state.memory.set('token', config.token);
    wx.getStorageSync = (key: string) => key === 'assistant-pending-v1'
      ? (state.memory.has(key) ? state.memory.get(key) : undefined)
      : state.memory.has(key) ? state.memory.get(key) : state.get.call(wx, key);
    wx.setStorageSync = (key: string, value: unknown) => state.memory.set(key, value);
    wx.removeStorageSync = (key: string) => state.memory.delete(key);
    wx.request = (options: Row) => {
      const raw = String(options.url), index = raw.indexOf('/api/'), full = index < 0 ? '' : raw.slice(index), clean = full.split('?')[0];
      const base = '/api/miniprogram/assistant', conversation = `${base}/conversations/${config.conversationId}`;
      const allowed = clean === `${base}/entry-context` || clean === conversation || clean === `${conversation}/messages`
        || clean === `${conversation}/requirements`
        || (String(options.method || 'GET').toUpperCase() === 'GET'
          && (clean === `${base}/conversations` || clean.startsWith(conversation + '/')));
      if (!allowed) { options.fail?.({ errMsg: 'Synthetic-only transport refused request' }); return { abort() {} }; }
      const header = options.header || options.headers || {};
      const key = Object.entries(header).find(([name]) => name.toLowerCase() === 'idempotency-key')?.[1] || null;
      const row: Row = { path: clean, method: options.method || 'GET', idempotencyKey: key,
        body: options.data === undefined ? null : JSON.parse(JSON.stringify(options.data)), status: null, dropped: false };
      state.requests.push(row); const success = options.success, failure = options.fail;
      return state.request.call(wx, { ...options, url: config.apiOrigin + full,
        success(response: Row) {
          row.status = response.statusCode;
          if (state.dropNextApply && row.path === `${conversation}/requirements` && row.method === 'POST') {
            state.dropNextApply = false; row.dropped = true; failure?.({ errMsg: 'request:fail simulated response loss' }); return;
          }
          success?.(response);
        },
        fail(error: Row) { row.error = error?.errMsg || String(error); failure?.(error); },
      });
    };
    return { installed: true, credentialsPersisted: false };
  }, { enterpriseId: fixture!.enterpriseId, conversationId: fixture!.conversationId, token, apiOrigin });
  installed = true; report.transportInstall = result;
}

async function restoreTransport() {
  if (!mp || !installed) return;
  report.transport = await mp.evaluate(() => {
    const app = getApp(), state = app.__qaReviewNative;
    if (!state) return { restored: false, requests: [] };
    wx.request = state.request; wx.getStorageSync = state.get; wx.setStorageSync = state.set; wx.removeStorageSync = state.remove;
    app.globalData.token = state.token; app.globalData.bootstrap = state.bootstrap; app.hydrateStoredSession = state.hydrate;
    delete app.__qaReviewNative;
    return { restored: true, requests: state.requests };
  });
  assert.equal(report.transport.restored, true);
  report.requests = report.transport.requests;
  installed = false;
}

async function currentPage() { return await mp.currentPage(); }

async function open(target: string) {
  assert.ok(mp && fixture);
  await mp.redirectTo(`/${target}?conversationId=${fixture.conversationId}`);
  return waitFor(async () => {
    const page = await currentPage(); if (!page || page.path !== target) return null;
    const data = await page.data();
    if (data.fatal) throw Error(`Native route failed: ${target}: ${data.error || 'fatal'}`);
    return !data.loading ? page : null;
  }, `route ${target}`);
}

async function capture(name: string, expectedRoute = route) {
  const page = await currentPage();
  const stack = await mp.evaluate(() => getCurrentPages().map((entry: Row) => entry.route));
  assert.equal(page.path, expectedRoute); assert.equal(stack.at(-1), expectedRoute);
  await mp.pageScrollTo(100000); await new Promise(resolve => setTimeout(resolve, 400));
  const geometry: Row = {};
  for (const selector of ['.brand-mark', '.primary-action', '.summary-card', '.quote-card']) {
    const element = await page.$(selector);
    if (!element) continue;
    geometry[selector] = { ...await element.offset(), ...await element.size() };
  }
  const file = path.join(output, `${name}.png`); await mp.screenshot({ path: file });
  const bytes = fs.readFileSync(file); assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  const item = { name, file, route: page.path, stack, logical: [390, 844], encoded: [bytes.readUInt32BE(16), bytes.readUInt32BE(20)], geometry };
  report.captures.push(item); save(); return item;
}

async function requests() {
  return await mp.evaluate(() => [...(getApp().__qaReviewNative?.requests || [])]);
}

async function confirmProposal(options: { drop?: boolean; twice?: boolean } = {}) {
  const page = await currentPage(); assert.equal(page.path, route);
  if (options.drop) await mp.evaluate(() => { getApp().__qaReviewNative.dropNextApply = true; });
  const button = await page.$('.primary-action'); assert.ok(button);
  if (options.twice) {
    const first = button.tap(), second = button.tap();
    await Promise.allSettled([first, second]);
  } else await button.tap();
}

async function sendAndRun(text: string, change: boolean) {
  const page = await open(chatRoute);
  await (await page.$('.composer-input')).input(text);
  await (await page.$('.send-button')).tap();
  const lease = await waitFor(async () => await claimJob(), 'actual C01 service creates a Worker job', 30);
  assert.equal(lease.enterpriseId, fixture!.enterpriseId);
  await processAgentAnswer(lease, { model: async (_messages, _tools, turn) => {
    if (change && turn === 0) {
      const review = await businessReviewTools(actor, fixture!.conversationId);
      const budget = review.context.savedItems.find(item => item.field === 'budget')!;
      const clause = [...review.context.customerClauses].reverse().find(item => item.text.includes('15万'))!;
      return { text: '', toolCalls: [{ id: 'budget', name: 'propose_requirement_changes', arguments: JSON.stringify({
        retainedIds: review.context.savedItems.filter(item => item.id !== budget.id).map(item => item.id),
        changes: [{ operation: 'replace', targetId: budget.id, sourceId: clause.id }],
      }) }], finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 } };
    }
    return { text: '', toolCalls: [{ id: 'answer', name: 'final_response', arguments: JSON.stringify({ kind: 'general',
      text: '量房前准备户型图和物业装修规定，整理设备、家具及家人的使用需求；现场说明已有漏水等问题。预算未定也可以先量房。',
    }) }], finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 } };
  } });
  const run = await new ConversationService(actor).run(lease.runId);
  assert.equal(run.status, 'succeeded');
  const reopened = await open(chatRoute), data = await reopened.data();
  assert.equal(data.conversation.requirementProposalPending, change);
  assert.match(JSON.stringify(data.messages), /量房前准备/);
  return { runId: lease.runId, normalEntry: true, configuredModel: false };
}

async function main() {
  report.bindingBefore = binding(); save();
  try {
    release = await lockAssistantAcceptance(process.env.DATABASE_URL!);
    await createFixture(); await startHttp();
    const originals = [['90平旧房', 'housing'], ['客厅铺瓷砖', 'room'], ['不做地暖', 'devices'], ['预算12万', 'budget']] as const;
    for (const [text] of originals) await appendText(text);
    const workflow = new RequirementWorkflow(actor), initial = await evidence(), sources = requirementSources(initial.messages);
    const baseline = await workflow.propose(fixture!.conversationId, randomUUID(), { sourceSeq: initial.sourceSeq, baseSummaryId: null,
      changes: originals.map(([text, field]) => ({ operation: 'add' as const, field, sourceId: sources.find(s => s.text === text)!.id })) });
    assert.equal(baseline.kind, 'proposal'); if (baseline.kind !== 'proposal') throw Error('baseline_missing');
    await workflow.write(fixture!.conversationId, randomUUID(), { action: 'apply_proposal', proposalId: baseline.proposal.id,
      digest: baseline.proposal.digest, consent: true, restoreConsent: false, selectedFields: originals.map(([, field]) => field) });
    await step('verified Stable exact-project fresh compilation and 390x844 runtime', compileAndConnect);
    await step('synthetic-only real HTTP transport and temporary session restoration', installTransport);
    await step('C01 real text input answers surveying despite an unfinished budget', () => sendAndRun('预算还没想好，先告诉我量房前要准备什么？', false));
    await capture('c01-question-answer', chatRoute);
    await step('C01 mixed change plus question returns answer and a persisted proposal', () => sendAndRun('预算提高到15万，瓷砖和地暖先照旧。另外量房前要准备什么？', true));
    await capture('c01-answer-and-proposal', chatRoute);
    await step('C02 native selection changes only budget', async () => {
      const page = await open(route), data = await page.data();
      assert.ok(data.proposal); assert.deepEqual(data.selectedFields, []);
      await mp.mockWxMethod('showActionSheet', { tapIndex: 1 });
      try { await (await page.$('.edit-button[data-key="budget"]')).tap();
        await waitFor(async () => (await page.data()).selectedFields.includes('budget'), 'budget selected');
      } finally { await mp.restoreWxMethod('showActionSheet'); }
      assert.deepEqual((await page.data()).selectedFields, ['budget']); await capture('c02-selected');
      return { selectedFields: ['budget'], summaryCount: await summaryCount() };
    });
    await step('dropped real save response persists across reentry and retries its original key', async () => {
      await confirmProposal({ drop: true });
      await waitFor(async () => { const d = await (await currentPage()).data(); return d.pending === 'confirm' && !d.busy ? d : null; }, 'pending result');
      await open(chatRoute); const page = await open(route);
      assert.equal((await page.data()).pending, 'confirm');
      await (await page.$('.notice .text-action')).tap();
      await waitFor(async () => { const d = await page.data(); return !d.pending && !d.busy && d.summary?.status === 'draft' ? d : null; }, 'same-key receipt recovered');
      const writes = (await requests()).filter((r: Row) => r.path.endsWith('/requirements') && r.method === 'POST');
      assert.equal(writes.length, 2); assert.equal(writes[0].dropped, true);
      assert.equal(writes[0].idempotencyKey, writes[1].idempotencyKey); assert.deepEqual(writes[0].body, writes[1].body);
      const saved = (await requirementRead()).latest!, fields = saved.draftFields as Row;
      assert.equal(saved.status, 'draft'); assert.equal(saved.confirmedFields, null);
      assert.equal(await summaryCount(), 2); assert.match(JSON.stringify(fields.budget), /15万/);
      assert.match(JSON.stringify(fields.room), /客厅铺瓷砖/); assert.match(JSON.stringify(fields.devices), /不做地暖/);
      await capture('c02-recovered-draft'); return { summaryId: saved.id, sameKey: true, summaryCount: 2, formalApproval: false };
    });
    await step('C01/C02 persisted reentry and other-customer isolation', async () => {
      const chat = await open(chatRoute); assert.equal((await chat.data()).conversation.requirementProposalPending, false);
      const other = await directApi(otherToken, `/conversations/${fixture!.conversationId}/requirements`); assert.equal(other.status, 404);
      const page = await open(route); assert.equal((await page.data()).summary.id, (await requirementRead()).latest!.id);
      return { otherStatus: other.status, persisted: true };
    });
    report.passed = true;
  } catch (error) { report.error = String((error as Error).stack || error); process.exitCode = 1; }
  finally {
    try { await restoreTransport(); } catch (error) { report.cleanupError = String(error); report.passed = false; }
    try { if (mp) { await mp.reLaunch('/pages/index/index'); await mp.disconnect(); } } catch (error) { report.cleanupError ||= String(error); report.passed = false; }
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    if (fixture) await withPlatformTransaction(async tx => {
      await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${fixture!.enterpriseId}`);
      await tx.execute(sql`update app.users set context_version=context_version+1 where id in (${fixture!.userId},${fixture!.otherUserId})`);
      await tx.execute(sql`update app.assistant_jobs set status='cancelled',lease_token=null,lease_expires_at=null where enterprise_id=${fixture!.enterpriseId} and status in ('queued','running')`);
    });
    delete process.env.ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS;
    if (release) await release(); report.fixtureCleaned = true;
    report.bindingAfter = binding(); report.drift = Object.keys({ ...report.bindingBefore, ...report.bindingAfter }).filter(f => report.bindingBefore[f] !== report.bindingAfter[f]);
    if (report.drift.length) report.passed = false; if (!report.passed) process.exitCode = 1;
    save(); await closePostgresPool(); console.log(JSON.stringify({ output, passed: report.passed, checks: report.checks.length, drift: report.drift, error: report.error || null }));
  }
}
void main();
