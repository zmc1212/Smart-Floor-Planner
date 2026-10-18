import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { OperationsService } from '@/lib/assistant/operations';
import type { ActorContext } from '@/lib/assistant/contracts';

const enabled = process.env.ASSISTANT_OPERATIONS_ACCEPTANCE === '1';
const prefix = `assistant-operations-${process.pid}-${Date.now()}-`;
const tenants: string[] = [];
const admins: string[] = [];
const users: string[] = [];
let customer: ActorContext;
let reviewer: ActorContext;
let otherReviewer: ActorContext;

function content(text: string) {
  return { version: 1 as const, blocks: [{ type: 'text' as const, text }] };
}

async function createRun(actor: ActorContext, label: string) {
  const conversation = new ConversationService(actor);
  const created = await conversation.create(`${prefix}${label}`);
  const result = await conversation.send(String(created.id), randomUUID(), content('PRIVATE OPERATIONS BODY MUST NOT APPEAR'));
  const job = await withTenantTransaction(actor.enterpriseId, tx => one<Row>(tx, sql`select id::text from app.assistant_jobs where enterprise_id=${actor.enterpriseId} and run_id=${String(result.runId)}`));
  assert.ok(job?.id);
  return { runId: String(result.runId), jobId: String(job.id) };
}

before(async () => {
  if (!enabled) return;
  const databaseUrl = process.env.ASSISTANT_OPERATIONS_DATABASE_URL?.trim();
  assert.ok(databaseUrl, 'ASSISTANT_OPERATIONS_DATABASE_URL is required for DB operations acceptance');
  process.env.DATABASE_URL = databaseUrl;
  loadEnvConfig(process.cwd());
  const config = resolvePostgresRuntimeConfig();
  const url = new URL(config.connectionString);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.equal(url.pathname, '/xiaok_embedding_eval');
  await withPlatformTransaction(async tx => {
    const role = (await one<Row>(tx, sql`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`))!;
    assert.equal(role.rolsuper, false);
    assert.equal(role.rolbypassrls, false);
    const active = await one<Row>(tx, sql`select count(*)::text count from app.assistant_jobs where status in ('queued','running')`);
    assert.equal(String(active?.count), '0', 'run operations acceptance serially on an idle queue');
    for (let i = 0; i < 2; i++) {
      const enterprise = (await one<Row>(tx, sql`insert into app.enterprises(name,code,status) values(${prefix + i},${prefix + i},'active') returning id`))!;
      tenants.push(String(enterprise.id));
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
        values(${String(enterprise.id)},true,1000,12000000,1000000000,90)`);
      const admin = (await one<Row>(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
        values(${String(enterprise.id)},${prefix + 'admin-' + i},'test-only','enterprise_admin','active',ARRAY['assistant-usage'],false) returning id`))!;
      admins.push(String(admin.id));
      const user = (await one<Row>(tx, sql`insert into app.users(nickname,context_version) values(${prefix + 'user-' + i},1) returning id`))!;
      users.push(String(user.id));
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${String(user.id)},${prefix + 'openid-' + i})`);
    }
  });
  customer = { enterpriseId: tenants[0], principal: { kind: 'user', userId: users[0] }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
  reviewer = { enterpriseId: tenants[0], principal: { kind: 'admin', adminId: admins[0] }, contextVersion: 1, capabilities: ['assistant.usage.read'] };
  otherReviewer = { enterpriseId: tenants[1], principal: { kind: 'admin', adminId: admins[1] }, contextVersion: 1, capabilities: ['assistant.usage.read'] };
});

after(async () => {
  if (!enabled) return;
  await withPlatformTransaction(async tx => {
    for (const enterpriseId of tenants) {
      await deleteAssistantData(tx, BigInt(enterpriseId));
      await tx.execute(sql`delete from app.admin_users where enterprise_id=${enterpriseId}`);
      await tx.execute(sql`delete from app.enterprises where id=${enterpriseId}`);
    }
    for (const userId of users) await tx.execute(sql`delete from app.users where id=${userId}`);
  });
  await closePostgresPool();
});

test('operations snapshot is tenant scoped, string typed, and does not expose content', { skip: !enabled }, async () => {
  const grounded = await createRun(customer, 'grounded');
  const insufficient = await createRun(customer, 'insufficient');
  const citationFailure = await createRun(customer, 'citation-failure');
  const queued = await createRun(customer, 'queued');
  const running = await createRun(customer, 'running');
  await withTenantTransaction(tenants[0], async tx => {
    await tx.execute(sql`update app.assistant_runs set status='succeeded',answer_kind='grounded',created_at=now()-interval '120 seconds',started_at=now()-interval '90 seconds',completed_at=now()-interval '30 seconds',updated_at=now() where enterprise_id=${tenants[0]} and id=${grounded.runId}`);
    await tx.execute(sql`update app.assistant_jobs set status='succeeded',created_at=now()-interval '120 seconds',updated_at=now() where enterprise_id=${tenants[0]} and id=${grounded.jobId}`);
    await tx.execute(sql`update app.assistant_runs set status='succeeded',answer_kind='insufficient_evidence',created_at=now()-interval '100 seconds',started_at=now()-interval '80 seconds',completed_at=now()-interval '20 seconds',updated_at=now() where enterprise_id=${tenants[0]} and id=${insufficient.runId}`);
    await tx.execute(sql`update app.assistant_jobs set status='succeeded',created_at=now()-interval '100 seconds',updated_at=now() where enterprise_id=${tenants[0]} and id=${insufficient.jobId}`);
    await tx.execute(sql`update app.assistant_runs set status='failed',error_code='invalid_model_citation',created_at=now()-interval '80 seconds',started_at=null,completed_at=now()-interval '40 seconds',updated_at=now() where enterprise_id=${tenants[0]} and id=${citationFailure.runId}`);
    await tx.execute(sql`update app.assistant_jobs set status='failed',created_at=now()-interval '80 seconds',updated_at=now() where enterprise_id=${tenants[0]} and id=${citationFailure.jobId}`);
    await tx.execute(sql`update app.assistant_runs set created_at=now()-interval '240 seconds',updated_at=now() where enterprise_id=${tenants[0]} and id=${queued.runId}`);
    await tx.execute(sql`update app.assistant_jobs set status='queued',created_at=now()-interval '240 seconds',updated_at=now() where enterprise_id=${tenants[0]} and id=${queued.jobId}`);
    await tx.execute(sql`update app.assistant_runs set status='running',created_at=now()-interval '120 seconds',started_at=now()-interval '100 seconds',updated_at=now() where enterprise_id=${tenants[0]} and id=${running.runId}`);
    await tx.execute(sql`update app.assistant_jobs set status='running',created_at=now()-interval '120 seconds',heartbeat_at=now(),lease_expires_at=now()+interval '120 seconds',updated_at=now() where enterprise_id=${tenants[0]} and id=${running.jobId}`);
    await tx.execute(sql`update app.assistant_quota_reservations set status='released' where enterprise_id=${tenants[0]} and run_id in (${grounded.runId},${insufficient.runId})`);
    await tx.execute(sql`update app.assistant_quota_reservations set status='reconciling' where enterprise_id=${tenants[0]} and run_id=${citationFailure.runId}`);
  });

  const service = new OperationsService(reviewer, {
    ...process.env,
    ASSISTANT_WORKER_HEALTH_FILE: `${process.cwd()}/.operations-health-file-that-does-not-exist`,
    ASSISTANT_OPERATIONS_QUEUE_BACKLOG_WARN: '1',
    ASSISTANT_OPERATIONS_QUEUE_BACKLOG_CRITICAL: '5',
    ASSISTANT_OPERATIONS_QUEUE_AGE_WARN_SECONDS: '1',
    ASSISTANT_OPERATIONS_QUEUE_AGE_CRITICAL_SECONDS: '600',
    ASSISTANT_OPERATIONS_LATENCY_P95_WARN_MS: '1',
    ASSISTANT_OPERATIONS_LATENCY_P95_CRITICAL_MS: '1000000',
    ASSISTANT_OPERATIONS_INSUFFICIENT_RATIO_WARN: '0.4',
    ASSISTANT_OPERATIONS_INSUFFICIENT_RATIO_CRITICAL: '0.9',
    ASSISTANT_OPERATIONS_CITATION_FAILURE_WARN: '1',
    ASSISTANT_OPERATIONS_CITATION_FAILURE_CRITICAL: '5',
    ASSISTANT_OPERATIONS_UNKNOWN_COST_WARN: '1',
    ASSISTANT_OPERATIONS_UNKNOWN_COST_CRITICAL: '5',
  });
  const snapshot = await service.snapshot();
  assert.equal(snapshot.queue.queued, '1');
  assert.equal(snapshot.queue.running, '1');
  assert.equal(snapshot.queue.backlog, '2');
  assert.ok(Number(snapshot.queue.oldestAgeSeconds) >= 200);
  assert.equal(snapshot.answers.totalRuns, '5');
  assert.equal(snapshot.answers.terminalRuns, '3');
  assert.equal(snapshot.answers.insufficientEvidenceRatio, '0.500000');
  assert.equal(snapshot.answers.citationFailureRuns, '1');
  assert.equal(snapshot.answers.latency.total.sampleCount, '3');
  assert.equal(snapshot.answers.latency.processing.sampleCount, '2');
  assert.equal(snapshot.answers.latency.firstToken.status, 'unavailable');
  assert.equal(snapshot.unknownCosts.pendingReservations, '1');
  assert.equal(snapshot.worker.heartbeat.freshness, 'unknown');
  assert.equal(snapshot.status, 'warning');
  assert.ok(snapshot.alerts.some(alert => alert.code === 'worker_heartbeat' && alert.status === 'unknown'));
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes('PRIVATE OPERATIONS BODY MUST NOT APPEAR'), false);
  assert.equal(serialized.includes(process.env.ASSISTANT_EMBEDDING_API_KEY || '__missing__'), false);
});

test('operations snapshot cannot read another tenant and rechecks database permission', { skip: !enabled }, async () => {
  const other = await new OperationsService(otherReviewer, {
    ...process.env,
    ASSISTANT_WORKER_HEALTH_FILE: `${process.cwd()}/.operations-health-file-that-does-not-exist`,
  }).snapshot();
  assert.equal(other.queue.backlog, '0');
  assert.equal(other.answers.totalRuns, '0');
  assert.equal(other.unknownCosts.pendingReservations, '0');
  await withTenantTransaction(tenants[0], tx => tx.execute(sql`update app.admin_users set menu_permissions=ARRAY[]::text[] where enterprise_id=${tenants[0]} and id=${admins[0]}`));
  await assert.rejects(new OperationsService(reviewer).snapshot(), /assistant_capability_forbidden/);
});
