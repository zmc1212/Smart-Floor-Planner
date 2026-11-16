import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { GET as assistantGet, POST as assistantPost } from '@/app/api/miniprogram/assistant/[...path]/route';
import { AiProviderConfigRepository } from '@/db/repositories';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { encryptText } from '@/lib/crypto';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { closePostgresPool } from '@/lib/postgresql';
import { ConstructionService } from '@/lib/construction/service';
import { fingerprint, type ActorContext, type MessageContent } from '@/lib/assistant/contracts';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { processAssistantRun } from '@/lib/assistant/application/worker';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { BAILIAN_RAG, LOCAL_PGVECTOR } from '@/lib/assistant/knowledge/bailian-provider';
import { claimKnowledgeJob, runKnowledgeJob } from '@/lib/assistant/knowledge/index-worker';
import { KnowledgeService, type KnowledgeActor } from '@/lib/assistant/knowledge/service';
import { mockBailianRag } from './xiaok-r4-bailian-mock';

const target = new URL(process.env.XIAOK_I7520_DATABASE_URL ?? 'http://missing');
const owner = new URL(process.env.XIAOK_I7520_OWNER_URL ?? 'http://missing');
const output = process.env.XIAOK_I7520_OUTPUT ?? '';
const ledgerDigest = process.env.XIAOK_I7520_LEDGER_SHA256 ?? '';
const embeddingUrl = new URL(process.env.ASSISTANT_EMBEDDING_URL ?? 'http://missing');
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
for (const url of [target, owner]) assert.ok(url.protocol === 'postgresql:' && url.hostname === '127.0.0.1'
  && Number(url.port) >= 49152 && /^\/xiaok_i7520_[a-z0-9]+$/u.test(url.pathname)
  && url.password && !url.search && !url.hash, 'Use the fresh marked I7.5.20 loopback database');
assert.equal(target.username, 'sfp_app');
assert.equal(owner.username, 'sfp_migrator');
assert.equal(target.host + target.pathname, owner.host + owner.pathname);
assert.ok(path.isAbsolute(output) && /^[a-f0-9]{64}$/u.test(ledgerDigest) && process.env.JWT_SECRET);
assert.ok(embeddingUrl.protocol === 'http:' && embeddingUrl.hostname === '127.0.0.1' && Number(embeddingUrl.port) > 1024
  && embeddingUrl.pathname === '/' && !embeddingUrl.search && !embeddingUrl.hash && process.env.ASSISTANT_EMBEDDING_API_KEY);
const deployment = path.join(path.dirname(output), 'synthetic-executor.json');
assert.ok(!existsSync(deployment));
writeFileSync(output, '', { flag: 'wx' });
Object.assign(process.env, { DATABASE_URL: target.href, ASSISTANT_KNOWLEDGE_PROVIDER: BAILIAN_RAG,
  ASSISTANT_EMBEDDING_PROVIDER: 'local', ASSISTANT_REQUESTS_PER_MINUTE: '120' });
for (const key of ['GRS_API_KEY', 'APINEBULA_API_KEY', 'POLLINATIONS_API_KEY', 'ASSISTANT_TEXT_MODEL', 'XIAOK_FASTGPT_WORKFLOWS_FILE',
  'ASSISTANT_BAILIAN_RAG_API_KEY', 'ASSISTANT_BAILIAN_RAG_WORKSPACE_ID', 'ASSISTANT_BAILIAN_RAG_EMBEDDING_MODEL']) delete process.env[key];

const fixture = JSON.parse(readFileSync('scripts/fixtures/xiaok-ppt-craft-preview.json', 'utf8')) as {
  source: { file: string; sha256: string }; drafts: Array<{ slide: number; title: string; body: string }>;
};
const [water, waterproof] = fixture.drafts;
const sources = sha(readFileSync(path.resolve('..', fixture.source.file)));
assert.equal(sources, fixture.source.sha256, 'Retained PPT must match the verified excerpt manifest');
const cloud = mockBailianRag(), key = 'i7520-synthetic-text-key';
const modelName = 'i7520-fixture-model', providerKey = 'i7520-synthetic-text';
const textOrigin = 'http://127.0.0.1:18172';
const qWater = '家里的用水管路主要负责什么？';
const qCompany = '按我们公司的防水施工资料，卫生间防水和后续检查由谁安排？';
const qNoMatch = '家用新风机的除菌滤芯型号与更换周期是什么？';
const textBlock = (text: string): MessageContent => ({ version: 1, blocks: [{ type: 'text', text }] });
type Mode = 'ok' | 'timeout' | 'unavailable' | 'native_search';
let mode: Mode = 'ok', beforeText: (() => Promise<unknown>) | undefined;
let embeddings = 0, blockedNetwork = 0, breakEmbedding = false;
const dispatched: Array<{ mode: Mode; kind: string }> = [];
const cases: Array<{ name: string; status: string; evidence: unknown }> = [];
const originalFetch = globalThis.fetch;
function sourceBinding() {
  const files = execFileSync('git', ['ls-files','-c','-o','--exclude-standard','-z','--',
    'src','drizzle','package.json','package-lock.json','tsconfig.json',
    'scripts/xiaok-i7520-facts-only-acceptance.ts','scripts/xiaok-r4-bailian-mock.ts','scripts/fixtures/xiaok-ppt-craft-preview.json',
    'scripts/xiaok-embedding/server.py']).toString().split('\0').filter(Boolean).sort();
  const hash = createHash('sha256');
  for (const name of files) hash.update(name).update('\0').update(readFileSync(name)).update('\0');
  return hash.update(JSON.stringify([target.host, target.pathname, ledgerDigest, embeddingUrl.origin, sources])).digest('hex');
}
async function check<T>(name: string, fn: () => Promise<T>) {
  try {
    const evidence = await fn();
    cases.push({ name, status: 'passed', evidence });
    console.log('PASS', name);
    return evidence;
  } catch (error) {
    cases.push({ name, status: 'failed', evidence: error instanceof Error ? error.stack : String(error) });
    console.error('FAIL', name);
    throw error;
  }
}
function installTransportFixtures() {
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === embeddingUrl.origin) {
      if (url.pathname === '/v1/embeddings') embeddings++;
      if (breakEmbedding) return new Response(null, { status: 503 });
      return originalFetch(input, init);
    }
    if (url.origin !== textOrigin || url.pathname !== '/v1/chat/completions') {
      blockedNetwork++;
      throw new Error('I7.5.20 blocked a non-isolated request');
    }
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer ' + key);
    const request = JSON.parse(String(init?.body)) as Row;
    assert.equal(request.model, modelName);
    dispatched.push({ mode, kind: mode === 'native_search' ? 'tool_selection' : 'text' });
    const hook = beforeText;
    beforeText = undefined;
    await hook?.();
    if (mode === 'timeout') throw new DOMException('I7520 synthetic timeout', 'TimeoutError');
    if (mode === 'unavailable') return Response.json({ error: { code: 'ServiceUnavailable' } },
      { status: 503, headers: { 'x-request-id': 'i7520-fixture-model-503' } });
    if (mode === 'native_search') {
      const tools = request.tools as Array<{ function: { name: string } }>;
      const search = tools.find(tool => ['search_enterprise', 'knowledge_search'].includes(tool.function.name));
      assert.ok(search, 'Fixture can request only a search tool offered by the current executor');
      mode = 'timeout';
      return Response.json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{
        id: 'call_i7520_fixture', type: 'function', function: { name: search.function.name, arguments: JSON.stringify({ query: qWater }) },
      }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
    }
    const messages = request.messages as Array<{ role: string; content: string }>;
    const packet = JSON.parse(messages.at(-1)!.content) as { question: string; evidence: Array<{ selectionId: string }> };
    const choice = packet.evidence[0];
    assert.ok(choice, 'The normal text fixture must receive authorized evidence');
    const selections = packet.question === qNoMatch ? [] : [choice.selectionId];
    return Response.json({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ selections }) },
      finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  };
  cloud.install();
}

async function manager(label: string, platform = false): Promise<KnowledgeActor> {
  return withPlatformTransaction(async tx => {
    const name = 'I7520-' + label, enterpriseId = String((await one(tx, sql`insert into app.enterprises(name,code,status)
      values(${name},${name},'active') returning id`))!.id);
    assert.notEqual(enterpriseId, '1454');
    await tx.execute(sql`insert into app.assistant_enterprise_settings
      (enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
      values(${enterpriseId},true,100,5000000,100000000,30,'{"enterpriseKnowledgeEnabled":true}'::jsonb)`);
    const staff = await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
      values(${platform ? null : enterpriseId},${name},'fixture-login-disabled',${platform ? 'admin' : 'enterprise_admin'},
        'active',array['assistant-knowledge','construction-projects'],false) returning id`);
    return { enterpriseId, adminId: String(staff!.id) };
  });
}

async function customer(manager: KnowledgeActor, label: string, stageKey: string) {
  const name = 'I7520-' + label, { enterpriseId } = manager;
  const { uid, lead } = await withPlatformTransaction(async tx => {
    const uid = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${name},1) returning id`))!.id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${name})`);
    const lead = (await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
      values(${enterpriseId},${uid},${name},'19975200001','natural') returning id`))!;
    return { uid, lead: String(lead.id) };
  });
  const service = new ConstructionService(manager);
  const settings = await service.execute('stages'), stages = settings.stages as Row[];
  if (!stages.some(stage => stage.key === 'waterproof')) await service.execute('saveStages',
    { expectedVersion: settings.version, stages: [...stages, { key: 'waterproof', name: '防水', visitReminder: false }] }, randomUUID());
  const project = String((await service.execute('create',
    { leadId: lead, name, managerId: manager.adminId, rooms: ['卫生间'] }, randomUUID())).id);
  const detail = async () => (await service.execute('detail', { projectId: project })).project as Row;
  const access = async (customerAccess: boolean) => service.execute('update',
    { projectId: project, expectedVersion: (await detail()).version, name, customerAccess, status: 'active' }, randomUUID());
  const stage = async (stageKey: string) => service.execute('progress',
    { projectId: project, expectedVersion: (await detail()).version, stageKey, note: 'I7520 合成项目', sendReminder: false }, randomUUID());
  await access(true);
  await stage(stageKey);
  const actor: ActorContext = { enterpriseId, principal: { kind: 'user', userId: uid }, contextVersion: 1,
    capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: lead } };
  const chat = new ConversationService(actor);
  return { uid, stage, access, project, actor, chat, conversation: String((await chat.create(randomUUID())).id) };
}
type Customer = Awaited<ReturnType<typeof customer>>;
const anotherConversation = async (c: Customer) => ({ ...c, conversation: String((await c.chat.create(randomUUID())).id) });

async function drain(store: KnowledgeService, jobId: string) {
  const eid = store.actor.enterpriseId;
  for (let i = 0; i < 9; i++) {
    const lease = await claimKnowledgeJob({ enterpriseId: eid, jobId });
    assert.ok(lease);
    await runKnowledgeJob(lease);
    const job = await store.execute('job', { jobId });
    if (job.status === 'succeeded') return job;
    assert.equal(job.status, 'queued', JSON.stringify(job));
    await withTenantTransaction(eid, tx => tx.execute(sql`update app.assistant_jobs set available_at=now()
      where enterprise_id=${eid} and id=${jobId} and status='queued'`));
  }
  throw new Error('I7520 fixture did not index');
}

async function publish(store: KnowledgeService, passage: typeof water, stage: string, projectId?: string) {
  const made = await store.execute('createFile', { title: passage.title, audience: 'customer_public', projectId,
    fileName: 'PPT-excerpt-' + passage.slide + '.txt', fileBase64: Buffer.from(passage.body).toString('base64'),
    authorization: 'Verified PPT excerpt for isolated I7.5.20 acceptance',
    professional: { version: 1, kind: 'construction', topics: [], conditions: [{ field: 'stage', operator: 'in', values: [stage] }],
      prerequisites: [], exceptions: [], origin: { title: path.basename(fixture.source.file), version: '已核验摘录',
        locator: '第' + passage.slide + '页', page: passage.slide, authority: 'reference' }, review: { note: '工艺摘录核对' } },
  }, randomUUID());
  const draft = { documentId: String((made.document as Row).id), versionId: String((made.draft as Row).id),
    expectedVersion: 1, expectedEditVersion: 2 };
  await drain(store, String(made.jobId));
  const reviewed = await store.execute('reviewFile', { ...draft, acknowledgeWarnings: true, excludedBlockIds: [] }, randomUUID());
  draft.expectedEditVersion = Number(reviewed.edit_version);
  const receipt = await drain(store, String((await store.execute('index', draft, randomUUID())).jobId));
  assert.ok((receipt.attempts as Row[]).some(attempt => attempt.operation === 'embed'
    && attempt.status === 'succeeded' && Number(attempt.input_tokens) > 0));
  const doc = await store.execute('publish', draft, randomUUID());
  return { ...draft, expectedVersion: Number(doc.version) };
}

const appRequest = (segments: string[], token: string, entry?: string, data?: Row, idempotency?: string) => new Request(
  'http://127.0.0.1/api/miniprogram/assistant/' + segments.join('/'), {
    method: data ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + token, ...(entry ? { 'X-Assistant-Entry': entry } : {}),
      ...(data ? { 'Content-Type': 'application/json' } : {}), ...(idempotency ? { 'Idempotency-Key': idempotency } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
async function mini(c: Customer) {
  const token = await signMiniProgramToken({ sub: c.uid, id: c.uid, role: 'user', mode: 'customer',
    enterpriseId: c.actor.enterpriseId, contextVersion: 1, source: 'wechat' });
  async function request<T>(segments: string[], entry?: string, body?: Row, key?: string, status = 200) {
    const handler = body ? assistantPost : assistantGet;
    const response = await handler(appRequest(segments, token, entry, body, key), { params: Promise.resolve({ path: segments }) });
    const json = await response.json();
    assert.equal(response.status, status, JSON.stringify(json));
    assert.equal(json.success, true, JSON.stringify(json));
    return json.data as T;
  }
  const entry = await request<{ entryToken: string }>(['entry-context'], undefined, { conversationId: c.conversation });
  assert.ok(entry.entryToken);
  return {
    send: (messageId: string, content: MessageContent) =>
      request<{ runId: string }>(['conversations', c.conversation, 'messages'], entry.entryToken, { clientMessageId: messageId, content }, messageId, 202),
    messages: () => request<Awaited<ReturnType<ConversationService['messages']>>>(['conversations', c.conversation, 'messages'], entry.entryToken),
    citation: (id: string) => request<Awaited<ReturnType<ConversationService['citation']>>>(['citations', id], entry.entryToken),
  };
}
async function runReceipts(eid: string, runId: string) {
  return withTenantTransaction(eid, async tx => ({
    steps: await rows(tx, sql`select step_seq,kind,status,input_summary,provider_attempt_id::text from app.assistant_run_steps
      where enterprise_id=${eid} and run_id=${runId} and kind in ('retrieval','answer','model','agent_model','execution') order by step_seq`),
    attempts: await rows(tx, sql`select id::text,status,accepted,error_code,actual_cost
      from app.ai_provider_attempts where enterprise_id=${eid} and assistant_run_id=${runId} order by id`),
    ledger: await rows(tx, sql`select operation_key,category,quantity::text,measurement_kind from app.assistant_usage_records
      where enterprise_id=${eid} and run_id=${runId} order by id`),
    quota: (await one(tx, sql`select status,settled_tokens,settled_cost_micros::text from app.assistant_quota_reservations
      where enterprise_id=${eid} and run_id=${runId}`))!,
    count: (await one(tx, sql`select count(*)::int as n from app.assistant_messages
      where enterprise_id=${eid} and run_id=${runId} and author_kind='assistant'`))!.n,
  }));
}

async function turn(c: Customer, question: string, client?: Awaited<ReturnType<typeof mini>>) {
  const eid = c.actor.enterpriseId, messageId = randomUUID(), content = textBlock(question);
  const send = () => client ? client.send(messageId, content) : c.chat.send(c.conversation, messageId, content);
  const result = await send(), runId = String(result.runId);
  assert.ok(result.runId);
  assert.equal((await send()).runId, result.runId);
  const lease = await claimJob({ enterpriseId: eid, runId });
  assert.ok(lease);
  assert.equal(await claimJob({ enterpriseId: eid, runId }), null);
  await processAssistantRun(lease);
  const run = await new ConversationService(c.actor).run(runId);
  assert.ok(['succeeded', 'failed', 'indeterminate'].includes(String(run.status)), JSON.stringify(run));
  const receipt = await runReceipts(eid, runId);
  const textCount = dispatched.length, embeddingCount = embeddings, managedCount = cloud.calls.length;
  assert.equal((await send()).runId, result.runId);
  assert.equal(await claimJob({ enterpriseId: eid, runId }), null);
  assert.deepEqual(await runReceipts(eid, runId), receipt);
  assert.deepEqual([dispatched.length, embeddings, cloud.calls.length], [textCount, embeddingCount, managedCount]);
  const history = client ? await client.messages() : await new ConversationService(c.actor).messages(c.conversation);
  assert.equal(receipt.count, run.outputMessageId ? 1 : 0);
  return { run, receipt, message: history.items.find(item => item.id === run.outputMessageId) };
}

function retrieval(result: Awaited<ReturnType<typeof turn>>) {
  const step = result.receipt.steps.find(step => step.kind === 'retrieval');
  assert.ok(step, JSON.stringify(result.receipt));
  const summary = step.input_summary as Row;
  return (summary.diagnostic ?? summary.retrieval ?? summary) as Row;
}

function facts(result: Awaited<ReturnType<typeof turn>>, failureCode: string) {
  assert.equal(result.run.status, 'succeeded', JSON.stringify(result));
  assert.equal(result.run.answerKind, 'grounded');
  assert.ok(result.message?.available);
  const content = result.message.content as MessageContent;
  assert.equal(content.answerMode, 'facts_only');
  assert.ok(content.blocks.some(block => block.type === 'notice' && block.code === 'facts_only' && block.fallbackText.includes('核实')));
  const answer = result.receipt.steps.find(step => step.kind === 'answer')?.input_summary as Row;
  assert.equal(answer.answerMode, 'facts_only');
  assert.equal((answer.modelFailure as Row).code, failureCode);
  return { content, answer, citations: result.message.citations };
}

function assertCitation(citation: unknown, source: typeof water, scope: 'enterprise' | 'project' | 'platform', version: string) {
  const value = citation as Row;
  assert.equal(value.available, true, JSON.stringify(value));
  assert.deepEqual([value.title, value.page, value.version, value.versionNumber, (value.knowledge as Row).scope],
    [source.title, source.slide, version, 1, scope]);
  assert.match(String(value.sourceLocation), /家客来小K装修服务功能方案\.pptx/u);
  assert.ok(String(value.quote).trim() && source.body.includes(String(value.quote)), JSON.stringify(value));
  assert.match(String(value.contentHash), /^[a-f0-9]{64}$/u);
  assert.match(String(value.sourceHash), /^[a-f0-9]{64}$/u);
  return value;
}

async function exercise(ownerDb: pg.Client) {
  const a = await manager('enterprise'), b = await manager('other'), platform = await manager('platform', true);
  await assert.rejects(withTenantTransaction(a.enterpriseId, tx => tx.execute(sql`insert into app.assistant_platform_knowledge_library
    (enterprise_id) values(${platform.enterpriseId})`)), (e: Error) => (e.cause as { code?: string })?.code === '42501');
  await ownerDb.query('insert into app.assistant_platform_knowledge_library (enterprise_id) values($1)', [platform.enterpriseId]);
  const wet = await customer(a, 'water', 'utilities'), bath = await customer(a, 'bath', 'waterproof'), outside = await customer(b, 'outside', 'utilities');
  const store = new KnowledgeService(a), platformStore = new KnowledgeService(platform);
  const compiled = await check('approved_PPT_sources_and_actual_embedding', async () => ({
    wet: await publish(store, water, 'utilities'),
    bath: await publish(store, waterproof, 'waterproof', bath.project),
    platform: await publish(platformStore, water, 'utilities'),
  }));
  const client = await mini(wet);
  await check('text_unavailable_before_dispatch', async () => {
    const result = await turn(wet, qWater, client), answer = facts(result, 'model_unavailable');
    assert.deepEqual(result.receipt.attempts, []);
    assert.equal(result.receipt.quota.status, 'released');
    assert.equal(retrieval(result).provider, BAILIAN_RAG);
    return { run: result.run.id, answer: answer.answer, quota: result.receipt.quota };
  });
  const provider = await withPlatformTransaction(tx => new AiProviderConfigRepository(tx).create({
    key: providerKey, name: 'I7520 synthetic text fixture', adapterType: 'openai_compatible', baseUrl: textOrigin,
    apiKeyEncrypted: encryptText(key), apiKeyMasked: 'fixture', capabilities: ['chat'], modelMappings: { 'chat.general': modelName },
    priority: 0, timeoutMs: 500, enabled: true, costRules: [],
  }));
  assert.ok(provider.id);

  await check('hosted_RAG_and_text_success', async () => {
    const result = await turn(wet, qWater, client);
    assert.equal(retrieval(result).provider, BAILIAN_RAG);
    assert.equal(result.run.answerKind, 'grounded');
    assert.equal((result.message?.content as MessageContent).answerMode, undefined);
    assert.deepEqual(result.receipt.attempts.map(attempt => attempt.status), ['succeeded']);
    return { run: result.run.id, citation: assertCitation(result.message?.citations[0], water, 'enterprise', compiled.wet.versionId) };
  });

  const fallbackBath = await check('hosted_RAG_and_text_timeout', async () => {
    mode = 'timeout';
    const signed = await mini(bath);
    const result = await turn(bath, qCompany, signed), answer = facts(result, 'PROVIDER_TIMEOUT');
    assert.equal(retrieval(result).provider, BAILIAN_RAG);
    assert.deepEqual(result.receipt.attempts.map(attempt => [attempt.status, attempt.error_code, attempt.actual_cost]),
      [['unknown', 'PROVIDER_TIMEOUT', {}]]);
    assert.equal(result.receipt.quota.status, 'reconciling');
    assert.equal(result.receipt.ledger.filter(item => item.category === 'tokens' && item.quantity === '0').length, 0);
    assert.equal(answer.answer.providerAttemptStatus, 'unknown');
    const opened = await signed.citation(String(answer.citations[0].id));
    return { run: result.run.id, message: result.message!.id, answer: answer.answer, attempt: result.receipt.attempts[0],
      receipt: result.receipt, citation: assertCitation(opened, waterproof, 'project', compiled.bath.versionId) };
  });
  await check('model_recovery_on_a_new_request', async () => {
    const open = await anotherConversation(bath), signed = await mini(open);
    mode = 'timeout';
    const previous = await turn(open, qCompany, signed);
    facts(previous, 'PROVIDER_TIMEOUT');
    mode = 'ok';
    const result = await turn(open, qCompany, signed);
    assert.equal(result.run.answerKind, 'grounded');
    assert.equal((result.message?.content as MessageContent).answerMode, undefined);
    assert.deepEqual(result.receipt.attempts.map(attempt => [attempt.status, attempt.error_code]), [['succeeded', null]]);
    assert.deepEqual(await runReceipts(bath.actor.enterpriseId, String(previous.run.id)), previous.receipt);
    return { run: result.run.id, message: result.message?.id, provider: retrieval(result).provider, attempts: result.receipt.attempts,
      previousRun: previous.run.id, previousQuota: previous.receipt.quota.status };
  });
  await check('platform_supplement_has_own_provenance', async () => {
    mode = 'unavailable';
    const result = await turn(outside, qWater), answer = facts(result, 'HTTP_503');
    assert.ok(answer.content.blocks.some(block => block.type === 'text' && block.text === '平台公共知识原文'));
    const cite = assertCitation(answer.citations[0], water, 'platform', compiled.platform.versionId);
    const company = await turn(outside, '按我们公司的水路施工资料，用水管路主要做什么？');
    assert.equal(company.run.answerKind, 'insufficient_evidence', JSON.stringify(company));
    assert.deepEqual(company.message?.citations, []);
    return { run: result.run.id, response: answer.answer, citation: cite, companyQuestion: company.run.answerKind };
  });

  for (const [name, errorType, reason] of [
    ['hosted_connection_error_uses_pgvector', 'transport', 'transport_error'],
    ['hosted_rate_limit_uses_pgvector', 'rate_limit', 'Throttling.RateQuota'],
  ] as const) await check(name, async () => {
    const before = embeddings;
    mode = errorType === 'rate_limit' ? 'unavailable' : 'ok';
    cloud.intercept.unavailableNext = errorType;
    const result = await turn(await anotherConversation(bath), qCompany);
    assert.equal(result.run.answerKind, 'grounded', JSON.stringify(result));
    const diagnostic = retrieval(result), fallback = diagnostic.fallback as Row;
    assert.deepEqual([diagnostic.provider, fallback.reason], [LOCAL_PGVECTOR, reason]);
    assert.equal(embeddings, before + 1);
    assertCitation(result.message?.citations[0], waterproof, 'project', compiled.bath.versionId);
    if (mode === 'unavailable') facts(result, 'HTTP_503');
    return { run: result.run.id, fallback, managedIndex: diagnostic.managedIndex, actualEmbeddingRequests: embeddings - before };
  });

  async function failedRetrieval(code: string, fallbackError?: string) {
    const before = dispatched.length, result = await turn(bath, qCompany);
    const detail = retrieval(result);
    assert.deepEqual([result.run.status, result.run.errorCode, result.run.outputMessageId], ['failed', 'retrieval_unavailable', null]);
    assert.deepEqual([detail.code, detail.fallbackError], [code, fallbackError]);
    assert.equal(dispatched.length, before);
    assert.deepEqual(result.receipt.attempts, []);
    return { run: result.run.id, retrieval: detail, modelDispatches: 0 };
  }
  const rejected = await check('RAG_credentials_rejected_without_fallback', async () => {
    const localBefore = embeddings;
    cloud.intercept.failNext = 'retrieve';
    const result = await failedRetrieval('AccessDenied');
    assert.equal(embeddings, localBefore);
    return result;
  });
  await check('incompatible_local_index_is_rejected', async () => {
    const eid = a.enterpriseId, vid = compiled.bath.versionId, localBefore = embeddings;
    const edit = (restore?: Row[]) => withTenantTransaction(eid, async tx => {
      if (restore) {
        for (const row of restore) await tx.execute(sql`update app.assistant_knowledge_chunks
          set locator=${JSON.stringify(row.locator)}::jsonb where enterprise_id=${eid} and id=${String(row.id)}`);
        return restore;
      }
      const prior = await rows(tx, sql`select id,locator from app.assistant_knowledge_chunks where enterprise_id=${eid} and document_version_id=${vid}`);
      await tx.execute(sql`update app.assistant_knowledge_chunks set locator=locator-'localEmbeddingProfile'
        where enterprise_id=${eid} and document_version_id=${vid}`);
      return prior;
    });
    const prior = await edit();
    assert.ok(prior.length);
    try {
      cloud.intercept.unavailableNext = 'gateway';
      const result = await failedRetrieval('ServiceUnavailable', 'local_index_incompatible');
      assert.equal(embeddings, localBefore);
      return result;
    } finally { await edit(prior); }
  });
  await check('both_retrieval_engines_unavailable', async () => {
    const localBefore = embeddings;
    cloud.intercept.unavailableNext = 'transport';
    breakEmbedding = true;
    try {
      const result = await failedRetrieval('transport_error', 'retrieval_unavailable');
      assert.equal(embeddings, localBefore + 1);
      return result;
    } finally { breakEmbedding = false; }
  });
  await check('healthy_engines_have_no_relevant_evidence', async () => {
    const before = dispatched.length, localBefore = embeddings;
    mode = 'ok';
    const fresh = await anotherConversation(wet);
    const hosted = await turn(fresh, qNoMatch);
    assert.equal(hosted.run.answerKind, 'insufficient_evidence');
    assert.equal(retrieval(hosted).provider, BAILIAN_RAG);
    assert.deepEqual([dispatched.length, embeddings], [before, localBefore]);
    process.env.ASSISTANT_KNOWLEDGE_PROVIDER = LOCAL_PGVECTOR;
    try {
      const local = await turn(await anotherConversation(wet), qNoMatch);
      const diagnostic = retrieval(local);
      assert.equal(diagnostic.provider, LOCAL_PGVECTOR);
      assert.equal(local.run.answerKind, 'insufficient_evidence');
      assert.deepEqual(local.message?.citations, []);
      mode = 'unavailable';
      const outage = await turn(await anotherConversation(wet), qNoMatch);
      assert.equal(outage.run.answerKind, 'insufficient_evidence');
      assert.deepEqual(outage.message?.citations, []);
      const audit = outage.receipt.steps.find(step => step.kind === 'answer')?.input_summary as Row;
      assert.deepEqual([audit.fallback, audit.answerMode, (audit.modelFailure as Row).code], ['facts_only', null, 'HTTP_503']);
      assert.equal(embeddings, localBefore + 2);
      return { hosted: hosted.run.id, local: local.run.id, localOutage: outage.run.id, answerKind: outage.run.answerKind,
        localShortlist: (diagnostic.candidates as Row[]).map(item => ({ title: item.title, similarity: item.similarity })) };
    } finally { process.env.ASSISTANT_KNOWLEDGE_PROVIDER = BAILIAN_RAG; }
  });

  function checkBlocked(result: Awaited<ReturnType<typeof turn>>) {
    assert.equal(result.run.outputMessageId, null, JSON.stringify(result));
    assert.equal(result.run.status, 'indeterminate');
    assert.equal(result.run.errorCode, 'provider_outcome_unknown');
    const audit = result.receipt.steps.find(step => step.kind === 'execution')?.input_summary as Row;
    assert.equal(audit.fallbackBlocked, 'context_changed', JSON.stringify(result.receipt.steps));
    assert.equal((audit.modelFailure as Row).code, 'PROVIDER_TIMEOUT');
    assert.equal(result.receipt.quota.status, 'reconciling');
    return { run: result.run.id, audit, attempts: result.receipt.attempts };
  }
  const bathCitationId = String(fallbackBath.citation.id);
  await check('membership_change_blocks_reuse_and_reopen', async () => {
    const fresh = await anotherConversation(bath);
    mode = 'timeout';
    beforeText = () => bath.access(false);
    try {
      const result = checkBlocked(await turn(fresh, qCompany));
      const opened = await bath.chat.citation(bathCitationId);
      assert.deepEqual([opened.available, (opened as Row).reason], [false, 'source_unavailable']);
      return { ...result, citation: opened };
    } finally { await bath.access(true); }
  });
  await check('stage_change_blocks_reuse_and_next_turn', async () => {
    const fresh = await anotherConversation(bath);
    mode = 'timeout';
    beforeText = () => bath.stage('painting');
    try {
      const result = checkBlocked(await turn(fresh, qCompany));
      await assert.rejects(fresh.chat.send(fresh.conversation, randomUUID(), textBlock(qCompany)),
        (e: unknown) => (e as Row).code === 'provider_outcome_unknown');
      const followup = await turn(bath, '那按我们公司的防水资料，后续检查还由项目团队安排吗？');
      assert.equal(followup.run.answerKind, 'insufficient_evidence', JSON.stringify(followup));
      assert.deepEqual(followup.receipt.attempts, []);
      const opened = await bath.chat.citation(bathCitationId);
      assert.equal(opened.available, false);
      return { ...result, newRun: followup.run.id, newAnswer: followup.run.answerKind, citation: opened };
    } finally { await bath.stage('waterproof'); }
  });
  await check('retired_source_is_not_reused', async () => {
    await store.execute('retire', { documentId: compiled.bath.documentId, expectedVersion: compiled.bath.expectedVersion }, randomUUID());
    const signed = await mini(bath), opened = await signed.citation(bathCitationId);
    assert.deepEqual([opened.available, (opened as Row).reason], [false, 'source_unavailable']);
    const history = (await signed.messages()).items.find(item => item.id === fallbackBath.message);
    assert.ok(history && !history.available);
    assert.ok(!JSON.stringify(history.content).includes(String(fallbackBath.citation.quote)));
    const question = '刚才的防水资料撤下了，那原先卫生间施工和后续检查由谁安排？';
    const followup = await turn(bath, question, signed);
    assert.equal(followup.run.answerKind, 'insufficient_evidence');
    assert.deepEqual(followup.receipt.attempts, []);
    await assert.rejects(outside.chat.citation(bathCitationId), (e: unknown) => (e as Row).code === 'assistant_resource_not_found');
    return { citation: opened, historyHidden: true, nextRun: followup.run.id, verdict: followup.run.answerKind };
  });

  for (const [name, native] of [
    ['native_executor_recovers_after_successful_tool_read', true],
    ['legacy_langgraph_recovers_after_successful_tool_read', false],
  ] as const) await check(name, async () => {
    const config = { enterpriseKnowledgeEnabled: true, runtime: 'langgraph-v1', providerKey, model: modelName,
      tools: true, imageInput: false, probeVersion: 'I7520 synthetic transport, no model quality claim' };
    const eid = a.enterpriseId;
    const setConfig = (config: Row) => withTenantTransaction(eid, tx => tx.execute(sql`update app.assistant_enterprise_settings
      set agent_config=${JSON.stringify(config)}::jsonb where enterprise_id=${eid}`));
    if (native) {
      writeFileSync(deployment, JSON.stringify({ agentV2: { protocol: 'fastgpt-agent-v2-v1', enterpriseId: eid, model: modelName,
        appId: '1234567890abcdef12345678', runtime: 'langgraph-v1', bridgeKey: 'synthetic-not-an-external-auth-key' } }), { flag: 'wx' });
      process.env.XIAOK_FASTGPT_WORKFLOWS_FILE = deployment;
    }
    await setConfig(config);
    try {
      mode = 'native_search';
      const start = dispatched.length;
      const fresh = await anotherConversation(wet);
      const result = await turn(fresh, qWater, await mini(fresh));
      const answer = facts(result, 'PROVIDER_TIMEOUT');
      assert.deepEqual(result.receipt.attempts.map(attempt => attempt.status), ['succeeded', 'unknown']);
      assert.equal(result.receipt.steps.find(step => step.kind === 'agent_model' && step.status === 'indeterminate')?.provider_attempt_id,
        result.receipt.attempts[1].id);
      assert.equal(dispatched.length - start, 2);
      assert.equal(retrieval(result).provider, BAILIAN_RAG);
      return { run: result.run.id, modelAttempts: result.receipt.attempts, retrieval: retrieval(result), answer: answer.answer };
    } finally {
      delete process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
      await setConfig({ enterpriseKnowledgeEnabled: true });
    }
  });
  await check('immutable_citation_and_execution_boundaries', async () => {
    assert.equal(await claimJob({ enterpriseId: bath.actor.enterpriseId, runId: String(rejected.run) }), null);
    assert.equal((await bath.chat.run(String(rejected.run))).status, 'failed');
    const cite = await withTenantTransaction(a.enterpriseId, tx => one(tx, sql`select c.source_hash,c.quote_snapshot,k.text,k.content_hash
      from app.assistant_message_citations c join app.assistant_knowledge_chunks k
      on k.enterprise_id=c.enterprise_id and k.id=c.chunk_id where c.enterprise_id=${a.enterpriseId} and c.id=${bathCitationId}`));
    assert.ok(cite);
    assert.equal(cite.source_hash, fingerprint(cite.text));
    assert.equal(cite.source_hash, fallbackBath.citation.sourceHash);
    assert.equal(cite.content_hash, fallbackBath.citation.contentHash);
    assert.equal(cite.quote_snapshot, fallbackBath.citation.quote);
    const state = await databaseState();
    assert.deepEqual(state, { tenants: 3, real: 0, active: 0, mappings: 1, platformConfig: 0 });
    assert.equal(blockedNetwork, 0);
    return { state, callerIsolation: 'loopback DB and embedding, in-process transport fixtures only', storedHash: cite.source_hash };
  });
}

function databaseState() {
  return withPlatformTransaction(tx => one(tx, sql`select
    (select count(*)::int from app.enterprises) as tenants,
    (select count(*)::int from app.enterprises where id=1454) as real,
    (select count(*)::int from app.assistant_jobs where status in ('queued','running')) as active,
    (select count(*)::int from app.assistant_platform_knowledge_library) as mappings,
    (select count(*)::int from app.platform_configs) as "platformConfig"`));
}

async function main() {
  const before = sourceBinding();
  const appDb = new pg.Client({ connectionString: target.href, connectionTimeoutMillis: 4000, statement_timeout: 10000 });
  const ownerDb = new pg.Client({ connectionString: owner.href, connectionTimeoutMillis: 4000, statement_timeout: 10000 });
  try {
    await check('isolation_PG17_ledger_and_embedding_identity', async () => {
      await Promise.all([appDb.connect(), ownerDb.connect()]);
      const { rows: [info] } = await appDb.query(`select current_database() as db,current_user as role,
        current_setting('server_version_num')::int as version,shobj_description(oid,'pg_database') as purpose,
        (select extversion from pg_extension where extname='vector') as vector,
        (select rolsuper or rolbypassrls from pg_roles where rolname=current_user) as privileged from pg_database where datname=current_database()`);
      assert.deepEqual([info.db, info.role, info.privileged, info.vector], [target.pathname.slice(1), 'sfp_app', false, '0.8.2']);
      assert.ok(info.version >= 170000 && info.version < 180000);
      assert.match(info.purpose, /^xiaok-i7520-/u);
      const { rows: [locked] } = await appDb.query("select pg_try_advisory_lock(hashtext('assistant_isolated_acceptance')) as ok");
      assert.equal(locked.ok, true);
      const { rows: [ownerInfo] } = await ownerDb.query(`select current_database() as db,current_user as role,
        (select rolsuper or rolbypassrls from pg_roles where rolname=current_user) as privileged`);
      assert.deepEqual(ownerInfo, { db: info.db, role: 'sfp_migrator', privileged: false });
      const { rows: [ledger] } = await appDb.query(`select count(*)::int count,max(id) last,jsonb_agg(m order by id)::text receipt
        from (select id,hash,created_at::text from app.__drizzle_migrations) m`);
      assert.deepEqual([ledger.count, ledger.last, sha(ledger.receipt)], [129, 135, ledgerDigest]);
      assert.deepEqual(await databaseState(), { tenants: 0, real: 0, active: 0, mappings: 0, platformConfig: 0 });
      const health = await originalFetch(new URL('/health', embeddingUrl), {
        headers: { Authorization: 'Bearer ' + process.env.ASSISTANT_EMBEDDING_API_KEY },
      });
      assert.equal(health.ok, true);
      const embedding = await health.json();
      assert.deepEqual([embedding.model, embedding.revision, embedding.dimensions],
        ['Qwen/Qwen3-Embedding-0.6B', '97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3', 1024]);
      return { info, migrations: ledger.count, ledgerDigest, sourcePptHash: sources, embedding };
    });
    installTransportFixtures();
    await exercise(ownerDb);
  } catch (error) {
    if (cases.at(-1)?.status !== 'failed') cases.push({ name: 'execution', status: 'failed', evidence: String(error) });
    console.error(error);
    process.exitCode = 1;
  } finally {
    globalThis.fetch = originalFetch;
    await Promise.all([appDb.end(), ownerDb.end(), closePostgresPool()]);
    const after = sourceBinding();
    if (before !== after) {
      cases.push({ name: 'input_drift', status: 'failed', evidence: { before, after } });
      process.exitCode = 1;
    }
    writeFileSync(output, JSON.stringify({ providerEvidence: 'simulated HTTP', realModelStatus: 'not_run',
      before, after, blockedNetwork, embeddings, hostedFixtureRequests: cloud.calls.length, textFixtureRequests: dispatched, cases },
    (_key, val) => typeof val === 'bigint' ? String(val) : val, 2) + '\n');
  }
}
void main();
