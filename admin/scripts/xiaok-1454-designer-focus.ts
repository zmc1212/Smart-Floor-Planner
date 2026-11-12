/** 1454 focused client check: designer recommendation cards and the public
 * designer profile opened from the card. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { wechatideNativeClient } from './wechatide-native-client';

loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development'));
const root = path.resolve('..'), eid = '1454', customerId = '645';
const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/xiaok-1454-customer-test-20261110/designer-01');
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Retain the original round');
fs.mkdirSync(output, { recursive: true });
const project = path.join(root, 'miniprogram');
const mp = wechatideNativeClient(project, output);
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const report: Report = { startedAt: new Date().toISOString(), checks: [], failures: [] };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const evaluate = async <T>(source: string, ...args: unknown[]): Promise<T> => (await mp.call('automation_evaluate', { project, fnSource: source, args })).result.result as T;
async function waitFor<T>(label: string, fn: () => Promise<T | undefined | false>, timeoutMs: number, intervalMs = 2500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) { const v = await fn(); if (v) return v; await delay(intervalMs); }
  throw new Error(label + ' timed out after ' + Math.round(timeoutMs / 1000) + 's');
}
type Report = Row & { checks: Row[]; failures: Row[]; passed?: boolean; error?: string };
type PageMessage = { id: string; isUser: boolean; text: string; citations: number;
  designer: { items: Array<{ authorId: string; authorName: string; workTitle: string; style: string; specialty: string }> } | null };
type PageState = { route: string | null; loading: boolean; needsLogin: boolean; error: string; busy: boolean; generating: boolean;
  conversation: { id: string } | null; messages: PageMessage[] };
type DesignerProfile = { route: string | null; name: string; title: string; city: string; styles: string[];
  works: Array<{ title: string; style: string }>; totalWorks: number; loading: boolean; error: string };
const page = () => evaluate<PageState>(`() => { const p = getCurrentPages().at(-1); if (!p) return { route: null }; const d = p.data;
  const text = m => String(m.text || ((m.blocks || []).map(b => b.text || '').join('')));
  return { route: p.route, loading: !!d.loading, needsLogin: !!d.needsLogin, error: d.error || '', busy: !!d.busy, generating: !!d.generating,
    conversation: d.conversation ? { id: String(d.conversation.id) } : null,
    messages: (d.messages || []).map(m => ({ id: String(m.id), isUser: !!m.isUser, text: text(m),
      citations: (m.citations || []).length,
      designer: m.designerRecommendation && Array.isArray(m.designerRecommendation.items)
        ? { items: m.designerRecommendation.items.map(c => ({ authorId: String(c.authorId), authorName: c.authorName || '',
            workTitle: c.work && c.work.title || '', style: c.work && c.work.primaryStyle || '', specialty: c.specialtyLine || '' })) } : null })) }; }`);

let installed = false;
async function main() {
  try {
    const version = Number((await withPlatformTransaction(tx => one(tx, sql`select context_version from app.users where id=${customerId}`)))!.context_version);
    const token = await new SignJWT({ sub: customerId, id: customerId, mode: 'customer', role: 'user', enterpriseId: eid, contextVersion: version, source: 'wechat' })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(customerId).setIssuedAt().setAudience('miniprogram').setExpirationTime('2h')
      .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    await evaluate(`(f) => { const app = getApp();
      const saved = { token: app.globalData.token, bootstrap: app.globalData.bootstrap, userInfo: app.globalData.userInfo, hydrate: app.hydrateStoredSession };
      app.__qaDesigner = saved; app.hydrateStoredSession = async () => {};
      app.globalData.token = f.token; app.globalData.userInfo = { _id: f.customerId, role: 'user' };
      app.globalData.bootstrap = { current: { mode: 'customer', role: 'user', capabilities: ['customer.projects','customer.service','account'], context: { enterpriseId: f.enterpriseId } } };
      wx.setStorageSync('token', f.token); wx.removeStorageSync('assistant-active-conversation-v1'); }`,
      { token, customerId, enterpriseId: eid });
    installed = true;
    await mp.redirectTo('/packages/assistant/chat/chat?fresh=' + Date.now());
    await waitFor('chat ready', async () => {
      const now = await page(); if (now.needsLogin) throw new Error('Session rejected: ' + now.error);
      return now.route === 'packages/assistant/chat/chat' && !now.loading ? now : undefined;
    }, 120000);
    const start = await page();
    const count = start.messages.length;
    const text = '我喜欢现代简约风格，帮我推荐几位合适的设计师';
    await mp.call('automation_element_action', { project, selector: 'textarea.composer-input', action: 'input', value: text });
    await delay(400);
    await mp.call('automation_element_action', { project, selector: '.send-button', action: 'tap' });
    const done = await waitFor('designer reply', async () => {
      const now = await page(); if (now.needsLogin) throw new Error('Session lost');
      return now.messages.length >= count + 2 && !now.generating && !now.busy ? now : undefined;
    }, 420000);
    const reply = done.messages.at(-1)!;
    assert.ok(reply.designer && reply.designer.items.length >= 1, 'Designer cards rendered');
    await mp.screenshot({ path: path.join(output, 'designer-cards.png') });
    const card = reply.designer.items[0];
    await mp.call('automation_element_action', { project, selector: '.designer-card-head', action: 'tap' });
    const profile = await waitFor('designer profile', async () => {
      const r = await evaluate<DesignerProfile>(`() => { const p = getCurrentPages().at(-1); if (!p || !String(p.route).includes('designer')) return null;
        const d = p.data; return { route: p.route, name: d.designer && d.designer.name || '', title: d.designer && d.designer.professionalTitle || '',
          city: d.designer && d.designer.cityLabel || '', styles: d.designer && d.designer.styles || [],
          works: (d.designer && d.designer.works || []).map(w => ({ title: w.title || '', style: w.primaryStyle || '' })).slice(0, 6),
          totalWorks: d.totalWorks || 0, loading: !!d.loading, error: d.error || '' }; }`);
      return r && r.route && !r.loading ? r : undefined;
    }, 90000);
    assert.ok(String(profile.name).length > 0, 'Profile name: ' + String(profile.error || ''));
    await mp.screenshot({ path: path.join(output, 'designer-profile.png') });
    const run = (await withTenantTransaction(eid, tx => one(tx, sql`select id,status,error_code,policy_snapshot from app.assistant_runs
      where enterprise_id=${eid} and conversation_id=${Number(done.conversation!.id)} and purpose='reply' order by id desc limit 1`)))!;
    report.checks.push({ name: 'designer recommendation and profile', passed: true, data: { runId: String(run.id),
      protocol: ((run.policy_snapshot as Row)?.agentRuntime as Row)?.protocol || null, card, profile } });
    report.passed = true;
  } catch (e) {
    report.passed = false; report.error = (e as Error).message; process.exitCode = 1;
    report.failures.push({ error: (e as Error).stack || (e as Error).message });
    try { report.lastState = await page(); } catch { /* keep the error */ }
  } finally {
    if (installed) try {
      await evaluate(`() => { const a = getApp(), s = a.__qaDesigner; if (!s) return false;
        a.globalData.token = s.token; a.globalData.bootstrap = s.bootstrap; a.globalData.userInfo = s.userInfo; a.hydrateStoredSession = s.hydrate;
        delete a.__qaDesigner; return true; }`);
      await mp.reLaunch('/pages/index/index');
    } catch (e) { report.cleanupError = (e as Error).message; }
    await mp.disconnect().catch(() => {});
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, error: report.error }));
    await closePostgresPool();
  }
}
main();
