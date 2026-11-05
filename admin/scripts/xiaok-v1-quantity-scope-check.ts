/** Isolated engineering check. Scripted model/vector results are not semantic acceptance. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withTenantTransaction, withPlatformTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { KnowledgeService } from '@/lib/assistant/knowledge/service';
import { claimKnowledgeJob, runKnowledgeJob } from '@/lib/assistant/knowledge/index-worker';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { sourceCitationCatalog } from '@/lib/assistant/agent/citation-catalog';
import { EMBEDDING_PROFILE, embeddingGateway } from '@/lib/assistant/infrastructure/embedding-gateway';
import { knowledgeExplanationProtocol, knowledgeQuantityScopeProtocol, naturalKnowledgeProtocol } from '@/lib/assistant/agent/knowledge-explanation';
import type { ActorContext } from '@/lib/assistant/contracts';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';
import type { SynthesisSource } from '@/lib/assistant/agent/synthesis';
import { extractWebPage, type WebSearchSnapshot } from '@/lib/assistant/agent/web';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const eid = '1454';
const natural = process.argv.includes('--natural-answer');
const output = path.resolve(process.argv.find(v => v.startsWith('--output='))?.slice(9)
  || '../tmp/v1-01-weiyun-jingyi/explanation-implementation/quantity-scope-20261105/service01');
fs.mkdirSync(output, { recursive: true });
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Preserve the original run');
const report: Row = { checks: [], providerCalls: 0, embeddingProviderCalls: 0, semanticAcceptance: false, enterpriseId: eid,
  answerMode: natural ? naturalKnowledgeProtocol : knowledgeExplanationProtocol };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const checks = report.checks as Row[];
const result = (args: unknown): ModelTurnOutput => ({ text: '', toolCalls: [{ id: randomUUID(), name: 'final_response', arguments: JSON.stringify(args) }],
  finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 100, outputTokens: 20 } });
const priorEnv = { url: process.env.ASSISTANT_EMBEDDING_URL, key: process.env.ASSISTANT_EMBEDDING_API_KEY };
const priorFetch = globalThis.fetch;
let release: (() => Promise<void>) | undefined, prior: Row | undefined, fixture: Row | undefined;
let userId: string | undefined, otherUserId: string | undefined, knowledge: KnowledgeService | undefined;
const conversations: string[] = [];
let vectorCalls = 0, modelDoubleCalls = 0;
const server = http.createServer(async (req, res) => {
  try {
    assert.equal(req.url, '/v1/embeddings');
    let raw = ''; for await (const part of req) raw += part;
    const input = JSON.parse(raw).input as string[]; vectorCalls++;
    const vector = Array(1024).fill(0); vector[0] = 1;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ model: EMBEDDING_PROFILE.model, revision: EMBEDDING_PROFILE.revision, profile: EMBEDDING_PROFILE.id,
      data: input.map((_, index) => ({ index, embedding: vector })), usage: { prompt_tokens: 1 } }));
  } catch { res.writeHead(500); res.end(); }
});
async function main() {
  const url = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(process.argv.includes('--development') && ['localhost', '127.0.0.1'].includes(url.hostname)
    && url.port === '55432' && url.pathname === '/xiaok_embedding_eval');
  release = await lockAssistantAcceptance(url.toString());
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  process.env.ASSISTANT_EMBEDDING_URL = `http://127.0.0.1:${address.port}`;
  process.env.ASSISTANT_EMBEDDING_API_KEY = 'synthetic-local-only';
  const localOrigin = process.env.ASSISTANT_EMBEDDING_URL;
  globalThis.fetch = (input, init) => {
    const endpoint = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(endpoint.origin, localOrigin, 'No external provider dispatch is allowed');
    assert.equal(endpoint.pathname, '/v1/embeddings');
    return priorFetch(input, init);
  };
  const aid = await withTenantTransaction(eid, async tx => {
    prior = (await one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${eid}`))!;
    const admin = await one(tx, sql`select id from app.admin_users where enterprise_id=${eid} and status='active'
      and app.assistant_knowledge_admin_is_current(id,${eid}::bigint) order by id limit 1`);
    assert.ok(admin); return String(admin.id);
  });
  assert.ok(prior && !prior.enabled);
  const config = { ...(prior.agent_config as Row), knowledgeExplanation: natural ? naturalKnowledgeProtocol : knowledgeExplanationProtocol,
    ...(natural ? {} : { knowledgeQuantityScope: knowledgeQuantityScopeProtocol }) };
  if (natural) delete config.knowledgeQuantityScope;
  await withTenantTransaction(eid, tx => tx.execute(sql`update app.assistant_enterprise_settings set enabled=true,agent_config=${JSON.stringify(config)}::jsonb,
    daily_requests=1000,daily_tokens=12000000,daily_cost_micros=1000000000,version=version+1 where enterprise_id=${eid}`));
  await withPlatformTransaction(async tx => {
    for (const name of ['本人', '他客']) {
      const label = '合成量数服务检查·' + name + randomUUID();
      const u = (await one(tx, sql`insert into app.users(nickname,context_version) values(${label},1) returning id`))!;
      const id = String(u.id); if (!userId) userId = id; else otherUserId = id;
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${id},${label})`);
    }
  });
  knowledge = new KnowledgeService({ enterpriseId: eid, adminId: aid });
  const created = await knowledge.execute('create', { title: '合成量数服务检查·管根处理', sourceType: 'manual_text', audience: 'customer_public',
    body: '管根先用堵漏材料加强，并做好防水附加层。' }, randomUUID());
  fixture = { documentId: String((created.document as Row).id), versionId: String((created.draft as Row).id), expectedVersion: 1, expectedEditVersion: 1 };
  report.fixture = { ...fixture, userId, otherUserId };
  const queued = await knowledge.execute('index', fixture, randomUUID()), indexLease = await claimKnowledgeJob();
  assert.equal(indexLease?.jobId, queued.jobId); assert.ok(indexLease);
  await runKnowledgeJob(indexLease, { chunk: async text => [{ text, start: 0, end: Array.from(text).length, tokens: 20 }], embedding: embeddingGateway() });
  assert.equal((await knowledge.execute('job', { jobId: indexLease.jobId })).status, 'succeeded');
  await knowledge.execute('publish', fixture, randomUUID());
  const actor: ActorContext = { enterpriseId: eid, principal: { kind: 'user', userId: userId! }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
  const chat = new ConversationService(actor);
  async function run(assertsQuantity: boolean, scope = true, existingConversation?: string) {
    await withTenantTransaction(eid, tx => tx.execute(sql`update app.assistant_enterprise_settings set agent_config=${JSON.stringify(scope ? config : prior!.agent_config)}::jsonb,
      version=version+1 where enterprise_id=${eid}`));
    const cid = existingConversation || String((await chat.create(randomUUID())).id);
    if (!existingConversation) conversations.push(cid);
    const question = existingConversation ? '我刚才说得不准，是水管根部，不是整面墙。为什么这里还要单独处理？' : '管根为什么还要单独处理？';
    const message = { version: 1 as const, blocks: [{ type: 'text' as const, text: question }] };
    const sendKey = randomUUID(), sent = await chat.send(cid, sendKey, message);
    const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
    let selectedId = '', reviews = 0;
    await processAgentAnswer(lease, { model: async messages => {
      modelDoubleCalls++;
      const packet = messages.flatMap(m => m.role === 'user' ? m.content.filter(p => p.type === 'text').map(p => {
        try { return JSON.parse(p.type === 'text' ? p.text : '{}'); } catch { return {}; }
      }) : []).find(p => p.quantityMentions);
      if (packet) {
        if (natural) { assert.equal(packet.currentQuestion, question); assert.deepEqual(packet.questions, { Q1: question });
          assert.equal(packet.protocol, naturalKnowledgeProtocol); }
        reviews++; return result({ questionsComplete: true,
        checks: { Q1: { complete: true, supported: true, conditionsPreserved: true, reason: '' } },
        quantityChecks: { S1: { assertsQuantity, reason: assertsQuantity ? '实际涂刷次数要求' : '指代大面处理，未规定实际遍数' } } }); }
      const read = messages.flatMap(m => {
        if (m.role !== 'tool') return []; try { return JSON.parse(m.content).synthesisSources || []; } catch { return []; }
      }) as SynthesisSource[];
      const source = read.find(s => s.title.includes('合成量数服务检查'));
      if (!source) return { ...result({}), toolCalls: [{ id: 'read', name: 'search_knowledge',
        arguments: JSON.stringify({ query: '合成量数服务检查 管根处理', ...(natural ? {} : { questions: ['管根为什么还要单独处理？'] }) }) }] };
      selectedId = sourceCitationCatalog(source)[0].citationId;
      // A rollout change affects later admissions, never this run's snapshot.
      await withTenantTransaction(eid, tx => tx.execute(sql`update app.assistant_enterprise_settings set agent_config=${JSON.stringify(prior!.agent_config)}::jsonb,
        version=version+1 where enterprise_id=${eid}`));
      const segments = [{ basis: 'evidence', text: assertsQuantity ? '管根必须涂刷两遍。' : '管根先加强并做好附加层，不是靠大面那一遍涂刷顺带覆盖。', citations: [{ citationId: selectedId }] }];
      return result({ kind: 'knowledge_explanation', ...(natural ? { segments } : { answers: { Q1: segments } }) });
    } });
    const state = await withTenantTransaction(eid, tx => one(tx, sql`select * from app.assistant_runs where id=${String(sent.runId)} and enterprise_id=${eid}`));
    report.lastRun = { id: sent.runId, status: state?.status, error: state?.error_code, reviews, scope }; save();
    if (natural) { assert.equal((state?.policy_snapshot as Row).sourceAnswerMode, naturalKnowledgeProtocol);
      assert.equal(String((await chat.send(cid, sendKey, message)).runId), String(sent.runId)); }
    return { cid, sent, state, reviews };
  }
  const accepted = await run(false);
  assert.equal(accepted.state?.status, 'succeeded'); assert.equal(accepted.reviews, 1);
  assert.equal((accepted.state?.policy_snapshot as Row).knowledgeQuantityScope, knowledgeQuantityScopeProtocol);
  const saved = await withTenantTransaction(eid, tx => rows(tx, sql`select * from app.assistant_messages where enterprise_id=${eid} and run_id=${String(accepted.sent.runId)} and author_kind='assistant'`));
  assert.equal(saved.length, 1);
  await chat.detail(accepted.cid); await chat.messages(accepted.cid);
  const citations = await withTenantTransaction(eid, tx => rows(tx, sql`select id from app.assistant_message_citations where enterprise_id=${eid} and run_id=${String(accepted.sent.runId)}`));
  assert.ok(citations.length); assert.equal((await chat.citation(String(citations[0].id))).available, true);
  await assert.rejects(new ConversationService({ ...actor, principal: { kind: 'user', userId: otherUserId! } }).detail(accepted.cid), /assistant_resource_not_found|assistant_forbidden/);
  await assert.rejects(new ConversationService({ ...actor, enterpriseId: '2567' }).citation(String(citations[0].id)), /assistant_resource_not_found|assistant_forbidden|assistant_disabled/);
  checks.push({ name: 'scripted-review-real-write-reentry-citation-other-owner', passed: true, runId: accepted.sent.runId }); save();
  if (natural) {
    const correction = await run(false, true, accepted.cid);
    assert.equal(correction.state?.status, 'succeeded'); assert.equal(correction.reviews, 1);
    await chat.detail(accepted.cid); await chat.messages(accepted.cid);
    checks.push({ name: 'correction-bound-to-original-in-same-conversation-and-idempotent-reentry', passed: true, runId: correction.sent.runId }); save();
    for (const scenario of ['general', 'web', 'web-unavailable']) {
      await withTenantTransaction(eid, tx => tx.execute(sql`update app.assistant_enterprise_settings set agent_config=${JSON.stringify(config)}::jsonb,
        version=version+1 where enterprise_id=${eid}`));
      const cid = String((await chat.create(randomUUID())).id); conversations.push(cid);
      const question = scenario === 'general' ? '卫生间做干湿分离有什么好处？' : '帮我查一下网上关于卫生间通风的建议，告诉我出处。';
      const sent = await chat.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text: question }] });
      const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
      let webCalls = 0, reviewCalls = 0;
      await processAgentAnswer(lease, { webSearch: async query => {
        webCalls++;
        const retrievedAt = new Date().toISOString();
        const snapshot: WebSearchSnapshot = { version: 1, provider: 'synthetic-local', query, retrievedAt,
          status: scenario === 'web' ? 'ready' : 'unavailable', failures: scenario === 'web' ? [] : [{ code: 'web_search_http_503' }], pages: [] };
        if (scenario === 'web') snapshot.pages.push(extractWebPage({ url: 'https://example.com/synthetic-ventilation', type: 'text/html',
          body: '<html><head><title>合成通风资料</title></head><body><main><p>卫生间通风建议：保持通风，减少室内湿气积聚。做好干湿分区，并根据实际使用情况保持通风口畅通，减少潮湿环境对日常使用的影响。本文只是用于开发验证的公开资料替身，不是企业施工标准，也不代表任何现场状态。</p></main></body></html>' }, retrievedAt));
        return snapshot;
      }, model: async messages => {
        modelDoubleCalls++;
        if (scenario === 'general') return result({ kind: 'general', text: '干湿分离可以减少洗浴用水溅到其他区域，让日常使用和清洁更方便；是否适合还要结合空间和使用习惯。' });
        const review = messages.find(m => m.role === 'user' && m.content.some(p => p.type === 'text' && p.text.includes('"protocol":"' + naturalKnowledgeProtocol + '"')));
        if (review) { reviewCalls++; return result({ questionsComplete: true,
          checks: { Q1: { complete: true, supported: true, conditionsPreserved: true, reason: '' } } }); }
        const packet = messages.flatMap(m => {
          if (m.role !== 'tool') return []; try { const data = JSON.parse(m.content); return data.webStatus ? [data] : []; } catch { return []; }
        }).at(-1);
        if (!packet) return { ...result({}), toolCalls: [{ id: randomUUID(), name: 'search_web', arguments: JSON.stringify({ query: '卫生间 通风 建议', domains: [] }) }] };
        const source = packet.synthesisSources[0] as SynthesisSource | undefined;
        return result({ kind: 'knowledge_explanation', segments: [{ basis: source ? 'evidence' : 'uncertainty',
          text: source ? '这份公开资料建议保持通风，减少室内湿气积聚。' : '本次未取得可核对的公开来源，请稍后再试。',
          citations: source ? [{ citationId: sourceCitationCatalog(source)[0].citationId }] : [] }] });
      } });
      const state = await withTenantTransaction(eid, tx => one(tx, sql`select status,error_code from app.assistant_runs where id=${String(sent.runId)} and enterprise_id=${eid}`));
      assert.equal(state?.status, 'succeeded', JSON.stringify(state));
      assert.equal(webCalls, scenario === 'general' ? 0 : 1); assert.equal(reviewCalls, scenario === 'general' ? 0 : 1);
      await chat.detail(cid); await chat.messages(cid);
      // Public citations use the persisted message's w: IDs and the same service
      // endpoint, not the enterprise-knowledge citation table.
      const savedAnswer = await withTenantTransaction(eid, tx => one(tx, sql`select content from app.assistant_messages
        where enterprise_id=${eid} and run_id=${String(sent.runId)} and author_kind='assistant'`));
      const refs = ((savedAnswer?.content as { blocks?: Array<{ type: string; citationId?: string }> })?.blocks || [])
        .filter(block => block.type === 'citation').map(block => ({ id: block.citationId! }));
      assert.equal(refs.length > 0, scenario === 'web');
      if (refs.length) assert.equal((await chat.citation(String(refs[0].id))).available, true);
      checks.push({ name: `natural-${scenario}-real-write-and-reentry`, passed: true, runId: sent.runId, webDoubleCalls: webCalls, reviews: reviewCalls }); save();
    }
  }
  const rejected = await run(true);
  assert.equal(rejected.state?.status, 'failed'); assert.equal(rejected.state?.error_code, 'unsupported_model_commitment'); assert.equal(rejected.reviews, 2);
  const count = await withTenantTransaction(eid, tx => one(tx, sql`select count(*)::int n from app.assistant_messages where enterprise_id=${eid} and run_id=${String(rejected.sent.runId)} and author_kind='assistant'`));
  assert.equal(count?.n, 0);
  checks.push({ name: 'real-count-review-rejects-first-and-sole-repair-without-answer', passed: true, runId: rejected.sent.runId }); save();
  await knowledge.execute('retire', { ...fixture, expectedVersion: 2 }, randomUUID());
  fixture = undefined;
  const revoked = await chat.citation(String(citations[0].id));
  assert.equal(revoked.available, false);
  checks.push({ name: 'source-withdrawal-after-reentry', passed: true });
  report.passed = true;
}
async function execute() {
try { await main(); } catch (error) { report.error = (error as Error).stack; process.exitCode = 1; }
finally {
  const cleanupErrors: string[] = [];
  const cleanup = async (work: () => Promise<void>) => { try { await work(); } catch (error) { cleanupErrors.push((error as Error).message); process.exitCode = 1; } };
  await cleanup(async () => {
    if (knowledge && fixture) {
      const detail = await knowledge.execute('detail', { documentId: fixture.documentId });
      if ((detail.document as Row).status !== 'retired') await knowledge.execute('retire', { ...fixture, expectedVersion: Number((detail.document as Row).version) }, randomUUID());
    }
  });
  await cleanup(async () => {
    if (prior) await withTenantTransaction(eid, async tx => {
      for (const cid of conversations) await tx.execute(sql`update app.assistant_conversations set status='archived' where enterprise_id=${eid} and id=${cid}`);
      await tx.execute(sql`update app.assistant_enterprise_settings set enabled=${Boolean(prior!.enabled)},agent_config=${JSON.stringify(prior!.agent_config)}::jsonb,
        daily_requests=${Number(prior!.daily_requests)},daily_tokens=${Number(prior!.daily_tokens)},daily_cost_micros=${Number(prior!.daily_cost_micros)},version=version+1 where enterprise_id=${eid}`);
    });
  });
  await cleanup(async () => {
    if (release) await withPlatformTransaction(async tx => {
      for (const uid of [userId, otherUserId].filter(Boolean) as string[]) await tx.execute(sql`update app.users set context_version=context_version+1 where id=${uid}`);
      report.queue = await one(tx, sql`select count(*)::int active from app.assistant_jobs where status in ('queued','running')`);
    });
  });
  report.cleanup = cleanupErrors.length === 0; report.cleanupErrors = cleanupErrors;
  if (priorEnv.url === undefined) delete process.env.ASSISTANT_EMBEDDING_URL; else process.env.ASSISTANT_EMBEDDING_URL = priorEnv.url;
  if (priorEnv.key === undefined) delete process.env.ASSISTANT_EMBEDDING_API_KEY; else process.env.ASSISTANT_EMBEDDING_API_KEY = priorEnv.key;
  globalThis.fetch = priorFetch;
  if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  await closePostgresPool(); await release?.();
  report.modelDoubleCalls = modelDoubleCalls; report.localVectorDoubleCalls = vectorCalls; save();
  console.log(JSON.stringify({ passed: report.passed || false, checks, cleanup: report.cleanup, error: report.error, output }));
}
}
void execute();
