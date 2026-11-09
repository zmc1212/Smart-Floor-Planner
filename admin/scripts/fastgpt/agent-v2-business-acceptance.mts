/* eslint-disable @typescript-eslint/no-explicit-any -- Retained F1 service-level acceptance. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
require('@next/env').loadEnvConfig(process.cwd(), true);

const label = process.argv.find(x => x.startsWith('--label='))?.slice(8) || 'f1-01';
assert.match(label, /^[a-z0-9-]+$/);
const evidence = path.resolve('../tmp/xiaok-fastgpt-agentv2-f1-20261109');
const out = path.join(evidence, 'acceptance-' + label);
assert.ok(!fs.existsSync(path.join(out, 'assessment.json')), 'Preserve every original batch');
fs.mkdirSync(out, { recursive: true });

// The F1 batch keeps its own runtime file so the F0 audit stream is unchanged.
// Its bytes are also the deployment binding captured by the send policy snapshot.
const runtimeFile = path.join(evidence, 'runtime.private.json');
if (!fs.existsSync(runtimeFile)) {
  const base = JSON.parse(fs.readFileSync(path.resolve('../tmp/xiaok-fastgpt-agentv2-f0-20261109/runtime.private.json'), 'utf8'));
  base.auditFile = path.join(evidence, 'agent-v2-audit.jsonl');
  fs.writeFileSync(runtimeFile, JSON.stringify(base, null, 2));
}
const runtimeBytes = fs.readFileSync(runtimeFile);
const devRuntime = JSON.parse(runtimeBytes.toString('utf8'));
assert.equal(devRuntime.agentV2.enterpriseId, '1454');
assert.equal(devRuntime.baseUrl, 'http://127.0.0.1:18300');
const model = devRuntime.agentV2.model;

const originalDatabase = process.env.DATABASE_URL;
process.env.DATABASE_URL = JSON.parse(fs.readFileSync(path.resolve('../tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL;
process.env.XIAOK_FASTGPT_WORKFLOWS_FILE = runtimeFile;
process.env.ASSISTANT_TEXT_MODEL = model;
process.env.ASSISTANT_TEXT_DISABLE_THINKING = '1';
delete process.env.XIAOK_FASTGPT_RETRIEVAL_FILE;

const { sql } = require('drizzle-orm');
const { withTenantTransaction, withPlatformTransaction } = require(path.resolve('src/db/transaction.ts'));
const { one, rows } = require(path.resolve('src/db/repositories/assistant-repository.ts'));
const { ConversationService } = require(path.resolve('src/lib/assistant/core/conversation.ts'));
const { claimJob } = require(path.resolve('src/lib/assistant/infrastructure/job-queue.ts'));
const { processAssistantRun } = require(path.resolve('src/lib/assistant/application/worker.ts'));
const { fastGPTWorkflows, closeFastGPTWorkflows } = require(path.resolve('src/lib/assistant/fastgpt/runtime.ts'));
const { lockAssistantAcceptance } = await import('../assistant-acceptance-safety.mjs');

const tenant = (f: any) => withTenantTransaction('1454', f);
const platform = (f: any) => withPlatformTransaction(f);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const textOf = (content: any) => (content?.blocks || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
const sourceHash = (file: string) => createHash('sha256').update(fs.readFileSync(path.resolve(file))).digest('hex');

const user = '645';
const otherCustomerLead = '2585';   // enterprise 1454, customer 744
const crossTenantLead = '2955';     // enterprise 2884
const archivedLead = '1724';        // customer 645, archived 2026-08-31
const ownEmptyLead = '8235';        // customer 645, active, no appointments
const appointmentQ5 = '我最近有没有量房预约？帮我看看时间和状态。';
const expectedAppointments = '现场量房：量房预约已过期，时间2026年9月1日 00:06–02:06（北京时间）。\n'
  + '现场量房：量房预约已确认，时间2026年9月1日 09:07–11:07（北京时间）。';
let actor: any = { enterpriseId: '1454', principal: { kind: 'user', userId: user }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
const boundActor: any = { ...actor, entry: { kind: 'lead', id: '1818' } };

const report: any = { status: 'preparing', label, model, appId: devRuntime.agentV2.appId, protocol: devRuntime.agentV2.protocol,
  source: { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    runtimeHash: createHash('sha256').update(runtimeBytes).digest('hex'),
    files: Object.fromEntries(['src/lib/assistant/fastgpt/agent-v2/runtime.ts', 'src/lib/assistant/fastgpt/agent-v2/worker.ts',
      'src/lib/assistant/agent/context.ts', 'scripts/fastgpt/agent-v2-business-acceptance.mts'].map(file => [file, sourceHash(file)])) },
  fixtures: { user, archivedLead, otherCustomerLead, crossTenantLead, ownEmptyLead, appointment: '256' },
  transport: 'deterministic-simulated-fastgpt-agent-v2',
  realModelPending: 'FastGPT DashScope channel returns external 403 AllocationQuota.FreeTierOnly; no resampling of this batch',
  scenarios: [], checks: [], cleanup: {}, unknownCurrency: true };
const save = () => fs.writeFileSync(path.join(out, 'assessment.json'), JSON.stringify(report, null, 2));

type BridgeCall = { name: string; status: number; body: any };
type Scenario = {
  name: string; question: string; note?: string; who?: any; expect: 'succeeded' | 'failed'; error?: string;
  steps: Array<{ name: string; fields: Record<string, string>; after?: (call: BridgeCall) => Promise<void> }>;
  final: (calls: BridgeCall[]) => string;
};
let active: Pick<Scenario, 'steps' | 'final'> | null = null;
let transportCalls: BridgeCall[] = [];
let transportRequest: any = null;
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input?.url || '');
  if (!active || url !== devRuntime.baseUrl + '/api/v1/chat/completions') return realFetch(input, init);
  const request = JSON.parse(String(init?.body));
  transportRequest = { appId: request.appId, stream: request.stream, detail: request.detail,
    messageCount: Array.isArray(request.messages) ? request.messages.length : null,
    ticketVariable: typeof request.variables?.workflowTicket === 'string',
    bridgeKeyLeaked: JSON.stringify(request).includes(devRuntime.agentV2.bridgeKey) };
  const calls: BridgeCall[] = [];
  for (const step of active.steps) {
    const response = await realFetch('http://127.0.0.1:18310/agent-v2-tool/' + step.name, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Bearer ' + devRuntime.agentV2.bridgeKey },
      body: new URLSearchParams(step.fields).toString(),
    });
    const body = await response.json();
    const call = { name: step.name, status: response.status, body };
    calls.push(call);
    transportCalls = calls;
    await step.after?.(call);
  }
  return new Response(JSON.stringify({ choices: [{ message: { content: active.final(calls) } }],
    responseData: [{ moduleType: 'agent', inputTokens: 120, outputTokens: 30 }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const readTrace = (runId: string) => tenant(async (tx: any) => ({
  run: await one(tx, sql`select id::text,status,error_code,output_message_id::text,trigger_message_id::text,policy_snapshot,
    (select provider_started_at::text from app.assistant_jobs j where j.enterprise_id=app.assistant_runs.enterprise_id and j.run_id=app.assistant_runs.id) provider_started_at
    from app.assistant_runs where enterprise_id=1454 and id=${runId}`),
  steps: await rows(tx, sql`select step_seq,kind,status,input_summary,private_checkpoint,source_refs
    from app.assistant_run_steps where enterprise_id=1454 and run_id=${runId} order by step_seq`),
  usage: await rows(tx, sql`select category,measurement_kind,input_tokens,output_tokens,quantity
    from app.assistant_usage_records where enterprise_id=1454 and run_id=${runId}`),
}));
async function send(question: string, who: any, conversationId?: string, clientMessageId = randomUUID()) {
  const service = new ConversationService(who);
  const cid = conversationId || String((await service.create(randomUUID())).id);
  const sent = await service.send(cid, clientMessageId, { version: 1, blocks: [{ type: 'text', text: question }] });
  return { cid, runId: String(sent.runId), clientMessageId, service };
}
async function processQueued(runId: string) {
  let lease: any; const until = Date.now() + 60000;
  while (!lease && Date.now() < until) { lease = await claimJob(); if (!lease) await sleep(200); }
  assert.equal(lease?.runId, runId, 'Queued run must be claimed');
  await processAssistantRun(lease);
}
async function execute(item: Scenario) {
  const record: any = { name: item.name, question: item.question, note: item.note, expect: item.expect, errorExpected: item.error };
  report.scenarios.push(record); save();
  transportCalls = []; transportRequest = null; active = item;
  try {
    const sent = await send(item.question, item.who || actor);
    record.conversationId = sent.cid; record.runId = sent.runId; record.clientMessageId = sent.clientMessageId;
    await processQueued(sent.runId);
    const trace = await readTrace(sent.runId);
    record.status = trace.run.status; record.error = trace.run.error_code; record.providerStartedAt = trace.run.provider_started_at;
    record.agentRuntime = trace.run.policy_snapshot?.agentRuntime?.protocol || null;
    record.bridgeCalls = transportCalls; record.transportRequest = transportRequest;
    record.steps = trace.steps.map((step: any) => ({ seq: step.step_seq, kind: step.kind, status: step.status,
      tool: step.input_summary?.tool || null, protocol: step.input_summary?.protocol || null, selected: step.input_summary?.selected ?? null }));
    record.usage = trace.usage.map((u: any) => ({ category: u.category, kind: u.measurement_kind,
      input: u.input_tokens == null ? null : Number(u.input_tokens), output: u.output_tokens == null ? null : Number(u.output_tokens) }));
    const message = trace.run.output_message_id
      ? (await sent.service.messages(sent.cid)).items.find((m: any) => m.id === trace.run.output_message_id) : null;
    record.messageId = message?.id || null; record.available = message?.available ?? null;
    record.answer = message ? textOf(message.content) : null;
    record.citations = message?.citations?.length || 0;
    record.rawDraft = trace.steps.find((step: any) => step.kind === 'agent_synthesis_context')?.private_checkpoint?.raw ?? null;
    fs.writeFileSync(path.join(out, `trace-${item.name}-${sent.runId}.json`), JSON.stringify({ ...trace, bridgeCalls: transportCalls, transportRequest }, null, 2));
    save();
    return { record, trace, message, service: sent.service, conversationId: sent.cid, runId: sent.runId, clientMessageId: sent.clientMessageId };
  } finally { active = null; transportCalls = []; }
}

let release: any, settingsBefore: any, platformBefore: any;
let appointmentBefore: any, appointmentMutated = false;
try {
  release = await lockAssistantAcceptance(process.env.DATABASE_URL, { waitForLock: true });
  settingsBefore = await tenant((tx: any) => one(tx, sql`select enabled,agent_config from app.assistant_enterprise_settings where enterprise_id=1454`));
  platformBefore = await platform((tx: any) => one(tx, sql`select llm_config from app.platform_configs where key='default'`));
  const primary = new (require('pg').Client)({ connectionString: originalDatabase }); let provider: any;
  try { await primary.connect(); await primary.query('begin read only');
    provider = (await primary.query("select llm_config from app.platform_configs where key='default'")).rows[0].llm_config; await primary.query('rollback');
  } finally { await primary.end(); }
  if (provider.providerKey !== 'dashscope') { assert.ok(provider.profiles?.dashscope?.apiKeyEncrypted); provider = { ...provider, ...provider.profiles.dashscope, providerKey: 'dashscope' }; }
  await platform((tx: any) => tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify({ ...provider, model })}::jsonb where key='default'`));
  await tenant((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings set enabled=true,agent_config=${JSON.stringify({
    runtime: 'langgraph-v1', providerKey: 'dashscope', model, imageInput: false, tools: true,
    probeVersion: 'agent-v2-f1-20261109', enterpriseKnowledgeEnabled: true,
    knowledgeExplanation: 'natural-knowledge-answer-v1',
  })}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`));
  const customer = await platform((tx: any) => one(tx, sql`select id,context_version from app.users where id=${user}`));
  assert.ok(customer, 'Eval user 645 must exist'); actor = { ...actor, contextVersion: Number(customer.context_version) };
  Object.assign(boundActor, { contextVersion: actor.contextVersion });
  appointmentBefore = await tenant((tx: any) => one(tx, sql`select status,version,updated_at::text updated_at
    from app.measurement_appointments where enterprise_id=1454 and id=256`));
  assert.ok(appointmentBefore, 'Appointment 256 fixture must exist');
  report.customer = { id: String(customer.id), contextVersion: actor.contextVersion };
  report.fixtures.appointmentBefore = appointmentBefore;
  await fastGPTWorkflows().ready();
  report.status = 'running'; save();

  // Existing search tool regression: the shared bridge argument parser must not
  // regress the F0 knowledge path.
  const search = await execute({ name: 'search-smoke', question: '我家水电马上要开工了，水路这块主要做些什么？', expect: 'succeeded',
    final: calls => {
      const cites = Array.isArray(calls[0]?.body?.cites) ? calls[0].body.cites : [];
      return cites.length ? `水路开槽前先确认走向和阀门位置，完成后按要求打压测试。[${cites[0].id}](CITE)` : '本次没有检索到可用原文。';
    },
    steps: [{ name: 'search_enterprise', fields: { query: '水路开槽 打压 施工要点' } }] });
  assert.equal(search.record.status, 'succeeded', search.record.error || 'search smoke must succeed');
  assert.equal(search.record.bridgeCalls[0].status, 200);
  assert.ok(search.record.bridgeCalls[0].body.cites?.length > 0, 'Search must return authorized evidence');
  const searchStep = search.trace.steps.find((step: any) => step.input_summary?.tool === 'search_enterprise');
  assert.ok(searchStep?.private_checkpoint?.length > 0);
  assert.equal(search.record.citations, 1, 'CITE markers must still save citations');
  assert.ok(search.record.answer.trim() && !search.record.answer.includes('(CITE)'));
  report.checks.push({ searchToolSmoke: true, searchRun: search.record.runId });
  save();

  // The fifth A/B question, now through the F1 business tool. Duplicate identical
  // calls must share one authorized snapshot; the delivered answer is the service
  // snapshot text, never the model draft (which carries an unsupported promise).
  const q5 = await execute({ name: 'appointments-q5', question: appointmentQ5, expect: 'succeeded',
    final: () => '我先查一下您的量房预约记录。\n您名下最近有两条现场量房记录。我已经帮您预约好了新的量房，明天设计师会联系您。',
    steps: [{ name: 'query_business', fields: { domain: 'appointments', leadId: '' } },
      { name: 'query_business', fields: { domain: 'appointments', leadId: '' } }] });
  assert.equal(q5.record.status, 'succeeded', q5.record.error || 'appointment lookup must succeed');
  assert.equal(q5.record.agentRuntime, 'fastgpt-agent-v2-v1');
  assert.equal(q5.record.bridgeCalls.length, 2);
  assert.ok(q5.record.bridgeCalls.every((call: BridgeCall) => call.status === 200 && call.body.status === 'ready'));
  assert.equal(q5.record.bridgeCalls[0].body.resultKey, q5.record.bridgeCalls[1].body.resultKey);
  assert.equal(q5.record.answer, expectedAppointments, 'Delivered text must be the authorized snapshot');
  assert.ok(!/1724|254|8月30日|（1818）|\d{4}-\d{2}-\d{2}T|\[|版本/.test(q5.record.answer),
    'No internal id, ISO range, version or archived-lead record may be shown');
  assert.equal(q5.record.citations, 0);
  assert.ok(String(q5.record.rawDraft).includes('预约好了'), 'The model draft remains in the audit step only');
  assert.ok(!String(q5.record.answer).includes('预约好了'));
  const businessSteps = q5.trace.steps.filter((step: any) => step.kind === 'agent_tool');
  assert.equal(businessSteps.length, 1, 'Identical tool calls share one authorized snapshot');
  assert.equal(businessSteps[0].input_summary.tool, 'query_business');
  assert.equal(businessSteps[0].input_summary.domain, 'appointments');
  assert.equal(businessSteps[0].input_summary.leadId, '');
  assert.equal(businessSteps[0].input_summary.selected, 2);
  assert.deepEqual(businessSteps[0].private_checkpoint.data.map((row: any) => row.id), ['255', '256']);
  const tokens = q5.record.usage.filter((u: any) => u.category === 'tokens');
  assert.equal(tokens.length, 1); assert.deepEqual({ kind: tokens[0].kind, input: tokens[0].input, output: tokens[0].output },
    { kind: 'observed', input: 120, output: 30 });
  const again = await q5.service.send(q5.conversationId, q5.clientMessageId, { version: 1, blocks: [{ type: 'text', text: appointmentQ5 }] });
  assert.equal(String(again.runId), q5.runId, 'Same client message must not create another run');
  const reentry = (await new ConversationService(actor).messages(q5.conversationId)).items.find((m: any) => m.id === q5.record.messageId);
  assert.ok(reentry?.available); assert.equal(textOf(reentry.content), expectedAppointments);
  report.checks.push({ fifthQuestion: true, run: q5.record.runId, archivedExcluded: true, internalFieldsHidden: true,
    duplicateToolCallsDeduplicated: true, idempotentSend: true, persistedReentry: true, businessAnswerFromSnapshot: true });
  save();

  // An authorized empty result is a truthful no-record answer, not a failure.
  const empty = await execute({ name: 'empty-lead', question: '这套房有没有量房预约？', expect: 'succeeded',
    final: () => '我查一下这套房的量房预约。', steps: [{ name: 'query_business', fields: { domain: 'appointments', leadId: ownEmptyLead } }] });
  assert.equal(empty.record.status, 'succeeded', empty.record.error || 'empty lookup must succeed');
  assert.equal(empty.record.bridgeCalls[0].status, 200); assert.equal(empty.record.bridgeCalls[0].body.status, 'empty');
  assert.equal(empty.record.answer, '目前没有查到你在本企业的预约记录。');
  report.checks.push({ emptyResultTruthful: true, run: empty.record.runId });
  save();

  // Archived lead: its appointment 254 is hidden from the customer-wide answer
  // above and an explicit request is rejected as not found.
  const archived = await execute({ name: 'archived-lead', question: '我想查一下东辰心语那套房子的量房预约。', expect: 'failed',
    error: 'assistant_resource_not_found', final: () => '抱歉，这次没有查到可用的预约记录。',
    steps: [{ name: 'query_business', fields: { domain: 'appointments', leadId: archivedLead } }] });
  assert.equal(archived.record.status, 'failed'); assert.equal(archived.record.error, 'assistant_resource_not_found');
  assert.equal(archived.record.bridgeCalls[0].status, 404); assert.equal(archived.record.bridgeCalls[0].body.error, 'assistant_resource_not_found');
  assert.equal(archived.record.messageId, null, 'A rejected lookup must not deliver a message');
  report.checks.push({ archivedLeadRejected: true, run: archived.record.runId });
  save();

  // Another customer of the same enterprise, and a lead of a different tenant,
  // are indistinguishable failures at the authorized service boundary.
  const other = await execute({ name: 'other-customer', question: '帮我查一下这个房子的量房预约。', expect: 'failed',
    error: 'assistant_resource_not_found', final: () => '抱歉，这次没有查到可用的预约记录。',
    steps: [{ name: 'query_business', fields: { domain: 'appointments', leadId: otherCustomerLead } }] });
  assert.equal(other.record.status, 'failed'); assert.equal(other.record.error, 'assistant_resource_not_found');
  assert.equal(other.record.bridgeCalls[0].status, 404); assert.equal(other.record.messageId, null);
  report.checks.push({ otherCustomerDenied: true, run: other.record.runId });
  const cross = await execute({ name: 'cross-tenant', question: '我另一家公司名下那个项目的量房预约呢？', expect: 'failed',
    error: 'assistant_resource_not_found', final: () => '抱歉，这次没有查到可用的预约记录。',
    steps: [{ name: 'query_business', fields: { domain: 'appointments', leadId: crossTenantLead } }] });
  assert.equal(cross.record.status, 'failed'); assert.equal(cross.record.error, 'assistant_resource_not_found');
  assert.equal(cross.record.bridgeCalls[0].status, 404); assert.equal(cross.record.messageId, null);
  report.checks.push({ crossTenantDenied: true, run: cross.record.runId });
  save();

  // A lead-bound conversation cannot ask for another one of the customer's leads.
  const bound = await execute({ name: 'bound-lead', question: '顺便看下我另一个房子的预约。', who: boundActor, expect: 'failed',
    error: 'assistant_resource_not_found', final: () => '抱歉，这次没有查到可用的预约记录。',
    steps: [{ name: 'query_business', fields: { domain: 'appointments', leadId: ownEmptyLead } }] });
  assert.equal(bound.record.status, 'failed'); assert.equal(bound.record.error, 'assistant_resource_not_found');
  assert.equal(bound.record.bridgeCalls[0].status, 404); assert.equal(bound.record.messageId, null);
  report.checks.push({ boundLeadMismatchRejected: true, run: bound.record.runId });
  save();

  // Strict action/field validation before any business service call.
  const invalid = await execute({ name: 'invalid-domain', question: '帮我查一下付款记录。', expect: 'failed', error: 'invalid_message',
    final: () => '抱歉，这次没有查到可用的记录。', steps: [{ name: 'query_business', fields: { domain: 'payments', leadId: '' } }] });
  assert.equal(invalid.record.status, 'failed'); assert.equal(invalid.record.error, 'invalid_message');
  assert.equal(invalid.record.bridgeCalls[0].status, 422); assert.equal(invalid.record.bridgeCalls[0].body.error, 'invalid_message');
  const extra = await execute({ name: 'extra-field', question: '帮我查一下量房预约。', expect: 'failed', error: 'invalid_message',
    final: () => '抱歉，这次没有查到可用的记录。',
    steps: [{ name: 'query_business', fields: { domain: 'appointments', leadId: '', query: 'x' } }] });
  assert.equal(extra.record.status, 'failed'); assert.equal(extra.record.error, 'invalid_message');
  assert.equal(extra.record.bridgeCalls[0].status, 422);
  report.checks.push({ invalidDomainRejected: true, extraFieldRejected: true });
  save();

  // Free-form answer without a tool receipt must not promise an action.
  const commitment = await execute({ name: 'commitment', question: '帮我约个量房。', expect: 'failed', error: 'unsupported_model_commitment',
    final: () => '我已经帮您预约好了新的量房，明天设计师会联系您。', steps: [] });
  assert.equal(commitment.record.status, 'failed'); assert.equal(commitment.record.error, 'unsupported_model_commitment');
  assert.equal(commitment.record.bridgeCalls.length, 0); assert.equal(commitment.record.messageId, null);
  report.checks.push({ unsupportedCommitmentRejected: true, run: commitment.record.runId });
  save();

  // A snapshot changed after the tool read but before delivery must fail closed.
  const changed = await execute({ name: 'snapshot-changed', question: '帮我看下我的量房预约。', expect: 'failed', error: 'context_changed',
    final: () => '这是您之前的预约记录。',
    steps: [{ name: 'query_business', fields: { domain: 'appointments', leadId: '' }, after: async () => {
      await tenant((tx: any) => tx.execute(sql`update app.measurement_appointments set status='completed',version=version+1,updated_at=now()
        where enterprise_id=1454 and id=256`));
      appointmentMutated = true;
    } }] });
  assert.equal(changed.record.bridgeCalls[0].status, 200);
  assert.equal(changed.record.status, 'failed'); assert.equal(changed.record.error, 'context_changed');
  assert.equal(changed.record.messageId, null, 'A changed snapshot must not deliver stale content');
  report.checks.push({ changedSnapshotRejected: true, run: changed.record.runId });
  save();

  // Every simulated request carried the app binding and the scoped ticket, and
  // never the deployment bridge key.
  assert.ok(report.scenarios.every((record: any) => record.transportRequest?.ticketVariable === true), 'Every run posts a scoped ticket');
  assert.ok(report.scenarios.every((record: any) => record.transportRequest?.bridgeKeyLeaked === false), 'The bridge key never reaches the model request');
  report.scope = 'F1 service acceptance uses deterministic simulated FastGPT transports over the real bridge, services, DB and citation/run persistence. '
    + 'The real-model fifth question remains pending the external FastGPT channel quota.';
  report.status = 'passed'; save();
  console.log(JSON.stringify({ passed: true, scenarios: report.scenarios.map((s: any) => ({ name: s.name, run: s.runId, status: s.status, error: s.error })),
    checks: report.checks }, null, 2));
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error); save();
  console.error(report.error); process.exitCode = 1;
} finally {
  const cleanup = async (key: string, f: () => Promise<any>) => { try { await f(); report.cleanup[key] = true; } catch (e) { report.cleanup[key] = String(e); process.exitCode = 1; } };
  globalThis.fetch = realFetch;
  if (appointmentMutated && appointmentBefore) await cleanup('appointmentRestored', async () => {
    await tenant((tx: any) => tx.execute(sql`update app.measurement_appointments set status=${appointmentBefore.status},
      version=${appointmentBefore.version},updated_at=${appointmentBefore.updated_at}::timestamptz where enterprise_id=1454 and id=256`));
    const restored = await tenant((tx: any) => one(tx, sql`select status,version from app.measurement_appointments where enterprise_id=1454 and id=256`));
    assert.deepEqual({ status: restored.status, version: restored.version }, { status: appointmentBefore.status, version: appointmentBefore.version });
  });
  if (settingsBefore) await cleanup('settingsRestored', () => tenant((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings
    set enabled=${settingsBefore.enabled},agent_config=${JSON.stringify(settingsBefore.agent_config)}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`)));
  if (platformBefore) await cleanup('providerRestored', () => platform((tx: any) => tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify(platformBefore.llm_config)}::jsonb where key='default'`)));
  await cleanup('bridgeClosed', closeFastGPTWorkflows);
  if (release) await cleanup('lockReleased', release);
  await require(path.resolve('src/lib/postgresql.ts')).closePostgresPool(); save();
}
