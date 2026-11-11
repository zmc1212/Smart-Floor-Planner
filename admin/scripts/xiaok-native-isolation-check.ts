/** P2 targeted checks under enterprise 1454: two consultation sessions stay
 * isolated while their jobs share the queue, and a revoked knowledge source
 * leaves retrieval and new citations until it is published again. Synthetic
 * labelled documents only; the live 3006 service and Worker run the journeys. */
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
import { KnowledgeService } from '@/lib/assistant/knowledge/service';
import { claimKnowledgeJob, runKnowledgeJob } from '@/lib/assistant/knowledge/index-worker';
import { retrieveKnowledge } from '@/lib/assistant/knowledge/retrieval';
import { nativeAgentRuntimeBinding } from '@/lib/assistant/fastgpt/agent-v2/config';
import { auditKindCounts, auditNonStageKinds, auditWindowEntries, readableAuditError } from '@/lib/assistant/fastgpt/agent-v2/audit-window';

loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development'));
const root = path.resolve('..'), eid = '1454', customerId = '645', leadId = '3132', ownerId = '2853';
const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/xiaok-native-executor-p2-isolation');
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Retain the original round');
const target = new URL(process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
fs.mkdirSync(output, { recursive: true });
const base = 'http://127.0.0.1:3006/api/miniprogram/assistant';
const report: Row & { accounting: Row } = { startedAt: new Date().toISOString(), enterpriseId: eid,
  scope: 'two-session isolation and knowledge revocation recovery', checks: [], failures: [], accounting: {} };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const tenantOne = (q: ReturnType<typeof sql>) => withTenantTransaction(eid, tx => one(tx, q));
const tenantRows = (q: ReturnType<typeof sql>) => withTenantTransaction(eid, tx => rows(tx, q));
const platformOne = (q: ReturnType<typeof sql>) => withPlatformTransaction(tx => one(tx, q));

function binding() {
  const files = execFileSync('rg', ['--files', 'admin/src', 'admin/scripts'], { cwd: root, encoding: 'utf8' })
    .trim().split(/\r?\n/).map(p => p.replaceAll('\\', '/')).filter(f => /assistant|job-queue|postgres-workflow-chat/.test(f));
  files.push('admin/scripts/xiaok-native-isolation-check.ts', 'admin/.env.local');
  if (process.env.XIAOK_FASTGPT_WORKFLOWS_FILE?.trim())
    files.push(path.relative(root, path.resolve(process.env.XIAOK_FASTGPT_WORKFLOWS_FILE)).replaceAll('\\', '/'));
  return Object.fromEntries([...new Set(files)].sort().map(f => [f, createHash('sha256').update(fs.readFileSync(path.isAbsolute(f) ? f : path.join(root, f))).digest('hex')]));
}
const before = binding();
report.bindingBefore = createHash('sha256').update(JSON.stringify(before)).digest('hex');
const workflowsFile = process.env.XIAOK_FASTGPT_WORKFLOWS_FILE?.trim();
const auditFile = workflowsFile ? (JSON.parse(fs.readFileSync(path.resolve(workflowsFile), 'utf8')).auditFile as string | undefined) : undefined;
const auditLines = () => auditFile && fs.existsSync(auditFile)
  ? fs.readFileSync(auditFile, 'utf8').trim().split(/\r?\n/).filter(Boolean) : [];
const auditBefore = auditLines().length;

async function step(name: string, fn: () => Promise<unknown>) {
  try { const data = await fn(); (report.checks as Row[]).push({ name, passed: true, data }); console.log(name + ': PASS'); return data; }
  catch (e) { const message = (e as Error).message + ((e as Row).cause ? ' | cause: ' + String((e as Row).cause) : '');
    (report.checks as Row[]).push({ name, passed: false, error: message });
    (report.failures as Row[]).push({ name, error: (e as Error).stack || message }); throw e; }
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
const executorOf = (run: Row) => String(((run.policy_snapshot as Row)?.agentRuntime as Row | undefined)?.protocol || '');
const bindingOf = (run: Row) => String(((run.policy_snapshot as Row)?.agentRuntime as Row | undefined)?.binding || '');

async function sendTurn(token: string, cid: string, text: string) {
  const clientMessageId = randomUUID();
  await api(token, `/conversations/${cid}/messages`, { key: clientMessageId,
    body: { clientMessageId, content: { version: 1, blocks: [{ type: 'text', text }] } }, expect: 202 });
}
async function waitRun(cid: string) {
  return waitFor('customer reply', async () => {
    const r = await tenantOne(sql`select id,status,error_code,output_message_id,policy_snapshot from app.assistant_runs
      where enterprise_id=${eid} and conversation_id=${cid} and purpose='reply' order by id desc limit 1`);
    return r && !['queued', 'running'].includes(String(r.status)) ? r : undefined;
  }, 360000);
}
async function readAnswer(token: string, run: Row, cid: string) {
  const messages = (await api(token, `/conversations/${cid}/messages?limit=50`)).data.data as Row;
  const items = (messages.items as Row[] | undefined) || [];
  const answer = items.find(m => String(m.id) === String(run.output_message_id));
  assert.ok(answer && String(answer.authorKind) === 'assistant', 'Assistant message persisted in its own conversation');
  const citations = await tenantRows(sql`select id,source_kind,resource_id,document_id from app.assistant_message_citations
    where enterprise_id=${eid} and run_id=${String(run.id)} order by id`);
  const steps = await tenantRows(sql`select step_seq,kind,capability_name,status,input_summary,source_refs from app.assistant_run_steps
    where enterprise_id=${eid} and run_id=${String(run.id)} order by step_seq`);
  return { answer, citations, steps,
    answerText: String(((answer.content as Row)?.blocks as Row[] || []).map(b => b.text || '').join('')) };
}
const textOf = (content: unknown) => String((((content as Row)?.blocks as Row[] | undefined) || []).map(b => String(b.text || '')).join(''));

async function main() {
  assert.ok(process.env.JWT_SECRET);
  const bound = nativeAgentRuntimeBinding(eid);
  assert.ok(bound, 'The langgraph-v1 executor switch must be active for 1454');
  report.nativeBinding = bound.binding;
  report.accounting.providerMaxBefore = String((await platformOne(sql`select coalesce(max(id),0) id from app.ai_provider_attempts`))!.id);
  const customerVersion = Number((await platformOne(sql`select context_version from app.users where id=${customerId}`))!.context_version);
  const customer = { token: await jwt({ sub: customerId, id: customerId, mode: 'customer', role: 'user', enterpriseId: eid,
    contextVersion: customerVersion, source: 'wechat' }) };

  await step('preflight: idle assistant queue and active native binding', async () => {
    const queue = await platformOne(sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`);
    assert.equal(queue!.n, 0, 'No isolation check may start on an active queue');
    return { queue: queue!.n, binding: bound!.binding };
  });

  await step('synthetic knowledge document published for the revocation journey', async () => {
    const knowledge = new KnowledgeService({ enterpriseId: eid, adminId: ownerId });
    // A round-unique clause number makes this round's chunk the only lexical
    // match for its own marker query; earlier rounds' twin documents compete
    // with identical embeddings and must never decide this assertion.
    const clauseMarker = 'ISO' + randomUUID().slice(0, 8).toUpperCase();
    report.revocation = report.revocation || {};
    (report.revocation as Row).clauseMarker = clauseMarker;
    const created = await knowledge.execute('create', { title: '[synthetic-isolation] 闭水试验蓄水要求',
      sourceType: 'manual_text', audience: 'customer_public',
      body: `合成隔离检查专用标准：闭水试验蓄水深度不少于20毫米，蓄水48小时后观察楼下顶板无渗漏，方可进入下一道工序。本条为隔离检查合成条款，条款编号${clauseMarker}。` }, randomUUID());
    const documentId = String((created.document as Row).id);
    const fixture = { documentId, versionId: String((created.draft as Row).id), expectedVersion: 1, expectedEditVersion: 1 };
    const queued = await knowledge.execute('index', fixture, randomUUID());
    const lease = await claimKnowledgeJob({ enterpriseId: eid, jobId: String(queued.jobId) });
    assert.ok(lease && String(lease.jobId) === String(queued.jobId), 'Synthetic document index job claimable');
    await runKnowledgeJob(lease!);
    const jobState = await knowledge.execute('job', { jobId: String(queued.jobId) } as never) as Row;
    assert.equal(String(jobState.status), 'succeeded', 'Synthetic document indexed');
    await knowledge.execute('publish', fixture, randomUUID());
    report.revocation = report.revocation || {};
    (report.revocation as Row).documentId = documentId;
    (report.revocation as Row).versionId = fixture.versionId;
    return { documentId, jobStatus: String(jobState.status) };
  });

  await step('two queued sessions stay isolated through their own runs', async () => {
    const entry = String(((await api(customer.token, '/entry-context', { body: { leadId } })).data.data as Row).entryToken);
    const convA = String(((await api(customer.token, '/conversations', { body: { entryToken: entry }, key: randomUUID() })).data.data as Row).id);
    const convB = String(((await api(customer.token, '/conversations', { body: { entryToken: entry }, key: randomUUID() })).data.data as Row).id);
    // Both messages are queued before either run completes: the enterprise slot
    // processes them serially by design, and nothing may cross the wires.
    await sendTurn(customer.token, convA, '我家现在施工到哪一步？最近做了什么？');
    await sendTurn(customer.token, convB, '卫生间防水做完之后，闭水试验要注意什么？');
    const [runA, runB] = await Promise.all([waitRun(convA), waitRun(convB)]);
    for (const run of [runA, runB]) {
      assert.equal(String(run.status), 'succeeded', 'Both queued sessions must succeed: ' + String(run.error_code || ''));
      assert.equal(executorOf(run), 'xiaok-native-executor-v1', 'Both sessions must use the native executor');
      assert.equal(bindingOf(run), bound!.binding, 'Both sessions must record the audited binding');
    }
    const viewA = await readAnswer(customer.token, runA!, convA);
    const viewB = await readAnswer(customer.token, runB!, convB);
    // Session A names its own authorized snapshot; session B answers from its
    // own retrieval only, and every B citation traces to B's own run steps.
    assert.match(viewA.answerText, /项目记录（授权快照，以此为准）/, 'Session A carries its own snapshot section');
    const bRetrieval = (viewB.steps as Row[]).filter(s => String(s.kind) === 'retrieval' && Number(s.step_seq) >= 1300 && Number(s.step_seq) < 1400);
    const bEvidenceRefs = new Set(bRetrieval.flatMap(s => ((s.source_refs as Row[] | undefined) || []).map(ref => String((ref.ref as Row | undefined)?.id ?? ref.id))));
    for (const citation of viewB.citations as Row[]) {
      assert.equal(citation.source_kind, 'knowledge', 'Session B citations must be knowledge citations');
      assert.ok(bEvidenceRefs.has(String(citation.resource_id)), 'Session B citation must come from session B retrieval only');
    }
    for (const citation of (viewA.citations as Row[]) || []) {
      const aRetrieval = (viewA.steps as Row[]).filter(s => String(s.kind) === 'retrieval' && Number(s.step_seq) >= 1300 && Number(s.step_seq) < 1400);
      const aEvidenceRefs = new Set(aRetrieval.flatMap(s => ((s.source_refs as Row[] | undefined) || []).map(ref => String((ref.ref as Row | undefined)?.id ?? ref.id))));
      assert.ok(aEvidenceRefs.has(String(citation.resource_id)), 'Session A citation must come from session A retrieval only');
    }
    const counts = await tenantRows(sql`select conversation_id,count(*)::int n from app.assistant_messages
      where enterprise_id=${eid} and conversation_id in (${convA},${convB}) group by conversation_id`);
    assert.deepEqual((counts as Row[]).map(c => Number(c.n)).sort(), [2, 2], 'Each conversation keeps exactly its own two messages');
    (report.isolation = { convA, convB, runA: String(runA!.id), runB: String(runB!.id),
      answerA: viewA.answerText.slice(0, 400), answerB: viewB.answerText.slice(0, 400),
      citationsA: (viewA.citations as Row[]).length, citationsB: (viewB.citations as Row[]).length });
    return report.isolation;
  });

  await step('revoked source leaves retrieval until republished', async () => {
    const documentId = String((report.revocation as Row).documentId);
    const knowledge = new KnowledgeService({ enterpriseId: eid, adminId: ownerId });
    // Deterministic retrieval-layer assertions drive the REAL retrieval function
    // with the customer principal and the current knowledge epoch: the model's
    // tool choice (requireTool accepts any tool) must not decide whether the
    // revocation semantics are observable. Chat turns stay as journey evidence;
    // their citations are model-dependent and only recorded.
    const chunkIds = new Set(((await withPlatformTransaction(tx => rows(tx, sql`select c.id::text from app.assistant_knowledge_chunks c
      join app.assistant_knowledge_versions v on v.enterprise_id=c.enterprise_id and v.id=c.document_version_id
      where c.enterprise_id=${eid} and v.document_id=${documentId}`))) as Row[]).map(c => String(c.id)));
    assert.ok(chunkIds.size > 0, 'Synthetic chunks indexed');
    const actor = (await tenantOne(sql`select policy_snapshot->'actor' as actor from app.assistant_runs
      where enterprise_id=${eid} and id=${String((report.isolation as Row).runA)}`))!.actor;
    const markerQuery = `条款编号${String((report.revocation as Row).clauseMarker)} 闭水试验 蓄水深度 蓄水时间`;
    const reachable = async () => {
      const epoch = Number((await tenantOne(sql`select knowledge_epoch from app.assistant_enterprise_settings where enterprise_id=${eid}`))!.knowledge_epoch);
      const result = await retrieveKnowledge(cid, actor as never, markerQuery, epoch);
      return result.evidence.filter(e => chunkIds.has(String(e.ref.id))).length;
    };
    const citationOf = async (runId: string) => (await tenantRows(sql`select document_id from app.assistant_message_citations
      where enterprise_id=${eid} and run_id=${runId}`) as Row[]).some(c => String(c.document_id) === documentId);
    const entry = String(((await api(customer.token, '/entry-context', { body: { leadId } })).data.data as Row).entryToken);
    const cid = String(((await api(customer.token, '/conversations', { body: { entryToken: entry }, key: randomUUID() })).data.data as Row).id);
    await sendTurn(customer.token, cid, '合成隔离检查专用标准里，闭水试验的蓄水深度和时间有什么要求？');
    const first = await waitRun(cid);
    assert.equal(String(first.status), 'succeeded', 'Pre-revocation turn must succeed: ' + String(first.error_code || ''));
    const firstHits = await reachable();
    assert.ok(firstHits > 0, 'The published synthetic source must be retrievable before revocation');
    const firstCited = await citationOf(String(first.id));
    const docVersion = async () => Number((await tenantOne(sql`select version from app.assistant_knowledge_documents
      where enterprise_id=${eid} and id=${documentId}`))!.version);
    await knowledge.execute('retire', { documentId, expectedVersion: await docVersion() }, randomUUID());
    await sendTurn(customer.token, cid, '再确认一下，闭水试验到底要蓄水多久？');
    const second = await waitRun(cid);
    assert.equal(String(second.status), 'succeeded', 'Revoked-source follow-up must still succeed: ' + String(second.error_code || ''));
    assert.equal(await reachable(), 0, 'A revoked source must not re-enter retrieval');
    const secondCited = await citationOf(String(second.id));
    assert.equal(secondCited, false, 'A revoked source must not be cited again');
    await knowledge.execute('publish', { documentId, versionId: String((report.revocation as Row).versionId),
      expectedVersion: await docVersion(), expectedEditVersion: 1 } as never, randomUUID());
    await sendTurn(customer.token, cid, '好的，那按合成隔离检查专用标准，闭水试验要做多久？');
    const third = await waitRun(cid);
    assert.equal(String(third.status), 'succeeded', 'Restored-source follow-up must succeed: ' + String(third.error_code || ''));
    assert.ok((await reachable()) > 0, 'The republished source re-enters retrieval');
    (report.revocation as Row).journey = { conversationId: cid, firstRun: String(first.id), secondRun: String(second.id),
      thirdRun: String(third.id), firstHits, firstCited, secondCited, thirdCited: await citationOf(String(third.id)) };
    return (report.revocation as Row).journey;
  });

  await step('native-mode FastGPT audit criteria', async () => {
    assert.ok(workflowsFile, 'FastGPT 审计未配置,不得判 PASS');
    assert.ok(auditFile && fs.existsSync(auditFile), 'FastGPT 审计文件缺失,不得判 PASS');
    let entries: ReturnType<typeof auditWindowEntries>;
    try { entries = auditWindowEntries(auditLines(), auditBefore); }
    catch (error) { assert.fail(readableAuditError(error)); }
    const kinds = auditKindCounts(entries);
    const nonStage = auditNonStageKinds(kinds);
    assert.equal(nonStage.length, 0, 'Chat path must not call FastGPT, saw: ' + nonStage.join(','));
    report.fastgptAudit = { configured: true, auditFile, roundWindow: { start: auditBefore, end: auditLines().length, kinds },
      mode: 'xiaok-native-executor-v1' };
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
      const checks = (report.checks as Row[]);
      const passed = checks.length > 0 && checks.every(c => c.passed) && !report.error
        && !((report.drift as string[] | undefined) || []).length && !report.finalizeError;
      if (!passed) process.exitCode = 1;
      console.log(JSON.stringify({ passed, checks: checks.length, error: report.error || null, drift: report.drift || [] })); }
  });
