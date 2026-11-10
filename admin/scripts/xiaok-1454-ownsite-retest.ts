/** Single-item retest after the report-answer fix: the customer's own-site
 * question on the same report 474 that previously returned the fixed referral.
 * New output directory; no report regeneration, no other capability checks. */
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
assert.ok(process.argv.includes('--development'), 'Development only');
const root = path.resolve('..'), eid = '1454', customerId = '645', bindingId = '422';
const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/xiaok-ownsite-fix-20261110/ownsite-fix-01');
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Retain the original round');
const target = new URL(process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
fs.mkdirSync(output, { recursive: true });
const project = path.join(root, 'miniprogram');
const mp = wechatideNativeClient(project, output);
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const report: Row = { startedAt: new Date().toISOString(), enterpriseId: eid, scope: 'own-site report question retest', checks: [], failures: [] };
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
const fixedReferral = '这件事需要现场确认，请和现场团队核实。';
const pageData = () => evaluate<Row>(`() => {
  const p = getCurrentPages().at(-1); if (!p) return { route: null };
  const d = p.data; const text = m => String(m.text || ((m.blocks || []).map(b => b.text || '').join('')));
  return { route: p.route, loading: !!d.loading, needsLogin: !!d.needsLogin, error: d.error || '', followupActive: !!d.followupActive,
    conversation: d.conversation ? { id: String(d.conversation.id) } : null,
    followupBindings: (d.followupBindings || []).map(b => ({ id: String(b.bindingId) })),
    followupReports: (d.followupReports || []).map(r => ({ reportId: String(r.reportId), revision: Number(r.revision), kind: r.kind,
      available: r.available !== false, ready: !!r.ready, readAt: r.readAt || null, title: r.cardTitle || r.title || '' })),
    reportQuestion: { selected: !!(d.reportQuestion && d.reportQuestion.selected), title: (d.reportQuestion && d.reportQuestion.title) || '',
      error: (d.reportQuestion && d.reportQuestion.error) || '' },
    followupChat: d.followupChat ? { messages: (d.followupChat.messages || []).map(m => ({ id: String(m.id), isUser: !!(m.isUser || m.authorKind === 'user'),
      text: text(m), citations: (m.citations || []).map(c => ({ title: c.title || '', sourceKind: c.sourceKind || '' })) })), generating: !!d.followupChat.generating, busy: !!d.followupChat.busy } : null };
}`);

let installed = false;
async function main() {
  try {
    await waitFor('idle queue', async () => {
      const q = await platformOne(sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`);
      return Number(q!.n) === 0 ? q : undefined;
    }, 180000);
    const version = Number((await platformOne(sql`select context_version from app.users where id=${customerId}`))!.context_version);
    const token = await new SignJWT({ sub: customerId, id: customerId, mode: 'customer', role: 'user', enterpriseId: eid, contextVersion: version, source: 'wechat' })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(customerId).setIssuedAt().setAudience('miniprogram').setExpirationTime('2h')
      .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    await evaluate(`(f) => {
      const app = getApp();
      const saved = { token: app.globalData.token, bootstrap: app.globalData.bootstrap, userInfo: app.globalData.userInfo, hydrate: app.hydrateStoredSession };
      app.__qaFix = saved; app.hydrateStoredSession = async () => {};
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

    await evaluate(`() => { const p = getCurrentPages().at(-1); p.openHistory(); return true; }`);
    await waitFor('follow-up list', async () => (await pageData()).followupBindings?.some((b: Row) => b.id === bindingId) || undefined, 60000);
    await evaluate(`(id) => { const p = getCurrentPages().at(-1); p.selectFollowup({ currentTarget: { dataset: { id } } }); return true; }`, bindingId);
    const thread = await waitFor('follow-up thread', async () => {
      const now = await pageData(); return now.followupActive && now.followupReports.length ? now : undefined;
    }, 90000);
    const daily = thread.followupReports.find((r: Row) => String(r.reportId) === '474' && r.ready && r.available)
      || thread.followupReports.find((r: Row) => r.kind === 'daily' && r.ready && r.available);
    assert.ok(daily, 'A ready daily report exists');
    if (!thread.reportQuestion.selected || !/11月9日/.test(thread.reportQuestion.title)) {
      await evaluate(`(f) => { const p = getCurrentPages().at(-1); p.askFollowupReport({ currentTarget: { dataset: { report: f.report, revision: f.revision } } }); return true; }`,
        { report: String(daily.reportId), revision: Number(daily.revision) });
      await waitFor('report question', async () => (await pageData()).reportQuestion.selected || undefined, 60000);
    }
    const selected = (await pageData()).reportQuestion;
    const start = await pageData();
    const count = start.followupChat.messages.length;
    const baseline = String((await tenantOne(sql`select max(id)::text id from app.assistant_runs
      where enterprise_id=${eid} and conversation_id='1522'`))?.id || '0');
    await mp.call('automation_element_action', { project, selector: 'textarea.composer-input', action: 'input', value: '我家现在施工到哪一步了？最近工地上都做了些什么？' });
    await delay(400);
    await mp.call('automation_element_action', { project, selector: '.send-button', action: 'tap' });
    const done = await waitFor('reply', async () => {
      const now = await pageData();
      if (now.needsLogin) throw new Error('Session lost: ' + now.error);
      const state = now.followupChat;
      if (!state) return undefined;
      if (state.messages.length >= count + 2 && !state.generating && !state.busy) return now;
      const run = await tenantOne(sql`select id,status,error_code from app.assistant_runs where enterprise_id=${eid}
        and conversation_id='1522' and id>${baseline} order by id desc limit 1`);
      if (run && String(run.status) === 'failed') throw new Error(`run ${run.id} failed: ${run.error_code}`);
      return undefined;
    }, 300000);
    const turn = done.followupChat;
    const answer = String(turn.messages.at(-1)?.text || '');
    const citations = turn.messages.at(-1)?.citations || [];
    const deflection = answer.includes(fixedReferral);
    const grounded = /软装|安装|阶段|记录|待核对|插座|本期/.test(answer);
    await mp.screenshot({ path: path.join(output, 'own-site-answer.png') });
    const run = await waitFor('own-site run', async () => {
      const r = await tenantOne(sql`select id,status,error_code,policy_snapshot,created_at from app.assistant_runs
        where enterprise_id=${eid} and conversation_id='1522' and purpose='reply' and id>${baseline} order by id desc limit 1`);
      return r && !['queued', 'running'].includes(String(r.status)) ? r : undefined;
    }, 60000);
    const steps = await tenantOne(sql`select count(*)::int n from app.assistant_run_steps where enterprise_id=${eid}
      and run_id=${String(run!.id)} and kind in ('agent_model','agent_tool')`);
    const persisted = await tenantOne(sql`select private_checkpoint from app.assistant_run_steps where enterprise_id=${eid}
      and run_id=${String(run!.id)} and step_seq=1006`);
    const answerCitations = [...new Set(((persisted?.private_checkpoint as Row)?.segments || [])
      .flatMap(s => ((s as Row).citations || []).map(c => String((c as Row).sourceId))))];
    await evaluate(`() => { const p = getCurrentPages().at(-1); p.viewReportQuestion(); return true; }`);
    const opened = await waitFor('report detail', async () => {
      const d = await evaluate<Row>(`() => { const p = getCurrentPages().at(-1); const v = (p.data || {}).followupDetail;
        return v ? { id: String(v.reportId || v.id || ''), text: JSON.stringify(v).slice(0, 1500) } : undefined; }`);
      return d && /11月9日|2026-11-09|软装/.test(String(d.text)) ? d : undefined;
    }, 60000);
    const passed = !deflection && grounded && answerCitations.length > 0 && !!opened && String(run!.status) === 'succeeded';
    (report.checks as Row[]).push({ name: 'own-site grounded question', passed, data: {
      reportQuestion: selected, runId: String(run!.id), status: String(run!.status), errorCode: run!.error_code ?? null,
      question: '我家现在施工到哪一步了？最近工地上都做了些什么？', answer, deflection, grounded,
      citations, answerCitations, reportOpened: { id: opened?.id, text: opened?.text }, modelAndToolSteps: Number(steps?.n ?? 0) } });
    if (!passed) (report.failures as Row[]).push({ name: 'own-site grounded question',
      error: deflection ? 'fixed referral still returned' : !grounded ? 'answer did not use report facts'
        : String(run!.status) !== 'succeeded' ? 'run failed' : !answerCitations.length ? 'answer carried no source citation' : 'report detail did not open' });
    report.passed = passed;
  } catch (e) {
    report.passed = false; report.error = (e as Error).message;
    (report.failures as Row[]).push({ name: 'own-site retest', error: (e as Error).stack || (e as Error).message });
  } finally {
    if (installed) try {
      await evaluate(`() => { const a = getApp(), s = a.__qaFix; if (!s) return false;
        a.globalData.token = s.token; a.globalData.bootstrap = s.bootstrap; a.globalData.userInfo = s.userInfo; a.hydrateStoredSession = s.hydrate;
        delete a.__qaFix; wx.removeStorageSync('assistant-active-conversation-v1'); return true; }`);
      await mp.reLaunch('/pages/index/index');
    } catch (e) { report.cleanupError = (e as Error).message; }
    await mp.disconnect().catch(() => {});
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ passed: report.passed, check: (report.checks as Row[])[0] ?? null, failures: report.failures }));
    await closePostgresPool();
  }
}
void main();
