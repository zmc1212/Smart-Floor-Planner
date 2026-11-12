/** Real Stable Mini Program journey for the 2026-11-12 report follow-up round.
 * Uses a signed customer identity, the existing chat page handlers and the
 * real dev server/worker/model. No report body is regenerated. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { wechatideNativeClient } from './wechatide-native-client';

declare const getApp: () => { hydrateStoredSession?: () => Promise<void>; globalData: Record<string, unknown> };
declare const wx: { setStorageSync(key: string, value: unknown): void };
declare const getCurrentPages: () => Array<{ selectFollowup(event: unknown): Promise<unknown>;
  askFollowupReport(event: unknown): Promise<unknown>; syncReportQuestion(): unknown }>;

loadEnvConfig(process.cwd(), true);
const root = path.resolve('..'), eid = '1454';
const project = path.join(root, 'miniprogram');
const route = 'packages/assistant/chat/chat';
const output = path.join(root, 'tmp/xiaok-user-journey-20261112/report-ui-' + (process.env.BATCH || new Date().toISOString().replace(/[:.]/g, '-')));
fs.mkdirSync(output, { recursive: true });
const bindingId = '422', conversationId = '1522', reportId = '536';
const uid = '645', contextVersion = 17;
const cli = wechatideNativeClient(project, output);
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const report: Record<string, unknown> = { startedAt: new Date().toISOString(), route, bindingId, conversationId, reportId,
  checks: [], runs: [], screenshots: [], modelCalls: null };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const step = async (name: string, fn: () => Promise<unknown>) => {
  try { const data = await fn(); (report.checks as Record<string, unknown>[]).push({ name, passed: true, data }); console.log(name + ': PASS'); return data; }
  catch (error) { (report.checks as Record<string, unknown>[]).push({ name, passed: false, error: (error as Error).stack }); throw error; }
  finally { save(); }
};
const wait = async <T>(fn: () => Promise<T | null | undefined | false>, label: string, attempts = 90): Promise<T> => {
  for (let i = 0; i < attempts; i++) { const value = await fn(); if (value) return value; await delay(500); }
  throw new Error(label + ' did not settle');
};
const page = () => wait(async () => { const p = await cli.currentPage(); return p?.path === route ? p : null; }, 'exact chat route');
const dataOf = async () => (await page()).data();
const capture = async (name: string) => {
  assert.equal((await cli.pageStack()).at(-1).path, route);
  await delay(400);
  const file = path.join(output, name + '.png');
  assert.ok(!fs.existsSync(file), 'keep every screenshot');
  await cli.screenshot({ path: file });
  const bytes = fs.readFileSync(file);
  (report.screenshots as Record<string, unknown>[]).push({ file, route, logical: [390, 844], encoded: [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] });
  save();
};
const evaluateSource = (source: string) => cli.call('automation_evaluate', { project, fnSource: source });
const evaluateRecovered = async (source: string) => {
  try { return await evaluateSource(source); }
  catch { await cli.call('simulator_refresh', { project }); await delay(4500); return evaluateSource(source); }
};
async function main() {
const token = await new SignJWT({ sub: uid, id: uid, mode: 'customer', role: 'user', enterpriseId: eid,
  contextVersion, source: 'password' }).setProtectedHeader({ alg: 'HS256' }).setSubject(uid).setIssuedAt()
  .setAudience('miniprogram').setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET));
const user = { id: uid, _id: uid, role: 'user', nickname: '合成测试·报告追问', phone: 'synthetic',
  context: { mode: 'customer', enterpriseId: eid, enterpriseName: '微云' } };
const inject = async () => {
  const fn = () => {
    const app = getApp();
    const tokenValue = '__TOKEN__';
    const userValue = { id: '__UID__', _id: '__UID__', role: 'user', nickname: '合成测试·报告追问', phone: 'synthetic',
      context: { mode: 'customer', enterpriseId: '__EID__', enterpriseName: '微云' } };
    app.hydrateStoredSession = async function(){};
    app.globalData.token = tokenValue; app.globalData.userInfo = userValue;
    app.globalData.bootstrap = { current: { mode: 'customer', role: 'user', context: userValue.context,
      capabilities: ['customer.service', 'account', 'assistant.chat.self', 'assistant.followup.self'] }, badges: { status: 'ok', counts: {} } };
    app.globalData.sessionHydrated = true; app.globalData.sessionRecovery = null; app.globalData.sessionHydrating = false;
    app.globalData.sessionHydrationPromise = Promise.resolve(); app.globalData.customerTab = 'xiaok';
    wx.setStorageSync('token', tokenValue); wx.setStorageSync('userInfo', userValue);
    return { installed: true };
  };
  const source = fn.toString().replace('__TOKEN__', token).replace(/__UID__/g, uid).replace('__EID__', eid);
  const result = await evaluateRecovered(source);
  return result.result.result as { installed?: boolean };
};
const enter = async () => {
  await cli.reLaunch('/' + route + '?followup=1');
  const p = await page();
  await wait(async () => { const d = await p.data(); return !d.loading && !d.followupListLoading && (d.followupBindings || []).length > 0; }, 'existing followup entry');
  await evaluateRecovered((() => { const id = '__ID__'; return getCurrentPages().at(-1)?.selectFollowup({ currentTarget: { dataset: { id } } }); }).toString().replace('__ID__', bindingId));
  await wait(async () => { const d = await p.data(); return d.followupActive && d.followupContext?.bindingId === bindingId
    && d.followupContext?.conversation?.id === conversationId && !d.followupChat?.loading && !d.followupBusy && !d.followupPending; }, 'exact saved private destination');
  return dataOf();
};
const selectReport = async (id: string) => {
  await evaluateRecovered((() => { const rid = '__RID__'; return getCurrentPages().at(-1)?.askFollowupReport({ currentTarget: { dataset: { report: rid, revision: 1 } } }); }).toString().replace('__RID__', id));
  return wait(async () => { const d = await dataOf(); return d.reportQuestion?.selected?.reportId === id
    && d.reportQuestion?.selected?.bindingId === bindingId ? d : null; }, 'selected frozen report');
};
const latestRun = () => withTenantTransaction(eid, tx => one(tx, sql`select id::text,status,error_code,trigger_message_id::text,output_message_id::text
  from app.assistant_runs where enterprise_id=${eid} and conversation_id=${conversationId} order by id desc limit 1`));
const ask = async (text: string, label: string) => {
  const before = await latestRun();
  const state = await dataOf();
  assert.equal(state.reportQuestion?.selected?.reportId, reportId, 'same report object before asking');
  if (state.reportQuestion.disabled) {
    await evaluateRecovered('function(){ return getCurrentPages().at(-1).syncReportQuestion(); }');
    await delay(600);
  }
  const p = await page();
  const draft = await p.$('.followup-human-composer textarea');
  assert.ok(draft, 'followup composer');
  await draft.input(text);
  await wait(async () => { const d = await dataOf(); return d.followupChat?.draft === text && !d.reportQuestion?.disabled; }, 'draft accepted by the composer');
  const button = await p.$('.followup-human-composer .send-button');
  assert.ok(button, 'followup send button');
  await button.tap();
  const run = await wait(async () => {
    const current = await latestRun();
    return current && String(current.id) !== String(before?.id) && ['succeeded', 'failed'].includes(String(current.status)) ? current : null;
  }, label + ' run ' + 'terminal', 240);
  if (run.status !== 'succeeded') throw new Error(label + ' run failed: ' + JSON.stringify(run));
  const messages = await wait(async () => {
    const d = await dataOf();
    const list = Array.isArray(d.followupChat?.messages) ? d.followupChat.messages : [];
    const answer = list.find((m: Record<string, unknown>) => String(m.runId) === String(run.id) && m.authorKind === 'assistant' && m.available);
    return answer && !d.followupChat.generating ? { answer, list } : null;
  }, label + ' visible saved answer');
  (report.runs as Record<string, unknown>[]).push({ label, text, run, answer: messages.answer });
  return { run, answer: messages.answer };
};
const usageFor = (runIds: string[]) => withTenantTransaction(eid, async tx => ({
  attempts: await rows(tx, sql`select id::text,capability,provider_key,logical_model_key,remote_model,status,accepted,error_code,
    estimated_cost,actual_cost from app.ai_provider_attempts where enterprise_id=${eid} and assistant_run_id in (${sql.join(runIds.map(id => sql`${id}`), sql`, `)}) order by id`),
  usage: await rows(tx, sql`select run_id::text,provider_attempt_id::text,operation_key,category,quantity::text,measurement_kind,
    input_tokens::text,output_tokens::text,cost_micros::text,currency from app.assistant_usage_records
    where enterprise_id=${eid} and run_id in (${sql.join(runIds.map(id => sql`${id}`), sql`, `)}) order by id`),
}));
try {
  await step('one verified Stable window at the approved viewport', async () => {
    const status = await cli.call('check_wechatide_status', { skillVersion: '0.3.11' });
    assert.equal(status.loginExpired, false);
    const projects = (await cli.call('project_list')).projects.filter((p: { projectPath: string }) => path.resolve(p.projectPath).toLowerCase() === project.toLowerCase());
    assert.ok(projects.length === 1);
    const info = await cli.systemInfo();
    assert.equal(info.windowWidth, 390); assert.equal(info.windowHeight, 844); assert.equal(info.SDKVersion, '3.17.2');
    await cli.call('simulator_refresh', { project }); await delay(4500);
    return { width: info.windowWidth, height: info.windowHeight, sdk: info.SDKVersion, projects: projects.length };
  });
  await step('signed customer identity and exact saved binding', async () => {
    assert.equal((await inject()).installed, true);
    const d = await enter();
    assert.equal(d.followupContext.audience, 'customer');
    assert.equal(d.followupContext.projects?.[0]?.id, '237');
    assert.ok((d.followupReports || []).some((r: Record<string, unknown>) => String(r.reportId) === reportId && r.ready));
    return { bindingId: d.followupContext.bindingId, conversationId: d.followupContext.conversation.id,
      reportIds: (d.followupReports || []).map((r: Record<string, unknown>) => r.reportId) };
  });
  await step('open the frozen report and ask the recent-progress question', async () => {
    const opened = await dataOf();
    if (opened.reportQuestion?.selected?.reportId !== reportId) await selectReport(reportId);
    await capture('01-report-opened');
    const result = await ask('这份日报里写的最近进展是什么？请只按这份报告回答。', 'report-question-1');
    assert.equal(result.run.status, 'succeeded', JSON.stringify(result.run));
    await capture('02-report-answer');
    return { runId: result.run.id };
  });
  await step('continuous follow-up keeps the same report object', async () => {
    const result = await ask('那报告里提到的待核对项，具体要谁核对？', 'report-question-2');
    assert.equal(result.run.status, 'succeeded', JSON.stringify(result.run));
    await capture('03-report-continuation');
    return { runId: result.run.id };
  });
  await step('exit and reenter the same report, then ask again', async () => {
    await cli.reLaunch('/pages/index/index');
    await delay(1200);
    const d = await enter();
    assert.ok((d.followupChat?.messages || []).some((m: Record<string, unknown>) => m.authorKind === 'assistant' && m.available));
    if (d.reportQuestion?.selected?.reportId !== reportId) await selectReport(reportId);
    const result = await ask('我重新进来了，这份报告最近记录的阶段变化是什么？', 'report-question-3');
    assert.equal(result.run.status, 'succeeded', JSON.stringify(result.run));
    await capture('04-report-reentry');
    return { runId: result.run.id };
  });
  await step('model usage is observed and bounded to this journey', async () => {
    const ids = (report.runs as Array<Record<string, unknown>>).map(r => String((r.run as Record<string, unknown>).id));
    const evidence = await usageFor(ids);
    report.modelCalls = evidence.attempts.length;
    report.usage = evidence;
    return { runs: ids, attempts: evidence.attempts.length, usage: evidence.usage.length };
  });
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = (error as Error).stack; process.exitCode = 1;
} finally {
  save();
  await closePostgresPool();
}
}
main().catch(async error => { console.error(error); process.exitCode = 1; await closePostgresPool().catch(() => undefined); });
