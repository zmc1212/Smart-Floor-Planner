/* V1-01 native acceptance: one real Agent V2 conversation with enterprise knowledge on,
 * a natural correction, a real web-search turn, then a fresh conversation with knowledge off.
 * Drives the Stable DevTools window through the registered native client; no injected answers. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { wechatideNativeClient } from './wechatide-native-client';

loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development'), 'Development only');
const root = path.resolve('..'), eid = '1454', customerId = '645';
const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/xiaok-v101-native-20261110/round-01');
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Retain the original round');
const target = new URL(process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner', 'Development database only');
fs.mkdirSync(output, { recursive: true });
const project = path.join(root, 'miniprogram');
type Report = Row & { checks: Row[]; failures: Row[]; turns: Row[]; passed?: boolean; error?: string; drift?: string[]; cleanupError?: string };
type PageMessage = { id: string; isUser: boolean; text: string; citations: Array<{ title: string; sourceKind: string }> };
type PageState = { route: string | null; loading: boolean; error: string; needsLogin: boolean; busy: boolean; generating: boolean;
  canSend: boolean; conversation: { id: string; status: unknown } | null; messages: PageMessage[] };
const report: Report = { startedAt: new Date().toISOString(), enterpriseId: eid, scope: 'V1-01 native: knowledge on, correction, web search, knowledge off', checks: [], failures: [], turns: [] };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const mp = wechatideNativeClient(project, output);
let installed = false, originalConfig: Row | undefined;

function walk(dir: string): string[] {
  return fs.readdirSync(path.join(root, dir), { recursive: true, withFileTypes: true })
    .filter(e => e.isFile()).map(e => (dir + '/' + path.relative(path.join(root, dir), path.join(e.parentPath, e.name))).replaceAll('\\', '/'));
}
const bind = () => Object.fromEntries([...new Set([
  ...walk('miniprogram/packages/assistant'), ...walk('miniprogram/utils'),
  ...walk('admin/src/lib/assistant'), 'admin/scripts/xiaok-v101-native-journey.ts',
].sort())].map(f => [f, createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')]));
const before = bind();
report.bindingBefore = createHash('sha256').update(JSON.stringify(before)).digest('hex');

async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    const data = await fn();
    report.checks.push({ name, passed: true, data }); console.log(name + ': PASS'); save(); return data;
  } catch (e) {
    report.checks.push({ name, passed: false, error: (e as Error).message });
    report.failures.push({ name, error: (e as Error).stack || (e as Error).message }); save(); throw e;
  }
}
async function waitFor<T>(label: string, fn: () => Promise<T | undefined | false>, timeoutMs: number, intervalMs = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await delay(intervalMs);
  }
  throw new Error(label + ' timed out after ' + Math.round(timeoutMs / 1000) + 's');
}
const evaluate = async <T>(source: string, ...args: unknown[]): Promise<T> => {
  const r = await mp.call('automation_evaluate', { project, fnSource: source, args });
  return r.result.result as T;
};
const pageData = () => evaluate<PageState>(`() => {
  const p = getCurrentPages().at(-1); if (!p) return { route: null };
  return { route: p.route, loading: !!p.data.loading, error: p.data.error || '', needsLogin: !!p.data.needsLogin,
    busy: !!p.data.busy, generating: !!p.data.generating, canSend: p.data.canSend !== false,
    conversation: p.data.conversation ? { id: String(p.data.conversation.id), status: p.data.conversation.status } : null,
    messages: (p.data.messages || []).map(m => ({ id: String(m.id), isUser: !!m.isUser,
      text: String(m.text || ((m.blocks || []).map(b => b.text || '').join(''))),
      citations: (m.citations || []).map(c => ({ title: c.title, sourceKind: c.sourceKind })) })) };
}`);

async function sendTurn(text: string, label: string) {
  const start = await pageData();
  assert.equal(start.route, 'packages/assistant/chat/chat', 'Chat route must be active');
  assert.ok(!start.needsLogin, 'Customer session must be accepted: ' + start.error);
  const count = start.messages.length;
  await mp.call('automation_element_action', { project, selector: 'textarea.composer-input', action: 'input', value: text });
  await delay(400);
  await mp.call('automation_element_action', { project, selector: '.send-button', action: 'tap' });
  const done = await waitFor('reply: ' + label, async () => {
    const now = await pageData();
    if (now.needsLogin) throw new Error('Session lost: ' + now.error);
    if (now.error && !now.generating && now.messages.length === count) throw new Error('Send error: ' + now.error);
    return now.messages.length >= count + 2 && !now.generating && !now.busy ? now : undefined;
  }, 420000);
  const user = done.messages.at(-2), reply = done.messages.at(-1)!;
  assert.ok(user?.isUser && user.text.includes(text.slice(0, 6)), 'Customer message rendered');
  assert.ok(!reply.isUser && reply.text.trim().length > 30, 'Assistant reply rendered');
  const conversationId = done.conversation?.id;
  assert.ok(conversationId, 'Conversation persisted');
  const run = await withTenantTransaction(eid, tx => one(tx, sql`select id,status,error_code,policy_snapshot
    from app.assistant_runs where enterprise_id=${eid} and conversation_id=${conversationId} order by id desc limit 1`));
  assert.equal(String(run!.status), 'succeeded', 'Run failed: ' + String(run!.error_code || ''));
  const protocol = ((run!.policy_snapshot as Row)?.agentRuntime as Row)?.protocol || null;
  assert.ok(String(protocol).includes('agent-v2'), 'Agent V2 runtime required, saw ' + String(protocol));
  const citationKinds = (await withTenantTransaction(eid, tx => rows(tx, sql`select distinct source_kind from app.assistant_message_citations
    where enterprise_id=${eid} and message_id=${reply.id}`))).map(r => String(r.source_kind));
  const turn = { label, conversationId, runId: String(run!.id), protocol, question: text, answer: reply.text, citations: reply.citations, citationKinds };
  (report.turns as Row[]).push(turn);
  const shot = path.join(output, 'turn-' + label + '.png');
  await mp.screenshot({ path: shot });
  report['shot-' + label] = { logical: [390, 844], bytes: fs.statSync(shot).size };
  save();
  return turn;
}

async function newConversation() {
  await evaluate(`() => { wx.removeStorageSync('assistant-active-conversation-v1'); }`);
  await mp.redirectTo('/packages/assistant/chat/chat?fresh=' + Date.now());
  const ready = await waitFor('fresh chat', async () => {
    const now = await pageData();
    if (now.needsLogin) throw new Error('Session lost on fresh conversation: ' + now.error);
    return now.route === 'packages/assistant/chat/chat' && !now.loading ? now : undefined;
  }, 90000);
  assert.equal(ready.messages.length, 0, 'Fresh conversation must start empty');
  return ready;
}

async function setKnowledge(enabled: boolean) {
  await withTenantTransaction(eid, tx => tx.execute(sql`update app.assistant_enterprise_settings
    set agent_config=jsonb_set(coalesce(agent_config,'{}'::jsonb),'{enterpriseKnowledgeEnabled}',${JSON.stringify(enabled)}::jsonb),
        policy_version=policy_version+1, updated_at=now() where enterprise_id=${eid}`));
  const row = await withPlatformTransaction(tx => one(tx, sql`select agent_config from app.assistant_enterprise_settings where enterprise_id=${eid}`));
  assert.equal((row!.agent_config as Row).enterpriseKnowledgeEnabled, enabled, 'Knowledge toggle persisted');
}

async function main() {
  report.lock = 'Development database run: the isolated 55432 acceptance lock does not apply; queue idleness is asserted below.';
  try {
  await step('one verified Stable project and idle queue', async () => {
    const queue = await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`));
    assert.equal(queue!.n, 0, 'Journey must start on an idle queue');
    const info = await mp.systemInfo();
    assert.equal(info.windowWidth, 390); assert.equal(info.windowHeight, 844); assert.equal(info.SDKVersion, '3.17.2');
    const config = await withPlatformTransaction(tx => one(tx, sql`select agent_config from app.assistant_enterprise_settings where enterprise_id=${eid}`));
    originalConfig = config; report.originalKnowledge = (config!.agent_config as Row)?.enterpriseKnowledgeEnabled ?? null;
    report.accounting = { before: String((await withPlatformTransaction(tx => one(tx, sql`select coalesce(max(id),0) id from app.ai_provider_attempts`)))!.id) };
    return { logical: [390, 844], SDKVersion: info.SDKVersion, knowledge: report.originalKnowledge };
  });

  await step('customer session installed in the real chat runtime', async () => {
    const version = Number((await withPlatformTransaction(tx => one(tx, sql`select context_version from app.users where id=${customerId}`)))!.context_version);
    const token = await new SignJWT({ sub: customerId, id: customerId, mode: 'customer', role: 'user', enterpriseId: eid, contextVersion: version, source: 'wechat' })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(customerId).setIssuedAt().setAudience('miniprogram').setExpirationTime('2h')
      .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    await evaluate(`(f) => {
      const app = getApp();
      const saved = { token: app.globalData.token, bootstrap: app.globalData.bootstrap, userInfo: app.globalData.userInfo, hydrate: app.hydrateStoredSession };
      app.__qaV101 = saved; app.hydrateStoredSession = async () => {};
      app.globalData.token = f.token; app.globalData.userInfo = { _id: f.customerId, role: 'user' };
      app.globalData.bootstrap = { current: { mode: 'customer', role: 'user', capabilities: ['customer.projects', 'customer.service', 'account'], context: { enterpriseId: f.enterpriseId } } };
      wx.setStorageSync('token', f.token); wx.removeStorageSync('assistant-active-conversation-v1');
    }`, { token, customerId, enterpriseId: eid });
    installed = true;
    await mp.redirectTo('/packages/assistant/chat/chat?fresh=' + Date.now());
    const ready = await waitFor('customer chat entry', async () => {
      const now = await pageData();
      if (now.needsLogin) throw new Error('Customer session rejected: ' + now.error);
      return now.route === 'packages/assistant/chat/chat' && !now.loading ? now : undefined;
    }, 120000);
    return { route: ready.route, conversation: ready.conversation, contextVersion: version };
  });

  await setKnowledge(true);
  await step('knowledge on: enterprise craft question with citation', async () => {
    const turn = await sendTurn('我家正在改水电，打压试验要做到什么程度才算合格？', 'knowledge-on');
    assert.ok(turn.citationKinds.includes('knowledge'), 'Enterprise citation required');
    return turn;
  });
  await step('natural correction is carried by Agent V2', async () => {
    const turn = await sendTurn('我说错了，不是卫生间，是厨房的给水管。厨房打压有什么不同？', 'correction');
    assert.ok(/厨房/.test(turn.answer), 'Correction reflected in the answer');
    return turn;
  });
  await step('real web search with readable sources', async () => {
    const turn = await sendTurn('帮我查一下网上关于厨房通风的建议，告诉我出处。', 'web-search');
    assert.ok(turn.citations.length > 0 && turn.citationKinds.some(k => k !== 'knowledge'), 'Web citation required');
    return turn;
  });

  await setKnowledge(false);
  await step('knowledge off: general advice without enterprise claim', async () => {
    await newConversation();
    const turn = await sendTurn('厨房防水施工有什么要注意的？', 'knowledge-off');
    assert.ok(!turn.citationKinds.includes('knowledge'), 'No enterprise citation when knowledge is off');
    assert.ok(!/我们企业|公司标准|精艺/.test(turn.answer), 'No enterprise-standard claim when knowledge is off');
    return turn;
  });
  report.passed = true;
  } catch (e) {
  report.passed = false; report.error = (e as Error).message; process.exitCode = 1; console.error((e as Error).message);
  try { report.lastState = await pageData(); } catch { /* keep the error only */ }
} finally {
  try { await setKnowledge(originalConfig ? (originalConfig.agent_config as Row)?.enterpriseKnowledgeEnabled === true : true); report.knowledgeRestored = true; }
  catch (e) { report.knowledgeRestored = false; report.restoreError = (e as Error).message; report.passed = false; }
  if (installed) try {
    await evaluate(`() => { const a = getApp(), s = a.__qaV101; if (!s) return false;
      a.globalData.token = s.token; a.globalData.bootstrap = s.bootstrap; a.globalData.userInfo = s.userInfo; a.hydrateStoredSession = s.hydrate;
      delete a.__qaV101; return true; }`);
    await mp.reLaunch('/pages/index/index');
  } catch (e) { report.cleanupError = (e as Error).message; report.passed = false; }
  await mp.disconnect().catch(() => {});
  const after = bind();
  report.drift = Object.keys(before).filter(f => before[f] !== after[f]);
  if (report.drift.length) { report.passed = false; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify({ passed: report.passed, checks: (report.checks as Row[]).length, drift: report.drift.length, error: report.error }));
  await closePostgresPool();
}
}
main();
