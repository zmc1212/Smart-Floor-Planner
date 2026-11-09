/* eslint-disable @typescript-eslint/no-explicit-any -- Retained F2 service-level acceptance. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
require('@next/env').loadEnvConfig(process.cwd(), true);

const label = process.argv.find(x => x.startsWith('--label='))?.slice(8) || 'f2-01';
assert.match(label, /^[a-z0-9-]+$/);
const evidence = path.resolve('../tmp/xiaok-fastgpt-agentv2-f2-20261109');
const out = path.join(evidence, 'acceptance-' + label);
assert.ok(!fs.existsSync(path.join(out, 'assessment.json')), 'Preserve every original batch');
fs.mkdirSync(out, { recursive: true });

const runtimeFile = path.join(evidence, 'runtime.private.json');
assert.ok(fs.existsSync(runtimeFile), 'The F2 runtime must be provisioned before acceptance');
// Its bytes are the deployment binding captured by the send policy snapshot.
const runtimeBytes = fs.readFileSync(runtimeFile);
const devRuntime = JSON.parse(runtimeBytes.toString('utf8'));
assert.equal(devRuntime.agentV2.enterpriseId, '1454');
assert.equal(devRuntime.baseUrl, 'http://127.0.0.1:18300');
assert.equal(devRuntime.agentV2.protocol, 'fastgpt-agent-v2-v1');
assert.match(devRuntime.agentV2.suggestionAppId, /^[a-f0-9]{24}$/);
assert.ok(devRuntime.agentV2.welcome && Array.isArray(devRuntime.agentV2.presets) && devRuntime.agentV2.presets.length);
const presets: string[] = devRuntime.agentV2.presets;
const model = devRuntime.agentV2.model;
assert.ok(!presets.some((question: string) => question.length > 40 || question.trim() !== question || question.length < 2));

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
const { entryContext } = require(path.resolve('src/lib/assistant/application/auth.ts'));
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
const appointmentQuestion = '我最近有没有量房预约？帮我看看时间和状态。';
const expectedAppointments = '现场量房：量房预约已过期，时间2026年9月1日 00:06–02:06（北京时间）。\n'
  + '现场量房：量房预约已确认，时间2026年9月1日 09:07–11:07（北京时间）。';
let actor: any = { enterpriseId: '1454', principal: { kind: 'user', userId: user }, contextVersion: 1, capabilities: ['assistant.chat.self'] };

const report: any = { status: 'preparing', label, model, appId: devRuntime.agentV2.appId, suggestionAppId: devRuntime.agentV2.suggestionAppId,
  protocol: devRuntime.agentV2.protocol, presets: presets.length,
  source: { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    runtimeHash: createHash('sha256').update(runtimeBytes).digest('hex'),
    files: Object.fromEntries(['src/lib/assistant/fastgpt/agent-v2/runtime.ts', 'src/lib/assistant/fastgpt/agent-v2/worker.ts',
      'src/lib/assistant/fastgpt/agent-v2/config.ts', 'src/lib/assistant/fastgpt/agent-v2/suggestions.ts',
      'src/lib/assistant/core/conversation.ts', 'src/lib/assistant/application/auth.ts',
      'scripts/fastgpt/agent-v2-suggestions-acceptance.mts'].map(file => [file, sourceHash(file)])) },
  fixtures: { user, appointments: '255/256' },
  transport: 'deterministic-simulated-fastgpt-agent-v2',
  realModelPending: 'FastGPT DashScope channel returns external 403 AllocationQuota.FreeTierOnly; no resampling of this batch',
  scenarios: [], checks: [], cleanup: {}, unknownCurrency: true };
const save = () => fs.writeFileSync(path.join(out, 'assessment.json'), JSON.stringify(report, null, 2));

type BridgeCall = { name: string; status: number; body: any };
type SuggestionBehavior = { status: number; text?: string; usage?: { inputTokens: number; outputTokens: number } };
type Scenario = {
  name: string; question: string; note?: string; who?: any; conversationId?: string; expect: 'succeeded' | 'failed'; error?: string;
  steps: Array<{ name: string; fields: Record<string, string>; after?: (call: BridgeCall) => Promise<void> }>;
  final: (calls: BridgeCall[]) => string; suggestion?: SuggestionBehavior;
};
let active: Pick<Scenario, 'steps' | 'final' | 'suggestion'> | null = null;
let transportCalls: BridgeCall[] = [];
let mainRequest: any = null;
let suggestionRequests: any[] = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input?.url || '');
  if (!active || url !== devRuntime.baseUrl + '/api/v1/chat/completions') return realFetch(input, init);
  const request = JSON.parse(String(init?.body));
  if (request.appId === devRuntime.agentV2.suggestionAppId) {
    const prompt = String(request.messages?.[0]?.content ?? '');
    suggestionRequests.push({ appId: request.appId, messageCount: Array.isArray(request.messages) ? request.messages.length : null,
      hasVariables: request.variables !== undefined, hasCiteMarker: prompt.includes('(CITE)'), prompt,
      bridgeKeyLeaked: JSON.stringify(request).includes(devRuntime.agentV2.bridgeKey) });
    const behavior = active.suggestion;
    assert.ok(behavior, 'Only scenarios that expect follow-up generation may call the suggestion app');
    if (behavior.status !== 200)
      return new Response(JSON.stringify({ error: 'simulated_suggestion_failure' }), { status: behavior.status, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ choices: [{ message: { content: behavior.text } }],
      responseData: behavior.usage ? [{ moduleType: 'agent', inputTokens: behavior.usage.inputTokens, outputTokens: behavior.usage.outputTokens }] : [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  assert.equal(request.appId, devRuntime.agentV2.appId, 'The main conversation keeps its Agent V2 app');
  mainRequest = { appId: request.appId, stream: request.stream, detail: request.detail,
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
const usageBy = (usage: any[]) => Object.fromEntries(usage.map((u: any) => [u.category,
  { kind: u.kind, input: u.input == null ? null : Number(u.input), output: u.output == null ? null : Number(u.output), quantity: u.quantity == null ? null : Number(u.quantity) }]));
async function execute(item: Scenario) {
  const record: any = { name: item.name, question: item.question, note: item.note, expect: item.expect, errorExpected: item.error };
  report.scenarios.push(record); save();
  transportCalls = []; mainRequest = null; suggestionRequests = []; active = item;
  try {
    const sent = await send(item.question, item.who || actor, item.conversationId);
    record.conversationId = sent.cid; record.runId = sent.runId; record.clientMessageId = sent.clientMessageId;
    await processQueued(sent.runId);
    const trace = await readTrace(sent.runId);
    record.status = trace.run.status; record.error = trace.run.error_code; record.providerStartedAt = trace.run.provider_started_at;
    record.agentRuntime = trace.run.policy_snapshot?.agentRuntime?.protocol || null;
    record.bridgeCalls = transportCalls; record.transportRequest = mainRequest;
    record.steps = trace.steps.map((step: any) => ({ seq: step.step_seq, kind: step.kind, status: step.status,
      tool: step.input_summary?.tool || null, protocol: step.input_summary?.protocol || null, selected: step.input_summary?.selected ?? null }));
    const suggestionStep = trace.steps.find((step: any) => step.step_seq === 1007);
    record.suggestionStep = suggestionStep ? { kind: suggestionStep.kind, status: suggestionStep.status,
      questions: suggestionStep.private_checkpoint?.questions ?? null, source: suggestionStep.private_checkpoint?.source ?? null,
      generated: suggestionStep.input_summary?.generated ?? null } : null;
    record.usage = trace.usage.map((u: any) => ({ category: u.category, kind: u.measurement_kind,
      input: u.input_tokens == null ? null : Number(u.input_tokens), output: u.output_tokens == null ? null : Number(u.output_tokens),
      quantity: u.quantity == null ? null : Number(u.quantity) }));
    record.suggestionRequests = suggestionRequests.map(r => ({ ...r }));
    const message = trace.run.output_message_id
      ? (await sent.service.messages(sent.cid)).items.find((m: any) => m.id === trace.run.output_message_id) : null;
    record.messageId = message?.id || null; record.available = message?.available ?? null;
    record.answer = message ? textOf(message.content) : null;
    record.citations = message?.citations?.length || 0;
    record.rawDraft = trace.steps.find((step: any) => step.kind === 'agent_synthesis_context')?.private_checkpoint?.raw ?? null;
    fs.writeFileSync(path.join(out, `trace-${item.name}-${sent.runId}.json`),
      JSON.stringify({ ...trace, bridgeCalls: transportCalls, transportRequest: mainRequest, suggestionRequests }, null, 2));
    save();
    return { record, trace, message, service: sent.service, conversationId: sent.cid, runId: sent.runId, clientMessageId: sent.clientMessageId,
      suggestionCount: () => suggestionRequests.length };
  } finally { active = null; transportCalls = []; }
}
function assertSuggestionPayload(data: any, expected: { conversationId: string; messageId: string | null; source: string; questions: string[] }) {
  assert.deepEqual(Object.keys(data).sort(), ['conversationId', 'messageId', 'questions', 'source']);
  assert.equal(data.conversationId, expected.conversationId);
  assert.equal(data.messageId, expected.messageId);
  assert.equal(data.source, expected.source);
  assert.deepEqual(data.questions, expected.questions);
  assert.ok(data.questions.length >= 3 && data.questions.length <= 4);
  for (const question of data.questions) assert.ok(Array.from(question).length >= 2 && Array.from(question).length <= 40);
  const json = JSON.stringify(data);
  for (const secret of [devRuntime.agentV2.bridgeKey, devRuntime.agentV2.suggestionAppId, devRuntime.agentV2.appId, devRuntime.agentV2.model])
    assert.equal(json.includes(secret), false, 'The suggestions endpoint must not expose deployment internals');
}

let release: any, settingsBefore: any, platformBefore: any;
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
    probeVersion: 'agent-v2-f2-20261109', enterpriseKnowledgeEnabled: true,
    knowledgeExplanation: 'natural-knowledge-answer-v1',
  })}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`));
  const customer = await platform((tx: any) => one(tx, sql`select id,context_version from app.users where id=${user}`));
  assert.ok(customer, 'Eval user 645 must exist'); actor = { ...actor, contextVersion: Number(customer.context_version) };
  report.customer = { id: String(customer.id), contextVersion: actor.contextVersion };
  await fastGPTWorkflows().ready();
  report.status = 'running'; save();

  // Bootstrap copy is additive: the welcome line and preset questions come from
  // the bound runtime file, and no deployment secret reaches the entry context.
  const entry = await entryContext({ userId: user, contextVersion: actor.contextVersion, enterpriseId: '1454' }, {});
  assert.equal(entry.welcome, devRuntime.agentV2.welcome);
  assert.deepEqual(entry.presetQuestions, presets);
  assert.ok(typeof entry.entryToken === 'string' && entry.entryToken.split('.').length === 3);
  const entryJson = JSON.stringify(entry);
  for (const secret of [devRuntime.agentV2.bridgeKey, devRuntime.agentV2.suggestionAppId, devRuntime.agentV2.appId, devRuntime.agentV2.model])
    assert.equal(entryJson.includes(secret), false, 'Entry context must not expose deployment internals');
  assert.ok(!('agentV2' in entry) && !('suggestionAppId' in entry));
  report.checks.push({ welcome: entry.welcome, presetQuestions: entry.presetQuestions.length, entryTokenIssued: true, deploymentInternalsHidden: true });
  save();

  // Model-generated follow-ups ride on the delivered answer only. The search
  // tool and its CITE persistence remain the unchanged F0/F1 path.
  const generated = ['厨房水电改造大概要多久？', '水电验收要看哪些细节？', '老房子的水管需要全换吗？'];
  const firstQuestion = '厨房水电改造要注意什么？';
  const first = await execute({ name: 'suggestions-model', question: firstQuestion, expect: 'succeeded',
    steps: [{ name: 'search_enterprise', fields: { query: '厨房水电 开槽 布线 施工要点' } }],
    final: calls => {
      const cites = Array.isArray(calls[0]?.body?.cites) ? calls[0].body.cites : [];
      return cites.length ? `厨房水电改造要先确认点位和走线，开槽后按规范布管。[${cites[0].id}](CITE)` : '本次没有检索到可用原文。';
    },
    suggestion: { status: 200, text: generated.map((q, i) => `${i + 1}. ${q}`).join('\n'), usage: { inputTokens: 40, outputTokens: 20 } } });
  assert.equal(first.record.status, 'succeeded', first.record.error || 'model suggestion run must succeed');
  assert.equal(first.record.agentRuntime, 'fastgpt-agent-v2-v1');
  assert.equal(first.record.bridgeCalls[0].status, 200);
  assert.ok(first.record.bridgeCalls[0].body.cites?.length > 0, 'Search must return authorized evidence');
  assert.equal(first.record.citations, 1, 'CITE markers must still save citations');
  assert.ok(first.record.answer.trim() && !first.record.answer.includes('(CITE)'));
  assert.deepEqual(first.record.suggestionStep, { kind: 'agent_suggestions', status: 'succeeded', questions: generated, source: 'model', generated: true });
  assert.deepEqual(usageBy(first.record.usage).tokens, { kind: 'observed', input: 120, output: 30, quantity: 150 });
  assert.deepEqual(usageBy(first.record.usage).suggestion_tokens, { kind: 'observed', input: 40, output: 20, quantity: 60 });
  assert.equal(first.record.suggestionRequests.length, 1);
  const firstRequest = first.record.suggestionRequests[0];
  assert.equal(firstRequest.messageCount, 1, 'One bounded generation input, no conversation history');
  assert.equal(firstRequest.hasVariables, false, 'The suggestion call carries no Agent ticket');
  assert.equal(firstRequest.bridgeKeyLeaked, false);
  assert.equal(firstRequest.hasCiteMarker, false, 'Citation markers are stripped before generation');
  assert.ok(firstRequest.prompt.includes('厨房水电改造要先确认点位'), 'The delivered answer is the only context');
  assertSuggestionPayload(await first.service.suggestions(first.conversationId), { conversationId: first.conversationId,
    messageId: first.record.messageId, source: 'model', questions: generated });
  const cached = await new ConversationService(actor).suggestions(first.conversationId);
  assert.deepEqual(cached, await new ConversationService(actor).suggestions(first.conversationId), 'Cached readback is stable');
  const again = await first.service.send(first.conversationId, first.clientMessageId, { version: 1, blocks: [{ type: 'text', text: firstQuestion }] });
  assert.equal(String(again.runId), first.runId, 'Same client message must not create another run');
  assert.equal(first.suggestionCount(), 1, 'An idempotent resend must not regenerate follow-ups');
  const reentry = (await new ConversationService(actor).messages(first.conversationId)).items.find((m: any) => m.id === first.record.messageId);
  assert.ok(reentry?.available); assert.equal(textOf(reentry.content), first.record.answer);
  report.checks.push({ modelSuggestions: true, run: first.runId, citationRegression: true, suggestionUsage: 'observed 40/20',
    endpointReadback: true, idempotentResend: true, persistedReentry: true });
  save();

  // Business answers stay the authorized snapshot text; follow-ups are generated
  // from that delivered text, never from the model's unsupported draft.
  const businessGenerated = ['量房预约可以改时间吗？', '量房当天需要准备什么？', '量房后多久能看到方案？'];
  const business = await execute({ name: 'business-suggestions', question: appointmentQuestion, expect: 'succeeded',
    final: () => '我先查一下您的量房预约记录。\n您名下最近有两条现场量房记录。我已经帮您预约好了新的量房，明天设计师会联系您。',
    steps: [{ name: 'query_business', fields: { domain: 'appointments', leadId: '' } },
      { name: 'query_business', fields: { domain: 'appointments', leadId: '' } }],
    suggestion: { status: 200, text: businessGenerated.map((q, i) => `${i + 1}. ${q}`).join('\n'), usage: { inputTokens: 30, outputTokens: 15 } } });
  assert.equal(business.record.status, 'succeeded', business.record.error || 'business suggestion run must succeed');
  assert.equal(business.record.answer, expectedAppointments, 'Delivered text must remain the authorized snapshot');
  assert.ok(!business.record.answer.includes('预约好了'));
  assert.ok(!/1724|254|8月30日|（1818）|\d{4}-\d{2}-\d{2}T|\[|版本/.test(business.record.answer));
  assert.equal(business.record.citations, 0);
  assert.ok(String(business.record.rawDraft).includes('预约好了'), 'The model draft remains in the audit step only');
  const businessSteps = business.trace.steps.filter((step: any) => step.kind === 'agent_tool');
  assert.equal(businessSteps.length, 1, 'Identical tool calls share one authorized snapshot');
  assert.deepEqual(business.record.suggestionStep.questions, businessGenerated);
  assert.equal(business.record.suggestionStep.source, 'model');
  const businessRequest = business.record.suggestionRequests[0];
  assert.ok(businessRequest.prompt.includes('量房预约已确认'));
  assert.ok(!businessRequest.prompt.includes('预约好了'), 'The draft promise must not seed follow-ups');
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(businessRequest.prompt), 'No ISO range reaches the suggestion app');
  assert.deepEqual(usageBy(business.record.usage).suggestion_tokens, { kind: 'observed', input: 30, output: 15, quantity: 45 });
  assertSuggestionPayload(await business.service.suggestions(business.conversationId), { conversationId: business.conversationId,
    messageId: business.record.messageId, source: 'model', questions: businessGenerated });
  report.checks.push({ businessSuggestions: true, run: business.runId, answerFromSnapshot: true, draftNotDelivered: true,
    draftNotUsedForSuggestions: true, deduplicatedToolCalls: true });
  save();

  // Provider failure is ancillary: the answer is delivered and the configured
  // presets stand in, with an honest unknown-usage receipt.
  const failedProvider = await execute({ name: 'suggestions-provider-failure', question: '装修风格怎么选？', expect: 'succeeded',
    final: () => '可以从常住人口、采光和收纳习惯入手，再结合喜欢的材质和色调逐步缩小范围。', steps: [],
    suggestion: { status: 500 } });
  assert.equal(failedProvider.record.status, 'succeeded', failedProvider.record.error || 'the answer must survive suggestion failure');
  assert.deepEqual(failedProvider.record.suggestionStep.questions, presets);
  assert.equal(failedProvider.record.suggestionStep.source, 'presets');
  assert.deepEqual(usageBy(failedProvider.record.usage).suggestion_tokens, { kind: 'unavailable', input: null, output: null, quantity: null });
  assert.deepEqual(usageBy(failedProvider.record.usage).tokens, { kind: 'observed', input: 120, output: 30, quantity: 150 });
  assertSuggestionPayload(await failedProvider.service.suggestions(failedProvider.conversationId), { conversationId: failedProvider.conversationId,
    messageId: failedProvider.record.messageId, source: 'presets', questions: presets });
  report.checks.push({ providerFailureFallback: true, run: failedProvider.runId, answerDelivered: true, presetQuestions: presets.length,
    suggestionUsage: 'unavailable' });
  save();

  // Invalid or too-short model output is not trusted either; the provider usage
  // is still recorded, and the cache follows the newest answer in the same chat.
  const invalid = await execute({ name: 'suggestions-invalid-output', question: '那打压测试一般要多久？', conversationId: first.conversationId, expect: 'succeeded',
    final: () => '打压测试通常需要保持一段时间观察压力变化，具体以现场施工规范和验收要求为准。', steps: [],
    suggestion: { status: 200, text: '好的', usage: { inputTokens: 10, outputTokens: 2 } } });
  assert.equal(invalid.record.status, 'succeeded', invalid.record.error || 'the answer must survive invalid suggestions');
  assert.deepEqual(invalid.record.suggestionStep.questions, presets);
  assert.equal(invalid.record.suggestionStep.source, 'presets');
  assert.deepEqual(usageBy(invalid.record.usage).suggestion_tokens, { kind: 'observed', input: 10, output: 2, quantity: 12 });
  const invalidRead = await first.service.suggestions(first.conversationId);
  assert.equal(invalidRead.messageId, invalid.record.messageId, 'The cache follows the newest delivered answer');
  assert.notEqual(invalidRead.messageId, first.record.messageId);
  assert.equal(invalidRead.source, 'presets');
  assert.deepEqual(invalidRead.questions, presets);
  report.checks.push({ invalidOutputFallback: true, run: invalid.runId, perAnswerCacheInvalidated: true });
  save();

  // A failed answer leaves no suggestion receipt; the endpoint is still truthful.
  const failedAnswer = await execute({ name: 'suggestions-after-failed-answer', question: '帮我约个量房。', expect: 'failed',
    error: 'unsupported_model_commitment', final: () => '我已经帮您预约好了新的量房，明天设计师会联系您。', steps: [] });
  assert.equal(failedAnswer.record.status, 'failed');
  assert.equal(failedAnswer.record.error, 'unsupported_model_commitment');
  assert.equal(failedAnswer.record.messageId, null);
  assert.equal(failedAnswer.record.suggestionStep, null);
  assert.equal(failedAnswer.suggestionCount(), 0, 'A rejected answer generates no follow-ups');
  assertSuggestionPayload(await failedAnswer.service.suggestions(failedAnswer.conversationId), { conversationId: failedAnswer.conversationId,
    messageId: null, source: 'presets', questions: presets });
  report.checks.push({ failedAnswerNoSuggestions: true, run: failedAnswer.runId, truthfulEmptyState: true });
  save();

  // Another customer of the same enterprise cannot read this conversation's
  // follow-up cache; conversation access is resolved before any suggestion read.
  const outsiderUser = await platform((tx: any) => one(tx, sql`select id,context_version from app.users where id='744'`));
  assert.ok(outsiderUser, 'Other-customer fixture 744 must exist');
  const outsider: any = { enterpriseId: '1454', principal: { kind: 'user', userId: '744' },
    contextVersion: Number(outsiderUser.context_version), capabilities: ['assistant.chat.self'] };
  await assert.rejects(new ConversationService(outsider).suggestions(first.conversationId),
    (error: any) => error?.code === 'assistant_resource_not_found');
  report.checks.push({ otherCustomerSuggestionsDenied: true });
  save();

  // Every simulated request carried the app bindings and scoped tickets, and
  // never the deployment bridge key. Exactly one follow-up call per delivered answer.
  const delivered = report.scenarios.filter((record: any) => record.status === 'succeeded');
  assert.equal(suggestionRequests.length, 0, 'No generation happens outside a scenario');
  assert.ok(report.scenarios.every((record: any) => record.transportRequest?.ticketVariable === true), 'Every run posts a scoped ticket');
  assert.ok(report.scenarios.every((record: any) => record.transportRequest?.bridgeKeyLeaked === false), 'The bridge key never reaches the model request');
  assert.ok(delivered.every((record: any) => record.suggestionRequests.length === 1 && record.suggestionRequests[0].appId === devRuntime.agentV2.suggestionAppId));
  assert.ok(delivered.every((record: any) => record.steps.filter((step: any) => step.seq === 1007).length === 1));
  assert.ok(report.scenarios.filter((record: any) => record.status === 'failed').every((record: any) => record.suggestionRequests.length === 0));
  report.scope = 'F2 service acceptance uses deterministic simulated FastGPT transports over the real bridge, services, DB, suggestion cache and usage receipts. '
    + 'Welcome and preset copy are bootstrap payload only; no client chips or approved welcome visuals were changed. '
    + 'The real-model suggestion quality remains pending the external FastGPT channel quota.';
  report.status = 'passed'; save();
  console.log(JSON.stringify({ passed: true, scenarios: report.scenarios.map((s: any) => ({ name: s.name, run: s.runId, status: s.status, error: s.error,
    suggestionSource: s.suggestionStep?.source ?? null })), checks: report.checks }, null, 2));
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error); save();
  console.error(report.error); process.exitCode = 1;
} finally {
  const cleanup = async (key: string, f: () => Promise<any>) => { try { await f(); report.cleanup[key] = true; } catch (e) { report.cleanup[key] = String(e); process.exitCode = 1; } };
  globalThis.fetch = realFetch;
  if (settingsBefore) await cleanup('settingsRestored', () => tenant((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings
    set enabled=${settingsBefore.enabled},agent_config=${JSON.stringify(settingsBefore.agent_config)}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`)));
  if (platformBefore) await cleanup('providerRestored', () => platform((tx: any) => tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify(platformBefore.llm_config)}::jsonb where key='default'`)));
  await cleanup('bridgeClosed', closeFastGPTWorkflows);
  if (release) await cleanup('lockReleased', release);
  await require(path.resolve('src/lib/postgresql.ts')).closePostgresPool(); save();
}
