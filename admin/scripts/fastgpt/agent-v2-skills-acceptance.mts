/* eslint-disable @typescript-eslint/no-explicit-any -- Retained F3 service-level acceptance. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
require('@next/env').loadEnvConfig(process.cwd(), true);

const label = process.argv.find(x => x.startsWith('--label='))?.slice(8) || 'f3-01';
assert.match(label, /^[a-z0-9-]+$/);
const evidence = path.resolve('../tmp/xiaok-fastgpt-agentv2-f3-20261109');
const out = path.join(evidence, 'acceptance-' + label);
assert.ok(!fs.existsSync(path.join(out, 'assessment.json')), 'Preserve every original batch');
fs.mkdirSync(out, { recursive: true });

const { agentV2SkillIds, agentV2SkillPack, agentV2Skills } = require(path.resolve('src/lib/assistant/fastgpt/agent-v2/skills.ts'));
const runtimeFile = path.join(evidence, 'runtime.private.json');
if (!fs.existsSync(runtimeFile)) {
  const base = JSON.parse(fs.readFileSync(path.resolve('../tmp/xiaok-fastgpt-agentv2-f2-20261109/runtime.private.json'), 'utf8'));
  base.auditFile = path.join(evidence, 'agent-v2-audit.jsonl');
  // F3 owns the skills selection only; the suggestion app stays covered by the
  // F2 batch so every intercepted provider call here is the main conversation.
  delete base.agentV2.suggestionAppId;
  base.agentV2.skills = { version: agentV2SkillPack, enabled: [...agentV2SkillIds] };
  fs.writeFileSync(runtimeFile, JSON.stringify(base, null, 2));
}
const runtimeBytes = fs.readFileSync(runtimeFile);
const devRuntime = JSON.parse(runtimeBytes.toString('utf8'));
assert.equal(devRuntime.agentV2.enterpriseId, '1454');
assert.equal(devRuntime.baseUrl, 'http://127.0.0.1:18300');
assert.equal(devRuntime.agentV2.skills?.version, agentV2SkillPack);
assert.deepEqual(devRuntime.agentV2.skills?.enabled, [...agentV2SkillIds]);
assert.equal(devRuntime.agentV2.suggestionAppId, undefined, 'F3 runtime excludes the F2 suggestion app');
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
const { KnowledgeService } = require(path.resolve('src/lib/assistant/knowledge/service.ts'));
const { claimJob } = require(path.resolve('src/lib/assistant/infrastructure/job-queue.ts'));
const { processAssistantRun } = require(path.resolve('src/lib/assistant/application/worker.ts'));
const { fastGPTAgentV2Configuration } = require(path.resolve('src/lib/assistant/fastgpt/agent-v2/config.ts'));
const { FastGPTAgentV2 } = require(path.resolve('src/lib/assistant/fastgpt/agent-v2/runtime.ts'));
const { fastGPTWorkflows, closeFastGPTWorkflows } = require(path.resolve('src/lib/assistant/fastgpt/runtime.ts'));
const { lockAssistantAcceptance } = await import('../assistant-acceptance-safety.mjs');

const tenant = (f: any) => withTenantTransaction('1454', f);
const platform = (f: any) => withPlatformTransaction(f);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const textOf = (content: any) => (content?.blocks || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
const sourceHash = (file: string) => createHash('sha256').update(fs.readFileSync(path.resolve(file))).digest('hex');

const user = '645';
const questions = [
  { text: '我家水电马上要开工了，水路这块主要做些什么？', page: 17, query: '水路施工工艺流程 水电开工 给排水 水管' },
  { text: '那卫生间防水做完还会检查吗？这份说明里有写要等多久吗？', page: 18, query: '卫生间防水 闭水试验 检查 验收 等待时间' },
  { text: '客厅地砖的纹理我想顺着窗户方向走。铺之前怎么排版，我怎么把想要的方向说明白，最后谁帮我核对？', page: 19, query: '客厅地砖铺贴排版 纹理方向 顺窗户方向 排版确认流程' },
  { text: '施工期间家里的门窗和做好的成品会不会保护？保护材料什么时候能撤？', page: 21, query: '施工期间门窗保护 成品保护 保护材料撤除时间' },
];
const appointmentQ5 = '我最近有没有量房预约？帮我看看时间和状态。';
const expectedAppointments = '现场量房：量房预约已过期，时间2026年9月1日 00:06–02:06（北京时间）。\n'
  + '现场量房：量房预约已确认，时间2026年9月1日 09:07–11:07（北京时间）。';
const ownEmptyLead = '8235';
const archivedLead = '1724';
let actor: any = { enterpriseId: '1454', principal: { kind: 'user', userId: user }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
const boundActor: any = { ...actor, entry: { kind: 'lead', id: '1818' } };

const report: any = { status: 'preparing', label, model, appId: devRuntime.agentV2.appId, protocol: devRuntime.agentV2.protocol,
  skillPack: devRuntime.agentV2.skills, questions: questions.map(({ text, page }) => ({ text, page })), appointmentQuestion: appointmentQ5,
  source: { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    runtimeHash: createHash('sha256').update(runtimeBytes).digest('hex'),
    files: Object.fromEntries(['src/lib/assistant/fastgpt/agent-v2/skills.ts', 'src/lib/assistant/fastgpt/agent-v2/config.ts',
      'src/lib/assistant/fastgpt/agent-v2/runtime.ts', 'src/lib/assistant/fastgpt/agent-v2/worker.ts',
      'src/lib/assistant/agent/context.ts', 'scripts/fastgpt/agent-v2-skills-acceptance.mts'].map(file => [file, sourceHash(file)])) },
  fixtures: { user, archivedLead, ownEmptyLead, leadBound: '1818', appointments: '255/256' },
  transport: 'deterministic-simulated-fastgpt-agent-v2',
  realModelPending: 'FastGPT DashScope channel returns external 403 AllocationQuota.FreeTierOnly; no resampling of this batch',
  scenarios: [], checks: [], cleanup: {}, unknownCurrency: true };
const save = () => fs.writeFileSync(path.join(out, 'assessment.json'), JSON.stringify(report, null, 2));

type BridgeCall = { name: string; status: number; body: any };
type Scenario = {
  name: string; question: string; who?: any; expect: 'succeeded' | 'failed'; error?: string; failMain?: number;
  steps: Array<{ name: string; fields: Record<string, string> }>;
  final: (calls: BridgeCall[]) => string;
};
let active: Pick<Scenario, 'steps' | 'final' | 'failMain'> | null = null;
let transportCalls: BridgeCall[] = [];
let transportRequest: any = null;
let transportError: string | null = null;
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input?.url || '');
  if (!active || url !== devRuntime.baseUrl + '/api/v1/chat/completions') return realFetch(input, init);
  try {
    const request = JSON.parse(String(init?.body));
    assert.equal(request.appId, devRuntime.agentV2.appId, 'The main conversation keeps its Agent V2 app');
    const messages = Array.isArray(request.messages) ? request.messages : [];
    transportRequest = { appId: request.appId, stream: request.stream, detail: request.detail, messageCount: messages.length,
      roles: messages.map((message: any) => message.role),
      skillPrompt: messages.find((message: any) => message.role === 'system')?.content ?? null,
      skillPromptLength: Array.from(String(messages.find((message: any) => message.role === 'system')?.content ?? '')).length,
      ticketVariable: typeof request.variables?.workflowTicket === 'string',
      bridgeKeyLeaked: JSON.stringify(request).includes(devRuntime.agentV2.bridgeKey) };
    assert.equal(transportRequest.roles[0], 'system', 'Enabled skills are composed as a leading system message');
    assert.match(String(transportRequest.skillPrompt), new RegExp(`已启用技能｜${agentV2SkillPack}`));
    for (const skill of agentV2Skills({ version: agentV2SkillPack, enabled: [...agentV2SkillIds] }))
      assert.ok(String(transportRequest.skillPrompt).includes(skill.title), `Skill ${skill.id} must reach the model when enabled`);
    if (active.failMain)
      return new Response(JSON.stringify({ error: 'simulated_provider_failure' }), { status: active.failMain, headers: { 'Content-Type': 'application/json' } });
    const calls: BridgeCall[] = [];
    for (const step of active.steps) {
      const response = await realFetch('http://127.0.0.1:18310/agent-v2-tool/' + step.name, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Bearer ' + devRuntime.agentV2.bridgeKey },
        body: new URLSearchParams(step.fields).toString(),
      });
      const raw = await response.text();
      let body: any;
      try { body = JSON.parse(raw); } catch { throw new Error(`bridge returned non-JSON status ${response.status}`); }
      calls.push({ name: step.name, status: response.status, body });
      transportCalls = calls;
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: active.final(calls) } }],
      responseData: [{ moduleType: 'agent', inputTokens: 120, outputTokens: 30 }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    transportError ??= error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw error;
  }
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
  const record: any = { name: item.name, question: item.question, expect: item.expect, errorExpected: item.error };
  report.scenarios.push(record); save();
  transportCalls = []; transportRequest = null; transportError = null; active = item;
  try {
    const sent = await send(item.question, item.who || actor);
    record.conversationId = sent.cid; record.runId = sent.runId; record.clientMessageId = sent.clientMessageId;
    await processQueued(sent.runId);
    const trace = await readTrace(sent.runId);
    record.status = trace.run.status; record.error = trace.run.error_code; record.providerStartedAt = trace.run.provider_started_at;
    record.agentRuntime = trace.run.policy_snapshot?.agentRuntime?.protocol || null;
    record.binding = trace.run.policy_snapshot?.agentRuntime?.binding || null;
    record.bridgeCalls = transportCalls; record.transportRequest = transportRequest; record.transportError = transportError;
    record.steps = trace.steps.map((step: any) => ({ seq: step.step_seq, kind: step.kind, status: step.status,
      protocol: step.input_summary?.protocol || null, skills: step.input_summary?.skills ?? null,
      skillPack: step.input_summary?.skillPack ?? null, tool: step.input_summary?.tool || null }));
    record.usage = trace.usage.map((u: any) => ({ category: u.category, kind: u.measurement_kind,
      input: u.input_tokens == null ? null : Number(u.input_tokens), output: u.output_tokens == null ? null : Number(u.output_tokens) }));
    const message = trace.run.output_message_id
      ? (await sent.service.messages(sent.cid)).items.find((m: any) => m.id === trace.run.output_message_id) : null;
    record.messageId = message?.id || null; record.available = message?.available ?? null;
    record.answer = message ? textOf(message.content) : null;
    record.citations = (message?.citations || []).map((citation: any) => ({ id: citation.id, title: citation.title, documentId: citation.documentId ?? null }));
    record.rawDraft = trace.steps.find((step: any) => step.kind === 'agent_synthesis_context')?.private_checkpoint?.raw ?? null;
    record.synthesis = trace.steps.find((step: any) => step.kind === 'agent_synthesis_context')?.input_summary ?? null;
    fs.writeFileSync(path.join(out, `trace-${item.name}-${sent.runId}.json`), JSON.stringify({ ...trace, bridgeCalls: transportCalls, transportRequest, transportError }, null, 2));
    save();
    return { record, trace, message, service: sent.service, conversationId: sent.cid, runId: sent.runId, clientMessageId: sent.clientMessageId };
  } finally { active = null; transportCalls = []; }
}

const knowledgeFixture = JSON.parse(fs.readFileSync(path.resolve('../tmp/xiaok-mineru-fastgpt-preview-20261107/craft-only/preparation.json'), 'utf8'));
assert.equal(knowledgeFixture.enterpriseId, '1454');
const knowledgeAdminId = String(knowledgeFixture.adminIds[0]);

let release: any, settingsBefore: any, platformBefore: any, restrictedDoc: string | undefined;
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
    probeVersion: 'agent-v2-f3-20261109', enterpriseKnowledgeEnabled: true,
    knowledgeExplanation: 'natural-knowledge-answer-v1',
  })}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`));
  const customer = await platform((tx: any) => one(tx, sql`select id,context_version from app.users where id=${user}`));
  assert.ok(customer, 'Eval user 645 must exist'); actor = { ...actor, contextVersion: Number(customer.context_version) };
  Object.assign(boundActor, { contextVersion: actor.contextVersion });
  report.customer = { id: String(customer.id), contextVersion: actor.contextVersion };
  const boundConfig = fastGPTAgentV2Configuration('1454');
  assert.ok(boundConfig, 'The F3 runtime must bind enterprise 1454');
  assert.deepEqual(boundConfig.configuration.skills, devRuntime.agentV2.skills);
  assert.equal(fastGPTAgentV2Configuration('2884'), undefined, 'Skills stay scoped to the explicitly enabled enterprise');
  report.checks.push({ explicitEnterpriseBinding: true, binding: boundConfig.binding, otherEnterpriseUnbound: true });
  save();
  await fastGPTWorkflows().ready();
  const probe = await realFetch('http://127.0.0.1:18310/agent-v2-tool/search_enterprise', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Bearer ' + devRuntime.agentV2.bridgeKey },
    body: new URLSearchParams({ query: 'probe' }).toString() });
  const probeBody = await probe.json();
  assert.equal(probe.status, 409, 'The tool bridge is listening before the batch starts');
  assert.equal(probeBody.error, 'context_unavailable', 'A callback without an active run is rejected');
  report.checks.push({ bridgeListening: true });
  save();
  report.status = 'running'; save();

  // A direct runtime check proves the disable path without changing the bound
  // runtime file mid-process (the product drift guard must stay intact).
  const direct = async (skills: any, messages = [{ role: 'user', content: '你好' }]) => {
    let body: any;
    const previous = globalThis.fetch;
    globalThis.fetch = async (_input: any, init?: any) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: '好的' } }],
        responseData: [{ moduleType: 'agent', inputTokens: 1, outputTokens: 1 }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
      const runtime = new FastGPTAgentV2({ protocol: devRuntime.agentV2.protocol, enterpriseId: '1454', appId: devRuntime.agentV2.appId,
        model: devRuntime.agentV2.model, bridgeKey: devRuntime.agentV2.bridgeKey, skills,
        baseUrl: devRuntime.baseUrl, apiKey: devRuntime.apiKey, record: () => {} });
      const result = await runtime.run(messages as any, { authorize: async () => {}, tool: async () => ({ status: 'empty' }) });
      assert.equal(result.text, '好的');
      return body;
    } finally { globalThis.fetch = previous; }
  };
  const disabled = await direct(undefined);
  assert.deepEqual(disabled.messages, [{ role: 'user', content: '你好' }]);
  assert.equal(JSON.stringify(disabled).includes('已启用技能'), false, 'No skill content is sent when the binding has no skills');
  const empty = await direct({ version: agentV2SkillPack, enabled: [] });
  assert.deepEqual(empty.messages, [{ role: 'user', content: '你好' }]);
  const enabled = await direct({ version: agentV2SkillPack, enabled: ['stage-reminder'] });
  assert.equal(enabled.messages[0].role, 'system');
  assert.match(enabled.messages[0].content, /施工阶段提醒/);
  assert.equal(enabled.messages[0].content.includes('验收要点'), false, 'Disabled skills stay out of the prompt');
  report.checks.push({ disabledSkillPromptAbsent: true, emptySelectionAbsent: true, partialSelectionOnly: true });
  save();

  // Fixed four PPT questions still retrieve and cite their authorized pages
  // while the five SOP skills are enabled.
  for (const [index, item] of questions.entries()) {
    const result = await execute({ name: 'skills-q' + (index + 1), question: item.text, expect: 'succeeded',
      final: calls => {
        const cites = Array.isArray(calls[0]?.body?.cites) ? calls[0].body.cites : [];
        return cites.length ? `按授权原文说明这一步的做法与检查条件。[${cites[0].id}](CITE)` : '本次没有检索到可用原文，无法确认企业规定。';
      },
      steps: [{ name: 'search_enterprise', fields: { query: item.query } }] });
    assert.equal(result.record.status, 'succeeded', result.record.error || 'skill knowledge question must succeed');
    assert.equal(result.record.agentRuntime, 'fastgpt-agent-v2-v1');
    assert.equal(result.record.binding, boundConfig.binding, 'The skills selection is covered by the runtime binding');
    assert.equal(result.record.bridgeCalls[0].status, 200);
    assert.ok(result.record.bridgeCalls[0].body.cites?.length > 0, 'Search must return authorized evidence');
    assert.equal(result.record.citations.length, 1, 'CITE markers still save citations');
    assert.equal(result.record.citations[0].title.includes('第' + item.page + '页'), true, `Expected page ${item.page} citation`);
    assert.ok(String(result.record.answer).trim() && !String(result.record.answer).includes('(CITE)'));
    const synthesis = result.trace.steps.find((step: any) => step.kind === 'agent_synthesis_context');
    assert.equal(synthesis.input_summary.skillPack, agentV2SkillPack);
    assert.deepEqual(synthesis.input_summary.skills, [...agentV2SkillIds]);
    const retrieval = result.trace.steps.find((step: any) => step.kind === 'retrieval');
    assert.ok(retrieval?.private_checkpoint?.length > 0);
    report.checks.push({ ['knowledgeQ' + (index + 1)]: true, run: result.runId, page: item.page,
      skillsInTrace: true, systemSkillPrompt: true });
    save();
  }

  // The fifth question keeps the authorized snapshot delivery while the skills
  // are enabled; the model draft promise still never reaches the customer.
  const q5 = await execute({ name: 'skills-q5', question: appointmentQ5, expect: 'succeeded',
    final: () => '我先查一下您的量房预约记录。\n我已经帮您预约好了新的量房，明天设计师会联系您。',
    steps: [{ name: 'query_business', fields: { domain: 'appointments', leadId: '' } },
      { name: 'query_business', fields: { domain: 'appointments', leadId: '' } }] });
  assert.equal(q5.record.status, 'succeeded', q5.record.error || 'appointment lookup must succeed');
  assert.equal(q5.record.answer, expectedAppointments, 'Delivered text must remain the authorized snapshot');
  assert.equal(q5.record.rawDraft.includes('预约好了'), true, 'The model draft stays in the audit step');
  assert.equal(q5.record.answer.includes('预约好了'), false);
  assert.ok(!/1724|254|8月30日|（1818）|\d{4}-\d{2}-\d{2}T|\[|版本/.test(q5.record.answer));
  assert.equal(q5.record.steps.filter((step: any) => step.tool === 'query_business').length, 1, 'Duplicate tool calls dedupe');
  assert.equal(q5.record.synthesis.skills.length, agentV2SkillIds.length);
  report.checks.push({ fifthQuestion: true, run: q5.runId, snapshotDelivered: true, draftPromiseNotDelivered: true, skillsInTrace: true });
  save();

  // A skill must not create an action permission: an unsupported promise in a
  // free-form answer is still rejected before delivery.
  const commitment = await execute({ name: 'skills-commitment', question: '帮我约个量房。', expect: 'failed', error: 'unsupported_model_commitment',
    final: () => '我已经帮您预约好了新的量房，明天设计师会联系您。', steps: [] });
  assert.equal(commitment.record.status, 'failed'); assert.equal(commitment.record.error, 'unsupported_model_commitment');
  assert.equal(commitment.record.messageId, null, 'A skill-guided answer cannot promise an action');
  report.checks.push({ unsupportedCommitmentRejectedWithSkills: true, run: commitment.runId });
  save();

  // Provider failure remains an honest failed run; no answer is delivered and
  // the skill block is not mistaken for business authority.
  const providerFailure = await execute({ name: 'skills-provider-failure', question: '水路打压测试一般要多久？', expect: 'failed',
    error: 'fastgpt_workflow_unavailable', failMain: 500, final: () => '', steps: [] });
  assert.equal(providerFailure.record.status, 'failed'); assert.equal(providerFailure.record.error, 'fastgpt_workflow_unavailable');
  assert.equal(providerFailure.record.messageId, null);
  report.checks.push({ providerFailureNoDelivery: true, run: providerFailure.runId });
  save();

  // Permission matrix stays unchanged with skills enabled.
  const bound = await execute({ name: 'skills-bound-lead', question: '顺便看下我另一个房子的预约。', who: boundActor, expect: 'failed',
    error: 'assistant_resource_not_found', final: () => '抱歉，这次没有查到可用的预约记录。',
    steps: [{ name: 'query_business', fields: { domain: 'appointments', leadId: ownEmptyLead } }] });
  assert.equal(bound.record.status, 'failed'); assert.equal(bound.record.error, 'assistant_resource_not_found');
  assert.equal(bound.record.bridgeCalls[0].status, 404); assert.equal(bound.record.messageId, null);
  const invalid = await execute({ name: 'skills-invalid-domain', question: '帮我查一下付款记录。', expect: 'failed', error: 'invalid_message',
    final: () => '抱歉，这次没有查到可用的记录。', steps: [{ name: 'query_business', fields: { domain: 'payments', leadId: '' } }] });
  assert.equal(invalid.record.status, 'failed'); assert.equal(invalid.record.error, 'invalid_message');
  assert.equal(invalid.record.bridgeCalls[0].status, 422);
  const archived = await execute({ name: 'skills-archived-lead', question: '我想查一下东辰心语那套房子的量房预约。', expect: 'failed',
    error: 'assistant_resource_not_found', final: () => '抱歉，这次没有查到可用的预约记录。',
    steps: [{ name: 'query_business', fields: { domain: 'appointments', leadId: archivedLead } }] });
  assert.equal(archived.record.status, 'failed'); assert.equal(archived.record.error, 'assistant_resource_not_found');
  assert.equal(archived.record.bridgeCalls[0].status, 404); assert.equal(archived.record.messageId, null);
  report.checks.push({ boundLeadRejected: true, invalidDomainRejected: true, archivedLeadRejected: true });
  save();

  // Another customer cannot read the conversation even though skills are enabled.
  const outsiderUser = await platform((tx: any) => one(tx, sql`select id,context_version from app.users where id='744'`));
  assert.ok(outsiderUser, 'Other-customer fixture 744 must exist');
  const outsider: any = { enterpriseId: '1454', principal: { kind: 'user', userId: '744' },
    contextVersion: Number(outsiderUser.context_version), capabilities: ['assistant.chat.self'] };
  await assert.rejects(new ConversationService(outsider).messages(report.scenarios.find((s: any) => s.name === 'skills-q1').conversationId),
    (error: any) => error?.code === 'assistant_resource_not_found');
  report.checks.push({ otherCustomerDenied: true });
  save();

  // Source revocation still closes a saved answer and its citation, then restores.
  const knowledge = new KnowledgeService({ enterpriseId: '1454', adminId: knowledgeAdminId });
  const first = report.scenarios.find((s: any) => s.name === 'skills-q1');
  const citationRow = await tenant((tx: any) => one(tx, sql`select document_id::text document_id from app.assistant_message_citations
    where enterprise_id=1454 and id=${first.citations[0].id}`));
  restrictedDoc = String(citationRow.document_id);
  const setAudience = async (documentId: string, audience: string) => {
    const detail = await knowledge.execute('detail', { documentId });
    if (detail.document.audience === audience) return;
    await knowledge.execute('metadata', { documentId, expectedVersion: Number(detail.document.version), audience }, randomUUID());
  };
  await setAudience(restrictedDoc, 'staff_internal');
  assert.equal((await new ConversationService(actor).messages(first.conversationId)).items.find((m: any) => m.id === first.messageId).available, false);
  assert.equal((await new ConversationService(actor).citation(first.citations[0].id, false, first.conversationId)).available, false);
  report.checks.push({ revokedHidden: true, restrictedDoc });
  save();
  await setAudience(restrictedDoc, 'customer_public');
  restrictedDoc = undefined;
  assert.equal((await new ConversationService(actor).messages(first.conversationId)).items.find((m: any) => m.id === first.messageId).available, true);
  assert.equal((await new ConversationService(actor).citation(first.citations[0].id, false, first.conversationId)).available, true);
  report.checks.push({ restoredReadable: true });
  save();

  // Every simulated request carried the skill pack, the scoped ticket and no
  // bridge key; every delivered run recorded the enabled skills in step 1006.
  assert.ok(report.scenarios.every((record: any) => record.transportRequest?.ticketVariable === true), 'Every run posts a scoped ticket');
  assert.ok(report.scenarios.every((record: any) => record.transportRequest?.bridgeKeyLeaked === false), 'The bridge key never reaches the model request');
  assert.ok(report.scenarios.every((record: any) => record.transportRequest?.roles?.[0] === 'system'), 'Every run carries the enabled skill block');
  assert.ok(report.scenarios.filter((record: any) => record.status === 'succeeded').every((record: any) =>
    record.synthesis?.skillPack === agentV2SkillPack && record.synthesis?.skills?.length === agentV2SkillIds.length));
  const audit = fs.readFileSync(devRuntime.auditFile, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    .filter(entry => entry.kind === 'agentV2' && entry.value?.kind === 'agent_v2');
  assert.ok(audit.length > 0, 'The model audit stream must record skill-enabled calls');
  assert.ok(audit.every(entry => entry.value.skillPack === agentV2SkillPack && entry.value.skills.length === agentV2SkillIds.length));
  report.checks.push({ auditSkillSelection: audit.length });
  report.scope = 'F3 service acceptance uses deterministic simulated FastGPT transports over the real bridge, services, DB, citation/run persistence and source revocation. '
    + 'Skills are project-owned versioned SOP text; they add no tools, permissions or business actions and stay explicit to enterprise 1454. '
    + 'The real-model answer/skill quality remains pending the external FastGPT channel quota.';
  report.status = 'passed'; save();
  console.log(JSON.stringify({ passed: true, scenarios: report.scenarios.map((s: any) => ({ name: s.name, run: s.runId, status: s.status, error: s.error })),
    checks: report.checks }, null, 2));
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error); save();
  console.error(report.error); process.exitCode = 1;
} finally {
  const cleanup = async (key: string, f: () => Promise<any>) => { try { await f(); report.cleanup[key] = true; } catch (e) { report.cleanup[key] = String(e); process.exitCode = 1; } };
  globalThis.fetch = realFetch;
  if (restrictedDoc) await cleanup('audienceRestored', async () => {
    const knowledge = new KnowledgeService({ enterpriseId: '1454', adminId: knowledgeAdminId });
    const detail = await knowledge.execute('detail', { documentId: restrictedDoc });
    if (detail.document.audience !== 'customer_public')
      await knowledge.execute('metadata', { documentId: restrictedDoc, expectedVersion: Number(detail.document.version), audience: 'customer_public' }, randomUUID());
  });
  if (settingsBefore) await cleanup('settingsRestored', () => tenant((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings
    set enabled=${settingsBefore.enabled},agent_config=${JSON.stringify(settingsBefore.agent_config)}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`)));
  if (platformBefore) await cleanup('providerRestored', () => platform((tx: any) => tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify(platformBefore.llm_config)}::jsonb where key='default'`)));
  await cleanup('bridgeClosed', closeFastGPTWorkflows);
  if (release) await cleanup('lockReleased', release);
  await require(path.resolve('src/lib/postgresql.ts')).closePostgresPool(); save();
}
