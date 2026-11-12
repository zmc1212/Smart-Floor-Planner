import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { GET as readAssistant, POST as sendAssistant } from '@/app/api/miniprogram/assistant/[...path]/route';
import { GET as getManualQueue } from '@/app/api/native-workflow/tasks/manual/route';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { TenantEnterpriseResetRepository } from '@/db/repositories/tenant-enterprise-reset-repository';
import { cancelRuns, ConversationService } from '@/lib/assistant/core/conversation';
import type { ActorContext } from '@/lib/assistant/contracts';
import { ensureFollowupBinding } from '@/lib/construction/report-store';
import { ConstructionService } from '@/lib/construction/service';
import { SiteChatService } from '@/lib/construction/site-chat';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { closePostgresPool } from '@/lib/postgresql';
import { createRunState } from '../advance';
import { WorkflowOperationError } from '../errors';
import { createWorkflowService } from '../service';
import { createFileWorkflowStore } from '../store/file-store';
import { createDelegationReminderPort, delegationReminderResult, delegationReminderTool, nativeToolResultConsumer } from '../live/delegation-reminder-tool';
import { delegationFromRow } from '../live/delegation-store';
import { runNativeDelegationTick } from '../live/delegation-worker';
import { createPostgresDurableTaskStore } from '../live/durable-task-postgres-store';
import { createDurableTaskRuntime } from '../live/durable-task-runtime';
import { createFileDurableTaskStore } from '../live/durable-task-store';
import { createDurableToolExecutor } from '../live/durable-tool-execution';
import { readNativeToolManualQueue } from '../live/durable-tool-worker';
import type { PeriodReportBatchManifest } from '../live/period-report-batch';
import { createFilePeriodReportBatchStore } from '../live/period-report-batch-store';
import { resolveEndedShanghaiWeek, type ScheduledPeriodReportDispatchSummary } from '../live/period-report-schedule';
import { createFilePeriodReportScheduleStore } from '../live/period-report-schedule-store';
import { emptyCounts, scheduleRequestId, scheduleRunId, type PeriodReportScheduleRun } from '../live/period-report-schedule-types';
import { resolvePublishedTarget } from '../live/published-target';
import { createFileWorkflowRunStore } from '../live/run-store';
import { createNativeRuntimeStores } from '../live/runtime-stores';
import type { LiveRunRecord } from '../live/types';

const enabled = process.env.B511_PG_TEST === '1';
const mainTenant = '1454';
const controlTenant = '1455';
const label = '[B5.11] ' + randomUUID();
const runChild = promisify(execFile);
const runtimeStore = createPostgresDurableTaskStore();
const toolEnv = {
  NATIVE_WORKFLOW_TASK_STORE: 'postgres',
  NATIVE_WORKFLOW_DURABLE_TOOL_ENABLED: '1',
  NATIVE_WORKFLOW_DELEGATION_ENABLED: '1',
  NATIVE_WORKFLOW_DELEGATION_ENTERPRISE_IDS: mainTenant,
  NATIVE_WORKFLOW_SCHEDULE_ENTERPRISE_IDS: [mainTenant, controlTenant].join(','),
  NATIVE_WORKFLOW_SCHEDULE_ENABLED: '0',
  NATIVE_WORKFLOW_RUNTIME_STORE: 'postgres',
  CRON_SECRET: randomUUID(),
};

function operationError(code: string) {
  return (error: unknown) => error instanceof WorkflowOperationError && error.code === code;
}

async function initializeEnterprise(enterpriseId: string) {
  await withPlatformTransaction(async (tx) => {
    await tx.execute(sql`insert into app.enterprises(id,name,code,status) overriding system value
      values (${enterpriseId},${label},${'b511-' + enterpriseId},'active') on conflict(id) do nothing`);
    assert.equal((await one(tx, sql`select code from app.enterprises where id=${enterpriseId}`))?.code, 'b511-' + enterpriseId);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
      values (${enterpriseId},true,400,12000000,1000000000,30) on conflict(enterprise_id) do nothing`);
  });
}

before(async () => {
  if (!enabled) return;
  const target = new URL(process.env.DATABASE_URL ?? '');
  assert.notEqual(process.env.NODE_ENV, 'production');
  assert.deepEqual([target.protocol, target.hostname, target.pathname, target.username, target.search, target.hash],
    ['postgresql:', '127.0.0.1', '/xiaok_b511_test', 'sfp_app', '', '']);
  await withPlatformTransaction(async (tx) => {
    assert.deepEqual(await one(tx, sql`select current_database() as db,current_user as role,rolsuper,rolbypassrls
      from pg_roles where rolname=current_user`), { db: 'xiaok_b511_test', role: 'sfp_app', rolsuper: false, rolbypassrls: false });
    const tables = await rows(tx, sql`select relname,relrowsecurity,relforcerowsecurity from pg_class
      where relnamespace='app'::regnamespace and relname in ('native_workflow_runs','native_workflow_schedule_runs',
        'native_workflow_report_batches','native_workflow_schedule_controls','native_workflow_schedule_ledgers','native_workflow_durable_tasks')`);
    assert.equal(tables.length, 6);
    assert.ok(tables.every((table) => table.relrowsecurity && table.relforcerowsecurity));
    await tx.execute(sql`insert into app.system_roles(role_key,label,menu_keys) values
      ('designer','隔离设计师',array['construction-projects']),('construction_staff','隔离施工',array['construction-projects'])
      on conflict (role_key) do nothing`);
  });
  await initializeEnterprise(mainTenant);
  await initializeEnterprise(controlTenant);
  process.env.JWT_SECRET = 'b511-local-fixture-jwt';
  Object.assign(process.env, toolEnv);
});
after(async () => { if (enabled) await closePostgresPool(); });

async function fixture(enterpriseId: string, team = false) {
  const id = label + ' ' + randomUUID().slice(0, 12);
  const identities = await withPlatformTransaction(async (tx) => {
    const user = await one<{ id: string }>(tx, sql`insert into app.users(enterprise_id,nickname,context_version)
      values (${enterpriseId},${id},1) returning id::text`);
    assert.ok(user);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values (${user.id},${id})`);
    const lead = await one<{ id: string }>(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
      values (${enterpriseId},${user.id},${id},'13900000000','natural') returning id::text`);
    assert.ok(lead);
    const accounts: string[] = [];
    for (const role of team ? ['enterprise_admin', 'construction_staff', 'construction_staff', 'designer'] : ['enterprise_admin']) {
      const admin = await one<{ id: string }>(tx, sql`insert into app.admin_users
        (enterprise_id,username,password_hash,role,status,must_change_password,display_name)
        values (${enterpriseId},${'b511-' + randomUUID()},'synthetic-only',${role},'active',false,${id}) returning id::text`);
      assert.ok(admin);
      accounts.push(admin.id);
    }
    return { uid: user.id, leadId: lead.id, accounts };
  });
  const [boss, manager = boss, worker, designer] = identities.accounts;
  const service = new ConstructionService({ enterpriseId, adminId: boss });
  const project = await service.execute('create', {
    leadId: identities.leadId, name: id, managerId: manager, rooms: ['主卧', '书房'],
  }, randomUUID());
  const projectId = String(project.id);
  if (team) {
    for (const [adminId, role] of [[worker, 'worker'], [designer, 'designer']]) {
      const detail = await service.execute('detail', { projectId });
      await service.execute('member', { projectId, expectedVersion: Number((detail.project as Row).version), adminId, role, active: true }, randomUUID());
    }
    await withTenantTransaction(enterpriseId, (tx) => ensureFollowupBinding(tx, enterpriseId, {
      kind: 'admin', id: worker, audience: 'worker',
    }));
  }
  const actor: ActorContext = {
    enterpriseId, principal: { kind: 'user', userId: identities.uid }, contextVersion: 1,
    capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: identities.leadId },
  };
  const conversation = new ConversationService(actor);
  const conversationId = String((await conversation.create(randomUUID())).id);
  const token = await signMiniProgramToken({
    sub: identities.uid, id: identities.uid, role: 'user', mode: 'customer', contextVersion: 1, source: 'wechat',
  });
  return { enterpriseId, projectId, conversationId, token, uid: identities.uid, boss, manager, worker, designer };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function miniMessages(fixture: Fixture, text?: string, token = fixture.token) {
  const idempotencyKey = randomUUID();
  const pathname = 'conversations/' + fixture.conversationId + '/messages';
  const request = new NextRequest('http://127.0.0.1/api/miniprogram/assistant/' + pathname, {
    method: text ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + token, 'Idempotency-Key': idempotencyKey },
    body: text ? JSON.stringify({ clientMessageId: idempotencyKey, content: { version: 1, blocks: [{ type: 'text', text }] } }) : undefined,
  });
  return (text ? sendAssistant : readAssistant)(request, { params: Promise.resolve({ path: pathname.split('/') }) });
}

async function child<T>(args: string[], env: Record<string, string | undefined> = {}): Promise<T & { pid: number }> {
  const { stdout } = await runChild(process.execPath, ['--import', 'tsx',
    'src/lib/native-workflow/__tests__/support/b511-runtime-process.ts', ...args], {
    env: { ...process.env, ...env }, windowsHide: true, timeout: 60_000,
  });
  const receipt = stdout.split(/\r?\n/).find((line) => line.startsWith('B511 '));
  assert.ok(receipt, 'worker must return a test receipt');
  return JSON.parse(receipt.slice(5));
}

async function definitions(root: string) {
  const service = createWorkflowService({ store: createFileWorkflowStore({ rootDir: root }) });
  await service.createFromTemplate('period-report-weekly');
  return (await service.publishDraft({ definitionId: 'period-report-weekly', expectedDraftRevision: 1 })).version;
}

async function runFixture(enterpriseId: string, projectId: string, runId: string, definitionRoot: string): Promise<LiveRunRecord> {
  const at = new Date();
  const published = await definitions(definitionRoot);
  const period = resolveEndedShanghaiWeek(at);
  const event = {
    eventId: 'b511-' + period.periodStart, eventType: 'period_report' as const,
    periodKind: 'weekly' as const, periodStart: period.periodStart, periodEnd: period.periodEnd, occurredAt: period.endAt,
  };
  const { definition, plan, nodeVersions } = resolvePublishedTarget(published, event);
  return {
    enterpriseId, projectId, status: 'unknown',
    binding: {
      runId, definitionId: definition.definitionId, revision: published.revision, digest: plan.digest, nodeVersions, event,
      businessEvent: {
        source: 'current_project_revision', stageKey: 'period_report', settingsVersion: 1, progressRevision: 0,
        outboxEventId: null, periodKind: 'weekly', periodStart: event.periodStart, periodEnd: event.periodEnd,
      },
    },
    state: createRunState(plan, { runId, mode: 'live' }), trace: [], operations: [],
    createdAt: at.toISOString(), updatedAt: at.toISOString(),
  };
}

async function sandbox() {
  await mkdir('tmp', { recursive: true });
  return mkdtemp(path.resolve('tmp/b511-runtime-'));
}

test('independent Admin processes compare Workflow Run revisions, with direct forced RLS isolation', { skip: !enabled, timeout: 90_000 }, async () => {
  const root = await sandbox();
  const stores = createNativeRuntimeStores(mainTenant);
  const other = createNativeRuntimeStores(controlTenant);
  const id = 'b511-admin-' + randomUUID();
  const candidate = await runFixture(mainTenant, '1', id, path.join(root, 'definitions'));
  const created = await stores.runStore.create(candidate);
  assert.equal(created.record.storeRevision, 1);
  assert.equal(await other.runStore.get(id), null);
  const pair = await Promise.all(['first', 'second'].map((name) => child<{ error?: string; revision?: number; outcome?: string }>(
    ['run-update', mainTenant, id, '1', name])));
  assert.notEqual(pair[0].pid, pair[1].pid);
  assert.deepEqual(pair.map((result) => result.error ?? result.revision).sort(), [2, 'runtime_store_conflict']);
  const committed = await stores.runStore.get(id);
  assert.equal(committed?.state.outcome, pair.find((result) => result.revision === 2)?.outcome);
  assert.equal(committed?.storeRevision, 2);
  const foreign = await other.runStore.create({ ...candidate, enterpriseId: controlTenant });
  assert.equal(foreign.record.storeRevision, 1);
  assert.deepEqual(await withTenantTransaction(controlTenant, (tx) => rows(tx,
    sql`select enterprise_id::text from app.native_workflow_runs where id=${id}`)), [{ enterprise_id: controlTenant }]);
  assert.equal(await withPlatformTransaction((tx) => one(tx, sql`select id from app.native_workflow_runs where id=${id}`)), undefined);
  await assert.rejects(other.runStore.update(committed!), operationError('runtime_store_tenant_mismatch'));
});

test('two Workers claim once, reclaim on expiry, and fence the previous owner at commit', { skip: !enabled, timeout: 90_000 }, async () => {
  const runtime = createDurableTaskRuntime({ store: runtimeStore });
  const businessKey = 'b511-' + randomUUID();
  const create = (enterpriseId: string) => runtime.create({
    enterpriseId, kind: 'b511.test', businessKey, delegation: { requestedBy: 'b511', conversationId: null, messageId: null, runId: null },
    retry: { baseDelayMs: 10, maxDelayMs: 10, jitterRatio: 0 },
  });
  const candidates = await Promise.all([create(mainTenant), create(mainTenant)]);
  assert.equal(candidates.filter((candidate) => candidate.created).length, 1);
  assert.equal(candidates[0].record.taskId, candidates[1].record.taskId);
  const first = candidates[0].record;
  const { record: second } = await create(controlTenant);
  await Promise.all([first, second].map(({ enterpriseId, taskId }) => runtime.enqueue({ enterpriseId, taskId })));
  type Claim = { lease: import('../live/durable-task-types').DurableTaskLease | null };
  const outcomes = await Promise.all([
    child<Claim>(['claim', mainTenant, first.taskId, '700']),
    child<Claim>(['claim', mainTenant, first.taskId, '700']),
    child<Claim>(['claim', controlTenant, second.taskId, '30000']),
  ]);
  assert.equal(outcomes.slice(0, 2).filter((result) => result.lease).length, 1);
  assert.ok(outcomes[2].lease, 'control tenant progresses independently');
  assert.equal(await runtime.get(controlTenant, first.taskId), null);
  const previous = outcomes.slice(0, 2).find((result) => result.lease)!.lease!;
  await delay(800);
  const recovery = await runtime.recover(mainTenant, { kind: 'b511.test', readyAt: new Date(), statuses: ['running'] });
  assert.equal(recovery.reclaimed, 1, JSON.stringify(recovery));
  await delay(30);
  const takeover = await child<Claim>(['claim', mainTenant, first.taskId, '30000']);
  assert.ok(takeover.lease);
  assert.notEqual(takeover.lease.token, previous.token);
  const scope = { enterpriseId: mainTenant, taskId: first.taskId };
  await assert.rejects(runtime.complete({ ...scope, owner: previous.owner, token: previous.token }), operationError('durable_task_lease_lost'));
  const current = await runtime.get(mainTenant, first.taskId);
  assert.ok(current);
  await assert.rejects(runtimeStore.update({ ...current, data: { stale: true } }, { fence: previous }),
    operationError('durable_task_lease_lost'));
  await runtime.release({ ...scope, owner: previous.owner, token: previous.token });
  const completed = await runtime.complete({ ...scope, owner: takeover.lease.owner, token: takeover.lease.token, data: { committed: true } });
  assert.equal(completed.status, 'succeeded');
  const persisted = await runtime.get(mainTenant, first.taskId);
  assert.deepEqual(persisted?.attempts.map((attempt) => attempt.outcome), ['timed_out', 'succeeded']);
  assert.deepEqual(persisted?.data, { committed: true });
  assert.equal(persisted?.lease, null);
});

async function stageReminder(f: Fixture) {
  const response = await miniMessages(f, '请持续跟进主卧的水电进展和书房的插座点位，等我回复超时就在小K里提醒我。');
  assert.equal(response.status, 202, JSON.stringify(await response.clone().json()));
  const delegation = await withTenantTransaction(f.enterpriseId, async (tx) => {
    const row = await one(tx, sql`select * from app.native_workflow_delegations
      where enterprise_id=${f.enterpriseId} and conversation_id=${f.conversationId}`);
    assert.ok(row);
    const d = delegationFromRow(row);
    assert.equal(d.authorization.remindOwner, true);
    // Age the wait in this synthetic fixture so the timeout consumer can run now.
    const deadlineAt = new Date(Date.now() - 1000).toISOString();
    const tasks = d.tasks.map((task) => task.key === 'outlet' ? {
      ...task, next: 'ask_owner', wait: { key: randomUUID(), for: 'owner', personId: f.uid,
        requested: ['书桌的准确位置'], startedAt: new Date(Date.now() - 48 * 3_600_000 - 1000).toISOString(), deadlineAt },
    } : task);
    await tx.execute(sql`update app.native_workflow_delegations set tasks=${JSON.stringify(tasks)}::jsonb,state='waiting',
      next_wake_at=${deadlineAt} where enterprise_id=${f.enterpriseId} and id=${d.id}`);
    await tx.execute(sql`update app.domain_event_deliveries d set status='delivered'
      from app.domain_event_outbox e where d.enterprise_id=${f.enterpriseId} and e.enterprise_id=d.enterprise_id and e.id=d.event_id
        and e.type='native.delegation.refresh.v1' and e.payload->>'delegationId'=${d.id}
        and d.consumer_key='native.delegation.v1' and d.status='pending'`);
    return d;
  });
  const tick = await runNativeDelegationTick();
  assert.ok(tick.enterprises.every((tenant) => !('error' in tenant) && !tenant.dead && !tenant.retried), JSON.stringify(tick));
  const staged = (await runtimeStore.list({ enterpriseId: f.enterpriseId, kind: 'tool.call', tool: delegationReminderTool }))
    .find((record) => record.delegation.delegationId === delegation.id);
  assert.ok(staged);
  assert.equal(staged.status, 'pending');
  assert.equal(staged.data.dispatch, null);
  assert.equal(staged.delegation.messageId, delegation.originMessageId);
  return { delegation, staged };
}

test('the authorized Worker route consumes one real reminder callback and reopens the original consultation', { skip: !enabled, timeout: 120_000 }, async () => {
  const f = await fixture(mainTenant);
  const foreign = await fixture(controlTenant);
  const { delegation, staged } = await stageReminder(f);
  const runtime = createDurableTaskRuntime({ store: runtimeStore });
  const port = createDelegationReminderPort();
  const executor = createDurableToolExecutor({ runtime, port: {
    ...port,
    async dispatch(input) {
      await port.dispatch(input);
      throw new Error('the response was lost after the real business transaction committed');
    },
  } });
  const unknown = await executor.dispatchPrepared(mainTenant, staged.taskId, 'b511-lost-response');
  assert.equal(unknown?.state, 'unknown');
  assert.equal((await runtime.get(mainTenant, staged.taskId))?.lastError?.code, 'external_outcome_unknown');
  const route = () => child<{ status: number; body: { data: { nativeWorkflowTools: unknown } } }>(['assistant']);
  const callbacks = await Promise.all([route(), route()]);
  assert.notEqual(callbacks[0].pid, callbacks[1].pid);
  assert.ok(callbacks.every((entry) => entry.status === 200 && entry.body.data.nativeWorkflowTools), JSON.stringify(callbacks));

  const saved = await runtime.get(mainTenant, staged.taskId);
  assert.equal(saved?.status, 'succeeded', JSON.stringify(callbacks));
  assert.ok(saved?.data.writebackAt);
  assert.equal((saved?.data.callbacks as { applied: boolean }[]).filter((callback) => callback.applied).length, 1);
  const result = await withTenantTransaction(mainTenant, (tx) => rows(tx, sql`
    select e.id::text,d.status,d.attempts,a.outcome,m.id::text as message_id,m.reply_to_message_id::text
    from app.domain_event_outbox e
    join app.domain_event_deliveries d on d.enterprise_id=e.enterprise_id and d.event_id=e.id
    join app.native_workflow_delegation_events a on a.enterprise_id=e.enterprise_id and a.event_id=e.id
    join app.assistant_messages m on m.enterprise_id=e.enterprise_id and m.id::text=e.payload->>'messageId'
    where e.enterprise_id=${mainTenant} and e.type=${delegationReminderResult}
      and e.payload->>'taskId'=${staged.taskId} and a.delegation_id=${delegation.id} and d.consumer_key=${nativeToolResultConsumer}`));
  assert.equal(result.length, 1);
  assert.deepEqual([result[0].status, result[0].attempts, result[0].outcome, result[0].reply_to_message_id],
    ['delivered', 1, 'applied', delegation.originMessageId]);
  const reentry = await miniMessages(f);
  assert.equal(reentry.status, 200);
  const history = JSON.stringify(await reentry.json());
  assert.equal((history.match(/提醒一下/g) ?? []).length, 1);
  assert.match(history, /书桌的准确位置/);
  assert.equal((await miniMessages(f, undefined, foreign.token)).status, 404);
  assert.equal(await runtime.get(controlTenant, staged.taskId), null);
});

test('pause before dispatch is reauthorized and unresolved effects enter the existing manual queue', { skip: !enabled, timeout: 120_000 }, async () => {
  const paused = await fixture(mainTenant);
  const { staged } = await stageReminder(paused);
  assert.equal((await miniMessages(paused, '暂停水电跟进。')).status, 202);
  const worker = await child<{ status: number; body: unknown }>(['assistant']);
  assert.equal(worker.status, 200);
  const revoked = await runtimeStore.get(mainTenant, staged.taskId);
  assert.equal(revoked?.status, 'failed', JSON.stringify(worker));
  assert.equal(revoked?.lastError?.code, 'delegation_reminder_unavailable');
  assert.doesNotMatch(JSON.stringify(await (await miniMessages(paused)).json()), /提醒一下/);

  const uncertain = await fixture(mainTenant);
  const { delegation, staged: unknownTask } = await stageReminder(uncertain);
  const runtime = createDurableTaskRuntime({ store: runtimeStore });
  const port = createDelegationReminderPort();
  let dispatches = 0;
  const executor = createDurableToolExecutor({
    runtime, maxProbes: 1,
    port: { ...port, async dispatch() { dispatches++; throw new Error('unknown transport state'); } },
  });
  assert.equal((await executor.dispatchPrepared(mainTenant, unknownTask.taskId, 'b511-unknown'))?.state, 'unknown');
  const exhausted = await executor.reconcile(mainTenant, unknownTask.taskId);
  assert.equal(exhausted?.manual?.code, 'external_outcome_unconfirmed');
  assert.equal((await executor.dispatchPrepared(mainTenant, unknownTask.taskId, 'b511-late'))?.state, 'unknown');
  assert.equal(dispatches, 1);
  assert.equal((await child<{ status: number }>(['assistant'])).status, 200);
  const queue = await readNativeToolManualQueue(mainTenant);
  assert.ok(queue.some((entry) => entry.taskId === unknownTask.taskId && entry.status === 'unknown' && entry.delegationId === delegation.id));
  assert.equal((await readNativeToolManualQueue(controlTenant)).some((entry) => entry.taskId === unknownTask.taskId), false);
  assert.equal((await getManualQueue(new Request('http://127.0.0.1/api/native-workflow/tasks/manual'))).status, 401);
  assert.ok(await withTenantTransaction(mainTenant, (tx) => one(tx, sql`
    select a.event_id from app.native_workflow_delegation_events a join app.domain_event_outbox e
      on e.enterprise_id=a.enterprise_id and e.id=a.event_id where a.enterprise_id=${mainTenant}
      and a.delegation_id=${delegation.id} and e.type='native.delegation.reminder.attention.v1' and e.aggregate_id=${unknownTask.taskId}`)));
});

test('two schedule processes claim the same week once and enqueue four durable report jobs', { skip: !enabled, timeout: 120_000 }, async () => {
  const root = await sandbox();
  const definitionDir = path.join(root, 'definitions');
  await definitions(definitionDir);
  const at = new Date();
  const period = resolveEndedShanghaiWeek(at);
  const f = await fixture(mainTenant, true);
  await withTenantTransaction(mainTenant, async (tx) => {
    const bound = await one(tx, sql`select id from app.construction_followup_bindings where enterprise_id=${mainTenant}
      and audience='boss' and status='enabled'`);
    if (!bound) await ensureFollowupBinding(tx, mainTenant, { kind: 'admin', id: f.boss, audience: 'boss' });
  });
  const site = new SiteChatService({ enterpriseId: mainTenant, adminId: f.worker });
  const page = await site.read(f.projectId);
  const roomId = String((page.rooms as Row[])[0].id);
  const captured = await site.send(f.projectId, {
    text: '主卧水电线管已铺好。', mediaIds: [], capture: { kind: 'quick', workId: 'wiring', roomId, location: null, progress: 'done' },
  }, randomUUID());
  const manager = new SiteChatService({ enterpriseId: mainTenant, adminId: f.manager });
  const recordId = String(captured.recordId);
  const review = await manager.read(f.projectId);
  const versions = (review.versions as Row).records as Row;
  await manager.mutate(f.projectId, recordId, 'publish', { expectedVersion: versions[recordId], audience: 'customer' }, randomUUID());
  await withTenantTransaction(mainTenant, (tx) => tx.execute(sql`update app.construction_site_records
    set published_at=${new Date(period.startAt)} where enterprise_id=${mainTenant} and id=${recordId}`));
  for (const enterpriseId of [mainTenant, controlTenant]) {
    await withTenantTransaction(enterpriseId, async (tx) => {
      const claims = await rows(tx, sql`select id from app.domain_event_outbox where enterprise_id=${enterpriseId}
        and type='native.workflow.weekly.claimed.v1' and aggregate_id=${period.periodStart}`);
      assert.equal(claims.length, 0, 'use a fresh isolated week for this fixture');
      await tx.execute(sql`insert into app.construction_report_settings
        (enterprise_id,enabled,stage_enabled,weekly_day,weekly_time,next_daily_at,next_weekly_at,project_ids)
        values (${enterpriseId},true,false,1,'00:00','2099-01-01',${new Date(period.endAt)},
          ${JSON.stringify(enterpriseId === mainTenant ? [f.projectId] : [])}::jsonb)
        on conflict(enterprise_id) do update set next_weekly_at=excluded.next_weekly_at,project_ids=excluded.project_ids`);
    });
  }
  const run = () => child<{ result: ScheduledPeriodReportDispatchSummary }>(['schedule'], {
    NATIVE_WORKFLOW_SCHEDULE_ENABLED: '1', NATIVE_WORKFLOW_STORE_DIR: definitionDir,
  });
  const ticks = await Promise.all([run(), run()]);
  assert.notEqual(ticks[0].pid, ticks[1].pid);
  assert.ok(ticks.every(({ result }) => result.enterprises.every((tenant) => !tenant.error)), JSON.stringify(ticks));
  const requestId = scheduleRequestId(mainTenant, f.projectId, period.periodStart);
  const stores = createNativeRuntimeStores(mainTenant);
  const batch = await stores.batchStore.get(requestId);
  assert.ok(batch, JSON.stringify(ticks));
  assert.equal(batch.entries.length, 4);
  assert.ok(batch.entries.every((entry) => entry.saveReceipt?.reportId), JSON.stringify(batch.entries));
  assert.equal((await stores.runStore.list()).filter((record) => record.binding.runId.startsWith(requestId)).length, 4);
  assert.ok((await stores.store.ledger(mainTenant, f.projectId)).storeRevision);
  const reportIds = batch.entries.map((entry) => entry.saveReceipt!.reportId);
  assert.equal(new Set(reportIds).size, 4);
  const queued = await withTenantTransaction(mainTenant, (tx) => rows(tx, sql`
    select r.id::text,j.status from app.construction_reports r
    join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id
    join app.assistant_jobs j on j.enterprise_id=v.enterprise_id and j.run_id=v.run_id
    where r.enterprise_id=${mainTenant} and r.period_start=${new Date(period.startAt)} order by r.id`));
  assert.equal(queued.length, 4);
  assert.ok(queued.every((job) => reportIds.includes(String(job.id)) && job.status === 'queued'));
  for (const enterpriseId of [mainTenant, controlTenant]) {
    const claims = await withTenantTransaction(enterpriseId, (tx) => rows(tx, sql`
      select id from app.domain_event_outbox where enterprise_id=${enterpriseId}
        and type='native.workflow.weekly.claimed.v1' and aggregate_id=${period.periodStart}`));
    assert.equal(claims.length, 1);
    assert.ok((await createNativeRuntimeStores(enterpriseId).store.get(scheduleRunId(enterpriseId, period.periodStart)))?.weeklyClaim);
  }
  await run();
  assert.equal((await stores.batchStore.get(requestId))?.entries.map((entry) => entry.saveReceipt!.reportId).join(), reportIds.join());
  const runId = scheduleRunId(mainTenant, period.periodStart);
  const stale = { owner: 'first', token: randomUUID() };
  const current = { owner: 'second', token: randomUUID() };
  const leaseOptions = { now: () => new Date(), ttlMs: 120 };
  assert.equal(await stores.store.acquire(runId, { ...stale, ...leaseOptions }), true);
  assert.equal(await stores.batchStore.acquire(requestId, { ...stale, ...leaseOptions }), true);
  await delay(170);
  assert.equal(await stores.store.acquire(runId, { ...current, ...leaseOptions, ttlMs: 30_000 }), true);
  assert.equal(await stores.batchStore.acquire(requestId, { ...current, ...leaseOptions, ttlMs: 30_000 }), true);
  try {
    const previousRun = await stores.store.get(runId);
    const previousBatch = await stores.batchStore.get(requestId);
    assert.ok(previousRun && previousBatch);
    await assert.rejects(stores.store.update(previousRun, stale), operationError('runtime_store_conflict'));
    await assert.rejects(stores.batchStore.update(previousBatch, stale), operationError('runtime_store_conflict'));
    const ledger = await stores.store.ledger(mainTenant, f.projectId);
    await assert.rejects(stores.store.saveLedger(ledger, { runId, fence: stale }), operationError('runtime_store_lease_lost'));
    await stores.store.release(runId, stale.owner, stale.token);
    await stores.batchStore.release(requestId, stale.owner, stale.token);
    assert.equal((await stores.store.update(previousRun, current)).storeRevision, previousRun.storeRevision! + 1);
    assert.equal((await stores.batchStore.update(previousBatch, current)).storeRevision, previousBatch.storeRevision! + 1);
  } finally {
    await stores.store.release(runId, current.owner, current.token);
    await stores.batchStore.release(requestId, current.owner, current.token);
  }
  await withTenantTransaction(mainTenant, async (tx) => {
    const jobs = await rows(tx, sql`select r.id::text,r.conversation_id::text,r.policy_snapshot
      from app.assistant_runs r join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.run_id=r.id
      join app.construction_reports p on p.enterprise_id=v.enterprise_id and p.id=v.report_id
      where r.enterprise_id=${mainTenant} and p.period_start=${new Date(period.startAt)} and r.status='queued'`);
    for (const job of jobs) await cancelRuns(tx, (job.policy_snapshot as { actor: ActorContext }).actor,
      String(job.conversation_id), String(job.id));
  });
});

test('database outage and a rolled-back transaction leave no success or partial checkpoint', { skip: !enabled, timeout: 90_000 }, async () => {
  const root = await sandbox();
  const id = 'b511-outage-' + randomUUID();
  const stores = createNativeRuntimeStores(mainTenant);
  const initial = await runFixture(mainTenant, '1', id, path.join(root, 'definitions'));
  await stores.runStore.create(initial);

  const outage = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => outage.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = outage.address();
  assert.ok(address && typeof address !== 'string');
  const interrupted = new URL(process.env.DATABASE_URL!);
  interrupted.port = String(address.port);
  try {
    const result = await child<{ error?: string }>(['run-update', mainTenant, id, '1', 'interrupted'], {
      DATABASE_URL: interrupted.toString(), POSTGRES_CONNECTION_TIMEOUT_MS: '1000',
    });
    assert.equal(result.error, 'database_unavailable');
  } finally {
    await new Promise<void>((resolve) => outage.close(() => resolve()));
  }
  assert.equal((await stores.runStore.get(id))?.storeRevision, 1);
  const retried = await child<{ revision: number }>(['run-update', mainTenant, id, '1', 'recovered']);
  assert.equal(retried.revision, 2);
  assert.equal((await stores.runStore.get(id))?.state.outcome, 'recovered');

  let rolledBackId = '';
  await assert.rejects(withTenantTransaction(mainTenant, async (tx) => {
    const runtime = createDurableTaskRuntime({ store: createPostgresDurableTaskStore({ tx, enterpriseId: mainTenant }) });
    const { record } = await runtime.create({ enterpriseId: mainTenant, kind: 'b511.rollback', businessKey: id,
      delegation: { requestedBy: 'b511', conversationId: null, messageId: null, runId: null } });
    rolledBackId = record.taskId;
    throw new Error('rollback staged request');
  }), /rollback staged request/);
  assert.ok(rolledBackId);
  assert.equal(await runtimeStore.get(mainTenant, rolledBackId), null);
});

test('file export, staged import, verification, cutover and safe rollback preserve history and unknown tasks', { skip: !enabled, timeout: 180_000 }, async () => {
  const root = await sandbox();
  const enterpriseId = String(1_456_000 + Math.floor(Math.random() * 100_000));
  await initializeEnterprise(enterpriseId);
  const project = await fixture(enterpriseId);
  const runDir = path.join(root, 'runs');
  const batchDir = path.join(root, 'batches');
  const scheduleDir = path.join(root, 'schedule');
  const taskDir = path.join(root, 'tasks');
  const at = new Date().toISOString();
  const liveRun = await runFixture(enterpriseId, project.projectId, 'b511-history-' + randomUUID(), path.join(root, 'definitions'));
  await createFileWorkflowRunStore({ rootDir: runDir }).create(liveRun);
  const period = resolveEndedShanghaiWeek(new Date(at));
  const id = scheduleRunId(enterpriseId, period.periodStart);
  const schedule: PeriodReportScheduleRun = {
    runVersion: 1, runId: id, enterpriseId, period, published: null, weeklyClaim: null,
    status: 'completed', queue: [], projects: {}, counts: emptyCounts(), startedAt: at,
    updatedAt: at, finishedAt: at, lastError: null, audit: [],
  };
  const scheduleStore = createFilePeriodReportScheduleStore({ rootDir: scheduleDir });
  await scheduleStore.create(schedule);
  await scheduleStore.setControl(enterpriseId, { paused: true, updatedBy: project.boss, reason: 'B5.11 test', now: () => new Date(at) });
  await scheduleStore.saveLedger({ ledgerVersion: 1, enterpriseId, projectId: project.projectId, items: [], updatedAt: at });
  const requestId = 'b511-history-batch';
  const receivers = (['customer', 'worker', 'designer', 'boss'] as const).map((kind) => ({
    kind, adminId: kind === 'customer' ? null : project.boss, runId: requestId + '-' + kind,
  }));
  const batch: PeriodReportBatchManifest = {
    manifestVersion: 1, requestId, enterpriseId, projectId: project.projectId, actorAdminId: project.boss,
    event: liveRun.binding.event, period: { kind: 'weekly', periodStart: period.periodStart, periodEnd: period.periodEnd },
    published: liveRun.binding, receivers, createdAt: at, updatedAt: at, status: 'running', reasons: [],
    entries: receivers.map((receiver) => ({ ...receiver, executed: false, state: 'not_started', reason: null, errorCode: null,
      saveReceipt: null, deliveryReceipt: null, observation: null, updatedAt: at })),
  };
  await createFilePeriodReportBatchStore({ rootDir: batchDir }).create(batch);
  const runtime = createDurableTaskRuntime({ store: createFileDurableTaskStore({ rootDir: taskDir }) });
  const external = createDurableToolExecutor({ runtime, port: {
    async dispatch() { throw new Error('legacy transport outcome unknown'); },
    async probe() { return { status: 'unknown' }; },
    async saveResult() { throw new Error('legacy fixture must never save or dispatch again'); },
    async writeback() { throw new Error('legacy fixture must never write back'); },
  } });
  const submitted = await external.submit({
    enterpriseId, projectId: project.projectId, workerId: 'b511-file-fixture', tool: 'b511.legacy',
    idempotencyKey: 'legacy-key', effect: 'deliver',
    delegation: { requestedBy: project.uid, conversationId: project.conversationId, messageId: null, runId: null },
    authorization: { allowed: true, actorId: project.uid, checkedAt: at, scope: 'b511.test', reason: null }, payload: {},
  });
  assert.equal(submitted.state, 'unknown');
  const migrate = async (operation: string, scope = 'runtime') => {
    const { stdout } = await runChild(process.execPath, ['--import', 'tsx', 'scripts/native-workflow-runtime-migrate.ts',
      operation, '--scope', scope, '--enterprise-id', enterpriseId,
      '--run-dir', runDir, '--batch-dir', batchDir, '--schedule-dir', scheduleDir, '--task-dir', taskDir,
      ...(operation === 'dry-run' ? [] : ['--snapshot', path.join(root, scope + '.json')]),
      '--receipt', path.join(root, scope + '-cutover.json'), '--writers-stopped'], {
      env: { ...process.env, B511_RUNTIME_MIGRATION_DATABASE_URL: process.env.DATABASE_URL }, windowsHide: true, timeout: 30_000,
    });
    return JSON.parse(stdout.trim()) as { records: number; snapshotSha256: string; adapterAfterRestart?: string };
  };
  const dry = await migrate('dry-run');
  assert.equal(dry.records, 5);
  assert.equal((await migrate('export')).snapshotSha256, dry.snapshotSha256);
  assert.equal((await migrate('validate')).snapshotSha256, dry.snapshotSha256);
  assert.equal((await migrate('import')).records, 5);
  assert.equal((await migrate('import')).records, 5, 'import must be idempotent');
  assert.equal((await migrate('verify')).snapshotSha256, dry.snapshotSha256);
  assert.equal((await migrate('cutover')).adapterAfterRestart, 'postgres');
  assert.equal((await migrate('rollback')).adapterAfterRestart, 'file');
  await withTenantTransaction(enterpriseId, (tx) => tx.execute(sql`insert into app.domain_event_outbox
    (enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values (${enterpriseId},'construction.report.followup.v1','b511_rollback_fixture','new-business-write',1,'{"kind":"system"}','b511','{}')`));
  await assert.rejects(migrate('rollback'), /database changed after cutover/);
  assert.equal((await migrate('export', 'tasks')).records, 1);
  assert.equal((await migrate('import', 'tasks')).records, 1);
  assert.equal((await migrate('verify', 'tasks')).records, 1);
  const persisted = await runtimeStore.get(enterpriseId, submitted.taskId);
  assert.equal(persisted?.status, 'waiting');
  assert.deepEqual(persisted?.data.dispatch, submitted.record.data.dispatch);
  assert.equal(persisted?.lastError?.code, 'external_outcome_unknown');
  assert.equal(persisted?.lease, null);
  assert.equal((await migrate('cutover', 'tasks')).adapterAfterRestart, 'postgres');
  assert.equal((await migrate('rollback', 'tasks')).adapterAfterRestart, 'file');

  const cleanup = await withPlatformTransaction((tx) =>
    new TenantEnterpriseResetRepository(tx).execute(BigInt(enterpriseId), BigInt(project.boss)));
  const runtimeCounts = cleanup.deleted.filter((entry) => entry.table.startsWith('native_workflow_'));
  assert.equal(runtimeCounts.length, 6);
  assert.ok(runtimeCounts.every((entry) => entry.count === 1));
  assert.equal(await runtimeStore.get(enterpriseId, submitted.taskId), null);
  assert.equal(await createNativeRuntimeStores(enterpriseId).runStore.get(liveRun.binding.runId), null);
  assert.ok((await createNativeRuntimeStores(mainTenant).runStore.list()).length > 0);
  assert.equal((await createFileWorkflowRunStore({ rootDir: runDir }).get(liveRun.binding.runId))?.status, 'unknown');
  assert.equal((await runtime.get(enterpriseId, submitted.taskId))?.lastError?.code, 'external_outcome_unknown');
  const purged = await withPlatformTransaction((tx) => new TenantEnterpriseResetRepository(tx).purge(BigInt(enterpriseId)));
  assert.equal(purged.enterpriseDeleted, true);
  assert.equal(purged.deleted.find((entry) => entry.table === 'enterprises')?.count, 1);
});
