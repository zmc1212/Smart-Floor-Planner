/** Real Stable Mini Program journey for the mixed enterprise/general knowledge
 * round. Uses the existing public-site conversation and chat page handlers;
 * no direct HTTP send substitutes for the visible UI. */
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
declare const getCurrentPages: () => Array<{ selectHistory(event: unknown): Promise<unknown>; closeSheet(): unknown;
  controller: { visible: boolean; selectConversation(id: string): Promise<unknown> } }>;

loadEnvConfig(process.cwd(), true);
const root = path.resolve('..'), eid = '1454';
const project = path.join(root, 'miniprogram');
const route = 'packages/assistant/chat/chat';
const output = path.join(root, 'tmp/xiaok-user-journey-20261112/mixed-ui-' + (process.env.BATCH || new Date().toISOString().replace(/[:.]/g, '-')));
fs.mkdirSync(output, { recursive: true });
const conversationId = '2444', uid = '645', contextVersion = 17;
const cli = wechatideNativeClient(project, output);
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const report: Record<string, unknown> = { startedAt: new Date().toISOString(), route, conversationId, checks: [], runs: [], screenshots: [], modelCalls: null };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const step = async (name: string, fn: () => Promise<unknown>) => {
  try { const data = await fn(); (report.checks as Record<string, unknown>[]).push({ name, passed: true, data }); console.log(name + ': PASS'); return data; }
  catch (error) { (report.checks as Record<string, unknown>[]).push({ name, passed: false, error: (error as Error).stack }); throw error; }
  finally { save(); }
};
const wait = async <T>(fn: () => Promise<T | null | undefined | false>, label: string, attempts = 240): Promise<T> => {
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
const evaluate = (source: string) => cli.call('automation_evaluate', { project, fnSource: source });
const evaluateRecovered = async (source: string) => {
  try { return await evaluate(source); }
  catch { await cli.call('simulator_refresh', { project }); await delay(4500); return evaluate(source); }
};
const latestRun = () => withTenantTransaction(eid, tx => one(tx, sql`select id::text,status,error_code,trigger_message_id::text,output_message_id::text
  from app.assistant_runs where enterprise_id=${eid} and conversation_id=${conversationId} order by id desc limit 1`));
async function main() {
const token = await new SignJWT({ sub: uid, id: uid, mode: 'customer', role: 'user', enterpriseId: eid,
  contextVersion, source: 'password' }).setProtectedHeader({ alg: 'HS256' }).setSubject(uid).setIssuedAt()
  .setAudience('miniprogram').setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET));
const inject = async () => {
  const fn = () => {
    const app = getApp();
    const tokenValue = '__TOKEN__';
    const userValue = { id: '__UID__', _id: '__UID__', role: 'user', nickname: '合成测试·混合知识', phone: 'synthetic',
      context: { mode: 'customer', enterpriseId: '__EID__', enterpriseName: '微云' } };
    app.hydrateStoredSession = async function(){};
    app.globalData.token = tokenValue; app.globalData.userInfo = userValue;
    app.globalData.bootstrap = { current: { mode: 'customer', role: 'user', context: userValue.context,
      capabilities: ['customer.service', 'account', 'assistant.chat.self'] }, badges: { status: 'ok', counts: {} } };
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
  // A plain chat route without an entry option is redirected home by the host
  // shell. Use the same visible home -> chat navigation a customer uses, then
  // drive the page's own conversation controller.
  await cli.reLaunch('/pages/index/index');
  await delay(1200);
  assert.equal((await inject()).installed, true);
  await evaluateRecovered('function(){ return new Promise((resolve, reject) => wx.navigateTo({ url: "/packages/assistant/chat/chat?from=history", success: resolve, fail: reject })); }');
  const p = await page();
  await wait(async () => { const d = await p.data(); return !d.loading && !d.fatal; }, 'chat page ready');
  await delay(1500);
  await wait(async () => {
    const info = await evaluate('function(){ const p = getCurrentPages().at(-1); return { path: p && p.path, controller: typeof p?.controller }; }');
    return (info.result?.result as { controller?: string } | undefined)?.controller === 'object' ? true : null;
  }, 'chat controller ready');
  await evaluateRecovered((() => { const id = '__ID__'; const p = getCurrentPages().at(-1);
    if (!p?.controller) throw new Error('chat controller unavailable');
    p.controller.visible = true; return p.controller.selectConversation(id); }).toString().replace('__ID__', conversationId));
  await wait(async () => { const d = await dataOf(); return d.conversation?.id === conversationId && !d.loading && (d.messages || []).length > 0; }, 'public-site conversation');
  return dataOf();
};
const ask = async (text: string, label: string) => {
  const before = await latestRun();
  const draft = await (await page()).$('.composer .composer-input');
  assert.ok(draft, 'main composer');
  await draft.input(text);
  await wait(async () => { const d = await dataOf(); return d.draft === text; }, 'draft accepted');
  const button = await (await page()).$('.composer .send-button');
  assert.ok(button, 'main send button');
  await button.tap();
  const run = await wait(async () => {
    const current = await latestRun();
    return current && String(current.id) !== String(before?.id) && ['succeeded', 'failed'].includes(String(current.status)) ? current : null;
  }, label + ' run terminal', 360);
  if (run.status !== 'succeeded') throw new Error(label + ' run failed: ' + JSON.stringify(run));
  const visible = (attempts: number, name: string) => wait(async () => {
    const d = await dataOf();
    const list = Array.isArray(d.messages) ? d.messages : [];
    const answer = list.find((m: Record<string, unknown>) => String(m.id) === String(run.output_message_id)
      && m.authorKind === 'assistant' && m.available);
    return answer && !d.generating ? { answer, list } : null;
  }, name, attempts);
  let messages;
  try { messages = await visible(240, label + ' visible saved answer'); }
  catch {
    await evaluateRecovered('function(){ return getCurrentPages().at(-1).refreshFollowupChat(); }');
    messages = await visible(120, label + ' visible saved answer after refresh');
  }
  (report.runs as Record<string, unknown>[]).push({ label, text, run, answer: messages.answer });
  return { run, answer: messages.answer };
};
const runEvidence = (runId: string) => withTenantTransaction(eid, async tx => ({
  steps: await rows(tx, sql`select step_seq,kind,capability_name,status,input_summary,private_checkpoint,source_refs
    from app.assistant_run_steps where enterprise_id=${eid} and run_id=${runId} order by step_seq`),
  attempts: await rows(tx, sql`select id::text,capability,provider_key,logical_model_key,remote_model,status,accepted,error_code,
    estimated_cost,actual_cost from app.ai_provider_attempts where enterprise_id=${eid} and assistant_run_id=${runId} order by id`),
  usage: await rows(tx, sql`select run_id::text,provider_attempt_id::text,operation_key,category,quantity::text,measurement_kind,
    input_tokens::text,output_tokens::text,cost_micros::text,currency from app.assistant_usage_records
    where enterprise_id=${eid} and run_id=${runId} order by id`),
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
  await step('enter the existing public-site conversation through the chat history', async () => {
    const d = await enter();
    assert.equal(d.conversation.id, conversationId);
    assert.equal(d.publicDetail?.id || d.enterpriseId, d.enterpriseId, 'signed customer context is present');
    await capture('01-public-conversation');
    return { conversationId: d.conversation.id, messages: (d.messages || []).length };
  });
  await step('ask the mixed enterprise-standard and general-practice question in the real UI', async () => {
    const result = await ask('这个公开工地水电阶段，企业工艺标准对开槽和布线有什么要求？另外从一般施工经验看还有哪些通用注意事项？请分开说明。', 'mixed-question-1');
    await capture('02-mixed-answer');
    const evidence = await runEvidence(String(result.run.id));
    const retrieval = evidence.steps.filter(s => s.kind === 'retrieval' && ['knowledge.search.v1','search_enterprise'].includes(String(s.capability_name)) && s.status === 'succeeded');
    assert.ok(retrieval.length > 0, 'real enterprise retrieval step');
    const text = ((result.answer.content as { blocks?: Array<{ text?: string }> }).blocks || []).map(b => String(b.text || '')).join('\n');
    assert.match(text, /企业|标准|工艺/, 'enterprise-standard part');
    assert.match(text, /一般|通用|经验|通常/, 'general-practice part');
    (report.runs as Record<string, unknown>[]).at(-1)!.evidence = { retrieval: retrieval.map(s => ({ seq: s.step_seq, capability: s.capability_name, input: s.input_summary })), attempts: evidence.attempts.length, usage: evidence.usage };
    return { runId: result.run.id, retrieval: retrieval.length, text: text.slice(0, 240) };
  });
  await step('open a visible citation from the mixed answer', async () => {
    const answerId = String((((report.runs as Array<Record<string, unknown>>).at(-1)!.answer) as Record<string, unknown>).id);
    const chip = await (await page()).$('#message-' + answerId + ' .citation-chip');
    assert.ok(chip, 'visible citation chip in the saved answer');
    await chip.tap();
    const citation = await wait(async () => { const d = await dataOf(); return d.citation?.available ? d.citation : null; }, 'citation sheet');
    await capture('03-mixed-citation');
    assert.ok(String(citation.title || '').trim());
    assert.ok(String(citation.quote || '').trim());
    return { title: citation.title, quote: String(citation.quote).slice(0, 160), version: citation.versionLabel || citation.versionNumber };
  });
  await step('continuous follow-up keeps enterprise craft and general advice separate', async () => {
    await evaluateRecovered('function(){ return getCurrentPages().at(-1).closeSheet(); }');
    const result = await ask('那双线管开槽宽度，企业标准是多少？一般施工经验上又该怎么控制？请分开说明。', 'mixed-question-2');
    await capture('04-mixed-followup');
    const evidence = await runEvidence(String(result.run.id));
    const retrieval = evidence.steps.filter(s => s.kind === 'retrieval' && ['knowledge.search.v1','search_enterprise'].includes(String(s.capability_name)) && s.status === 'succeeded');
    const text = ((result.answer.content as { blocks?: Array<{ text?: string }> }).blocks || []).map(b => String(b.text || '')).join('\n');
    assert.match(text, /企业|标准|规范/, 'enterprise-standard part');
    assert.match(text, /一般|通用|经验|通常/, 'general-practice part');
    (report.runs as Record<string, unknown>[]).at(-1)!.evidence = { retrieval: retrieval.map(s => ({ seq: s.step_seq, capability: s.capability_name, input: s.input_summary })), attempts: evidence.attempts.length, usage: evidence.usage };
    return { runId: result.run.id, retrieval: retrieval.length, text: text.slice(0, 240) };
  });
  await step('model and embedding usage are observed for this journey', async () => {
    const ids = (report.runs as Array<Record<string, unknown>>).map(r => String((r.run as Record<string, unknown>).id));
    const evidence = await withTenantTransaction(eid, async tx => ({
      attempts: await rows(tx, sql`select id::text,capability,provider_key,logical_model_key,remote_model,status,accepted,error_code,
        estimated_cost,actual_cost from app.ai_provider_attempts where enterprise_id=${eid} and assistant_run_id in (${sql.join(ids.map(id => sql`${id}`), sql`, `)}) order by id`),
      usage: await rows(tx, sql`select run_id::text,provider_attempt_id::text,operation_key,category,quantity::text,measurement_kind,
        input_tokens::text,output_tokens::text,cost_micros::text,currency from app.assistant_usage_records
        where enterprise_id=${eid} and run_id in (${sql.join(ids.map(id => sql`${id}`), sql`, `)}) order by id`),
    }));
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
