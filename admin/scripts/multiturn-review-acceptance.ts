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
import { agentChatBody, parseAgentChat } from '@/lib/ai/providers/agent-chat';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { reviewBudget, reviewTokens } from './assistant-review-budget';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
import type { ActorContext } from '@/lib/assistant/contracts';
import type { ModelMessage, ModelTool, ModelTurnOutput } from '@/lib/assistant/contracts/model';

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
const callCap = 60000, plannedCalls = live ? 10 : 0;
if (live) budget.assertReservation(0, plannedCalls * callCap);
const providerBase = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const env = Object.fromEntries(fs.readFileSync(path.join(root, 'tmp/xiaok-intelligent-consult/.env.qwen37'), 'utf8')
  .replace(/^\uFEFF/, '').split(/\r?\n/).filter(s => s.trim() && !s.trim().startsWith('#'))
  .map(s => { const i = s.indexOf('='); return [s.slice(0, i).trim(), s.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2')]; }));
assert.equal(new URL(env.DASHSCOPE_BASE_URL).origin, new URL(providerBase).origin);
assert.equal(env.DASHSCOPE_MODEL, 'qwen3.7-flash');
const output = path.join(root, 'tmp', live ? 'agent-contract' : 'agent-runtime',
  `${live ? 'trial-' : 'services-'}review-multiturn-os11-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const sourceFiles = ['admin/src/lib/assistant/agent/worker.ts', 'admin/src/lib/assistant/agent/review-tools.ts',
  'admin/src/lib/assistant/agent/review-runtime.ts', 'admin/src/lib/assistant/agent/runtime.ts',
  'admin/src/lib/assistant/core/conversation.ts', 'admin/src/lib/assistant/core/review-graph.ts',
  'admin/src/lib/assistant/requirements/workflow.ts', 'admin/src/lib/assistant/requirements/service.ts',
  'admin/src/lib/assistant/requirements/plan.ts', 'admin/src/lib/assistant/requirements/items.ts',
  'admin/src/lib/assistant/requirements/selection.ts', 'admin/src/lib/assistant/handoff/workflow.ts',
  'admin/src/lib/assistant/handoff/proposal.ts',
  'admin/src/lib/ai/providers/agent-chat.ts', 'admin/scripts/multiturn-review-acceptance.ts',
  'miniprogram/packages/assistant/chat/chat.wxml', 'miniprogram/packages/assistant/lib/requirements.js',
  'miniprogram/packages/assistant/requirements/requirements.js',
  'miniprogram/packages/assistant/requirements/requirements.wxml'];
const hash = (name: string) => createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex');
const binding = () => Object.fromEntries(sourceFiles.map(file => [file, hash(file)]));
const report: Row = { delivery: 'OS-CONTRACT-11', mode: live ? 'live' : 'deterministic',
  scope: 'Fixed before dispatch: incomplete budget then clarification (2 turns) and unapproved 10-to-15 correction then rejection (3 turns), each repeated twice. One configured-model first draft per turn; customer approval remains separate.',
  model: live ? env.DASHSCOPE_MODEL : 'injected-deterministic', plannedCalls, callCap,
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
         '{"runtime":"langgraph-v1","providerKey":"dashscope","model":"qwen3.7-flash","tools":true,"imageInput":false,"probeVersion":"os11-candidate-v1"}'::jsonb)`);
    return { enterpriseId, userId };
  });
  const actor: ActorContext = { enterpriseId: ids.enterpriseId, principal: { kind: 'user', userId: ids.userId },
    contextVersion: 1, capabilities: ['assistant.chat.self'], entry: { kind: 'direct' } };
  const conversationId = String((await new ConversationService(actor).create(randomUUID())).id);
  const f = { actor, conversationId, ...ids, checkpoints: [] as string[] };
  fixtures.push(f); (report.fixtures as Row[]).push({ ...ids, conversationId, synthetic: true }); save();
  await withTenantTransaction(ids.enterpriseId, tx => tx.execute(sql`update app.assistant_conversations
    set entry_snapshot=entry_snapshot||'{"requirementReviewMode":true,"requirementWorkflow":"langgraph"}'::jsonb
    where enterprise_id=${ids.enterpriseId} and id=${conversationId}`));
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
  await withTenantTransaction(ids.enterpriseId, tx => tx.execute(sql`update app.assistant_conversations
    set entry_snapshot=jsonb_set(entry_snapshot,'{agentReviewCandidate}','true'::jsonb)
    where enterprise_id=${ids.enterpriseId} and id=${conversationId}`));
  return f;
}

type TurnKind = 'incomplete' | 'clarify' | 'ten' | 'fifteen' | 'reject';
function deterministicModel(f: Fixture, kind: TurnKind) {
  let calls = 0;
  return async (_messages: ModelMessage[], _tools: ModelTool[], turn: number, active?: ModelTool[]): Promise<ModelTurnOutput> => {
    calls++; assert.equal(turn, 0); assert.equal(calls, 1);
    assert.equal(active?.some(tool => tool.name === 'propose_requirement_changes'),
      kind !== 'incomplete' && kind !== 'reject');
    assert.ok(active?.some(tool => tool.name === 'final_response'));
    assert.ok(!active?.some(tool => ['record_need', 'request_designer'].includes(tool.name)));
    if (kind === 'incomplete' || kind === 'reject') return {
      text: '', toolCalls: [{ id: `os11-${kind}`, name: 'final_response', arguments: JSON.stringify({
        kind: 'general', text: kind === 'incomplete' ? '您还没确定具体预算，确定金额后告诉我，我再整理更改供您选择。'
          : '明白，预算先维持原来的12万，其他需求也不变。',
      }) }], finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 },
    };
    const current = await businessReviewTools(f.actor, f.conversationId);
    const item = current.context.savedItems.find(i => i.field === 'budget')!;
    const amount = kind === 'fifteen' ? '15万' : '10万';
    const clause = [...current.context.customerClauses].reverse().find(s => s.text.includes(amount))!;
    assert.ok(item && clause);
    return { text: '', toolCalls: [{ id: `os11-${kind}`, name: 'propose_requirement_changes', arguments: JSON.stringify({
      retainedIds: current.context.savedItems.filter(i => i.id !== item.id).map(i => i.id),
      changes: [{ operation: 'replace', targetId: item.id, sourceId: clause.id }],
    }) }], finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 } };
  };
}

async function configuredModel(messages: ModelMessage[], _tools: ModelTool[], turn: number, active?: ModelTool[]): Promise<ModelTurnOutput> {
  if (turn !== 0) throw Error('fixed_one_model_call_per_case');
  assert.ok(!unknown && (report.calls as Row[]).length < plannedCalls);
  const body = agentChatBody({ model: env.DASHSCOPE_MODEL, messages, tools: active || [], maxTokens: 2048,
    enableThinking: false, requireTool: true }, providerBase);
  const reserve = Buffer.byteLength(JSON.stringify(body), 'utf8') + 2048 + 128;
  assert.ok(reserve <= callCap, 'Fixed per-call reservation exceeded');
  budget.assertReservation(reviewTokens(report.calls as Array<{status: string; reservedTokens?: number; usage?: {total_tokens: number}}>), reserve);
  const attempt: Row = { id: randomUUID(), status: 'dispatching', reservedTokens: reserve, request: body,
    startedAt: new Date().toISOString() };
  (report.calls as Row[]).push(attempt); save();
  try {
    const response = await fetch(providerBase + '/chat/completions', { method: 'POST',
      headers: { Authorization: `Bearer ${env.DASHSCOPE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(90000), redirect: 'error' });
    const payload = await response.json() as Record<string, unknown>;
    attempt.response = payload; attempt.httpStatus = response.status;
    if (!response.ok) throw Error('provider_outcome_unknown');
    const output = parseAgentChat(payload);
    if (!output.usage) throw Error('provider_usage_unknown');
    attempt.status = 'succeeded'; attempt.usage = { total_tokens: output.usage.inputTokens + output.usage.outputTokens };
    return output;
  } catch (error) {
    attempt.status = 'unknown'; attempt.error = error instanceof Error ? error.message : String(error); unknown = true;
    throw error;
  } finally { attempt.finishedAt = new Date().toISOString(); save(); }
}

const conversation = {
  incomplete: ['我想把预算再往下调一点，具体数额我还没想好，瓷砖和地暖先照旧。', '想好了，预算定10万，其他刚说的都不动。'],
  correction: ['预算改10万吧，其他先不动。', '等一下，别用10万，最后按15万，瓷砖和地暖还是原样。', '算了，预算先保持原来12万，瓷砖和地暖也不变。'],
} as const;
async function runTurn(f: Fixture, index: number, kind: TurnKind, text: string) {
  const chat = new ConversationService(f.actor), req = new RequirementWorkflow(f.actor);
  const sent = await chat.send(f.conversationId, randomUUID(), { version: 1, blocks: [{ type: 'text', text }] });
  assert.ok(sent.runId);
  const before = await req.read(f.conversationId);
  const lease = await claimJob(); assert.ok(lease && lease.runId === sent.runId);
  const row: Row = { index, kind, text, enterpriseId: f.enterpriseId, conversationId: f.conversationId,
    runId: sent.runId, proposalExpiredBeforeRun: before.proposal === null, firstDraftPass: false };
  (report.cases as Row[]).push(row); save();
  await processAgentAnswer(lease!, { model: live ? configuredModel : deterministicModel(f, kind) });
  const run = await chat.run(String(sent.runId)), current = await req.read(f.conversationId);
  const detail = await chat.detail(f.conversationId);
  row.runStatus = run.status; row.errorCode = run.errorCode; row.proposal = current.proposal;
  row.chatPending = detail.requirementProposalPending;
  const reply = await withTenantTransaction(f.enterpriseId, tx => one(tx, sql`select content from app.assistant_messages
    where enterprise_id=${f.enterpriseId} and conversation_id=${f.conversationId} and author_kind='assistant' order by seq desc limit 1`));
  row.reply = ((reply?.content as {blocks?: {text?: string}[]})?.blocks || []).map(block => block.text || '').join('\n');
  const steps = await withTenantTransaction(f.enterpriseId, tx => rows(tx, sql`select kind,capability_name,status,input_summary,private_checkpoint
    from app.assistant_run_steps where enterprise_id=${f.enterpriseId} and run_id=${String(sent.runId)} order by step_seq`));
  row.steps = steps.filter(step => ['agent_model', 'agent_tool'].includes(String(step.kind)));
  const modelStep = steps.find(step => step.kind === 'agent_model')?.private_checkpoint as ModelTurnOutput | undefined;
  const rawReply = (() => { try { return JSON.parse(modelStep?.text || '{}').text as string || ''; } catch { return ''; } })();
  row.modelFirstDraft = { toolNames: modelStep?.toolCalls?.map(call => call.name) || [], text: rawReply };
  const replyOnly = kind === 'incomplete' || kind === 'reject';
  const replyOnlyFirstDraft = !modelStep?.toolCalls?.length && /预算|金额|保留|维持|不变/.test(rawReply)
    && !/已.{0,8}(?:记录|保存|确认|更改|调整)|推进/.test(rawReply);
  const summaries = await withTenantTransaction(f.enterpriseId, tx => one(tx, sql`select count(*)::int n from app.assistant_requirement_summaries
    where enterprise_id=${f.enterpriseId} and conversation_id=${f.conversationId}`));
  row.summaryCount = Number(summaries!.n);
  const changed = ((current.proposal?.diff || []) as Array<{field: string}>).map(d => d.field);
  row.proposedFields = changed;
  const amount = kind === 'fifteen' ? '15万' : '10万';
  row.firstDraftPass = run.status === 'succeeded' && row.summaryCount === 1 &&
    (replyOnly
      ? replyOnlyFirstDraft && !current.proposal && !detail.requirementProposalPending && /预算|金额|保留|不变/.test(String(row.reply))
      : !!current.proposal && detail.requirementProposalPending && changed.length === 1 && changed[0] === 'budget'
        && String((current.proposal.summary.draftFields as DraftRequirements).budget.text).includes(amount));
  if (current.proposal) f.checkpoints.push(String(current.proposal.id));
  save(); return row;
}
async function runCase(index: number, scenario: 'incomplete' | 'correction') {
  const f = await fixture(), req = new RequirementWorkflow(f.actor);
  const baseline = (await req.read(f.conversationId)).latest!;
  if (scenario === 'incomplete') {
    const first = await runTurn(f, index, 'incomplete', conversation.incomplete[0]);
    const second = await runTurn(f, index, 'clarify', conversation.incomplete[1]);
    const secondProposal = second.proposal as { id: string; digest: string } | undefined;
    if (!second.firstDraftPass || !secondProposal) return;
    const key = randomUUID(), body = { action: 'apply_proposal', proposalId: secondProposal.id,
      digest: secondProposal.digest, consent: true, restoreConsent: false, selectedFields: ['budget'] };
    const saved = await req.write(f.conversationId, key, body);
    const reopened = await new RequirementWorkflow(f.actor).read(f.conversationId);
    const savedFields = saved.draftFields as DraftRequirements, baselineFields = baseline.draftFields as DraftRequirements;
    second.receipt = saved.receipt;
    second.approvalPass = first.firstDraftPass && saved.status === 'draft' && saved.confirmedFields === null
      && saved.receipt?.effect === 'draft_saved' && String(savedFields.budget.text).includes('10万')
      && JSON.stringify(savedFields.room) === JSON.stringify(baselineFields.room)
      && JSON.stringify(savedFields.devices) === JSON.stringify(baselineFields.devices)
      && reopened.latest?.id === saved.id && !reopened.proposal
      && (await req.write(f.conversationId, key, body)).id === saved.id;
    const other: ActorContext = { ...f.actor, principal: { kind: 'user', userId: '1' } };
    await assert.rejects(() => new RequirementWorkflow(other).read(f.conversationId));
    save(); return;
  }
  const first = await runTurn(f, index, 'ten', conversation.correction[0]);
  const second = await runTurn(f, index, 'fifteen', conversation.correction[1]);
  const firstProposal = first.proposal as { id: string; digest: string } | undefined;
  if (firstProposal && second.proposal) await assert.rejects(() => req.write(f.conversationId, randomUUID(), {
    action: 'apply_proposal', proposalId: firstProposal.id, digest: firstProposal.digest,
    consent: true, restoreConsent: false, selectedFields: ['budget'],
  }), /requirement_target_changed|requirements_stale/);
  const third = await runTurn(f, index, 'reject', conversation.correction[2]);
  third.rejectionPass = first.firstDraftPass && second.firstDraftPass && third.firstDraftPass
    && second.proposalExpiredBeforeRun === true && third.proposalExpiredBeforeRun === true
    && (await new RequirementWorkflow(f.actor).read(f.conversationId)).latest?.id === baseline.id;
  save();
}

async function main() {
  save();
  try {
    release = await lockAssistantAcceptance(db);
    for (let repeat = 1; repeat <= 2; repeat++) for (const scenario of ['incomplete', 'correction'] as const) {
      if (unknown) break;
      await runCase((repeat - 1) * 2 + (scenario === 'incomplete' ? 1 : 2), scenario);
    }
    report.passed = !unknown && (report.cases as Row[]).length === 10
      && (report.cases as Row[]).every(c => c.firstDraftPass === true)
      && (report.cases as Row[]).filter(c => c.kind === 'clarify').every(c => c.approvalPass === true)
      && (report.cases as Row[]).filter(c => c.kind === 'reject').every(c => c.rejectionPass === true);
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
