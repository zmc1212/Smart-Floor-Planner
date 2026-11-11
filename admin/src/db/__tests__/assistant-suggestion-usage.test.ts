import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { backfillSuggestionProviderAttempt, persistSuggestionUsage } from '@/lib/assistant/agent/native-executor';
import { executePostgresText } from '@/lib/ai/postgres-workflow-chat';
import { unresolvedProviderOutcome } from '@/lib/assistant/core/usage-review';
import { resumeSuggestionGeneration, suggestionGenerationStep } from '@/lib/assistant/fastgpt/agent-v2/suggestions';
import { failRun, markProviderStarted, runContext, type Lease } from '@/lib/assistant/infrastructure/job-queue';
import type { AgentConfig } from '@/lib/assistant/agent/config';
import type { ActorContext } from '@/lib/assistant/contracts';

// Synthetic protocol/accounting fixtures only: no provider adapter or model call.
const prefix = 'assistant-suggestion-usage-' + process.pid + '-' + Date.now();
type Fixture = { enterpriseId: string; userId: string; providerConfigId: string };
const fixtures: Fixture[] = [];

before(() => {
  loadEnvConfig(process.cwd());
  const url = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
});
after(async () => {
  try {
    await withPlatformTransaction(async tx => {
      for (const f of fixtures) {
        await deleteAssistantData(tx, BigInt(f.enterpriseId));
        await tx.execute(sql`delete from app.ai_provider_configs where id=${f.providerConfigId}`);
        await tx.execute(sql`delete from app.users where id=${f.userId}`);
        await tx.execute(sql`delete from app.enterprises where id=${f.enterpriseId}`);
      }
    });
  } finally { await closePostgresPool(); }
});

async function fixture(): Promise<Fixture> {
  const label = prefix + '-' + fixtures.length;
  const f = await withPlatformTransaction(async tx => {
    const enterpriseId = String((await one(tx, sql`insert into app.enterprises(name,code,status)
      values(${label},${label},'active') returning id`))!.id);
    const userId = String((await one(tx, sql`insert into app.users(nickname,context_version)
      values(${label},1) returning id`))!.id);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
      values(${enterpriseId},true,100,1200000,100000000,90)`);
    const providerConfigId = String((await one(tx, sql`insert into app.ai_provider_configs(key,name,adapter_type,base_url,
      api_key_encrypted,api_key_masked,capabilities)
      values(${label},${label},'openai_compatible','http://127.0.0.1:1','synthetic-only','synthetic-only',ARRAY['chat']) returning id`))!.id);
    return { enterpriseId, userId, providerConfigId };
  });
  fixtures.push(f);
  return f;
}

/** A fabricated running run/job: persistence must not depend on a live lease,
 * and failRun must still see the same durable job/run pair a worker would. */
async function runningRun(f: Fixture, providerStarted: boolean) {
  const label = prefix + '-run-' + randomUUID(), token = prefix + '-lease-' + randomUUID();
  const ids = await withPlatformTransaction(async tx => {
    // One active run per conversation: each fabricated run owns its own
    // synthetic conversation so fixtures never collide on the active index.
    const conversationId = String((await one(tx, sql`insert into app.assistant_conversations(
      enterprise_id,purpose,status,mode,entry_snapshot)
      values(${f.enterpriseId},'customer_consultation','open','ai','{}'::jsonb) returning id`))!.id);
    const runId = String((await one(tx, sql`insert into app.assistant_runs(enterprise_id,conversation_id,trigger_kind,
      trigger_schedule_key,purpose,status,policy_snapshot,context_revision,knowledge_epoch)
      values(${f.enterpriseId},${conversationId},'scheduled_task',${label},'reply','running','{}'::jsonb,1,1)
      returning id`))!.id);
    const jobId = String((await one(tx, sql`insert into app.assistant_jobs(enterprise_id,kind,run_id,dedupe_key,status,
      attempts,lease_token,lease_expires_at,heartbeat_at,provider_started_at)
      values(${f.enterpriseId},'chat_turn',${runId},${label + '-job'},'running',1,${token},now()+interval '10 minutes',now(),
      case when ${providerStarted} then now() else null end) returning id`))!.id);
    return { runId, jobId };
  });
  const actor: ActorContext = { enterpriseId: f.enterpriseId, principal: { kind: 'user', userId: f.userId },
    contextVersion: 1, capabilities: ['assistant.chat.self'] };
  const lease: Lease = { enterpriseId: f.enterpriseId, jobId: ids.jobId, runId: ids.runId, token, actor };
  return { ...ids, token, lease, operationKey: 'native-suggest:' + ids.runId };
}

async function suggestionAttempt(f: Fixture, runId: string, status: string, accepted: boolean) {
  return withPlatformTransaction(async tx => String((await one(tx, sql`insert into app.ai_provider_attempts(
    enterprise_id,assistant_run_id,provider_config_id,provider_key,adapter_type,capability,logical_model_key,remote_model,
    status,accepted,metadata)
    values(${f.enterpriseId},${runId},${f.providerConfigId},'synthetic','openai_compatible','chat','chat.general',
    'synthetic-chat',${status},${accepted},${JSON.stringify({ purpose: 'suggestions' })}::jsonb) returning id`))!.id));
}

/** A lease whose run context really passes authorization: if the composed
 * dispatch hook were ever invoked, runContext would succeed and the marker
 * would be written. Its absence therefore proves the gateway rejected before
 * dispatch, not that the hook failed on its own. */
async function dispatchableRun(f: Fixture) {
  const label = prefix + '-dispatch-' + randomUUID(), token = prefix + '-lease-' + randomUUID();
  const ids = await withPlatformTransaction(async tx => {
    const conversationId = String((await one(tx, sql`insert into app.assistant_conversations(
      enterprise_id,purpose,status,mode,entry_snapshot,policy_version)
      values(${f.enterpriseId},'customer_consultation','open','ai','{}'::jsonb,1) returning id`))!.id);
    const runId = String((await one(tx, sql`insert into app.assistant_runs(enterprise_id,conversation_id,trigger_kind,
      trigger_schedule_key,purpose,status,policy_snapshot,context_revision,knowledge_epoch)
      values(${f.enterpriseId},${conversationId},'scheduled_task',${label},'reply','running',
      ${JSON.stringify({ policyVersion: 1,
        knowledgePolicy: { protocol: 'enterprise-knowledge-policy-v1', enabled: false } })}::jsonb,1,1)
      returning id`))!.id);
    const jobId = String((await one(tx, sql`insert into app.assistant_jobs(enterprise_id,kind,run_id,dedupe_key,status,
      attempts,lease_token,lease_expires_at,heartbeat_at)
      values(${f.enterpriseId},'chat_turn',${runId},${label + '-job'},'running',1,${token},now()+interval '10 minutes',now())
      returning id`))!.id);
    return { runId, jobId };
  });
  const actor: ActorContext = { enterpriseId: f.enterpriseId, principal: { kind: 'user', userId: f.userId },
    contextVersion: 1, capabilities: ['assistant.chat.self'] };
  const lease: Lease = { enterpriseId: f.enterpriseId, jobId: ids.jobId, runId: ids.runId, token, actor };
  return { ...ids, lease, operationKey: 'native-suggest:' + ids.runId };
}

/** The production order: the open usage marker first, then the shared
 * provider-start marker. */
async function suggestionDispatchHook(lease: Lease, operationKey: string, beforeProviderCall: () => Promise<void>) {
  await withTenantTransaction(lease.enterpriseId, async tx => {
    await runContext(tx, lease);
    await tx.execute(sql`insert into app.assistant_usage_records(enterprise_id,run_id,operation_key,category,quantity,measurement_kind)
      values(${lease.enterpriseId},${lease.runId},${operationKey},'suggestion_tokens',null,'unavailable') on conflict do nothing`);
  });
  await beforeProviderCall();
}

/** A capability binding no configured runtime can match, so the gateway rejects
 * before creating an attempt and before any provider I/O. */
const unboundConfig: AgentConfig = { runtime: 'langgraph-v1', model: 'synthetic-suggestion-model',
  providerKey: 'synthetic-unbound-' + randomUUID(), imageInput: false, tools: false, probeVersion: 'synthetic-probe' };

async function openSuggestionStep(f: Fixture, runId: string, operationKey: string) {
  await withTenantTransaction(f.enterpriseId, async tx => {
    await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,input_summary)
      values(${f.enterpriseId},${runId},${suggestionGenerationStep},'agent_suggestion_model','running',
      ${JSON.stringify({ protocol: 'xiaok-native-executor-v1', purpose: 'suggestions' })}::jsonb)`);
    await tx.execute(sql`insert into app.assistant_usage_records(enterprise_id,run_id,operation_key,category,quantity,measurement_kind)
      values(${f.enterpriseId},${runId},${operationKey},'suggestion_tokens',null,'unavailable')`);
  });
}

test('suggestion usage survives revoked authorization and an observed write is never overwritten', async () => {
  const f = await fixture(), claim = await runningRun(f, true);
  await openSuggestionStep(f, claim.runId, claim.operationKey);
  const first = await suggestionAttempt(f, claim.runId, 'succeeded', true);
  const second = await suggestionAttempt(f, claim.runId, 'succeeded', true);
  // Authorization is gone before the usage is saved: the lease-free writer
  // must still keep the tokens the provider already returned.
  await withTenantTransaction(f.enterpriseId, tx => tx.execute(
    sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${f.enterpriseId}`));
  await persistSuggestionUsage(f.enterpriseId, claim.runId, claim.operationKey, first, { inputTokens: 276, outputTokens: 25 });
  await persistSuggestionUsage(f.enterpriseId, claim.runId, claim.operationKey, second, { inputTokens: 999, outputTokens: 999 });

  const saved = await withTenantTransaction(f.enterpriseId, tx => one(tx, sql`select provider_attempt_id::text as attempt,
    measurement_kind,quantity::text as quantity,input_tokens::text as input,output_tokens::text as output
    from app.assistant_usage_records where enterprise_id=${f.enterpriseId} and run_id=${claim.runId}
      and operation_key=${claim.operationKey} and category='suggestion_tokens'`));
  assert.equal(saved!.measurement_kind, 'observed');
  assert.equal(saved!.attempt, first);
  assert.equal(saved!.quantity, '301');
  assert.equal(saved!.input, '276');
  assert.equal(saved!.output, '25');
  const messages = await withTenantTransaction(f.enterpriseId, tx => one(tx, sql`select count(*)::int n
    from app.assistant_messages where enterprise_id=${f.enterpriseId} and run_id=${claim.runId} and author_kind='assistant'`));
  assert.equal(messages!.n, 0);
  const step = await withTenantTransaction(f.enterpriseId, tx => one(tx, sql`select status from app.assistant_run_steps
    where enterprise_id=${f.enterpriseId} and run_id=${claim.runId} and step_seq=${suggestionGenerationStep}`));
  // Usage persistence is lease-free and does not settle the dispatch marker.
  assert.equal(step!.status, 'running');
});

test('a definite failure is attached to the unknown usage row without turning it into an observation', async () => {
  const f = await fixture(), claim = await runningRun(f, true);
  await openSuggestionStep(f, claim.runId, claim.operationKey);
  const failed = await suggestionAttempt(f, claim.runId, 'failed', false);
  assert.equal(await backfillSuggestionProviderAttempt(f.enterpriseId, claim.runId, claim.operationKey), failed);

  const saved = await withTenantTransaction(f.enterpriseId, tx => one(tx, sql`select provider_attempt_id::text as attempt,
    measurement_kind,quantity from app.assistant_usage_records where enterprise_id=${f.enterpriseId}
      and run_id=${claim.runId} and operation_key=${claim.operationKey}`));
  assert.equal(saved!.attempt, failed);
  assert.equal(saved!.measurement_kind, 'unavailable');
  assert.equal(saved!.quantity, null);
  const attempt = await withPlatformTransaction(tx => one(tx, sql`select status,accepted from app.ai_provider_attempts
    where enterprise_id=${f.enterpriseId} and id=${failed}`));
  assert.deepEqual({ status: attempt!.status, accepted: attempt!.accepted }, { status: 'failed', accepted: false });

  // A guard rejected before dispatch leaves neither an attempt nor a matching
  // usage row; the backfill matches nothing instead of inventing one.
  const early = await runningRun(f, false);
  await withTenantTransaction(f.enterpriseId, tx => tx.execute(sql`insert into app.assistant_usage_records(
    enterprise_id,run_id,operation_key,category,quantity,measurement_kind)
    values(${f.enterpriseId},${early.runId},${early.operationKey},'suggestion_tokens',null,'unavailable')`));
  assert.equal(await backfillSuggestionProviderAttempt(f.enterpriseId, early.runId, early.operationKey), null);
  const untouched = await withTenantTransaction(f.enterpriseId, tx => one(tx, sql`select provider_attempt_id
    from app.assistant_usage_records where enterprise_id=${f.enterpriseId} and run_id=${early.runId}
      and operation_key=${early.operationKey}`));
  assert.equal(untouched!.provider_attempt_id, null);
});

test('an unknown suggestion outcome is recovered as unknown and failRun keeps the run indeterminate', async () => {
  const f = await fixture(), claim = await runningRun(f, true);
  await withTenantTransaction(f.enterpriseId, tx => tx.execute(sql`insert into app.assistant_run_steps(
    enterprise_id,run_id,step_seq,kind,status,input_summary)
    values(${f.enterpriseId},${claim.runId},${suggestionGenerationStep},'agent_suggestion_model','failed',
    ${JSON.stringify({ protocol: 'xiaok-native-executor-v1', purpose: 'suggestions', code: 'provider_outcome_unknown' })}::jsonb)`));
  const step = await withTenantTransaction(f.enterpriseId, tx => one(tx, sql`select status,private_checkpoint,input_summary
    from app.assistant_run_steps where enterprise_id=${f.enterpriseId} and run_id=${claim.runId}
      and step_seq=${suggestionGenerationStep}`));
  assert.deepEqual(resumeSuggestionGeneration(step ?? undefined), { action: 'skip', unknown: true });

  await failRun(claim.lease, 'context_changed', false);
  const run = await withTenantTransaction(f.enterpriseId, tx => one(tx, sql`select status,error_code
    from app.assistant_runs where enterprise_id=${f.enterpriseId} and id=${claim.runId}`));
  assert.equal(run!.status, 'indeterminate');
  assert.equal(run!.error_code, 'provider_outcome_unknown');
  const kept = await withTenantTransaction(f.enterpriseId, tx => one(tx, sql`select input_summary
    from app.assistant_run_steps where enterprise_id=${f.enterpriseId} and run_id=${claim.runId}
      and step_seq=${suggestionGenerationStep}`));
  assert.equal((kept!.input_summary as { code?: string }).code, 'provider_outcome_unknown');
});

test('a gateway rejection before dispatch leaves no attempt and no suggestion usage marker', async () => {
  const f = await fixture(), claim = await dispatchableRun(f);
  let failure: unknown;
  // The real gateway rejects on the unbound capability before it creates the
  // provider attempt, so the composed dispatch hook (and any network call) is
  // never reached.
  await assert.rejects(executePostgresText({
    enterpriseId: BigInt(f.enterpriseId),
    owner: { kind: 'assistant_run', runId: BigInt(claim.runId) },
    logicalModelKey: 'chat.general', messages: [], maxTokens: 800,
    agent: { config: unboundConfig, input: { messages: [{ role: 'user',
      content: [{ type: 'text', text: 'synthetic suggestion input' }] }], tools: [], maxTokens: 800 } },
    metadata: { purpose: 'suggestions' },
    beforeProviderCall: () => suggestionDispatchHook(claim.lease, claim.operationKey, () => markProviderStarted(claim.lease)),
  }), (error: unknown) => { failure = error; return true; });
  assert.ok(failure instanceof Error);
  const attempts = await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.ai_provider_attempts
    where enterprise_id=${f.enterpriseId} and assistant_run_id=${claim.runId}`));
  assert.equal(attempts!.n, 0);
  const usage = await withTenantTransaction(f.enterpriseId, tx => one(tx, sql`select count(*)::int n
    from app.assistant_usage_records where enterprise_id=${f.enterpriseId} and run_id=${claim.runId}
      and category='suggestion_tokens'`));
  assert.equal(usage!.n, 0);
  // No provider-start marker either: dispatch never started.
  const job = await withTenantTransaction(f.enterpriseId, tx => one(tx, sql`select provider_started_at
    from app.assistant_jobs where enterprise_id=${f.enterpriseId} and id=${claim.jobId}`));
  assert.equal(job!.provider_started_at, null);
});

test('a failed post-dispatch suggestion step without a marker is not an unknown provider outcome', async () => {
  const f = await fixture(), claim = await runningRun(f, true);
  // Durable state after the fix: the answer run succeeded and the suggestion
  // step recorded a known failure, while no usage marker (and no attempt) was
  // written because the gateway rejected before dispatch.
  await withTenantTransaction(f.enterpriseId, async tx => {
    await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,input_summary)
      values(${f.enterpriseId},${claim.runId},${suggestionGenerationStep},'agent_suggestion_model','failed',
      ${JSON.stringify({ protocol: 'xiaok-native-executor-v1', purpose: 'suggestions', code: 'suggestion_generation_failed' })}::jsonb)`);
    await tx.execute(sql`update app.assistant_runs set status='succeeded',completed_at=now()
      where enterprise_id=${f.enterpriseId} and id=${claim.runId}`);
  });
  const unresolved = await withTenantTransaction(f.enterpriseId, tx => one(tx, sql`select coalesce(${unresolvedProviderOutcome()},false) unresolved
    from app.assistant_runs r where r.enterprise_id=${f.enterpriseId} and r.id=${claim.runId}`));
  assert.equal(unresolved!.unresolved, false);

  // Contrast: the pre-fix leftover NULL marker is still an unknown outcome.
  const legacy = await runningRun(f, true);
  await openSuggestionStep(f, legacy.runId, legacy.operationKey);
  const stillUnknown = await withTenantTransaction(f.enterpriseId, tx => one(tx, sql`select coalesce(${unresolvedProviderOutcome()},false) unresolved
    from app.assistant_runs r where r.enterprise_id=${f.enterpriseId} and r.id=${legacy.runId}`));
  assert.equal(stillUnknown!.unresolved, true);
});
