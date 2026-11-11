import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { UsageService } from '@/lib/assistant/core/usage';
import { confirmedUsageReview, observedTokenTotal, runUsageReconciled, unresolvedProviderOutcome } from '@/lib/assistant/core/usage-review';
import type { ActorContext } from '@/lib/assistant/contracts';

const prefix = 'assistant-usage-accounting-' + process.pid + '-' + Date.now();
const tenants: string[] = []; const admins: string[] = []; const users: string[] = [];
let reviewer: ActorContext; let service: UsageService; let provider: Row;

before(async () => {
  loadEnvConfig(process.cwd());
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(resolvePostgresRuntimeConfig().connectionString).hostname));
  await withPlatformTransaction(async tx => {
    const tenant = (await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix},${prefix},'active') returning id`))!;
    tenants.push(String(tenant.id));
    const eid = String(tenant.id);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
      values(${eid},true,1000,12000000,1000000000,90)`);
    const admin = (await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
      values(${eid},${prefix},'test-only','enterprise_admin','active',ARRAY['assistant-usage','assistant-usage-reconcile'],false) returning id`))!;
    admins.push(String(admin.id));
    const user = (await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!;
    users.push(String(user.id));
    provider = (await one(tx, sql`select id::text,key,adapter_type from app.ai_provider_configs order by id limit 1`))!;
    assert.ok(provider);
  });
  reviewer = { enterpriseId: tenants[0], principal: { kind: 'admin', adminId: admins[0] }, contextVersion: 1, capabilities: [] };
  service = new UsageService(reviewer);
});
after(async () => {
  await withPlatformTransaction(async tx => {
    for (const tenant of tenants) {
      await deleteAssistantData(tx, BigInt(tenant));
      await tx.execute(sql`delete from app.admin_users where enterprise_id=${tenant}`);
      await tx.execute(sql`delete from app.enterprises where id=${tenant}`);
    }
    for (const user of users) await tx.execute(sql`delete from app.users where id=${user}`);
  });
  await closePostgresPool();
});

type AttemptSeed = { key: string; status: string; accepted: boolean };
type UsageSeed = { attempt: string | null; operation: string; category: string; quantity: number | null; observed: boolean };
type Scenario = { runId: string; reservationId: string; version: number };

// Only terminal runs are inserted, with no job row, so a resident Worker can
// never claim these synthetic records. Reconciliation's in-flight guard reads
// the run status and assistant_jobs, both of which stay terminal/absent.
async function seed(attempts: AttemptSeed[], usages: UsageSeed[]): Promise<Scenario> {
  const eid = tenants[0];
  return withPlatformTransaction(async tx => {
    const conversation = (await one(tx, sql`insert into app.assistant_conversations(enterprise_id,purpose,entry_snapshot,policy_version)
      values(${eid},'customer_consultation','{}'::jsonb,1) returning id`))!;
    const message = (await one(tx, sql`insert into app.assistant_messages(enterprise_id,conversation_id,seq,author_kind,user_id,content,purpose)
      values(${eid},${String(conversation.id)},1,'user',${users[0]},${JSON.stringify({ version: 1, blocks: [{ type: 'text', text: '合成用量核对问题' }] })}::jsonb,'reply') returning id`))!;
    const run = (await one(tx, sql`insert into app.assistant_runs(enterprise_id,conversation_id,trigger_kind,trigger_message_id,purpose,status,policy_snapshot,context_revision,knowledge_epoch,started_at,completed_at)
      values(${eid},${String(conversation.id)},'user_message',${String(message.id)},'reply','succeeded','{}'::jsonb,1,1,now(),now()) returning id`))!;
    const runId = String(run.id);
    const reservation = (await one(tx, sql`insert into app.assistant_quota_reservations(enterprise_id,run_id,operation_key,reserved_tokens,reserved_cost_micros,status)
      values(${eid},${runId},${'run:' + runId},2000000,1000000,'reconciling') returning id::text,version`))!;
    const attemptIds = new Map<string, string>();
    for (const attempt of attempts) {
      const row = (await one(tx, sql`insert into app.ai_provider_attempts(enterprise_id,assistant_run_id,provider_config_id,provider_key,adapter_type,capability,logical_model_key,remote_model,status,accepted)
        values(${eid},${runId},${String(provider.id)},${String(provider.key)},${String(provider.adapter_type)},'chat','chat.general','synthetic-usage-accounting',${attempt.status},${attempt.accepted}) returning id`))!;
      attemptIds.set(attempt.key, String(row.id));
    }
    for (const usage of usages) {
      await tx.execute(sql`insert into app.assistant_usage_records(enterprise_id,run_id,provider_attempt_id,operation_key,category,quantity,measurement_kind)
        values(${eid},${runId},${usage.attempt ? attemptIds.get(usage.attempt)! : null},${usage.operation.replaceAll('{runId}', runId)},${usage.category},
        ${usage.quantity},${usage.observed ? 'observed' : 'unavailable'})`);
    }
    return { runId, reservationId: String(reservation.id), version: Number(reservation.version) };
  });
}

async function observed(runId: string) {
  return String((await withTenantTransaction(tenants[0], tx => one(tx, sql`select ${observedTokenTotal(sql`${tenants[0]}`, sql`${runId}`)}::text value
    from app.assistant_runs r where r.enterprise_id=${tenants[0]} and r.id=${runId}`)))!.value);
}
async function unknown(runId: string) {
  return Boolean((await withTenantTransaction(tenants[0], tx => one(tx, sql`select ${unresolvedProviderOutcome()} value
    from app.assistant_runs r where r.enterprise_id=${tenants[0]} and r.id=${runId}`)))!.value);
}
async function reconciled(runId: string) {
  return Boolean((await withTenantTransaction(tenants[0], tx => one(tx, sql`select ${runUsageReconciled()} value
    from app.assistant_runs r where r.enterprise_id=${tenants[0]} and r.id=${runId}`)))!.value);
}
async function confirmed(reservationId: string) {
  return Boolean((await withTenantTransaction(tenants[0], tx => one(tx, sql`select ${confirmedUsageReview()} value
    from app.assistant_quota_reservations q where q.enterprise_id=${tenants[0]} and q.id=${reservationId}`)))!.value);
}
const reviewBody = (version: number, tokens: string) => ({ expectedVersion: version, tokens, costMicros: '0', currency: 'CNY',
  evidenceReference: 'provider-bill:usage-accounting', reason: '合成测试按 provider 账单核对实际用量' });

test('answer and native suggestion observed usage must be reviewed as the exact 1301 total', async () => {
  const scenario = await seed([
    { key: 'answer', status: 'succeeded', accepted: true },
    { key: 'suggestion', status: 'succeeded', accepted: true },
  ], [
    { attempt: 'answer', operation: 'agent:{runId}:0', category: 'tokens', quantity: 1000, observed: true },
    { attempt: 'suggestion', operation: 'native-suggest:{runId}', category: 'suggestion_tokens', quantity: 301, observed: true },
  ]);
  assert.equal(await observed(scenario.runId), '1301');
  assert.equal(await unknown(scenario.runId), false);
  assert.equal(await reconciled(scenario.runId), false);
  assert.equal(await confirmed(scenario.reservationId), false);
  await assert.rejects(service.reconcile(scenario.reservationId, reviewBody(scenario.version, '1000'), randomUUID()), /usage_observed_tokens_conflict/);
  await service.reconcile(scenario.reservationId, reviewBody(scenario.version, '1301'), randomUUID());
  assert.equal(await reconciled(scenario.runId), true);
  assert.equal(await confirmed(scenario.reservationId), true);
});

test('a public opening intro and its run usage are one provider call, not two', async () => {
  const scenario = await seed([
    { key: 'intro', status: 'succeeded', accepted: true },
  ], [
    { attempt: 'intro', operation: 'native-intro:{runId}', category: 'intro_tokens', quantity: 365, observed: true },
    { attempt: 'intro', operation: 'run:{runId}', category: 'tokens', quantity: 365, observed: true },
  ]);
  assert.equal(await observed(scenario.runId), '365');
  await assert.rejects(service.reconcile(scenario.reservationId, reviewBody(scenario.version, '730'), randomUUID()), /usage_observed_tokens_conflict/);
  await service.reconcile(scenario.reservationId, reviewBody(scenario.version, '365'), randomUUID());
  assert.equal(await reconciled(scenario.runId), true);
});

test('a null native suggestion whose attempt is unknown stays unresolved and accepts a higher review', async () => {
  const scenario = await seed([
    { key: 'answer', status: 'succeeded', accepted: true },
    { key: 'suggestion', status: 'unknown', accepted: false },
  ], [
    { attempt: 'answer', operation: 'agent:{runId}:0', category: 'tokens', quantity: 1000, observed: true },
    { attempt: 'suggestion', operation: 'native-suggest:{runId}', category: 'suggestion_tokens', quantity: null, observed: false },
  ]);
  assert.equal(await observed(scenario.runId), '1000');
  assert.equal(await unknown(scenario.runId), true);
  await service.reconcile(scenario.reservationId, reviewBody(scenario.version, '1301'), randomUUID());
  assert.equal(await reconciled(scenario.runId), true);
});

test('a null native suggestion whose attempt explicitly failed without acceptance is known and cannot inflate the total', async () => {
  const scenario = await seed([
    { key: 'answer', status: 'succeeded', accepted: true },
    { key: 'suggestion', status: 'failed', accepted: false },
  ], [
    { attempt: 'answer', operation: 'agent:{runId}:0', category: 'tokens', quantity: 1000, observed: true },
    { attempt: 'suggestion', operation: 'native-suggest:{runId}', category: 'suggestion_tokens', quantity: null, observed: false },
  ]);
  assert.equal(await observed(scenario.runId), '1000');
  assert.equal(await unknown(scenario.runId), false);
  await assert.rejects(service.reconcile(scenario.reservationId, reviewBody(scenario.version, '1301'), randomUUID()), /usage_observed_tokens_conflict/);
  await service.reconcile(scenario.reservationId, reviewBody(scenario.version, '1000'), randomUUID());
  assert.equal(await reconciled(scenario.runId), true);
});
