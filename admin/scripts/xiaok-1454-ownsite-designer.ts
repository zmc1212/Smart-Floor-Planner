/** 1454 focused client journey: the customer's own-site question inside the
 * existing report-grounded follow-up, then a designer recommendation opened
 * from the real card. Each step records pass/fail and the run continues. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SignJWT } from 'jose';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { wechatideNativeClient } from './wechatide-native-client';

loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development'), 'Development only');
const root = path.resolve('..'), eid = '1454', customerId = '645', bindingId = '422', projectId = '237';
const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/xiaok-1454-customer-test-20261110/focus-01');
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Retain the original round');
const target = new URL(process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
fs.mkdirSync(output, { recursive: true });
const project = path.join(root, 'miniprogram');
const mp = wechatideNativeClient(project, output);
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const report: Row = { startedAt: new Date().toISOString(), enterpriseId: eid, scope: 'own-site report question + designer profile', checks: [], failures: [] };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const tenantOne = (q: ReturnType<typeof sql>) => withTenantTransaction(eid, tx => one(tx, q));
const platformOne = (q: ReturnType<typeof sql>) => withPlatformTransaction(tx => one(tx, q));
const evaluate = async <T>(source: string, ...args: unknown[]): Promise<T> => {
  const r = await mp.call('automation_evaluate', { project, fnSource: source, args });
  return r.result.result as T;
};
async function waitFor<T>(label: string, fn: () => Promise<T | undefined | false>, timeoutMs: number, intervalMs = 2500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) { const v = await fn(); if (v) return v; await delay(intervalMs); }
  throw new Error(label + ' timed out after ' + Math.round(timeoutMs / 1000) + 's');
}
const pageData = () => evaluate<Row>(`() => {
  const p = getCurrentPages().at(-1); if (!p) return { route: null };
  const d = p.data; const text = m => String(m.text || ((m.blocks || []).map(b => b.text || '').join('')));
  return { route: p.route, loading: !!d.loading, needsLogin: !!d.needsLogin, error: d.error || '', followupActive: !!d.followupActive,
    conversation: d.conversation ? { id: String(d.conversation.id) } : null,
    messages: (d.messages || []).map(m => ({ id: String(m.id), isUser: !!m.isUser, text: text(m),
      citations: (m.citations || []).map(c => ({ title: c.title || '', sourceKind: c.sourceKind || '' })),
      designer: m.designerRecommendation && Array.isArray(m.designerRecommendation.items)
        ? { items: m.designerRecommendation.items.map(c => ({ authorId: String(c.authorId), authorName: c.authorName || '',
            workTitle: c.work && c.work.title || '', style: c.work && c.work.primaryStyle || '', specialty: c.specialtyLine || '' })) } : null })),
    followupBindings: (d.followupBindings || []).map(b => ({ id: String(b.bindingId) })),
    followupReports: (d.followupReports || []).map(r => ({ reportId: String(r.reportId), revision: Number(r.revision), kind: r.kind, available: r.available !== false, ready: !!r.ready, readAt: r.readAt || null, title: r.cardTitle || r.title || '' })),
    reportQuestion: { selected: !!(d.reportQuestion && d.reportQuestion.selected), title: (d.reportQuestion && d.reportQuestion.title) || '', error: (d.reportQuestion && d.reportQuestion.error) || '' },
    followupChat: d.followupChat ? { messages: (d.followupChat.messages || []).map(m => ({ id: String(m.id), isUser: !!(m.isUser || m.authorKind === 'user'), text: text(m) })), generating: !!d.followupChat.generating, busy: !!d.followupChat.busy } : null };
}`);
async function send(text: string, followup: boolean) {
  const start = await pageData();
  assert.equal(start.route, 'packages/assistant/chat/chat');
  assert.ok(!start.needsLogin, 'Session rejected: ' + start.error);
  const count = followup ? start.followupChat.messages.length : start.messages.length;
  await mp.call('automation_element_action', { project, selector: 'textarea.composer-input', action: 'input', value: text });
  await delay(400);
  await mp.call('automation_element_action', { project, selector: '.send-button', action: 'tap' });
  const done = await waitFor('reply', async () => {
    const now = await pageData();
    if (now.needsLogin) throw new Error('Session lost: ' + now.error);
    const state = followup ? now.followupChat : now;
    if (!state) return undefined;
    return state.messages.length >= count + 2 && !state.generating && !state.busy ? now : undefined;
  }, 420000);
  const state = followup ? done.followupChat : done;
  return { user: state.messages.at(-2), reply: state.messages.at(-1), conversationId: followup ? '1522' : done.conversation?.id };
}
const runFor = (cid: string) => tenantOne(sql`select id,status,error_code,policy_snapshot from app.assistant_runs
  where enterprise_id=${eid} and conversation_id=${Number(cid)} and purpose='reply' order by id desc limit 1`);

let installed = false;
async function main() {
  panel: {
    try {
      await waitFor('idle queue', async () => {
        const q = await platformOne(sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`);
        return Number(q!.n) === 0 ? q : undefined;
      }, 120000);
      const version = Number((await platformOne(sql`select context_version from app.users where id=${customerId}`))!.context_version);
      const token = await new SignJWT({ sub: customerId, id: customerId, mode: 'customer', role: 'user', enterpriseId: eid, contextVersion: version, source: 'wechat' })
        .setProtectedHeader({ alg: 'HS256' }).setSubject(customerId).setIssuedAt().setAudience('miniprogram').setExpirationTime('2h')
        .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
      await evaluate(`(f) => {
        const app = getApp();
        const saved = { token: app.globalData.token, bootstrap: app.globalData.bootstrap, userInfo: app.globalData.userInfo, hydrate: app.hydrateStoredSession };
        app.__qaFocus = saved; app.hydrateStoredSession = async () => {};
        app.globalData.token = f.token; app.globalData.userInfo = { _id: f.customerId, role: 'user' };
        app.globalData.bootstrap = { current: { mode: 'customer', role: 'user', capabilities: ['customer.projects', 'customer.service', 'account'], context: { enterpriseId: f.enterpriseId } } };
        wx.setStorageSync('token', f.token); wx.removeStorageSync('assistant-active-conversation-v1');
      }`, { token, customerId, enterpriseId: eid });
      installed = true;
      await mp.redirectTo('/packages/assistant/chat/chat?fresh=' + Date.now());
      await waitFor('chat ready', async () => {
        const now = await pageData();
        if (now.needsLogin) throw new Error('Customer session rejected: ' + now.error);
        return now.route === 'packages/assistant/chat/chat' && !now.loading ? now : undefined;
      }, 120000);

      try {
        await evaluate(`() => { const p = getCurrentPages().at(-1); p.openHistory(); return true; }`);
        await waitFor('follow-up list', async () => (await pageData()).followupBindings.some(b => b.id === bindingId) || undefined, 60000);
        await evaluate(`(id) => { const p = getCurrentPages().at(-1); p.selectFollowup({ currentTarget: { dataset: { id } } }); return true; }`, bindingId);
        const thread = await waitFor('follow-up thread', async () => {
          const now = await pageData(); return now.followupActive && now.followupReports.length ? now : undefined;
        }, 90000);
        if (!thread.reportQuestion.selected) {
          const daily = thread.followupReports.find((r: Row) => r.kind === 'daily' && r.ready && r.available);
          assert.ok(daily, 'A ready daily report exists');
          await evaluate(`(f) => { const p = getCurrentPages().at(-1); p.askFollowupReport({ currentTarget: { dataset: { report: f.report, revision: f.revision } } }); return true; }`,
            { report: String(daily.reportId), revision: Number(daily.revision) });
          await waitFor('report question', async () => (await pageData()).reportQuestion.selected || undefined, 60000);
        }
        const selected = (await pageData()).reportQuestion;
        const turn = await send('我家现在施工到哪一步了？最近工地上都做了些什么？', true);
        const run = await waitFor('own-site run', async () => {
          const r = await runFor('1522'); return r && !['queued', 'running'].includes(String(r.status)) ? r : undefined;
        }, 45000);
        const answer = String(turn.reply.text);
        const deflection = /这件事需要现场确认，请和现场团队核实/.test(answer);
        await mp.screenshot({ path: path.join(output, 'own-site-answer.png') });
        (report.checks as Row[]).push({ name: 'own-site grounded question', passed: !deflection, data: {
          reportQuestion: selected, runId: String(run!.id), protocol: ((run!.policy_snapshot as Row)?.agentRuntime as Row)?.protocol || null,
          question: '我家现在施工到哪一步了？最近工地上都做了些什么？', answer, deflection } });
        if (deflection) (report.failures as Row[]).push({ name: 'own-site grounded question', error: 'coordination referral instead of a grounded answer' });
        save();
      } catch (e) {
        (report.checks as Row[]).push({ name: 'own-site grounded question', passed: false, error: (e as Error).message });
        (report.failures as Row[]).push({ name: 'own-site grounded question', error: (e as Error).stack || (e as Error).message }); save();
      }

      try {
        await evaluate(`() => { const p = getCurrentPages().at(-1); p.back(); return true; }`);
        await waitFor('back to chat', async () => !(await pageData()).followupActive || undefined, 30000);
        const turn = await send('我喜欢现代简约风格，帮我推荐几位合适的设计师', false);
        const cards = turn.reply.designer;
        assert.ok(cards && cards.items.length >= 1, 'Designer cards rendered');
        await mp.screenshot({ path: path.join(output, 'designer-cards.png') });
        const card = cards.items[0];
        await mp.call('automation_element_action', { project, selector: '.designer-card-head', action: 'tap' });
        const profile = await waitFor('designer profile', async () => {
          const r = await evaluate<Row>(`() => { const p = getCurrentPages().at(-1); if (!p || !String(p.route).includes('designer')) return null;
            const d = p.data; return { route: p.route, name: d.designer && d.designer.name || '', title: d.designer && d.designer.professionalTitle || '',
              city: d.designer && d.designer.cityLabel || '', styles: d.designer && d.designer.styles || [],
              works: (d.designer && d.designer.works || []).map(w => ({ title: w.title || '', style: w.primaryStyle || '' })).slice(0, 6),
              totalWorks: d.totalWorks || 0, loading: !!d.loading, error: d.error || '' }; }`);
          return r && r.route && !r.loading ? r : undefined;
        }, 90000);
        assert.ok(String(profile.name).length > 0, 'Profile name: ' + String(profile.error || ''));
        await mp.screenshot({ path: path.join(output, 'designer-profile.png') });
        const run = await runFor(String((await pageData()).conversation!.id));
        (report.checks as Row[]).push({ name: 'designer recommendation and profile', passed: true, data: {
          runId: String(run!.id), card, profile } });
        report.designer = { card, profile };
        await mp.call('automation_navigate', { project, action: 'navigateBack' });
        save();
      } catch (e) {
        (report.checks as Row[]).push({ name: 'designer recommendation and profile', passed: false, error: (e as Error).message });
        (report.failures as Row[]).push({ name: 'designer recommendation and profile', error: (e as Error).stack || (e as Error).message }); save();
      }
      report.passed = !(report.failures as Row[]).length;
      if (!report.passed) process.exitCode = 1;
    } catch (e) {
      report.passed = false; report.error = (e as Error).message; process.exitCode = 1;
      (report.failures as Row[]).push({ name: 'setup', error: (e as Error).stack || (e as Error).message });
    } finally {
      if (installed) try {
        await evaluate(`() => { const a = getApp(), s = a.__qaFocus; if (!s) return false;
          a.globalData.token = s.token; a.globalData.bootstrap = s.bootstrap; a.globalData.userInfo = s.userInfo; a.hydrateStoredSession = s.hydrate;
          delete a.__qaFocus; return true; }`);
        await mp.reLaunch('/pages/index/index');
      } catch (e) { report.cleanupError = (e as Error).message; }
      await mp.disconnect().catch(() => {});
      report.finishedAt = new Date().toISOString(); save();
      console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failures: report.failures.length }));
      await closePostgresPool();
    }
  }
}
void main();
