/* eslint-disable @typescript-eslint/no-require-imports -- Loads the existing Windows Stable CLI adapter under tsx. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../..'), admin = path.join(root, 'admin');
process.env.TSX_TSCONFIG_PATH = path.join(admin, 'tsconfig.json');
require('tsx/cjs'); require('@next/env').loadEnvConfig(admin, true);
const target = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL;
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(target).hostname) && new URL(target).port === '55432' && new URL(target).pathname === '/xiaok_embedding_eval');
process.env.DATABASE_URL = target;
const { sql } = require('drizzle-orm');
const { SignJWT } = require('jose');
const { withPlatformTransaction, withTenantTransaction } = require('../src/db/transaction.ts');
const { ConstructionService } = require('../src/lib/construction/service.ts');
const { randomUUID } = require('node:crypto');
const { one, rows } = require('../src/db/repositories/assistant-repository.ts');
const { assistantHttp } = require('../src/lib/assistant/application/http.ts');
const { closePostgresPool } = require('../src/lib/postgresql.ts');
const { lockAssistantAcceptance } = require('./assistant-acceptance-safety.mjs');

const eid = '1454', work = path.join(root, 'tmp/v1-03-stage-coverage');
const server = path.join(work, process.argv[2] || 'enabled-stages-03');
const output = path.join(work, process.argv[3] || 'native-enabled-stages-01');
assert.match(path.basename(server), /^enabled-stages-\d+$/);
assert.match(path.basename(output), /^native-enabled-stages-\d+$/);
fs.mkdirSync(output);
const saved = require(path.join(server, 'report.json'));
assert.ok(saved.passed && saved.cleanup && saved.cleanup.settingsRestored && saved.cleanup.stageSettingsKept);
const cid = String(saved.conversationId), uid = String(saved.userId);
const delivered = saved.deliveredStages;
const managerId = String(JSON.parse(fs.readFileSync(path.join(root, 'tmp/v1-02-live-reports/terminal-scheduler05/report.json'), 'utf8')).fixture.admins[0]);
assert.equal(delivered.length, 9);
const tenant = work => withTenantTransaction(eid, work);
const evidence = { scope: 'Stable reentry of the real enabled-stage reminders in the labelled customer C01; read-only, no generation', checks: [], captures: [] };
const save = () => fs.writeFileSync(path.join(output, 'native.json'), JSON.stringify(evidence, null, 2));
const evaluate = async (cli, source) => (await cli.call('automation_evaluate', { project, fnSource: source })).result.result;
const project = path.join(root, 'miniprogram'), route = 'packages/assistant/chat/chat';
const stageMessages = () => tenant(tx => rows(tx, sql`select m.id::text,m.content,m.available
  from app.assistant_messages m where m.enterprise_id=${eid} and m.conversation_id=${cid} and m.purpose='construction.stage' order by m.seq`));
const textOf = m => m.content.blocks.filter(b => b.type === 'text').map(b => b.text).join('');
let release, reopened = false, server_, before, stageAssistant;
const deps = ['admin/scripts/xiaok-v1-03-enabled-stages-native.cjs', 'admin/scripts/xiaok-v1-03-enabled-stages-check.ts',
  'admin/scripts/wechatide-native-client.ts', 'admin/scripts/wechatide-window-state.ps1',
  'tmp/v1-03-stage-coverage/enabled-stages-03/report.json', 'tmp/xiaok-vector/connection.private.json', 'admin/.env.local'];
const hashes = () => Object.fromEntries(deps.map(p => [p, createHash('sha256').update(fs.readFileSync(path.resolve(root, p))).digest('hex')]));
const wait = async (fn, label, ms = 60000) => { const until = Date.now() + ms; while (Date.now() < until) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 400)); } throw Error('Native timeout: ' + label); };
const pause = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  release = await lockAssistantAcceptance(target, { waitForLock: true });
  before = hashes();
  await tenant(async tx => {
    await one(tx, sql`update app.assistant_conversations set status='open'
      where enterprise_id=${eid} and id=${cid} and status='archived' and mode='ai' and purpose='customer_consultation'`);
    const conversation = await one(tx, sql`select status from app.assistant_conversations
      where enterprise_id=${eid} and id=${cid} and mode='ai' and purpose='customer_consultation'`);
    assert.ok(conversation && conversation.status === 'open'); reopened = true;
  });
  const user = await withPlatformTransaction(tx => one(tx, sql`select context_version from app.users where id=${uid}`));
  assert.ok(user);
  // A past-stage reminder expires by design; the readback restores one current
  // available reminder through a real backwards stage event, keeping the
  // expired originals visible as source-unavailable notices.
  await tenant(async tx => {
    const settings = await one(tx, sql`select enabled,agent_config,version,policy_version from app.assistant_enterprise_settings where enterprise_id=${eid}`);
    assert.ok(settings);
    await tx.execute(sql`update app.assistant_enterprise_settings set enabled=true,
      agent_config=${JSON.stringify({ ...(settings.agent_config || {}), enterpriseKnowledgeEnabled: false })}::jsonb,
      policy_version=policy_version+1,version=version+1 where enterprise_id=${eid}`);
    stageAssistant = settings;
  });
  const service = new ConstructionService({ enterpriseId: eid, adminId: managerId });
  await withPlatformTransaction(async tx => {
    const owner = await one(tx, sql`select id,status from app.admin_users where id=${managerId}`);
    assert.ok(owner); await tx.execute(sql`update app.admin_users set status='active' where id=${managerId}`);
  });
  const detail = (await service.execute('detail', { projectId: saved.projectId })).project;
  await service.execute('progress', { projectId: saved.projectId, expectedVersion: detail.version, stageKey: 'installation', note: '', sendReminder: false }, randomUUID());
  const token = await new SignJWT({ sub: uid, id: uid, mode: 'customer', role: 'user', enterpriseId: eid, contextVersion: Number(user.context_version), source: 'password' })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(uid).setIssuedAt().setAudience('miniprogram').setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET));
  server_ = http.createServer(async (req, res) => {
    try {
      if (!req.url.startsWith('/api/miniprogram/assistant/')) { res.writeHead(404).end(); return; }
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const route = req.url.slice('/api/miniprogram/assistant/'.length).split('?')[0];
      const headers = new Headers(); for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value);
      headers.set('authorization', 'Bearer ' + token);
      const result = await assistantHttp(new Request('http://localhost' + req.url, { method: req.method, headers,
        ...(req.method === 'GET' ? {} : { body: Buffer.concat(chunks).toString('utf8') }) }), route.split('/'));
      (evidence.requests = evidence.requests || []).push({ route, method: req.method, status: result.status });
      res.writeHead(result.status, Object.fromEntries(result.headers)).end(Buffer.from(await result.arrayBuffer()));
    } catch { res.writeHead(503).end(); }
  });
  await new Promise((resolve, reject) => server_.once('error', reject).listen(0, '127.0.0.1', resolve));
  const cli = require('./wechatide-native-client.ts').wechatideNativeClient(project, output);
  const placement = JSON.parse(cp.execFileSync('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe',
    ['-NoProfile', '-File', path.join(root, 'admin/scripts/wechatide-window-state.ps1')], { encoding: 'utf8', windowsHide: true }));
  const windows = placement.Windows.filter(w => w.Title === 'miniprogram'); assert.equal(windows.length, 1);
  assert.ok(placement.Screens.some(s => !s.Primary));
  await cli.call('simulator_refresh', { project }); await pause(6000);
  try { evidence.systemInfo = await cli.systemInfo(); } catch {
    await cli.call('simulator_refresh', { project }); await pause(10000); evidence.systemInfo = await cli.systemInfo();
  }
  assert.equal(evidence.systemInfo.windowWidth, 390); assert.equal(evidence.systemInfo.windowHeight, 844);
  assert.equal(evidence.systemInfo.SDKVersion, '3.17.2');
  const installed1 = await evaluate(cli, `function(){const app=getApp();if(Object.keys(app).some(k=>/^__qa/.test(k)))throw Error('Controller busy');const p=getCurrentPages().at(-1);const s=app.__qaStage={global:{...app.globalData},route:p.route,options:p.options||{},hydrate:app.hydrateStoredSession,get:wx.getStorageSync,set:wx.setStorageSync,remove:wx.removeStorageSync,request:wx.request,memory:new Map()};wx.getStorageSync=function(k){return s.memory.has(k)?s.memory.get(k):String(k).startsWith('assistant-')?undefined:s.get.call(wx,k);};wx.setStorageSync=function(k,v){s.memory.set(k,v);};wx.removeStorageSync=function(k){s.memory.delete(k);};app.hydrateStoredSession=async function(){};return true;}`);
  evidence.mockInstall1 = installed1; save();
  const installed2 = await evaluate(cli, `async function(){const app=getApp(),s=app.__qaStage;app.globalData.token=${JSON.stringify(token)};app.globalData.userInfo={mode:'customer',enterpriseId:'1454',enterpriseName:'微云',id:${JSON.stringify(uid)},_id:${JSON.stringify(uid)},role:'user',nickname:'合成测试·启用阶段旅程',phone:'synthetic'};app.globalData.bootstrap={current:{mode:'customer',role:'user',context:{mode:'customer',enterpriseId:'1454',enterpriseName:'微云'},capabilities:['customer.service','account']},badges:{status:'ok',counts:{}}};app.globalData.sessionHydrated=true;app.globalData.sessionRecovery=null;app.globalData.sessionHydrating=false;app.globalData.sessionHydrationPromise=Promise.resolve();app.globalData.customerTab='xiaok';s.memory.set('token',app.globalData.token);s.memory.set('userInfo',app.globalData.userInfo);wx.request=function(o){const i=String(o.url).indexOf('/api/'),suffix=String(o.url).slice(i);if(i<0||!suffix.startsWith('/api/miniprogram/assistant/')){o.fail&&o.fail({errMsg:'Synthetic test denies unrelated API'});return{abort(){}};}return s.request.call(wx,{...o,url:'http://127.0.0.1:'+${server_.address().port}+suffix});};return s.request.toString().length>200;}`);
  evidence.mockInstall2 = installed2; save();
  const enterChat = async () => {
    await cli.reLaunch('/' + route + '?conversationId=' + cid);
    return wait(async () => { const p = await cli.currentPage(), d = await p.data();
      return p.path === route && !d.loading && !d.fatal && d.conversation?.id === cid
        && (d.messages || []).length >= delivered.length + 1 ? p : null; }, 'enabled-stage conversation');
  };
  const assertReminders = async page => {
    const data = await page.data();
    const stageItems = (data.messages || []).filter(m => m.constructionReminder || m.available === false && m.authorKind === 'system'
      && (m.content.blocks || []).some(b => (b.notice || b.fallbackText || '').includes('资料已不可用') || (b.text || '').includes('资料已不可用')));
    const available = stageItems.filter(m => m.available && m.constructionReminder);
    assert.equal(available.length, 1, 'exactly the current-stage reminder stays available');
    const text = available[0].content.blocks.filter(b => b.type === 'text').map(b => b.text).join('');
    assert.ok(text.includes('当前施工已进入安装阶段'), 'the available reminder is the re-entered installation stage');
    assert.ok(text.includes('进场验收'), 'the available reminder carries its reviewed watch points');
    assert.equal(stageItems.length - available.length, delivered.length, 'the delivered past-stage reminders stay as unavailable notices');
    return { available: text.slice(0, 24), expired: stageItems.length - available.length };
  };
  let page = await enterChat();
  const heads = await assertReminders(page);
  await pause(500);
  const capture = async name => { assert.equal((await cli.pageStack()).at(-1).path, route); const file = path.join(output, name + '.png'); await cli.screenshot({ path: file }); const b = fs.readFileSync(file); evidence.captures.push({ file, route, logical: [390, 844], encoded: [b.readUInt32BE(16), b.readUInt32BE(20)] }); save(); };
  await capture('stage-reminders-entry');
  evidence.checks.push({ entry: true, reminders: heads, passed: true }); save();
  page = await enterChat();
  await assertReminders(page);
  await capture('stage-reminders-reentry');
  evidence.checks.push({ persistedReentry: true, sameConversation: cid, passed: true });
  evidence.passed = true;
}
main().catch(async e => {
  evidence.passed = false; evidence.error = e.stack || String(e); process.exitCode = 1;
  try { const cli = require('./wechatide-native-client.ts').wechatideNativeClient(project, output);
    const p = await cli.currentPage(); const d = await p.data();
    evidence.failureState = { path: p.path, options: p.options || {}, loading: d.loading, fatal: d.fatal, error: d.error,
      conversation: d.conversation?.id || null, messages: (d.messages || []).length, keys: Object.keys(d).slice(0, 40) }; } catch (stateError) { evidence.failureStateError = String(stateError); }
}).finally(async () => {
  try {
    if (evidence.requests) {
      evidence.requestStatuses = evidence.requests.reduce((map, r) => { map[r.status] = (map[r.status] || 0) + 1; return map; }, {});
      assert.ok(evidence.requests.every(r => [200, 403, 404].includes(r.status)), 'only success and the expected synthetic denial statuses');
    }
    const cli = require('./wechatide-native-client.ts').wechatideNativeClient(project, output);
    try {
      const previous = await evaluate(cli, `function(){const app=getApp(),s=app.__qaStage;if(!s)return null;const previous={route:s.route,options:s.options};wx.getStorageSync=s.get;wx.setStorageSync=s.set;wx.removeStorageSync=s.remove;wx.request=s.request;app.hydrateStoredSession=s.hydrate;for(const k of Object.keys(app.globalData))delete app.globalData[k];Object.assign(app.globalData,s.global);delete app.__qaStage;return previous;}`);
      if (previous) await cli.reLaunch('/' + previous.route + '?' + new URLSearchParams(previous.options));
      evidence.cleanup = true;
    } catch (e) { evidence.cleanupError = String(e); evidence.passed = false; }
    if (reopened) await tenant(async tx => {
      await one(tx, sql`update app.assistant_conversations set status='archived'
        where enterprise_id=${eid} and id=${cid} and status='open' and mode='ai'`);
      const final = await one(tx, sql`select status from app.assistant_conversations where enterprise_id=${eid} and id=${cid}`);
      assert.ok(final && final.status === 'archived');
      if (stageAssistant) await tx.execute(sql`update app.assistant_enterprise_settings set enabled=${stageAssistant.enabled},
        agent_config=${JSON.stringify(stageAssistant.agent_config)}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=${eid}`);
      await tx.execute(sql`update app.admin_users set status='disabled' where id=${managerId} and status='active'`);
    });
    if (before) {
      const after = hashes(), drift = Object.keys(before).filter(p => before[p] !== after[p]);
      fs.writeFileSync(path.join(output, 'binding.json'), JSON.stringify({ before, after, drift }, null, 2));
      evidence.drift = drift; assert.deepEqual(drift, []);
    }
  } catch (e) { evidence.cleanupError = e.stack || String(e); evidence.passed = false; process.exitCode = 1; }
  finally { try { if (server_?.listening) await new Promise(resolve => server_.close(resolve)); } finally { save(); try { await closePostgresPool(); } finally { if (release) { await release(); console.log(JSON.stringify({ passed: evidence.passed, error: evidence.error, cleanupError: evidence.cleanupError })); } } } }
});
