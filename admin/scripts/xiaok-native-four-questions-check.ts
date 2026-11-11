/** Re-verification of the two fixed four-question groups under enterprise 1454
 * with the XiaoK native executor: the two enterprise-craft questions from the
 * round-03 questions file plus the own-project progress and report-record
 * questions, through the live 3006 service. Records sanitized Q&A, run and
 * provider-attempt identities, source and configuration fingerprints. A staff
 * positive-control probe first proves the shared FastGPT audit ledger receives
 * this service's own knowledge writes for a real preview run; the native chat
 * window after that probe must stay FastGPT-free. */
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
const root = path.resolve('..'), eid = '1454', customerId = '645', leadId = '3132';
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
// Assertion window into the shared audit ledger. The probe step re-baselines
// it after its own records, so later windows only judge post-probe increments.
let auditBefore = auditLines().length;

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
 * and open every citation it carries — persisted knowledge citations and the
 * derived `w:` web citation ids alike (web citations live in the answer blocks
 * plus the run's synthesis step, not in assistant_message_citations). */
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
  const webCitationIds = [...new Set((((answer.content as Row)?.blocks as Row[] | undefined) || [])
    .filter(b => b.type === 'citation' && String(b.citationId || '').startsWith('w:')).map(b => String(b.citationId)))];
  const webCitations: Row[] = [];
  for (const citationId of webCitationIds) {
    const opened = (await api(token, '/citations/' + citationId)).data.data as Row;
    webCitations.push({ citationId, available: opened.available === true, title: String(opened.title || ''),
      hasQuote: typeof opened.quote === 'string' && opened.quote.trim().length > 0 });
  }
  const attempts = await withPlatformTransaction(tx => rows(tx, sql`select id,remote_model,status from app.ai_provider_attempts
    where assistant_run_id=${String(run!.id)} order by id`));
  return { run: run!, answer, citations, webCitations, attempts,
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

  // Positive control before the audited window: the owner staff identity must
  // answer a synthetic labelled draft through the preview knowledge app, and
  // the shared audit ledger must receive that exact run's knowledge record.
  // A probe failure fails the whole round; it is never skipped silently.
  const probeResult: Row = {};
  await step('audit source verified by the same-window V2 probe receipt', async () => {
    // The current deployment answers chat and stage bodies through local
    // pipelines, so a native-window probe cannot produce an audit record by
    // design. The audit source is therefore verified in the SAME deployment
    // window while the V2 bridge is bound (scripts/xiaok-audit-probe.ts): one
    // real V2 chat turn lands a run-correlated agentV2 record in this ledger,
    // and this round's zero-FastGPT assertion is judged only on post-probe
    // increments of that same verified ledger.
    const receiptPath = path.resolve(root, 'tmp/xiaok-native-executor-20261111-recovery/four-questions/audit-probe.json');
    assert.ok(fs.existsSync(receiptPath), '审计探针回执缺失:请在 V2 绑定期运行 scripts/xiaok-audit-probe.ts,不得判 PASS');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')) as Row;
    assert.equal(path.resolve(String(receipt.auditFile)), path.resolve(String(auditFile)),
      '探针回执必须指向同一审计账本,不得判 PASS');
    const probeRunId = String(receipt.probeRunId);
    const probeRecord = auditLines().map(line => JSON.parse(line) as Row)
      .find(record => String(record.kind) === 'agentV2'
        && String((((record.value as Row | undefined) ?? record) as Row).runId || '') === probeRunId);
    assert.ok(probeRecord, '审计账本必须保留探针 run 的 agentV2 关联记录,不得判 PASS');
    auditBefore = Number(receipt.auditBeforeAfterProbe);
    report.probe = { probeRunId, auditFile, verified: true, binding: String(receipt.binding) };
    return report.probe;
  });

  // Watermark for the chat round: the report baseline is captured before the
  // four questions start, and the step-end count only covers this window.
  report.roundStartedAt = new Date().toISOString();
  const reportsBefore = Number((await tenantOne(sql`select count(*)::int n from app.construction_reports
    where enterprise_id=${eid}`))!.n);
  report.accounting.reportsBefore = reportsBefore;

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
    assert.ok(String(turns[3].answerText).trim().length > 20, 'Report-record reply must explain the record scopes');
    const composeRuns = await tenantRows(sql`select id from app.assistant_runs where enterprise_id=${eid}
      and purpose='construction.report.compose' and trigger_kind='user_message'`);
    assert.equal(composeRuns.length, 0, 'No report composition may originate from a chat message');
    // Watermarked window: reports created at/after the round watermark must be
    // zero, so pre-round history cannot mask a chat-triggered write.
    const reportsInRound = Number((await tenantOne(sql`select count(*)::int n from app.construction_reports
      where enterprise_id=${eid} and created_at >= ${report.roundStartedAt}::timestamptz`))!.n);
    assert.equal(reportsInRound, 0, 'A chat question must not generate reports during this round');
    const listed = (await api(customer.token, '/conversations?limit=20', { entry: entryToken })).data.data as Row;
    assert.ok((((listed.items as Row[] | undefined) || [])).some((c: Row) => String(c.id) === cid), 'Conversation listed on reentry');
    const detail = (await api(customer.token, '/conversations/' + cid)).data.data as Row;
    assert.equal(String(detail.id), cid);
    const attemptModels = [...new Set(turns.flatMap(t => (t.providerAttempts as Row[]).map(a => String(a.remoteModel))))];
    report.chat = { conversationId: cid, entryTokenHash: createHash('sha256').update(entryToken).digest('hex'),
      turns, reentry: true, attemptModels, stage: ' Project stage read from the live snapshot',
      reportWrites: { before: reportsBefore, duringRound: reportsInRound } };
    return { conversationId: cid, turns: turns.map(t => ({ runId: t.runId, runtime: t.runtime, citations: (t.citations as Row[]).length })) };
  });

  // The shared web dispatcher under the native executor, end to end: a natural
  // public-standard question drives search_web → read_web through the shared
  // factory, the model registers a `w:` citation id, and the persisted answer's
  // citation opens through the same endpoint as knowledge citations.
  await step('web turn: search → read → cited delivery → openable w: citation', async () => {
    const cid = String((report.chat as Row).conversationId);
    const question = '帮我联网查一下，公开标准里室内板材甲醛释放量E1级的限值是多少，出自哪份标准？';
    const turn = await customerTurn(customer.token, cid, question);
    assert.equal(String(turn.run.status), 'succeeded', 'Web turn must succeed: ' + String(turn.run.error_code || ''));
    assert.equal(executorOf(turn.run), 'xiaok-native-executor-v1', 'Web turn must use the native executor');
    assert.equal(bindingOf(turn.run), bound!.binding, 'Web turn must record the audited runtime binding');
    const webSteps = await tenantRows(sql`select step_seq,capability_name,status from app.assistant_run_steps
      where enterprise_id=${eid} and run_id=${String(turn.run.id)} and step_seq>=1200 and step_seq<1300
        and capability_name in ('web.search.v1','web.read.v1') and status='succeeded' order by step_seq`);
    assert.ok(webSteps.some(s => String(s.capability_name) === 'web.search.v1'),
      'The web turn must dispatch through the shared search factory, saw: ' + webSteps.map(s => String(s.capability_name)).join(','));
    // Fail-closed composition: this acceptance covers the COMPLETE web path —
    // a successful search, at least one read original, a registered `w:`
    // citation in the delivered answer and an openable citation carrying its
    // original quote. A search-only / unreadable-page result is recorded as a
    // degraded outcome and must NOT be counted as the complete path passing.
    const readPages = await tenantOne(sql`select coalesce(sum(jsonb_array_length(private_checkpoint->'pages')),0)::int n,
      count(*)::int steps from app.assistant_run_steps where enterprise_id=${eid} and run_id=${String(turn.run.id)}
        and capability_name='web.read.v1' and status='succeeded'`);
    const readStepCount = Number(readPages!.steps), pageCount = Number(readPages!.n);
    const completePathCovered = readStepCount > 0 && pageCount > 0;
    const webTurn: Row = { group: 'C', question, runId: String(turn.run.id), status: String(turn.run.status),
      errorCode: turn.run.error_code || null, runtime: executorOf(turn.run), binding: bindingOf(turn.run),
      webSteps: webSteps.map(s => ({ stepSeq: Number(s.step_seq), capability: String(s.capability_name) })),
      readSteps: readStepCount, readPages: pageCount, completePathCovered, webCitations: turn.webCitations,
      answerText: turn.answerText.slice(0, 600),
      providerAttempts: (turn.attempts as Row[]).map(a => ({ id: String(a.id), remoteModel: String(a.remote_model), status: String(a.status) })) };
    ((report.chat as Row).turns as Row[]).push(webTurn);
    report.webTurn = webTurn;
    if (!completePathCovered) {
      // Degraded path: the answer may honestly say the page was not obtained,
      // but it may never fabricate a web citation, and this round does not
      // count the complete link as covered.
      assert.equal((webTurn.webCitations as Row[]).length, 0,
        'A search-only turn must not carry a web citation');
      assert.ok(String(webTurn.answerText).trim().length > 10, 'A degraded answer must still explain the outcome');
      assert.fail('Complete web path not covered: readSteps=' + readStepCount + ', readPages=' + pageCount
        + '; search-only results are recorded as degraded, not complete');
    }
    assert.ok((webTurn.webCitations as Row[]).length > 0,
      'Retrieved web originals require a registered w: citation in the delivered answer');
    for (const citation of webTurn.webCitations as Row[]) {
      assert.equal(citation.available, true, 'Web citation must open: ' + String(citation.citationId));
      assert.equal(citation.hasQuote, true, 'Web citation must carry its original quote: ' + String(citation.citationId));
    }
    return { runId: String(turn.run.id), webSteps: webTurn.webSteps, readSteps: readStepCount, readPages: pageCount,
      completePathCovered, webCitations: (webTurn.webCitations as Row[] | undefined)?.length ?? 0 };
  });

  await step('native-mode FastGPT audit criteria', async () => {
    assert.ok(workflowsFile, 'FastGPT 审计未配置,不得判 PASS');
    assert.ok(auditFile && fs.existsSync(auditFile), 'FastGPT 审计文件缺失,不得判 PASS');
    const turns = ((report.chat as Row).turns as Row[]) || [];
    const mismatched = turns.filter(t => String(t.binding || '') !== bound!.binding);
    assert.equal(mismatched.length, 0, '运行服务与审计配置不一致,不得判 PASS');
    // Post-probe window only: the probe's own knowledge records are excluded
    // by the re-baselined snapshot, and the native chat path must still add
    // zero FastGPT records of any kind.
    const delta = auditLines().slice(auditBefore);
    const kinds: Row = {};
    for (const line of delta) { const kind = String((JSON.parse(line) as Row).kind || ''); kinds[kind] = (Number(kinds[kind]) || 0) + 1; }
    const nonStage = Object.keys(kinds).filter(kind => kind !== 'stage');
    assert.equal(nonStage.length, 0, 'Chat path must not call FastGPT, saw: ' + nonStage.join(','));
    report.fastgptAudit = { configured: true, auditFile,
      probe: { previewRunId: String(probeResult.previewRunId || ''), verified: true },
      before: auditBefore, after: auditLines().length, kinds,
      expectedBinding: bound!.binding, totalTurns: turns.length, mode: 'xiaok-native-executor-v1' };
    return report.fastgptAudit;
  });

  report.accounting.providerMaxAfter = String((await platformOne(sql`select coalesce(max(id),0) id from app.ai_provider_attempts`))!.id);
}
main().catch(error => { report.error = (error as Error).message; })
  .finally(async () => {
    try {
      // This round's own probe fixture: a failed probe must never leave a
      // queued knowledge job that blocks the next acceptance preflight. The
      // scope is the exact recorded job id — no wider sweep.
      const probeJobId = String((report.probeFixture as Row | undefined)?.jobId || '');
      if (probeJobId) await withPlatformTransaction(tx => tx.execute(sql`update app.assistant_jobs
        set status='failed',last_error='fourq_probe_synthetic_cleanup',version=version+1
        where id=${probeJobId} and status in ('queued','running')`));
      const after = binding(), changed = Object.keys({ ...before, ...after }).filter(f => before[f] !== after[f]);
      report.drift = changed; report.bindingAfter = createHash('sha256').update(JSON.stringify(after)).digest('hex');
      if (changed.length) (report.failures as Row[]).push({ name: 'source drift', files: changed });
      report.finishedAt = new Date().toISOString();
    } catch (error) { report.finalizeError = (error as Error).message; }
    finally { save(); await closePostgresPool();
      const checks = (report.checks as Row[]);
      const passed = checks.length > 0 && checks.every(c => c.passed)
        && !report.error && !((report.drift as string[] | undefined) || []).length && !report.finalizeError;
      if (!passed) process.exitCode = 1;
      console.log(JSON.stringify({ passed, checks: checks.length, error: report.error || null, drift: report.drift || [] })); }
  });
