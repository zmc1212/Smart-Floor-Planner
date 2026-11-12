/** One real user journey under enterprise 1454: customer consultation with
 * citations, a real stage progress event, four-role stage/daily reports,
 * read/ack/reentry and permission boundaries. Uses the live 3006 service and
 * Worker; never retries a dispatched provider call and never injects answers. */
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
import { ConstructionService } from '@/lib/construction/service';
import { ConstructionReportService, reportPlanDto } from '@/lib/construction/report-service';
import { fastGPTAgentV2Configuration, nativeAgentRuntimeBinding } from '@/lib/assistant/fastgpt/agent-v2/config';
import { auditDeployment, auditKindCounts, auditPrefixHash, auditWindowEntries,
  openAuditWindow, readableAuditError } from '@/lib/assistant/fastgpt/agent-v2/audit-window';
import { isNativeExecutor, nativeAuditKindViolations, stageBodyToleratedByLegacyFlag, stageBodyViolations,
  stageFastgptDownNote } from '@/lib/assistant/fastgpt/agent-v2/native-acceptance';

loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development'));
const root = path.resolve('..'), eid = '1454', customerId = '645', ownerId = '2853', projectId = '237', leadId = '3132';
const batchId = String(process.argv.find(a => a.startsWith('--batch='))?.slice(8) || process.env.XIAOK_AUDIT_BATCH || '').trim();
const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/xiaok-1454-full-flow-20261109/round-01');
const stageTarget = process.argv.find(a => a.startsWith('--stage='))?.slice(8) || 'furnishing';
const stageNote = process.argv.find(a => a.startsWith('--note='))?.slice(7) || '合成全流程测试：安装节点完成，进入软装';
// The executor is explicit per round; the default preserves the historical
// Agent V2 expectation until the FastGPT exit completes.
const expectedExecutor = process.argv.find(a => a.startsWith('--executor='))?.slice(11) || 'fastgpt-agent-v2-v1';
// A native round claims its zero-FastGPT window from a batch-bound V2 probe
// receipt, so the batch id is mandatory there; the legacy V2 mode does not use
// a receipt and keeps its historical command line.
assert.ok(batchId || expectedExecutor !== 'xiaok-native-executor-v1',
  'Acceptance batch id required for the native executor: pass --batch=<id> (or XIAOK_AUDIT_BATCH)');
// Stage report bodies compose natively, so this legacy flag is honored only in
// FastGPT V2 rounds; a native round must fail on a failed or empty stage body.
const stageFastgptDown = process.argv.includes('--stage-fastgpt=down');
// A questions file avoids Chinese argv mojibake on Windows shells.
const questionsFile = process.argv.find(a => a.startsWith('--questions-file='))?.slice(17);
const chatQuestions = questionsFile ? (JSON.parse(fs.readFileSync(path.resolve(questionsFile), 'utf8')).questions as string[])
  : (process.argv.find(a => a.startsWith('--questions='))?.slice(12) || '')
    .split('|').map(q => q.trim()).filter(Boolean);
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Retain the original round');
const target = new URL(process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
fs.mkdirSync(output, { recursive: true });
const base = 'http://127.0.0.1:3006/api/miniprogram/assistant';
type ReportRow = Row & { accounting: Row; chat?: Row; permissions?: Row; fastgptAudit?: Row; progressQuestion?: Row;
  reportQuestion?: Row; probe?: Row; auditWindow?: Row };
const report: ReportRow = { startedAt: new Date().toISOString(), enterpriseId: eid, scope: 'one customer/stage/four-role-report journey',
  checks: [], failures: [], accounting: {} };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const read = <T>(fn: Parameters<typeof withTenantTransaction<T>>[1]) => withTenantTransaction(eid, fn);
const tenantOne = (q: ReturnType<typeof sql>) => read(tx => one(tx, q));
const tenantRows = (q: ReturnType<typeof sql>) => read(tx => rows(tx, q));
const platformOne = (q: ReturnType<typeof sql>) => withPlatformTransaction(tx => one(tx, q));
const platformRows = (q: ReturnType<typeof sql>) => withPlatformTransaction(tx => rows(tx, q));

function binding() {
  const files = execFileSync('rg', ['--files', 'admin/src', 'admin/scripts', 'miniprogram/packages/assistant'], { cwd: root, encoding: 'utf8' })
    .trim().split(/\r?\n/).map(p => p.replaceAll('\\', '/'));
  files.push('admin/scripts/xiaok-1454-full-flow-check.ts', 'admin/.env.local');
  // The workflows binding exists only when the deployment actually configures
  // one; an unavailable FastGPT round must not read a directory placeholder.
  if (process.env.XIAOK_FASTGPT_WORKFLOWS_FILE?.trim())
    files.push(path.relative(root, path.resolve(process.env.XIAOK_FASTGPT_WORKFLOWS_FILE)).replaceAll('\\', '/'));
  return Object.fromEntries([...new Set(files)].sort().map(f => [f, createHash('sha256').update(fs.readFileSync(path.isAbsolute(f) ? f : path.join(root, f))).digest('hex')]));
}
const before = binding();
report.bindingBefore = createHash('sha256').update(JSON.stringify(before)).digest('hex');

// FastGPT audit ledger. Mode-aware: the native executor adds zero records of
// any kind (chat and stage-report bodies both run natively); the FastGPT V2
// bridge records audited chat calls instead. In native mode this
// round's window opens only after the batch probe receipt is verified; an
// unverified, truncated or rebuilt ledger never reads as zero calls.
const workflowsFile = process.env.XIAOK_FASTGPT_WORKFLOWS_FILE?.trim();
const workflows = workflowsFile ? JSON.parse(fs.readFileSync(path.resolve(workflowsFile), 'utf8')) as Row : undefined;
const deployment = workflowsFile ? auditDeployment(path.resolve(workflowsFile), workflows as Row, base) : undefined;
const auditFile = deployment?.auditFile;
const auditLines = () => auditFile && fs.existsSync(auditFile)
  ? fs.readFileSync(auditFile, 'utf8').trim().split(/\r?\n/).filter(Boolean) : [];
let auditBefore = 0;
// Prefix identity captured when the window opened; the round fails closed if
// the earlier ledger is replaced or rebuilt, even at the same length.
let auditWindowPrefix = '';

async function step(name: string, fn: () => Promise<unknown>) {
  try { const data = await fn(); (report.checks as Row[]).push({ name, passed: true, data }); console.log(name + ': PASS'); return data; }
  catch (e) { (report.checks as Row[]).push({ name, passed: false, error: (e as Error).message });
    (report.failures as Row[]).push({ name, error: (e as Error).stack || (e as Error).message }); throw e; }
  finally { save(); }
}
async function waitFor<T>(label: string, fn: () => Promise<T | undefined | false>, timeoutMs: number, intervalMs = 3000) {
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
async function api(token: string, route: string, init: { method?: string; body?: Row; entry?: string; key?: string; expect?: number | number[]; host?: string } = {}) {
  const headers: Record<string, string> = { Authorization: 'Bearer ' + token };
  if (init.entry) headers['X-Assistant-Entry'] = init.entry;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.key) headers['Idempotency-Key'] = init.key;
  const response = await fetch((init.host || base) + route, { method: init.method || (init.body !== undefined ? 'POST' : 'GET'), headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(60000) });
  const data = await response.json().catch(() => ({})) as Row;
  const expected = init.expect ?? 200;
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status),
    route + ': ' + response.status + '/' + String(data.code || data.error || ''));
  return { status: response.status, data };
}
const tokenPrefix = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 12);
const staffTokens = new Map<string, { token: string; role: string; binding?: string; audience?: string }>();

/** One real customer turn through the live service: send, wait for the run,
 * read the persisted answer and open every citation it carries. */
async function customerTurn(token: string, cid: string, text: string) {
  const clientMessageId = randomUUID();
  await api(token, `/conversations/${cid}/messages`, { key: clientMessageId,
    body: { clientMessageId, content: { version: 1, blocks: [{ type: 'text', text }] } }, expect: 202 });
  const run = await waitFor('customer reply', async () => {
    const r = await tenantOne(sql`select id,status,error_code,policy_snapshot,output_message_id from app.assistant_runs
      where enterprise_id=${eid} and conversation_id=${cid} and purpose='reply' order by id desc limit 1`);
    return r && !['queued', 'running'].includes(String(r.status)) ? r : undefined;
  }, 360000, 2500);
  const messages = (await api(token, `/conversations/${cid}/messages?limit=50`)).data.data as Row;
  const items = (messages.items || []) as Row[];
  // The public message DTO deliberately carries no run id; the run row names
  // the output message that this HTTP readback must expose.
  const answer = items.find(m => String(m.id) === String(run.output_message_id));
  assert.ok(answer && String(answer.authorKind) === 'assistant', 'Assistant message persisted');
  const citationRows = await tenantRows(sql`select id,source_kind,resource_type,resource_id from app.assistant_message_citations
    where enterprise_id=${eid} and run_id=${String(run.id)} order by id`);
  const citations: Row[] = [];
  for (const citation of citationRows) {
    const opened = (await api(token, '/citations/' + String(citation.id))).data.data as Row;
    citations.push({ id: String(citation.id), sourceKind: String(citation.source_kind), title: String(opened.title || ''),
      hasText: Boolean(opened.text || opened.content || opened.excerpt) });
  }
  return { run, answer, citations, answerText: String(((answer.content as Row)?.blocks as Row[] || []).map(b => b.text || '').join('')) };
}
const executorOf = (run: Row) => String(((run.policy_snapshot as Row)?.agentRuntime as Row | undefined)?.protocol || '');
async function staffToken(adminId: string) {
  const cached = staffTokens.get(adminId); if (cached) return cached;
  const row = (await platformOne(sql`select a.id,a.user_id,a.role,a.status,a.must_change_password,u.context_version
    from app.admin_users a join app.users u on u.id=a.user_id where a.enterprise_id=${eid} and a.id=${adminId}`))!;
  assert.equal(row.status, 'active'); assert.ok(!row.must_change_password);
  const value = { token: await jwt({ sub: String(row.user_id), id: String(row.user_id), mode: 'staff', role: String(row.role),
    staffId: String(row.id), enterpriseId: eid, contextVersion: Number(row.context_version), source: 'password' }), role: String(row.role) };
  staffTokens.set(adminId, value); return value;
}

async function main() {
  assert.ok(process.env.JWT_SECRET);
  const customerVersion = Number((await platformOne(sql`select context_version from app.users where id=${customerId}`))!.context_version);
  const customer = { token: await jwt({ sub: customerId, id: customerId, mode: 'customer', role: 'user', enterpriseId: eid,
    contextVersion: customerVersion, source: 'wechat' }) };
  const owner = (await staffToken(ownerId)).token;
  report.tokens = { customer: tokenPrefix(customer.token), owner: tokenPrefix(owner) };

  await step('preflight: idle queue, labelled project and active plan', async () => {
    const queue = await platformOne(sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`);
    assert.equal(queue!.n, 0, 'No acceptance may start on an active queue');
    const project = (await tenantOne(sql`select p.id,p.name,p.status,p.current_stage_key,p.version,p.customer_access,l.customer_user_id
      from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
      where p.enterprise_id=${eid} and p.id=${projectId} and l.archived_at is null`))!;
    assert.match(String(project.name), /合成手测/); assert.equal(project.status, 'active'); assert.equal(project.customer_access, true);
    assert.equal(String(project.customer_user_id), customerId);
    const settings = reportPlanDto(await new ConstructionReportService({ enterpriseId: eid, adminId: ownerId }).settings() as Row, eid);
    assert.equal(settings.enabled, true); assert.equal(settings.stageEnabled, true);
    const bindings = await tenantRows(sql`select id,audience,status,project_id,admin_id,user_id from app.construction_followup_bindings
      where enterprise_id=${eid} and id in (59,422,426,427,428,429,430,431) order by id`);
    assert.deepEqual(bindings.map(b => String(b.id)), ['59', '422', '426', '427', '428', '429', '430', '431']);
    report.accounting.before = {
      providerMax: String((await platformOne(sql`select coalesce(max(id),0) id from app.ai_provider_attempts`))!.id),
      knowledgeMax: String((await platformOne(sql`select coalesce(max(id),0) id from app.assistant_knowledge_attempts`))!.id) };
    return { project, settings, bindings: bindings.map(b => ({ id: String(b.id), audience: String(b.audience), status: String(b.status) })) };
  });

  // This round's audit window opens BEFORE any customer turn. In native mode
  // the batch probe receipt must first prove the ledger receives this
  // deployment's own FastGPT writes; in V2 mode the live ledger position alone
  // is the baseline and delta correlation proves activity.
  await step('audit window opened for this round', async () => {
    assert.ok(workflowsFile && deployment && auditFile, 'FastGPT 审计未配置,不得判 PASS');
    assert.ok(fs.existsSync(auditFile), 'FastGPT 审计文件缺失,不得判 PASS');
    if (expectedExecutor === 'xiaok-native-executor-v1') {
      const receiptPath = path.resolve(process.argv.find(a => a.startsWith('--audit-probe-receipt='))?.slice(22)
        || '../tmp/xiaok-native-executor-20261111-recovery/four-questions/audit-probe.json');
      assert.ok(fs.existsSync(receiptPath), '审计探针回执缺失:请在 V2 绑定期以同一批次运行 scripts/xiaok-audit-probe.ts,不得判 PASS');
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')) as Row;
      let opened: ReturnType<typeof openAuditWindow>;
      try {
        opened = openAuditWindow({ receipt, expected: { batchId, workflowsFile: deployment.workflowsFile,
          auditFile: deployment.auditFile, serviceBase: base, deploymentFingerprint: deployment.fingerprint,
          roundMode: 'xiaok-native-executor-v1' }, lines: auditLines() });
      } catch (error) { assert.fail(readableAuditError(error)); }
      auditBefore = opened.windowStart;
      auditWindowPrefix = opened.windowPrefixHash;
      report.probe = { probeRunId: opened.probeRunId, batchId: opened.batchId, probeMode: opened.probeMode,
        probeBinding: opened.probeBinding, verifiedAt: opened.verifiedAt, probeWindow: opened.probeWindow,
        roundWindowStart: opened.windowStart, modeTransition: opened.modeTransition };
      report.auditWindow = { batchId, mode: 'xiaok-native-executor-v1', start: auditBefore, end: null };
      return report.probe;
    }
    const ledger = auditLines();
    auditBefore = ledger.length;
    auditWindowPrefix = auditPrefixHash(ledger, auditBefore);
    report.auditWindow = { batchId, mode: expectedExecutor, start: auditBefore, end: null };
    return report.auditWindow;
  });

  await step('customer entry and two natural turns with citation readback', async () => {
    const entry = (await api(customer.token, '/entry-context', { body: { leadId } })).data.data as Row;
    assert.ok(entry.entryToken);
    const created = (await api(customer.token, '/conversations', { body: { entryToken: entry.entryToken }, key: randomUUID() })).data.data as Row;
    const cid = String(created.id);
    const turns: Row[] = [];
    const questions = chatQuestions.length ? chatQuestions : ['我家正在改水电，打压试验要做到什么程度才算合格？', '打压的时候我在现场要看哪些数据？'];
    for (const [index, text] of questions.entries()) {
      const turn = await customerTurn(customer.token, cid, text);
      turns.push({ question: text, runId: String(turn.run.id), status: String(turn.run.status), errorCode: turn.run.error_code || null,
        runtime: executorOf(turn.run) || null, binding: String(((turn.run.policy_snapshot as Row)?.agentRuntime as Row | undefined)?.binding || ''),
        answerText: turn.answerText.slice(0, 600), citations: turn.citations });
      if (index === 0) assert.equal(String(turn.run.status), 'succeeded', 'First real answer must succeed: ' + String(turn.run.error_code || ''));
    }
    assert.ok(turns.length > 0 && turns.every(t => t.runtime === expectedExecutor),
      'Live service must select ' + expectedExecutor + ' for 1454, saw: ' + turns.map(t => t.runtime).join(','));
    const listed = (await api(customer.token, '/conversations?limit=20', { entry: String(entry.entryToken) })).data.data as Row;
    assert.ok(((listed.items as Row[] | undefined) || []).some((c: Row) => String(c.id) === cid), 'Conversation is listed on reentry');
    const detail = (await api(customer.token, '/conversations/' + cid)).data.data as Row;
    assert.equal(String(detail.id), cid);
    report.chat = { conversationId: cid, entryTokenHash: createHash('sha256').update(String(entry.entryToken)).digest('hex'), turns, reentry: true };
    return { conversationId: cid, turns: turns.map(t => ({ runId: t.runId, runtime: t.runtime, citations: (t.citations as Row[]).length })) };
  });

  await step('real stage progress produces four-role stage reports', async () => {
    const service = new ConstructionService({ enterpriseId: eid, adminId: ownerId });
    const current = (await service.execute('detail', { projectId })).project as Row;
    const progressed = await service.execute('progress', { projectId, expectedVersion: Number(current.version), stageKey: stageTarget,
      note: stageNote, sendReminder: false }, randomUUID());
    const event = (await tenantOne(sql`select id,payload from app.domain_event_outbox where enterprise_id=${eid}
      and type='construction.stage.updated.v1' and aggregate_id=${projectId} order by id desc limit 1`))!;
    assert.equal(String((event.payload as Row).stageKey), stageTarget);
    const reports = await waitFor('stage report composition', async () => {
      const found = await tenantRows(sql`select r.binding_id,r.id report_id,v.revision,v.knowledge_status,v.body,v.body_run_id,
        br.status body_status,br.error_code body_error,d.state delivery_state,d.read_at
        from app.construction_reports r
        join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=r.latest_revision
        left join app.assistant_runs br on br.enterprise_id=v.enterprise_id and br.id=v.body_run_id
        left join app.construction_report_deliveries d on d.enterprise_id=r.enterprise_id and d.report_id=r.id and d.revision=v.revision and d.binding_id=r.binding_id
        where r.enterprise_id=${eid} and r.stage_event_id=${String(event.id)} order by r.binding_id`);
      if (!found.length) return undefined;
      // A fresh report row can be inserted before its body job is enqueued:
      // wait until every recipient has a composed body or a terminal failure.
      const active = (s: unknown) => ['queued', 'running'].includes(String(s));
      // Stored bodies are structured objects ({projects:[...]}); the HTTP view
      // expands them to parts, so readiness must not require a DB array.
      const composed = (body: unknown) => Array.isArray(body) ? body.length > 0 : Boolean(body && typeof body === 'object');
      const pending = found.some(r => active(r.body_status) || active(r.knowledge_status)
        || (!composed(r.body) && !r.body_error
          && !['failed', 'skipped'].includes(String(r.body_status)) && !['failed', 'skipped'].includes(String(r.knowledge_status))));
      return pending ? undefined : found;
    }, 1200000, 5000);
    const byBinding = new Map(reports.map(r => [String(r.binding_id), r]));
    for (const id of ['59', '422', '427', '429', '430', '431']) assert.ok(byBinding.has(id), 'Stage report missing for binding ' + id);
    for (const id of ['420', '421', '423', '424', '425', '426', '428']) assert.ok(!byBinding.has(id), 'Unexpected stage recipient ' + id);
    const views: Row[] = [];
    const entryToken = String(((await api(customer.token, '/entry-context', { body: { leadId } })).data.data as Row).entryToken);
    const readers: Row[] = [{ kind: 'customer', binding: '422', token: customer.token, entry: entryToken }, { kind: 'boss', binding: '59', token: owner },
      { kind: 'designer', binding: '427', token: (await staffToken('5368')).token }, { kind: 'worker', binding: '429', token: (await staffToken('5370')).token }];
    for (const reader of readers) {
      const listed = (await api(String(reader.token), `/followups/${reader.binding}/reports?projectId=${projectId}`, { entry: String(reader.entry ?? '') })).data.data as Row;
      const item = ((listed.items as Row[] | undefined) || []).find((r: Row) => String(r.kind) === 'stage');
      assert.ok(item, 'Stage history missing for ' + reader.kind);
      const detail = (await api(String(reader.token), `/followups/${reader.binding}/reports/${String(item.reportId)}?revision=${String(item.revision)}`, { entry: String(reader.entry ?? '') })).data.data as Row;
      assert.equal(detail.available, true); assert.ok((((detail.facts as Row | undefined)?.projects as Row[] | undefined) || []).some((p: Row) => String(p.id) === projectId));
      // Legacy V2 rounds tolerated a deliberately skipped body behind the flag;
      // native rounds are judged below over every report run and reader view.
      if (!isNativeExecutor(expectedExecutor) && !stageBodyToleratedByLegacyFlag(expectedExecutor, stageFastgptDown))
        assert.ok(Array.isArray(detail.body) && detail.body.length > 0, 'Stage body composed for ' + reader.kind);
      views.push({ kind: reader.kind, binding: reader.binding, reportId: String(item.reportId), revision: Number(item.revision),
        contentStatus: detail.contentStatus, bodyParts: Array.isArray(detail.body) ? detail.body.length : 0,
        bodyStatus: detail.contentStatus || null, deliveryState: detail.deliveryState });
    }
    // A native stage body has no FastGPT fallback: every report run must be
    // succeeded without an error code, and every reader must receive a body.
    if (isNativeExecutor(expectedExecutor)) {
      const violations = stageBodyViolations({
        reports: reports.map(r => ({ bindingId: String(r.binding_id), reportId: String(r.report_id),
          bodyStatus: r.body_status, bodyError: r.body_error })),
        readers: views.map(v => ({ kind: String(v.kind), binding: String(v.binding), bodyParts: Number(v.bodyParts) })) });
      assert.equal(violations.length, 0, 'Native stage bodies must compose successfully: ' + violations.join('; '));
    }
    await api((await staffToken('5369')).token, `/followups/428/reports?projectId=${projectId}`, { expect: 404 });
    await api(customer.token, `/followups/420/reports?projectId=${projectId}`, { entry: entryToken, expect: 404 });
    report.stage = { eventId: String(event.id), progressed: { version: progressed.version, reminderRecorded: progressed.reminderRecorded },
      reports: reports.map(r => ({ bindingId: String(r.binding_id), reportId: String(r.report_id), state: r.delivery_state,
        bodyRunId: r.body_run_id ? String(r.body_run_id) : null, bodyStatus: r.body_status || null, bodyError: r.body_error || null })), views };
    return { eventId: String(event.id), recipients: views.map(v => v.kind) };
  });

  await step('own-project progress question in the same conversation', async () => {
    const cid = String(report.chat?.conversationId);
    const turn = await customerTurn(customer.token, cid, '我家现在施工到哪一步？最近做了什么？');
    assert.equal(String(turn.run.status), 'succeeded', 'Progress reply must succeed: ' + String(turn.run.error_code || ''));
    assert.equal(executorOf(turn.run), expectedExecutor, 'Progress reply must use ' + expectedExecutor);
    assert.match(turn.answerText, /软装/, 'The reply must name the real current stage from the authorized snapshot');
    report.progressQuestion = { question: '我家现在施工到哪一步？最近做了什么？', runId: String(turn.run.id),
      binding: String(((turn.run.policy_snapshot as Row)?.agentRuntime as Row | undefined)?.binding || ''),
      answerText: turn.answerText.slice(0, 600), citations: turn.citations.length };
    return { runId: String(turn.run.id), citations: turn.citations.length };
  });

  await step('controlled daily through the live scheduler and four-role readback', async () => {
    const service = new ConstructionReportService({ enterpriseId: eid, adminId: ownerId });
    const entry = String(((await api(customer.token, '/entry-context', { body: { leadId } })).data.data as Row).entryToken);
    const original = reportPlanDto(await service.settings() as Row, eid);
    const now = new Date();
    const at = new Date(now.getTime() + 2 * 60_000);
    const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
    const input = (version: number, changes: Row) => ({ expectedVersion: version, enabled: true, dailyTime: original.dailyTime,
      weeklyTime: original.weeklyTime, projectIds: original.projectIds, stageKeys: original.stageKeys, stageEnabled: original.stageEnabled,
      weeklyDay: original.weeklyDay, audiences: original.audiences, inactivePolicy: 'pause_inactive', ...changes });
    let staged: Row | undefined;
    try {
      staged = await service.configure(input(original.version, { dailyTime: hhmm, projectIds: [projectId] }), 'full-flow-daily-' + randomUUID());
      const nextDaily = new Date(String(staged.next_daily_at));
      assert.ok(nextDaily.getTime() > now.getTime(), 'Controlled daily is scheduled in the future');
      const reports = await waitFor('controlled daily composition', async () => {
        const found = await tenantRows(sql`select r.binding_id,r.id report_id,v.revision,v.knowledge_status,v.body,v.body_run_id,
          br.status body_status,br.error_code body_error,d.state delivery_state,d.read_at
          from app.construction_reports r
          join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=r.latest_revision
          left join app.assistant_runs br on br.enterprise_id=v.enterprise_id and br.id=v.body_run_id
          left join app.construction_report_deliveries d on d.enterprise_id=r.enterprise_id and d.report_id=r.id and d.revision=v.revision and d.binding_id=r.binding_id
          where r.enterprise_id=${eid} and r.kind='daily' and r.created_at>=${new Date(now.getTime() - 60_000)} order by r.binding_id`);
        if (!found.length) return undefined;
        const active = (s: unknown) => ['queued', 'running'].includes(String(s));
        // Same stored-object vs HTTP-view distinction as the stage wait.
        const composed = (body: unknown) => Array.isArray(body) ? body.length > 0 : Boolean(body && typeof body === 'object');
        const pending = found.some(r => active(r.body_status) || active(r.knowledge_status)
          || (!composed(r.body) && !r.body_error
            && !['failed', 'skipped'].includes(String(r.body_status)) && !['failed', 'skipped'].includes(String(r.knowledge_status))));
        return pending ? undefined : found;
      }, 1200000, 5000);
      const byBinding = new Map(reports.map(r => [String(r.binding_id), r]));
      for (const id of ['59', '422', '427', '429', '430', '431']) assert.ok(byBinding.has(id), 'Daily report missing for binding ' + id);
      for (const id of ['420', '421', '423', '424', '425', '426', '428']) assert.ok(!byBinding.has(id), 'Unexpected daily recipient ' + id);
      const views: Row[] = [];
      const readers: Row[] = [{ kind: 'customer', binding: '422', token: customer.token, entry }, { kind: 'boss', binding: '59', token: owner },
        { kind: 'designer', binding: '427', token: (await staffToken('5368')).token }, { kind: 'worker', binding: '429', token: (await staffToken('5370')).token }];
      for (const reader of readers) {
        const listed = (await api(String(reader.token), `/followups/${reader.binding}/reports?projectId=${projectId}&kind=daily`, { entry: String(reader.entry ?? '') })).data.data as Row;
        const item = ((listed.items as Row[] | undefined) || []).find((r: Row) => String(r.kind) === 'daily');
        assert.ok(item, 'Daily history missing for ' + reader.kind);
        const detail = (await api(String(reader.token), `/followups/${reader.binding}/reports/${String(item.reportId)}?revision=${String(item.revision)}`, { entry: String(reader.entry ?? '') })).data.data as Row;
        assert.equal(detail.available, true); assert.ok(Array.isArray(detail.body) && detail.body.length > 0);
        views.push({ kind: reader.kind, binding: reader.binding, reportId: String(item.reportId), revision: Number(item.revision),
          contentStatus: detail.contentStatus, bodyParts: detail.body.length, deliveryState: detail.deliveryState, readAt: detail.readAt });
      }
      const customerItem = views.find(v => v.kind === 'customer')!;
      const detail = (await api(customer.token, `/followups/422/reports/${String(customerItem.reportId)}?revision=${String(customerItem.revision)}`, { entry })).data.data as Row;
      assert.ok(detail.readToken, 'Customer read token');
      await api(customer.token, `/followups/422/reports/${String(customerItem.reportId)}/acknowledge`, { entry, key: randomUUID(),
        body: { revision: Number(customerItem.revision), readToken: String(detail.readToken) } });
      const reread = (await api(customer.token, `/followups/422/reports/${String(customerItem.reportId)}?revision=${String(customerItem.revision)}`, { entry })).data.data as Row;
      assert.ok(reread.readAt, 'Customer acknowledgement persists');
      const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(new Date());
      const history = (await api(customer.token, `/followups/422/reports?month=${month}&kind=daily&projectId=${projectId}`, { entry })).data.data as Row;
      assert.ok(((history.items as Row[] | undefined) || []).some((r: Row) => String(r.reportId) === String(customerItem.reportId)));
      // Report references never enter the follow-up message list; reentry is the
      // destination list plus the private conversation projection.
      const destinations = (await api(customer.token, '/followups', { entry })).data.data as Row;
      assert.ok(((destinations.items as Row[] | undefined) || []).some((b: Row) => String(b.bindingId) === '422'), 'Follow-up destination listed on reentry');
      const conversation = (await api(customer.token, '/followups/422/conversation', { entry })).data.data as Row;
      assert.ok(conversation.id, 'Follow-up conversation readable on reentry');
      report.daily = { stagedVersion: Number(staged.version), nextDailyAt: staged.next_daily_at, original,
        reports: reports.map(r => ({ bindingId: String(r.binding_id), reportId: String(r.report_id), state: r.delivery_state,
          bodyRunId: r.body_run_id ? String(r.body_run_id) : null, bodyStatus: r.body_status || null, bodyError: r.body_error || null })), views, readAt: reread.readAt, historyItems: ((history.items as Row[] | undefined) || []).length };
      return { stagedVersion: Number(staged.version), recipients: views.map(v => v.kind), readAt: reread.readAt };
    } finally {
      // Restore the user-requested plan even when the journey above failed.
      try {
        const current = reportPlanDto(await service.settings() as Row, eid);
        const restored = await service.configure(input(Number(current.version), { dailyTime: original.dailyTime, projectIds: original.projectIds,
          audiences: original.audiences, stageEnabled: original.stageEnabled }), 'full-flow-restore-' + randomUUID());
        report.restored = { enabled: reportPlanDto(restored, eid).enabled, version: Number(restored.version), nextDailyAt: restored.next_daily_at,
          nextWeeklyAt: restored.next_weekly_at, projectIds: reportPlanDto(restored, eid).projectIds };
      } catch (error) { report.restoreError = (error as Error).message; }
    }
  });

  await step('daily report records question without any business write', async () => {
    const cid = String(report.chat?.conversationId);
    // The zero-write window opens with this step: an enterprise-wide before/after
    // count would blame unrelated concurrent report writes on this chat turn,
    // so only rows created inside the window may fail the assertion.
    const stepStartedAt = new Date().toISOString();
    const turn = await customerTurn(customer.token, cid, '你发的日报里记的内容，和现场确认过的是一回事吗？');
    assert.equal(String(turn.run.status), 'succeeded', 'Report-question reply must succeed: ' + String(turn.run.error_code || ''));
    assert.equal(executorOf(turn.run), expectedExecutor, 'Report-question reply must use ' + expectedExecutor);
    assert.ok(turn.answerText.trim().length > 20, 'The reply must explain the record scopes instead of a fixed handoff script');
    const reportsAfter = Number((await tenantOne(sql`select count(*)::int n from app.construction_reports
      where enterprise_id=${eid} and created_at >= ${stepStartedAt}::timestamptz`))!.n);
    assert.equal(reportsAfter, 0, 'A chat question must not create reports inside the step window');
    const composeRuns = await tenantRows(sql`select id from app.assistant_runs where enterprise_id=${eid}
      and purpose='construction.report.compose' and trigger_kind='user_message'`);
    assert.equal(composeRuns.length, 0, 'No report composition may originate from a chat message');
    report.reportQuestion = { question: '你发的日报里记的内容，和现场确认过的是一回事吗？', stepStartedAt, runId: String(turn.run.id),
      binding: String(((turn.run.policy_snapshot as Row)?.agentRuntime as Row | undefined)?.binding || ''),
      answerText: turn.answerText.slice(0, 600), reportsAfter };
    return { runId: String(turn.run.id), stepStartedAt, reportsAfter };
  });

  await step('permission boundaries and restored plan readback', async () => {
    const settings = reportPlanDto(await new ConstructionReportService({ enterpriseId: eid, adminId: ownerId }).settings() as Row, eid);
    assert.equal(settings.enabled, true);
    const body = { expectedVersion: settings.version, enabled: settings.enabled, dailyTime: settings.dailyTime, weeklyTime: settings.weeklyTime,
      projectIds: settings.projectIds, stageKeys: settings.stageKeys, stageEnabled: settings.stageEnabled, weeklyDay: settings.weeklyDay,
      audiences: settings.audiences, inactivePolicy: 'pause_inactive' };
    const entry = String(((await api(customer.token, '/entry-context', { body: { leadId } })).data.data as Row).entryToken);
    await api(customer.token, '/followups/plan', { body, entry, key: randomUUID(), expect: 403 });
    await api((await staffToken('5368')).token, '/followups/plan', { body, key: randomUUID(), expect: 403 });
    await api((await staffToken('5370')).token, '/followups/plan', { expect: 403 });
    await api(customer.token, '/entry-context', { body: { leadId: '999999999' }, expect: 422 });
    const plan = (await api(owner, '/followups/plan')).data.data as Row;
    const planSettings = plan.settings as Row;
    assert.equal(planSettings.enabled, true); assert.equal(planSettings.dailyTime, '20:00');
    assert.deepEqual(planSettings.projectIds, []);
    report.permissions = { customerPlan: 403, designerPlan: 403, workerPlan: 403, foreignLead: 422,
      restoredEnabled: planSettings.enabled, dailyTime: planSettings.dailyTime, projectIds: planSettings.projectIds };
    return report.permissions;
  });

  await step('public site and portfolio recommendation read surfaces', async () => {
    const cid = String(report.chat?.conversationId);
    // Call both catalogs exactly as the Mini Program does: the site card sends its
    // discovery reply, the portfolio card sends no query and lets the service
    // resolve city/style from this conversation. A style without a city is not a
    // client call; explicit style matching stays covered by the catalog tests.
    const sites = (await api(customer.token, `/conversations/${cid}/public-sites/recommendations`)).data.data as Row;
    const portfolio = (await api(customer.token, `/conversations/${cid}/portfolio/recommendations`)).data.data as Row;
    const count = (value: Row) => Array.isArray(value?.items) ? value.items.length : Array.isArray(value) ? value.length : 0;
    assert.ok(Array.isArray(sites.items), 'Public site recommendations must return a list');
    assert.ok(Array.isArray(portfolio.items), 'Portfolio recommendations must return a list');
    assert.equal(typeof portfolio.notice, 'string', 'Portfolio recommendations must carry their notice');
    assert.ok(portfolio.needContext === true || portfolio.items.length > 0, 'Portfolio recommendations must answer or ask for context');
    report.surfaces = { publicSites: count(sites), portfolio: count(portfolio), portfolioNeedContext: portfolio.needContext === true };
    return report.surfaces;
  });

  await step('fastgpt audit ledger validity and mode criteria', async () => {
    // 审计证据本身必须有效:配置、文件、运行绑定缺一不可,否则不得判 PASS。
    assert.ok(workflowsFile, 'FastGPT 审计未配置(XIAOK_FASTGPT_WORKFLOWS_FILE 缺失),不得判 PASS');
    const auditPath = String((JSON.parse(fs.readFileSync(path.resolve(workflowsFile!), 'utf8')) as Row).auditFile || '');
    assert.ok(auditPath.trim(), 'FastGPT 审计文件未配置(workflows.auditFile 为空),不得判 PASS');
    assert.ok(fs.existsSync(auditPath), 'FastGPT 审计文件缺失(' + auditPath + '),不得判 PASS');
    assert.equal(auditPath, auditFile, '审计文件在运行中途被更换,不得判 PASS');
    // 运行服务必须与本脚本读取同一份配置:按模式解析期望绑定。
    const expectedBinding = (() => {
      try { return expectedExecutor === 'xiaok-native-executor-v1' ? nativeAgentRuntimeBinding(eid)?.binding : fastGPTAgentV2Configuration(eid)?.binding; }
      catch { return undefined; }
    })()?.trim();
    assert.ok(expectedBinding, 'FastGPT 运行绑定未解析(executor 与 workflows 配置不一致),不得判 PASS');
    const auditedTurns = [...(((report.chat as Row | undefined)?.turns as Row[] || [])), report.progressQuestion, report.reportQuestion]
      .filter(Boolean) as Row[];
    assert.ok(auditedTurns.length >= 3, '聊天轮记录缺失,绑定一致性断言不得空洞通过');
    const mismatched = auditedTurns.filter(t => String(t.binding || '') !== expectedBinding);
    assert.equal(mismatched.length, 0, '运行服务与审计配置不一致,不得判 PASS: '
      + mismatched.map(t => String(t.binding || '') || '(missing)').join(','));
    // 事件-运行关联基线:本轮已知的全部 runId(聊天/追问轮 + 阶段与日报正文 run)。
    const stepReports = (key: 'stage' | 'daily') => ((((report as Row)[key] as Row | undefined)?.reports as Row[] | undefined) || []);
    const knownBodyRunIds = new Set([...stepReports('stage'), ...stepReports('daily')]
      .map(r => String(r.bodyRunId || '')).filter(Boolean));
    const knownRunIds = new Set([...auditedTurns.map(t => String(t.runId || '')).filter(Boolean), ...knownBodyRunIds]);
    // delta 只取本轮窗口内的审计行;每行形如 {kind,at,value},value 携带 runId/chatId。
    // 窗口起点在本轮任何被测请求之前由已验证的批次探针回执打开;窗口内日志被
    // 缩短或重建时 auditWindowEntries 明确失败,不按零调用判通过。
    let delta: ReturnType<typeof auditWindowEntries>;
    try { delta = auditWindowEntries(auditLines(), { windowStart: auditBefore, windowPrefixHash: auditWindowPrefix }); }
    catch (error) { assert.fail(readableAuditError(error)); }
    const kinds = auditKindCounts(delta);
    const seen = Object.keys(kinds);
    // 关联判定:记录直接携带的 runId,或 chatId 内嵌的 runId(stage 记录的
    // chatId 形如 xiaok-report-{runId}-{uuid},knowledge 记录形如
    // xiaok-knowledge-{runId}-{turn}-{uuid}),落入本轮已知 runId 集合即关联。
    const correlatedRunIds: string[] = [];
    const correlate = (entry: ReturnType<typeof auditWindowEntries>[number]) => {
      const embedded = (/^xiaok-[a-z]+-(\d+)-/.exec(String(entry.value.chatId || '')) || [])[1] || '';
      const runId = [entry.runId, embedded].find(id => id && knownRunIds.has(id)) || '';
      if (runId && !correlatedRunIds.includes(runId)) correlatedRunIds.push(runId);
      return runId;
    };
    if (expectedExecutor === 'xiaok-native-executor-v1') {
      // 原生执行器:聊天与阶段正文都走原生模型,原 P3 阶段例外已撤销。本轮的
      // 审计来源正控已在开场步骤按同一批次回执和实际日志位置建立,因此本轮窗口
      // 内出现任何 kind(含 stage)都说明仍有 FastGPT 调用。
      const violations = nativeAuditKindViolations(kinds);
      assert.equal(violations.length, 0, 'Chat, stage-report and auxiliary paths must not call FastGPT, saw: ' + violations.join(','));
      assert.ok(report.probe, '本轮审计来源正控缺失,零调用结论不得成立');
    } else {
      // 旧 FastGPT V2 模式:聊天本应通过被审计的桥调用,不做零调用断言,只拒绝未知 kind。
      const unknown = seen.filter(kind => !['agentV2', 'stage', 'knowledge', 'unified', 'rag', 'nativeKnowledge'].includes(kind));
      assert.equal(unknown.length, 0, 'Unknown FastGPT audit kinds, saw: ' + unknown.join(','));
      assert.ok(delta.some(entry => correlate(entry)), 'FastGPT 审计事件未能关联到本轮运行,不得判 PASS');
    }
    if (report.auditWindow) (report.auditWindow as Row).end = auditLines().length;
    // The outage note belongs to a legacy FastGPT round only; a native round
    // must never explain a stage-body defect as an unreachable deployment.
    const legacyNote = stageFastgptDownNote(expectedExecutor, stageFastgptDown);
    report.fastgptAudit = { configured: true, auditFile: auditPath, batchId, roundWindow: { start: auditBefore, end: auditLines().length, kinds },
      expectedBinding, bindingMatchedTurns: auditedTurns.length - mismatched.length, totalTurns: auditedTurns.length, mode: expectedExecutor,
      sourceVerified: true, correlatedRunIds, ...(report.probe ? { probe: report.probe } : {}),
      ...(legacyNote ? { note: legacyNote } : {}) };
    return report.fastgptAudit;
  });
}
main().catch(error => { report.error = (error as Error).message; })
  .finally(async () => {
    try {
      const after = binding(), changed = Object.keys({ ...before, ...after }).filter(f => before[f] !== after[f]);
      report.drift = changed; report.bindingAfter = createHash('sha256').update(JSON.stringify(after)).digest('hex');
      if (changed.length) (report.failures as Row[]).push({ name: 'source drift', files: changed });
      report.finishedAt = new Date().toISOString();
      report.accounting.after = {
        providerMax: String((await withPlatformTransaction(tx => one(tx, sql`select coalesce(max(id),0) id from app.ai_provider_attempts`)))!.id),
        knowledgeMax: String((await withPlatformTransaction(tx => one(tx, sql`select coalesce(max(id),0) id from app.assistant_knowledge_attempts`)))!.id) };
    } catch (error) { report.finalizeError = (error as Error).message; }
    finally {
      save(); await closePostgresPool();
      const checks = (report.checks as Row[]);
      // One unified final success condition: every step passed, the main flow
      // and both restoration paths finished clean, no source drift, and the
      // check set is nonempty (an empty check set is never a pass).
      const passed = checks.length > 0 && checks.every(c => c.passed)
        && !report.error && !((report.drift as string[]) || []).length && !report.finalizeError && !report.restoreError;
      if (!passed) process.exitCode = 1;
      console.log(JSON.stringify({ passed, checks: checks.length, error: report.error || null,
        drift: report.drift || [], restored: report.restored || null }));
    }
  });
