/** Targeted native-executor recovery checks under enterprise 1454 (synthetic,
 * labelled rows only): interrupted runs resume through the real Worker claim
 * path with no repeated provider dispatch, no duplicated messages and a
 * consistent per-turn usage ledger; one enterprise's busy chat slot never
 * blocks another enterprise's knowledge task. Never retries a dispatched
 * provider call and never injects answers into a live journey. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { claimJob, enterpriseConcurrency, failRun, type Lease } from '@/lib/assistant/infrastructure/job-queue';
import { processNativeAgentAnswer, nativeExecutorPromptVersion, xiaokNativeExecutorProtocol } from '@/lib/assistant/agent/native-executor';
import { nativeAgentRuntimeBinding } from '@/lib/assistant/fastgpt/agent-v2/config';
import { knowledgePolicy } from '@/lib/assistant/knowledge-policy';
import { appendMessage } from '@/lib/assistant/core/conversation';
import { KnowledgeService } from '@/lib/assistant/knowledge/service';
import { claimKnowledgeJob, runKnowledgeJob } from '@/lib/assistant/knowledge/index-worker';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';

loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development'));
const root = path.resolve('..'), eid = '1454';
const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/xiaok-native-executor-20261111-recovery');
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Retain the original round');
const target = new URL(process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
fs.mkdirSync(output, { recursive: true });
const report: Row & { accounting: Row; scenarios: Row } = { startedAt: new Date().toISOString(), enterpriseId: eid,
  scope: 'native executor interrupted-run recovery plus cross-enterprise slot', checks: [], failures: [], accounting: {}, scenarios: {} };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const read = <T>(fn: Parameters<typeof withTenantTransaction<T>>[1]) => withTenantTransaction(eid, fn);
const tenantOne = (q: ReturnType<typeof sql>) => read(tx => one(tx, q));
const tenantRows = (q: ReturnType<typeof sql>) => read(tx => rows(tx, q));
const platformOne = (q: ReturnType<typeof sql>) => withPlatformTransaction(tx => one(tx, q));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function binding() {
  const files = execFileSync('rg', ['--files', 'admin/src', 'admin/scripts'], { cwd: root, encoding: 'utf8' })
    .trim().split(/\r?\n/).map(p => p.replaceAll('\\', '/')).filter(f => /assistant|job-queue|postgres-workflow-chat/.test(f));
  files.push('admin/scripts/xiaok-native-recovery-check.ts', 'admin/.env.local');
  if (process.env.XIAOK_FASTGPT_WORKFLOWS_FILE?.trim())
    files.push(path.relative(root, path.resolve(process.env.XIAOK_FASTGPT_WORKFLOWS_FILE)).replaceAll('\\', '/'));
  return Object.fromEntries([...new Set(files)].sort().map(f => [f, createHash('sha256').update(fs.readFileSync(path.isAbsolute(f) ? f : path.join(root, f))).digest('hex')]));
}
const before = binding();
report.bindingBefore = createHash('sha256').update(JSON.stringify(before)).digest('hex');

async function step(name: string, fn: () => Promise<unknown>) {
  try { const data = await fn(); (report.checks as Row[]).push({ name, passed: true, data }); console.log(name + ': PASS'); return data; }
  catch (e) { const message = (e as Error).message + ((e as Row).cause ? ' | cause: ' + String((e as Row).cause) : '');
    (report.checks as Row[]).push({ name, passed: false, error: message });
    (report.failures as Row[]).push({ name, error: (e as Error).stack || message }); throw e; }
  finally { save(); }
}
const attemptsMax = async () => String((await platformOne(sql`select coalesce(max(id),0) id from app.ai_provider_attempts`))!.id);

/** One interrupted native run. The model output, its attempt row and the
 * per-turn usage ledger are persisted exactly like the real executor writes
 * them; the job sits re-claimable with a lost lease and a provider marker. */
async function seedInterruptedRun(label: string, spec: {
  question: string;
  turns: Array<{ turn: number; output: ModelTurnOutput; usage?: { inputTokens: number; outputTokens: number } }>;
  searches?: Array<{ sequence: number; query: string; receipt: Row; evidence: Row[] }>;
  checkpoint?: Row;
}) {
  return read(async tx => {
    const template = await one(tx, sql`select policy_snapshot from app.assistant_runs where enterprise_id=${eid} and id=2967`);
    assert.ok(template, 'Native template run 2967 missing');
    const actor = (template.policy_snapshot as Row).actor as Row;
    const settings = (await one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${eid}`))!;
    const bound = nativeAgentRuntimeBinding(eid);
    assert.ok(bound, 'The langgraph-v1 switch must be active for recovery checks');
    const conv0 = await one(tx, sql`select c.entry_snapshot from app.assistant_conversations c join app.assistant_runs r
      on r.enterprise_id=c.enterprise_id and r.conversation_id=c.id where r.enterprise_id=${eid} and r.id=2967`);
    assert.ok(conv0, 'Template conversation missing');
    const conversation = (await one(tx, sql`insert into app.assistant_conversations(enterprise_id,purpose,status,mode,title,entry_snapshot,policy_version,context_revision,last_seq)
      values(${eid},'customer_consultation','open','ai',${'[synthetic-recovery] ' + label + ' ' + new Date().toISOString().slice(0, 10)},
      ${JSON.stringify(conv0.entry_snapshot)}::jsonb,${Number(settings.policy_version)},1,0) returning id`))!;
    const conversationId = String(conversation.id);
    // The template conversation's participant rows make the synthetic
    // conversation visible to the same customer principal under RLS.
    await tx.execute(sql`insert into app.assistant_participants(enterprise_id,conversation_id,principal_kind,user_id,admin_id,participant_role,grant_basis,status)
      select ${eid},${conversationId},principal_kind,user_id,admin_id,participant_role,grant_basis,status from app.assistant_participants
      where conversation_id=(select conversation_id from app.assistant_runs where enterprise_id=${eid} and id=2967)`);
    const message = await appendMessage(tx, actor as never, conversationId,
      { author: 'user', content: { version: 1, blocks: [{ type: 'text', text: spec.question }] }, clientMessageId: 'recovery-' + randomUUID() });
    const policySnapshot = { schemaVersion: 1, actor, maxTokens: 8192, policyVersion: Number(settings.policy_version),
      agent: settings.agent_config, knowledgePolicy: knowledgePolicy(settings.agent_config),
      agentRuntime: { protocol: xiaokNativeExecutorProtocol, binding: bound.binding } };
    const run = (await one(tx, sql`insert into app.assistant_runs(enterprise_id,conversation_id,trigger_kind,trigger_message_id,purpose,status,policy_snapshot,context_revision,knowledge_epoch)
      values(${eid},${conversationId},'user_message',${String(message.id)},'reply','queued',${JSON.stringify(policySnapshot)}::jsonb,1,${Number(settings.knowledge_epoch)}) returning id`))!;
    const runId = String(run.id);
    const provider = (await one(tx, sql`select provider_config_id,provider_key,adapter_type,remote_model from app.ai_provider_attempts
      where enterprise_id=${eid} order by id desc limit 1`))!;
    const attemptIds: string[] = [];
    for (const item of spec.turns) {
      const usage = item.output.usage ?? { inputTokens: 11, outputTokens: 7 };
      const attempt = (await one(tx, sql`insert into app.ai_provider_attempts(enterprise_id,assistant_run_id,provider_config_id,provider_key,adapter_type,capability,
        logical_model_key,remote_model,remote_task_id,status,accepted)
        values(${eid},${runId},${String(provider.provider_config_id)},${String(provider.provider_key)},${String(provider.adapter_type)},'chat','chat.general',
        ${String(provider.remote_model)},'xiaok-recovery-synthetic','succeeded',true) returning id`))!;
      attemptIds.push(String(attempt.id));
      await tx.execute(sql`insert into app.assistant_usage_records(enterprise_id,run_id,provider_attempt_id,operation_key,category,quantity,measurement_kind,input_tokens,output_tokens)
        values(${eid},${runId},${String(attempt.id)},${'agent:' + runId + ':' + item.turn},'tokens',${usage.inputTokens + usage.outputTokens},'observed',${usage.inputTokens},${usage.outputTokens})`);
      await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,provider_attempt_id,private_checkpoint,input_summary)
        values(${eid},${runId},${1100 + item.turn * 10},'agent_model','succeeded',${String(attempt.id)},${JSON.stringify(item.output)}::jsonb,
        ${JSON.stringify({ turn: item.turn, purpose: 'answer', promptVersion: nativeExecutorPromptVersion, protocol: xiaokNativeExecutorProtocol,
          tools: ['search_enterprise', 'query_business'], maxOutputTokens: 8192 })}::jsonb)`);
    }
    for (const item of spec.searches ?? []) {
      await tx.execute(sql`insert into app.assistant_usage_records(enterprise_id,run_id,operation_key,category,quantity,measurement_kind,input_tokens)
        values(${eid},${runId},${'agent-v2-query:' + runId + ':' + item.sequence},'query_embedding',12,'observed',12)`);
      await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,capability_name,capability_version,status,source_refs,private_checkpoint,input_summary)
        values(${eid},${runId},${1300 + item.sequence},'retrieval','knowledge.search.v1',1,'succeeded',
          ${JSON.stringify(item.evidence.map(e => ({ ref: (e as Row).ref, hash: (e as Row).hash })))}::jsonb,${JSON.stringify(item.evidence)}::jsonb,
          ${JSON.stringify({ protocol: xiaokNativeExecutorProtocol, tool: 'search_enterprise', query: item.query, candidates: 0,
            selected: item.evidence.length, receipt: item.receipt })}::jsonb)`);
    }
    if (spec.checkpoint) await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,input_summary,private_checkpoint)
      values(${eid},${runId},1000,'agent_checkpoint','succeeded',${JSON.stringify({ promptVersion: nativeExecutorPromptVersion,
        protocol: xiaokNativeExecutorProtocol })}::jsonb,${JSON.stringify(spec.checkpoint)}::jsonb)`);
    await tx.execute(sql`insert into app.assistant_jobs(enterprise_id,kind,run_id,dedupe_key,payload_version,status,attempts,available_at,lease_token,lease_expires_at,heartbeat_at,provider_started_at)
      values(${eid},'chat_turn',${runId},${'recovery:' + randomUUID()},1,'running',1,now(),${randomUUID()},now() - interval '60 seconds',now() - interval '60 seconds',now())`);
    return { conversationId, runId, attemptIds, binding: bound.binding };
  });
}

/** Claim through the real Worker path. Only labelled fixtures exist after the
 * idle-queue preflight; an unexpected claim is failed recorded, never replayed. */
async function claimUntil(runId: string): Promise<Lease> {
  for (let index = 0; index < 12; index++) {
    const lease = await claimJob();
    if (lease && String(lease.runId) === runId) return lease;
    if (lease) await failRun(lease, 'recovery_check_unexpected_job', true);
    await sleep(1200);
  }
  throw new Error('claim timeout for run ' + runId);
}

async function runState(runId: string, conversationId: string) {
  const [run, attempts, usage, steps, messages] = await Promise.all([
    tenantOne(sql`select id,status,error_code,output_message_id,answer_kind from app.assistant_runs where enterprise_id=${eid} and id=${runId}`),
    withPlatformTransaction(tx => rows(tx, sql`select id,status,remote_model,remote_task_id from app.ai_provider_attempts where assistant_run_id=${runId} order by id`)),
    tenantRows(sql`select operation_key,provider_attempt_id,category,quantity,measurement_kind from app.assistant_usage_records
      where enterprise_id=${eid} and run_id=${runId} order by operation_key`),
    tenantRows(sql`select step_seq,kind,capability_name,status,provider_attempt_id from app.assistant_run_steps
      where enterprise_id=${eid} and run_id=${runId} order by step_seq,kind`),
    tenantRows(sql`select id,seq,author_kind from app.assistant_messages where enterprise_id=${eid} and conversation_id=${conversationId} order by seq`)]);
  return { run: run!, attempts, usage, steps, messages };
}

const stepKinds = (state: ReturnType<typeof runState> extends Promise<infer T> ? T : never, kind: string) =>
  (state.steps as Row[]).filter(s => String(s.kind) === kind);

async function assertCompleted(label: string, seeded: Awaited<ReturnType<typeof seedInterruptedRun>>, expect: {
  minAttempts: number; usageKeys: string[]; textMatch: RegExp; modelStepCount: number; checkpoint: boolean }) {
  const state = await runState(seeded.runId, seeded.conversationId);
  const run = state.run as Row;
  assert.equal(String(run.status), 'succeeded', label + ' run must succeed: ' + String(run.error_code || ''));
  assert.equal((state.messages as Row[]).length, 2, label + ' must persist exactly one trigger and one assistant message');
  assert.equal(String((state.messages as Row[]).at(-1)!.id), String(run.output_message_id), label + ' output message linkage');
  const attempts = state.attempts as Row[];
  assert.ok(attempts.length >= expect.minAttempts, label + ' provider attempts');
  assert.ok(attempts.every(a => String(a.status) === 'succeeded'), label + ' attempts must all be known-succeeded');
  const synthetic = attempts.filter(a => String(a.remote_task_id) === 'xiaok-recovery-synthetic');
  assert.equal(synthetic.length, seeded.attemptIds.length, label + ' synthetic attempt rows preserved');
  const usage = state.usage as Row[];
  assert.deepEqual(usage.map(u => String(u.operation_key)).sort(), expect.usageKeys, label + ' per-turn usage keys');
  const models = stepKinds(state, 'agent_model');
  assert.equal(models.length, expect.modelStepCount, label + ' agent_model step count (no duplicate dispatch)');
  for (const [index, attemptId] of seeded.attemptIds.entries())
    assert.equal(String(models[index].provider_attempt_id), attemptId, label + ' model step ' + index + ' keeps the original attempt');
  assert.ok(stepKinds(state, 'agent_checkpoint').length === (expect.checkpoint ? 1 : 1), label + ' checkpoint step present');
  assert.ok(stepKinds(state, 'agent_synthesis_context').length === 1, label + ' synthesis step present');
  const answer = await tenantOne(sql`select content from app.assistant_messages where enterprise_id=${eid} and id=${String(run.output_message_id)}`);
  const text = ((answer!.content as Row).blocks as Row[]).map(b => String(b.text || '')).join('');
  assert.match(text, expect.textMatch, label + ' delivered text');
  return { state, text };
}

async function main() {
  const bound = nativeAgentRuntimeBinding(eid);
  assert.ok(bound, 'The langgraph-v1 executor switch must be active for 1454');
  report.nativeBinding = bound.binding;
  report.accounting.providerMaxBefore = await attemptsMax();

  await step('preflight: idle assistant queue and active native binding', async () => {
    const queue = await platformOne(sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`);
    assert.equal(queue!.n, 0, 'No recovery check may start on an active queue');
    return { queue: queue!.n, binding: bound!.binding };
  });

  await step('A: final-answer checkpoint persisted, interrupted before commit', async () => {
    const question = '客厅地砖还没铺，铺贴前师傅一般会先做什么？';
    const output: ModelTurnOutput = { text: '铺贴前一般会先检查基层平整度和空鼓情况，再弹线预排确认排版方向，之后才正式上砖。',
      toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 11, outputTokens: 7 } };
    const seeded = await seedInterruptedRun('A-final-checkpoint', { question,
      turns: [{ turn: 0, output }],
      checkpoint: { version: 1, turn: 0, messages: [], output } });
    const lease = await claimUntil(seeded.runId);
    await processNativeAgentAnswer(lease);
    const result = await assertCompleted('A', seeded, { minAttempts: 1, usageKeys: ['agent:' + seeded.runId + ':0'],
      textMatch: /弹线预排/, modelStepCount: 1, checkpoint: true });
    (report.scenarios as Row).A = { runId: seeded.runId, conversationId: seeded.conversationId, attemptIds: seeded.attemptIds,
      status: String((result.state.run as Row).status), messageCount: (result.state.messages as Row[]).length,
      usageKeys: (result.state.usage as Row[]).map(u => String(u.operation_key)) };
    return (report.scenarios as Row).A;
  });

  await step('B: model step succeeded, graph checkpoint missing, no re-dispatch', async () => {
    const question = '卫生间防水做完之后还需要做闭水试验吗？';
    const output: ModelTurnOutput = { text: '防水层完工后通常要做闭水试验，蓄水和观察时长以企业工艺标准与现场通知为准。',
      toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 13, outputTokens: 9 } };
    const seeded = await seedInterruptedRun('B-model-no-checkpoint', { question, turns: [{ turn: 0, output }] });
    const lease = await claimUntil(seeded.runId);
    await processNativeAgentAnswer(lease);
    const result = await assertCompleted('B', seeded, { minAttempts: 1, usageKeys: ['agent:' + seeded.runId + ':0'],
      textMatch: /闭水试验/, modelStepCount: 1, checkpoint: true });
    (report.scenarios as Row).B = { runId: seeded.runId, conversationId: seeded.conversationId, attemptIds: seeded.attemptIds,
      status: String((result.state.run as Row).status), messageCount: (result.state.messages as Row[]).length,
      usageKeys: (result.state.usage as Row[]).map(u => String(u.operation_key)) };
    return (report.scenarios as Row).B;
  });

  await step('C: tool receipt persisted, resume reuses it and continues with a real turn', async () => {
    const q1 = '装修时水电改造验收要注意哪些细节';
    const output: ModelTurnOutput = { text: '', toolCalls: [{ id: 'recovery-tool-1', name: 'search_enterprise', arguments: JSON.stringify({ query: q1 }) }],
      finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 9, outputTokens: 3 } };
    const seeded = await seedInterruptedRun('C-tool-then-continue', { question: q1 + '？',
      turns: [{ turn: 0, output }],
      searches: [{ sequence: 1, query: q1, receipt: { status: 'empty', kind: 'enterprise' }, evidence: [] }] });
    const lease = await claimUntil(seeded.runId);
    await processNativeAgentAnswer(lease);
    const state = await runState(seeded.runId, seeded.conversationId);
    const run = state.run as Row;
    assert.equal(String(run.status), 'succeeded', 'C run must succeed: ' + String(run.error_code || ''));
    const usage = state.usage as Row[];
    const turn1 = usage.find(u => String(u.operation_key) === 'agent:' + seeded.runId + ':1');
    assert.ok(turn1 && turn1.provider_attempt_id, 'C turn-1 real usage recorded');
    const models = stepKinds(state, 'agent_model');
    assert.equal(models.length, 2, 'C keeps the reused turn-0 step and the real turn-1 step');
    assert.equal(String(models[0].provider_attempt_id), seeded.attemptIds[0], 'C turn-0 keeps the original attempt');
    assert.equal(String(models[1].provider_attempt_id), String(turn1.provider_attempt_id), 'C usage links to the turn-1 attempt');
    const retrievals = stepKinds(state, 'retrieval');
    const q1Steps = retrievals.filter(s => String((s as Row).step_seq) === '1301');
    assert.equal(q1Steps.length, 1, 'C never duplicates the persisted search step');
    const fresh = retrievals.filter(s => Number(s.step_seq) > 1301);
    assert.ok(fresh.every(s => Number(s.step_seq) >= 1302), 'C fresh queries allocate sequences beyond the persisted maximum');
    assert.equal((state.messages as Row[]).length, 2, 'C persists exactly one assistant answer');
    const answer = await tenantOne(sql`select content from app.assistant_messages where enterprise_id=${eid} and id=${String(run.output_message_id)}`);
    const text = ((answer!.content as Row).blocks as Row[]).map(b => String(b.text || '')).join('');
    assert.ok(text.trim().length > 20, 'C delivered a real continuation answer');
    (report.scenarios as Row).C = { runId: seeded.runId, conversationId: seeded.conversationId, attemptIds: seeded.attemptIds,
      status: String(run.status), modelSteps: models.length, retrievalSteps: retrievals.map(s => Number(s.step_seq)),
      freshSearches: fresh.length, usageKeys: usage.map(u => String(u.operation_key)) };
    return (report.scenarios as Row).C;
  });

  await step('D: A-enterprise chat slot busy, B-enterprise knowledge task still runs', async () => {
    const slots = enterpriseConcurrency();
    const busyRunIds: string[] = []; let queuedRunId = '';
    await read(async tx => {
      const settings = (await one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${eid}`))!;
      const boundNow = nativeAgentRuntimeBinding(eid);
      assert.ok(boundNow, 'native binding required');
      const template = await one(tx, sql`select policy_snapshot from app.assistant_runs where enterprise_id=${eid} and id=2967`);
      const actor = ((template!.policy_snapshot as Row).actor) as Row;
      for (let index = 0; index < slots; index++) {
        const conversation = (await one(tx, sql`insert into app.assistant_conversations(enterprise_id,purpose,status,mode,title,entry_snapshot,policy_version,context_revision,last_seq)
          values(${eid},'customer_consultation','open','ai',${'[synthetic-recovery] D-busy-' + index + ' ' + new Date().toISOString().slice(0, 10)},
          ${JSON.stringify((await one(tx, sql`select c.entry_snapshot from app.assistant_conversations c join app.assistant_runs r
            on r.enterprise_id=c.enterprise_id and r.conversation_id=c.id where r.enterprise_id=${eid} and r.id=2967`))!.entry_snapshot)}::jsonb,
          ${Number(settings.policy_version)},1,0) returning id`))!;
        const policySnapshot = { schemaVersion: 1, actor, maxTokens: 8192, policyVersion: Number(settings.policy_version),
          agent: settings.agent_config, knowledgePolicy: knowledgePolicy(settings.agent_config),
          agentRuntime: { protocol: xiaokNativeExecutorProtocol, binding: boundNow.binding } };
        const busyMessage = await appendMessage(tx, actor as never, String(conversation.id),
          { author: 'user', content: { version: 1, blocks: [{ type: 'text', text: '占槽检查' }] }, clientMessageId: 'recovery-busy-' + randomUUID() });
        const run = (await one(tx, sql`insert into app.assistant_runs(enterprise_id,conversation_id,trigger_kind,trigger_message_id,purpose,status,policy_snapshot,context_revision,knowledge_epoch)
          values(${eid},${String(conversation.id)},'user_message',${String(busyMessage.id)},'reply','running',${JSON.stringify(policySnapshot)}::jsonb,1,${Number(settings.knowledge_epoch)}) returning id`))!;
        await tx.execute(sql`insert into app.assistant_jobs(enterprise_id,kind,run_id,dedupe_key,payload_version,status,attempts,available_at,lease_token,lease_expires_at,heartbeat_at,provider_started_at)
          values(${eid},'chat_turn',${String(run.id)},${'recovery-busy:' + randomUUID()},1,'running',1,now(),${randomUUID()},now() + interval '120 seconds',now(),now())`);
        busyRunIds.push(String(run.id));
      }
      // A's own next chat job must wait for the busy slot.
      const queued = (await one(tx, sql`insert into app.assistant_conversations(enterprise_id,purpose,status,mode,title,entry_snapshot,policy_version,context_revision,last_seq)
        values(${eid},'customer_consultation','open','ai',${'[synthetic-recovery] D-queued ' + new Date().toISOString().slice(0, 10)},
        ${JSON.stringify((await one(tx, sql`select c.entry_snapshot from app.assistant_conversations c join app.assistant_runs r
          on r.enterprise_id=c.enterprise_id and r.conversation_id=c.id where r.enterprise_id=${eid} and r.id=2967`))!.entry_snapshot)}::jsonb,
        ${Number(settings.policy_version)},1,0) returning id`))!;
      const queuedMessage = await appendMessage(tx, actor as never, String(queued.id),
        { author: 'user', content: { version: 1, blocks: [{ type: 'text', text: '排队检查' }] }, clientMessageId: 'recovery-queued-' + randomUUID() });
      const queuedRun = (await one(tx, sql`insert into app.assistant_runs(enterprise_id,conversation_id,trigger_kind,trigger_message_id,purpose,status,policy_snapshot,context_revision,knowledge_epoch)
        values(${eid},${String(queued.id)},'user_message',${String(queuedMessage.id)},'reply','queued',${JSON.stringify({ schemaVersion: 1, actor, maxTokens: 8192,
          policyVersion: Number(settings.policy_version), agent: settings.agent_config, knowledgePolicy: knowledgePolicy(settings.agent_config),
          agentRuntime: { protocol: xiaokNativeExecutorProtocol, binding: boundNow.binding } })}::jsonb,1,${Number(settings.knowledge_epoch)}) returning id`))!;
      await tx.execute(sql`insert into app.assistant_jobs(enterprise_id,kind,run_id,dedupe_key,payload_version,status,attempts,available_at)
        values(${eid},'chat_turn',${String(queuedRun.id)},${'recovery-queued:' + randomUUID()},1,'queued',0,now())`);
      queuedRunId = String(queuedRun.id);
    });
    // While A occupies every slot, claiming must not return A's queued job.
    let stolen: Lease | null = null;
    for (let index = 0; index < 4; index++) { stolen = await claimJob(); if (stolen) break; await sleep(800); }
    assert.equal(stolen, null, 'A busy enterprise must block its own next chat job');
    // B: labelled synthetic control enterprise with a real knowledge task.
    const control = await withPlatformTransaction(async tx => {
      const existing = await one(tx, sql`select e.id from app.enterprises e where e.name like '[synthetic-recovery-control]%' and e.status='active' order by id desc limit 1`);
      if (existing) return String(existing.id);
      const code = 'recovery-b-' + randomUUID().slice(0, 8);
      const enterprise = (await one(tx, sql`insert into app.enterprises(name,code,status) values('[synthetic-recovery-control] ' || ${code},${code},'active') returning id`))!;
      await tx.execute(sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,menu_permissions)
        values(${String(enterprise.id)},${code},'synthetic-disabled-password','enterprise_admin','active',false,ARRAY['assistant-knowledge'])`);
      return String(enterprise.id);
    });
    const adminId = await withTenantTransaction(control, async tx => String((await one(tx, sql`select id from app.admin_users where enterprise_id=${control}
      and status='active' and app.assistant_knowledge_admin_is_current(id,${control}::bigint) order by id limit 1`))!.id));
    const knowledge = new KnowledgeService({ enterpriseId: control, adminId });
    const created = await knowledge.execute('create', { title: '[synthetic-recovery] 闭水试验蓄水要求', sourceType: 'manual_text',
      audience: 'customer_public', body: '闭水试验蓄水时间以企业工艺标准为准，蓄水后观察楼下顶板无渗漏为合格前提之一。' }, randomUUID());
    const fixture = { documentId: String((created.document as Row).id), versionId: String((created.draft as Row).id), expectedVersion: 1, expectedEditVersion: 1 };
    await withTenantTransaction(control, tx => tx.execute(sql`update app.assistant_enterprise_settings set enabled=true,version=version+1 where enterprise_id=${control}`));
    const queued = await knowledge.execute('index', fixture, randomUUID());
    const claimed = await claimKnowledgeJob();
    assert.ok(claimed && String(claimed.jobId) === String(queued.jobId), 'B knowledge job must be claimable while A chat occupies its slot');
    await runKnowledgeJob(claimed);
    const jobState = await knowledge.execute('job', { jobId: String(queued.jobId) } as never) as Row;
    assert.equal(String(jobState.status), 'succeeded', 'B knowledge indexing must succeed while A is busy');
    const busyStates = await tenantRows(sql`select j.status,j.lease_token is not null leased from app.assistant_jobs j
      where j.enterprise_id=${eid} and j.run_id in (${sql.join(busyRunIds.map(id => sql`${id}`), sql`, `)}) order by j.id`);
    assert.ok((busyStates as Row[]).every(j => String(j.status) === 'running' && j.leased), 'A busy chat jobs stay running and untouched');
    const queuedState = await tenantOne(sql`select status from app.assistant_jobs j where j.enterprise_id=${eid} and j.run_id=${queuedRunId}`);
    assert.equal(String(queuedState!.status), 'queued', 'A queued chat job keeps waiting for its own enterprise slot');
    // Hygiene: release the labelled occupancy fixtures so they never run.
    await read(tx => tx.execute(sql`update app.assistant_jobs set status='failed',last_error='recovery_check_synthetic_cleanup',lease_token=null,lease_expires_at=null,version=version+1
      where enterprise_id=${eid} and run_id in (${sql.join([...busyRunIds, queuedRunId].map(id => sql`${id}`), sql`, `)})`));
    await read(tx => tx.execute(sql`update app.assistant_runs set status='failed',error_code='recovery_check_synthetic_cleanup',completed_at=now(),version=version+1
      where enterprise_id=${eid} and id in (${sql.join([...busyRunIds, queuedRunId].map(id => sql`${id}`), sql`, `)})`));
    (report.scenarios as Row).D = { slots, controlEnterprise: control, knowledgeJobId: String(queued.jobId),
      knowledgeJob: String(jobState.status), busyRuns: busyRunIds, queuedRunId };
    return (report.scenarios as Row).D;
  });

  report.accounting.providerMaxAfter = await attemptsMax();
}

main().catch(error => { report.error = (error as Error).message; })
  .finally(async () => {
    try {
      // Release labelled occupancy fixtures even when a scenario fails, so the
      // resident Worker never inherits a synthetic job.
      await withTenantTransaction(eid, async tx => {
        await tx.execute(sql`update app.assistant_jobs set status='failed',last_error='recovery_check_synthetic_cleanup',lease_token=null,lease_expires_at=null,version=version+1
          where enterprise_id=${eid} and (dedupe_key like 'recovery-busy:%' or dedupe_key like 'recovery-queued:%') and status in ('queued','running')`);
        await tx.execute(sql`update app.assistant_runs set status='failed',error_code='recovery_check_synthetic_cleanup',completed_at=now(),version=version+1
          where enterprise_id=${eid} and status='running' and id in (select run_id from app.assistant_jobs
            where enterprise_id=${eid} and last_error='recovery_check_synthetic_cleanup' and run_id is not null)`);
      });
      const after = binding(), changed = Object.keys({ ...before, ...after }).filter(f => before[f] !== after[f]);
      report.drift = changed; report.bindingAfter = createHash('sha256').update(JSON.stringify(after)).digest('hex');
      if (changed.length) (report.failures as Row[]).push({ name: 'source drift', files: changed });
      report.finishedAt = new Date().toISOString();
    } catch (error) { report.finalizeError = (error as Error).message; }
    finally { save(); await closePostgresPool();
      console.log(JSON.stringify({ passed: (report.checks as Row[]).every(c => c.passed), checks: (report.checks as Row[]).length,
        error: report.error || null, drift: report.drift || [] })); }
  });
