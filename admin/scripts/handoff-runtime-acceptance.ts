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
import { HandoffWorkflow } from '@/lib/assistant/handoff/workflow';
import { reviewCheckpointer } from '@/lib/assistant/core/review-graph';
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
const callCap = 60000, plannedCalls = live ? 2 : 0;
if (live) budget.assertReservation(0, plannedCalls * callCap);
const providerBase = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const env = Object.fromEntries(fs.readFileSync(path.join(root, 'tmp/xiaok-intelligent-consult/.env.qwen37'), 'utf8')
  .replace(/^\uFEFF/, '').split(/\r?\n/).filter(s => s.trim() && !s.trim().startsWith('#'))
  .map(s => { const i = s.indexOf('='); return [s.slice(0, i).trim(), s.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2')]; }));
assert.equal(new URL(env.DASHSCOPE_BASE_URL).origin, new URL(providerBase).origin);
assert.equal(env.DASHSCOPE_MODEL, 'qwen3.7-flash');
const output = path.join(root, 'tmp', live ? 'agent-contract' : 'agent-runtime',
  `${live ? 'trial-' : 'services-'}handoff-runtime-os12-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const sourceFiles = ['admin/src/lib/assistant/agent/worker.ts', 'admin/src/lib/assistant/agent/review-tools.ts',
  'admin/src/lib/assistant/agent/review-runtime.ts', 'admin/src/lib/assistant/agent/runtime.ts',
  'admin/src/lib/assistant/core/conversation.ts', 'admin/src/lib/assistant/core/review-graph.ts',
  'admin/src/lib/assistant/requirements/workflow.ts', 'admin/src/lib/assistant/requirements/service.ts',
  'admin/src/lib/assistant/requirements/plan.ts', 'admin/src/lib/assistant/requirements/items.ts',
  'admin/src/lib/assistant/requirements/selection.ts', 'admin/src/lib/assistant/handoff/workflow.ts',
  'admin/src/lib/assistant/handoff/proposal.ts', 'admin/src/lib/assistant/handoff/service.ts',
  'admin/src/lib/ai/providers/agent-chat.ts', 'admin/scripts/handoff-runtime-acceptance.ts',
  'miniprogram/packages/assistant/chat/chat.wxml', 'miniprogram/packages/assistant/lib/requirements.js',
  'miniprogram/packages/assistant/requirements/requirements.js',
  'miniprogram/packages/assistant/requirements/requirements.wxml'];
const hash = (name: string) => createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex');
const binding = () => Object.fromEntries(sourceFiles.map(file => [file, hash(file)]));
const report: Row = { delivery: 'OS-CONTRACT-12', mode: live ? 'live' : 'deterministic',
  scope: 'Two natural designer requests in actual Worker, each followed by customer confirmation and existing C01 cancellation; no Worker cancellation call while AI is paused.',
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
      values('测试专用 · Worker需求审批',${code},'active') returning id`))!.id);
    const userId = String((await one(tx, sql`insert into app.users(nickname,context_version)
      values('测试专用 · Worker业主',1) returning id`))!.id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${userId},${code})`);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
      values(${enterpriseId},true,100,1000000,10000000,30,
        '{"runtime":"langgraph-v1","providerKey":"dashscope","model":"qwen3.7-flash","tools":true,"imageInput":false,"probeVersion":"os12-candidate-v1"}'::jsonb)`);
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

function deterministicModel() {
  let calls = 0;
  return async (_messages: ModelMessage[], _tools: ModelTool[], turn: number, active?: ModelTool[]): Promise<ModelTurnOutput> => {
    calls++; assert.equal(turn, 0); assert.equal(calls, 1);
    const name = 'propose_designer_reception';
    assert.ok(active?.some(tool => tool.name === name));
    assert.ok(!active?.some(tool => ['record_need', 'request_designer'].includes(tool.name)));
    return { text: '', toolCalls: [{ id: 'os12-request', name, arguments: '{}' }],
      finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 } };
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

async function runCase(index: number, text: string) {
  const f = await fixture(), chat = new ConversationService(f.actor), req = new RequirementWorkflow(f.actor);
  const handoff = new HandoffWorkflow(f.actor), baseline = (await req.read(f.conversationId)).latest!;
  const before = await handoff.customerRead(f.conversationId);
  assert.equal(before.handoff, null);
  const sent = await chat.send(f.conversationId, randomUUID(), { version: 1, blocks: [{ type: 'text', text }] });
  assert.ok(sent.runId);
  const lease = await claimJob(); assert.ok(lease && lease.runId === sent.runId);
  const row: Row = { index, action: 'request', text, enterpriseId: f.enterpriseId, conversationId: f.conversationId,
    runId: sent.runId, firstDraftPass: false, approvalPass: false };
  (report.cases as Row[]).push(row); save();
  const model = live ? configuredModel : deterministicModel();
  await processAgentAnswer(lease!, { model });
  const run = await chat.run(String(sent.runId)), current = await req.read(f.conversationId);
  const pending = await withTenantTransaction(f.enterpriseId, tx => one(tx, sql`select entry_snapshot->'handoffProposal' as proposal
    from app.assistant_conversations where enterprise_id=${f.enterpriseId} and id=${f.conversationId}`));
  const proposal = pending?.proposal as Row | undefined;
  row.runStatus = run.status; row.errorCode = run.errorCode; row.proposal = proposal;
  const steps = await withTenantTransaction(f.enterpriseId, tx => rows(tx, sql`select kind,capability_name,status,input_summary,private_checkpoint
    from app.assistant_run_steps where enterprise_id=${f.enterpriseId} and run_id=${String(sent.runId)} order by step_seq`));
  row.steps = steps.filter(step => ['agent_model', 'agent_tool'].includes(String(step.kind)));
  const expectedTool = 'propose_designer_reception';
  row.firstDraftPass = run.status === 'succeeded' && proposal?.status === 'pending' && proposal?.action === 'request'
    && steps.some(step => step.kind === 'agent_tool' && step.capability_name === expectedTool && step.status === 'succeeded')
    && (await handoff.customerRead(f.conversationId)).handoff === null
    && JSON.stringify((await req.read(f.conversationId)).latest) === JSON.stringify(baseline)
    && current.proposal === null;
  if (!row.firstDraftPass) { save(); return; }
  const key = randomUUID(), body = { action: 'request', expectedVersion: Number((await chat.detail(f.conversationId)).version),
    consent: true, mediaConsent: true, contactConsent: false, phone: '' };
  const saved = await handoff.customerWrite(f.conversationId, key, body);
  const reopened = await new HandoffWorkflow(f.actor).customerRead(f.conversationId);
  row.receipt = saved.receipt;
  row.approvalPass = saved.handoff?.state === 'waiting'
    && saved.handoff?.contactConsent === false && saved.handoff?.phone === ''
    && reopened.handoff?.requestId === saved.handoff?.requestId
    && reopened.handoff?.state === saved.handoff?.state
    && JSON.stringify((await req.read(f.conversationId)).latest) === JSON.stringify(baseline)
    && (await handoff.customerWrite(f.conversationId, key, body)).handoff?.state === saved.handoff?.state;
  assert.equal((await chat.detail(f.conversationId)).requirementProposalPending, false);
  await assert.rejects(() => handoff.customerWrite(f.conversationId, key, { ...body, expectedVersion: body.expectedVersion + 1 }), /idempotency_conflict/);
  const other: ActorContext = { ...f.actor, principal: { kind: 'user', userId: '1' } };
  await assert.rejects(() => new HandoffWorkflow(other).customerRead(f.conversationId));
  const cancelKey = randomUUID(), cancelBody = { action: 'cancel', expectedVersion: Number((await chat.detail(f.conversationId)).version) };
  const cancelled = await handoff.customerWrite(f.conversationId, cancelKey, cancelBody);
  const cancelReentry = await new HandoffWorkflow(f.actor).customerRead(f.conversationId);
  row.cancelPass = cancelled.handoff?.state === 'cancelled' && cancelReentry.handoff?.state === 'cancelled'
    && cancelReentry.mode === 'ai' && JSON.stringify((await req.read(f.conversationId)).latest) === JSON.stringify(baseline)
    && (await handoff.customerWrite(f.conversationId, cancelKey, cancelBody)).handoff?.state === 'cancelled';
  save();
}

async function main() {
  save();
  try {
    release = await lockAssistantAcceptance(db);
    const cases = [
      '我想找设计师接着聊，但现在别分享我的手机号，装修需求先保持原样。',
      '装修想法就按之前说的留着。我想请设计师继续沟通，电话暂时不用给。',
    ];
    for (const current of cases) {
      if (unknown) break;
      await runCase(cases.indexOf(current) + 1, current);
    }
    report.passed = !unknown && (report.cases as Row[]).length === 2
      && (report.cases as Row[]).every(c => c.firstDraftPass === true && c.approvalPass === true && c.cancelPass === true);
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    report.error = error instanceof Error ? error.stack : String(error); report.passed = false; process.exitCode = 1;
  } finally {
    try {
      for (const f of fixtures) {
        for (const id of f.checkpoints) await new RequirementWorkflow(f.actor).forget(f.conversationId, id);
        const records = await withTenantTransaction(f.enterpriseId, tx => rows(tx, sql`select result from app.assistant_idempotency_records
          where enterprise_id=${f.enterpriseId} and operation=${'handoff-review:' + f.conversationId}`));
        for (const record of records) {
          const proposalId = (record.result as Row)?.proposalId;
          if (proposalId) await reviewCheckpointer().deleteThread(`handoff:${f.enterpriseId}:${f.conversationId}:${proposalId}`);
        }
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
