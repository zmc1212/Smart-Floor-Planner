import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
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
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAnswer } from '@/lib/assistant/infrastructure/answer-worker';
import { naturalKnowledgeProtocol, sourceBoundaryValidationProtocol } from '@/lib/assistant/agent/knowledge-explanation';
import { BailianKnowledgeProvider } from '@/lib/assistant/knowledge/bailian-provider';
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

const eid = '1454', control = '1455', model = 'qwen3.7-flash';
const liveModel = process.argv.includes('--live-model');
const hosted = process.argv.includes('--hosted');
const mock = !liveModel && !hosted ? mockBailianRag() : null;
const label = process.argv.find(arg => arg.startsWith('--label='))?.slice(8) ?? randomUUID();
const target = new URL(process.env.XIAOK_R6_DATABASE_URL ?? 'http://missing');
assert.match(label, /^[a-z0-9-]{1,72}$/);
assert.equal(target.protocol, 'postgresql:');
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.username, 'sfp_app');
assert.ok(Number(target.port) >= 49152 && !target.search && !target.hash);
assert.match(target.pathname, /^\/xiaok_r6_(?:acceptance|model|hosted)(?:_[a-z0-9]+)?$/);
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
  if (upstream) assert.ok(upstream.providerKey === 'dashscope' && upstream.apiKey && bailianResponsesBinding(upstream.baseUrl, model));
  await closePostgresPool();
  process.env.DATABASE_URL = target.href;
  process.env.ASSISTANT_KNOWLEDGE_PROVIDER = liveModel && !hosted ? 'local' : 'bailian';
  process.env.NATIVE_WORKFLOW_DELEGATION_ENABLED = '1';
  process.env.NATIVE_WORKFLOW_DELEGATION_ENTERPRISE_IDS = eid;
  process.env.ASSISTANT_RESPONSES_API = '1';
  process.env.ASSISTANT_RESPONSES_MAX_RETRIES = '0';
  process.env.ASSISTANT_TEXT_DISABLE_THINKING = '1';
  process.env.ASSISTANT_REQUESTS_PER_MINUTE = '120';
  process.env.AI_ASSET_STORAGE_DIR = output + '/media';
  for (const key of ['ASSISTANT_TEXT_MODEL','ASSISTANT_NATIVE_TOOLS','ASSISTANT_WEB_SEARCH_TOOLS','XIAOK_FASTGPT_WORKFLOWS_FILE',
    'XIAOK_FASTGPT_RAG_FILE','XIAOK_FASTGPT_RETRIEVAL_FILE','ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS']) delete process.env[key];
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
    const config = { runtime: 'langgraph-v1', providerKey: 'dashscope', model, tools: true, imageInput: false,
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
    rooms: ['卫生间','厨房'] }, randomUUID())).id);
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
    else await delay(4200);
  }
  assert.fail('knowledge indexing did not finish');
}

async function publishStandard(f: Fixture, audience = 'customer_public') {
  const created = await f.kb.execute('createFile', { title: standard.title + ' · R6 合成',
    audience, projectId: f.pid, category: '施工标准', fileName: 'r6-ppt-craft-18.md',
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
async function send(f: Fixture, text: string, cid = f.cid) {
  const key = randomUUID();
  const response = await assistant(f, ['conversations', cid, 'messages'], { clientMessageId: key, content: block(text) }, key);
  assert.equal(response.status, 202, await response.clone().text());
  return (await response.json()).data as Row;
}
const outputOf = (name: string, args: object): ModelTurnOutput => ({
  text: '', toolCalls: [{ id: 'r6-' + randomUUID(), name, arguments: json(args) }], finishReason: 'tool_calls',
  providerRequestId: null, usage: { inputTokens: 30, outputTokens: 10 },
});
async function turn(f: Fixture, text: string, cid = f.cid) {
  const sent = await send(f, text, cid);
  assert.ok(sent.runId, json(sent));
  const lease = await claimJob();
  assert.equal(lease?.runId, sent.runId);
  if (liveModel) await processAnswer(lease!);
  else await processAgentAnswer(lease!, { model: async (messages, tools, step, actual) => {
    const offered = actual ?? tools;
    if (step === 0 && text === question) return outputOf('knowledge_search', { query: '卫生间防水施工和后续检查' });
    if (step === 0 && text === preference) return outputOf('manage_long_term_memory', { action: 'remember', category: 'preference',
      topic: '沟通方式', quote: preference, value: '先告诉我结论，再说细节' });
    if (step === 0 && text === delegation) return outputOf('start_delegation', { kind: 'rectification_review',
      room: '卫生间', subject, quote: delegation });
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
    attempts: await rows(tx, sql`select status,error_code,remote_model,metadata from app.ai_provider_attempts
      where enterprise_id=${f.tenant} and assistant_run_id=${String(sent.runId)} order by id`),
    usage: await rows(tx, sql`select category,quantity,measurement_kind from app.assistant_usage_records
      where enterprise_id=${f.tenant} and run_id=${String(sent.runId)} order by id`),
  }));
  const messages = (await f.chat.messages(cid, undefined, 100)).items as Row[];
  const answer = messages.find(message => message.id === ledger.run?.output_message_id);
  save('turn-' + String(sent.runId), { cid, text, sent, answer, ...ledger });
  assert.equal(ledger.run?.status, 'succeeded', json(ledger.run));
  assert.ok(answer?.available, 'Saved answer unavailable');
  return { sent, answer, ledger };
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
    assert.doesNotMatch(safeText(created.answer.content as MessageContent), /已验收|已复核|验收合格/u);
  }, keepIndependentLiveChecks);
  return citationId;
}

async function business(f: Fixture, v1: Draft, originalCitation: string) {
  const alternate = await fixture('同租户另一工地');
  const foreign = await fixture('跨租户工地', control);
  let issue = '', plan = '', evidenceRecord = '', publishedVersion = 0, mediaId = '';
  const command = (site: SiteChatService, text: string, media: string[] = []) => siteSay(f, site, text, media);
  const lookup = async (actor: ActorContext, cid: string) => {
    const epoch = await withTenantTransaction(actor.enterpriseId, async tx =>
      Number((await one(tx, sql`select knowledge_epoch from app.assistant_enterprise_settings where enterprise_id=${actor.enterpriseId}`))!.knowledge_epoch));
    return (await retrieveKnowledge(cid, actor, '卫生间防水施工和后续检查', epoch, undefined, undefined, 'ranked', { mode: 'hybrid' })).evidence;
  };
  const document = await publishStandard(f, 'staff_internal');
  await publishStandard(foreign);
  await check('业主、设计师、施工人员、老板的项目和知识权限', async () => {
    assert.equal((await assistant(alternate, ['conversations', f.cid, 'long-term'])).status, 404);
    assert.equal((await assistant(foreign, ['citations', originalCitation])).status, 404);
    assert.deepEqual(await lookup(alternate.actor, alternate.cid), []);
    assert.ok((await lookup(f.actor, f.cid)).every(source => source.ref.version === v1.versionId));
    for (const site of [f.designer, f.worker, f.boss]) {
      const page = await site.read(f.pid);
      const hits = await lookup(site.actor, String(page.conversationId));
      assert.ok(hits.some(source => source.ref.version === document.versionId));
      assert.ok(hits.every(source => source.knowledge?.projectId === f.pid));
      assert.doesNotMatch(json(page), /先告诉我结论，再说细节/);
    }
    const hiddenProject = (error: unknown) => error instanceof AssistantError && error.status === 404;
    await assert.rejects(f.designer.read(alternate.pid), hiddenProject);
    await assert.rejects(f.worker.read(alternate.pid), hiddenProject);
    await assert.rejects(f.boss.read(foreign.pid), hiddenProject);
    await assert.rejects(new KnowledgeService(f.worker.staff).execute('retire', v1, randomUUID()), /assistant_capability_forbidden/);
  });
  await check('原咨询明确共享、现场事项创建、设计师接手和计划发布', async () => {
    const shared = await send(f, '共享卫生间需求：希望项目团队核对水管根部处理，完成后告诉我。');
    assert.equal(shared.runId, null, json(shared));
    const source = await capture(f, '卫生间', false);
    issue = String((await command(f.boss, '跟进记录' + source.id + '：核对卫生间水管根部处理')).issueId);
    assert.match(issue, /^[1-9]\d*$/);
    await command(f.designer, '接手事项' + issue);
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
    assert.ok(current.some(source => source.ref.version === v2.versionId) && current.every(source => source.ref.version !== v1.versionId));
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
    assert.deepEqual(await lookup(f.actor, f.cid), []);
    await f.change('progress', { stageKey: 'utilities', note: '项目团队再次确认最新施工记录。', sendReminder: false });
    await tick();
    assert.equal(((await task(f)).standardCheck as Row).status, 'no_match');
    for (let i = 0; i < 20 && await processManagedKnowledgeCleanup(); i++) { /* isolated managed documents */ }
    save('version-recovery', { v1, v2, failure, recovered });
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
  });
  save('native-fixture', { cid: f.cid, ownerId: f.uid, projectId: f.pid, evidenceRecord, mediaId });
}

async function main() {
  const before = binding();
  const mode = hosted ? 'bailian-hosted' : liveModel ? 'bailian-responses-with-local-retrieval' : 'postgresql-with-rag-and-model-substitutes';
  const report: Row = { mode, model: liveModel ? model : 'substitute', before, pptSource: ppt.source, checks };
  const restore = mock?.install();
  try {
    if (hosted) report.hostedPreflight = await new BailianKnowledgeProvider().listIndices().then(result => ({
      requestId: result.requestId, libraryCount: result.value.length,
    }));
    report.database = await configure();
    let errors = 0;
    for (const round of liveModel ? [1, 2] : [1]) {
      const f = await fixture('防水业务旅程 ' + round);
      const version = await publishStandard(f);
      try {
        const citation = await conversation(f, version, round);
        if (round === 1 && (!liveModel || hosted)) await business(f, version, citation);
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
