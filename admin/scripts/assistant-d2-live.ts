/* eslint-disable @typescript-eslint/no-explicit-any -- Acceptance captures existing dynamic DTOs and raw provider evidence. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { AssistantMediaService } from '@/lib/assistant/media/service';
import { KnowledgeService } from '@/lib/assistant/knowledge/service';
import { claimKnowledgeJob, runKnowledgeJob } from '@/lib/assistant/knowledge/index-worker';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { nativeFinalProtocol } from '@/lib/assistant/agent/native-final';
import { conversationImageProtocol } from '@/lib/assistant/agent/image-context';
import { reviewClaimProtocol } from '@/lib/assistant/agent/review-claims';
import { reviewCompletionProtocol } from '@/lib/assistant/agent/review-completion';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { fingerprint, safeText, type ActorContext } from '@/lib/assistant/contracts';
import { parseAgentUsage } from '@/lib/ai/providers/agent-chat';
import { getPlatformLlmConfig } from '@/lib/platform-llm-config';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
import { bindBailianReviewTestRuntime } from './bailian-review-test-runtime';
import { reviewBudget, type RetainedReviewHold } from './assistant-review-budget';
import { nativeImageAcceptance } from './assistant-image-native';

type Row = Record<string, any>;
type Fixture = { enterpriseId: string; userId: string; otherUserId: string; adminId: string;
  conversationId: string; actor: ActorContext; token: string; leadId?: string; planId?: string; doc?: Row };
const root = path.resolve(process.cwd(), '..'); loadEnvConfig(process.cwd(), true);
process.env.DATABASE_URL = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, '')).DATABASE_URL;
assert.ok(process.argv.includes('--authorized-d2-100'), 'Requires the direct human D2/100 CNY authorization');
const batch = process.argv[2]; assert.match(batch, /^d2-[a-z0-9-]{5,80}$/);
const output = path.join(root, 'tmp/agent-contract', batch);
const ledger = path.join(root, 'tmp/agent-contract', 'trial-' + batch + '.json');
assert.ok(!fs.existsSync(output) && !fs.existsSync(ledger), 'Never replay/overwrite a fixed batch');
fs.mkdirSync(output, { recursive: true });
const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const imagesOnly = process.argv.includes('--images-only');
const verifyNative = !imagesOnly || process.argv.includes('--verify-native');
const maxCalls = imagesOnly ? verifyNative ? 55 : 40 : 90, callTokenCap = 60000;
const budget = reviewBudget(root);
const retainedReports: Row[] = [], retained: RetainedReviewHold[] = [];
for (const directory of ['tmp/anythingllm-pilot', 'tmp/agent-comparison', 'tmp/agent-diagnosis', 'tmp/agent-contract']) {
  for (const file of fs.readdirSync(path.join(root, directory)).filter(file => /^trial-.*\.json$/.test(file))) {
    const name = directory + '/' + file, bytes = fs.readFileSync(path.join(root, name));
    const holds = (JSON.parse(bytes.toString()).calls || []).filter((call: Row) => call.status !== 'succeeded')
      .map((call: Row) => ({ id: call.id, runId: call.runId, reservedTokens: call.reservedTokens }));
    if (holds.length) { retainedReports.push({ path: name, hash: hash(bytes) }); retained.push(...holds); }
  }
}
budget.assertReservation(0, maxCalls * callTokenCap, retained);
const authorization = { batchId: batch, authorizedBy: 'direct-human-user', clientDate: '2026-10-28',
  instruction: '继续必要实模调用，累计不超 ¥100', providerKey: 'dashscope', model: 'qwen3.8-flash',
  cumulativeCapMicros: 100000000, maxCalls, callTokenCap, retainedReports, retainedHolds: retained };
fs.writeFileSync(path.join(output, 'authorization.json'), JSON.stringify(authorization, null, 2));
const questions = {
  knowledge: ['你们厨房改水电前一般怎么帮我留设备位置？我想水槽下放个小厨宝。',
    '为啥要留检修的地方？我还想把柜子尽量装满。',
    '我刚问了家里人，买的是即热式，不是储水式。那柜子和用电该怎么考虑？'],
  images: ['这张照片是新家厨房的窗边，水槽想放这边，先帮我看看需要核对哪些条件。',
    '如果水槽挪到旁边那面墙，和图纸里的厨房尺寸要怎么一起考虑？',
    '这张窗户照片其实是老家，不是新房。刚才想放水槽的想法先不算，新房厨房还是按已有户型聊，需要我补什么？'],
};
const layout = { version: 4, measurementMode: 'surveying', surveyGraph: { kind: 'survey-wall-graph', activeFloorId: 'f', floors: [{
  id: 'f', name: '一层', ceilingHeightMm: 2800,
  nodes: [{ id: 'a', xMm: 0, yMm: 0 }, { id: 'b', xMm: 4000, yMm: 0 }, { id: 'c', xMm: 4000, yMm: 3000 }, { id: 'd', xMm: 0, yMm: 3000 }],
  walls: [{ id: 'ab', startNodeId: 'a', endNodeId: 'b', lengthMm: 4000 }, { id: 'bc', startNodeId: 'b', endNodeId: 'c', lengthMm: 3000 },
    { id: 'cd', startNodeId: 'c', endNodeId: 'd', lengthMm: 4000 }, { id: 'da', startNodeId: 'd', endNodeId: 'a', lengthMm: 3000 }],
  openings: [], spaces: [{ id: 'kitchen', name: '厨房', closed: true, wallIds: ['ab', 'bc', 'cd', 'da'] }],
}] } };
const body = '厨房设备点位安排前，团队会核对具体设备型号、安装说明和现场供电、给排水条件，再核对橱柜布局。'
  + '水槽下的储水式小厨宝应保留检修和漏水处置条件，不用收纳物堵住设备检修位置。'
  + '即热式与储水式不能按同一条件安排：即热式还需由设计师核对设备额定用电条件与实际供电回路，不能仅凭柜子放得下就认定可安装。'
  + '本文是合成测试企业的服务说明，不是客户家的正式方案、现场核验、报价或施工批准。';
function binding() {
  const files: string[] = [];
  const walk = (folder: string) => { for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
    const file = folder + '/' + entry.name; if (entry.isDirectory()) walk(file); else if (/\.(?:ts|js|mjs|wxml|less|json)$/.test(file)) files.push(file);
  } };
  for (const folder of ['admin/src/lib/assistant', 'admin/src/lib/ai/providers', 'admin/src/lib/construction', 'admin/src/db', 'miniprogram/packages/assistant']) walk(folder);
  files.push('admin/scripts/assistant-d2-live.ts', 'admin/scripts/assistant-image-native.ts', 'admin/scripts/wechatide-native-client.ts',
    'admin/scripts/wechatide-window-state.ps1', 'admin/scripts/assistant-review-budget.ts', 'admin/scripts/bailian-review-test-runtime.ts',
    'admin/scripts/assistant-acceptance-safety.mjs', 'admin/src/lib/ai/postgres-workflow-chat.ts', 'admin/src/lib/platform-llm-config.ts',
    'admin/src/lib/miniprogram-jwt.ts', 'admin/package-lock.json', 'admin/tsconfig.json', 'admin/.env', 'admin/.env.local',
    'tmp/xiaok-vector/connection.private.json',
    'miniprogram/utils/api.js', 'tmp/xiaok-vector/renovation-photos/window.jpg', 'tmp/xiaok-vector/renovation-photos/manifest.json');
  return Object.fromEntries([...new Set(files)].filter(file => fs.existsSync(path.join(root, file))).map(file => [file, hash(fs.readFileSync(path.join(root, file)))]));
}
const report: Row = { delivery: 'D2', mode: 'live', authorization, started: new Date().toISOString(),
  fixedScope: { knowledge: imagesOnly ? { reused: 'trial-d2-fixed-live-20261028-03.json', cases: 6 } : { repeats: 2, questions: questions.knowledge, assertions: 'real enterprise Evidence; explanations/conditions/correction, open source and retirement' },
    images: { repeats: 2, upload: 'licensed window.jpg', questions: questions.images,
      fixture: 'labelled synthetic formal-v4 plan includes actual stored wall lengthMm4000/3000; no dimensions are inferred from the photo or coordinate/render bounds',
      assertions: 'pixels in actual requests, owned formal-v4 recorded dimensions, house correction and immutable graph' },
    native: verifyNative ? 'one actual C01 prior-text/image/lost-response/follow-up/reentry chain' : { reused: 'trial-d2-fixed-live-20261028-03.json', cases: 3 } },
  before: binding(), calls: [], embeddingCalls: [], fixtures: [], cases: [], checks: [], passed: false, cleaned: false };
const save = () => { const data = JSON.stringify(report, null, 2); fs.writeFileSync(ledger, data); fs.writeFileSync(path.join(output, 'report.json'), data); };
let release: (() => Promise<void>) | undefined, restore: (() => Promise<unknown>) | undefined, currentRun = '', latestReply = '';
const fixtures: Fixture[] = [], originalFetch = globalThis.fetch;
const previous = { allowlist: process.env.ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS, model: process.env.ASSISTANT_TEXT_MODEL,
  thinking: process.env.ASSISTANT_TEXT_DISABLE_THINKING };
const photo = fs.readFileSync(path.join(root, 'tmp/xiaok-vector/renovation-photos/window.jpg'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/renovation-photos/manifest.json'), 'utf8'));
assert.equal(hash(photo), manifest.find((entry: Row) => entry.id === 'window').sha256);

async function createFixture(kind: string): Promise<Fixture> {
  const code = 'synthetic-' + batch + '-' + kind + '-' + randomUUID();
  const ids = await withPlatformTransaction(async tx => {
    const enterpriseId = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${'测试专用 · D2实模 ' + kind},${code},'active') returning id`))!.id);
    const userId = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${code},1) returning id`))!.id);
    const otherUserId = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${code + '-other'},1) returning id`))!.id);
    const adminId = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
      values(${enterpriseId},${code},'unusable-synthetic','enterprise_admin','active',ARRAY['assistant-knowledge'],false) returning id`))!.id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${userId},${code}),(${otherUserId},${code + '-other'})`);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
      values(${enterpriseId},true,100,3000000,30000000,30,${JSON.stringify({ runtime: 'langgraph-v1', providerKey: 'dashscope', model: 'qwen3.8-flash',
        tools: true, imageInput: true, probeVersion: batch, structuredFinal: nativeFinalProtocol, requirementClaims: reviewClaimProtocol,
        reviewCompletion: reviewCompletionProtocol, imageContext: conversationImageProtocol })}::jsonb)`);
    return { enterpriseId, userId, otherUserId, adminId };
  });
  const f = { ...ids, conversationId: '', actor: {} as ActorContext, token: '' }; fixtures.push(f);
  if (kind.startsWith('image')) await withTenantTransaction(ids.enterpriseId, async tx => {
    (f as Fixture).planId = String((await one(tx, sql`insert into app.floor_plans(enterprise_id,creator_id,name,source,status,layout_data)
      values(${ids.enterpriseId},${ids.userId},'测试专用 · 新家厨房正式户型','manual','completed',${JSON.stringify(layout)}::jsonb) returning id`))!.id);
    (f as Fixture).leadId = String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source,primary_floor_plan_id)
      values(${ids.enterpriseId},${ids.userId},'测试专用 · 新家','13000000000','manual',${(f as Fixture).planId}) returning id`))!.id);
  });
  f.actor = { enterpriseId: ids.enterpriseId, principal: { kind: 'user', userId: ids.userId }, contextVersion: 1,
    capabilities: ['assistant.chat.self'], entry: (f as Fixture).leadId ? { kind: 'lead', id: (f as Fixture).leadId! } : { kind: 'direct' } };
  process.env.ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS = ids.enterpriseId;
  f.conversationId = String((await new ConversationService(f.actor).create(randomUUID())).id);
  f.token = await signMiniProgramToken({ sub: ids.userId, id: ids.userId, mode: 'customer', role: 'user', enterpriseId: ids.enterpriseId, contextVersion: 1, source: 'wechat' });
  report.fixtures.push({ ...ids, kind, conversationId: f.conversationId, planId: (f as Fixture).planId, leadId: (f as Fixture).leadId }); save();
  return f;
}
async function publish(f: Fixture) {
  const service = new KnowledgeService({ enterpriseId: f.enterpriseId, adminId: f.adminId });
  const created = await service.execute('create', { title: '测试专用 · 厨房设备点位安排说明', sourceType: 'manual_text', audience: 'customer_public', body }, randomUUID());
  f.doc = { documentId: String((created.document as Row).id), versionId: String((created.draft as Row).id), expectedVersion: 1, expectedEditVersion: 1 };
  const job = await service.execute('index', f.doc, randomUUID()), lease = await claimKnowledgeJob();
  assert.ok(lease && lease.jobId === job.jobId); await runKnowledgeJob(lease);
  assert.equal((await service.execute('job', { jobId: lease.jobId })).status, 'succeeded');
  await service.execute('publish', f.doc, randomUUID());
}
async function run(f: Fixture, label: string, expectedImages?: number) {
  const row: Row = { fixture: f.conversationId, label, firstDraftPass: false }; report.cases.push(row); save();
  let lease: Awaited<ReturnType<typeof claimJob>> = null;
  for (let n = 0; n < 40 && !lease; n++) { lease = await claimJob(); if (!lease) await new Promise(resolve => setTimeout(resolve, 250)); }
  assert.ok(lease && lease.enterpriseId === f.enterpriseId); currentRun = lease.runId; row.runId = lease.runId; save();
  await processAgentAnswer(lease); currentRun = '';
  const chat = new ConversationService(f.actor), result = await chat.run(lease.runId);
  row.result = result;
  row.steps = await withTenantTransaction(f.enterpriseId, tx => rows(tx, sql`select step_seq,kind,status,capability_name,input_summary,private_checkpoint,source_refs
    from app.assistant_run_steps where enterprise_id=${f.enterpriseId} and run_id=${lease!.runId} order by step_seq`));
  const history = await chat.messages(f.conversationId), answer = history.items.find((message: Row) => String(message.id) === String(result.outputMessageId));
  row.answer = answer; latestReply = answer ? safeText(answer.content as Parameters<typeof safeText>[0]) : ''; row.reply = latestReply;
  row.calls = report.calls.filter((call: Row) => call.runId === lease!.runId).map((call: Row) => call.id);
  row.attempts = await withTenantTransaction(f.enterpriseId, tx => rows(tx, sql`select id,status,accepted,metadata from app.ai_provider_attempts where enterprise_id=${f.enterpriseId} and assistant_run_id=${lease!.runId} order by id`));
  assert.equal(row.attempts.length, row.calls.length);
  const calls = report.calls.filter((call: Row) => call.runId === lease!.runId);
  calls.forEach((call: Row, index: number) => { call.attemptId = String(row.attempts[index].id); });
  if (expectedImages !== undefined) row.expectedImages = expectedImages;
  row.firstDraftPass = result.status === 'succeeded' && !!latestReply && !row.steps.some((step: Row) => step.kind === 'agent_validation' && step.status === 'failed');
  if (expectedImages !== undefined) row.pixelPass = calls.length > 0 && calls.every((call: Row) => call.imageCount === expectedImages);
  if (f.planId && /-[12]$/.test(label)) {
    const checkpoint = row.steps.find((step: Row) => step.kind === 'agent_checkpoint')?.private_checkpoint;
    row.formalEvidence = (checkpoint?.messages || []).some((message: Row) => message.role === 'tool' && message.content.includes('图内墙边记录：4000毫米、3000毫米'));
  }
  row.journeyPass = result.status === 'succeeded' && !!latestReply && row.pixelPass && row.formalEvidence !== false;
  save(); return row;
}
async function say(f: Fixture, label: string, text: string, images?: number) {
  await new ConversationService(f.actor).send(f.conversationId, randomUUID(), { version: 1, blocks: [{ type: 'text', text }] });
  return run(f, label, images);
}
async function boundary(f: Fixture) {
  const other: ActorContext = { ...f.actor, principal: { kind: 'user', userId: f.otherUserId } };
  await assert.rejects(new ConversationService(other).detail(f.conversationId), /assistant_resource_not_found/);
  const detail = await new ConversationService(f.actor).detail(f.conversationId); assert.equal(String(detail.id), f.conversationId);
  if (f.planId) {
    const plan = await withTenantTransaction(f.enterpriseId, tx => one(tx, sql`select layout_data from app.floor_plans where id=${f.planId}`));
    assert.equal(fingerprint(plan!.layout_data), fingerprint(layout));
  }
  report.checks.push({ fixture: f.conversationId, boundary: 'other-customer denied; persisted reentry; formal graph unchanged', passed: true }); save();
}
async function main() {
  save();
  try {
    release = await lockAssistantAcceptance(process.env.DATABASE_URL!);
    const embedding = new URL(process.env.ASSISTANT_EMBEDDING_URL || '');
    assert.ok(['localhost', '127.0.0.1'].includes(embedding.hostname), 'Reuse the approved local embedding forward only');
    const bound = await bindBailianReviewTestRuntime(root, ledger); restore = bound.restore; report.runtime = bound.receipt;
    const config = await getPlatformLlmConfig(); assert.equal(config.model, 'qwen3.8-flash'); assert.equal(config.providerKey, 'dashscope');
    process.env.ASSISTANT_TEXT_MODEL = config.model; process.env.ASSISTANT_TEXT_DISABLE_THINKING = '1';
    const origin = new URL(config.baseUrl).origin;
    globalThis.fetch = async (resource, init) => {
      const url = new URL(typeof resource === 'string' || resource instanceof URL ? String(resource) : resource.url);
      if (url.origin === embedding.origin && ['/v1/embeddings', '/v1/chunks'].includes(url.pathname)) {
        report.embeddingCalls.push({ at: new Date().toISOString(), path: url.pathname, requestHash: hash(String(init?.body)) }); save();
        return originalFetch(resource, init);
      }
      assert.ok(url.origin === origin && url.pathname.endsWith('/chat/completions'), 'No other provider/network/fallback in this fixed batch');
      assert.ok(currentRun && report.calls.length < maxCalls);
      assert.ok(!report.calls.some((call: Row) => call.status === 'unknown'), 'A newly unknown request stops inference');
      reviewBudget(root).assertReservation(0, callTokenCap, retained);
      const request = JSON.parse(String(init?.body)); assert.equal(request.model, 'qwen3.8-flash'); assert.equal(request.enable_thinking, false);
      const imageCount = request.messages.reduce((n: number, message: Row) => n + (Array.isArray(message.content) ? message.content.filter((part: Row) => part.type === 'image_url').length : 0), 0);
      const call: Row = { id: randomUUID(), runId: currentRun, status: 'unknown', reservedTokens: callTokenCap,
        requestHash: hash(JSON.stringify(request)), imageCount, responseFormat: request.response_format?.type ?? null };
      report.calls.push(call); save();
      const response = await originalFetch(resource, init), raw = await response.clone().text();
      const rawFile = path.join(output, 'model-' + report.calls.length + '.json');
      fs.writeFileSync(rawFile, JSON.stringify({ request, httpStatus: response.status, rawResponse: raw }, null, 2));
      call.rawFile = rawFile; call.responseHash = hash(raw); call.httpStatus = response.status;
      if (response.ok) { const payload = JSON.parse(raw), usage = parseAgentUsage(payload.usage);
        if (usage) { call.usage = { total_tokens: usage.inputTokens + usage.outputTokens }; call.status = 'succeeded'; } }
      else call.status = response.status >= 400 && response.status < 500 && response.status !== 408 ? 'failed' : 'unknown';
      save(); return response;
    };
    // Fixed before dispatch: each original journey twice. No sampling for passes.
    for (let repeat = 1; !imagesOnly && repeat <= 2; repeat++) {
      const f = await createFixture('knowledge-' + repeat); await publish(f);
      for (let i = 0; i < questions.knowledge.length; i++) await say(f, 'knowledge-' + repeat + '-' + i, questions.knowledge[i], 0);
      const citations = await withTenantTransaction(f.enterpriseId, tx => rows(tx, sql`select id from app.assistant_message_citations where enterprise_id=${f.enterpriseId} and conversation_id=${f.conversationId}`));
      assert.ok(citations.length, 'The professional journey must actually cite its enterprise source');
      const chat = new ConversationService(f.actor); for (const citation of citations) assert.equal((await chat.citation(String(citation.id))).available, true);
      await boundary(f);
      const service = new KnowledgeService({ enterpriseId: f.enterpriseId, adminId: f.adminId });
      const current = await service.execute('detail', { documentId: f.doc!.documentId });
      await service.execute('retire', { documentId: f.doc!.documentId, expectedVersion: (current.document as Row).version }, randomUUID());
      for (const citation of citations) assert.equal((await chat.citation(String(citation.id))).available, false);
      report.checks.push({ fixture: f.conversationId, sourceOpenedAndRevoked: citations.map(c => String(c.id)), passed: true }); save();
    }
    for (let repeat = 1; repeat <= 2; repeat++) {
      const f = await createFixture('images-' + repeat), media = new AssistantMediaService(f.actor);
      await media.upload(f.conversationId, randomUUID(), photo, 'image', ''); await run(f, 'images-' + repeat + '-upload', 1);
      for (let i = 0; i < questions.images.length; i++) await say(f, 'images-' + repeat + '-' + i, questions.images[i], 1);
      await boundary(f);
    }
    if (verifyNative) {
    const f = await createFixture('native');
    report.native = await nativeImageAcceptance({ root, output, enterpriseId: f.enterpriseId, conversationId: f.conversationId, token: f.token, bytes: photo,
      runWorker: async (images) => { const row = await run(f, 'native-' + report.cases.filter((c: Row) => String(c.label).startsWith('native-')).length, images);
        assert.equal(row.result.status, 'succeeded', JSON.stringify(row.result)); assert.ok(row.pixelPass); return row; },
      assertReply: data => { assert.ok(latestReply && JSON.stringify(data.messages).includes(latestReply.slice(0, 18))); },
      record: async (name, work) => { const row: Row = { name, passed: false }; report.checks.push(row);
        try { row.result = await work(); row.passed = true; } finally { save(); } },
    });
    }
    report.passed = report.cases.length === (imagesOnly ? verifyNative ? 11 : 8 : 17) && report.cases.every((row: Row) => row.journeyPass) && report.checks.every((row: Row) => row.passed);
  } catch (error) { report.error = String((error as Error).stack || error); process.exitCode = 1; }
  finally {
    const errors: string[] = [];
    try { for (const f of fixtures) await withPlatformTransaction(async tx => {
      await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${f.enterpriseId}`);
      await tx.execute(sql`update app.users set context_version=context_version+1 where id in (${f.userId},${f.otherUserId})`);
      await tx.execute(sql`update app.admin_users set status='disabled' where id=${f.adminId}`);
      await tx.execute(sql`update app.assistant_jobs set status='cancelled',lease_token=null,lease_expires_at=null where enterprise_id=${f.enterpriseId} and status in ('queued','running')`);
    }); report.cleaned = true; } catch (error) { errors.push(String(error)); }
    globalThis.fetch = originalFetch;
    try { if (restore) { report.configurationRestoration = await restore(); } } catch (error) { errors.push(String(error)); }
    for (const [key, value] of Object.entries({ ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS: previous.allowlist,
      ASSISTANT_TEXT_MODEL: previous.model, ASSISTANT_TEXT_DISABLE_THINKING: previous.thinking })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    try { if (release) await release(); } catch (error) { errors.push(String(error)); }
    report.after = binding(); report.drift = Object.keys(report.before).filter(file => report.before[file] !== report.after[file]);
    try { await closePostgresPool(); } catch (error) { errors.push(String(error)); }
    report.cleanupErrors = errors; if (errors.length || report.drift.length) report.passed = false;
    report.cumulativeBudgetMicros = reviewBudget(root).usedMicros;
    save(); if (!report.passed) process.exitCode = 1;
    console.log(JSON.stringify({ ledger, passed: report.passed, cases: report.cases.length, calls: report.calls.length,
      drift: report.drift, error: report.error ?? null, cumulativeBudgetMicros: report.cumulativeBudgetMicros }));
  }
}
void main();
