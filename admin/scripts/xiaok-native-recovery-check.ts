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
import { claimJob, enterpriseConcurrency, processAssistantJob, runContext, type Lease } from '@/lib/assistant/infrastructure/job-queue';
import { nativeExecutorPromptVersion, recoveredDialogueToolState,
  xiaokNativeExecutorProtocol } from '@/lib/assistant/agent/native-executor';
import { dialogueWebResearch, type WebToolRuntime } from '@/lib/assistant/agent/dialogue-web-tools';
import { dialogueHistoryRecall, type HistoryToolRuntime } from '@/lib/assistant/agent/dialogue-history-tools';
import { historyRefsAvailable, type HistoryRef } from '@/lib/assistant/agent/history';
import { synthesisContextAvailable } from '@/lib/assistant/agent/synthesis-sources';
import type { SynthesisContext } from '@/lib/assistant/agent/synthesis';
import { nativeAgentRuntimeBinding } from '@/lib/assistant/fastgpt/agent-v2/config';
import { knowledgePolicy } from '@/lib/assistant/knowledge-policy';
import { appendMessage } from '@/lib/assistant/core/conversation';
import { KnowledgeService } from '@/lib/assistant/knowledge/service';
import { claimKnowledgeJob, runKnowledgeJob } from '@/lib/assistant/knowledge/index-worker';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';

loadEnvConfig(process.cwd(), true);
// dev.mjs injects the same default for Next and the resident Worker; this
// standalone harness mirrors it so the shared web dispatch is testable.
// Explicit configuration always wins.
process.env.ASSISTANT_PUBLIC_READER_URL ||= 'http://127.0.0.1:18095';
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
  searches?: Array<{ sequence: number; query: string; receipt: Row; evidence: Row[];
    /** Dispatch marker only: the usage row exists but no receipt step was saved. */
    dispatchedOnly?: boolean; usageObserved?: boolean }>;
  /** Web dispatch fixtures written exactly like the shared web factory:
   * a usage dispatch marker plus (unless dispatchedOnly) a succeeded step. */
  webs?: Array<{ stepSeq: number; reading?: boolean; dispatchedOnly?: boolean }>;
  /** Customer originals recorded BEFORE the trigger message so a real
   * recall_history can read them through the run's real trigger seq. */
  olderMessages?: string[];
  checkpoint?: Row;
  /** Factory-driven scenarios (W2 factory guard, W3 dispatcher) pre-own a
   * long-lived lease so the resident Worker can never claim or process the
   * fixture; only executor-recovery scenarios seed the lost-lease claimable
   * state and resume through the real claim path. */
  providerStarted?: boolean;
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
    for (const text of spec.olderMessages ?? [])
      await appendMessage(tx, actor as never, conversationId,
        { author: 'user', content: { version: 1, blocks: [{ type: 'text', text }] }, clientMessageId: 'recovery-old-' + randomUUID() });
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
        values(${eid},${runId},${'agent-v2-query:' + runId + ':' + item.sequence},'query_embedding',
        ${item.usageObserved === false ? sql`null,'unavailable',null` : sql`12,'observed',12`})`);
      if (item.dispatchedOnly) continue;
      await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,capability_name,capability_version,status,source_refs,private_checkpoint,input_summary)
        values(${eid},${runId},${1300 + item.sequence},'retrieval','knowledge.search.v1',1,'succeeded',
          ${JSON.stringify(item.evidence.map(e => ({ ref: (e as Row).ref, hash: (e as Row).hash })))}::jsonb,${JSON.stringify(item.evidence)}::jsonb,
          ${JSON.stringify({ protocol: xiaokNativeExecutorProtocol, tool: 'search_enterprise', query: item.query, candidates: 0,
            selected: item.evidence.length, receipt: item.receipt })}::jsonb)`);
    }
    for (const item of spec.webs ?? []) {
      // Marker only, exactly like a lost process leaves behind: the usage row
      // exists with measurement_kind='unavailable' and no receipt step.
      await tx.execute(sql`insert into app.assistant_usage_records(enterprise_id,run_id,operation_key,category,quantity,measurement_kind)
        values(${eid},${runId},${'agent-web:' + runId + ':' + item.stepSeq},${item.reading ? 'web_read' : 'web_search'},null,'unavailable')`);
    }

    if (spec.checkpoint) await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,input_summary,private_checkpoint)
      values(${eid},${runId},1000,'agent_checkpoint','succeeded',${JSON.stringify({ promptVersion: nativeExecutorPromptVersion,
        protocol: xiaokNativeExecutorProtocol })}::jsonb,${JSON.stringify(spec.checkpoint)}::jsonb)`);
    let direct: Lease | undefined;
    if (spec.providerStarted === false) {
      // Race-free scaffolding: the lease belongs to this harness from birth
      // (300s future expiry), so no outside claimer can take the fixture and
      // the factory calls run against a lease the DB itself witnesses.
      const token = randomUUID();
      const job = (await one(tx, sql`insert into app.assistant_jobs(enterprise_id,kind,run_id,dedupe_key,payload_version,status,attempts,available_at,lease_token,lease_expires_at,heartbeat_at)
        values(${eid},'chat_turn',${runId},${'recovery:' + randomUUID()},1,'running',1,now(),${token},now() + interval '300 seconds',now()) returning id`))!;
      // The claim path flips the run to running with the lease; the pre-owned
      // lease mirrors that state so live() witnesses the same pair.
      await tx.execute(sql`update app.assistant_runs set status='running',started_at=coalesce(started_at,now()),version=version+1
        where enterprise_id=${eid} and id=${runId}`);
      direct = { enterpriseId: eid, jobId: String(job.id), runId, token, actor: actor as never };
    } else {
      // Lost-process state without racing the resident Worker: the job stays
      // invisible to every global scan (availability 55s out) until claimUntil
      // flips it and claims within the same few milliseconds. The claim path
      // itself — scoped claimJob with the settings lock — stays the real one.
      // provider_started_at is part of the lost-process truth: the dead
      // process had already dispatched the model, so failRun must classify
      // unknown outcomes as indeterminate exactly as it would after a real
      // crash. The queued status keeps the fixture unclaimable by scans.
      await tx.execute(sql`insert into app.assistant_jobs(enterprise_id,kind,run_id,dedupe_key,payload_version,status,attempts,available_at,provider_started_at)
        values(${eid},'chat_turn',${runId},${'recovery:' + randomUUID()},1,'queued',0,now(),now())`);
    }
    return { conversationId, runId, attemptIds, binding: bound.binding, triggerSeq: String(message.seq),
      ...(direct ? { directLease: direct } : {}) };
  });
}

/** Executor-recovery fixtures are processed by the resident Worker itself
 * (dev.mjs assistant-worker → the internal jobs endpoint → processAssistantJob
 * → the real claim path). The scenario seeds a claimable job and waits for the
 * run to reach its terminal state, then asserts outcomes from durable rows —
 * no script-side claim races the poller and the recovery code under test is
 * exactly the production claim path. */
async function waitForRunTerminal(runId: string, label: string) {
  for (let index = 0; index < 60; index++) {
    const run = await tenantOne(sql`select id,status,error_code from app.assistant_runs where enterprise_id=${eid} and id=${runId}`);
    if (run && !['queued', 'running'].includes(String(run.status))) return run!;
    await sleep(2000);
  }
  throw new Error(label + ' run never reached a terminal state: ' + runId);
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

async function assertIndeterminate(label: string, seeded: Awaited<ReturnType<typeof seedInterruptedRun>>, expect: {
  usageKeys: string[]; retrievalSteps: number }) {
  const state = await runState(seeded.runId, seeded.conversationId);
  const run = state.run as Row;
  assert.equal(String(run.status), 'indeterminate', label + ' must stay indeterminate, saw ' + String(run.status) + '/' + String(run.error_code || ''));
  assert.equal(String(run.error_code), 'provider_outcome_unknown', label + ' error code');
  const attempts = state.attempts as Row[];
  assert.equal(attempts.length, seeded.attemptIds.length, label + ' must not add any provider attempt');
  assert.deepEqual((state.usage as Row[]).map(u => String(u.operation_key)).sort(), expect.usageKeys, label + ' usage rows unchanged');
  assert.equal(stepKinds(state, 'retrieval').length, expect.retrievalSteps, label + ' no receipt step may appear');
  return state;
}

const stepKinds = (state: ReturnType<typeof runState> extends Promise<infer T> ? T : never, kind: string) =>
  (state.steps as Row[]).filter(s => String(s.kind) === kind);

async function assertCompleted(label: string, seeded: Awaited<ReturnType<typeof seedInterruptedRun>>, expect: {
  attempts: number; usageKeys: string[]; textMatch: RegExp; modelStepCount: number; checkpoint: boolean }) {
  const state = await runState(seeded.runId, seeded.conversationId);
  const run = state.run as Row;
  assert.equal(String(run.status), 'succeeded', label + ' run must succeed: ' + String(run.error_code || ''));
  assert.equal((state.messages as Row[]).length, 2, label + ' must persist exactly one trigger and one assistant message');
  assert.equal(String((state.messages as Row[]).at(-1)!.id), String(run.output_message_id), label + ' output message linkage');
  const attempts = state.attempts as Row[];
  assert.equal(attempts.length, expect.attempts, label + ' must hold the exact provider attempt count (no hidden re-dispatch)');
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
    // Stale decoy fixtures from an earlier failed attempt are our own labelled
    // rows: release them first, then require a genuinely idle queue.
    await withPlatformTransaction(tx => tx.execute(sql`update app.assistant_jobs j set status='failed',last_error='recovery_check_synthetic_cleanup',version=version+1
      from app.enterprises e where e.id=j.enterprise_id and e.name like '[synthetic-recovery-decoy]%' and j.status in ('queued','running')`));
    await withPlatformTransaction(tx => tx.execute(sql`update app.assistant_runs r set status='failed',error_code='recovery_check_synthetic_cleanup',completed_at=now(),version=version+1
      from app.enterprises e where e.id=r.enterprise_id and e.name like '[synthetic-recovery-decoy]%' and r.status in ('queued','running')`));
    const queue = await platformOne(sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`);
    assert.equal(queue!.n, 0, 'No recovery check may start on an active queue');
    return { queue: queue!.n, binding: bound!.binding };
  });

  await step('decoy probe: an unrelated eligible job stays untouched for the whole run', async () => {
    // A labelled enterprise without assistant settings can never be claimed by
    // any Worker (the claim's settings lock returns null), so an eligible decoy
    // job there is the deterministic witness that this harness never touches
    // unrelated tasks even when they sit in the same global scan.
    const decoy = await withPlatformTransaction(async tx => {
      const existing = await one(tx, sql`select e.id from app.enterprises e where e.name like '[synthetic-recovery-decoy]%' order by id desc limit 1`);
      const enterpriseId = existing ? String(existing.id)
        : String((await one(tx, sql`insert into app.enterprises(name,code,status) values('[synthetic-recovery-decoy] ' || ${'recovery-decoy-' + randomUUID().slice(0, 8)},${'recovery-decoy-' + randomUUID().slice(0, 8)},'active') returning id`))!.id);
      // Every round plants its own fresh decoy job so the untouched assertion
      // always reads this round's row, never a leftover from a prior attempt.
      const conversation = (await one(tx, sql`insert into app.assistant_conversations(enterprise_id,purpose,status,mode,title,entry_snapshot,policy_version,context_revision,last_seq)
        values(${enterpriseId},'customer_consultation','open','ai','[synthetic-recovery-decoy] conversation','{}'::jsonb,1,1,0) returning id`))!;
      const run = (await one(tx, sql`insert into app.assistant_runs(enterprise_id,conversation_id,trigger_kind,trigger_schedule_key,purpose,status,policy_snapshot,context_revision,knowledge_epoch)
        values(${enterpriseId},${String(conversation.id)},'scheduled_task','recovery-decoy','reply','queued','{"schemaVersion":1,"actor":{"principal":{"kind":"user"},"capabilities":[]}}'::jsonb,1,1) returning id`))!;
      const job = (await one(tx, sql`insert into app.assistant_jobs(enterprise_id,kind,run_id,dedupe_key,payload_version,status,attempts,available_at)
        values(${enterpriseId},'chat_turn',${String(run.id)},${'recovery-decoy:' + randomUUID()},1,'queued',0,now()) returning id`))!;
      // Precise this-round fixture ids: the finally cleanup and every audit
      // read key on these exact rows, never on a name-pattern sweep alone.
      report.decoy = { enterpriseId, conversationId: String(conversation.id), runId: String(run.id), jobId: String(job.id) };
      return enterpriseId;
    });
    report.decoyEnterprise = decoy;
    return { decoy };
  });

  await step('A: final-answer checkpoint persisted, interrupted before commit', async () => {
    const question = '客厅地砖还没铺，铺贴前师傅一般会先做什么？';
    const output: ModelTurnOutput = { text: '铺贴前一般会先检查基层平整度和空鼓情况，再弹线预排确认排版方向，之后才正式上砖。',
      toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 11, outputTokens: 7 } };
    const seeded = await seedInterruptedRun('A-final-checkpoint', { question,
      turns: [{ turn: 0, output }],
      checkpoint: { version: 1, turn: 0, messages: [], output } });
    await waitForRunTerminal(seeded.runId, 'recovery');
    const result = await assertCompleted('A', seeded, { attempts: 1, usageKeys: ['agent:' + seeded.runId + ':0'],
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
    await waitForRunTerminal(seeded.runId, 'recovery');
    const result = await assertCompleted('B', seeded, { attempts: 1, usageKeys: ['agent:' + seeded.runId + ':0'],
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
    await waitForRunTerminal(seeded.runId, 'recovery');
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

  await step('E: dispatch marker without receipt stays indeterminate and is never re-dispatched', async () => {
    const q1 = '恢复检查E：已派发但回执未保存的检索';
    const output: ModelTurnOutput = { text: '', toolCalls: [{ id: 'recovery-e-1', name: 'search_enterprise', arguments: JSON.stringify({ query: q1 }) }],
      finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 9, outputTokens: 3 } };
    const seeded = await seedInterruptedRun('E-dispatch-no-receipt', { question: q1, turns: [{ turn: 0, output }],
      searches: [{ sequence: 1, query: q1, receipt: {}, evidence: [], dispatchedOnly: true, usageObserved: false }] });
    await waitForRunTerminal(seeded.runId, 'recovery');
    await assertIndeterminate('E', seeded, { usageKeys: ['agent:' + seeded.runId + ':0', 'agent-v2-query:' + seeded.runId + ':1'].sort(), retrievalSteps: 0 });
    (report.scenarios as Row).E = { runId: seeded.runId, openOperation: 'agent-v2-query:' + seeded.runId + ':1' };
    return (report.scenarios as Row).E;
  });

  await step('F: observed usage without receipt stays indeterminate and is never re-dispatched', async () => {
    const q1 = '恢复检查F：用量已保存但回执未保存的检索';
    const output: ModelTurnOutput = { text: '', toolCalls: [{ id: 'recovery-f-1', name: 'search_enterprise', arguments: JSON.stringify({ query: q1 }) }],
      finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 9, outputTokens: 3 } };
    const seeded = await seedInterruptedRun('F-usage-no-receipt', { question: q1, turns: [{ turn: 0, output }],
      searches: [{ sequence: 1, query: q1, receipt: {}, evidence: [], dispatchedOnly: true, usageObserved: true }] });
    await waitForRunTerminal(seeded.runId, 'recovery');
    await assertIndeterminate('F', seeded, { usageKeys: ['agent:' + seeded.runId + ':0', 'agent-v2-query:' + seeded.runId + ':1'].sort(), retrievalSteps: 0 });
    (report.scenarios as Row).F = { runId: seeded.runId, openOperation: 'agent-v2-query:' + seeded.runId + ':1' };
    return (report.scenarios as Row).F;
  });

  await step('W1: interrupted before any dispatch resumes with exactly one real execution', async () => {
    // The pre-dispatch tool call is query_business on purpose: its receipt has
    // no cites array and the snapshot delivery path accepts an uncited model
    // draft, so the scenario tests recovery itself instead of the model's
    // citation expression (search dispatch recovery is owned by C/E/F; the two
    // retained citation-flake failures document the residual model risk).
    const q1 = '我家现在施工到哪一步？最近做了什么？';
    const output: ModelTurnOutput = { text: '', toolCalls: [{ id: 'recovery-w1-1', name: 'query_business', arguments: JSON.stringify({ domain: 'construction', leadId: '3132' }) }],
      finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 9, outputTokens: 3 } };
    const seeded = await seedInterruptedRun('W1-pre-dispatch', { question: q1, turns: [{ turn: 0, output }] });
    await waitForRunTerminal(seeded.runId, 'recovery');
    const state = await runState(seeded.runId, seeded.conversationId);
    assert.equal(String((state.run as Row).status), 'succeeded', 'W1 must complete: ' + String((state.run as Row).error_code || ''));
    const attempts = state.attempts as Row[];
    // Two attempts when the first final draft passes validation; three when the
    // new validateFinal one-shot repair turn corrects a citation-expression slip.
    assert.ok([2, 3].includes(attempts.length), 'W1 holds the synthetic attempt plus one or two real model attempts');
    assert.equal(String(attempts[0].remote_task_id), 'xiaok-recovery-synthetic', 'W1 keeps the synthetic attempt first');
    assert.ok(attempts.every(a => String(a.status) === 'succeeded'), 'W1 attempts all known-succeeded');
    const repairTurn = attempts.length === 3;
    const expectedUsage = ['agent:' + seeded.runId + ':0', 'agent:' + seeded.runId + ':1'];
    if (repairTurn) expectedUsage.push('agent:' + seeded.runId + ':2');
    const usage = state.usage as Row[];
    assert.deepEqual(usage.map(u => String(u.operation_key)).sort(), expectedUsage.sort(), 'W1 usage keys');
    assert.equal(stepKinds(state, 'retrieval').length, 0, 'W1 dispatches no enterprise search');
    assert.equal(stepKinds(state, 'agent_tool').length, 1, 'W1 executes the business snapshot exactly once');
    (report.scenarios as Row).W1 = { runId: seeded.runId, attempts: attempts.length,
      repairTurn, usageKeys: usage.map(u => String(u.operation_key)) };
    return (report.scenarios as Row).W1;
  });

  // Web dispatch interruption, both recovery layers: the executor's
  // open-operations guard keeps the whole run indeterminate before any graph
  // step, and the shared factory refuses any new dispatch (same or fresh
  // sequence) while an open web marker exists — no re-send under a new number.
  await step('W2: web dispatch marker without receipt stays indeterminate and is never re-dispatched', async () => {
    const question = '恢复检查W2：网页检索已派发但回执未保存';
    const output: ModelTurnOutput = { text: '', toolCalls: [{ id: 'recovery-w2-1', name: 'search_web',
      arguments: JSON.stringify({ query: '闭水试验 蓄水深度 公开标准', domains: [] }) }],
      finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 9, outputTokens: 3 } };
    const seeded = await seedInterruptedRun('W2-web-dispatch-no-receipt', { question, turns: [{ turn: 0, output }],
      webs: [{ stepSeq: 1200 }] });
    await waitForRunTerminal(seeded.runId, 'recovery');
    const state = await assertIndeterminate('W2', seeded, {
      usageKeys: ['agent:' + seeded.runId + ':0', 'agent-web:' + seeded.runId + ':1200'].sort(), retrievalSteps: 0 });
    (report.scenarios as Row).W2 = { runId: seeded.runId, openOperation: 'agent-web:' + seeded.runId + ':1200',
      attempts: (state.attempts as Row[]).length };
    // The factory-level guard (shared with the FastGPT V2 bridge, which has no
    // executor-level open-operations pass): the same sequence and a fresh
    // sequence both refuse while the 1200 marker has no receipt. Nothing new is
    // written and no provider is called.
    const factorySeeded = await seedInterruptedRun('W2-web-factory-guard', { question, turns: [], webs: [{ stepSeq: 1200 }], providerStarted: false });
    const factoryLease = factorySeeded.directLease!;
    const authorize = () => withTenantTransaction(eid, tx => runContext(tx, factoryLease));
    const rt: WebToolRuntime = { lease: factoryLease, protocol: xiaokNativeExecutorProtocol, authorize,
      context: { version: 1, knowledge: [], snapshots: [], sources: [] }, catalog: new Map(),
      messages: [{ role: 'user', content: question }], markWebRetrieved: () => {}, webDeadlineAt: Date.now() + 120000 };
    const web = dialogueWebResearch(rt);
    await assert.rejects(() => web({ name: 'search_web', query: '闭水试验 蓄水深度 公开标准' }, 0),
      (error: { code?: string }) => error.code === 'provider_outcome_unknown', 'Same-sequence dispatch must refuse on the open marker');
    await assert.rejects(() => web({ name: 'search_web', query: '闭水试验 蓄水深度 公开标准' }, 1),
      (error: { code?: string }) => error.code === 'provider_outcome_unknown', 'A fresh sequence must never re-send while an open marker exists');
    const factoryState = await runState(factorySeeded.runId, factorySeeded.conversationId);
    assert.deepEqual((factoryState.usage as Row[]).map(u => String(u.operation_key)).sort(),
      ['agent-web:' + factorySeeded.runId + ':1200'], 'Factory refusals leave the ledger untouched');
    assert.equal((factoryState.steps as Row[]).filter(s => String(s.kind) === 'retrieval').length, 0,
      'Factory refusals persist no receipt step');
    (report.scenarios as Row).W2factory = { runId: factorySeeded.runId, refusedSequences: [0, 1],
      usageKeys: (factoryState.usage as Row[]).map(u => String(u.operation_key)) };
    // Release both labelled fixtures so no queued/running row survives.
    for (const runId of [seeded.runId, factorySeeded.runId]) {
      await read(tx => tx.execute(sql`update app.assistant_jobs set status='failed',last_error='recovery_check_synthetic_cleanup',lease_token=null,lease_expires_at=null,version=version+1
        where enterprise_id=${eid} and run_id=${runId} and status in ('queued','running')`));
      await read(tx => tx.execute(sql`update app.assistant_runs set status='failed',error_code='recovery_check_synthetic_cleanup',completed_at=now(),version=version+1
        where enterprise_id=${eid} and id=${runId} and status in ('queued','running')`));
    }
    return (report.scenarios as Row).W2;
  });

  await step('W3: shared web dispatcher search→read→receipt reuse→real recovery projection', async () => {
    // The factory is driven exactly the way both surfaces call it: the bridge
    // passes the parsed {name, query|candidateId} object, the native executor
    // passes the same shape. Real provider search, real reader, real DB steps.
    const question = '帮我联网查一下公开资料里地暖保温板的出厂检验项目';
    const seeded = await seedInterruptedRun('W3-web-dispatcher', { question, turns: [], providerStarted: false });
    const lease = seeded.directLease!;
    const authorize = () => withTenantTransaction(eid, tx => runContext(tx, lease));
    const rt: WebToolRuntime = { lease, protocol: xiaokNativeExecutorProtocol, authorize,
      context: { version: 1, knowledge: [], snapshots: [], sources: [] }, catalog: new Map(),
      messages: [{ role: 'user', content: question }], markWebRetrieved: () => {}, webDeadlineAt: Date.now() + 120000 };
    const web = dialogueWebResearch(rt);
    const modelQuery = '地暖 保温板 出厂检验';
    const search = await web({ name: 'search_web', query: modelQuery }, 0);
    assert.ok(Array.isArray(search.candidates) && search.candidates.length > 0,
      'search_web must return real candidates, saw: ' + JSON.stringify(search.failures || []));
    const candidateId = String(search.candidates![0].id);
    assert.match(candidateId, new RegExp('^P' + seeded.runId + ':1200:\\d+$'), 'Candidate id must follow the citation contract');
    const readReceipt = await web({ name: 'read_web', candidateId }, 1);
    assert.ok(Array.isArray(readReceipt.failures), 'read_web must return an honest receipt');
    assert.ok(Array.isArray(readReceipt.documents), 'read_web receipt carries the document list');
    // Identical re-issue at the same sequence reuses the persisted receipt with
    // no second provider dispatch and no second usage row.
    const again = await web({ name: 'search_web', query: modelQuery }, 0);
    assert.deepEqual(again, search, 'Completed operations reuse the original receipt verbatim');
    const midState = await runState(seeded.runId, seeded.conversationId);
    assert.deepEqual((midState.usage as Row[]).map(u => String(u.operation_key)).sort(),
      ['agent-web:' + seeded.runId + ':1200', 'agent-web:' + seeded.runId + ':1201'].sort(), 'Web usage ledger holds exactly the two dispatches');
    // Recovery uses the real factory-written rows through the executor's own
    // projection SQL, never hand-built objects.
    const webRows = await tenantRows(sql`select step_seq,capability_name,private_checkpoint,input_summary from app.assistant_run_steps
      where enterprise_id=${eid} and run_id=${seeded.runId} and step_seq>=1200 and step_seq<1300 and kind='retrieval'
      and capability_name in ('web.search.v1','web.read.v1') and status='succeeded' order by step_seq`);
    assert.equal(webRows.length, 2, 'Both web steps persisted');
    const toolState = recoveredDialogueToolState([], [], webRows as Row[], [], []);
    assert.deepEqual(toolState.webs.get('search:' + modelQuery), search, 'Recovered search identity is the model raw query');
    assert.deepEqual(toolState.webs.get('read:' + candidateId), readReceipt, 'Recovered read identity is the candidate id');
    assert.equal(toolState.nextSequence, 2, 'Fresh calls continue past both persisted web steps');
    const persistedSearch = (webRows as Row[]).find(r => Number(r.step_seq) === 1200)!;
    assert.equal(String((persistedSearch.input_summary as Row).rawQuery), modelQuery,
      'The step persists the raw model query beside the normalized WebQuery');
    (report.scenarios as Row).W3 = { runId: seeded.runId, question, modelQuery, candidateId,
      searchStatus: String(search.status), searchCandidates: (search.candidates as Row[] | undefined)?.length ?? 0,
      readStatus: String(readReceipt.status), readDocuments: readReceipt.documents.length, readFailures: readReceipt.failures,
      webSteps: webRows.map(r => Number(r.step_seq)), usageKeys: (midState.usage as Row[]).map(u => String(u.operation_key)) };
    // Release the labelled fixture: the harness owns this run end to end.
    await read(tx => tx.execute(sql`update app.assistant_jobs set status='failed',last_error='recovery_check_synthetic_cleanup',lease_token=null,lease_expires_at=null,version=version+1
      where enterprise_id=${eid} and run_id=${seeded.runId} and status in ('queued','running')`));
    await read(tx => tx.execute(sql`update app.assistant_runs set status='failed',error_code='recovery_check_synthetic_cleanup',completed_at=now(),version=version+1
      where enterprise_id=${eid} and id=${seeded.runId}`));
    return (report.scenarios as Row).W3;
  });

  // Recalled customer originals revalidate through the same mechanisms the
  // executor guard and the final commit call. H drives the real shared
  // recall factory, invalidates the source through the real session-version
  // entry (the exact state change a memory write produces), and requires both
  // the later factory dispatch and the delivery-side availability check to
  // refuse. The independent-source entry class (construction-notice
  // withdrawal blocking a need source) is covered by the requirement-flow
  // evidence and is not re-exercised here.
  await step('H: recalled history source invalidation blocks later recall and delivery', async () => {
    const question = 'H场景：我之前对书桌说过什么要求？';
    const seeded = await seedInterruptedRun('H-history-invalidation', { question, turns: [],
      olderMessages: ['书房需要一张靠窗的书桌，抽屉要带锁。'], providerStarted: false });
    const lease = seeded.directLease!;
    const authorize = () => withTenantTransaction(eid, tx => runContext(tx, lease));
    const historyRefs = new Map<string, HistoryRef>();
    const rt: HistoryToolRuntime = { lease, protocol: xiaokNativeExecutorProtocol, authorize, historyRefs };
    const recall = dialogueHistoryRecall(rt);
    const receipt = await recall({ query: '书桌' }, 0, seeded.triggerSeq!);
    assert.ok(receipt.sources.length > 0, 'The old customer original must be recalled');
    assert.ok(receipt.sources.some(s => String(s.text).includes('书桌')), 'The recalled source is the customer original');
    const steps = await tenantRows(sql`select step_seq,capability_name,status from app.assistant_run_steps
      where enterprise_id=${eid} and run_id=${seeded.runId} and step_seq>=1500 and step_seq<1600 and status='succeeded'`);
    assert.equal(steps.length, 1, 'recall_history persisted exactly one 1500-band step');
    // Real invalidation entry (session version change): bump the conversation's
    // agent memory version the way every real memory write does. The template
    // carries no agentMemory, so read the current version (readMemory's
    // fallback is 0) and write the complete object back like the write path.
    const memoryBefore = Number(((await tenantOne(sql`select entry_snapshot->'agentMemory' mem
      from app.assistant_conversations where enterprise_id=${eid} and id=${seeded.conversationId}`))!.mem as Row | undefined)?.version ?? 0);
    await read(tx => tx.execute(sql`update app.assistant_conversations
      set entry_snapshot=jsonb_set(entry_snapshot,'{agentMemory}',${JSON.stringify({ version: memoryBefore + 1, facts: [] })}::jsonb,true),
      version=version+1,updated_at=now()
      where enterprise_id=${eid} and id=${seeded.conversationId}`));
    assert.equal(await withTenantTransaction(eid, tx =>
      historyRefsAvailable(tx, eid, seeded.conversationId, [...historyRefs.values()])), false,
      'historyRefsAvailable must refuse after the memory version bumped');
    await assert.rejects(() => recall({ query: '书桌' }, 1, seeded.triggerSeq!),
      (error: { code?: string }) => error.code === 'context_changed',
      'A later recall dispatch through the shared factory must be blocked');
    const conversation = await withTenantTransaction(eid, tx => runContext(tx, lease));
    const context: SynthesisContext = { version: 1, knowledge: [], snapshots: [], sources: [],
      history: [{ query: receipt.query, beforeSeq: receipt.beforeSeq, sources: receipt.sources,
        hasMore: receipt.hasMore, oversized: receipt.oversized }] };
    assert.equal(await withTenantTransaction(eid, tx =>
      synthesisContextAvailable(tx, lease.actor, conversation.conversation, context)), false,
      'synthesisContextAvailable must refuse the invalidated history snapshot');
    (report.scenarios as Row).H = { runId: seeded.runId, conversationId: seeded.conversationId,
      oldSourceMessageId: String(receipt.sources[0].messageId), recalledSources: receipt.sources.length,
      entry: 'agentMemory.version bump', blocked: true };
    await read(tx => tx.execute(sql`update app.assistant_jobs set status='failed',last_error='recovery_check_synthetic_cleanup',lease_token=null,lease_expires_at=null,version=version+1
      where enterprise_id=${eid} and run_id=${seeded.runId} and status in ('queued','running')`));
    await read(tx => tx.execute(sql`update app.assistant_runs set status='failed',error_code='recovery_check_synthetic_cleanup',completed_at=now(),version=version+1
      where enterprise_id=${eid} and id=${seeded.runId}`));
    return (report.scenarios as Row).H;
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
    // The knowledge task must advance through the unified scheduler while A's
    // chat slots are full. processAssistantJob is the real Worker entry; the
    // resident dev-server Worker ticks the same entry, so loop until B's job is
    // terminal and record whether this harness's own call did the advancement.
    // The script contains no direct claimKnowledgeJob/runKnowledgeJob path.
    let claimedByScript = false, jobStatus = '';
    for (let index = 0; index < 30; index++) {
      const scheduled = await processAssistantJob();
      if (scheduled.claimed) claimedByScript = true;
      const state = await knowledge.execute('job', { jobId: String(queued.jobId) } as never) as Row;
      jobStatus = String(state.status);
      if (!['queued', 'running'].includes(jobStatus)) break;
      await sleep(1000);
    }
    assert.equal(jobStatus, 'succeeded', 'B knowledge indexing must succeed through the unified scheduler while A is busy: ' + jobStatus);
    const busyStates = await tenantRows(sql`select j.status,j.lease_token is not null leased from app.assistant_jobs j
      where j.enterprise_id=${eid} and j.run_id in (${sql.join(busyRunIds.map(id => sql`${id}`), sql`, `)}) order by j.id`);
    assert.ok((busyStates as Row[]).every(j => String(j.status) === 'running' && j.leased), 'A busy chat jobs stay running and untouched');
    const queuedState = await tenantOne(sql`select status from app.assistant_jobs j where j.enterprise_id=${eid} and j.run_id=${queuedRunId}`);
    assert.equal(String(queuedState!.status), 'queued', 'A queued chat job keeps waiting for its own enterprise slot');
    // The unrelated decoy task was eligible in the same global scan the whole
    // time; the harness neither claims nor fails it. The read keys on this
    // round's precise decoy job id, never on a name-pattern scan.
    const decoyState = await withPlatformTransaction(tx => one(tx, sql`select j.status,j.attempts from app.assistant_jobs j
      where j.id=${String((report.decoy as Row).jobId)}`));
    assert.equal(String(decoyState!.status), 'queued', 'The unrelated decoy job stays queued');
    assert.equal(Number(decoyState!.attempts), 0, 'The unrelated decoy job is never claimed by this harness');
    // Hygiene: release the labelled occupancy fixtures so they never run.
    await read(tx => tx.execute(sql`update app.assistant_jobs set status='failed',last_error='recovery_check_synthetic_cleanup',lease_token=null,lease_expires_at=null,version=version+1
      where enterprise_id=${eid} and run_id in (${sql.join([...busyRunIds, queuedRunId].map(id => sql`${id}`), sql`, `)})`));
    await read(tx => tx.execute(sql`update app.assistant_runs set status='failed',error_code='recovery_check_synthetic_cleanup',completed_at=now(),version=version+1
      where enterprise_id=${eid} and id in (${sql.join([...busyRunIds, queuedRunId].map(id => sql`${id}`), sql`, `)})`));
    await withPlatformTransaction(tx => tx.execute(sql`update app.assistant_jobs set status='failed',last_error='recovery_check_synthetic_cleanup',version=version+1
      where enterprise_id=${String(report.decoyEnterprise)} and id=${String((report.decoy as Row).jobId)} and status='queued'`));
    await withPlatformTransaction(tx => tx.execute(sql`update app.assistant_runs set status='failed',error_code='recovery_check_synthetic_cleanup',completed_at=now(),version=version+1
      where enterprise_id=${String(report.decoyEnterprise)} and id=${String((report.decoy as Row).runId)} and status='queued'`));
    (report.scenarios as Row).D = { slots, controlEnterprise: control, knowledgeJobId: String(queued.jobId),
      knowledgeJob: jobStatus, claimedByScript, busyRuns: busyRunIds, queuedRunId };
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
          where enterprise_id=${eid} and (dedupe_key like 'recovery:%' or dedupe_key like 'recovery-busy:%' or dedupe_key like 'recovery-queued:%')
          and status in ('queued','running')`);
        await tx.execute(sql`update app.assistant_runs set status='failed',error_code='recovery_check_synthetic_cleanup',completed_at=now(),version=version+1
          where enterprise_id=${eid} and status='running' and id in (select run_id from app.assistant_jobs
            where enterprise_id=${eid} and last_error='recovery_check_synthetic_cleanup' and run_id is not null)`);
      });
      await withPlatformTransaction(tx => tx.execute(sql`update app.assistant_jobs j set status='failed',last_error='recovery_check_synthetic_cleanup',version=version+1
        from app.enterprises e where e.id=j.enterprise_id and e.name like '[synthetic-recovery-decoy]%' and j.status in ('queued','running')`));
      await withPlatformTransaction(tx => tx.execute(sql`update app.assistant_runs r set status='failed',error_code='recovery_check_synthetic_cleanup',completed_at=now(),version=version+1
        from app.enterprises e where e.id=r.enterprise_id and e.name like '[synthetic-recovery-decoy]%' and r.status in ('queued','running')`));
      const after = binding(), changed = Object.keys({ ...before, ...after }).filter(f => before[f] !== after[f]);
      report.drift = changed; report.bindingAfter = createHash('sha256').update(JSON.stringify(after)).digest('hex');
      if (changed.length) (report.failures as Row[]).push({ name: 'source drift', files: changed });
      report.finishedAt = new Date().toISOString();
    } catch (error) { report.finalizeError = (error as Error).message; }
    finally { save(); await closePostgresPool();
      const checks = (report.checks as Row[]);
      const passed = checks.length > 0 && checks.every(c => c.passed) && !report.error
        && !((report.drift as string[] | undefined) || []).length && !report.finalizeError;
      if (!passed) process.exitCode = 1;
      console.log(JSON.stringify({ passed, checks: checks.length, error: report.error || null, drift: report.drift || [] })); }
  });
