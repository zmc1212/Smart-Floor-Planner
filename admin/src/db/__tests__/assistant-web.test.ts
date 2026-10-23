import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { searchWeb, type WebQuery, type WebSearchSnapshot } from '@/lib/assistant/agent/web';
import { readMemory } from '@/lib/assistant/agent/memory';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { safeText, type ActorContext } from '@/lib/assistant/contracts';
import type { ModelMessage, ModelTurnOutput } from '@/lib/assistant/contracts/model';

const prefix = 'synthetic-web-evidence-' + randomUUID(), fixtures: Array<{ enterpriseId: string; userId: string; conversationId: string }> = [];
let runId: string, citationId: string, searches = 0;
const question = '查询厂家公开网页说明并解释地暖选材的适用条件，这轮不保存、不安排施工。';
const content = { version: 1 as const, blocks: [{ type: 'text' as const, text: question }] }, requestKey = randomUUID();
const actor = (fixture = fixtures[0]): ActorContext => ({ enterpriseId: fixture.enterpriseId, principal: { kind: 'user', userId: fixture.userId }, contextVersion: 1, capabilities: ['assistant.chat.self'] });
const chat = (fixture = fixtures[0]) => new ConversationService(actor(fixture));
const turn = (name: string, input: unknown): ModelTurnOutput => ({ text: '', toolCalls: [{ id: randomUUID(), name, arguments: JSON.stringify(input) }], usage: null, providerRequestId: null, finishReason: 'tool_calls' });
const sources = (messages: ModelMessage[]) => messages.flatMap(message => message.role === 'tool' ? JSON.parse(message.content).synthesisSources || [] : []) as Array<{ sourceId: string; kind: string; citationOptions: Array<{ citationId: string }> }>;
const web = async (query: WebQuery): Promise<WebSearchSnapshot> => {
  searches++;
  return searchWeb(query, { name: 'labelled-synthetic-service', search: async () => [{ title: '未使用的搜索摘要', url: 'https://manufacturer.example/floor' }] }, async url => ({ url, type: 'text/html',
    body: '<html><head><title>测试厂家地暖条件</title></head><body><main><p>所选地板型号需支持地暖，并按厂家说明核对基层条件。型号适用不等于这个客户家的基层已满足条件，仍须实际核对。</p></main></body></html>' }));
};

before(async () => {
  const url = new URL(resolvePostgresRuntimeConfig().connectionString); assert.equal(url.port, '55432'); assert.equal(url.pathname, '/xiaok_embedding_eval');
  for (let index = 0; index < 3; index++) {
    const fixture = { enterpriseId: '', userId: '', conversationId: '' }; fixtures.push(fixture);
    await withPlatformTransaction(async tx => {
      fixture.enterpriseId = index === 1 ? fixtures[0].enterpriseId : String((await one(tx, sql`insert into app.enterprises(name,code,status)
        values(${prefix + index},${prefix + index},'active') returning id`))!.id);
      fixture.userId = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix + index},1) returning id`))!.id);
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${fixture.userId},${prefix + index})`);
      if (index !== 1) await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
        values(${fixture.enterpriseId},true,100,1000000,1000000000,30,'{"runtime":"langgraph-v1","providerKey":"siliconflow","model":"THUDM/GLM-4-9B-0414","tools":true,"imageInput":false,"probeVersion":"synthetic-no-provider"}'::jsonb)`);
    });
    fixture.conversationId = String((await chat(fixture).create(randomUUID())).id);
  }
  console.log('SYNTHETIC_WEB_FIXTURES ' + JSON.stringify(fixtures));
});
after(async () => {
  try {
    await withPlatformTransaction(async tx => {
      for (const enterpriseId of new Set(fixtures.map(f => f.enterpriseId).filter(Boolean))) {
        await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${enterpriseId}`);
        assert.equal((await one(tx, sql`select count(*)::int n from app.assistant_jobs where enterprise_id=${enterpriseId} and status in ('queued','running')`))?.n, 0);
        assert.equal((await one(tx, sql`select count(*)::int n from app.ai_provider_attempts where enterprise_id=${enterpriseId}`))?.n, 0);
      }
      for (const fixture of fixtures) if (fixture.userId) await tx.execute(sql`update app.users set context_version=context_version+1 where id=${fixture.userId}`);
    });
  } finally { await closePostgresPool(); }
});

test('actual web read persists through the original Agent service, citation endpoint and reentry without fake knowledge rows', async () => {
  const sent = await chat().send(fixtures[0].conversationId, requestKey, content), lease = await claimJob();
  assert.ok(lease); runId = String(sent.runId); assert.equal(lease.runId, runId); let calls = 0;
  await processAgentAnswer(lease, { webSearch: web, model: async messages => {
    if (calls++ === 0) return turn('search_web', { query: '地暖地板 厂家适用条件', domains: ['manufacturer.example'] });
    const source = sources(messages).find(s => s.kind === 'web'); assert.ok(source);
    return turn('final_response', { kind: 'synthesis', segments: [{ basis: 'evidence', text: '厂家说明要求先核对所选型号与基层条件，型号适用不等于实际现场已经符合要求。', citations: [{ citationId: source.citationOptions[0].citationId }] },
      { basis: 'advice', text: '可以先按清洁需求和脚感偏好比较方案，再核对具体型号，暂不把选材意向当作施工结论。', citations: [] }] });
  } });
  assert.equal((await chat().run(runId)).status, 'succeeded'); assert.equal(calls, 2); assert.equal(searches, 1);
  const history = await chat().messages(fixtures[0].conversationId), answer = history.items.find(m => m.authorKind === 'assistant')!;
  assert.equal(answer.available, true); assert.equal(answer.citations.length, 1); citationId = answer.citations[0].id;
  assert.match(citationId, /^w:/); assert.match(safeText(answer.content as Parameters<typeof safeText>[0]), /型号适用不等于实际现场/);
  const citation = await chat().citation(citationId); assert.ok(citation.available && 'sourceLocation' in citation);
  assert.match(String(citation.sourceLocation), /https:\/\/manufacturer.example\/floor/); assert.match(String(citation.sourceLocation), /读取时间/);
  assert.equal((await chat().messages(fixtures[0].conversationId)).items.find(m => m.id === answer.id)?.available, true);
  const replay = await chat().send(fixtures[0].conversationId, requestKey, content); assert.equal(replay.runId, runId); assert.equal(searches, 1);
  await withTenantTransaction(fixtures[0].enterpriseId, async tx => {
    assert.equal((await one(tx, sql`select count(*)::int n from app.assistant_message_citations where enterprise_id=${fixtures[0].enterpriseId} and run_id=${runId}`))?.n, 0);
    assert.equal((await one(tx, sql`select count(*)::int n from app.assistant_run_steps where enterprise_id=${fixtures[0].enterpriseId} and run_id=${runId} and capability_name='web.search.v1' and status='succeeded'`))?.n, 1);
    assert.equal((await one(tx, sql`select count(*)::int n from app.assistant_usage_records where enterprise_id=${fixtures[0].enterpriseId} and run_id=${runId} and category='web_search'`))?.n, 1);
    assert.equal(readMemory((await one(tx, sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${fixtures[0].enterpriseId} and id=${fixtures[0].conversationId}`))?.entry_snapshot).version, 0);
  });
});

test('valid same-tenant other customer and cross-tenant identities cannot read the web citation or conversation', async () => {
  for (const fixture of fixtures.slice(1)) {
    await assert.rejects(chat(fixture).citation(citationId), /assistant_resource_not_found/);
    await assert.rejects(chat(fixture).messages(fixtures[0].conversationId), /assistant_resource_not_found/);
  }
});

test('ordinary model advice needs no retrieval or business action', async () => {
  const sent = await chat().send(fixtures[0].conversationId, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '这是独立问题，不结合我家或项目。想听一般建议：木地板与瓷砖如何比较日常清洁和脚感？不保存、不安排。' }] });
  const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
  await processAgentAnswer(lease, { webSearch: async () => { throw Error('Unnecessary web read'); }, model: async () => turn('final_response', {
    kind: 'synthesis', segments: [{ basis: 'advice', text: '可先按脚感偏好和清洁习惯比较，再核对具体产品的维护要求；先确定更在意的日常体验，不必把一般选材讨论变成项目安排。', citations: [] }],
  }) });
  assert.equal((await chat().run(String(sent.runId))).status, 'succeeded');
  const steps = await withTenantTransaction(fixtures[0].enterpriseId, tx => rows(tx, sql`select kind,capability_name from app.assistant_run_steps where enterprise_id=${fixtures[0].enterpriseId} and run_id=${String(sent.runId)}`));
  assert.ok(!steps.some(s => s.kind === 'retrieval' || s.kind === 'agent_tool' || s.kind === 'agent_need_write'));
});

test('unavailable free search yields truthful feedback without a fabricated webpage, citation or paid fallback', async () => {
  const sent = await chat().send(fixtures[0].conversationId, randomUUID(), { version: 1, blocks: [{ type: 'text', text: question }] });
  const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId); let calls = 0;
  await processAgentAnswer(lease, { webSearch: async query => ({ version: 1, provider: 'synthetic-unavailable', query, status: 'unavailable', pages: [], failures: [{ code: 'web_search_http_429' }], retrievedAt: new Date().toISOString() }),
    model: async () => calls++ === 0 ? turn('search_web', { query: '地暖地板 厂家适用条件', domains: [] }) : turn('final_response', {
      kind: 'synthesis', segments: [{ basis: 'uncertainty', text: '本次未读到厂家原文，暂不能据此确认具体型号对地暖的适用性。', citations: [] }],
    }) });
  assert.equal((await chat().run(String(sent.runId))).status, 'succeeded'); assert.equal(calls, 2);
  const history = await chat().messages(fixtures[0].conversationId), latest = history.items.find(m => m.authorKind === 'assistant')!;
  assert.equal(latest.citations.length, 0); assert.match(safeText(latest.content as Parameters<typeof safeText>[0]), /本次未读到厂家原文/);
});

test('retention removal of the captured source invalidates the derived reply and source reentry', async () => {
  await withTenantTransaction(fixtures[0].enterpriseId, tx => tx.execute(sql`update app.assistant_run_steps set private_checkpoint=null
    where enterprise_id=${fixtures[0].enterpriseId} and run_id=${runId} and capability_name='web.search.v1'`));
  assert.equal((await chat().citation(citationId)).available, false);
  assert.ok((await chat().messages(fixtures[0].conversationId)).items.some(m => !m.available));
});
