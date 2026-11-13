import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { sql } from 'drizzle-orm';
import { loadEnvConfig } from '@next/env';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { getPlatformLlmRuntimeConfig } from '@/lib/platform-llm-config';
import { bailianResponsesBinding } from '@/lib/ai/providers/bailian-responses-capabilities';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { safeText, type ActorContext, type MessageContent } from '@/lib/assistant/contracts';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { assistantHttp } from '@/lib/assistant/application/http';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAnswer } from '@/lib/assistant/infrastructure/answer-worker';
import { naturalKnowledgeProtocol, sourceBoundaryValidationProtocol } from '@/lib/assistant/agent/knowledge-explanation';

loadEnvConfig(process.cwd());

const enterpriseId = '1454';
const logicalModel = 'deepseek-flash';
const model = 'deepseek-v4.1-flash-1017';
const providerKey = 'bailian';
const question = 'GB 55030-2022 目前是否有效？它什么时候实施？适用于哪些工程？';
const label = process.argv.find(arg => arg.startsWith('--label='))?.slice(8) ?? 'g-standard';
assert.match(label, /^[a-z0-9-]{1,72}$/);
const target = new URL(process.env.XIAOK_I614_DATABASE_URL ?? 'http://missing');
assert.equal(target.protocol, 'postgresql:');
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.username, 'sfp_app');
assert.ok(Number(target.port) >= 49152 && !target.search && !target.hash);
assert.match(target.pathname, /^\/xiaok_r6_(?:acceptance|model|hosted)(?:_[a-z0-9]+)?$/);

const output = 'tmp/i6.14/' + label;
mkdirSync(output, { recursive: true });
const json = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2);
const save = (name: string, value: unknown) => writeFileSync(output + '/' + name + '.json', json(value), { flag: 'wx' });
const block = (text: string): MessageContent => ({ version: 1, blocks: [{ type: 'text', text }] });

async function configure() {
  await closePostgresPool();
  process.env.DATABASE_URL = target.href;
  const upstream = await getPlatformLlmRuntimeConfig();
  assert.ok(upstream?.providerKey === providerKey && upstream.model === model && upstream.apiKey, 'I6.14 isolated Bailian credential is not configured');
  assert.ok(bailianResponsesBinding(upstream.baseUrl, model), 'Bailian Responses endpoint cannot be selected');
  process.env.ASSISTANT_RESPONSES_API = '1';
  process.env.ASSISTANT_RESPONSES_MAX_RETRIES = '0';
  process.env.ASSISTANT_TEXT_DISABLE_THINKING = '1';
  process.env.ASSISTANT_REQUESTS_PER_MINUTE = '120';
  process.env.ASSISTANT_WEB_SEARCH_TOOLS = '1';
  process.env.ASSISTANT_KNOWLEDGE_PROVIDER = 'local';
  process.env.AI_ASSET_STORAGE_DIR = output + '/media';
  for (const key of ['ASSISTANT_TEXT_MODEL', 'XIAOK_FASTGPT_WORKFLOWS_FILE', 'XIAOK_FASTGPT_RAG_FILE',
    'XIAOK_FASTGPT_RETRIEVAL_FILE', 'ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS']) delete process.env[key];
  return withPlatformTransaction(async tx => {
    const identity = await one(tx, sql`select current_database() as name,current_user as role,
      (select rolsuper or rolbypassrls from pg_roles where rolname=current_user) as bypass,
      (select count(*)::int from app.enterprises) as enterprises,
      (select count(*)::int from app.assistant_jobs where status in ('queued','running')) as open_jobs`);
    assert.deepEqual(identity, { name: target.pathname.slice(1), role: 'sfp_app', bypass: false, enterprises: 1, open_jobs: 0 });
    const config = { runtime: 'langgraph-v1', providerKey, model, tools: true, imageInput: false,
      probeVersion: 'i6.14-g', enterpriseKnowledgeEnabled: false,
      knowledgeExplanation: naturalKnowledgeProtocol, knowledgeAnswerValidation: sourceBoundaryValidationProtocol };
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
      values(${enterpriseId},true,200,12000000,1000000000,30,${json(config)}::jsonb)`);
    return identity;
  });
}

async function fixture() {
  const tag = 'I6.14 合成标准现行性 ' + label;
  const { uid, lead } = await withPlatformTransaction(async tx => {
    const uid = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${tag},1) returning id`))!.id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${'i614-' + randomUUID()})`);
    const lead = String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
      values(${enterpriseId},${uid},${tag},'13800000000','natural') returning id`))!.id);
    return { uid, lead };
  });
  const actor: ActorContext = { enterpriseId, principal: { kind: 'user', userId: uid }, contextVersion: 1,
    capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: lead } };
  const chat = new ConversationService(actor), cid = String((await chat.create(randomUUID())).id);
  const token = await signMiniProgramToken({ sub: uid, id: uid, mode: 'customer', role: 'user', contextVersion: 1, source: 'wechat' });
  return { uid, lead, actor, chat, cid, token, tag };
}

const assistant = (f: Awaited<ReturnType<typeof fixture>>, path: string[], body?: Row, key = randomUUID()) => assistantHttp(new Request(
  'http://127.0.0.1/api/miniprogram/assistant/' + path.join('/'), { method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + f.token, 'Idempotency-Key': key, 'Content-Type': 'application/json' },
    ...(body ? { body: json(body) } : {}) }), path);

async function main() {
  const database = await configure();
  const f = await fixture();
  const key = randomUUID();
  const response = await assistant(f, ['conversations', f.cid, 'messages'], { clientMessageId: key, content: block(question) }, key);
  assert.equal(response.status, 202, await response.clone().text());
  const sent = (await response.json()).data as Row;
  assert.ok(sent.runId, json(sent));
  const lease = await claimJob();
  assert.equal(lease?.runId, sent.runId);
  let workerError: string | null = null;
  try {
    await processAnswer(lease!);
  } catch (error) {
    workerError = String(error);
  }
  // A run that has not reached a terminal state is polled only for the local
  // worker lease; no provider request is repeated here.
  for (let attempt = 0; attempt < 200 && workerError === null; attempt++) {
    const state = await withTenantTransaction(enterpriseId, tx => one(tx, sql`select status from app.assistant_runs
      where enterprise_id=${enterpriseId} and id=${String(sent.runId)}`));
    if (state?.status !== 'running' && state?.status !== 'queued') break;
    await delay(1000);
  }
  const ledger = await withTenantTransaction(enterpriseId, async tx => ({
    run: await one(tx, sql`select status,output_message_id::text,error_code from app.assistant_runs where enterprise_id=${enterpriseId} and id=${String(sent.runId)}`),
    steps: await rows(tx, sql`select kind,capability_name,status,input_summary,private_checkpoint,source_refs from app.assistant_run_steps
      where enterprise_id=${enterpriseId} and run_id=${String(sent.runId)} order by step_seq`),
    attempts: await rows(tx, sql`select id::text,status,accepted,error_code,remote_model,metadata from app.ai_provider_attempts
      where enterprise_id=${enterpriseId} and assistant_run_id=${String(sent.runId)} order by id`),
    usage: await rows(tx, sql`select category,quantity,measurement_kind,input_tokens,output_tokens,cost_micros from app.assistant_usage_records
      where enterprise_id=${enterpriseId} and run_id=${String(sent.runId)} order by id`),
  }));
  const messages = (await f.chat.messages(f.cid, undefined, 100)).items as Row[];
  const answer = messages.find(message => message.id === ledger.run?.output_message_id) ?? messages.at(-1);
  save('run', { database, question, sent, answer, ...ledger, workerError });
  assert.equal(workerError, null, 'live worker failed: ' + workerError);
  assert.equal(ledger.run?.status, 'succeeded', json(ledger.run));
  assert.ok(ledger.attempts.length > 0, 'no provider attempt');
  for (const attempt of ledger.attempts) assert.equal(attempt.remote_model, model);
  assert.ok(ledger.attempts.some(attempt => attempt.status === 'succeeded' && attempt.accepted !== false), 'no accepted provider response');
  assert.ok(answer?.available, 'saved answer unavailable');
  console.log('PASS live G answer saved', sent.runId);
  console.log(safeText(answer.content as MessageContent));
  console.log(json({ citations: answer.citations, attempts: ledger.attempts.map(a => ({ status: a.status, model: a.remote_model })) }));
  await closePostgresPool();
}

main().catch(async error => {
  console.error(error);
  await closePostgresPool();
  process.exitCode = 1;
});
