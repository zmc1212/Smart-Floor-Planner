import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import cp from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { ConversationService, appendMessage } from '@/lib/assistant/core/conversation';
import { RequirementService } from '@/lib/assistant/requirements/service';
import { HandoffService } from '@/lib/assistant/handoff/service';
import { KnowledgeService, activeProfile } from '@/lib/assistant/knowledge/service';
import { chineseTerms } from '@/lib/assistant/knowledge/chinese-lexical';
import { embeddingGateway } from '@/lib/assistant/infrastructure/embedding-gateway';
import { fingerprint, type ActorContext } from '@/lib/assistant/contracts';
import { ComparisonServices, comparisonContextData, type ComparisonContext } from './agent-comparison-services';

// Native framework/provider transcripts have heterogeneous, preserved payloads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const root = path.resolve(process.cwd(), '..'), directory = path.join(root, 'tmp/agent-comparison');
const pilot = path.join(root, 'tmp/anythingllm-pilot'), source = path.join(root, 'scripts/agent-comparison');
const protocol = JSON.parse(fs.readFileSync(path.join(source, 'protocol.json'), 'utf8'));
const scenarios = JSON.parse(fs.readFileSync(path.join(source, 'scenarios.json'), 'utf8'));
const mode = process.argv[2], origin = 'http://127.0.0.1:18093';
const syntheticKnowledge = '【测试专用企业服务须知，不代表真实公司承诺】首次咨询需要了解城市、小区、建筑面积、预算和预计入住时间。量房安排须由工作人员确认，标准现场勘察预留90分钟，具体以预约回执为准。先核对现状和业主需求，再出设计方案与分项报价。不得把客户自述面积称为正式量房面积；不得承诺免费量房、折扣、开工日期或确定总价。宠物家庭的地面选材需要核对耐磨、防滑、清洁维护和地暖适配；没有产品参数时不能替厂家保证。';
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const canonicalTools = protocol.tools.map((d: Row) => ({ type: 'function', function: { name: d.name, description: d.description, parameters: d.parameters } }));
function binding() {
  const files = cp.execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z',
    'admin/src/lib/assistant', 'admin/src/db', 'admin/src/lib/postgresql.ts', 'admin/scripts/agent-comparison*',
    'admin/scripts/assistant-acceptance-safety.mjs', 'scripts/agent-comparison'], { cwd: root, windowsHide: true, encoding: 'utf8' }).split('\0').filter(Boolean);
  files.push('tmp/anythingllm-pilot/instance.env', 'tmp/anythingllm-pilot/instance.private.json',
    'tmp/xiaok-intelligent-consult/.env.qwen37', 'tmp/xiaok-vector/connection.private.json');
  for (const d of protocol.tools) for (const f of ['plugin.json', 'handler.js']) files.push(`tmp/anythingllm-pilot/storage/plugins/agent-skills/${d.name}/${f}`);
  return Object.fromEntries([...new Set(files)].sort().filter(f => fs.existsSync(path.join(root, f))).map(f => [f, hash(fs.readFileSync(path.join(root, f)))]));
}
async function append(f: Row, text: string) {
  const key = randomUUID();
  await withTenantTransaction(f.enterpriseId, async tx => {
    const repo = new AssistantRepository(tx, f.actor); await repo.settings(true); await repo.conversation(f.conversationId);
    await appendMessage(tx, f.actor, f.conversationId, { author: 'user', content: { version: 1, blocks: [{ type: 'text', text }] }, clientMessageId: key });
  });
  return key;
}
async function readback(f: Row) {
  return { requirements: await new RequirementService(f.actor).read(f.conversationId), handoff: await new HandoffService(f.actor).customerRead(f.conversationId) };
}
async function fixture(batch: string, index: number, vector: number[]) {
  const code = 'synthetic-agent-comparison-' + randomUUID();
  const f: Row = await withPlatformTransaction(async tx => {
    const enterpriseId = String((await one(tx, sql`insert into app.enterprises(name,code,status) values('测试专用 · Agent对照企业',${code},'active') returning id`))!.id);
    const userId = String((await one(tx, sql`insert into app.users(nickname,context_version) values('测试专用对照业主',1) returning id`))!.id);
    const adminId = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,menu_permissions) values(${enterpriseId},${code},'synthetic-disabled-password','enterprise_admin','active',false,ARRAY['assistant-knowledge']) returning id`))!.id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${userId},${code})`);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days) values(${enterpriseId},true,100,200000,1000000,30)`);
    return { enterpriseId, userId, adminId, batch, index };
  });
  f.actor = { enterpriseId: f.enterpriseId, principal: { kind: 'user', userId: f.userId }, contextVersion: 1, capabilities: ['assistant.chat.self'], entry: { kind: 'direct' } } satisfies ActorContext;
  f.conversationId = String((await new ConversationService(f.actor).create(randomUUID())).id);
  await withTenantTransaction(f.enterpriseId, async tx => {
    const settings = (await one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${f.enterpriseId}`))!;
    const profile = await activeProfile(tx, f.enterpriseId, settings, true), contentHash = fingerprint(syntheticKnowledge);
    f.documentId = String((await one(tx, sql`insert into app.assistant_knowledge_documents(enterprise_id,title,category,source_type,audience,created_by,updated_by) values(${f.enterpriseId},'测试专用企业服务须知','comparison','manual_text','customer_public',${f.adminId},${f.adminId}) returning id`))!.id);
    f.versionId = String((await one(tx, sql`insert into app.assistant_knowledge_versions(enterprise_id,document_id,version_number,body,content_hash,index_status,index_profile_id,indexed_hash,chunk_count,published_at,published_by,created_by) values(${f.enterpriseId},${f.documentId},1,${syntheticKnowledge},${contentHash},'ready',${String(profile.id)},${contentHash},1,now(),${f.adminId},${f.adminId}) returning id`))!.id);
    f.chunkId = String((await one(tx, sql`insert into app.assistant_knowledge_chunks(enterprise_id,document_version_id,index_profile_id,ordinal,text,text_hash,content_hash,locator,terms,embedding) values(${f.enterpriseId},${f.versionId},${String(profile.id)},0,${syntheticKnowledge},${contentHash},${contentHash},${JSON.stringify({ section: '企业服务须知', synthetic: true })}::jsonb,array(select jsonb_array_elements_text(${JSON.stringify(chineseTerms(syntheticKnowledge))}::jsonb)),${JSON.stringify(vector)}::vector) returning id`))!.id);
    await tx.execute(sql`update app.assistant_knowledge_documents set status='active',published_version_id=${f.versionId} where enterprise_id=${f.enterpriseId} and id=${f.documentId}`);
  });
  return f;
}
async function retire(f: Row) {
  return new KnowledgeService({ enterpriseId: f.enterpriseId, adminId: f.adminId }).execute('retire', { documentId: f.documentId, expectedVersion: 1 }, randomUUID());
}

async function main() {
  const idle = await withPlatformTransaction(tx => rows(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`));
  assert.equal(Number(idle[0].n), 0, 'Isolated job queue must be idle');
  fs.mkdirSync(directory, { recursive: true });
  const batch = new Date().toISOString().replace(/[:.]/g, '-'), output = path.join(directory, `trial-${batch}.json`);
  const previous = (dir: string) => fs.readdirSync(dir).filter(f => /^trial-.*\.json$/.test(f)).flatMap(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).calls || []);
  const pilotCalls = previous(pilot), comparisonCalls = previous(directory);
  assert.ok([...pilotCalls, ...comparisonCalls].every(c => c.status === 'succeeded'), 'Unknown attempts must be resolved before additional paid calls');
  const tokens = (calls: Row[]) => calls.reduce((n, c) => n + (c.usage?.total_tokens ?? c.reservedTokens), 0);
  const report: Row = { version: 'official-createAgent-comparison-2', mode, started: new Date().toISOString(),
    contextProjection: 'one-current-user-message; authorized customer history remains numbered data in system context',
    priorDiagnostic: 'trial-2026-10-24T17-59-27-775Z.json; historical user messages were concatenated as current authorization by both candidates; unchanged questions, system instructions, schemas, services and guards',
    scope: scenarios, protocolHash: hash(JSON.stringify(protocol)), knowledgeHash: hash(syntheticKnowledge),
    authorization: { additionalTokens: 140000, cumulativeTokens: 1000000, cumulativeMicros: 5000000,
      userApproval: '同意本次上限，完成固定对照', previousPlanTokens: 518485, previousPlanMicros: 869762,
      previousPilotTokens: tokens(pilotCalls), previousComparisonTokens: tokens(comparisonCalls) },
    upstream: { anythingllm: '1.18.0 / 3e4f9411b67f2dd7fa9fc6f2b95dfacbda0633ba', langchain: '1.5.19', openaiAdapter: '1.7.0' },
    fixtures: [], calls: [], tools: [], cases: [], checks: {}, transportRequests: [], actualBilledYuan: null };
  const save = () => fs.writeFileSync(output, JSON.stringify(report, (_, v) => typeof v === 'bigint' ? String(v) : v, 2));
  const secret = JSON.parse(fs.readFileSync(path.join(pilot, 'instance.private.json'), 'utf8'));
  const env = Object.fromEntries(fs.readFileSync(path.join(root, 'tmp/xiaok-intelligent-consult/.env.qwen37'), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(s => s.trim() && !s.trim().startsWith('#')).map(s => { const n = s.indexOf('='); return [s.slice(0, n).trim(), s.slice(n + 1).trim().replace(/^(['"])(.*)\1$/, '$2')]; }));
  const provider = new URL(env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(provider.origin, 'https://dashscope.aliyuncs.com'); assert.equal(provider.pathname.replace(/\/$/, ''), '/compatible-mode/v1');
  let apiKey = '', server: http.Server | undefined, active: { f: Row; row: Row; key: string; context: ComparisonContext; system: string; direct: boolean } | undefined;
  let unknown = false, inFlight = false;
  async function api(route: string, body?: Row, auth = apiKey) {
    const response = await fetch(origin + '/api' + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(180000), redirect: 'error' });
    assert.ok(response.ok, `AnythingLLM HTTP ${response.status}`); return response.json();
  }
  async function execute(name: string, args: Row) {
    assert.ok(active && !active.direct, 'No active turn or receipt already delivered');
    const { f, row, context, key } = active;
    const attempt: Row = { case: row.id, engine: f.engine, name, args, started: new Date().toISOString() };
    report.tools.push(attempt); save();
    const direct = name === 'sfp-comparison-business';
    try {
      attempt.result = await new ComparisonServices(f.actor, f.conversationId).execute(context, key, name, args);
      attempt.ok = true;
      return attempt.result.text;
    } catch (e) {
      attempt.ok = false; attempt.error = String((e as Error).message);
      return direct ? '暂时无法核实这次操作的结果，请重新查询当前状态；不能确认已保存或已提交接待。' : JSON.stringify({ ok: false, error: attempt.error });
    } finally { if (direct) active.direct = true; attempt.finished = new Date().toISOString(); save(); }
  }
  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const send = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      if (req.headers.authorization !== `Bearer ${secret.bridgeKey}`) return send(401, { error: 'unauthorized' });
      if (req.url === '/v1/models') return send(200, { object: 'list', data: [{ id: scenarios.model, object: 'model' }] });
      assert.ok(active && !unknown, 'No active trial');
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; assert.ok(size < 512000); chunks.push(Buffer.from(chunk)); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (req.url === '/comparison/tools') {
        assert.equal(active.f.engine, 'anythingllm'); assert.equal(body.workspaceId, active.f.workspaceId);
        return send(200, { workspaceId: body.workspaceId, text: await execute(body.name, body.args) });
      }
      assert.equal(req.url, '/v1/chat/completions'); assert.equal(body.model, scenarios.model);
      assert.ok(!inFlight && !active.direct, 'Serial inference and receipt boundary');
      const service = new ComparisonServices(active.f.actor, active.f.conversationId);
      await service.fresh(active.context);
      const textOf = (m: Row) => typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((v: Row) => v.text || '').join('') : '';
      const start = body.messages.findLastIndex((m: Row) => m.role === 'user' && textOf(m) === active!.row.prompt);
      assert.ok(start >= 0, 'Current customer message must be present');
      // Historical excerpts already exist as numbered, authorized data in the
      // system context. Consecutive historical user messages made both engines'
      // configured provider treat their concatenation as the current request.
      // Keep one real current turn plus its native in-turn tool protocol.
      const messages = [{ role: 'system', content: active.system }, ...body.messages.slice(start)];
      const request = { model: scenarios.model, messages, tools: canonicalTools, tool_choice: 'auto', parallel_tool_calls: false,
        temperature: 0.2, stream: false, enable_thinking: false, max_tokens: 2048 };
      if (mode === 'transport') {
        report.transportRequests.push({ engine: active.f.engine, messages, tools: canonicalTools }); save();
        return send(200, { id: 'local-transport-only', object: 'chat.completion', created: 1, model: scenarios.model,
          choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_transport', type: 'function', function: { name: 'sfp-comparison-business', arguments: JSON.stringify({ action: 'read_status' }) } }] }, finish_reason: 'tool_calls' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
      }
      assert.equal(mode, 'live');
      assert.ok(report.calls.length < scenarios.callLimit && report.calls.filter((c: Row) => c.case === active!.row.id).length < scenarios.perTurnCallLimit, 'Fixed call limit reached');
      const reserve = Buffer.byteLength(JSON.stringify(request), 'utf8') + 2048, used = tokens(report.calls), prior = report.authorization;
      assert.ok(prior.previousComparisonTokens + used + reserve <= 140000, 'Additional comparison token cap');
      assert.ok(prior.previousPlanTokens + prior.previousPilotTokens + prior.previousComparisonTokens + used + reserve <= 1000000, 'Cumulative token cap');
      assert.ok(prior.previousPlanMicros + (prior.previousPilotTokens + prior.previousComparisonTokens + used + reserve) * 5 <= 5000000, 'Cumulative cost cap');
      const attempt: Row = { id: randomUUID(), case: active.row.id, engine: active.f.engine, request, originalRequest: body,
        reservedTokens: reserve, status: 'dispatching', started: new Date().toISOString() };
      report.calls.push(attempt); inFlight = true; save();
      try {
        const response = await fetch(`${provider.toString().replace(/\/$/, '')}/chat/completions`, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${env.DASHSCOPE_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(90000) });
        const result = await response.json(); attempt.response = result; attempt.httpStatus = response.status;
        if (!response.ok || !Number.isSafeInteger(result.usage?.total_tokens)) { attempt.status = 'unknown'; unknown = true; }
        else { attempt.status = 'succeeded'; attempt.usage = result.usage; }
        await service.fresh(active.context);
        send(response.status, result);
      } catch (e) { attempt.status = 'unknown'; attempt.error = String((e as Error).message); unknown = true; send(502, { error: 'provider_outcome_unknown' }); }
      finally { inFlight = false; attempt.finished = new Date().toISOString(); save(); }
    } catch (e) { send(409, { error: String((e as Error).message) }); }
  }
  try {
    const embedding = await embeddingGateway().embed([syntheticKnowledge], 'document');
    report.embedding = { profile: embeddingGateway().profile, usage: embedding.usage };
    if (mode !== 'services') {
      const auth = await api('/request-token', { password: secret.password }, ''); assert.ok(auth.valid && auth.token);
      const key = await api('/system/generate-api-key', { name: 'sfp-comparison-' + batch }, auth.token); apiKey = key.apiKey.secret; report.apiKeyId = key.apiKey.id;
      server = http.createServer((req, res) => { void handle(req, res); });
      await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(3109, '0.0.0.0', resolve); });
    }
    report.bindingBefore = binding(); save();
    const count = mode === 'live' ? 4 : 2;
    for (let i = 0; i < count; i++) {
      const f = await fixture(batch, i, embedding.vectors[0]); report.fixtures.push(f); save();
      f.engine = scenarios.engines[i % 2]; f.trial = Math.floor(i / 2) + 1;
      if (mode !== 'services' && f.engine === 'anythingllm') {
        const workspace = (await api('/v1/workspace/new', { name: `对照-${batch}-${i}`, openAiPrompt: protocol.system, openAiTemp: 0.2,
          openAiHistory: 20, chatProvider: 'generic-openai', chatModel: scenarios.model, agentProvider: 'generic-openai', agentModel: scenarios.model })).workspace;
        f.workspaceId = workspace.id; f.workspaceSlug = workspace.slug;
        f.thread = (await api(`/v1/workspace/${f.workspaceSlug}/thread/new`, { name: '自然对话框架对照' })).thread;
      }
      save();
    }
    const [a, b] = report.fixtures;
    await assert.rejects(() => new ComparisonServices(b.actor, a.conversationId).context()); report.checks.crossTenantDenied = true;
    if (mode === 'services') {
      const service = new ComparisonServices(a.actor, a.conversationId);
      const key = await append(a, '测试专用：预算8万，地暖不做，请记录。');
      const context = await service.context(); assert.ok(context.knowledge.some(k => k.ref.id === a.chunkId));
      report.checks.realKnowledge = true;
      const args = { action: 'save_requirements', quote: context.customerMessages.at(-1)!.text, sourceSeq: context.sourceSeq,
        fields: [{ field: 'budget', text: '预算8万', sourceMessageId: context.customerMessages[0].id }, { field: 'devices', text: '地暖不做', sourceMessageId: context.customerMessages[0].id }] };
      await assert.rejects(() => service.execute(context, key, 'sfp-comparison-business', { ...args, quote: '请记录。' }), /current_quote_required/);
      await assert.rejects(() => service.execute(context, key, 'sfp-comparison-business', { ...args, fields: [{ field: 'budget', text: '预算1万', sourceMessageId: context.customerMessages[0].id }] }), /invalid_requirement_evidence/);
      await assert.rejects(() => service.execute(context, key, 'sfp-comparison-business', { ...args, answerEvidence: [{ refId: a.chunkId, quote: '免费量房' }] }), /invalid_answer_evidence/);
      assert.equal((await readback(a)).requirements.latest, null); report.checks.invalidProvenanceNoWrite = true;
      const first = await service.execute(context, key, 'sfp-comparison-business', args);
      const replay = await service.execute(await service.context(), key, 'sfp-comparison-business', args);
      assert.deepEqual(replay, first); report.checks.idempotentReadback = true;
      await assert.rejects(() => service.execute(context, key, 'sfp-comparison-business', args), /context_changed/); report.checks.staleVersionDenied = true;
      await append(a, '测试专用：预算改成6万，请修改。'); const revised = await service.context();
      const changed = await service.execute(revised, randomUUID(), 'sfp-comparison-business', { action: 'save_requirements', quote: revised.customerMessages.at(-1)!.text, sourceSeq: revised.sourceSeq,
        fields: [{ field: 'budget', text: '预算改成6万', sourceMessageId: revised.customerMessages.at(-1)!.id }], answerEvidence: [{ refId: a.chunkId, quote: '首次咨询需要了解城市、小区、建筑面积、预算和预计入住时间。' }] });
      assert.match(changed.text, /地暖不做/); assert.match(changed.text, /城市/); report.checks.sparseMergeAndVerifiedMixedReceipt = true;
      const old = await service.context(); await retire(a); await assert.rejects(() => service.fresh(old), /context_changed/);
      assert.equal((await service.context()).knowledge.length, 0); report.checks.epochFence = true;
      await append(a, '测试专用：请求设计师接待，不分享手机号。'); const request = await service.context();
      await service.execute(request, randomUUID(), 'sfp-comparison-business', { action: 'request_designer', quote: request.customerMessages.at(-1)!.text });
      const waiting = await service.context(); assert.equal(waiting.mode, 'handoff_requested'); assert.equal(waiting.handoff.handoff?.contactConsent, false);
      await assert.rejects(() => service.execute(waiting, randomUUID(), 'sfp-comparison-business', { ...args, quote: waiting.customerMessages.at(-1)!.text }), /handoff_active/);
      const unchanged = (await readback(a)).requirements;
      await append(a, '测试专用：取消刚才的接待。'); const cancel = await service.context();
      await service.execute(cancel, randomUUID(), 'sfp-comparison-business', { action: 'cancel_designer', quote: cancel.customerMessages.at(-1)!.text });
      const after = await readback(a); assert.equal(after.handoff.handoff?.state, 'cancelled'); assert.equal(after.handoff.mode, 'ai'); assert.deepEqual(after.requirements, unchanged);
      report.checks.realCancelPreservesRequirements = true; report.checks.waitingAllowsOnlyControl = true;
      await withTenantTransaction(a.enterpriseId, tx => tx.execute(sql`update app.assistant_conversations set entry_snapshot=entry_snapshot || '{"retentionRedacted":true}'::jsonb where enterprise_id=${a.enterpriseId} and id=${a.conversationId}`));
      await assert.rejects(() => service.context(), /context_changed/); report.checks.redactedDenied = true;
      return;
    }
    const { runCreateAgent } = await import(pathToFileURL(path.join(source, 'langchain.mjs')).href);
    // Alternate the engine order in trial two; each has separate equivalent data.
    const execution = mode === 'live' ? [report.fixtures[0], report.fixtures[1], report.fixtures[3], report.fixtures[2]] : report.fixtures;
    for (const f of execution) {
      const turns = mode === 'transport' ? [{ id: 'transport', text: '查询测试状态。' }] : scenarios.turns;
      for (const turn of turns) {
        if (turn.retireBefore) {
          f.withdrawal = await retire(f);
          if (f.engine === 'anythingllm') { f.retiredThread = f.thread; f.thread = (await api(`/v1/workspace/${f.workspaceSlug}/thread/new`, { name: '资料撤回后继续' })).thread; }
        }
        assert.ok(!unknown, 'Unknown outcome stops the fixed batch');
        const before = await readback(f), key = await append(f, turn.text);
        const context = await new ComparisonServices(f.actor, f.conversationId).context();
        const system = protocol.system + '\n' + JSON.stringify(comparisonContextData(context));
        const row: Row = { id: `${f.engine}.${f.trial}.${turn.id}`, engine: f.engine, trial: f.trial, prompt: turn.text,
          started: new Date().toISOString(), before, authorizedContext: context };
        report.cases.push(row); active = { f, row, key, context, system, direct: false }; save();
        try {
          if (f.engine === 'anythingllm') {
            await api(`/v1/workspace/${f.workspaceSlug}/update`, { openAiPrompt: system });
            row.result = await api(`/v1/workspace/${f.workspaceSlug}/thread/${f.thread.slug}/chat`, { message: '@agent ' + turn.text, mode: 'chat' });
            row.history = await api(`/v1/workspace/${f.workspaceSlug}/thread/${f.thread.slug}/chats`);
            row.persisted = row.history.history?.some((m: Row) => m.role === 'assistant' && m.content === row.result.textResponse) === true;
          } else {
            row.result = await runCreateAgent({ protocol, model: scenarios.model, baseURL: 'http://127.0.0.1:3109/v1', apiKey: secret.bridgeKey,
              system, text: turn.text, execute });
            row.persisted = 'not_provided_by_this_stateless_harness';
          }
          row.after = await readback(f); row.finished = new Date().toISOString();
          row.receipt = report.tools.filter((t: Row) => t.case === row.id && t.result?.receipt).at(-1)?.result;
          row.receiptMatchesFinal = row.receipt ? row.result.textResponse === row.receipt.text : null;
          if (mode === 'transport') { assert.ok(row.receiptMatchesFinal); assert.equal(row.after.requirements.latest, null); }
          console.log(JSON.stringify({ case: row.id, calls: report.calls.filter((c: Row) => c.case === row.id).length,
            receipt: row.receipt?.receipt.action || null, tokens: tokens(report.calls), engineError: row.result.error || null }));
        } catch (e) { row.error = String((e as Error).message); report.controlOutcomeUnknown = !row.result; if (!row.result) unknown = true; throw e; }
        finally { active = undefined; save(); }
      }
    }
    const receiptCases = report.cases.filter((c: Row) => c.receipt);
    report.checks.receiptProjection = { delivered: receiptCases.length, matched: receiptCases.filter((c: Row) => c.receiptMatchesFinal).length };
    report.checks.withdrawnTextAbsent = report.calls.filter((c: Row) => ['withdrawal', 'reversal', 'contact', 'cancel'].some(id => c.case.endsWith('.' + id))).every((c: Row) => !/90\s*分钟/.test(JSON.stringify(c.request.messages)));
    report.semanticReview = 'pending; original answers and real state must be assessed, transport success is not semantic acceptance';
  } catch (e) {
    report.error = String((e as Error).stack || e).replaceAll(env.DASHSCOPE_API_KEY || 'NO_KEY', '[REDACTED]');
    process.exitCode = 1;
  } finally {
    active = undefined;
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    for (const f of report.fixtures) {
      try { await withPlatformTransaction(async tx => { await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${f.enterpriseId}`); await tx.execute(sql`update app.users set context_version=context_version+1 where id=${f.userId}`); }); f.disabled = true; }
      catch (e) { f.cleanupError = String((e as Error).message); process.exitCode = 1; }
    }
    if (report.apiKeyId) {
      try { cp.execFileSync('docker', ['exec', '-w', '/app/server', 'sfp-anythingllm-pilot', 'node', '-e', `const {ApiKey}=require('./models/apiKeys');ApiKey.delete({id:${Number(report.apiKeyId)}}).then(ok=>process.exit(ok?0:1)).catch(()=>process.exit(1));`], { windowsHide: true, encoding: 'utf8', timeout: 10000 }); report.apiKeyRevoked = true; }
      catch { report.apiKeyRevoked = false; process.exitCode = 1; }
    }
    report.bindingAfter = binding(); report.drift = Object.keys(report.bindingBefore || {}).filter(f => report.bindingBefore[f] !== report.bindingAfter[f]);
    if (report.drift.length) process.exitCode = 1;
    report.observedTokens = report.calls.reduce((n: number, c: Row) => n + (c.usage?.total_tokens || 0), 0);
    report.unknownCalls = report.calls.filter((c: Row) => c.status !== 'succeeded').length;
    report.conservativeNewCostMicros = tokens(report.calls) * 5; report.finished = new Date().toISOString(); save();
    console.log(JSON.stringify({ output: path.relative(root, output), cases: report.cases.length, calls: report.calls.length,
      tokens: report.observedTokens, unknown: report.unknownCalls, checks: report.checks, drift: report.drift,
      error: report.error?.split('\n').slice(0, 2).join(' '), cleaned: report.fixtures.every((f: Row) => f.disabled) }));
  }
}
void main().catch(e => { console.error(String(e.message)); process.exitCode = 1; }).finally(() => closePostgresPool());
