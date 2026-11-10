/** Re-verification of the two fixed four-question groups under enterprise 1454
 * with the XiaoK native executor: the two enterprise-craft questions from the
 * round-03 questions file plus the own-project progress and report-record
 * questions, through the live 3006 service. Records sanitized Q&A, run and
 * provider-attempt identities, source and configuration fingerprints. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadEnvConfig } from '@next/env';
import { SignJWT } from 'jose';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { nativeAgentRuntimeBinding } from '@/lib/assistant/fastgpt/agent-v2/config';

loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development'));
const root = path.resolve('..'), eid = '1454', customerId = '645', leadId = '3132', projectId = '237';
const questionsFile = path.resolve(root, 'tmp/xiaok-native-executor-20261110/questions.json');
const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/xiaok-native-executor-20261111-recovery/four-questions');
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Retain the original round');
const target = new URL(process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
fs.mkdirSync(output, { recursive: true });
const base = 'http://127.0.0.1:3006/api/miniprogram/assistant';
const report: Row & { accounting: Row } = { startedAt: new Date().toISOString(), enterpriseId: eid,
  scope: 'two four-question groups re-verified on the native executor', checks: [], failures: [], accounting: {} };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const tenantOne = (q: ReturnType<typeof sql>) => withTenantTransaction(eid, tx => one(tx, q));
const tenantRows = (q: ReturnType<typeof sql>) => withTenantTransaction(eid, tx => rows(tx, q));
const platformOne = (q: ReturnType<typeof sql>) => withPlatformTransaction(tx => one(tx, q));

function binding() {
  const files = execFileSync('rg', ['--files', 'admin/src', 'admin/scripts'], { cwd: root, encoding: 'utf8' })
    .trim().split(/\r?\n/).map(p => p.replaceAll('\\', '/')).filter(f => /assistant|job-queue|postgres-workflow-chat/.test(f));
  files.push('admin/scripts/xiaok-native-four-questions-check.ts', 'admin/.env.local');
  if (process.env.XIAOK_FASTGPT_WORKFLOWS_FILE?.trim())
    files.push(path.relative(root, path.resolve(process.env.XIAOK_FASTGPT_WORKFLOWS_FILE)).replaceAll('\\', '/'));
  return Object.fromEntries([...new Set(files)].sort().map(f => [f, createHash('sha256').update(fs.readFileSync(path.isAbsolute(f) ? f : path.join(root, f))).digest('hex')]));
}
const before = binding();
report.bindingBefore = createHash('sha256').update(JSON.stringify(before)).digest('hex');

// Native-mode audit ledger view of the same workflows file.
const workflowsFile = process.env.XIAOK_FASTGPT_WORKFLOWS_FILE?.trim();
const auditFile = workflowsFile ? (JSON.parse(fs.readFileSync(path.resolve(workflowsFile), 'utf8')).auditFile as string | undefined) : undefined;
const auditLines = () => auditFile && fs.existsSync(auditFile)
  ? fs.readFileSync(auditFile, 'utf8').trim().split(/\r?\n/).filter(Boolean) : [];
const auditBefore = auditLines().length;

async function step(name: string, fn: () => Promise<unknown>) {
  try { const data = await fn(); (report.checks as Row[]).push({ name, passed: true, data }); console.log(name + ': PASS'); return data; }
  catch (e) { (report.checks as Row[]).push({ name, passed: false, error: (e as Error).message });
    (report.failures as Row[]).push({ name, error: (e as Error).stack || (e as Error).message }); throw e; }
  finally { save(); }
}
async function waitFor<T>(label: string, fn: () => Promise<T | undefined | false>, timeoutMs: number, intervalMs = 2500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(label + ' timed out after ' + Math.round(timeoutMs / 1000) + 's');
}
const jwt = (payload: Row) => new SignJWT({ ...payload }).setProtectedHeader({ alg: 'HS256' }).setSubject(String(payload.sub))
  .setIssuedAt().setAudience('miniprogram').setExpirationTime('2h').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
async function api(token: string, route: string, init: { method?: string; body?: Row; entry?: string; key?: string; expect?: number | number[] } = {}) {
  const headers: Record<string, string> = { Authorization: 'Bearer ' + token };
  if (init.entry) headers['X-Assistant-Entry'] = init.entry;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.key) headers['Idempotency-Key'] = init.key;
  const response = await fetch(base + route, { method: init.method || (init.body !== undefined ? 'POST' : 'GET'), headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(60000) });
  const data = await response.json().catch(() => ({})) as Row;
  const expected = init.expect ?? 200;
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status),
    route + ': ' + response.status + '/' + String(data.code || data.error || ''));
  return { status: response.status, data };
}
const tokenPrefix = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 12);
const executorOf = (run: Row) => String(((run.policy_snapshot as Row)?.agentRuntime as Row | undefined)?.protocol || '');
const bindingOf = (run: Row) => String(((run.policy_snapshot as Row)?.agentRuntime as Row | undefined)?.binding || '');

/** One real customer turn: send, wait for the run, read the persisted answer
 * and open every citation it carries. */
async function customerTurn(token: string, cid: string, text: string) {
  const clientMessageId = randomUUID();
  await api(token, `/conversations/${cid}/messages`, { key: clientMessageId,
    body: { clientMessageId, content: { version: 1, blocks: [{ type: 'text', text }] } }, expect: 202 });
  const run = await waitFor('customer reply', async () => {
    const r = await tenantOne(sql`select id,status,error_code,policy_snapshot,output_message_id from app.assistant_runs
      where enterprise_id=${eid} and conversation_id=${cid} and purpose='reply' order by id desc limit 1`);
    return r && !['queued', 'running'].includes(String(r.status)) ? r : undefined;
  }, 360000);
  const messages = (await api(token, `/conversations/${cid}/messages?limit=50`)).data.data as Row;
  const items = (messages.items as Row[] | undefined) || [];
  const answer = items.find(m => String(m.id) === String(run!.output_message_id));
  assert.ok(answer && String(answer.authorKind) === 'assistant', 'Assistant message persisted');
  const citationRows = await tenantRows(sql`select id,source_kind from app.assistant_message_citations
    where enterprise_id=${eid} and run_id=${String(run!.id)} order by id`);
  const citations: Row[] = [];
  for (const citation of citationRows) {
    const opened = (await api(token, '/citations/' + String(citation.id))).data.data as Row;
    citations.push({ id: String(citation.id), sourceKind: String(citation.source_kind), title: String(opened.title || ''),
      hasText: Boolean(opened.text || opened.content || opened.excerpt) });
  }
  const attempts = await withPlatformTransaction(tx => rows(tx, sql`select id,remote_model,status from app.ai_provider_attempts
    where assistant_run_id=${String(run!.id)} order by id`));
  return { run: run!, answer, citations, attempts,
    answerText: String(((answer.content as Row)?.blocks as Row[] || []).map(b => b.text || '').join('')) };
}

async function main() {
  assert.ok(process.env.JWT_SECRET);
  const bound = nativeAgentRuntimeBinding(eid);
  assert.ok(bound, 'The langgraph-v1 executor switch must be active for 1454');
  report.nativeBinding = bound.binding;
  report.accounting.providerMaxBefore = String((await platformOne(sql`select coalesce(max(id),0) id from app.ai_provider_attempts`))!.id);
  const customerVersion = Number((await platformOne(sql`select context_version from app.users where id=${customerId}`))!.context_version);
  const customer = { token: await jwt({ sub: customerId, id: customerId, mode: 'customer', role: 'user', enterpriseId: eid,
    contextVersion: customerVersion, source: 'wechat' }) };
  report.tokens = { customer: tokenPrefix(customer.token) };
  const groupA = JSON.parse(fs.readFileSync(questionsFile, 'utf8')).questions as string[];
  const groupB = ['我家现在施工到哪一步？最近做了什么？', '你发的日报里记的内容，和现场确认过的是一回事吗？'];

  await step('preflight: idle assistant queue and active native binding', async () => {
    const queue = await platformOne(sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`);
    assert.equal(queue!.n, 0, 'No acceptance may start on an active queue');
    return { queue: queue!.n, binding: bound!.binding };
  });

  await step('four real customer turns with citation readback', async () => {
    const entry = (await api(customer.token, '/entry-context', { body: { leadId } })).data.data as Row;
    assert.ok(entry.entryToken);
    const entryToken = String(entry.entryToken);
    const created = (await api(customer.token, '/conversations', { body: { entryToken }, key: randomUUID() })).data.data as Row;
    const cid = String(created.id);
    const turns: Row[] = [];
    for (const text of [...groupA, ...groupB]) {
      const turn = await customerTurn(customer.token, cid, text);
      turns.push({ group: groupA.includes(text) ? 'A' : 'B', question: text, runId: String(turn.run.id),
        status: String(turn.run.status), errorCode: turn.run.error_code || null,
        runtime: executorOf(turn.run), binding: bindingOf(turn.run), providerAttempts: (turn.attempts as Row[]).map(a =>
          ({ id: String(a.id), remoteModel: String(a.remote_model), status: String(a.status) })),
        citations: turn.citations, answerText: turn.answerText.slice(0, 600) });
      assert.equal(String(turn.run.status), 'succeeded', 'Every group question must succeed: ' + String(turn.run.error_code || ''));
      assert.equal(executorOf(turn.run), 'xiaok-native-executor-v1', 'Every reply must use the native executor');
      assert.equal(bindingOf(turn.run), bound!.binding, 'Every reply must record the audited runtime binding');
    }
    // Group A carries openable enterprise-knowledge citations; group B carries
    // the authorized snapshot section and no report writes.
    for (const turn of turns.filter(t => t.group === 'A')) {
      assert.ok((turn.citations as Row[]).length > 0, 'Knowledge question must cite authorized sources');
      for (const citation of turn.citations as Row[]) assert.equal(citation.sourceKind, 'knowledge');
    }
    const progress = turns.find(t => (t.question as string).includes('施工到哪一步'))!;
    assert.match(String(progress.answerText), /项目记录（授权快照，以此为准）/, 'Progress reply must carry the authorized snapshot section');
    const reportsBeforeRows = await tenantRows(sql`select id from app.construction_reports where enterprise_id=${eid}`);
    assert.ok(String(turns[3].answerText).trim().length > 20, 'Report-record reply must explain the record scopes');
    const composeRuns = await tenantRows(sql`select id from app.assistant_runs where enterprise_id=${eid}
      and purpose='construction.report.compose' and trigger_kind='user_message'`);
    assert.equal(composeRuns.length, 0, 'No report composition may originate from a chat message');
    const reportsAfterRows = await tenantRows(sql`select id from app.construction_reports where enterprise_id=${eid}`);
    assert.equal(reportsAfterRows.length, reportsBeforeRows.length, 'A chat question must not generate reports');
    const listed = (await api(customer.token, '/conversations?limit=20', { entry: entryToken })).data.data as Row;
    assert.ok((((listed.items as Row[] | undefined) || [])).some((c: Row) => String(c.id) === cid), 'Conversation listed on reentry');
    const detail = (await api(customer.token, '/conversations/' + cid)).data.data as Row;
    assert.equal(String(detail.id), cid);
    const attemptModels = [...new Set(turns.flatMap(t => (t.providerAttempts as Row[]).map(a => String(a.remoteModel))))];
    report.chat = { conversationId: cid, entryTokenHash: createHash('sha256').update(entryToken).digest('hex'),
      turns, reentry: true, attemptModels, stage: ' Project stage read from the live snapshot' };
    return { conversationId: cid, turns: turns.map(t => ({ runId: t.runId, runtime: t.runtime, citations: (t.citations as Row[]).length })) };
  });

  await step('native-mode FastGPT audit criteria', async () => {
    assert.ok(workflowsFile, 'FastGPT 审计未配置,不得判 PASS');
    assert.ok(auditFile && fs.existsSync(auditFile), 'FastGPT 审计文件缺失,不得判 PASS');
    const turns = ((report.chat as Row).turns as Row[]) || [];
    const mismatched = turns.filter(t => String(t.binding || '') !== bound!.binding);
    assert.equal(mismatched.length, 0, '运行服务与审计配置不一致,不得判 PASS');
    const delta = auditLines().slice(auditBefore);
    const kinds: Row = {};
    for (const line of delta) { const kind = String((JSON.parse(line) as Row).kind || ''); kinds[kind] = (Number(kinds[kind]) || 0) + 1; }
    const nonStage = Object.keys(kinds).filter(kind => kind !== 'stage');
    assert.equal(nonStage.length, 0, 'Chat path must not call FastGPT, saw: ' + nonStage.join(','));
    report.fastgptAudit = { configured: true, auditFile, before: auditBefore, after: auditLines().length, kinds,
      expectedBinding: bound!.binding, totalTurns: turns.length, mode: 'xiaok-native-executor-v1' };
    return report.fastgptAudit;
  });

  report.accounting.providerMaxAfter = String((await platformOne(sql`select coalesce(max(id),0) id from app.ai_provider_attempts`))!.id);
}
main().catch(error => { report.error = (error as Error).message; })
  .finally(async () => {
    try {
      const after = binding(), changed = Object.keys({ ...before, ...after }).filter(f => before[f] !== after[f]);
      report.drift = changed; report.bindingAfter = createHash('sha256').update(JSON.stringify(after)).digest('hex');
      if (changed.length) (report.failures as Row[]).push({ name: 'source drift', files: changed });
      report.finishedAt = new Date().toISOString();
    } catch (error) { report.finalizeError = (error as Error).message; }
    finally { save(); await closePostgresPool();
      console.log(JSON.stringify({ passed: (report.checks as Row[]).every(c => c.passed), checks: (report.checks as Row[]).length,
        error: report.error || null, drift: report.drift || [] })); }
  });
