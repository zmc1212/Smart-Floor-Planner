import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import type { PoolClient } from 'pg';
import { compileDefinition, type CompiledWorkflowPlan } from '../compile';
import { resolveStageReminderBusinessEvent } from '../live/business-event';
import { createConstructionStageReminderPorts } from '../live/construction-ports';
import {
  LiveOperationFailure,
  type LiveBusinessEvent,
  type LiveOperationPorts,
  type LiveRunContext,
} from '../live/types';
import { createWorkflowService } from '../service';
import { createMemoryWorkflowStore } from '../store/memory-store';
import type { PublishedWorkflowVersion } from '../store/types';
import type { PendingOperation, WorkflowValue } from '../types';
import { closePostgresPool } from '@/lib/postgresql';

const APP_URL = process.env.B4_LIVE_APP_DATABASE_URL;
const FIXTURE_URL = process.env.B4_LIVE_FIXTURE_DATABASE_URL;
const SKIP = APP_URL && FIXTURE_URL
  ? false
  : 'set B4_LIVE_APP_DATABASE_URL and B4_LIVE_FIXTURE_DATABASE_URL to run the live integration test';

const ENTERPRISE_ID = '1454';
const CUSTOMER_USER_ID = '1454000002';
const MANAGER_ADMIN_ID = '1454000007';
const WORKER_ADMIN_ID = '1454000008';
const OBSERVER_ADMIN_ID = '1454000009';
const STAGE_KEY = 'plumbing';
const STAGE_LABEL = '水路';

// Dedicated rows for this test; the shared fixture project (1454000004) is untouched.
const TARGET = { lead: '1454900003', project: '1454900004', conversation: '1454900005', participant: '1454900006' };
const CONTROL = { lead: '1454900013', project: '1454900014', conversation: '1454900015', participant: '1454900016' };
const PROJECT_IDS = [TARGET.project, CONTROL.project];
const CONVERSATION_IDS = [TARGET.conversation, CONTROL.conversation];

const triggerEvent = {
  eventId: 'b4-live-it-stage-0001',
  eventType: 'stage_changed' as const,
  occurredAt: '2026-11-11T13:00:00.000Z',
  stageKey: STAGE_KEY,
  stageLabel: STAGE_LABEL,
};

interface UsageSnapshot {
  usage: number;
  attempts: number;
}

let owner: pg.Pool;
let published: PublishedWorkflowVersion;
let plan: CompiledWorkflowPlan;
let composedBody: string;
let usageBefore: UsageSnapshot;

function businessEvent(): LiveBusinessEvent {
  return {
    outboxEventId: null,
    progressRevision: 0,
    stageKey: STAGE_KEY,
    settingsVersion: 1,
    source: 'current_project_revision',
  };
}

function contextFor(projectId: string, event: LiveBusinessEvent): LiveRunContext {
  return {
    runId: `b4-live-it-${projectId}`,
    definitionId: published.definition.definitionId,
    revision: published.revision,
    digest: published.digest,
    nodeVersions: published.nodeVersions,
    event: triggerEvent,
    businessEvent: event,
    enterpriseId: ENTERPRISE_ID,
    projectId,
  };
}

function operation(plan: CompiledWorkflowPlan, nodeId: string, input: Readonly<Record<string, WorkflowValue>> = {}): PendingOperation {
  const node = plan.nodes[nodeId];
  assert.ok(node, `compiled plan is missing ${nodeId}`);
  assert.notEqual(node.effect, 'none', `${nodeId} must have a live effect`);
  return {
    nodeId: node.nodeId,
    nodeType: node.type,
    capabilityRef: node.capabilityRef,
    nodeVersion: node.nodeVersion,
    effect: node.effect as PendingOperation['effect'],
    input,
    mode: 'live',
    simulation: false,
    idempotencyKey: `live-integration:${nodeId}`,
  };
}

function portsFor(adminId: string): LiveOperationPorts {
  return createConstructionStageReminderPorts({
    actor: { enterpriseId: ENTERPRISE_ID, adminId },
    knowledge: 'off',
  });
}

async function readContext(ports: LiveOperationPorts, context: LiveRunContext) {
  return ports.execute(operation(plan, 'read-context', { stageKey: STAGE_KEY }), context);
}

async function saveReminder(ports: LiveOperationPorts, context: LiveRunContext, body: string) {
  return ports.execute(operation(plan, 'save-deterministic', { title: '阶段提醒', body }), context);
}

async function deliverReminder(
  ports: LiveOperationPorts,
  context: LiveRunContext,
  receivers: WorkflowValue,
  body: string,
) {
  return ports.execute(
    operation(plan, 'deliver-deterministic', { receivers, title: '阶段提醒', body }),
    context,
  );
}

async function countRows(sql: string, params: unknown[] = []): Promise<number> {
  const result = await owner.query<{ count: string }>(sql, params);
  return Number(result.rows[0]?.count ?? 0);
}

async function targetOutboxCount() {
  return countRows(
    `select count(*)::text as count from app.domain_event_outbox
     where enterprise_id=$1::bigint and type='construction.stage.updated.v1'
       and aggregate_type='construction_project' and aggregate_id=$2`,
    [ENTERPRISE_ID, TARGET.project],
  );
}

async function usageSnapshot(): Promise<UsageSnapshot> {
  const [usage, attempts] = await Promise.all([
    countRows('select count(*)::text as count from app.assistant_usage_records where enterprise_id=$1::bigint', [ENTERPRISE_ID]),
    countRows('select count(*)::text as count from app.ai_provider_attempts where enterprise_id=$1::bigint', [ENTERPRISE_ID]),
  ]);
  return { usage, attempts };
}

async function cleanup(client: PoolClient): Promise<void> {
  await client.query(
    `delete from app.assistant_messages where enterprise_id=$1::bigint and conversation_id = any($2::bigint[])`,
    [ENTERPRISE_ID, CONVERSATION_IDS],
  );
  await client.query(
    `delete from app.domain_event_deliveries where enterprise_id=$1::bigint and event_id in (
       select id from app.domain_event_outbox
       where enterprise_id=$1::bigint and aggregate_id = any($2::text[]))`,
    [ENTERPRISE_ID, PROJECT_IDS],
  );
  await client.query(
    `delete from app.construction_links where enterprise_id=$1::bigint and project_id = any($2::bigint[])`,
    [ENTERPRISE_ID, PROJECT_IDS],
  );
  await client.query(
    `delete from app.construction_audits where enterprise_id=$1::bigint and project_id = any($2::bigint[])`,
    [ENTERPRISE_ID, PROJECT_IDS],
  );
  await client.query(
    `delete from app.domain_event_outbox
     where enterprise_id=$1::bigint and aggregate_type='construction_project' and aggregate_id = any($2::text[])`,
    [ENTERPRISE_ID, PROJECT_IDS],
  );
  await client.query(
    `delete from app.assistant_participants where enterprise_id=$1::bigint and conversation_id = any($2::bigint[])`,
    [ENTERPRISE_ID, CONVERSATION_IDS],
  );
  await client.query(
    `delete from app.assistant_conversations where enterprise_id=$1::bigint and id = any($2::bigint[])`,
    [ENTERPRISE_ID, CONVERSATION_IDS],
  );
  await client.query(
    `delete from app.construction_members where enterprise_id=$1::bigint and project_id = any($2::bigint[])`,
    [ENTERPRISE_ID, PROJECT_IDS],
  );
  await client.query(
    `delete from app.construction_projects where enterprise_id=$1::bigint and id = any($2::bigint[])`,
    [ENTERPRISE_ID, PROJECT_IDS],
  );
  await client.query(
    `delete from app.leads where enterprise_id=$1::bigint and id = any($2::bigint[])`,
    [ENTERPRISE_ID, [TARGET.lead, CONTROL.lead]],
  );
}

async function insertProjectRows(
  client: PoolClient,
  project: { lead: string; project: string; conversation: string; participant: string },
  title: string,
): Promise<void> {
  await client.query(
    `insert into app.leads(id,enterprise_id,name,phone,community_name,city,source,status,customer_user_id,archived_at)
     overriding system value
     values($1::bigint,$2::bigint,$3,'13800001454','[B4] 集成测试小区','杭州','b4-live','new',$4::bigint,null)`,
    [project.lead, ENTERPRISE_ID, `[B4] 集成测试客户 ${title}`, CUSTOMER_USER_ID],
  );
  await client.query(
    `insert into app.construction_projects(id,enterprise_id,lead_id,name,status,customer_access,version,
       current_stage_key,progress_note,progress_revision,stage_contacts)
     overriding system value
     values($1::bigint,$2::bigint,$3::bigint,$4,'active',true,1,$5,'',0,'{}'::jsonb)`,
    [project.project, ENTERPRISE_ID, project.lead, `[B4] 集成测试项目 ${title}`, STAGE_KEY],
  );
  for (const member of [
    { id: MANAGER_ADMIN_ID, role: 'manager' },
    { id: WORKER_ADMIN_ID, role: 'worker' },
    { id: OBSERVER_ADMIN_ID, role: 'observer' },
  ]) {
    await client.query(
      `insert into app.construction_members(enterprise_id,project_id,admin_id,role,active,work_label)
       values($1::bigint,$2::bigint,$3::bigint,$4,true,'[B4] 集成测试权限')`,
      [ENTERPRISE_ID, project.project, member.id, member.role],
    );
  }
  await client.query(
    `insert into app.assistant_conversations(id,enterprise_id,purpose,status,mode,title,entry_snapshot,
       policy_version,context_revision,last_seq)
     overriding system value
     values($1::bigint,$2::bigint,'customer_consultation','open','ai',$3,$4::jsonb,1,1,0)`,
    [
      project.conversation,
      ENTERPRISE_ID,
      `[B4] 集成测试会话 ${title}`,
      JSON.stringify({ kind: 'lead', id: project.lead, label: `[B4] 集成测试会话 ${title}` }),
    ],
  );
  await client.query(
    `insert into app.assistant_participants(id,enterprise_id,conversation_id,principal_kind,user_id,admin_id,
       participant_role,grant_basis,status)
     overriding system value
     values($1::bigint,$2::bigint,$3::bigint,'user',$4::bigint,null,'owner',$5::jsonb,'active')`,
    [
      project.participant,
      ENTERPRISE_ID,
      project.conversation,
      CUSTOMER_USER_ID,
      JSON.stringify({ kind: 'self', contextVersion: 1 }),
    ],
  );
}

async function setMemberRole(projectId: string, adminId: string, role: string): Promise<void> {
  await owner.query(
    `update app.construction_members set role=$4
     where enterprise_id=$1::bigint and project_id=$2::bigint and admin_id=$3::bigint`,
    [ENTERPRISE_ID, projectId, adminId, role],
  );
}

async function memberRole(projectId: string, adminId: string): Promise<string | null> {
  const result = await owner.query<{ role: string }>(
    `select role from app.construction_members
     where enterprise_id=$1::bigint and project_id=$2::bigint and admin_id=$3::bigint`,
    [ENTERPRISE_ID, projectId, adminId],
  );
  return result.rows[0]?.role ?? null;
}

async function assertTargetCounts(outbox: number, deliveries: number, messages: number): Promise<void> {
  assert.equal(await targetOutboxCount(), outbox, `target outbox count should be ${outbox}`);
  const deliveryCount = await countRows(
    `select count(*)::text as count from app.domain_event_deliveries d
     join app.domain_event_outbox e on e.enterprise_id=d.enterprise_id and e.id=d.event_id
     where d.enterprise_id=$1::bigint and e.aggregate_id=$2`,
    [ENTERPRISE_ID, TARGET.project],
  );
  assert.equal(deliveryCount, deliveries, `target delivery count should be ${deliveries}`);
  const messageCount = await countRows(
    `select count(*)::text as count from app.assistant_messages
     where enterprise_id=$1::bigint and conversation_id=$2::bigint and purpose='construction.stage'`,
    [ENTERPRISE_ID, TARGET.conversation],
  );
  assert.equal(messageCount, messages, `target message count should be ${messages}`);
}

describe('B4 live construction stage-reminder adapter', { skip: SKIP }, () => {
  before(async () => {
    process.env.DATABASE_URL = APP_URL;
    owner = new pg.Pool({ connectionString: FIXTURE_URL, max: 2 });
    const client = await owner.connect();
    try {
      // The shared fixture must be present before any dedicated rows are written.
      const fixture = await client.query<{
        enterprise: string | null;
        customer: string | null;
        manager: string | null;
        worker: string | null;
        observer: string | null;
        settings_version: number | null;
        plumbing: { visitReminder?: boolean } | null;
        assistant_enabled: boolean | null;
      }>(
        `select
           (select id::text from app.enterprises where id=$1::bigint and status='active') as enterprise,
           (select id::text from app.users where enterprise_id=$1::bigint and id=$2::bigint) as customer,
           (select id::text from app.admin_users where enterprise_id=$1::bigint and id=$3::bigint and status='active' and must_change_password=false) as manager,
           (select id::text from app.admin_users where enterprise_id=$1::bigint and id=$4::bigint and status='active' and must_change_password=false) as worker,
           (select id::text from app.admin_users where enterprise_id=$1::bigint and id=$5::bigint and status='active' and must_change_password=false) as observer,
           (select version from app.construction_stage_settings where enterprise_id=$1::bigint) as settings_version,
           (select s from app.construction_stage_settings x, jsonb_array_elements(x.stages) s
             where x.enterprise_id=$1::bigint and s->>'key'=$6 limit 1) as plumbing,
           (select enabled from app.assistant_enterprise_settings where enterprise_id=$1::bigint) as assistant_enabled`,
        [ENTERPRISE_ID, CUSTOMER_USER_ID, MANAGER_ADMIN_ID, WORKER_ADMIN_ID, OBSERVER_ADMIN_ID, STAGE_KEY],
      );
      const row = fixture.rows[0];
      assert.ok(row, 'shared B4 live fixture is missing');
      assert.ok(row.enterprise, 'fixture enterprise 1454 is missing or inactive');
      assert.ok(row.customer, 'fixture customer 1454000002 is missing');
      assert.ok(row.manager && row.worker && row.observer, 'fixture staff admins are missing');
      assert.equal(Number(row.settings_version), 1, 'fixture stage settings version should be 1');
      assert.equal(row.plumbing?.visitReminder, true, 'plumbing stage must enable visitReminder');
      assert.equal(row.assistant_enabled, true, 'assistant enterprise settings must be enabled');

      await client.query('begin');
      try {
        await cleanup(client);
        await insertProjectRows(client, TARGET, '目标');
        await insertProjectRows(client, CONTROL, '控制');
        const controlEvent = await client.query<{ id: string }>(
          `insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,
             actor_ref,correlation_id,payload)
           values($1::bigint,'construction.stage.updated.v1','construction_project',$2,0,
             '{"kind":"admin","id":"1454000001"}'::jsonb,$2,
             jsonb_build_object('projectId',$2::text,'stageKey',$3::text,'settingsVersion',1,'text','控制项目阶段提醒'))
           returning id`,
          [ENTERPRISE_ID, CONTROL.project, STAGE_KEY],
        );
        assert.ok(controlEvent.rows[0]?.id, 'control pending outbox event was not inserted');
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    } finally {
      client.release();
    }

    const service = createWorkflowService({ store: createMemoryWorkflowStore() });
    await service.createFromTemplate('stage-reminder');
    const result = await service.publishDraft({ definitionId: 'stage-reminder', expectedDraftRevision: 1 });
    published = result.version;
    plan = compileDefinition(published.definition);
    const compose = published.definition.nodes.find((node) => node.nodeId === 'compose-deterministic');
    const template = String(compose?.config?.template ?? '');
    assert.ok(template.includes('{{stageLabel}}'), 'deterministic compose template is missing the stage label');
    composedBody = template.replace('{{stageLabel}}', STAGE_LABEL);
    usageBefore = await usageSnapshot();
  });

  after(async () => {
    const client = await owner.connect();
    try {
      await client.query('begin');
      try {
        await cleanup(client);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    } finally {
      client.release();
      await owner.end();
      await closePostgresPool();
    }
  });

  it('worker and observer can read the project context but cannot save a reminder', async () => {
    for (const adminId of [WORKER_ADMIN_ID, OBSERVER_ADMIN_ID]) {
      const ports = portsFor(adminId);
      const context = contextFor(TARGET.project, businessEvent());
      const read = await readContext(ports, context);
      assert.equal(read.stageKnown, true);
      assert.equal(read.subscribed, true);
      assert.equal(read.receiverCount, 1);
      const receivers = read.receivers as Record<string, string>;
      assert.equal(receivers.scope, 'customer_conversation');
      assert.equal(receivers.projectId, TARGET.project);
      assert.equal(receivers.conversationId, TARGET.conversation);
      assert.equal(receivers.customerUserId, CUSTOMER_USER_ID);

      await assert.rejects(
        () => saveReminder(ports, context, composedBody),
        (error: unknown) => error instanceof LiveOperationFailure
          && error.issue.code === 'construction_forbidden',
        `admin ${adminId} must not write a stage reminder`,
      );
      assert.equal(await targetOutboxCount(), 0, 'a forbidden save must not create an outbox row');
    }
  });

  it('manager read, save and delivery create exactly one outbox, delivery and message', async () => {
    const ports = portsFor(MANAGER_ADMIN_ID);
    const context = contextFor(TARGET.project, businessEvent());
    const read = await readContext(ports, context);
    assert.equal(read.subscribed, true);
    const receivers = read.receivers as Record<string, string>;
    assert.equal(receivers.conversationId, TARGET.conversation);
    assert.equal(receivers.customerUserId, CUSTOMER_USER_ID);

    const saved = await saveReminder(ports, context, composedBody);
    assert.equal(saved.saved, true);
    const saveReceipt = saved.saveReceipt as Record<string, unknown>;
    assert.equal(saveReceipt.simulated, false);
    assert.equal(saveReceipt.source, 'domain_event_outbox');
    assert.equal(saveReceipt.progressRevision, 0);
    assert.equal(saveReceipt.reused, false);
    assert.match(String(saveReceipt.eventId), /^\d+$/);
    assert.equal(await targetOutboxCount(), 1);

    const delivered = await deliverReminder(ports, context, read.receivers as WorkflowValue, composedBody);
    assert.equal(delivered.delivered, true);
    const deliveryReceipt = delivered.deliveryReceipt as Record<string, unknown>;
    assert.equal(deliveryReceipt.status, 'delivered');
    assert.match(String(deliveryReceipt.receiptId), /^\d+$/);
    assert.match(String(deliveryReceipt.messageId), /^\d+$/);
    assert.equal(deliveryReceipt.conversationId, TARGET.conversation);
    assert.equal(deliveryReceipt.progressRevision, 0);

    await assertTargetCounts(1, 1, 1);
  });

  it('a manager demoted after read cannot save', async () => {
    const ports = portsFor(MANAGER_ADMIN_ID);
    const context = contextFor(TARGET.project, businessEvent());
    const read = await readContext(ports, context);
    assert.equal(read.subscribed, true);

    await setMemberRole(TARGET.project, MANAGER_ADMIN_ID, 'worker');
    try {
      assert.equal(await memberRole(TARGET.project, MANAGER_ADMIN_ID), 'worker');
      await assert.rejects(
        () => saveReminder(ports, context, composedBody),
        (error: unknown) => error instanceof LiveOperationFailure
          && error.issue.code === 'construction_forbidden',
      );
      assert.equal(await targetOutboxCount(), 1, 'a demoted manager must not create another outbox row');
    } finally {
      await setMemberRole(TARGET.project, MANAGER_ADMIN_ID, 'manager');
    }
    assert.equal(await memberRole(TARGET.project, MANAGER_ADMIN_ID), 'manager');
  });

  it('a manager demoted after save cannot deliver', async () => {
    const ports = portsFor(MANAGER_ADMIN_ID);
    const context = contextFor(TARGET.project, businessEvent());
    const read = await readContext(ports, context);
    const saved = await saveReminder(ports, context, composedBody);
    assert.equal(saved.saved, true);

    await setMemberRole(TARGET.project, MANAGER_ADMIN_ID, 'worker');
    try {
      await assert.rejects(
        () => deliverReminder(ports, context, read.receivers as WorkflowValue, composedBody),
        (error: unknown) => error instanceof LiveOperationFailure
          && error.issue.code === 'construction_forbidden',
      );
      await assertTargetCounts(1, 1, 1);
    } finally {
      await setMemberRole(TARGET.project, MANAGER_ADMIN_ID, 'manager');
    }
    assert.equal(await memberRole(TARGET.project, MANAGER_ADMIN_ID), 'manager');
  });

  it('note-only progress revisions reuse the original event without new effects', async () => {
    const original = await owner.query<{ id: string; created_at: string; aggregate_version: number }>(
      `select id, created_at, aggregate_version from app.domain_event_outbox
       where enterprise_id=$1::bigint and type='construction.stage.updated.v1'
         and aggregate_type='construction_project' and aggregate_id=$2
       order by aggregate_version limit 1`,
      [ENTERPRISE_ID, TARGET.project],
    );
    const event = original.rows[0];
    assert.ok(event, 'the manager save should have created the original outbox event');
    assert.equal(Number(event.aggregate_version), 0);

    await owner.query(
      `insert into app.construction_audits(enterprise_id,project_id,actor_ref,action,snapshot,created_at)
       values($1::bigint,$2::bigint,$3::jsonb,'progress',$4::jsonb,
         (select created_at from app.domain_event_outbox where enterprise_id=$1::bigint and id=$5::bigint))`,
      [
        ENTERPRISE_ID,
        TARGET.project,
        JSON.stringify({ kind: 'admin', id: MANAGER_ADMIN_ID }),
        JSON.stringify({ stageKey: STAGE_KEY, expectedVersion: 1, sendReminder: false, note: '原备注' }),
        event.id,
      ],
    );
    await owner.query(
      `update app.construction_projects
       set version=2, progress_note='原备注', progress_revision=0, updated_at=now()
       where enterprise_id=$1::bigint and id=$2::bigint`,
      [ENTERPRISE_ID, TARGET.project],
    );
    await owner.query(
      `insert into app.construction_audits(enterprise_id,project_id,actor_ref,action,snapshot)
       values($1::bigint,$2::bigint,$3::jsonb,'progress',$4::jsonb)`,
      [
        ENTERPRISE_ID,
        TARGET.project,
        JSON.stringify({ kind: 'admin', id: MANAGER_ADMIN_ID }),
        JSON.stringify({ stageKey: STAGE_KEY, expectedVersion: 2, sendReminder: false, note: '备注变化' }),
      ],
    );
    await owner.query(
      `update app.construction_projects
       set version=3, progress_note='备注变化', progress_revision=1, updated_at=now()
       where enterprise_id=$1::bigint and id=$2::bigint`,
      [ENTERPRISE_ID, TARGET.project],
    );

    const resolved = await resolveStageReminderBusinessEvent({
      actor: { enterpriseId: ENTERPRISE_ID, adminId: MANAGER_ADMIN_ID },
      projectId: TARGET.project,
      stageKey: STAGE_KEY,
      outboxEventId: event.id,
    });
    assert.equal(resolved.outboxEventId, String(event.id));
    assert.equal(resolved.progressRevision, 0);
    assert.equal(resolved.source, 'outbox');
    assert.equal(resolved.stageKey, STAGE_KEY);
    assert.equal(resolved.settingsVersion, 1);

    const ports = portsFor(MANAGER_ADMIN_ID);
    const context = contextFor(TARGET.project, resolved);
    const read = await readContext(ports, context);
    assert.equal(read.subscribed, true);
    const saved = await saveReminder(ports, context, composedBody);
    const saveReceipt = saved.saveReceipt as Record<string, unknown>;
    assert.equal(saveReceipt.eventId, String(event.id));
    assert.equal(saveReceipt.reused, true);

    const delivered = await deliverReminder(ports, context, read.receivers as WorkflowValue, composedBody);
    assert.equal(delivered.delivered, true);
    const deliveryReceipt = delivered.deliveryReceipt as Record<string, unknown>;
    assert.equal(deliveryReceipt.eventId, String(event.id));
    assert.equal(deliveryReceipt.status, 'delivered');

    await assertTargetCounts(1, 1, 1);
  });

  it('delivery stays scoped to the target event and conversation', async () => {
    const controlEvent = await owner.query<{ id: string }>(
      `select id from app.domain_event_outbox
       where enterprise_id=$1::bigint and aggregate_id=$2 and type='construction.stage.updated.v1'`,
      [ENTERPRISE_ID, CONTROL.project],
    );
    const controlEventId = controlEvent.rows[0]?.id;
    assert.ok(controlEventId, 'the control outbox event is missing');

    assert.equal(
      await countRows(
        `select count(*)::text as count from app.domain_event_deliveries
         where enterprise_id=$1::bigint and event_id=$2::bigint`,
        [ENTERPRISE_ID, controlEventId],
      ),
      0,
      'the control event must have no delivery',
    );
    assert.equal(
      await countRows(
        `select count(*)::text as count from app.assistant_messages
         where enterprise_id=$1::bigint and conversation_id=$2::bigint and purpose='construction.stage'`,
        [ENTERPRISE_ID, CONTROL.conversation],
      ),
      0,
      'the control conversation must have no stage reminder message',
    );
  });

  it('persists real outbox, delivery and message rows without model usage', async () => {
    const outbox = await owner.query<{ id: string; aggregate_version: number; payload: Record<string, unknown> }>(
      `select id, aggregate_version, payload from app.domain_event_outbox
       where enterprise_id=$1::bigint and type='construction.stage.updated.v1'
         and aggregate_type='construction_project' and aggregate_id=$2
       order by aggregate_version`,
      [ENTERPRISE_ID, TARGET.project],
    );
    assert.equal(outbox.rows.length, 1);
    const event = outbox.rows[0];
    assert.match(String(event.id), /^\d+$/);
    assert.equal(Number(event.aggregate_version), 0);
    assert.equal(event.payload.stageKey, STAGE_KEY);
    assert.equal(event.payload.text, composedBody);

    const deliveries = await owner.query<{ id: string; event_id: string; status: string }>(
      `select id, event_id, status from app.domain_event_deliveries
       where enterprise_id=$1::bigint and event_id=$2::bigint`,
      [ENTERPRISE_ID, event.id],
    );
    assert.equal(deliveries.rows.length, 1);
    const delivery = deliveries.rows[0];
    assert.match(String(delivery.id), /^\d+$/);
    assert.equal(String(delivery.event_id), String(event.id));
    assert.equal(delivery.status, 'delivered');

    const messages = await owner.query<{ id: string; content: { blocks: Array<{ text?: string }> }; source_event_id: string }>(
      `select id, content, source_event_id from app.assistant_messages
       where enterprise_id=$1::bigint and conversation_id=$2::bigint and purpose='construction.stage'`,
      [ENTERPRISE_ID, TARGET.conversation],
    );
    assert.equal(messages.rows.length, 1);
    const message = messages.rows[0];
    assert.match(String(message.id), /^\d+$/);
    assert.equal(String(message.source_event_id), String(event.id));
    assert.equal(message.content.blocks[0]?.text, composedBody);

    const usageAfter = await usageSnapshot();
    assert.deepEqual(usageAfter, usageBefore, 'the knowledge-off adapter must not create model usage or provider attempts');
  });
});
