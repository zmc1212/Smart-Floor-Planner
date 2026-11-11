/** Read, acknowledge and re-enter the already delivered daily report 480
 * (binding 422 / project 237) as the customer, then show the card in the client. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { wechatideNativeClient } from './wechatide-native-client';

loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development'));
const root = path.resolve('..'), eid = '1454', customerId = '645', leadId = '3132', bindingId = '422', projectId = '237', reportId = '480';
const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/xiaok-1454-customer-test-20261110/daily-02');
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Retain the original round');
fs.mkdirSync(output, { recursive: true });
const base = 'http://127.0.0.1:3006/api/miniprogram/assistant';
const project = path.join(root, 'miniprogram');
const mp = wechatideNativeClient(project, output);
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const report: Report = { startedAt: new Date().toISOString(), checks: [], failures: [] };
type Report = Row & { checks: Row[]; failures: Row[]; passed?: boolean; error?: string; cleanupError?: string };
type PageState = { route: string | null; loading: boolean; followupActive: boolean; followupBindings: string[];
  followupReports: Array<{ reportId: string; kind: string; ready: boolean; readAt: unknown; title: string }> };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const platformOne = (q: ReturnType<typeof sql>) => withPlatformTransaction(tx => one(tx, q));
async function waitFor<T>(label: string, fn: () => Promise<T | undefined | false>, timeoutMs: number, intervalMs = 2500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) { const v = await fn(); if (v) return v; await delay(intervalMs); }
  throw new Error(label + ' timed out after ' + Math.round(timeoutMs / 1000) + 's');
}
async function api(token: string, route: string, init: { method?: string; body?: Row; entry?: string; key?: string; expect?: number | number[] } = {}) {
  const headers: Record<string, string> = { Authorization: 'Bearer ' + token };
  if (init.entry) headers['X-Assistant-Entry'] = init.entry;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.key) headers['Idempotency-Key'] = init.key;
  const response = await fetch(base + route, { method: init.method || (init.body !== undefined ? 'POST' : 'GET'), headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(60000) });
  const data = await response.json().catch(() => ({})) as Row;
  const expected = init.expect ?? 200;
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), route + ': ' + response.status + '/' + String(data.code || data.error || ''));
  return data.data as Row;
}
const evaluate = async <T>(source: string, ...args: unknown[]): Promise<T> => (await mp.call('automation_evaluate', { project, fnSource: source, args })).result.result as T;
const page = () => evaluate<PageState>(`() => { const p = getCurrentPages().at(-1); if (!p) return { route: null }; const d = p.data;
  return { route: p.route, loading: !!d.loading, followupActive: !!d.followupActive,
    followupBindings: (d.followupBindings || []).map(b => String(b.bindingId)),
    followupReports: (d.followupReports || []).map(r => ({ reportId: String(r.reportId), kind: r.kind, ready: !!r.ready, readAt: r.readAt || null, title: r.cardTitle || r.title || '' })) }; }`);
let installed = false;
async function main() {
  try {
    const version = Number((await platformOne(sql`select context_version from app.users where id=${customerId}`))!.context_version);
    const token = await new SignJWT({ sub: customerId, id: customerId, mode: 'customer', role: 'user', enterpriseId: eid, contextVersion: version, source: 'wechat' })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(customerId).setIssuedAt().setAudience('miniprogram').setExpirationTime('2h')
      .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    const entry = String((await api(token, '/entry-context', { body: { leadId } })).entryToken);
    const listed = await api(token, `/followups/${bindingId}/reports?projectId=${projectId}&kind=daily`, { entry });
    const item = (listed.items as Row[] || []).find(r => String(r.reportId) === reportId);
    assert.ok(item, 'Daily 480 listed');
    const revision = Number(item.revision || 1);
    const detail = await api(token, `/followups/${bindingId}/reports/${reportId}?revision=${revision}`, { entry });
    assert.equal(detail.available, true, 'Daily 480 available');
    assert.ok(Array.isArray(detail.body) && detail.body.length > 0, 'Daily 480 body composed');
    assert.ok(detail.readToken, 'Read token issued');
    await api(token, `/followups/${bindingId}/reports/${reportId}/acknowledge`, { entry, key: randomUUID(),
      body: { revision, readToken: String(detail.readToken) } });
    const reread = await api(token, `/followups/${bindingId}/reports/${reportId}?revision=${revision}`, { entry });
    assert.ok(reread.readAt, 'Acknowledgement persisted');
    const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(new Date());
    const history = await api(token, `/followups/${bindingId}/reports?month=${month}&kind=daily&projectId=${projectId}`, { entry });
    assert.ok((history.items as Row[] || []).some(r => String(r.reportId) === reportId), 'Daily appears in history');
    const destinations = await api(token, '/followups', { entry });
    assert.ok((destinations.items as Row[] || []).some(b => String(b.bindingId) === bindingId), 'Follow-up destination on reentry');
    const conversation = await api(token, `/followups/${bindingId}/conversation`, { entry });
    assert.ok(conversation.id, 'Follow-up conversation readable on reentry');
    report.service = { reportId, revision, bodyParts: (detail.body as Row[]).length, readAt: reread.readAt,
      historyItems: (history.items as Row[]).length, conversationId: String(conversation.id) };

    await evaluate(`(f) => { const app = getApp();
      const saved = { token: app.globalData.token, bootstrap: app.globalData.bootstrap, userInfo: app.globalData.userInfo, hydrate: app.hydrateStoredSession };
      app.__qaDailyRead = saved; app.hydrateStoredSession = async () => {};
      app.globalData.token = f.token; app.globalData.userInfo = { _id: f.customerId, role: 'user' };
      app.globalData.bootstrap = { current: { mode: 'customer', role: 'user', capabilities: ['customer.projects','customer.service','account'], context: { enterpriseId: f.enterpriseId } } };
      wx.setStorageSync('token', f.token); wx.removeStorageSync('assistant-active-conversation-v1'); }`,
      { token, customerId, enterpriseId: eid });
    installed = true;
    await mp.redirectTo('/packages/assistant/chat/chat?fresh=' + Date.now());
    await waitFor('chat ready', async () => {
      const now = await page(); return now.route === 'packages/assistant/chat/chat' && !now.loading ? now : undefined;
    }, 120000);
    await evaluate(`() => { const p = getCurrentPages().at(-1); p.openHistory(); return true; }`);
    await waitFor('follow-up list', async () => (await page()).followupBindings.includes(bindingId) || undefined, 60000);
    await evaluate(`(id) => { const p = getCurrentPages().at(-1); p.selectFollowup({ currentTarget: { dataset: { id } } }); return true; }`, bindingId);
    const card = await waitFor('daily card visible', async () => {
      const now = await page();
      return now.followupActive ? now.followupReports.find(r => r.reportId === reportId) : undefined;
    }, 120000);
    assert.equal(card.kind, 'daily');
    assert.ok(card.readAt, 'Client shows the delivered card as read');
    await mp.screenshot({ path: path.join(output, 'daily-card.png') });
    report.client = { reportId: card.reportId, readAt: card.readAt };
    report.checks.push({ name: 'daily read, acknowledged, history and reentry', passed: true, data: report.service });
    report.passed = true;
  } catch (e) {
    report.passed = false; report.error = (e as Error).message; process.exitCode = 1;
    report.failures.push({ error: (e as Error).stack || (e as Error).message }); save();
  } finally {
    if (installed) try {
      await evaluate(`() => { const a = getApp(), s = a.__qaDailyRead; if (!s) return false;
        a.globalData.token = s.token; a.globalData.bootstrap = s.bootstrap; a.globalData.userInfo = s.userInfo; a.hydrateStoredSession = s.hydrate;
        delete a.__qaDailyRead; return true; }`);
      await mp.reLaunch('/pages/index/index');
    } catch (e) { report.cleanupError = (e as Error).message; }
    await mp.disconnect().catch(() => {});
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ passed: report.passed, error: report.error, checks: (report.checks as Row[]).length }));
    await closePostgresPool();
  }
}
main();
