import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { one, rows } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { safeText, type ActorContext, type MessageContent } from '@/lib/assistant/contracts';
import { processAnswer } from '@/lib/assistant/infrastructure/answer-worker';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { getPlatformLlmOverrideRuntime } from '@/lib/platform-llm-config';
import { closePostgresPool } from '@/lib/postgresql';

const enterpriseId = '1454';
const model = 'qwen3.7-flash';
const journeys = {
  current: [
    '我家准备装修，能查一下现在还有效的住宅装修国家标准吗？我想知道标准名称和什么时候开始实施。',
    '你刚提到的住宅项目规范，旧房只翻新卫生间也按这个执行吗？哪些条文能说明它适用什么工程？',
  ],
  workmanship: [
    '老房卫生间准备重做防水。帮我查一下公开规范，施工后怎么验收，哪些检查通过了才能铺砖？',
    '那水管穿过楼板的地方呢？有公开规范讲管根怎么处理吗？',
  ],
} as const;

const selected = process.argv.find(arg => arg.startsWith('--journey='))?.slice(10);
const label = process.argv.find(arg => arg.startsWith('--label='))?.slice(8);
assert.ok(label && /^[a-z0-9-]{1,72}$/.test(label));
assert.ok(selected && Object.hasOwn(journeys, selected));
const questions = journeys[selected as keyof typeof journeys];
const target = new URL(process.env.DATABASE_URL ?? 'http://missing');
assert.deepEqual([target.protocol, target.hostname, target.username, target.search, target.hash],
  ['postgresql:', '127.0.0.1', 'sfp_app', '', '']);
assert.ok(Number(target.port) >= 49152 && /^\/xiaok_i6_(?:web|repair)(?:_[a-z0-9]+)?$/.test(target.pathname));
const output = path.resolve('../tmp/i6-20261113/web', label);

function binding() {
  const files = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z', '--',
    'src', 'drizzle', 'scripts', 'package-lock.json', '../miniprogram']).toString().split('\0').filter(Boolean).sort();
  const hash = createHash('sha256');
  for (const file of files) hash.update(file).update('\0').update(readFileSync(file)).update('\0');
  return { files: files.length, sha256: hash.digest('hex'),
    searchProvider: process.env.ASSISTANT_WEB_SEARCH_PROVIDER, searchUrl: process.env.ASSISTANT_WEB_SEARCH_URL,
    dns: process.env.ASSISTANT_WEB_DNS ?? null, model, responses: process.env.ASSISTANT_RESPONSES_API };
}

function save(name: string, value: unknown) {
  writeFileSync(path.join(output, name + '.json'),
    JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2), { flag: 'wx' });
}

async function setup(): Promise<ActorContext> {
  const configured = await getPlatformLlmOverrideRuntime('chat');
  assert.ok(configured?.apiKey && configured.modelMappings['chat.general'] === model
    && new URL(configured.baseUrl).origin === 'https://dashscope.aliyuncs.com');
  const userId = await withPlatformTransaction(async tx => {
    const identity = await one(tx, sql`select current_database() as database, current_user as role,
      (select rolsuper or rolbypassrls from pg_roles where rolname=current_user) as bypass,
      (select count(*)::int from app.enterprises where id=1454 and code<>'i6-synthetic-web') as other,
      (select count(*)::int from app.assistant_jobs where status in ('queued','running')) as open_jobs`);
    assert.deepEqual(identity, { database: target.pathname.slice(1), role: 'sfp_app', bypass: false, other: 0, open_jobs: 0 });
    await tx.execute(sql`insert into app.enterprises(id,name,code,status) overriding system value
      values(1454,'微云 I6 合成联网验收','i6-synthetic-web','active') on conflict(id) do nothing`);
    await tx.execute(sql`insert into app.assistant_enterprise_settings
      (enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
      values(1454,true,100,2000000,1000000000,30,${JSON.stringify({
        runtime: 'langgraph-v1', providerKey: 'dashscope', model, tools: true, imageInput: false,
        probeVersion: 'i6-isolated-web', enterpriseKnowledgeEnabled: false,
      })}::jsonb) on conflict(enterprise_id) do nothing`);
    const id = String((await one(tx, sql`insert into app.users(nickname,context_version)
      values('I6 合成联网业主',1) returning id`))!.id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${id},${'i6-web-' + randomUUID()})`);
    return id;
  });
  return { enterpriseId, principal: { kind: 'user', userId }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
}

async function main() {
  process.env.ASSISTANT_RESPONSES_API = '1';
  process.env.ASSISTANT_NATIVE_TOOLS = '';
  process.env.ASSISTANT_RESPONSES_MAX_RETRIES = '0';
  process.env.ASSISTANT_TEXT_DISABLE_THINKING = '1';
  process.env.ASSISTANT_WEB_SEARCH_TOOLS = '1';
  mkdirSync(path.dirname(output), { recursive: true });
  mkdirSync(output);
  const before = binding();
  const summary = { mode: 'live', journey: selected, before, after: before,
    turns: questions.map(question => ({ question, status: 'not_run' })), error: null as string | null };
  try {
    const actor = await setup();
    const chat = new ConversationService(actor);
    const cid = String((await chat.create(randomUUID())).id);
    for (const [index, question] of questions.entries()) {
      const content: MessageContent = { version: 1, blocks: [{ type: 'text', text: question }] };
      const requestKey = randomUUID();
      const sent = await chat.send(cid, requestKey, content);
      assert.equal(typeof sent.runId, 'string');
      const runId = String(sent.runId);
      const lease = await claimJob({ enterpriseId, runId });
      assert.ok(lease);
      await processAnswer(lease);
      const { run, attempts, steps, usage } = await withTenantTransaction(enterpriseId, async tx => ({
        run: await one(tx, sql`select id::text,status,error_code,output_message_id::text
          from app.assistant_runs where enterprise_id=1454 and id=${sent.runId}`),
        attempts: await rows(tx, sql`select id::text,remote_model,status,accepted,error_code,metadata
          from app.ai_provider_attempts where enterprise_id=1454 and assistant_run_id=${sent.runId} order by id`),
        steps: await rows(tx, sql`select step_seq,kind,status,capability_name,input_summary,private_checkpoint
          from app.assistant_run_steps where enterprise_id=1454 and run_id=${sent.runId} order by step_seq`),
        usage: await rows(tx, sql`select category,measurement_kind,input_tokens,output_tokens,quantity,cost_micros
          from app.assistant_usage_records where enterprise_id=1454 and run_id=${sent.runId} order by id`),
      }));
      const history = await chat.messages(cid);
      const answer = history.items.find(item => item.id === run?.output_message_id);
      const citations = await Promise.all((answer?.citations ?? []).map(item => chat.citation(item.id)));
      const original = steps.some(step => step.capability_name === 'web.read.v1' && step.status === 'succeeded'
        && Array.isArray((step.private_checkpoint as { pages?: unknown[] } | null)?.pages)
        && (step.private_checkpoint as { pages: unknown[] }).pages.length > 0);
      const status = run?.status === 'indeterminate' ? 'unknown' : answer?.available
        && (original || index > 0) && citations.some(item => item.available && 'sourceUrl' in item) ? 'source_readback_passed' : 'failed';
      summary.turns[index].status = status;
      save('turn-' + (index + 1), { cid, question, run, attempts, steps, usage,
        answer: answer && safeText(answer.content as MessageContent), citations, status, actualCost: 'unavailable' });
      console.log(JSON.stringify({ question, cid, run, status, citations: citations.length, attempts: attempts.length }));
      if (status !== 'source_readback_passed') { process.exitCode = 1; break; }
      assert.equal((await chat.send(cid, requestKey, content)).runId, sent.runId);
    }
  } catch (error) {
    summary.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
  } finally {
    summary.after = binding();
    if (summary.before.sha256 !== summary.after.sha256) process.exitCode = 1;
    save('summary', summary);
    console.log(JSON.stringify(summary));
    await closePostgresPool();
  }
}

void main();
