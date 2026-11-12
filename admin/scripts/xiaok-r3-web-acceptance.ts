import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { getPlatformLlmRuntimeConfig, savePlatformLlmConfig } from '@/lib/platform-llm-config';
import { bailianResponsesBinding } from '@/lib/ai/providers/bailian-responses-capabilities';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { safeText, type ActorContext } from '@/lib/assistant/contracts';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAnswer } from '@/lib/assistant/infrastructure/answer-worker';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { minimalDialogueProtocol } from '@/lib/assistant/agent/minimal-dialogue';
import { configuredWebSearchProvider } from '@/lib/assistant/web-search/provider';
import type { WebSearchProvider } from '@/lib/assistant/web-search/contract';

const enterpriseId = '1454';
const controlEnterpriseId = '1455';
const model = 'qwen3.7-flash';
const live = process.argv.includes('--live');
const label = process.argv.find(arg => arg.startsWith('--label='))?.slice('--label='.length) ?? randomUUID();
assert.match(label, /^[a-z0-9-]{1,80}$/);
const output = path.resolve(process.cwd(), '../tmp/assistant-web-r3', label);
const knownUrl = 'https://maker.example/public-installation';
const r3Database = new URL(process.env.XIAOK_R3_DATABASE_URL ?? 'http://missing');
assert.ok(r3Database.protocol === 'postgresql:' && r3Database.hostname === '127.0.0.1'
  && Number(r3Database.port) >= 49152 && r3Database.pathname === '/xiaok_r3_acceptance',
  'Use a dedicated loopback database named xiaok_r3_acceptance on an ephemeral port');

const questions = [
  { id: 'ordinary', question: '家里想做温暖一点的原木风，墙面和灯光怎么搭配？', external: false },
  { id: 'owner', question: '老房的卫生间准备翻新，防水做到验收时有哪些地方值得我和师傅核对？涉及规范的地方帮我找找公开出处。', external: true },
  { id: 'designer', question: '我在给厨房选施耐德绎尚 E83426_10US_WE_C1 五孔插座。额定电流、电压和接线要求能从厂家资料核实吗？', external: true },
  { id: 'worker', question: '明天要复查卫生间的蓄水试验。公开施工规范对这一步怎么检查？我想分清规范要求和这个工地实际验收。', external: true },
  { id: 'boss', question: '我们准备选几款家装用瓷砖胶。帮我查查公开市场资料，常见产品按什么性能分，采购时要核对哪些指标？先不谈报价。', external: true },
];

function writeEvidence(name: string, value: unknown) {
  writeFileSync(path.join(output, name + '.json'), JSON.stringify(value,
    (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2), { flag: 'wx' });
}

function call(name: string, args: unknown): ModelTurnOutput {
  return { text: '', toolCalls: [{ id: randomUUID(), name, arguments: JSON.stringify(args) }],
    providerRequestId: null, usage: null, finishReason: 'tool_calls' };
}

const mockProvider: WebSearchProvider = {
  name: 'synthetic-r3-search',
  supportsNews: false,
  async search(request) {
    return { provider: this.name, query: request.query, kind: request.kind, retrievedAt: new Date().toISOString(),
      results: [{ rank: 1, title: '合成安装说明', url: knownUrl, domain: 'maker.example', snippet: '公开网页摘要', publishedAt: null }] };
  },
};

async function main() {
  const upstream = live ? await getPlatformLlmRuntimeConfig() : null;
  if (upstream) {
    assert.ok(upstream.providerKey === 'dashscope' && upstream.apiKey && bailianResponsesBinding(upstream.baseUrl, model),
      'An existing configured DashScope credential is required');
    assert.ok(configuredWebSearchProvider(), 'A reachable search service must be configured');
  }
  await closePostgresPool();
  process.env.DATABASE_URL = r3Database.href;
  delete process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
  delete process.env.ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS;
  delete process.env.ASSISTANT_TEXT_MODEL;
  process.env.ASSISTANT_WEB_SEARCH_TOOLS = '1';
  process.env.ASSISTANT_RESPONSES_API = '1';
  process.env.ASSISTANT_NATIVE_TOOLS = '';
  process.env.ASSISTANT_RESPONSES_MAX_RETRIES = '0';
  process.env.ASSISTANT_TEXT_DISABLE_THINKING = '1';
  mkdirSync(path.dirname(output), { recursive: true });
  mkdirSync(output);

  const existing = await withPlatformTransaction(tx => one(tx, sql`select
    (select count(*) from app.assistant_jobs where status in ('queued','running'))::int as queued,
    (select count(*) from app.enterprises where id in (1454,1455))::int as used`));
  assert.deepEqual(existing, { queued: 0, used: 0 }, 'Use an empty isolated acceptance database');
  if (upstream) await savePlatformLlmConfig({
    enabled: true, providerKey: upstream.providerKey, baseUrl: upstream.baseUrl, model, apiKey: upstream.apiKey,
  });

  const userId = await withPlatformTransaction(async tx => {
    await tx.execute(sql`insert into app.enterprises(id,name,code,status) overriding system value values
      (1454,'微云 R3 合成验收','synthetic-r3-weiyun','active'),
      (1455,'R3 合成对照企业','synthetic-r3-control','active')`);
    const id = String((await one(tx, sql`insert into app.users(nickname,context_version)
      values('R3 合成测试用户',1) returning id`))!.id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${id},${'synthetic-r3-' + label})`);
    await tx.execute(sql`insert into app.assistant_enterprise_settings
      (enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
      values(1454,true,100,1500000,1000000000,30,${JSON.stringify({
        runtime: 'langgraph-v1', providerKey: 'dashscope', model, tools: true, imageInput: false,
        probeVersion: minimalDialogueProtocol, enterpriseKnowledgeEnabled: false,
      })}::jsonb)`);
    return id;
  });
  const actor: ActorContext = { enterpriseId, principal: { kind: 'user', userId }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
  const chat = new ConversationService(actor);
  const counts = { passed: 0, failed: 0 };
  let mockReads = 0;

  try {
    const trials = live ? [1, 2].flatMap(round => questions.map(item => ({ ...item, round }))) : [
      { ...questions[0], round: 1 },
      { ...questions[1], id: 'batch-read', round: 1 },
      { ...questions[2], id: 'unapproved-url', round: 1 },
      { ...questions[3], id: 'forged-citation', round: 1 },
    ];
    for (const trial of trials) {
      const caseId = `round${trial.round}-${trial.id}`;
      const record: Record<string, unknown> = { trial, mode: live ? 'live' : 'mock', model: live ? model : null };
      try {
        const conversationId = String((await chat.create(randomUUID())).id);
        const requestKey = randomUUID();
        const content = { version: 1 as const, blocks: [{ type: 'text' as const, text: trial.question }] };
        const sent = await chat.send(conversationId, requestKey, content);
        record.runId = sent.runId;
        const lease = await claimJob();
        assert.ok(lease && lease.runId === sent.runId);
        if (live) await processAnswer(lease);
        else await processAgentAnswer(lease, {
          applicationWeb: {
            provider: mockProvider,
            async readPage(url) {
              mockReads++;
              assert.equal(url, knownUrl);
              return { url, type: 'text/html', body: '<html><head><title>合成安装说明</title></head><body><main>应检查防水基层是否洁净坚实，尤其注意管口及转角处的连续处理。实际交付应按已批准的工程方案执行并保留现场检查记录。</main></body></html>' };
            },
          },
          async model(messages, _tools, turn, offered) {
            if (turn === 0) {
              assert.ok(offered);
              assert.ok(offered.some(tool => tool.name === 'web_search_batch'));
              assert.ok(!offered.some(tool => tool.name === 'search_web'));
            }
            if (trial.id === 'ordinary') return call('final_response', { kind: 'general', text: '墙面可用柔和的米白，灯光以暖色为主，搭配浅木色家具。' });
            if (trial.id === 'forged-citation') return call('final_response', { kind: 'general', text: '参考资料：https://example.org/forged' });
            if (trial.id === 'unapproved-url') {
              if (turn === 0) return call('web_fetch', { url: 'https://example.org/undiscovered' });
              assert.ok(messages.some(message => message.role === 'tool' && /web_url_not_in_research_scope/.test(message.content)));
              return call('final_response', { kind: 'synthesis', segments: [{ basis: 'uncertainty', text: '本次未读到厂家原文，无法确认型号的参数。', citations: [] }] });
            }
            if (turn === 0) return call('web_search_batch', { queries: ['卫生间防水 基层要求', '卫生间防水 检查方法'] });
            if (turn === 1) {
              assert.deepEqual(offered?.map(tool => tool.name), ['web_fetch']);
              const reply = messages.find(message => message.role === 'tool');
              assert.ok(reply?.role === 'tool');
              assert.deepEqual(JSON.parse(reply.content).synthesisSources, []);
              assert.equal(JSON.parse(reply.content).result.results.length, 1);
              return call('web_fetch', { url: knownUrl });
            }
            const sources = messages.flatMap(message => message.role === 'tool' ? JSON.parse(message.content).synthesisSources ?? [] : []);
            const citationId = sources.find(source => source.kind === 'web')?.citationOptions?.[0]?.citationId;
            assert.ok(citationId);
            return call('final_response', { kind: 'synthesis', segments: [{ basis: 'evidence',
              text: '公开资料建议检查基层是否洁净坚实，核对管口和转角的连续处理。', citations: [{ citationId }] }] });
          },
        });
        const runId = String(sent.runId);
        const run = await chat.run(runId);
        const history = await chat.messages(conversationId);
        const answer = history.items.find(item => item.authorKind === 'assistant');
        const citations = await Promise.all((answer?.citations ?? []).map(async item => {
          const citation = await chat.citation(item.id);
          if (citation.available) {
            const reentry = (await chat.messages(conversationId)).items.find(message => message.id === answer!.id);
            assert.ok(reentry?.available && reentry.citations.some(entry => entry.id === item.id));
            await assert.rejects(new ConversationService({ ...actor, enterpriseId: controlEnterpriseId }).citation(item.id),
              /assistant_resource_not_found/);
          }
          return citation;
        }));
        const audit = await withTenantTransaction(enterpriseId, async tx => ({
          tools: await rows(tx, sql`select capability_name,status,input_summary->>'tool' as tool,
            private_checkpoint->>'status' as result,private_checkpoint->'pages' as pages,private_checkpoint->'failures' as failures,
            private_checkpoint#>'{r3,packet,result,perQuery}' as per_query, input_summary->'audit'->'error' as error
            from app.assistant_run_steps where enterprise_id=1454 and run_id=${runId}
            and capability_name in ('web.search.v1','web.read.v1') order by step_seq`),
          modelFrames: await rows(tx, sql`select step_seq,status,input_summary->'activeToolNames' as offered,
            private_checkpoint->'providerOutput' as output from app.assistant_run_steps
            where enterprise_id=1454 and run_id=${runId} and kind='agent_model' order by step_seq`),
          attempts: await rows(tx, sql`select id,status,error_code,remote_model,
            metadata->>'assistantWire' as wire, metadata->'assistantResponse' as response
            from app.ai_provider_attempts where enterprise_id=1454 and assistant_run_id=${runId} order by id`),
        }));
        Object.assign(record, { run, answer: answer ? safeText(answer.content as Parameters<typeof safeText>[0]) : null,
          citations, ...audit, actualCost: 'unavailable' });
        const reads = audit.tools.filter(tool => tool.capability_name === 'web.read.v1');
        if (!live && trial.id === 'forged-citation') {
          assert.equal(run.status, 'failed');
          assert.equal(answer, undefined);
        } else {
          assert.equal(run.status, 'succeeded');
          assert.ok(answer?.available);
        }
        if (!trial.external) assert.equal(audit.tools.length, 0);
        if (live && trial.external || trial.id === 'batch-read') {
          assert.ok(audit.tools.some(tool => tool.capability_name === 'web.search.v1' && tool.result === 'ready'), 'No live search results');
          assert.ok(reads.some(tool => Array.isArray(tool.pages) && tool.pages.length), 'No page original was persisted');
          assert.ok(citations.some(item => item.available && 'sourceUrl' in item && item.sourceUrl), 'No visible original URL');
        }
        if (!live && trial.id === 'unapproved-url') {
          assert.equal(reads[0].status, 'failed');
          assert.equal(mockReads, 1);
          assert.deepEqual(citations, []);
        }
        if (live && trial.external) assert.ok(audit.attempts.some(attempt => attempt.wire === 'responses'
          && JSON.stringify(attempt.response).includes('"function_call_output"')), 'No Responses tool result was sent to the model');
        const replay = await chat.send(conversationId, requestKey, content);
        assert.equal(replay.runId, runId);
        counts.passed++;
        record.status = 'passed';
      } catch (error) {
        counts.failed++;
        record.status = 'failed';
        record.error = error instanceof Error ? error.message : String(error);
      }
      writeEvidence(caseId, record);
      console.log(JSON.stringify({ caseId, status: record.status, error: record.error, runId: record.runId }));
    }
  } finally {
    await withPlatformTransaction(async tx => {
      await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=1454`);
      await tx.execute(sql`update app.users set context_version=context_version+1 where id=${userId}`);
    });
    writeEvidence('summary', counts);
    if (counts.failed) process.exitCode = 1;
  }
}
void main().catch(error => {
  // Provider configuration and credentials stay inside the process.
  console.error(error instanceof Error ? error.name + ': ' + error.message : 'Acceptance failed');
  process.exitCode = 1;
}).finally(closePostgresPool);
