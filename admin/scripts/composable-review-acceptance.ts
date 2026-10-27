import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { ConversationService, appendMessage } from '@/lib/assistant/core/conversation';
import { RequirementWorkflow } from '@/lib/assistant/requirements/workflow';
import { requirementSources } from '@/lib/assistant/requirements/items';
import type { DraftRequirements } from '@/lib/assistant/requirements/contract';
import { businessReviewTools } from '@/lib/assistant/agent/review-tools';
import { getPlatformLlmConfig } from '@/lib/platform-llm-config';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { reviewBudget, reviewTokens, type RetainedReviewHold } from './assistant-review-budget';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
import { bindBailianReviewTestRuntime } from './bailian-review-test-runtime';
import type { ActorContext } from '@/lib/assistant/contracts';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { currentSynthesisContext } from '@/lib/assistant/agent/synthesis-sources';
import {nativeFinalProtocol,finishContextTool} from '@/lib/assistant/agent/native-final';
import { reviewClaimProtocol } from '@/lib/assistant/agent/review-claims';
import { boundReviewClaims } from '@/lib/assistant/agent/review-claim-sources';
import { reviewCompletionProtocol } from '@/lib/assistant/agent/review-completion';

type Row = Record<string, unknown>;
type Fixture = { actor: ActorContext; conversationId: string; userId: string; enterpriseId: string; checkpoints: string[]; activeRunId?: string };
const root = path.resolve(process.cwd(), '..');
createRequire(path.join(root, 'admin/package.json'))('@next/env').loadEnvConfig(process.cwd(), true);
const db = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, '')).DATABASE_URL;
const dbUrl = new URL(db);
assert.ok(['127.0.0.1', 'localhost'].includes(dbUrl.hostname) && dbUrl.port === '55432' && dbUrl.pathname === '/xiaok_embedding_eval');
process.env.DATABASE_URL = db;
process.env.LANGCHAIN_TRACING_V2 = 'false';
process.env.LANGSMITH_TRACING = 'false';
const live = process.argv.includes('--live');
const repeats = !live && process.argv.includes('--services-once') ? 1 : 2;
const verifyOriginals = process.argv.includes('--verify-review-originals');
const nativeFinal = process.argv.includes('--native-sourced-final');
const claims = process.argv.includes('--requirement-claims');
const completion = process.argv.includes('--review-completion');
assert.ok(!completion || claims, 'Completion contract requires state-bound claims');
assert.ok(!claims || nativeFinal, 'Claim contract requires the native final strategy');
assert.ok(!(live && verifyOriginals), 'Deterministic source injection cannot be used for live acceptance');
const budget = reviewBudget(root);
// Two fixed natural conversations, two repetitions each: 2 + 3 turns.
const callCap = 60000, plannedCalls = live ? 40 : 0;
const authorizationIndex = process.argv.indexOf('--retained-holds-authorization');
const authorizationFile = authorizationIndex < 0 ? null : process.argv[authorizationIndex + 1];
let fixtureAgent = { runtime: 'langgraph-v1', providerKey: 'dashscope', model: nativeFinal?'qwen3.8-flash':'qwen3.7-flash', tools: true, imageInput: false, probeVersion: 'd1-composable-review',...(nativeFinal?{structuredFinal:nativeFinalProtocol}:{}), ...(claims ? {requirementClaims:reviewClaimProtocol} : {}), ...(completion ? {reviewCompletion:reviewCompletionProtocol} : {}) };
const output = path.join(root, 'tmp', live ? 'agent-contract' : 'agent-runtime',
  `${live ? 'trial-' : 'services-'}composable-d1-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const sourceFiles = ['admin/src/lib/assistant/agent/worker.ts', 'admin/src/lib/assistant/agent/review-tools.ts',
  'admin/src/lib/assistant/agent/review-runtime.ts', 'admin/src/lib/assistant/agent/runtime.ts',
  'admin/src/lib/assistant/core/conversation.ts', 'admin/src/lib/assistant/core/review-graph.ts',
  'admin/src/lib/assistant/requirements/workflow.ts', 'admin/src/lib/assistant/requirements/service.ts',
  'admin/src/lib/assistant/requirements/plan.ts', 'admin/src/lib/assistant/requirements/items.ts',
  'admin/src/lib/assistant/requirements/selection.ts', 'admin/src/lib/assistant/handoff/workflow.ts',
  'admin/src/lib/assistant/handoff/proposal.ts',
  'admin/src/lib/ai/providers/agent-chat.ts', 'admin/scripts/composable-review-acceptance.ts', 'admin/src/lib/assistant/__tests__/composable-review.test.ts',
  'miniprogram/packages/assistant/chat/chat.wxml', 'miniprogram/packages/assistant/lib/requirements.js',
  'miniprogram/packages/assistant/requirements/requirements.js',
  'miniprogram/packages/assistant/requirements/requirements.wxml'];
if (authorizationFile) sourceFiles.push(authorizationFile);
for (const directory of ['admin/src/lib/assistant', 'admin/src/lib/ai/providers', 'miniprogram/packages/assistant/lib']) {
  const walk = (folder: string) => {
    for (const item of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
      const file = folder + '/' + item.name;
      if (item.isDirectory()) walk(file);
      else if (/\.(?:ts|js)$/.test(file) && !sourceFiles.includes(file)) sourceFiles.push(file);
    }
  };
  walk(directory);
}
sourceFiles.push('admin/package-lock.json', 'admin/tsconfig.json', 'admin/src/db/transaction.ts',
  'admin/src/db/repositories/assistant-repository.ts', 'admin/scripts/assistant-review-budget.ts',
  'admin/scripts/assistant-acceptance-safety.mjs', 'admin/src/lib/ai/postgres-workflow-chat.ts', 'admin/src/lib/platform-llm-config.ts');
sourceFiles.push('admin/scripts/bailian-review-test-runtime.ts');
if (process.argv.includes('--bailian-existing-test-channel')) sourceFiles.push(
  'tmp/xiaok-intelligent-consult/openwebui-qwen37-cost.mjs', 'tmp/xiaok-intelligent-consult/.env.qwen37');
const hash = (name: string) => createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex');
const binding = () => Object.fromEntries(sourceFiles.map(file => [file, hash(file)]));
const report: Row = { delivery: 'D1', mode: live ? 'live' : 'deterministic',
  structuredFinal:nativeFinal?nativeFinalProtocol:'legacy',
  requirementClaims: claims ? reviewClaimProtocol : null,
  reviewCompletion: completion ? reviewCompletionProtocol : null,
  scope: `D1 fixed before dispatch: two journeys, each ${repeats === 2 ? 'twice' : 'once (deterministic only)'}; unfinished budget plus surveying question, selective budget change; unapproved correction, withdrawal plus question, new correction with response-loss recovery. Each entire real Worker trajectory is retained, never sampled to pass.`,
  model: live ? 'existing-platform-runtime-pending-preflight' : 'injected-deterministic', plannedCalls, callCap,
  beforeTokens: budget.usedTokens, beforeMicros: budget.usedMicros, actualBilledYuan: null,
  calls: [] as Row[], cases: [] as Row[], fixtures: [] as Row[], before: binding(), cleaned: false, passed: false };
const save = () => { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2)); };
const fixtures: Fixture[] = [];
let release: (() => Promise<void>) | undefined, unknown = false;
const originalFetch = globalThis.fetch;
let externalModelCalls = 0;
let approvedCallLimit = plannedCalls;
let restoreTestRuntime: (() => Promise<unknown>) | undefined;
const platformBinding = () => withPlatformTransaction(tx => rows(tx, sql`select key,md5(coalesce(llm_config,'{}'::jsonb)::text) hash
  from app.platform_configs order by key`));

async function fixture(): Promise<Fixture> {
  const code = 'synthetic-review-runtime-' + randomUUID();
  const ids = await withPlatformTransaction(async tx => {
    const enterpriseId = String((await one(tx, sql`insert into app.enterprises(name,code,status)
       values('测试专用 · 多轮需求审批',${code},'active') returning id`))!.id);
    const userId = String((await one(tx, sql`insert into app.users(nickname,context_version)
     values('测试专用 · 多轮业主',1) returning id`))!.id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${userId},${code})`);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
      values(${enterpriseId},true,100,1000000,10000000,30,
         ${JSON.stringify(fixtureAgent)}::jsonb)`);
    return { enterpriseId, userId };
  });
  const actor: ActorContext = { enterpriseId: ids.enterpriseId, principal: { kind: 'user', userId: ids.userId },
    contextVersion: 1, capabilities: ['assistant.chat.self'], entry: { kind: 'direct' } };
  process.env.ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS = ids.enterpriseId;
  const conversationId = String((await new ConversationService(actor).create(randomUUID())).id);
  const f = { actor, conversationId, ...ids, checkpoints: [] as string[] };
  fixtures.push(f); (report.fixtures as Row[]).push({ ...ids, conversationId, synthetic: true }); save();

  const originals = [
    ['90平旧房', 'housing'], ['客厅铺瓷砖', 'room'], ['不做地暖', 'devices'], ['预算12万', 'budget'],
  ] as const;
  for (const [text] of originals) await withTenantTransaction(ids.enterpriseId, tx => appendMessage(tx, actor, conversationId,
    { author: 'user', clientMessageId: randomUUID(), content: { version: 1, blocks: [{ type: 'text', text }] } }));
  const req = new RequirementWorkflow(actor), evidence = await req.requirements.customerEvidence(conversationId);
  const sources = requirementSources(evidence.messages);
  const baseline = await req.propose(conversationId, randomUUID(), { sourceSeq: evidence.sourceSeq, baseSummaryId: null,
    changes: originals.map(([text, field]) => ({ operation: 'add' as const, field,
      sourceId: sources.find(s => s.text === text)!.id })) });
  assert.equal(baseline.kind, 'proposal');
  if (baseline.kind !== 'proposal') throw Error('baseline_proposal_missing');
  f.checkpoints.push(String(baseline.proposal.id));
  await req.write(conversationId, randomUUID(), { action: 'apply_proposal', proposalId: baseline.proposal.id,
    digest: baseline.proposal.digest, consent: true, restoreConsent: false,
    selectedFields: originals.map(([, field]) => field) });

  return f;
}


type TurnKind = 'incomplete' | 'ten' | 'reject' | 'fifteen';
async function deterministicModel(f: Fixture, kind: TurnKind, turn: number): Promise<ModelTurnOutput> {
  if (verifyOriginals && kind === 'reject' && turn === 0) {
    const review = await businessReviewTools(f.actor, f.conversationId);
    return { text: '', toolCalls: [{ id: 'keep', name: 'propose_requirement_changes', arguments: JSON.stringify({
      retainedIds: review.context.savedItems.map(item => item.id), changes: [],
    }) }], finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 } };
  }
  if (turn === 0 && (kind === 'ten' || kind === 'fifteen')) {
    const review = await businessReviewTools(f.actor, f.conversationId);
    const item = review.context.savedItems.find(i => i.field === 'budget')!;
    const amount = kind === 'ten' ? '10万' : '15万';
    const source = [...review.context.customerClauses].reverse().find(s => s.text.includes(amount))!;
    assert.ok(item && source);
    return { text: '', toolCalls: [{ id: 'budget-change', name: 'propose_requirement_changes', arguments: JSON.stringify({
      retainedIds: review.context.savedItems.filter(i => i.id !== item.id).map(i => i.id),
      changes: [{ operation: 'replace', targetId: item.id, sourceId: source.id }],
    }) }], finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 } };
  }
  if (claims) {
    const catalog = await withTenantTransaction(f.enterpriseId, async tx => {
      const conversation = await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${f.enterpriseId} and id=${f.conversationId}`);
      assert.ok(conversation && f.activeRunId);
      return boundReviewClaims(tx, f.actor, conversation, f.activeRunId);
    });
    const selected = kind === 'incomplete' ? [] : kind === 'reject'
      ? catalog.claims.filter(claim => claim.state === 'saved_draft' && claim.field === 'budget')
      : catalog.claims.filter(claim => claim.state === 'pending_proposal' && claim.field === 'budget');
    if (kind !== 'incomplete') assert.equal(selected.length, 1);
    return { text: JSON.stringify({ kind: 'synthesis', segments: [
      { basis: 'advice', text: '量房前准备现有户型图及物业装修规定，现场核对漏水痕迹、墙体与设备位置；预算未定也可以先量房。', citations: [] },
      ...selected.map(claim => ({ claimId: claim.claimId })),
    ] }), toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 } };
  }
  if (verifyOriginals && kind !== 'incomplete') {
    const context = await withTenantTransaction(f.enterpriseId, async tx => {
      const conversation = await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${f.enterpriseId} and id=${f.conversationId}`);
      assert.ok(conversation && f.activeRunId);
      return currentSynthesisContext(tx, f.actor, conversation, f.activeRunId);
    });
    const original = context.sources.find(source => source.text === '预算12万'); assert.ok(original);
    const changed = context.sources.find(source => source.text.includes(kind === 'ten' ? '10万' : '15万'));
    if (kind !== 'reject') assert.ok(changed);
    const selected = kind === 'reject' ? [original] : [original, changed!];
    return { text: '', toolCalls: [{ id: 'answer', name: 'final_response', arguments: JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'advice',
      text: kind === 'reject' ? '原需求预算12万保持不变，量房前可以准备户型图和物业装修规定。'
        : `此前原话预算12万，本轮原话提出${kind === 'ten' ? '10万' : '15万'}；需求提案需要逐项采用。量房前可以准备户型图和物业装修规定。`,
      citations: selected.map(source => ({ sourceId: source.sourceId, quote: source.text })),
    }] }) }], finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 } };
  }
  return { text: '', toolCalls: [{ id: 'answer', name: 'final_response', arguments: JSON.stringify({ kind: 'general',
    text: kind === 'ten' ? '这次预算更改可在需求页选择采用，瓷砖沿用原需求。'
      : '量房前准备现有户型图及物业装修规定，整理常住人数、设备和保留家具的想法；现场说明漏水等已有问题。预算还没定也可以先量房。',
  }) }], finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 } };
}

async function runTurn(f: Fixture, scenario: string, kind: TurnKind, text: string) {
  const chat = new ConversationService(f.actor), req = new RequirementWorkflow(f.actor);
  const sent = await chat.send(f.conversationId, randomUUID(), { version: 1, blocks: [{ type: 'text', text }] });
  assert.ok(sent.runId);
  const before = await req.read(f.conversationId);
  const currentClauseIds = completion && !live ? requirementSources((await req.requirements.customerEvidence(f.conversationId)).messages)
    .filter(source => source.sourceMessageId === String(sent.messageId)).map(source => source.id) : [];
  const lease = await claimJob(); assert.ok(lease && lease.runId === sent.runId);
  f.activeRunId = String(sent.runId);
  const row: Row = { scenario, kind, text, enterpriseId: f.enterpriseId, conversationId: f.conversationId,
    runId: sent.runId, proposalExpiredBeforeRun: before.proposal === null, firstDraftPass: false };
  (report.cases as Row[]).push(row); save();
  const dispatch: Row | null = live ? { id: randomUUID(), runId: sent.runId, status: 'dispatching', reservedTokens: callCap * 4, startedAt: new Date().toISOString() } : null;
  if (dispatch) { (report.calls as Row[]).push(dispatch); save(); }
  await processAgentAnswer(lease!, live ? {} : { model: async (messages, tools, turn, active) => {
    assert.ok(active?.some(tool => tool.name === 'final_response'||nativeFinal&&tool.name===finishContextTool.name));
    assert.ok(!active?.some(tool => ['record_need', 'request_designer'].includes(tool.name)));
    if(nativeFinal&&active?.some(tool=>tool.name===finishContextTool.name)&&!(turn===0&&['ten','fifteen','reject'].includes(kind)))
      return {text:'',toolCalls:[{id:'context-ready-'+turn,name:finishContextTool.name,arguments: completion ? JSON.stringify({mode:kind==='ten'?'receipt_only':'answer',questionSourceIds:kind==='ten'?[]:[currentClauseIds.at(-1)!]}) : '{}'}],finishReason:'tool_calls',providerRequestId:null,usage:{inputTokens:0,outputTokens:0}};
    return deterministicModel(f, kind, turn);
  } });
  const run = await chat.run(String(sent.runId)), current = await req.read(f.conversationId);
  const detail = await chat.detail(f.conversationId);
  row.runStatus = run.status; row.errorCode = run.errorCode; row.proposal = current.proposal;
  row.chatPending = detail.requirementProposalPending;
  const reply = await withTenantTransaction(f.enterpriseId, tx => one(tx, sql`select content from app.assistant_messages
    where enterprise_id=${f.enterpriseId} and run_id=${String(sent.runId)} and author_kind='assistant' order by seq desc limit 1`));
  row.reply = ((reply?.content as { blocks?: { text?: string }[] })?.blocks || []).map(b => b.text || '').join('\n');
  const steps = await withTenantTransaction(f.enterpriseId, tx => rows(tx, sql`select kind,capability_name,status,input_summary,private_checkpoint
    from app.assistant_run_steps where enterprise_id=${f.enterpriseId} and run_id=${String(sent.runId)} order by step_seq`));
  row.steps = steps;
  if (dispatch) {
    const attempts = await withTenantTransaction(f.enterpriseId, tx => rows(tx, sql`select id,status,accepted from app.ai_provider_attempts where enterprise_id=${f.enterpriseId} and assistant_run_id=${String(sent.runId)} order by id`));
    const modelSteps = steps.filter(s => s.kind === 'agent_model');
    const outputs = modelSteps.map(s => s.private_checkpoint as ModelTurnOutput | null);
    const known = attempts.length > 0 && attempts.every(a => a.status === 'succeeded') && outputs.length === attempts.length && outputs.every(o => o?.usage);
    dispatch.providerAttempts = attempts; dispatch.status = known ? 'succeeded' : 'unknown';
    dispatch.finishedAt = new Date().toISOString();
    if (known) dispatch.usage = { total_tokens: outputs.reduce((sum, o) => sum + o!.usage!.inputTokens + o!.usage!.outputTokens, 0) };
    else unknown = true;
    save();
  }
  const validationFailed = steps.some(s => s.kind === 'agent_validation' && s.status === 'failed');
  const policy = await withTenantTransaction(f.enterpriseId, tx => one(tx, sql`select policy_snapshot from app.assistant_runs
    where enterprise_id=${f.enterpriseId} and id=${String(sent.runId)}`));
  assert.equal((policy!.policy_snapshot as Row).reviewRuntime, 'composable-business-review-v2');
  const fields = ((current.proposal?.diff || []) as Array<{ field: string }>).map(d => d.field);
  const onlyReply = kind === 'incomplete' || kind === 'reject';
  const checkpoint = steps.find(s => s.kind === 'agent_checkpoint')?.private_checkpoint as { messages?: Array<{ role: string; content?: string }> } | undefined;
  const pendingToolState = checkpoint?.messages?.some(message => {
    if (message.role !== 'tool' || typeof message.content !== 'string') return false;
    try { return JSON.parse(message.content).status === 'pending'; } catch { return false; }
  });
  row.firstDraftPass = run.status === 'succeeded' && !validationFailed
    && (kind === 'ten' || /量房|户型图|物业|尺寸|家具/.test(String(row.reply)))
    && (onlyReply ? !current.proposal && !detail.requirementProposalPending
      : fields.length === 1 && fields[0] === 'budget' && !!current.proposal
        && String((current.proposal.summary.draftFields as DraftRequirements).budget.text).includes(kind === 'ten' ? '10万' : '15万')
        && pendingToolState === true && /尚未写入草稿/.test(String(row.reply)));
  if (current.proposal) f.checkpoints.push(String(current.proposal.id));
  save(); return row;
}

async function runCase(index: number, scenario: 'incomplete' | 'correction') {
  const f = await fixture(), req = new RequirementWorkflow(f.actor);
  const baseline = (await req.read(f.conversationId)).latest!;
  const turns: Row[] = [];
  if (scenario === 'incomplete') {
    turns.push(await runTurn(f, scenario, 'incomplete', '预算还没想好，先告诉我量房前要准备什么？'));
    if (unknown) return;
  } else {
    const first = await runTurn(f, scenario, 'ten', '预算先改成10万吧，瓷砖和地暖照旧。');
    turns.push(first);
    if (unknown) return;
    turns.push(await runTurn(f, scenario, 'reject', '还是别用刚才那个数，预算先保持原来。量房时我要带哪些资料？'));
    if (unknown) return;
    if (first.proposal) {
      const proposal = first.proposal as { id: string; digest: string };
      await assert.rejects(() => req.write(f.conversationId, randomUUID(), { action: 'apply_proposal',
        proposalId: proposal.id, digest: proposal.digest, consent: true, restoreConsent: false, selectedFields: ['budget'] }),
      /requirement_target_changed|requirements_stale/);
    }
  }
  const last = await runTurn(f, scenario, 'fifteen', '预算提高到15万，瓷砖和地暖先照旧。另外老房量房时有哪些容易漏的地方？');
  turns.push(last);
  if (!last.firstDraftPass || !last.proposal) return;
  const proposal = last.proposal as { id: string; digest: string }, key = randomUUID();
  const body = { action: 'apply_proposal', proposalId: proposal.id, digest: proposal.digest,
    consent: true, restoreConsent: false, selectedFields: ['budget'] };
  if (scenario === 'correction') {
    await assert.rejects(() => new RequirementWorkflow(f.actor, { afterWrite: async () => { throw Error('synthetic_response_loss'); } })
      .write(f.conversationId, key, body), /synthetic_response_loss/);
  }
  const saved = await req.write(f.conversationId, key, body);
  const reopened = await new RequirementWorkflow(f.actor).read(f.conversationId);
  const fields = saved.draftFields as DraftRequirements, original = baseline.draftFields as DraftRequirements;
  const count = await withTenantTransaction(f.enterpriseId, tx => one(tx, sql`select count(*)::int n from app.assistant_requirement_summaries
    where enterprise_id=${f.enterpriseId} and conversation_id=${f.conversationId}`));
  const passed = turns.every(t => t.firstDraftPass === true) && saved.status === 'draft' && !saved.confirmedFields
    && saved.receipt?.effect === 'draft_saved' && fields.budget.text.includes('15万')
    && JSON.stringify(fields.room) === JSON.stringify(original.room)
    && JSON.stringify(fields.devices) === JSON.stringify(original.devices)
    && reopened.latest?.id === saved.id && !reopened.proposal && Number(count!.n) === 2
    && (await req.write(f.conversationId, key, body)).id === saved.id;
  last.approvalPass = passed; last.rejectionPass = passed; last.receipt = saved.receipt; last.summaryCount = Number(count!.n);
  const other: ActorContext = { ...f.actor, principal: { kind: 'user', userId: '1' } };
  await assert.rejects(() => new RequirementWorkflow(other).read(f.conversationId));
  last.permissionRejected = true; last.index = index; save();
}

async function main() {
  save();
  try {
    release = await lockAssistantAcceptance(db);
    if (live) {
      if (process.argv.includes('--bailian-existing-test-channel')) {
        assert.ok(authorizationFile, 'Explicit fixed-batch authorization required');
        const approval = JSON.parse(fs.readFileSync(path.resolve(root, authorizationFile), 'utf8'));
        assert.equal(approval.providerKey, 'dashscope'); assert.equal(approval.model, 'qwen3.8-flash');
        const bound = await bindBailianReviewTestRuntime(root, output);
        restoreTestRuntime = bound.restore; report.testRuntime = bound.receipt;
      }
      const c = await getPlatformLlmConfig();
      assert.ok(c.enabled && c.available, 'Existing platform runtime unavailable; no new credentials or fallback');
      const retained: RetainedReviewHold[] = [];
      if (authorizationFile) {
        const approval = JSON.parse(fs.readFileSync(path.resolve(root, authorizationFile), 'utf8'));
        assert.equal(approval.scope, 'one-new-d1-batch-retaining-detached-holds');
        assert.equal(approval.authorizedBy, 'direct-human-user');
        assert.match(String(approval.batchId), /^d1-[a-z0-9-]{10,100}$/);
        assert.equal(approval.cumulativeCapMicros, budget.scope.cumulativeMicros);
        assert.equal(approval.providerKey, c.providerKey); assert.equal(approval.model, c.model);
        assert.ok(Number.isInteger(approval.maxCalls) && approval.maxCalls > 0 && approval.maxCalls <= plannedCalls);
        approvedCallLimit = approval.maxCalls; report.plannedCalls = approvedCallLimit;
        assert.equal(approval.callTokenCap, callCap);
        const originals = approval.retainedReports || [{ path: 'tmp/agent-contract/trial-composable-d1-2026-10-26T17-01-30-833Z.json', hash: approval.originalTrialHash }];
        for (const prior of originals) {
          assert.match(prior.path, /^tmp\/agent-contract\/trial-[\w.-]+\.json$/);
          const data = fs.readFileSync(path.join(root, prior.path));
          assert.equal(createHash('sha256').update(data).digest('hex'), prior.hash);
          const original = JSON.parse(data.toString('utf8'));
          retained.push(...original.calls.filter((call: { status: string }) => call.status !== 'succeeded')
            .map((call: RetainedReviewHold) => ({ id: call.id, runId: call.runId, reservedTokens: call.reservedTokens })));
        }
        assert.deepEqual(retained, approval.retainedHolds);
        for (const name of fs.readdirSync(path.dirname(output)).filter(name => /^trial-.*\.json$/.test(name))) {
          const existing = JSON.parse(fs.readFileSync(path.join(path.dirname(output), name), 'utf8'));
          assert.notEqual(existing.authorizationBatchId, approval.batchId, 'One batch authorization cannot be replayed');
        }
        report.authorizationBatchId = approval.batchId;
        report.retainedHistoricalHolds = retained;
        report.originalTrialHash = approval.originalTrialHash;
      }
      budget.assertReservation(0, approvedCallLimit * callCap, retained);
      fixtureAgent = { ...fixtureAgent, model: c.model, providerKey: c.providerKey };
      process.env.ASSISTANT_TEXT_MODEL = c.model;
      report.thinkingOverride = process.env.ASSISTANT_TEXT_DISABLE_THINKING === '1' ? 'disabled' : 'provider-default';
      report.platformBefore = await platformBinding();
      const providerOrigin = new URL(c.baseUrl).origin;
      globalThis.fetch = async (resource, init) => {
        const url = new URL(typeof resource === 'string' || resource instanceof URL ? String(resource) : resource.url);
        if (url.origin === providerOrigin && url.pathname.endsWith('/chat/completions')) {
          assert.ok(externalModelCalls < approvedCallLimit, 'Fixed D1 batch provider-call cap reached');
          report.externalModelCalls = ++externalModelCalls; save();
        }
        return originalFetch(resource, init);
      };
      report.model = c.model; report.providerKey = c.providerKey; report.providerConnection = 'existing product service; no credential file access'; save();
    }
    for (let repeat = 1; repeat <= repeats; repeat++) for (const scenario of ['incomplete', 'correction'] as const) {
      if (unknown) break;
      await runCase((repeat - 1) * 2 + (scenario === 'incomplete' ? 1 : 2), scenario);
    }
    report.passed = !unknown && (report.cases as Row[]).length === repeats * 5
      && (report.cases as Row[]).every(c => c.firstDraftPass === true)
      && (report.cases as Row[]).filter(c => c.kind === 'fifteen' && c.scenario === 'incomplete').every(c => c.approvalPass === true)
      && (report.cases as Row[]).filter(c => c.kind === 'fifteen' && c.scenario === 'correction').every(c => c.rejectionPass === true);
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    report.error = error instanceof Error ? error.stack : String(error); report.passed = false; process.exitCode = 1;
  } finally {
    globalThis.fetch = originalFetch;
    try {
      for (const f of fixtures) {
        for (const id of f.checkpoints) await new RequirementWorkflow(f.actor).forget(f.conversationId, id);
        await withPlatformTransaction(async tx => {
          await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${f.enterpriseId}`);
          await tx.execute(sql`update app.users set context_version=context_version+1 where id=${f.userId}`);
        });
      }
      report.cleaned = true;
    } catch (error) { report.cleanupError = String(error); report.passed = false; process.exitCode = 1; }
    delete process.env.ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS;
    if (live && report.platformBefore) {
      try {
        report.platformAfter = await platformBinding();
        assert.deepEqual(report.platformAfter, report.platformBefore, 'Model configuration changed within the batch');
      } catch (error) { report.configurationError = String(error); report.passed = false; process.exitCode = 1; }
    }
    if (restoreTestRuntime) {
      try { report.testRuntimeRestore = await restoreTestRuntime(); }
      catch (error) { report.configurationRestoreError = String(error); report.passed = false; process.exitCode = 1; }
    }
    if (release) await release();
    report.after = binding(); report.drift = sourceFiles.filter(file => (report.before as Row)[file] !== (report.after as Row)[file]);
    if ((report.drift as string[]).length) { report.passed = false; process.exitCode = 1; }
    report.newTokens = reviewTokens(report.calls as Array<{status: string; reservedTokens?: number; usage?: {total_tokens: number}}>);
    report.conservativeMicros = budget.usedMicros + Number(report.newTokens) * 5;
    save(); await closePostgresPool();
    console.log(JSON.stringify({ output: path.relative(root, output), passed: report.passed,
      cases: (report.cases as Row[]).length, calls: (report.calls as Row[]).length,
      cleaned: report.cleaned, drift: report.drift, error: report.error || null }));
  }
}
void main();
