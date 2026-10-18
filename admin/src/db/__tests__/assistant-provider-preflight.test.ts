import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { one, rows } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { getPlatformLlmRuntimeConfig, savePlatformLlmConfig } from '@/lib/platform-llm-config';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import type { ActorContext } from '@/lib/assistant/contracts';
import { focusedSynthesisMessages } from '@/lib/assistant/agent/synthesis';
import { synthesisTextBytes } from '@/lib/assistant/agent/synthesis-projection';
import type { ModelMessage } from '@/lib/assistant/contracts/model';

const prefix = 'synthetic-provider-preflight-' + randomUUID();
const config = { runtime: 'langgraph-v1', providerKey: 'deepseek', model: 'deepseek-flash', tools: true, imageInput: false, probeVersion: 'synthetic-no-network-v1' };
let enterpriseId = '', userId = '';
let prior: Awaited<ReturnType<typeof getPlatformLlmRuntimeConfig>> | undefined;
const provider = (model: string) => savePlatformLlmConfig({ enabled: true, providerKey: 'deepseek', baseUrl: 'https://api.deepseek.com', model, apiKey: 'synthetic-preflight-no-network' });
before(async () => {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.equal(target.port, '55432'); assert.equal(target.pathname, '/xiaok_embedding_eval');
  prior = await getPlatformLlmRuntimeConfig(); await provider('deepseek-flash');
  await withPlatformTransaction(async tx => {
    enterpriseId = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix},${prefix},'active') returning id`))!.id);
    userId = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!.id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${userId},${prefix})`);
  });
  await withTenantTransaction(enterpriseId, tx => tx.execute(sql`insert into app.assistant_enterprise_settings
    (enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
    values(${enterpriseId},true,100,12000000,1000000000,30,${JSON.stringify(config)}::jsonb)`));
});
after(async () => {
  try {
    await withPlatformTransaction(async tx => {
      if (enterpriseId) { await deleteAssistantData(tx, BigInt(enterpriseId)); await tx.execute(sql`delete from app.enterprises where id=${enterpriseId}`); }
      if (userId) await tx.execute(sql`delete from app.users where id=${userId}`);
    });
  } finally { try { if (prior) await savePlatformLlmConfig(prior); } finally { await closePostgresPool(); } }
});

test('a known first round followed by a local pre-dispatch failure is failed, while prior usage and cost reconciliation remain intact', async t => {
  const actor: ActorContext = { enterpriseId, principal: { kind: 'user', userId }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
  const chat = new ConversationService(actor), cid = String((await chat.create(randomUUID())).id);
  const sent = await chat.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '请记录：书房单人办公。' }] });
  const lease = await claimJob(); assert.equal(lease?.runId, String(sent.runId));
  let http = 0;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(new URL(String(url)).origin, 'https://api.deepseek.com');
    assert.equal(JSON.parse(String(init?.body)).model, 'deepseek-flash');
    // A deployment model override can legitimately hide a stored model edit.
    // Change provider identity as well to force an actual pre-dispatch mismatch.
    http++; await savePlatformLlmConfig({ enabled: true, providerKey: 'custom', baseUrl: 'https://example.invalid',
      model: 'synthetic-changed-after-known-response', apiKey: 'synthetic-preflight-no-network' });
    return Response.json({ id: 'synthetic-known-response', choices: [{ message: { content: '', tool_calls: [{
      id: 'need', type: 'function', function: { name: 'record_need', arguments: JSON.stringify({ room: '书房', field: 'use', value: '单人办公', quote: '书房单人办公。' }) },
    }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 4 } });
  });
  await processAgentAnswer(lease!);
  const run = await chat.run(String(sent.runId));
  assert.equal(run.status, 'failed'); assert.equal(http, 1);
  const evidence = await withTenantTransaction(enterpriseId, async tx => ({
    steps: await rows(tx, sql`select status from app.assistant_run_steps where run_id=${String(sent.runId)} and kind='agent_model'`),
    attempts: await rows(tx, sql`select status,actual_cost from app.ai_provider_attempts where assistant_run_id=${String(sent.runId)}`),
    quota: await one(tx, sql`select status,settled_cost_micros from app.assistant_quota_reservations where run_id=${String(sent.runId)}`),
    usage: await rows(tx, sql`select input_tokens,output_tokens from app.assistant_usage_records where run_id=${String(sent.runId)}`),
  }));
  assert.deepEqual(evidence.steps, [{ status: 'succeeded' }]);
  assert.equal(evidence.attempts.length, 1); assert.equal(evidence.attempts[0].status, 'succeeded');
  assert.deepEqual(evidence.attempts[0].actual_cost, { measurementKind: 'unavailable' });
  assert.equal(evidence.quota?.status, 'reconciling'); assert.equal(evidence.quota?.settled_cost_micros, null);
  assert.ok(evidence.usage.some(u => Number(u.input_tokens) === 10 && Number(u.output_tokens) === 4));
});

test('an oversized later turn creates no attempt or provider marker and preserves the earlier unsettled call', async t => {
  await provider('deepseek-flash');
  const actor: ActorContext = { enterpriseId, principal: { kind: 'user', userId }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
  const chat = new ConversationService(actor), cid = String((await chat.create(randomUUID())).id);
  const sent = await chat.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '请记录：书房单人办公。' }] });
  const lease = await claimJob(); assert.equal(lease?.runId, String(sent.runId));
  let http = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    http++;
    // Deliberately large synthetic provider text, within its parser's character
    // bound. It is not user fact or a claim about the real model's output size.
    return Response.json({ id: 'synthetic-budget-response', choices: [{ message: {
      content: '用于无网络预算测试的供应商响应。'.repeat(500), tool_calls: [{ id: 'need', type: 'function',
        function: { name: 'record_need', arguments: JSON.stringify({ room: '书房', field: 'use', value: '单人办公', quote: '书房单人办公。' }) } }],
    }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 4 } });
  });
  await processAgentAnswer(lease!);
  const evidence = await withTenantTransaction(enterpriseId, async tx => ({
    run: await one(tx, sql`select status,error_code,trigger_message_id::text from app.assistant_runs where id=${String(sent.runId)}`),
    steps: await rows(tx, sql`select kind,status,step_seq,input_summary,private_checkpoint from app.assistant_run_steps where run_id=${String(sent.runId)}`),
    attempts: await rows(tx, sql`select status,actual_cost,metadata from app.ai_provider_attempts where assistant_run_id=${String(sent.runId)}`),
    quota: await one(tx, sql`select status,settled_cost_micros from app.assistant_quota_reservations where run_id=${String(sent.runId)}`),
  }));
  assert.equal(evidence.run?.status, 'failed'); assert.equal(evidence.run?.error_code, 'agent_input_limit'); assert.equal(http, 1);
  const checkpoint = evidence.steps.find(s => s.kind === 'agent_checkpoint')!.private_checkpoint as { messages: ModelMessage[] };
  assert.ok(synthesisTextBytes(focusedSynthesisMessages(checkpoint.messages, String(evidence.run!.trigger_message_id))) > 48000);
  assert.deepEqual(evidence.steps.filter(s => s.kind === 'agent_model').map(s => ({ status: s.status, seq: Number(s.step_seq) })), [{ status: 'succeeded', seq: 1100 }]);
  assert.equal(evidence.attempts.length, 1); assert.equal(evidence.attempts[0].status, 'succeeded');
  assert.deepEqual(evidence.attempts[0].actual_cost, { measurementKind: 'unavailable' });
  assert.equal(evidence.quota?.status, 'reconciling'); assert.equal(evidence.quota?.settled_cost_micros, null);
});

test('a dispatched ambiguous HTTP failure remains indeterminate, unretryable and unreconciled', async t => {
  await provider('deepseek-flash');
  const actor: ActorContext = { enterpriseId, principal: { kind: 'user', userId }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
  const chat = new ConversationService(actor), cid = String((await chat.create(randomUUID())).id);
  const sent = await chat.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '书房如何保留通道？' }] });
  const lease = await claimJob(); assert.equal(lease?.runId, String(sent.runId));
  let http = 0;
  t.mock.method(globalThis, 'fetch', async () => { http++; return new Response('synthetic gateway timeout', { status: 504 }); });
  await processAgentAnswer(lease!);
  assert.equal((await chat.run(String(sent.runId))).status, 'indeterminate');
  await assert.rejects(chat.run(String(sent.runId), 'retry', randomUUID()), /context_changed/);
  assert.equal(http, 1);
  const evidence = await withTenantTransaction(enterpriseId, async tx => ({
    attempts: await rows(tx, sql`select status,actual_cost from app.ai_provider_attempts where assistant_run_id=${String(sent.runId)}`),
    quota: await one(tx, sql`select status,settled_cost_micros from app.assistant_quota_reservations where run_id=${String(sent.runId)}`),
  }));
  assert.deepEqual(evidence.attempts, [{ status: 'unknown', actual_cost: {} }]);
  assert.equal(evidence.quota?.status, 'reconciling'); assert.equal(evidence.quota?.settled_cost_micros, null);
});
