import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { AiProviderError } from '@/lib/ai/provider-types';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { getPlatformLlmRuntimeConfig, savePlatformLlmConfig } from '@/lib/platform-llm-config';
import { bailianResponsesBinding } from '@/lib/ai/providers/bailian-responses-capabilities';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { AssistantError, safeText, type ActorContext, type MessageContent } from '@/lib/assistant/contracts';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { assistantHttp } from '@/lib/assistant/application/http';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { claimJob, runContext } from '@/lib/assistant/infrastructure/job-queue';
import { processAnswer } from '@/lib/assistant/infrastructure/answer-worker';
import { naturalKnowledgeProtocol, sourceBoundaryValidationProtocol } from '@/lib/assistant/agent/knowledge-explanation';
import { BailianKnowledgeError, BailianKnowledgeProvider } from '@/lib/assistant/knowledge/bailian-provider';
import { claimKnowledgeJob, runKnowledgeJob } from '@/lib/assistant/knowledge/index-worker';
import { processManagedKnowledgeCleanup } from '@/lib/assistant/knowledge/managed-cleanup';
import { retrieveKnowledge } from '@/lib/assistant/knowledge/retrieval';
import { KnowledgeService } from '@/lib/assistant/knowledge/service';
import { ConstructionService } from '@/lib/construction/service';
import { SiteChatService } from '@/lib/construction/site-chat';
import { PlanCustomerService } from '@/lib/construction/site-plans';
import { processSiteRecord } from '@/lib/construction/site-worker';
import { delegationConsumer } from '@/lib/native-workflow/live/delegation-state';
import { observeDelegation } from '@/lib/native-workflow/live/delegation-sources';
import { runDelegationTick } from '@/lib/native-workflow/live/delegation-worker';
import { mockBailianRag } from './xiaok-r4-bailian-mock';

const eid = '1454', control = '1455';
const logicalModel = 'deepseek-flash', model = 'deepseek-v4.1-flash-1017', providerKey = 'bailian';
const liveModel = process.argv.includes('--live-model');
const hosted = process.argv.includes('--hosted');
const localKnowledge = process.argv.includes('--local-knowledge') || liveModel && !hosted;
const durableAcceptance = process.argv.includes('--durable-integration');
const i6Dialogue = process.argv.includes('--i6-dialogue');
const i67Dialogue = process.argv.includes('--i67-dialogue');
const i6ProjectStatus = process.argv.includes('--i6-project-status');
const i6Search = (i6Dialogue || i67Dialogue) && process.env.ASSISTANT_WEB_SEARCH_TOOLS === '1';
const mock = !localKnowledge && !hosted ? mockBailianRag() : null;
const label = process.argv.find(arg => arg.startsWith('--label='))?.slice(8) ?? randomUUID();
const target = new URL(process.env.XIAOK_R6_DATABASE_URL ?? 'http://missing');
assert.match(label, /^[a-z0-9-]{1,72}$/);
assert.equal(target.protocol, 'postgresql:');
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.username, 'sfp_app');
assert.ok(Number(target.port) >= 49152 && !target.search && !target.hash);
assert.match(target.pathname, /^\/xiaok_r6_(?:acceptance|model|hosted)(?:_[a-z0-9]+)?$/);
const i67Receipt = (scene: string, index: number) => ({
  A: ['区分一般渗漏原因和 5.6.1 原文', '核实基层验收及穿结构管道埋设前提，保持工期未知', '先防水验收再下一工序，按适用部位引用试验条文，现场放行仍需实际记录'],
  B: ['PPT 仅支持安排防水和后续检查，公开规范独立引用，不宣称企业采用量数'],
  C: ['相同版本的独立目录证明状态，公告支持日期，原文支持工程范围，不能替该旧房认定适用'],
  D: ['厨房作为初始对象', '切到卫生间，保留追问意图，原厨房现场资料不进入新结论'],
  E: ['主卧真实发布记录待核对，厨房完工不适用，普通询问无委托'],
  F: ['明确两项企业参数缺失，公开量数不得补成企业规定'],
  memory: ['本人偏好实际保存', '新咨询只读回沟通偏好'],
} as Record<string, string[]>)[scene][index];
const output = 'tmp/r6/' + label;
mkdirSync(output, { recursive: true });
const json = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2);
const save = (name: string, value: unknown) => writeFileSync(output + '/' + name + '.json', json(value), { flag: 'wx' });
const checks: { name: string; status: string; detail?: string }[] = [];
const question = '卫生间防水施工前需要注意什么？';
const delegation = '帮我跟进卫生间水管根部处理，完成后告诉我。';
const preference = '以后请先告诉我结论，再说细节。';
const recall = '上次我说的沟通偏好，你还记得吗？';
const subject = '水管根部处理';
const ppt = JSON.parse(readFileSync('scripts/fixtures/xiaok-ppt-craft-preview.json', 'utf8')) as {
  source: Row; drafts: { slide: number; title: string; body: string }[];
};
const standard = ppt.drafts.find(item => item.slide === 18)!;
const block = (text: string): MessageContent => ({ version: 1, blocks: [{ type: 'text', text }] });
const mediaBytes = () => sharp({ create: { width: 112, height: 80, channels: 3, background: '#bbc5ca' } }).png().toBuffer();

function binding() {
  const names = execFileSync('git', ['ls-files','-c','-o','--exclude-standard','-z','--','src','drizzle','scripts','package-lock.json','../miniprogram'])
    .toString().split('\0').filter(Boolean).sort();
  const sha = createHash('sha256');
  for (const name of names) sha.update(name).update('\0').update(readFileSync(name)).update('\0');
  return { files: names.length, sha256: sha.digest('hex') };
}

async function check(name: string, verify: () => Promise<void>, continueAfterFailure = false) {
  try {
    await verify();
    checks.push({ name, status: 'passed' });
    console.log('PASS', name);
  } catch (error) {
    checks.push({ name, status: 'failed', detail: String(error) });
    if (!continueAfterFailure || String(error).includes('provider_outcome_unknown')) throw error;
    console.error('FAIL', name, String(error));
  }
}

async function configure() {
  const upstream = liveModel ? await getPlatformLlmRuntimeConfig() : undefined;
  if (upstream) assert.ok(upstream.providerKey === providerKey && upstream.model === model
    && upstream.apiKey && bailianResponsesBinding(upstream.baseUrl, model));
  await closePostgresPool();
  process.env.DATABASE_URL = target.href;
  process.env.ASSISTANT_KNOWLEDGE_PROVIDER = localKnowledge ? 'local' : 'bailian';
  process.env.NATIVE_WORKFLOW_DELEGATION_ENABLED = '1';
  process.env.NATIVE_WORKFLOW_DELEGATION_ENTERPRISE_IDS = eid;
  process.env.ASSISTANT_RESPONSES_API = '1';
  process.env.ASSISTANT_RESPONSES_MAX_RETRIES = '0';
  process.env.ASSISTANT_TEXT_DISABLE_THINKING = '1';
  process.env.ASSISTANT_REQUESTS_PER_MINUTE = '120';
  process.env.AI_ASSET_STORAGE_DIR = output + '/media';
  for (const key of ['ASSISTANT_TEXT_MODEL','ASSISTANT_NATIVE_TOOLS','ASSISTANT_WEB_SEARCH_TOOLS','XIAOK_FASTGPT_WORKFLOWS_FILE',
    'XIAOK_FASTGPT_RAG_FILE','XIAOK_FASTGPT_RETRIEVAL_FILE','ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS']) delete process.env[key];
  if (i6Search) process.env.ASSISTANT_WEB_SEARCH_TOOLS = '1';
  const db = await withPlatformTransaction(async tx => {
    const identity = await one(tx, sql`select current_database() as name,current_user as role,
      (select rolsuper or rolbypassrls from pg_roles where rolname=current_user) as bypass,
      (select count(*)::int from app.enterprises) as enterprises,
      (select count(*)::int from app.assistant_jobs where status in ('queued','running')) as open_jobs`);
    assert.deepEqual(identity, { name: target.pathname.slice(1), role: 'sfp_app', bypass: false, enterprises: 0, open_jobs: 0 });
    const migration = createHash('sha256').update(readFileSync('drizzle/0126_native_workflow_delegation_integration.sql')).digest('hex');
    // The application role cannot read the migration ledger on all installations.
    assert.equal((await one(tx, sql`select count(*)::int as count from pg_trigger where tgname in
      ('native_delegation_event_delivery','native_delegation_project_change') and tgenabled='O'`))?.count, 2);
    const config = { runtime: 'langgraph-v1', providerKey: liveModel ? providerKey : 'dashscope', model: liveModel ? model : 'qwen3.7-flash', tools: true, imageInput: false,
      probeVersion: 'r6-isolated', enterpriseKnowledgeEnabled: true, knowledgeExplanation: naturalKnowledgeProtocol,
      knowledgeAnswerValidation: sourceBoundaryValidationProtocol };
    await tx.execute(sql`insert into app.system_roles(role_key,label,menu_keys) values('designer','R6 合成设计师',array['construction-projects'])
      on conflict(role_key) do nothing`);
    for (const tenant of [eid, control]) {
      await tx.execute(sql`insert into app.enterprises(id,name,code,status) overriding system value
        values(${tenant},${tenant === eid ? '微云 R6 合成验收' : 'R6 合成对照'},${'r6-synthetic-' + tenant},'active')`);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
        values(${tenant},true,200,12000000,1000000000,30,${json(config)}::jsonb)`);
    }
    return { ...identity, migration };
  });
  if (upstream) await savePlatformLlmConfig({ enabled: true, providerKey: upstream.providerKey, baseUrl: upstream.baseUrl, model, apiKey: upstream.apiKey });
  return db;
}

async function fixture(name: string, tenant = eid) {
  const tag = 'R6 合成 ' + label + ' ' + name;
  const { uid, lead, staff } = await withPlatformTransaction(async tx => {
    const uid = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${tag},1) returning id`))!.id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${'r6-' + randomUUID()})`);
    const lead = String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
      values(${tenant},${uid},${tag},'13800000000','natural') returning id`))!.id);
    const staff = [];
    for (const role of ['enterprise_admin','designer','construction_staff']) {
      const admin = await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,menu_permissions,display_name)
        values(${tenant},${'r6-' + randomUUID()},'unusable-synthetic',${role},'active',false,
          ${role === 'enterprise_admin' ? sql`array['assistant-knowledge']` : sql`array[]::text[]`},${tag + ' ' + role}) returning id`);
      staff.push({ enterpriseId: tenant, adminId: String(admin!.id) });
    }
    return { uid, lead, staff };
  });
  const [bossActor, designerActor, workerActor] = staff;
  const construction = new ConstructionService(bossActor);
  const pid = String((await construction.execute('create', { leadId: lead, name: tag, managerId: bossActor.adminId,
    rooms: i6Dialogue || i67Dialogue || i6ProjectStatus ? ['卫生间', '厨房', '主卧'] : ['卫生间', '厨房'] }, randomUUID())).id);
  const change = async (action: string, values: Row) => {
    const p = (await construction.execute('detail', { projectId: pid })).project as Row;
    return construction.execute(action, { projectId: pid, expectedVersion: Number(p.version), ...values }, randomUUID());
  };
  await change('update', { name: tag, status: 'active', customerAccess: true });
  await change('member', { adminId: designerActor.adminId, role: 'designer', active: true });
  await change('member', { adminId: workerActor.adminId, role: 'worker', active: true });
  await change('progress', { stageKey: 'utilities', note: '团队正在做用水管路，卫生间防水和后续检查待排班。', sendReminder: false });
  const boss = new SiteChatService(bossActor), designer = new SiteChatService(designerActor), worker = new SiteChatService(workerActor);
  const room = Object.fromEntries(((await boss.read(pid)).rooms as Row[]).map(item => [String(item.name), String(item.id)]));
  const actor: ActorContext = { enterpriseId: tenant, principal: { kind: 'user', userId: uid }, contextVersion: 1,
    capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: lead } };
  const chat = new ConversationService(actor), cid = String((await chat.create(randomUUID())).id);
  const token = await signMiniProgramToken({ sub: uid, id: uid, mode: 'customer', role: 'user', contextVersion: 1, source: 'wechat' });
  return { tenant, uid, tag, boss, designer, worker, change, pid, room, actor, chat, cid, token, kb: new KnowledgeService(bossActor) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Draft = { documentId: string; versionId: string; expectedVersion: number; expectedEditVersion: number };

async function finishKnowledge(kb: KnowledgeService, jobId: string) {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const lease = await claimKnowledgeJob();
    if (lease) {
      assert.equal(lease.jobId, jobId);
      await runKnowledgeJob(lease);
    }
    const job = await kb.execute('job', { jobId });
    if (job.status === 'succeeded') return;
    assert.equal(job.status, 'queued', json({ status: job.status, error: job.last_error, attempts: job.attempts }));
    if (mock) await withTenantTransaction(kb.actor.enterpriseId, tx => tx.execute(sql`update app.assistant_jobs set available_at=now()
      where enterprise_id=${kb.actor.enterpriseId} and id=${jobId} and status='queued'`));
    else if (!localKnowledge) await delay(4200);
  }
  assert.fail('knowledge indexing did not finish');
}

async function publishStandard(f: Fixture, audience = 'customer_public', projectId: string | null = f.pid) {
  const created = await f.kb.execute('createFile', { title: standard.title + ' · R6 合成',
    audience, ...(projectId ? { projectId } : {}), category: '施工标准', fileName: 'r6-ppt-craft-18.md',
    fileBase64: Buffer.from('# PPT 第18页\n\n' + standard.body).toString('base64'), authorization: 'R6 隔离验收 PPT 已核摘录' }, randomUUID());
  const doc = created.document as Row, draft = created.draft as Row;
  const version = { documentId: String(doc.id), versionId: String(draft.id), expectedVersion: Number(doc.version),
    expectedEditVersion: Number(draft.edit_version) };
  await finishKnowledge(f.kb, String(created.jobId));
  const detail = await f.kb.execute('detail', version);
  const parsed = (detail.versions as Row[]).find(item => String(item.id) === version.versionId)!;
  const reviewed = await f.kb.execute('reviewFile', { ...version, expectedEditVersion: Number(parsed.edit_version), acknowledgeWarnings: true,
    excludedBlockIds: [] }, randomUUID());
  version.expectedEditVersion = Number(reviewed.edit_version);
  return publishVersion(f, version);
}

async function publishVersion(f: Fixture, version: Draft) {
  const queued = await f.kb.execute('index', version, randomUUID());
  await finishKnowledge(f.kb, String(queued.jobId));
  const published = await f.kb.execute('publish', version, randomUUID());
  return { ...version, expectedVersion: Number(published.version) };
}

const assistant = (f: Fixture, path: string[], body?: Row, key = randomUUID(), query = '') => assistantHttp(new Request(
  'http://127.0.0.1/api/miniprogram/assistant/' + path.join('/') + query, { method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + f.token, 'Idempotency-Key': key, 'Content-Type': 'application/json' },
    ...(body ? { body: json(body) } : {}) }), path);
async function read(f: Fixture, cid = f.cid) {
  const response = await assistant(f, ['conversations', cid, 'long-term']);
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()).data as { memories: Row[]; delegations: Row[]; notices: Row[] };
}
async function send(f: Fixture, text: string, cid = f.cid, key = randomUUID()) {
  const response = await assistant(f, ['conversations', cid, 'messages'], { clientMessageId: key, content: block(text) }, key);
  assert.equal(response.status, 202, await response.clone().text());
  return (await response.json()).data as Row;
}
const outputOf = (name: string, args: object): ModelTurnOutput => ({
  text: '', toolCalls: [{ id: 'r6-' + randomUUID(), name, arguments: json(args) }], finishReason: 'tool_calls',
  providerRequestId: null, usage: { inputTokens: 30, outputTokens: 10 },
});
async function turn(f: Fixture, text: string, cid = f.cid) {
  const key = randomUUID();
  const sent = await send(f, text, cid, key);
  if (durableAcceptance && text === delegation) assert.deepEqual(await send(f, text, cid, key), sent);
  assert.ok(sent.runId, json(sent));
  const lease = await claimJob();
  assert.equal(lease?.runId, sent.runId);
  if (liveModel) await processAnswer(lease!);
  else await processAgentAnswer(lease!, { model: async (messages, tools, step, actual) => {
    const offered = actual ?? tools;
    if (text === i6Journeys.C[0] || text === i6Journeys.C[1]) {
      if (step === 0) {
        const read = offered.find(tool => tool.name === 'query_business');
        assert.deepEqual((read?.parameters.properties as Row)?.domain, { type: 'string', enum: ['construction'] });
        return outputOf('query_business', { domain: 'construction', ...(text === i6Journeys.C[1] ? { room: '主卧' } : {}) });
      }
      const packet = messages.findLast(message => message.role === 'tool');
      assert.ok(packet?.role === 'tool');
      return outputOf('final_response', { kind: 'business', resultKey: JSON.parse(packet.content).resultKey });
    }
    if (step === 0 && text === question) return outputOf('knowledge_search', { query: '卫生间防水施工和后续检查' });
    if (step === 0 && text === preference) return outputOf('manage_long_term_memory', { action: 'remember', category: 'preference',
      topic: '沟通方式', quote: preference, value: '先告诉我结论，再说细节' });
    if (step === 0 && text === delegation) {
      if (durableAcceptance) {
        const context = messages.flatMap(message => message.role === 'system'
          ? message.content.flatMap(part => part.type === 'text' ? [part.text] : []) : []).join('\n');
        assert.ok(context.includes(f.tag) && context.includes('卫生间') && context.includes('utilities'),
          'The delegation turn must see the authorized project, room and construction stage');
      }
      return outputOf('start_delegation', { kind: 'rectification_review', room: '卫生间', subject, quote: delegation });
    }
    const sources = messages.flatMap(message => message.role === 'tool'
      ? (JSON.parse(message.content).synthesisSources ?? []) as { kind: string; text: string; citationOptions?: { citationId: string }[] }[] : []);
    const source = sources.find(item => item.kind === 'knowledge' && item.text.includes('项目团队安排'));
    if (text === question) {
      assert.ok(source?.citationOptions?.[0], 'The model substitute did not receive authorized original text');
      return outputOf('final_response', { kind: 'knowledge_explanation', segments: [
        { basis: 'evidence', text: '企业工艺资料说明，卫生间防水和后续检查由项目团队安排。', citations: [source.citationOptions[0]] },
        { basis: 'uncertainty', text: '资料未列出防水前的准备清单，请团队核对水路进展和具体要求。', citations: [] },
      ] });
    }
    assert.ok(offered.some(tool => tool.name === 'final_response'));
    return outputOf('final_response', { kind: 'general', text: text === recall ? '你希望先听结论，再说细节。'
      : text === preference ? '记下了。以后先说结论，再说细节。' : '已登记卫生间水管根部处理，等待项目团队提交资料和复核。' });
  } });
  const ledger = await withTenantTransaction(f.tenant, async tx => ({
    run: await one(tx, sql`select status,output_message_id::text,error_code from app.assistant_runs where enterprise_id=${f.tenant} and id=${String(sent.runId)}`),
    steps: await rows(tx, sql`select kind,capability_name,status,input_summary,private_checkpoint,source_refs from app.assistant_run_steps
      where enterprise_id=${f.tenant} and run_id=${String(sent.runId)} order by step_seq`),
    attempts: await rows(tx, sql`select id::text,status,accepted,error_code,remote_model,metadata from app.ai_provider_attempts
      where enterprise_id=${f.tenant} and assistant_run_id=${String(sent.runId)} order by id`),
    usage: await rows(tx, sql`select category,quantity,measurement_kind,input_tokens,output_tokens,cost_micros from app.assistant_usage_records
      where enterprise_id=${f.tenant} and run_id=${String(sent.runId)} order by id`),
  }));
  const messages = (await f.chat.messages(cid, undefined, 100)).items as Row[];
  const answer = messages.find(message => message.id === ledger.run?.output_message_id);
  save('turn-' + String(sent.runId), { cid, text, sent, answer, ...ledger });
  if (liveModel) {
    assert.ok(ledger.attempts.length > 0, 'The expected provider was not reached');
    for (const attempt of ledger.attempts) {
      assert.equal(attempt.remote_model, model);
      if (attempt.status === 'succeeded') {
        const response = (attempt.metadata as Row)?.assistantResponse as Row | undefined;
        assert.equal(response?.providerModel, model);
        assert.ok(response?.providerRequestId && response?.usage);
      }
    }
  }
  assert.equal(ledger.run?.status, 'succeeded', json(ledger.run));
  assert.ok(answer?.available, 'Saved answer unavailable');
  return { sent, answer, ledger };
}

const i6Journeys = {
  A: ['卫生间水管根部为什么需要单独处理？', '处理完以后，什么情况下才可以做防水？', '防水做完以后，满足什么条件才能继续铺砖？'],
  B: ['我们公司卫生间防水标准是什么？', '这个和国家通用要求有什么区别？'],
  C: ['我家现在水电做到哪一步了？', '主卧的水管问题解决了吗？'],
  D: ['这个插座位置是不是需要设计师确认？', '麻烦帮我跟进主卧床头插座位置，让设计师核对一下。'],
  E: ['厨房的水管根部处理完以后，什么时候可以做防水？', '刚才说的是卫生间，不是厨房。'],
  memory: [preference, recall],
} as const;

// Assertions live in the acceptance driver. Each input is the customer's
// actual question and contains no tool instructions or expected facts.
const i67Journeys = {
  A: ['卫生间水管根部为什么要单独处理？', '处理后什么时候可以做防水？', '防水完成后什么条件满足才能铺砖？'],
  B: ['你们公司的卫生间防水一般怎么安排？和国家通用要求有哪些差别？'],
  C: ['《建筑与市政工程防水通用规范》现在还有效吗？什么时候实施，像我家这种旧房翻修也都适用吗？'],
  D: ['我想问下厨房管根处理完后，怎么知道可以做防水了？', '刚才说的是卫生间，不是厨房。'],
  E: ['那我家主卧的水管现在做到哪一步？'],
  F: ['你们公司自己的资料里，有没有写卫生间闭水要多久、防水要刷多高？'],
  memory: [preference, recall],
} as const;

async function i67Conversations(f: Fixture, version: Draft) {
  const master = await capture(f, '主卧', false);
  const kitchen = await capture(f, '厨房', true);
  await publishRecord(f, master.id);
  await publishRecord(f, kitchen.id);
  const selected = process.argv.find(arg => arg.startsWith('--scenes='))?.slice(9).split(',') ?? Object.keys(i67Journeys);
  assert.ok(selected.length && selected.every(scene => Object.hasOwn(i67Journeys, scene)));
  const results: Row[] = [];
  let stop = false;
  for (const [scene, inputs] of Object.entries(i67Journeys)) {
    if (!selected.includes(scene)) continue;
    // The project follow-up continues the corrected room conversation.
    let cid = scene === 'E' ? String(results.find(row => row.scene === 'D')?.cid ?? '') : '';
    if (!cid) cid = String((await f.chat.create(randomUUID())).id);
    const turns: Row[] = [];
    results.push({ scene, cid, turns });
    for (const [index, question] of inputs.entries()) {
      const current = scene === 'memory' && index === 1 ? String((await f.chat.create(randomUUID())).id) : cid;
      if (stop) { turns.push({ question, cid: current, status: 'not_run' }); continue; }
      try {
        const result = await turn(f, question, current);
        const text = safeText(result.answer.content as MessageContent);
        const checked = await f.chat.messages(current, undefined, 100);
        assert.ok(checked.items.some(row => row.id === result.answer.id && row.available));
        if (scene !== 'memory') assert.equal((await read(f, current)).delegations.length, 0);
        if (scene === 'D' && index === 1) assert.doesNotMatch(text, /请.{0,12}确认.{0,12}房间|是厨房还是卫生间/u);
        if (scene === 'E') {
          assert.match(text, /主卧/u);
          assert.doesNotMatch(text, /厨房|水管根部已完成/u);
          assert.ok(result.ledger.steps.some(step => JSON.stringify(step.private_checkpoint).includes('待核对')));
        }
        if (scene === 'F') assert.match(text, /没有|未(?:写|提|明确|找到)|无法(?:确认|核实)/u);
        if (scene === 'memory' && index === 1) assert.ok((await read(f, current)).memories.some(item => item.category === 'preference'));
        turns.push({ question, expected: i67Receipt(scene, index), cid: current, runId: result.sent.runId, status: 'saved_for_semantic_review', text });
      } catch (error) {
        const last = await f.chat.detail(current);
        const status = last.latestRun?.status === 'indeterminate' ? 'unknown' : 'failed';
        turns.push({ question, expected: i67Receipt(scene, index), cid: current, runId: last.latestRun?.id ?? null, status, error: String(error) });
        stop = true;
      }
    }
  }
  save('fixed-conversations', { results, fixture: { ownerId: f.uid, projectId: f.pid, masterRecordId: master.id, kitchenRecordId: kitchen.id },
    knowledge: version, provider: providerKey, logicalModel, model, actualCost: 'unavailable' });
  if (stop) process.exitCode = 1;
}

async function i6Conversations(f: Fixture, version: Draft) {
  const master = await capture(f, '主卧', false);
  await publishRecord(f, master.id);
  const otherRoom = await capture(f, '厨房', true);
  await publishRecord(f, otherRoom.id);
  const selected = process.argv.find(arg => arg.startsWith('--scenes='))?.slice(9).split(',') ?? Object.keys(i6Journeys);
  assert.ok(selected.length && selected.every(scene => Object.hasOwn(i6Journeys, scene)));
  const results: Row[] = [];
  for (const [scene, inputs] of Object.entries(i6Journeys)) {
    if (!selected.includes(scene)) continue;
    const cid = String((await f.chat.create(randomUUID())).id);
    const sceneResults = inputs.map(input => ({ input, result: 'not_run', cid, runId: null as string | null }));
    if (scene === 'D') {
      const pending = await send(f, '共享主卧需求：我想调整主卧床头插座位置，请项目团队看看。', cid);
      assert.equal(pending.runId, null);
      save('scene-d-fixture', { cid, sourceMessageId: pending.messageId });
    }
    for (const [index, input] of inputs.entries()) {
      const conversationId = scene === 'memory' && index === 1 ? String((await f.chat.create(randomUUID())).id) : cid;
      const row = sceneResults[index];
      row.cid = conversationId;
      try {
        const result = await turn(f, input, conversationId);
        row.runId = String(result.sent.runId);
        row.result = 'saved_for_semantic_review';
        if (scene === 'E') assert.equal((await read(f, conversationId)).memories.length, 0);
        if (scene === 'D' && index === 1) {
          await tick();
          const task = (await read(f, conversationId)).delegations.find(item => String(item.title).includes('主卧'));
          assert.ok(task && ['waiting_for_designer', 'waiting_for_authorization'].includes(String(task.status)), json(task));
        }
        if (scene === 'memory' && index === 1) {
          assert.ok((await read(f, conversationId)).memories.some(item => item.category === 'preference'
            && item.sourceConversationId === cid));
        }
      } catch (error) {
        const last = await f.chat.detail(conversationId);
        row.runId = last.latestRun?.id == null ? null : String(last.latestRun.id);
        row.result = last.latestRun?.status === 'indeterminate' ? 'unknown' : 'failed';
        console.error('I6', scene, index + 1, row.result, String(error));
        if (scene !== 'E' || row.result === 'unknown') break;
      }
    }
    results.push({ scene, turns: sceneResults });
    console.log('I6', scene, sceneResults.map(row => row.result).join(','));
  }
  save('fixed-conversations', { results, knownProject: { id: f.pid, masterRecordId: master.id, otherRoomRecordId: otherRoom.id, rooms: f.room },
    ownerId: f.uid, knowledge: version, actualCost: 'unavailable' });
  if (results.some(result => (result.turns as { result: string }[]).some(row => row.result !== 'saved_for_semantic_review')))
    process.exitCode = 1;
}

async function projectStatusFixture(f: Fixture) {
  const master = await capture(f, '主卧', false);
  await publishRecord(f, master.id);
  const kitchen = await capture(f, '厨房', true);
  await publishRecord(f, kitchen.id);
  const first = await turn(f, i6Journeys.C[0]);
  assert.match(safeText(first.answer.content as MessageContent), /团队正在做用水管路/);
  const second = await turn(f, i6Journeys.C[1]);
  const answer = safeText(second.answer.content as MessageContent);
  assert.match(answer, /主卧.*水管根部|水管根部.*待核对/u);
  assert.doesNotMatch(answer, /厨房|水管根部已完成/u);
  assert.ok((await f.chat.messages(f.cid)).items.some(item => item.id === second.answer.id && item.available));
  const page = await f.boss.read(f.pid);
  await f.boss.mutate(f.pid, master.id, 'withdraw', {
    expectedVersion: ((page.versions as Row).records as Row)[master.id], reason: 'I6 隔离验收撤回主卧记录',
  }, randomUUID());
  const history = await f.chat.messages(f.cid);
  assert.ok(history.items.some(item => item.id === first.answer.id && item.available));
  assert.ok(history.items.some(item => item.id === second.answer.id && !item.available));
  const missing = await turn(f, i6Journeys.C[1]);
  assert.match(safeText(missing.answer.content as MessageContent), /未查到「主卧」已向你发布的现场记录/);
}

async function interruptedOwnerTurn(f: Fixture) {
  const text = '卫生间门口的止水处理，麻烦你帮我跟进。';
  const key = randomUUID(), sent = await send(f, text, f.cid, key);
  const first = await claimJob({ enterpriseId: f.tenant, runId: String(sent.runId) });
  assert.ok(first);
  const expire = (token: string) => withTenantTransaction(f.tenant, tx => tx.execute(sql`update app.assistant_jobs
    set lease_expires_at=clock_timestamp()-interval '1 second' where enterprise_id=${f.tenant} and id=${first.jobId}
    and lease_token=${token}`));
  await expire(first.token);
  const resumed = await claimJob({ enterpriseId: f.tenant, runId: first.runId });
  assert.ok(resumed && resumed.token !== first.token);
  await assert.rejects(withTenantTransaction(f.tenant, tx => runContext(tx, first)), /context_changed/);
  let calls = 0;
  await processAgentAnswer(resumed, { model: async () => {
    calls++;
    throw new AiProviderError('Synthetic response lost after dispatch', 'PROVIDER_TIMEOUT', 'unknown');
  } });
  assert.equal(calls, 1);
  assert.equal(await claimJob({ enterpriseId: f.tenant, runId: first.runId }), null);
  assert.deepEqual(await send(f, text, f.cid, key), sent);
  const state = await withTenantTransaction(f.tenant, tx => one(tx, sql`select r.status,r.error_code,r.output_message_id,q.status as reservation,
    (select count(*)::int from app.native_workflow_delegations where enterprise_id=r.enterprise_id and origin_message_id=r.trigger_message_id) as delegations
    from app.assistant_runs r join app.assistant_quota_reservations q on q.enterprise_id=r.enterprise_id and q.run_id=r.id
    where r.enterprise_id=${f.tenant} and r.id=${first.runId}`));
  assert.deepEqual(state, { status: 'indeterminate', error_code: 'provider_outcome_unknown',
    output_message_id: null, reservation: 'reconciling', delegations: 0 });
  save('interrupted-owner-turn', { runId: first.runId, calls, state });
}

async function tick() {
  const result = await runDelegationTick();
  assert.deepEqual([result.errors, result.retry_wait, result.dead], [0, 0, 0], json(result));
  return result;
}
async function capture(f: Fixture, room: string, completed: boolean) {
  const mediaId = completed ? String((await f.worker.upload(f.pid, randomUUID(), await mediaBytes())).id) : null;
  const note = room + (completed ? '水管根部已经处理，照片附上。' : '水管根部还待处理，请团队核对。');
  const key = randomUUID();
  const body = { text: note, mediaIds: mediaId ? [mediaId] : [], capture: { kind: 'free' } };
  const sent = await f.worker.send(f.pid, body, key);
  assert.deepEqual(await f.worker.send(f.pid, body, key), sent);
  const lease = await claimJob();
  assert.equal(lease?.runId, sent.runId);
  await processSiteRecord(lease!, async () => ({ ...outputOf('unused', {}), toolCalls: [], finishReason: 'stop',
    text: json({ title: room + subject, roomId: f.room[room], completed: completed ? subject + '已完成' : '',
      pending: completed ? '' : subject + '待核对', coordination: '', note }) }));
  return { id: String(sent.recordId), mediaId, messageId: sent.messageId };
}
const siteSay = async (f: Fixture, site: SiteChatService, text: string, mediaIds: string[] = []) =>
  site.send(f.pid, { text, mediaIds, versions: (await site.read(f.pid)).versions }, randomUUID());
async function publishRecord(f: Fixture, recordId: string) {
  const page = await f.boss.read(f.pid);
  return f.boss.mutate(f.pid, recordId, 'publish', {
    expectedVersion: ((page.versions as Row).records as Row)[recordId], audience: 'customer',
  }, randomUUID());
}
const task = async (f: Fixture) => {
  const selected = (await read(f)).delegations.find(item => String(item.title).includes('卫生间'));
  assert.ok(selected, 'No bathroom delegation in the original consultation');
  return selected;
};

async function conversation(f: Fixture, version: Draft, round: number) {
  let citationId = '';
  const keepIndependentLiveChecks = liveModel && !hosted;
  await check('C01 授权工艺引用与实际阶段 #' + round, async () => {
    const answer = await turn(f, question);
    const citation = (answer.answer.citations as Row[]).find(item =>
      item.available && item.version === version.versionId && item.sourceLocation && /防水施工和后续检查|项目团队安排/u.test(String(item.quote)));
    assert.ok(citation?.id, 'No authorized current PPT source in saved C01 reply ' + answer.sent.runId);
    citationId = String(citation.id);
    const original = await assistant(f, ['citations', citationId]);
    assert.equal(original.status, 200);
    assert.equal((await original.json()).data.available, true);
    assert.ok(answer.ledger.steps.some(row => String((row.input_summary as Row | null)?.tool).startsWith('knowledge_')));
    assert.ok(answer.ledger.steps.some(row => row.kind === 'agent_long_term_context'
      && (row.source_refs as Row)?.projectId === f.pid && (row.source_refs as Row)?.projectHash));
    const explanation = safeText(answer.answer.content as MessageContent);
    assert.match(explanation, /一般建议|通用|未列|没有|没查|未查|尚未|未说明|没写|未写|具体.{0,16}(核实|确认)/u);
  }, keepIndependentLiveChecks);
  await check('C01 私有偏好跨会话 #' + round, async () => {
    await turn(f, preference);
    const other = String((await f.chat.create(randomUUID())).id);
    const recalled = await turn(f, recall, other);
    const memory = (await read(f, other)).memories.find(item => item.category === 'preference');
    assert.equal(memory?.sourceConversationId, f.cid);
    assert.match(safeText(recalled.answer.content as MessageContent), /结论.{0,26}细节/u);
    assert.ok(recalled.ledger.steps.some(row => row.kind === 'agent_long_term_context' && row.status === 'succeeded'));
  }, keepIndependentLiveChecks);
  await check('C01 自然语言创建待复核委托 #' + round, async () => {
    const created = await turn(f, delegation);
    await tick();
    const saved = await task(f);
    assert.equal(saved.status, 'waiting_for_authorization');
    const row = await withTenantTransaction(f.tenant, tx => one(tx, sql`select scope,origin_message_id::text,conversation_id::text,project_id::text
      from app.native_workflow_delegations where enterprise_id=${f.tenant} and id=${String(saved.id)}`));
    assert.equal(row?.origin_message_id, created.sent.messageId);
    assert.equal(row?.conversation_id, f.cid);
    assert.equal(row?.project_id, f.pid);
    assert.equal((row?.scope as Row).kind, 'rectification_review');
    assert.equal((row?.scope as Row).roomId, f.room['卫生间']);
    if (durableAcceptance) {
      assert.ok(created.ledger.steps.some(step => step.kind === 'agent_long_term_context' && (step.source_refs as Row)?.projectHash));
      assert.equal(created.ledger.steps.filter(step => step.kind === 'agent_model').length, 1);
      assert.match(safeText(created.answer.content as MessageContent), /已登记跟进/);
    }
    assert.doesNotMatch(safeText(created.answer.content as MessageContent), /已验收|已复核|验收合格/u);
  }, keepIndependentLiveChecks);
  return citationId;
}

async function business(f: Fixture, v1: Draft, originalCitation: string) {
  const alternate = await fixture('同租户另一工地');
  const foreign = await fixture('跨租户工地', control);
  let issue = '', plan = '', evidenceRecord = '', publishedVersion = 0, mediaId = '', grantId = '';
  const command = (site: SiteChatService, text: string, media: string[] = []) => siteSay(f, site, text, media);
  const lookup = async (actor: ActorContext, cid: string) => {
    const epoch = await withTenantTransaction(actor.enterpriseId, async tx =>
      Number((await one(tx, sql`select knowledge_epoch from app.assistant_enterprise_settings where enterprise_id=${actor.enterpriseId}`))!.knowledge_epoch));
    return retrieveKnowledge(cid, actor, '卫生间防水施工和后续检查', epoch, undefined, undefined, 'ranked', { mode: 'hybrid' });
  };
  if (localKnowledge) await check('知识关闭与托管未配置是不同状态', async () => {
    const settings = await withTenantTransaction(eid, tx => one(tx, sql`select agent_config from app.assistant_enterprise_settings where enterprise_id=${eid}`));
    assert.ok(settings);
    const setKnowledge = (enabled: boolean) => withTenantTransaction(eid, tx => tx.execute(sql`update app.assistant_enterprise_settings
      set agent_config=jsonb_set(agent_config,'{enterpriseKnowledgeEnabled}',to_jsonb(${enabled}::boolean)) where enterprise_id=${eid}`));
    try {
      await setKnowledge(false);
      await assert.rejects(lookup(f.actor, f.cid), /enterprise_knowledge_disabled/);
    } finally { await setKnowledge(true); }
    const saved = {
      mode: process.env.ASSISTANT_KNOWLEDGE_PROVIDER,
      workspace: process.env.ASSISTANT_BAILIAN_RAG_WORKSPACE_ID,
      key: process.env.ASSISTANT_BAILIAN_RAG_API_KEY,
    };
    try {
      process.env.ASSISTANT_KNOWLEDGE_PROVIDER = 'bailian';
      delete process.env.ASSISTANT_BAILIAN_RAG_WORKSPACE_ID;
      delete process.env.ASSISTANT_BAILIAN_RAG_API_KEY;
      await assert.rejects(lookup(f.actor, f.cid), error => error instanceof BailianKnowledgeError
        && error.code === 'retrieval_unavailable' && error.providerCode === 'bailian_knowledge_not_configured'
        && error.outcomeKnown && error.requestId === null);
    } finally {
      const original = { ASSISTANT_KNOWLEDGE_PROVIDER: saved.mode, ASSISTANT_BAILIAN_RAG_WORKSPACE_ID: saved.workspace,
        ASSISTANT_BAILIAN_RAG_API_KEY: saved.key };
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
  if (i6ProjectStatus) await check('业主进度、房间记录隔离及撤回重进', async () => {
    assert.ok(!liveModel && localKnowledge);
    await projectStatusFixture(await fixture('I6 获权项目进度'));
  });
  const document = await publishStandard(f, 'staff_internal');
  await publishStandard(foreign);
  if (durableAcceptance) await check('同项目另开咨询保留各自原指令和回执', async () => {
    const separate = String((await f.chat.create(randomUUID())).id);
    const created = await turn(f, delegation, separate);
    const createdTask = await withTenantTransaction(f.tenant, tx => one(tx, sql`select id::text,origin_message_id::text
      from app.native_workflow_delegations where enterprise_id=${f.tenant} and conversation_id=${separate}`));
    assert.equal(createdTask?.origin_message_id, created.sent.messageId);
    assert.notEqual(createdTask?.id, (await task(f)).id);
    assert.match(safeText(created.answer.content as MessageContent), /已登记跟进/);
    await send(f, '取消当前委托', separate);
    const persisted = await withTenantTransaction(f.tenant, tx => one(tx, sql`select current_status
      from app.native_workflow_delegations where enterprise_id=${f.tenant} and id=${String(createdTask?.id)}`));
    assert.equal(persisted?.current_status, 'cancelled');
  });
  await check('业主、设计师、施工人员、老板的项目和知识权限', async () => {
    assert.equal((await assistant(alternate, ['conversations', f.cid, 'long-term'])).status, 404);
    assert.equal((await assistant(foreign, ['citations', originalCitation])).status, 404);
    const denied = await lookup(alternate.actor, alternate.cid);
    assert.deepEqual(denied.evidence, []);
    const owner = await lookup(f.actor, f.cid);
    assert.ok(owner.evidence.length && owner.evidence.every(source => source.ref.version === v1.versionId
      && source.knowledge?.projectId === f.pid && !!source.file?.label));
    if (localKnowledge) assert.ok(owner.diagnostic.embeddingUsage?.inputTokens);
    const roleSources: Row[] = [];
    for (const site of [f.designer, f.worker, f.boss]) {
      const page = await site.read(f.pid);
      const hits = await lookup(site.actor, String(page.conversationId));
      assert.ok(hits.evidence.some(source => source.ref.version === document.versionId));
      assert.ok(hits.evidence.every(source => source.knowledge?.projectId === f.pid));
      roleSources.push({ actor: site.actor.principal, ...hits });
      assert.doesNotMatch(json(page), /先告诉我结论，再说细节/);
    }
    const hiddenProject = (error: unknown) => error instanceof AssistantError && error.status === 404;
    await assert.rejects(f.designer.read(alternate.pid), hiddenProject);
    await assert.rejects(f.worker.read(alternate.pid), hiddenProject);
    await assert.rejects(f.boss.read(foreign.pid), hiddenProject);
    await assert.rejects(new KnowledgeService(f.worker.staff).execute('retire', v1, randomUUID()), /assistant_capability_forbidden/);
    save('retrieval-scopes', { owner, denied, roleSources, mode: localKnowledge ? 'local-real' : hosted ? 'hosted-real' : 'hosted-substitute' });
  });
  if (durableAcceptance) await check('撤权设计师和工人无法读取或写入原工地', async () => {
    const denied = (error: unknown) => error instanceof AssistantError && [403, 404].includes(error.status);
    for (const [site, role, text, capture] of [
      [f.designer, 'designer', '请安排复核卫生间', undefined],
      [f.worker, 'worker', '卫生间水管根部处理已回传', { kind: 'free' }],
    ] as const) {
      const versions = (await site.read(f.pid)).versions;
      await f.change('member', { adminId: site.staff.adminId, role, active: false });
      try {
        await assert.rejects(site.read(f.pid), denied);
        await assert.rejects(site.send(f.pid, { text, mediaIds: [], versions, ...(capture ? { capture } : {}) }, randomUUID()), denied);
      } finally {
        await f.change('member', { adminId: site.staff.adminId, role, active: true });
      }
    }
  }, true);
  await check('原咨询明确共享、现场事项创建、设计师接手和计划发布', async () => {
    const shared = await send(f, '共享卫生间需求：希望项目团队核对水管根部处理，完成后告诉我。');
    assert.equal(shared.runId, null, json(shared));
    if (durableAcceptance) {
      const grant = await withTenantTransaction(f.tenant, tx => one(tx, sql`select id::text from app.domain_event_outbox
        where enterprise_id=${f.tenant} and type='construction.material.shared.v1'
        and payload->>'conversationId'=${f.cid} and payload->>'projectId'=${f.pid} order by id desc limit 1`));
      assert.ok(grant?.id);
      grantId = String(grant.id);
    }
    const source = await capture(f, '卫生间', false);
    issue = String((await command(f.boss, '跟进记录' + source.id + '：核对卫生间水管根部处理')).issueId);
    assert.match(issue, /^[1-9]\d*$/);
    const oldVersions = durableAcceptance ? (await f.designer.read(f.pid)).versions : null;
    await command(f.designer, '接手事项' + issue);
    if (oldVersions) await assert.rejects(() => f.designer.send(f.pid, {
      text: '回复事项' + issue + '：旧版意见', mediaIds: [], versions: oldVersions,
    }, randomUUID()), /version_conflict/);
    await command(f.designer, '回复事项' + issue + '：等待现场处理并由团队检查。');
    const image = String((await f.designer.upload(f.pid, randomUUID(), await mediaBytes())).id);
    plan = String((await command(f.designer, '发布方案事项' + issue
      + '\n标题：卫生间水管根部处理安排\n差异：记录处理情况并由现场团队复核\n费用变化：0元\n工期变化：0天', [image])).planId);
    assert.match(plan, /^[1-9]\d*$/);
    const customer = new PlanCustomerService(f.actor, f.cid);
    for (const action of ['preview', 'approve']) await customer.decide(plan, action, { expectedRevision: (await customer.read(plan)).revision }, randomUUID());
    await tick();
    const check = (await task(f)).standardCheck as Row;
    assert.equal(check.status, 'sources_found', json(check));
    assert.ok((check.sources as Row[]).some(item => item.version === v1.versionId));
  });
  await check('另一房间照片不触发，原话与本房间原件待人工复核', async () => {
    const wrong = await capture(f, '厨房', true);
    await publishRecord(f, wrong.id);
    await tick();
    assert.notEqual(((await task(f)).evidence as Row | null)?.id, wrong.id);
    const own = await capture(f, '卫生间', true);
    evidenceRecord = own.id;
    mediaId = own.mediaId!;
    await tick();
    assert.notEqual(((await task(f)).evidence as Row | null)?.id, own.id);
    const published = await publishRecord(f, own.id);
    publishedVersion = Number(published.version);
    await tick();
    const pending = await task(f);
    assert.equal(pending.waitingFor, 'reviewer', json(pending));
    assert.equal((pending.evidence as Row).id, own.id);
    assert.equal((pending.evidence as Row).issueId, issue);
    assert.equal((pending.evidence as Row).state, 'awaiting_link');
    const original = await withTenantTransaction(eid, tx => one(tx, sql`select m.content,a.media_id::text as media_id
      from app.construction_site_records r join app.assistant_messages m on m.enterprise_id=r.enterprise_id and m.id=r.source_message_id
      join app.construction_site_attachments a on a.enterprise_id=r.enterprise_id and a.project_id=r.project_id and a.record_id=r.id
      where r.enterprise_id=${eid} and r.id=${own.id} and r.room_id=${f.room['卫生间']}`));
    assert.equal(original?.media_id, mediaId);
    assert.equal(safeText(original?.content as MessageContent), '卫生间水管根部已经处理，照片附上。');
  });
  await check('授权人员落实及复核，结果回原咨询并能打开已授权原图', async () => {
    const implement = '落实事项' + issue + '方案' + plan + '记录' + evidenceRecord + '：已核对现场记录及照片。';
    const resolve = '解决事项' + issue + '\n结论：责任人已现场复核本事项的处理记录。'
      + '\n回传：卫生间水管根部处理已由项目团队现场复核。\n回传原件：是';
    await assert.rejects(command(f.worker, implement), /construction_forbidden/);
    await command(f.designer, implement);
    await tick();
    assert.equal((await task(f)).waitingFor, 'reviewer');
    await assert.rejects(command(f.worker, resolve), /construction_forbidden/);
    await command(f.boss, resolve);
    await tick();
    const finished = await task(f);
    assert.equal(finished.status, 'completed', json(finished));
    const resultId = String((finished.evidence as Row).messageId);
    const result = ((await f.chat.messages(f.cid, undefined, 100)).items as Row[]).find(item => item.id === resultId);
    assert.ok(result?.available && (result.siteRecords as Row[]).some(record => record.id === evidenceRecord));
    assert.match(safeText(result.content as MessageContent), /现场复核/);
    assert.match(safeText(result.content as MessageContent), /不代表工程验收通过/);
    const original = ['construction-records', evidenceRecord, 'media', mediaId];
    const media = await assistant(f, ['conversations', f.cid, ...original], undefined, undefined, '?version=' + publishedVersion);
    assert.equal(media.status, 200);
    assert.ok((await media.arrayBuffer()).byteLength > 0);
    const another = String((await f.chat.create(randomUUID())).id);
    assert.ok(((await f.chat.messages(another)).items as Row[]).every(item => item.id !== resultId));
    assert.equal((await assistant(alternate, ['conversations', f.cid, ...original], undefined, undefined, '?version=' + publishedVersion)).status, 404);
    save('formal-result', { result, finished, issue, plan, evidenceRecord, mediaId, publishedVersion });
  });
  await check('现行版本切换、撤回旧引用与后台失败恢复', async () => {
    const draft = await f.kb.execute('newVersion', { documentId: v1.documentId, fromVersionId: v1.versionId,
      expectedVersion: v1.expectedVersion }, randomUUID());
    const doc = (await f.kb.execute('detail', v1)).document as Row;
    const v2 = await publishVersion(f, { documentId: v1.documentId, versionId: String(draft.id), expectedEditVersion: Number(draft.edit_version),
      expectedVersion: Number(doc.version) });
    assert.equal(((await task(f)).standardCheck as Row).status, 'outdated');
    const current = await lookup(f.actor, f.cid);
    assert.ok(current.evidence.some(source => source.ref.version === v2.versionId)
      && current.evidence.every(source => source.ref.version !== v1.versionId));
    const old = await assistant(f, ['citations', originalCitation]);
    assert.equal(old.status, 200);
    assert.equal((await old.json()).data.available, false);
    await tick();
    await f.change('progress', { stageKey: 'utilities', note: '项目团队更新水路进展，正式复核结果已回传。', sendReminder: false });
    let attempted = false;
    const failure = await runDelegationTick({ observe: async (...args) => {
      if (!attempted && args[3].type === 'construction.project.changed.v1') {
        attempted = true;
        throw Error('delegation_fixture_failure');
      }
      return observeDelegation(...args);
    } });
    assert.ok(attempted && failure.retry_wait === 1 && failure.errors === 0, json(failure));
    const recovered = await runDelegationTick({ now: new Date(Date.now() + 3000) });
    assert.ok(recovered.delivered > 0 && recovered.dead === 0 && recovered.retry_wait === 0);
    assert.ok((((await task(f)).standardCheck as Row).sources as Row[]).some(source => source.version === v2.versionId));
    assert.equal((await tick()).applied, 0);
    await f.kb.execute('retire', v2, randomUUID());
    assert.equal(((await task(f)).standardCheck as Row).status, 'outdated');
    assert.deepEqual((await lookup(f.actor, f.cid)).evidence, []);
    await f.change('progress', { stageKey: 'utilities', note: '项目团队再次确认最新施工记录。', sendReminder: false });
    await tick();
    assert.equal(((await task(f)).standardCheck as Row).status, 'no_match');
    for (let i = 0; i < 20 && await processManagedKnowledgeCleanup(); i++) { /* isolated managed documents */ }
    save('version-recovery', { v1, v2, current, failure, recovered });
  });
  await check('暂停期间不触发，取消后不能激活旧任务', async () => {
    await turn(alternate, delegation);
    await tick();
    await send(alternate, '暂停当前委托');
    const paused = await task(alternate);
    const record = await capture(alternate, '卫生间', true);
    await publishRecord(alternate, record.id);
    await tick();
    assert.equal((await task(alternate)).status, 'paused');
    assert.equal((await task(alternate)).version, paused.version);
    await send(alternate, '取消当前委托');
    await send(alternate, '继续委托：卫生间');
    assert.equal((await task(alternate)).status, 'cancelled');
  });
  await check('八类真实 Outbox 事件、原记忆和工具回执可追溯', async () => {
    const receipts = await withTenantTransaction(eid, tx => rows(tx, sql`select e.id::text,e.type,d.status,d.attempts,t.outcome,t.receipt
      from app.domain_event_outbox e join app.domain_event_deliveries d on d.enterprise_id=e.enterprise_id and d.event_id=e.id
      left join app.native_workflow_delegation_events t on t.enterprise_id=e.enterprise_id and t.event_id=e.id
      where e.enterprise_id=${eid} and e.payload->>'projectId'=${f.pid} and d.consumer_key=${delegationConsumer} order by e.id`));
    save('outbox', receipts);
    for (const type of ['construction.record.captured.v1','construction.record.publish.v1','construction.plan.published.v1',
      'construction.site.issue.opened.v1','construction.site.issue.progress.v1','construction.site.issue.evidence.v1',
      'construction.site.issue.result.v1','construction.project.changed.v1']) {
      assert.ok(receipts.some(row => row.type === type && row.status === 'delivered' && (row.receipt as Row)?.tool === 'observe_delegation_sources'), type);
    }
    assert.ok(receipts.some(row => ((row.receipt as Row)?.memoryRefs as Row[])?.length));
    assert.ok(receipts.some(row => row.type === 'construction.project.changed.v1' && row.attempts === 2));
    const repeated = await tick();
    assert.deepEqual([repeated.delivered, repeated.applied], [0, 0]);
    if (durableAcceptance) {
      const durable = await withTenantTransaction(f.tenant, tx => rows(tx, sql`select t.id,t.status,t.state->'attempts' attempts,
        e.type,t.business_key,t.state->'data' data from app.native_workflow_durable_tasks t
        join app.domain_event_outbox e on e.enterprise_id=t.enterprise_id and e.id::text=t.business_key
        where t.enterprise_id=${f.tenant} and t.kind='delegation.delivery' and e.payload->>'projectId'=${f.pid}
        order by e.id`));
      assert.ok(durable.some(item => item.type === 'construction.site.issue.result.v1' && item.status === 'succeeded'));
      assert.ok(durable.some(item => item.type === 'construction.project.changed.v1' && (item.attempts as Row[]).length === 2));
      assert.ok(durable.every(item => item.status === 'succeeded' && (item.data as Row).eventId === item.business_key));
      save('durable-steps', durable);
    }
  });
  await check('业主在原咨询查看委托回执，撤销项目权限后隐藏并按当前来源恢复', async () => {
    const request = await send(f, '查看委托');
    assert.equal(request.runId, null);
    const messages = async () => (await f.chat.messages(f.cid, undefined, 100)).items as Row[];
    const saved = (await messages()).find(item => item.authorKind === 'system' && BigInt(String(item.id)) > BigInt(String(request.messageId)));
    assert.ok(saved?.available);
    assert.match(safeText(saved.content as MessageContent), /有权人员已复核并授权回传原事项结论/);
    const status = async () => (await messages()).find(item => item.id === saved.id);
    await f.change('update', { name: f.tag, status: 'active', customerAccess: false });
    try {
      const revoked = await status();
      assert.equal(revoked?.available, false);
      assert.doesNotMatch(JSON.stringify(revoked?.content), /水管根部处理/);
    } finally {
      await f.change('update', { name: f.tag, status: 'active', customerAccess: true });
    }
    assert.equal((await status())?.available, true);
    if (durableAcceptance) {
      const original = (await task(f)).evidence as Row;
      save('native-revocation-fixture', { cid: f.cid, grantId, resultId: original.messageId });
      if (!process.argv.includes('--native-revocation')) {
        await send(f, '撤回共享资料' + grantId);
        await tick();
        assert.equal((await task(f)).status, 'waiting_for_authorization');
        assert.equal((await messages()).find(item => item.id === original.messageId)?.available, false);
      }
    }
  });
  save('native-fixture', { cid: f.cid, ownerId: f.uid, projectId: f.pid, evidenceRecord, mediaId });
}

async function main() {
  assert.ok(!(hosted && localKnowledge));
  if (durableAcceptance) {
    assert.ok(!liveModel && !hosted);
    assert.equal(process.env.NATIVE_WORKFLOW_TASK_STORE, 'postgres');
  }
  const before = binding();
  const mode = hosted ? 'bailian-hosted' : liveModel ? 'bailian-responses-with-local-retrieval'
    : localKnowledge ? 'postgresql-with-local-retrieval-and-model-substitute' : 'postgresql-with-rag-and-model-substitutes';
  const report: Row = { mode, model: liveModel ? model : 'substitute', ...(liveModel ? { provider: providerKey, logicalModel } : {}),
    before, pptSource: ppt.source, checks };
  const restore = mock?.install();
  try {
    if (hosted) {
      try {
        const result = await new BailianKnowledgeProvider().listIndices();
        report.hostedPreflight = { status: 'configured', requestId: result.requestId, libraryCount: result.value.length };
      } catch (error) {
        if (!(error instanceof AssistantError) || error.code !== 'bailian_knowledge_not_configured') throw error;
        report.hostedPreflight = { status: 'retrieval_unavailable', reason: error.code, requestId: null };
        process.exitCode = 1;
        return;
      }
    }
    report.database = await configure();
    if (i67Dialogue || i6Dialogue) {
      assert.ok(liveModel && localKnowledge);
      const f = await fixture('I6 固定自然对话');
      const version = await publishStandard(f, 'customer_public', null);
      await (i67Dialogue ? i67Conversations(f, version) : i6Conversations(f, version));
      return;
    }
    let errors = 0;
    for (const round of liveModel ? [1, 2] : [1]) {
      const f = await fixture('防水业务旅程 ' + round);
      const version = await publishStandard(f);
      try {
        const citation = await conversation(f, version, round);
        if (round === 1 && (!liveModel || hosted)) await business(f, version, citation);
        if (durableAcceptance) await check('原请求租约接管、未知模型结果及原请求重放',
          async () => interruptedOwnerTurn(await fixture('中断对照')), true);
      } catch (error) {
        console.error(error);
        errors++;
      }
    }
    if (errors || checks.some(check => check.status === 'failed')) process.exitCode = 1;
  } finally {
    report.after = binding();
    report.drift = json(report.after) !== json(before);
    if (report.drift) process.exitCode = 1;
    if (mock) report.managedSubstituteCalls = mock.calls;
    save('report', report);
    restore?.();
    await closePostgresPool();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
