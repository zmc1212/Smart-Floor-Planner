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
import { reviewBudget, reviewTokens } from './assistant-review-budget';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
import type { ActorContext } from '@/lib/assistant/contracts';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';

type Row = Record<string, unknown>;
type Fixture = { actor: ActorContext; conversationId: string; userId: string; enterpriseId: string; checkpoints: string[] };
const root = path.resolve(process.cwd(), '..');
createRequire(path.join(root, 'admin/package.json'))('@next/env').loadEnvConfig(process.cwd(), true);
const db = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, '')).DATABASE_URL;
const dbUrl = new URL(db);
assert.ok(['127.0.0.1', 'localhost'].includes(dbUrl.hostname) && dbUrl.port === '55432' && dbUrl.pathname === '/xiaok_embedding_eval');
process.env.DATABASE_URL = db;
process.env.LANGCHAIN_TRACING_V2 = 'false';
process.env.LANGSMITH_TRACING = 'false';
const live = process.argv.includes('--live');
const budget = reviewBudget(root);
// Two fixed natural conversations, two repetitions each: 2 + 3 turns.
const callCap = 60000, plannedCalls = live ? 40 : 0;
if (live) budget.assertReservation(0, plannedCalls * callCap);
let fixtureAgent = { runtime: 'langgraph-v1', providerKey: 'dashscope', model: 'qwen3.7-flash', tools: true, imageInput: false, probeVersion: 'd1-composable-review' };
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
const hash = (name: string) => createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex');
const binding = () => Object.fromEntries(sourceFiles.map(file => [file, hash(file)]));
const report: Row = { delivery: 'D1', mode: live ? 'live' : 'deterministic',
  scope: 'D1 fixed before dispatch: two journeys, each twice; unfinished budget plus surveying question, selective budget change; unapproved correction, withdrawal plus question, new correction with response-loss recovery. Each entire real Worker trajectory is retained, never sampled to pass.',
  model: live ? 'existing-platform-runtime-pending-preflight' : 'injected-deterministic', plannedCalls, callCap,
  beforeTokens: budget.usedTokens, beforeMicros: budget.usedMicros, actualBilledYuan: null,
  calls: [] as Row[], cases: [] as Row[], fixtures: [] as Row[], before: binding(), cleaned: false, passed: false };
const save = () => { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2)); };
const fixtures: Fixture[] = [];
let release: (() => Promise<void>) | undefined, unknown = false;

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
  const lease = await claimJob(); assert.ok(lease && lease.runId === sent.runId);
  const row: Row = { scenario, kind, text, enterpriseId: f.enterpriseId, conversationId: f.conversationId,
    runId: sent.runId, proposalExpiredBeforeRun: before.proposal === null, firstDraftPass: false };
  (report.cases as Row[]).push(row); save();
  const dispatch: Row | null = live ? { id: randomUUID(), runId: sent.runId, status: 'dispatching', reservedTokens: callCap * 4, startedAt: new Date().toISOString() } : null;
  if (dispatch) { (report.calls as Row[]).push(dispatch); save(); }
  await processAgentAnswer(lease!, live ? {} : { model: async (messages, tools, turn, active) => {
    assert.ok(active?.some(tool => tool.name === 'final_response'));
    assert.ok(!active?.some(tool => ['record_need', 'request_designer'].includes(tool.name)));
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
      const c = await getPlatformLlmConfig();
      assert.ok(c.enabled && c.available, 'Existing platform runtime unavailable; no new credentials or fallback');
      fixtureAgent = { ...fixtureAgent, model: c.model, providerKey: c.providerKey };
      process.env.ASSISTANT_TEXT_MODEL = c.model; delete process.env.ASSISTANT_TEXT_DISABLE_THINKING;
      report.model = c.model; report.providerKey = c.providerKey; report.providerConnection = 'existing product service; no credential file access'; save();
    }
    for (let repeat = 1; repeat <= 2; repeat++) for (const scenario of ['incomplete', 'correction'] as const) {
      if (unknown) break;
      await runCase((repeat - 1) * 2 + (scenario === 'incomplete' ? 1 : 2), scenario);
    }
    report.passed = !unknown && (report.cases as Row[]).length === 10
      && (report.cases as Row[]).every(c => c.firstDraftPass === true)
      && (report.cases as Row[]).filter(c => c.kind === 'fifteen' && c.scenario === 'incomplete').every(c => c.approvalPass === true)
      && (report.cases as Row[]).filter(c => c.kind === 'fifteen' && c.scenario === 'correction').every(c => c.rejectionPass === true);
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    report.error = error instanceof Error ? error.stack : String(error); report.passed = false; process.exitCode = 1;
  } finally {
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
