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
import { assistantHttp } from '@/lib/assistant/application/http';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { nativeFinalProtocol } from '@/lib/assistant/agent/native-final';
import { conversationImageProtocol, nativeImageFinalProjection } from '@/lib/assistant/agent/image-context';
import { reviewClaimProtocol } from '@/lib/assistant/agent/review-claims';
import { reviewCompletionProtocol } from '@/lib/assistant/agent/review-completion';
import { agentMessageAvailable, hydrateImages, resolveAgentMedia } from '@/lib/assistant/agent/media-context';
import { agentChatBody } from '@/lib/ai/providers/agent-chat';
import { cacheObservation, modelPrefixObservation } from '@/lib/ai/providers/model-observation';
import type { ActorContext } from '@/lib/assistant/contracts';
import type { ModelMessage, ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
import { nativeImageAcceptance } from './assistant-image-native';
import { queryMaterials, materialSnapshotAvailable, type MaterialSnapshot } from '@/lib/assistant/agent/materials';
import { fingerprint } from '@/lib/assistant/contracts';

type Row = Record<string, unknown>;
const root = path.resolve(process.cwd(), '..');
loadEnvConfig(process.cwd(), true);
const connection = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, ''));
process.env.DATABASE_URL = connection.DATABASE_URL;
const name = process.argv[2] || `services-${new Date().toISOString().replace(/[:.]/g, '-')}`;
assert.match(name, /^[a-z0-9-]{1,100}$/);
assert.ok(!process.argv.includes('--live'), 'This driver cannot authorize or dispatch a real model');
const nativeOnly = process.argv.includes('--native-only');
assert.ok(!nativeOnly || process.argv.includes('--native'), 'Native-only requires the actual native driver');
const output = path.join(root, 'tmp/xiaok-d2-context-20261027', name);
assert.ok(!fs.existsSync(output), 'Never overwrite an original acceptance batch');
fs.mkdirSync(output, { recursive: true });
const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
function binding() {
  const files: string[] = [];
  const walk = (folder: string) => { for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
    const file = folder + '/' + entry.name;
    if (entry.isDirectory()) walk(file); else if (/\.(?:ts|js|mjs)$/.test(file)) files.push(file);
  } };
  for (const folder of ['admin/src/lib/assistant', 'admin/src/lib/ai/providers', 'admin/src/db', 'miniprogram/packages/assistant']) walk(folder);
  files.push('admin/scripts/assistant-image-context-acceptance.ts', 'admin/scripts/assistant-acceptance-safety.mjs',
    'admin/scripts/assistant-image-native.ts', 'admin/scripts/wechatide-native-client.ts', 'admin/scripts/wechatide-window-state.ps1',
    'admin/src/lib/miniprogram-jwt.ts', 'admin/src/lib/auth.ts', 'admin/src/lib/platform-llm-config.ts',
    'admin/package.json', 'admin/package-lock.json', 'admin/tsconfig.json', 'admin/.env', 'admin/.env.local',
    'tmp/xiaok-vector/connection.private.json',
    'miniprogram/utils/api.js', 'tmp/xiaok-vector/renovation-photos/window.jpg', 'tmp/xiaok-vector/renovation-photos/manifest.json');
  return Object.fromEntries([...new Set(files)].sort().filter(file => fs.existsSync(path.join(root, file)))
    .map(file => [file, hash(fs.readFileSync(path.join(root, file)))]));
}
const report: Row = { delivery: 'D2', scope: 'Deterministic real HTTP handler/database/Worker image protocol; optional actual Stable C01, no model-semantic acceptance',
  started: new Date().toISOString(), passed: false, checks: [], dispatches: [], before: binding(), externalCalls: 0 };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
let release: (() => Promise<void>) | undefined;
let fixture: { enterpriseId: string; userId: string; otherUserId: string; conversationId: string } | undefined;
let actor: ActorContext;
let token = '', otherToken = '';
const previousAllowlist = process.env.ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS;
const previousFetch = globalThis.fetch;
globalThis.fetch = async () => { report.externalCalls = Number(report.externalCalls) + 1; throw Error('D2 deterministic driver forbids external I/O'); };
async function step(name: string, work: () => Promise<unknown>) {
  const check: Row = { name, passed: false }; (report.checks as Row[]).push(check);
  try { check.result = await work(); check.passed = true; }
  catch (error) { check.error = String((error as Error).stack || error); throw error; }
  finally { save(); }
}
async function api(url: string, method = 'GET', body?: unknown, key?: string, bearer = token) {
  return assistantHttp(new Request('http://localhost:3108/api/miniprogram/assistant' + url, {
    method, headers: { ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}), 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), url.replace(/^\//, '').split('/'));
}
async function data(response: Response) {
  const payload = await response.json(); assert.ok([200, 202].includes(response.status), JSON.stringify(payload));
  return payload.data;
}
async function createFixture() {
  const code = 'synthetic-d2-images-' + randomUUID();
  const created = await withPlatformTransaction(async tx => {
    const enterpriseId = String((await one(tx, sql`insert into app.enterprises(name,code,status)
      values('测试专用 · D2图文上下文',${code},'active') returning id`))!.id);
    const userId = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${code},1) returning id`))!.id);
    const otherUserId = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${code + '-other'},1) returning id`))!.id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${userId},${code}),(${otherUserId},${code + '-other'})`);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
      values(${enterpriseId},true,100,1000000,10000000,30,${JSON.stringify({ runtime: 'langgraph-v1', providerKey: 'dashscope',
        model: 'qwen3.8-flash', tools: true, imageInput: true, probeVersion: 'd2-deterministic', structuredFinal: nativeFinalProtocol,
        requirementClaims: reviewClaimProtocol, reviewCompletion: reviewCompletionProtocol, imageContext: conversationImageProtocol })}::jsonb)`);
    return { enterpriseId, userId, otherUserId };
  });
  // Record ownership before any later step can fail, so finally can clean it.
  fixture = { ...created, conversationId: '' };
  actor = { enterpriseId: created.enterpriseId, principal: { kind: 'user', userId: created.userId }, contextVersion: 1,
    capabilities: ['assistant.chat.self'], entry: { kind: 'direct' } };
  process.env.ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS = created.enterpriseId;
  fixture.conversationId = String((await new ConversationService(actor).create(randomUUID())).id);
  token = await signMiniProgramToken({ sub: created.userId, id: created.userId, mode: 'customer', role: 'user', enterpriseId: created.enterpriseId, contextVersion: 1, source: 'wechat' });
  otherToken = await signMiniProgramToken({ sub: created.otherUserId, id: created.otherUserId, mode: 'customer', role: 'user', enterpriseId: created.enterpriseId, contextVersion: 1, source: 'wechat' });
  report.fixture = fixture;
}
async function runWorker(expectedImages: number, expectedClaims?: boolean, readFormal?: { leadId: string }) {
  // Native polling can briefly hold the settings row; claimJob deliberately
  // uses SKIP LOCKED. Wait for our queued job rather than treating contention
  // as a missing client write or taking ownership of another controller.
  let lease: Awaited<ReturnType<typeof claimJob>> = null, claimPolls = 0;
  for (; claimPolls < 40; claimPolls++) {
    lease = await claimJob(); if (lease) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(lease); assert.equal(lease.enterpriseId, fixture!.enterpriseId);
  const held = await withTenantTransaction(fixture!.enterpriseId, tx => one(tx, sql`select r.policy_snapshot,q.reserved_tokens,q.reserved_cost_micros
    from app.assistant_runs r join app.assistant_quota_reservations q on q.enterprise_id=r.enterprise_id and q.run_id=r.id
    where r.enterprise_id=${fixture!.enterpriseId} and r.id=${lease!.runId}`));
  assert.equal((held!.policy_snapshot as Row).imageContextBudget, 'conversation-images-budget-v1');
  assert.equal((held!.policy_snapshot as Row).imageSchema, 'explicit-image-object-schema-v1');
  assert.equal(Number(held!.reserved_tokens), 128000); assert.equal(Number(held!.reserved_cost_micros), 1777778);
  let calls = 0;
  await processAgentAnswer(lease, { model: async (messages, _tools, turn, requestTools) => {
    calls++;
    const pixels = messages.flatMap(message => message.role === 'user' ? message.content.filter(part => part.type === 'image') : []);
    assert.equal(pixels.length, expectedImages, 'actual dispatched image count');
    for (const part of pixels) assert.ok(part.type === 'image' && part.data.length > 0);
    const final = requestTools?.length === 1 && requestTools[0].name === 'final_response';
    const body = agentChatBody({ model: 'qwen3.8-flash', messages, tools: requestTools!, maxTokens: 200, requireTool: true,
      ...(final ? { outputMode: 'json_schema' as const } : {}) }, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
    (report.dispatches as Row[]).push({ runId: lease.runId, turn, final, images: pixels.map(part => part.type === 'image'
      ? { mediaId: part.mediaId, hash: part.hash, bytes: Buffer.from(part.data, 'base64').length } : null),
      requestHash: hash(JSON.stringify(body)), format: body.response_format?.type ?? null });
    if (turn === 0 && readFormal) {
      assert.ok(requestTools!.some(tool => tool.name === 'query_materials'));
      return { text: '', toolCalls: [{ id: 'formal-read', name: 'query_materials', arguments: JSON.stringify({ leadId: readFormal.leadId, room: '厨房' }) }],
        finishReason: 'tool_calls', providerRequestId: 'synthetic', usage: { inputTokens: 0, outputTokens: 0 } };
    }
    if (readFormal) assert.match(JSON.stringify(messages), /图内墙边记录：4000毫米、3000毫米/);
    if (final && expectedImages > 0) assert.deepEqual(requestTools![0].parameters.required, ['kind']);
    if (!final) {
      const finish = requestTools!.find(tool => tool.name === 'finish_context')!;
      assert.ok(finish, 'native context planning remains active');
      const branches = finish.parameters.anyOf as Array<{ properties: { mode: { const: string }; questionSourceIds: { items: { enum: string[] } } } }> | undefined;
      const answer = branches?.find(branch => branch.properties.mode.const === 'answer');
      return { text: '', toolCalls: [{ id: 'finish-' + turn, name: 'finish_context', arguments: JSON.stringify(answer
        ? { mode: 'answer', questionSourceIds: answer.properties.questionSourceIds.items.enum } : {}) }],
      finishReason: 'tool_calls', providerRequestId: 'synthetic', usage: { inputTokens: 0, outputTokens: 0 } };
    }
    assert.equal(body.response_format?.type, 'json_schema');
    const answer = { kind: 'synthesis', segments: [{ basis: 'advice', text: '这是图文服务链路的合成测试答复，具体安排需结合现场条件核实。', citations: [] }] };
    return { text: JSON.stringify(answer), toolCalls: [], finishReason: 'stop', providerRequestId: 'synthetic',
      usage: { inputTokens: 0, outputTokens: 0 }, observation: { latencyMs: 0, cache: cacheObservation(null),
        prefix: modelPrefixObservation(messages, requestTools), format: { mode: 'json_schema', jsonValid: true, schemaValid: true } } } as ModelTurnOutput;
  } });
  const run = await new ConversationService(actor).run(lease.runId);
  assert.equal(run.status, 'succeeded', JSON.stringify(run));
  assert.equal(calls, readFormal ? 3 : 2, 'bounded read/planning/native final, no repair sampling');
  const steps = await withTenantTransaction(fixture!.enterpriseId, tx => rows(tx, sql`select kind,input_summary,private_checkpoint,source_refs
    from app.assistant_run_steps where enterprise_id=${fixture!.enterpriseId} and run_id=${lease.runId} order by step_seq`));
  const modelSteps = steps.filter(step => step.kind === 'agent_model');
  assert.equal((modelSteps.at(-1)!.input_summary as Row).nativeFinalProjection, nativeImageFinalProjection);
  assert.equal((modelSteps.at(-1)!.input_summary as Row).imageContext, conversationImageProtocol);
  const checkpoint = steps.find(step => step.kind === 'agent_checkpoint')!;
  if (expectedClaims !== undefined) assert.equal(steps.some(step => step.kind === 'agent_requirement_claim_context'), expectedClaims,
    'prior customer originals retain the state-bound claim protocol during image answering');
  for (const message of (checkpoint.private_checkpoint as { messages: ModelMessage[] }).messages) {
    if (message.role === 'user') for (const part of message.content) if (part.type === 'image') assert.equal(part.data, '');
  }
  return { runId: lease.runId, calls, claimPolls, checkpoint, steps: steps.map(step => ({ kind: step.kind, summary: step.input_summary })) };
}
async function main() {
  save();
  try {
    release = await lockAssistantAcceptance(process.env.DATABASE_URL!);
    await createFixture(); const base = '/conversations/' + fixture!.conversationId;
    const bytes = fs.readFileSync(path.join(root, 'tmp/xiaok-vector/renovation-photos/window.jpg'));
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/renovation-photos/manifest.json'), 'utf8'));
    assert.equal(hash(bytes), manifest.find((entry: Row) => entry.id === 'window').sha256);
    const uploadBody = { data: bytes.toString('base64'), kind: 'image', roomName: '' }, requestKey = randomUUID();
    if (!nativeOnly) {
    let mediaId = '', initial: Awaited<ReturnType<typeof runWorker>>;
    await step('image quota token and cost limits reject atomically before creating a run or job', async () => {
      const counts = async () => withTenantTransaction(fixture!.enterpriseId, tx => one(tx, sql`select
        (select count(*) from app.assistant_runs where enterprise_id=${fixture!.enterpriseId}) runs,
        (select count(*) from app.assistant_jobs where enterprise_id=${fixture!.enterpriseId}) jobs,
        (select count(*) from app.assistant_messages where enterprise_id=${fixture!.enterpriseId}) messages,
        (select count(*) from app.assistant_quota_reservations where enterprise_id=${fixture!.enterpriseId}) reservations`));
      const before = await counts();
      for (const limited of ['tokens', 'cost']) {
        await withTenantTransaction(fixture!.enterpriseId, async tx => tx.execute(sql`update app.assistant_enterprise_settings
          set daily_tokens=${limited === 'tokens' ? 127999 : 1000000},daily_cost_micros=${limited === 'cost' ? 1777777 : 10000000}
          where enterprise_id=${fixture!.enterpriseId}`));
        const key = randomUUID(), response = await api(base + '/messages', 'POST', { clientMessageId: key, content: { version: 1,
          blocks: [{ type: 'text', text: '想先了解厨房收纳。' }] } }, key);
        assert.equal(response.status, 429); assert.match(JSON.stringify(await response.json()), /assistant_quota_exceeded/);
        assert.deepEqual(await counts(), before, 'failed reservation leaves no customer write or queued work');
      }
      await withTenantTransaction(fixture!.enterpriseId, async tx => tx.execute(sql`update app.assistant_enterprise_settings
        set daily_tokens=1000000,daily_cost_micros=10000000 where enterprise_id=${fixture!.enterpriseId}`));
      return { tokenLimit: 429, costLimit: 429, noPartialWrites: true, tokens: 128000, costMicros: 1777778 };
    });
    await step('real upload is idempotent and automatically schedules the ordinary C01 Worker', async () => {
      const priorKey = randomUUID();
      await data(await api(base + '/messages', 'POST', { clientMessageId: priorKey, content: { version: 1,
        blocks: [{ type: 'text', text: '想把厨房的收纳安排得顺手些。' }] } }, priorKey));
      await runWorker(0, true);
      const first = await data(await api(base + '/media', 'POST', uploadBody, requestKey));
      const repeated = await data(await api(base + '/media', 'POST', uploadBody, requestKey));
      assert.equal(first.id, repeated.id); mediaId = first.id;
      initial = await runWorker(1, true);
      return { mediaId, runId: initial.runId, calls: initial.calls, priorTextClaimsPreserved: true };
    });
    await step('follow-up reuses authorized original pixels through planning, native schema, checkpoint and reentry', async () => {
      const key = randomUUID();
      await data(await api(base + '/messages', 'POST', { clientMessageId: key, content: { version: 1, blocks: [{ type: 'text', text: '靠窗这一边能安排收纳吗？' }] } }, key));
      const next = await runWorker(1);
      const reread = await data(await api(base + '/messages'));
      assert.match(JSON.stringify(reread), /合成测试答复/);
      const recovered = await withTenantTransaction(fixture!.enterpriseId, tx => hydrateImages(tx, fixture!.enterpriseId,
        fixture!.conversationId, (next.checkpoint.private_checkpoint as { messages: ModelMessage[] }).messages));
      assert.ok(recovered.some(message => message.role === 'user' && message.content.some(part => part.type === 'image' && part.mediaId === mediaId && part.data.length > 0)));
      return { runId: next.runId, persisted: true, checkpointRehydrated: true };
    });
    await step('another customer, missing bearer and mismatched hashes cannot read these pixels', async () => {
      assert.equal((await api(base + '/media/' + mediaId, 'GET', undefined, undefined, otherToken)).status, 404);
      assert.equal((await api(base + '/media/' + mediaId, 'GET', undefined, undefined, '')).status, 401);
      const wrongHash = await withTenantTransaction(fixture!.enterpriseId, tx => resolveAgentMedia(tx, fixture!.enterpriseId,
        fixture!.conversationId, { type: 'assistant_media', id: mediaId, hash: 'incorrect' }));
      assert.equal(wrongHash, undefined);
      return { otherCustomer: 404, unauthenticated: 401, wrongHash: 'unavailable' };
    });
    await step('the actual Worker reads stored formal dimensions; another customer and changed geometry lose access', async () => {
      const layout = { version: 4, measurementMode: 'surveying', surveyGraph: { kind: 'survey-wall-graph', activeFloorId: 'f', floors: [{
        id: 'f', name: '一层', ceilingHeightMm: 2800,
        nodes: [{ id: 'a', xMm: 0, yMm: 0 }, { id: 'b', xMm: 4000, yMm: 0 }, { id: 'c', xMm: 4000, yMm: 3000 }, { id: 'd', xMm: 0, yMm: 3000 }],
        walls: [{ id: 'ab', startNodeId: 'a', endNodeId: 'b', lengthMm: 4000 }, { id: 'bc', startNodeId: 'b', endNodeId: 'c', lengthMm: 3000 },
          { id: 'cd', startNodeId: 'c', endNodeId: 'd', lengthMm: 4000 }, { id: 'da', startNodeId: 'd', endNodeId: 'a', lengthMm: 3000 }],
        spaces: [{ id: 'k', name: '厨房', closed: true, wallIds: ['ab', 'bc', 'cd', 'da'] }], openings: [],
      }] } };
      const owned = await withTenantTransaction(fixture!.enterpriseId, async tx => {
        const planId = String((await one(tx, sql`insert into app.floor_plans(enterprise_id,creator_id,name,source,status,layout_data)
          values(${fixture!.enterpriseId},${fixture!.userId},'测试专用 · 正式厨房图内记录','manual','completed',${JSON.stringify(layout)}::jsonb) returning id`))!.id);
        const leadId = String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source,primary_floor_plan_id)
          values(${fixture!.enterpriseId},${fixture!.userId},'测试专用 · 图文只读','13000000000','manual',${planId}) returning id`))!.id);
        return { planId, leadId };
      });
      const key = randomUUID(); await data(await api(base + '/messages', 'POST', { clientMessageId: key, content: { version: 1,
        blocks: [{ type: 'text', text: '想把水槽挪到旁边那面墙，怎么结合厨房图纸考虑？' }] } }, key));
      const executed = await runWorker(1, true, owned);
      const plan = await withTenantTransaction(fixture!.enterpriseId, tx => one(tx, sql`select layout_data from app.floor_plans where id=${owned.planId}`));
      assert.equal(fingerprint(plan!.layout_data), fingerprint(layout), 'Worker never edits the formal graph');
      const messages = (executed.checkpoint.private_checkpoint as { messages: ModelMessage[] }).messages;
      const result = messages.flatMap(message => message.role === 'tool' ? [JSON.parse(message.content)] : []).find(packet => packet.query?.domain === 'materials') as MaterialSnapshot;
      assert.ok(result && result.data.sources.some(source => source.ref.type === 'formal_floorplan' && source.text.includes('4000毫米')));
      const oldSources = result.data.sources.map(source => {
        const old = { ...source }; delete old.need;
        if (old.ref.type === 'formal_floorplan') { old.text = '测试专用 · 正式厨房图内记录'; delete old.floorplan; }
        return old;
      });
      assert.equal(result.version, fingerprint({ data: { ...result.data, sources: oldSources }, leadIds: result.leadIds }),
        'the unchanged legacy dependency retains its exact version; the layout hash owns new dimensions');
      assert.equal(await withTenantTransaction(fixture!.enterpriseId, tx => materialSnapshotAvailable(tx, fixture!.enterpriseId, result)), true);
      await assert.rejects(withTenantTransaction(fixture!.enterpriseId, tx => queryMaterials(tx,
        { ...actor, principal: { kind: 'user', userId: fixture!.otherUserId } }, fixture!.conversationId, { leadId: owned.leadId, room: '厨房' })), /assistant_resource_not_found/);
      layout.surveyGraph.floors[0].walls[0].lengthMm = 4100;
      await withTenantTransaction(fixture!.enterpriseId, async tx => tx.execute(sql`update app.floor_plans set layout_data=${JSON.stringify(layout)}::jsonb where id=${owned.planId}`));
      assert.equal(await withTenantTransaction(fixture!.enterpriseId, tx => materialSnapshotAvailable(tx, fixture!.enterpriseId, result)), false);
      return { runId: executed.runId, storedDimensions: [4000, 3000], graphUnchangedByWorker: true, otherCustomer: 'denied', changedSnapshot: 'unavailable' };
    });
    await step('withdrawal invalidates derived answers and saved pixels; a later turn cannot resurrect the photo', async () => {
      const checkpoint = initial!.checkpoint;
      await data(await api(base + '/media/' + mediaId, 'DELETE'));
      assert.equal((await api(base + '/media/' + mediaId)).status, 404);
      await assert.rejects(withTenantTransaction(fixture!.enterpriseId, tx => hydrateImages(tx, fixture!.enterpriseId,
        fixture!.conversationId, (checkpoint.private_checkpoint as { messages: ModelMessage[] }).messages)), /context_changed/);
      const answer = await withTenantTransaction(fixture!.enterpriseId, tx => one(tx, sql`select id from app.assistant_messages
        where enterprise_id=${fixture!.enterpriseId} and run_id=${initial!.runId} and author_kind='assistant'`));
      assert.equal(await withTenantTransaction(fixture!.enterpriseId, tx => agentMessageAvailable(tx, fixture!.enterpriseId, fixture!.conversationId, String(answer!.id))), false);
      const key = randomUUID();
      await data(await api(base + '/messages', 'POST', { clientMessageId: key, content: { version: 1, blocks: [{ type: 'text', text: '先聊一般的收纳思路吧。' }] } }, key));
      const next = await runWorker(0);
      return { mediaRead: 404, derivedAnswerAvailable: false, checkpoint: 'context_changed', nextRunId: next.runId, nextImages: 0 };
    });
    }
    if (process.argv.includes('--native')) report.native = await nativeImageAcceptance({
      root, output, enterpriseId: fixture!.enterpriseId, conversationId: fixture!.conversationId, token, bytes,
      runWorker, record: step,
    });
    const attempts = await withTenantTransaction(fixture!.enterpriseId, tx => rows(tx, sql`select id from app.ai_provider_attempts where enterprise_id=${fixture!.enterpriseId}`));
    assert.equal(attempts.length, 0); assert.equal(report.externalCalls, 0);
    report.providerAttempts = 0; report.passed = true;
  } catch (error) { report.error = String((error as Error).stack || error); process.exitCode = 1; }
  finally {
    const cleanupErrors: string[] = [];
    try { if (fixture) await withPlatformTransaction(async tx => {
      await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${fixture!.enterpriseId}`);
      await tx.execute(sql`update app.users set context_version=context_version+1 where id in (${fixture!.userId},${fixture!.otherUserId})`);
      await tx.execute(sql`update app.assistant_jobs set status='cancelled',lease_token=null,lease_expires_at=null where enterprise_id=${fixture!.enterpriseId} and status in ('queued','running')`);
    }); report.fixtureCleaned = !!fixture; } catch (error) { cleanupErrors.push(String(error)); }
    globalThis.fetch = previousFetch;
    if (previousAllowlist === undefined) delete process.env.ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS;
    else process.env.ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS = previousAllowlist;
    try { if (release) await release(); } catch (error) { cleanupErrors.push(String(error)); }
    try { await closePostgresPool(); } catch (error) { cleanupErrors.push(String(error)); }
    report.after = binding(); report.drift = Object.keys(report.before as Row).filter(file => (report.before as Row)[file] !== (report.after as Row)[file]);
    report.cleanupErrors = cleanupErrors;
    if ((report.drift as unknown[]).length || cleanupErrors.length) report.passed = false;
    if (!report.passed) process.exitCode = 1;
    save(); console.log(JSON.stringify({ output, passed: report.passed, checks: (report.checks as unknown[]).length, drift: report.drift, error: report.error ?? null }));
  }
}
void main();
