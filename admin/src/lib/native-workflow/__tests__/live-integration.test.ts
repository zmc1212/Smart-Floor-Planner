import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import type { PoolClient } from 'pg';
import { one } from '@/db/repositories/assistant-repository';
import { withTenantTransaction } from '@/db/transaction';
import type { ActorContext } from '@/lib/assistant/contracts';
import type { ConstructionActor } from '@/lib/construction/contracts';
import { deliverStageReminderToConversation } from '@/lib/construction/reminders';
import { readStageSettings } from '@/lib/construction/stages-store';
import { closePostgresPool, getPostgresPool } from '@/lib/postgresql';
import { compileDefinition, type CompiledWorkflowPlan } from '../compile';
import { WorkflowOperationError } from '../errors';
import { resolveStageReminderBusinessEvent } from '../live/business-event';
import { createConstructionStageReminderPorts } from '../live/construction-ports';
import {
  assertB4ConnectionIdentity,
  resolveB4DatabaseTarget,
  type B4LiveDatabaseTarget,
} from '../live/dev-config';
import {
  INTEGRATION_MARKER,
  assertFixtureRowsOwned,
  runOwnedCleanup,
  runSharedFixturePreflight,
  type FixtureRowOwnership,
} from '../live/fixture-ownership';
import {
  LiveOperationFailure,
  type LiveBusinessEvent,
  type LiveOperationPorts,
  type LiveRunContext,
} from '../live/types';
import { createWorkflowService } from '../service';
import { createMemoryWorkflowStore } from '../store/memory-store';
import type { PublishedWorkflowVersion } from '../store/types';
import type { PendingOperation, TriggerEvent, WorkflowValue } from '../types';

const HAS_B4_URLS = Boolean(process.env.B4_LIVE_APP_DATABASE_URL?.trim())
  && Boolean(process.env.B4_LIVE_FIXTURE_DATABASE_URL?.trim());
const SKIP = HAS_B4_URLS
  ? false
  : 'set B4_LIVE_APP_DATABASE_URL and B4_LIVE_FIXTURE_DATABASE_URL to run the live integration test';

// Both URLs go through the shared resolver; DATABASE_URL is written from the
// resolved app target and is never read back as the source of truth. The real
// environment and argv are used so the operator must opt in explicitly with
// B4_LIVE_DEVELOPMENT=1; this suite never sets the opt-in itself.
const appTarget: B4LiveDatabaseTarget | null = HAS_B4_URLS
  ? resolveB4DatabaseTarget({ purpose: 'app' })
  : null;
const fixtureTarget: B4LiveDatabaseTarget | null = HAS_B4_URLS
  ? resolveB4DatabaseTarget({ purpose: 'fixture' })
  : null;

const ENTERPRISE_ID = '1454';
const CUSTOMER_USER_ID = '1454000002';
const MANAGER_ADMIN_ID = '1454000007';
const WORKER_ADMIN_ID = '1454000008';
const OBSERVER_ADMIN_ID = '1454000009';
const STAGE_KEY = 'plumbing';
const STAGE_LABEL = '水路';

// Dedicated rows for this test; the shared fixture project (1454000004) is untouched.
// The generic conversation keeps an id below every lead-bound conversation so the
// adapter's "latest matching conversation" lookup still selects the specific one.
const TARGET = { lead: '1454900003', project: '1454900004', conversation: '1454900005', participant: '1454900006' };
const CONTROL = { lead: '1454900013', project: '1454900014', conversation: '1454900015', participant: '1454900016' };
const CROSS = { lead: '1454900019', project: '1454900020', conversation: '1454900021', participant: '1454900022' };
const REGRESSION_A = { lead: '1454900031', project: '1454900032', conversation: '1454900033', participant: '1454900034' };
const REGRESSION_B = { lead: '1454900041', project: '1454900042', conversation: '1454900043', participant: '1454900044' };
const CROSS_CONVERSATION = { lead: '1454900051', project: '1454900052', conversation: '1454900053', participant: '1454900054' };
const GENERIC = { conversation: '1454900001', participant: '1454900002' };

const LEAD_IDS = [TARGET.lead, CONTROL.lead, CROSS.lead, REGRESSION_A.lead, REGRESSION_B.lead, CROSS_CONVERSATION.lead];
const PROJECT_IDS = [
  TARGET.project,
  CONTROL.project,
  CROSS.project,
  REGRESSION_A.project,
  REGRESSION_B.project,
  CROSS_CONVERSATION.project,
];
const CONVERSATION_IDS = [
  GENERIC.conversation,
  TARGET.conversation,
  CONTROL.conversation,
  CROSS.conversation,
  REGRESSION_A.conversation,
  REGRESSION_B.conversation,
  CROSS_CONVERSATION.conversation,
];
const PARTICIPANT_IDS = [
  GENERIC.participant,
  TARGET.participant,
  CONTROL.participant,
  CROSS.participant,
  REGRESSION_A.participant,
  REGRESSION_B.participant,
  CROSS_CONVERSATION.participant,
];

const integrationActor: ConstructionActor = { enterpriseId: ENTERPRISE_ID, adminId: MANAGER_ADMIN_ID };

const triggerEvent: TriggerEvent = {
  eventId: 'integration-evt-1',
  eventType: 'stage_changed',
  occurredAt: '2026-11-11T13:00:00.000Z',
  stageKey: STAGE_KEY,
  stageLabel: STAGE_LABEL,
};

const crossRunEvent: TriggerEvent = {
  eventId: 'integration-evt-2',
  eventType: 'stage_changed',
  occurredAt: '2026-11-11T14:00:00.000Z',
  stageKey: STAGE_KEY,
  stageLabel: STAGE_LABEL,
};

const followUpEvent: TriggerEvent = {
  eventId: 'integration-evt-3',
  eventType: 'stage_changed',
  occurredAt: '2026-11-11T15:00:00.000Z',
  stageKey: STAGE_KEY,
  stageLabel: STAGE_LABEL,
};

interface UsageSnapshot {
  usage: number;
  attempts: number;
}

let owner: pg.Pool | null = null;
let published: PublishedWorkflowVersion;
let plan: CompiledWorkflowPlan;
let composedBody: string;
let usageBefore: UsageSnapshot;
let originalStagesJson: string | null = null;
let preflightOk = false;
let ownedRows = false;
let resourcesClosed = false;

function ownerPool(): pg.Pool {
  assert.ok(owner, 'fixture pool is not connected');
  return owner;
}

function businessEvent(): LiveBusinessEvent {
  return {
    outboxEventId: null,
    progressRevision: 0,
    stageKey: STAGE_KEY,
    settingsVersion: 1,
    source: 'current_project_revision',
  };
}

function contextFor(
  projectId: string,
  event: LiveBusinessEvent,
  runId = `b4-live-it-${projectId}`,
  trigger: TriggerEvent = triggerEvent,
): LiveRunContext {
  return {
    runId,
    definitionId: published.definition.definitionId,
    revision: published.revision,
    digest: published.digest,
    nodeVersions: published.nodeVersions,
    event: trigger,
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

async function countRows(sqlText: string, params: unknown[] = []): Promise<number> {
  const result = await ownerPool().query<{ count: string }>(sqlText, params);
  return Number(result.rows[0]?.count ?? 0);
}

async function projectOutboxCount(projectId: string): Promise<number> {
  return countRows(
    `select count(*)::text as count from app.domain_event_outbox
     where enterprise_id=$1::bigint and type='construction.stage.updated.v1'
       and aggregate_type='construction_project' and aggregate_id=$2`,
    [ENTERPRISE_ID, projectId],
  );
}

async function projectDeliveryCount(projectId: string): Promise<number> {
  return countRows(
    `select count(*)::text as count from app.domain_event_deliveries d
     join app.domain_event_outbox e on e.enterprise_id=d.enterprise_id and e.id=d.event_id
     where d.enterprise_id=$1::bigint and e.aggregate_type='construction_project' and e.aggregate_id=$2`,
    [ENTERPRISE_ID, projectId],
  );
}

async function stageMessageCount(conversationId: string, eventId?: string): Promise<number> {
  if (eventId !== undefined) {
    return countRows(
      `select count(*)::text as count from app.assistant_messages
       where enterprise_id=$1::bigint and conversation_id=$2::bigint
         and purpose='construction.stage' and source_event_id=$3::bigint`,
      [ENTERPRISE_ID, conversationId, eventId],
    );
  }
  return countRows(
    `select count(*)::text as count from app.assistant_messages
     where enterprise_id=$1::bigint and conversation_id=$2::bigint and purpose='construction.stage'`,
    [ENTERPRISE_ID, conversationId],
  );
}

async function followUpMessageCount(conversationId: string): Promise<number> {
  return countRows(
    `select count(*)::text as count from app.assistant_messages
     where enterprise_id=$1::bigint and conversation_id=$2::bigint and purpose='construction.followup'`,
    [ENTERPRISE_ID, conversationId],
  );
}

async function deliveryCountForEvent(eventId: string): Promise<number> {
  return countRows(
    `select count(*)::text as count from app.domain_event_deliveries
     where enterprise_id=$1::bigint and event_id=$2::bigint`,
    [ENTERPRISE_ID, eventId],
  );
}

async function linkCount(projectId: string, conversationId: string): Promise<number> {
  return countRows(
    `select count(*)::text as count from app.construction_links
     where enterprise_id=$1::bigint and project_id=$2::bigint and conversation_id=$3::bigint`,
    [ENTERPRISE_ID, projectId, conversationId],
  );
}

async function crossCounts() {
  return {
    outbox: await projectOutboxCount(CROSS.project),
    deliveries: await projectDeliveryCount(CROSS.project),
    messages: await stageMessageCount(CROSS.conversation),
  };
}

async function usageSnapshot(): Promise<UsageSnapshot> {
  const [usage, attempts] = await Promise.all([
    countRows('select count(*)::text as count from app.assistant_usage_records where enterprise_id=$1::bigint', [ENTERPRISE_ID]),
    countRows('select count(*)::text as count from app.ai_provider_attempts where enterprise_id=$1::bigint', [ENTERPRISE_ID]),
  ]);
  return { usage, attempts };
}

async function closeResources(): Promise<void> {
  if (resourcesClosed) return;
  resourcesClosed = true;
  const pool = owner;
  owner = null;
  if (pool) await pool.end().catch(() => undefined);
  await closePostgresPool();
}

/**
 * Read every row this test could reuse. A fixed id is never ownership proof:
 * a present row must carry the integration marker (participants/memberships are
 * tied to a marked conversation/project).
 */
async function readPrimaryRows(client: PoolClient): Promise<FixtureRowOwnership[]> {
  const result = await client.query<{ table_name: string; id: string; marker: string | null }>(
    `select 'leads' as table_name, id::text as id, name as marker
       from app.leads where id = any($1::bigint[])
     union all
     select 'construction_projects', id::text, name
       from app.construction_projects where id = any($2::bigint[])
     union all
     select 'assistant_conversations', id::text, title
       from app.assistant_conversations where id = any($3::bigint[])
     union all
     select 'assistant_participants', id::text,
       case when conversation_id = any($3::bigint[]) then $5::text
         else 'foreign-conversation:' || conversation_id::text end
       from app.assistant_participants where id = any($4::bigint[])
     union all
     select 'construction_members', project_id::text || ':' || admin_id::text, $5::text
       from app.construction_members where project_id = any($2::bigint[])
     order by 1, 2`,
    [LEAD_IDS, PROJECT_IDS, CONVERSATION_IDS, PARTICIPANT_IDS, INTEGRATION_MARKER],
  );
  return result.rows.map((row) => ({
    table: row.table_name,
    id: row.id,
    marker: row.marker,
  }));
}

function markedIds(rows: readonly FixtureRowOwnership[], table: string): string[] {
  return rows
    .filter((row) => row.table === table && row.marker !== null && row.marker.startsWith(INTEGRATION_MARKER))
    .map((row) => row.id);
}

async function deleteOwnedRows(client: PoolClient, rows: readonly FixtureRowOwnership[]): Promise<void> {
  const leads = markedIds(rows, 'leads');
  const projects = markedIds(rows, 'construction_projects');
  const conversations = markedIds(rows, 'assistant_conversations');
  const participants = markedIds(rows, 'assistant_participants');
  const needPatterns = projects.map((id) => `${id}:%`);

  if (conversations.length) {
    await client.query(
      `delete from app.assistant_messages where enterprise_id=$1::bigint and conversation_id = any($2::bigint[])`,
      [ENTERPRISE_ID, conversations],
    );
  }
  if (projects.length) {
    await client.query(
      `delete from app.domain_event_deliveries
       where enterprise_id=$1::bigint and event_id in (
         select id from app.domain_event_outbox
         where enterprise_id=$1::bigint
           and ((aggregate_type='construction_project' and aggregate_id = any($2::text[]))
             or (aggregate_type='construction_need' and aggregate_id like any($3::text[]))) )`,
      [ENTERPRISE_ID, projects, needPatterns],
    );
  }
  if (projects.length || conversations.length) {
    await client.query(
      `delete from app.construction_links
       where enterprise_id=$1::bigint
         and (project_id = any($2::bigint[]) or conversation_id = any($3::bigint[]))`,
      [ENTERPRISE_ID, projects, conversations],
    );
  }
  if (projects.length) {
    await client.query(
      `delete from app.construction_audits where enterprise_id=$1::bigint and project_id = any($2::bigint[])`,
      [ENTERPRISE_ID, projects],
    );
    await client.query(
      `delete from app.domain_event_outbox
       where enterprise_id=$1::bigint
         and ((aggregate_type='construction_project' and aggregate_id = any($2::text[]))
           or (aggregate_type='construction_need' and aggregate_id like any($3::text[])))`,
      [ENTERPRISE_ID, projects, needPatterns],
    );
  }
  if (participants.length) {
    await client.query(
      `delete from app.assistant_participants where enterprise_id=$1::bigint and id = any($2::bigint[])`,
      [ENTERPRISE_ID, participants],
    );
  }
  if (conversations.length) {
    await client.query(
      `delete from app.assistant_conversations where enterprise_id=$1::bigint and id = any($2::bigint[])`,
      [ENTERPRISE_ID, conversations],
    );
  }
  if (projects.length) {
    await client.query(
      `delete from app.construction_members where enterprise_id=$1::bigint and project_id = any($2::bigint[])`,
      [ENTERPRISE_ID, projects],
    );
    await client.query(
      `delete from app.construction_projects where enterprise_id=$1::bigint and id = any($2::bigint[])`,
      [ENTERPRISE_ID, projects],
    );
  }
  if (leads.length) {
    await client.query(
      `delete from app.leads where enterprise_id=$1::bigint and id = any($2::bigint[])`,
      [ENTERPRISE_ID, leads],
    );
  }
}

/** Preflight, then delete only rows proved owned by this marker. */
async function preflightAndReset(client: PoolClient): Promise<void> {
  const rows = await readPrimaryRows(client);
  try {
    assertFixtureRowsOwned(rows, 'live-integration preflight');
  } catch (error) {
    preflightOk = false;
    throw error;
  }
  preflightOk = true;
  ownedRows = true;
  await runOwnedCleanup(preflightOk, ownedRows, () => deleteOwnedRows(client, rows));
}

async function insertProjectRows(
  client: PoolClient,
  project: { lead: string; project: string; conversation: string; participant: string },
  title: string,
): Promise<void> {
  await client.query(
    `insert into app.leads(id,enterprise_id,name,phone,community_name,city,source,status,customer_user_id,archived_at)
     overriding system value
     values($1::bigint,$2::bigint,$3,'13800001454',$4,'杭州','b4-live','new',$5::bigint,null)`,
    [project.lead, ENTERPRISE_ID, `${INTEGRATION_MARKER} 集成测试客户 ${title}`, `${INTEGRATION_MARKER} 集成测试小区`, CUSTOMER_USER_ID],
  );
  await client.query(
    `insert into app.construction_projects(id,enterprise_id,lead_id,name,status,customer_access,version,
       current_stage_key,progress_note,progress_revision,stage_contacts)
     overriding system value
     values($1::bigint,$2::bigint,$3::bigint,$4,'active',true,1,$5,'',0,'{}'::jsonb)`,
    [project.project, ENTERPRISE_ID, project.lead, `${INTEGRATION_MARKER} 集成测试项目 ${title}`, STAGE_KEY],
  );
  for (const member of [
    { id: MANAGER_ADMIN_ID, role: 'manager' },
    { id: WORKER_ADMIN_ID, role: 'worker' },
    { id: OBSERVER_ADMIN_ID, role: 'observer' },
  ]) {
    await client.query(
      `insert into app.construction_members(enterprise_id,project_id,admin_id,role,active,work_label)
       values($1::bigint,$2::bigint,$3::bigint,$4,true,$5)`,
      [ENTERPRISE_ID, project.project, member.id, member.role, `${INTEGRATION_MARKER} 集成测试权限`],
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
      `${INTEGRATION_MARKER} 集成测试会话 ${title}`,
      JSON.stringify({ kind: 'lead', id: project.lead, label: `${INTEGRATION_MARKER} 集成测试会话 ${title}` }),
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

async function insertGenericConversation(client: PoolClient): Promise<void> {
  await client.query(
    `insert into app.assistant_conversations(id,enterprise_id,purpose,status,mode,title,entry_snapshot,
       policy_version,context_revision,last_seq)
     overriding system value
     values($1::bigint,$2::bigint,'customer_consultation','open','ai',$3,$4::jsonb,1,1,0)`,
    [
      GENERIC.conversation,
      ENTERPRISE_ID,
      `${INTEGRATION_MARKER} 通用会话`,
      JSON.stringify({ kind: 'general', id: GENERIC.conversation, label: `${INTEGRATION_MARKER} 通用会话` }),
    ],
  );
  await client.query(
    `insert into app.assistant_participants(id,enterprise_id,conversation_id,principal_kind,user_id,admin_id,
       participant_role,grant_basis,status)
     overriding system value
     values($1::bigint,$2::bigint,$3::bigint,'user',$4::bigint,null,'owner',$5::jsonb,'active')`,
    [
      GENERIC.participant,
      ENTERPRISE_ID,
      GENERIC.conversation,
      CUSTOMER_USER_ID,
      JSON.stringify({ kind: 'self', contextVersion: 1 }),
    ],
  );
}

async function insertControlEvent(client: PoolClient): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,
       actor_ref,correlation_id,payload)
     values($1::bigint,'construction.stage.updated.v1','construction_project',$2,0,
       '{"kind":"admin","id":"1454000001"}'::jsonb,$2,
       jsonb_build_object('projectId',$2::text,'stageKey',$3::text,'settingsVersion',1,'text','控制项目阶段提醒'))
     returning id`,
    [ENTERPRISE_ID, CONTROL.project, STAGE_KEY],
  );
  assert.ok(result.rows[0]?.id, 'control pending outbox event was not inserted');
  return result.rows[0].id;
}

function stagePayload(projectId: string, text: string, sourceEventKey?: string): Record<string, unknown> {
  return {
    projectId,
    stageKey: STAGE_KEY,
    settingsVersion: 1,
    text,
    ...(sourceEventKey === undefined ? {} : { sourceEventKey }),
  };
}

async function insertStageEvent(projectId: string, aggregateVersion: number, payload: Record<string, unknown>): Promise<string> {
  const result = await ownerPool().query<{ id: string }>(
    `insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,
       actor_ref,correlation_id,payload)
     values($1::bigint,'construction.stage.updated.v1','construction_project',$2,$3,
       $4::jsonb,$2,$5::jsonb)
     returning id`,
    [
      ENTERPRISE_ID,
      projectId,
      aggregateVersion,
      JSON.stringify({ kind: 'admin', id: MANAGER_ADMIN_ID }),
      JSON.stringify(payload),
    ],
  );
  assert.ok(result.rows[0]?.id, 'stage event was not inserted');
  return String(result.rows[0].id);
}

async function controlEventId(): Promise<string> {
  const result = await ownerPool().query<{ id: string }>(
    `select id from app.domain_event_outbox
     where enterprise_id=$1::bigint and aggregate_id=$2 and type='construction.stage.updated.v1'`,
    [ENTERPRISE_ID, CONTROL.project],
  );
  assert.ok(result.rows[0]?.id, 'the control outbox event is missing');
  return result.rows[0].id;
}

async function setMemberRole(projectId: string, adminId: string, role: string): Promise<void> {
  await ownerPool().query(
    `update app.construction_members set role=$4
     where enterprise_id=$1::bigint and project_id=$2::bigint and admin_id=$3::bigint`,
    [ENTERPRISE_ID, projectId, adminId, role],
  );
}

async function memberRole(projectId: string, adminId: string): Promise<string | null> {
  const result = await ownerPool().query<{ role: string }>(
    `select role from app.construction_members
     where enterprise_id=$1::bigint and project_id=$2::bigint and admin_id=$3::bigint`,
    [ENTERPRISE_ID, projectId, adminId],
  );
  return result.rows[0]?.role ?? null;
}

async function assertTargetCounts(outbox: number, deliveries: number, messages: number): Promise<void> {
  assert.equal(await projectOutboxCount(TARGET.project), outbox, `target outbox count should be ${outbox}`);
  assert.equal(await projectDeliveryCount(TARGET.project), deliveries, `target delivery count should be ${deliveries}`);
  assert.equal(await stageMessageCount(TARGET.conversation), messages, `target message count should be ${messages}`);
}

function customerActor(): ActorContext {
  return {
    enterpriseId: ENTERPRISE_ID,
    principal: { kind: 'user', userId: CUSTOMER_USER_ID },
    contextVersion: 1,
    capabilities: [],
  };
}

/** Call the real delivery service directly so a specific conversation can be targeted. */
async function deliverDirect(projectId: string, eventId: string, conversationId: string) {
  return withTenantTransaction(ENTERPRISE_ID, async (tx) => {
    const project = await one(tx, sql`select * from app.construction_projects
      where enterprise_id=${ENTERPRISE_ID} and id=${projectId} for share`);
    const stageEvent = await one(tx, sql`select * from app.domain_event_outbox
      where enterprise_id=${ENTERPRISE_ID} and id=${eventId}`);
    const conversation = await one(tx, sql`select * from app.assistant_conversations
      where enterprise_id=${ENTERPRISE_ID} and id=${conversationId}`);
    assert.ok(project, `project ${projectId} is missing`);
    assert.ok(stageEvent, `stage event ${eventId} is missing`);
    assert.ok(conversation, `conversation ${conversationId} is missing`);
    const settings = await readStageSettings(tx, ENTERPRISE_ID);
    return deliverStageReminderToConversation(tx, customerActor(), project, stageEvent, conversation, settings);
  });
}

async function setPlumbingFollowUps(followUps: unknown[]): Promise<void> {
  const current = await ownerPool().query<{ stages: Array<Record<string, unknown>> }>(
    'select stages from app.construction_stage_settings where enterprise_id=$1::bigint',
    [ENTERPRISE_ID],
  );
  const stages = current.rows[0]?.stages;
  assert.ok(Array.isArray(stages), 'fixture stage settings are missing');
  const next = stages.map((stage) => (stage.key === STAGE_KEY ? { ...stage, followUps } : stage));
  await ownerPool().query(
    'update app.construction_stage_settings set stages=$2::jsonb where enterprise_id=$1::bigint',
    [ENTERPRISE_ID, JSON.stringify(next)],
  );
}

async function restoreStageSettings(): Promise<void> {
  if (!owner || originalStagesJson === null) return;
  await ownerPool().query(
    'update app.construction_stage_settings set stages=$2::jsonb where enterprise_id=$1::bigint',
    [ENTERPRISE_ID, originalStagesJson],
  );
}

describe('B4 live construction stage-reminder adapter', { skip: SKIP }, () => {
  before(async () => {
    const app = appTarget;
    const fixture = fixtureTarget;
    assert.ok(app && fixture, 'B4 database targets were not resolved');
    assert.equal(app.purpose, 'app');
    assert.equal(fixture.purpose, 'fixture');

    process.env.DATABASE_URL = app.url;
    owner = new pg.Pool({ connectionString: fixture.url, max: 2 });
    const client = await owner.connect();
    let setupError: unknown = null;
    try {
      const fixtureIdentity = await client.query<{ database: string; username: string }>(
        'select current_database() as database, current_user as username',
      );
      assertB4ConnectionIdentity(fixture, fixtureIdentity.rows[0]);

      const appIdentity = await getPostgresPool().query<{ database: string; username: string }>(
        'select current_database() as database, current_user as username',
      );
      assertB4ConnectionIdentity(app, appIdentity.rows[0]);

      // The shared fixture must keep its documented markers before any reset,
      // delete, insert or enterprise-level settings change below.
      await runSharedFixturePreflight(client, 'live-integration shared fixture');

      const fixtureRow = await client.query<{
        settings_version: number | null;
        plumbing: { visitReminder?: boolean } | null;
        assistant_enabled: boolean | null;
      }>(
        `select
           (select version from app.construction_stage_settings where enterprise_id=$1::bigint) as settings_version,
           (select s from app.construction_stage_settings x, jsonb_array_elements(x.stages) s
             where x.enterprise_id=$1::bigint and s->>'key'=$2 limit 1) as plumbing,
           (select enabled from app.assistant_enterprise_settings where enterprise_id=$1::bigint) as assistant_enabled`,
        [ENTERPRISE_ID, STAGE_KEY],
      );
      const row = fixtureRow.rows[0];
      assert.ok(row, 'shared B4 live fixture settings are missing');
      assert.equal(Number(row.settings_version), 1, 'fixture stage settings version should be 1');
      assert.equal(row.plumbing?.visitReminder, true, 'plumbing stage must enable visitReminder');
      assert.equal(row.assistant_enabled, true, 'assistant enterprise settings must be enabled');

      const stagesRow = await client.query<{ stages: unknown }>(
        'select stages from app.construction_stage_settings where enterprise_id=$1::bigint',
        [ENTERPRISE_ID],
      );
      assert.ok(stagesRow.rows[0]?.stages, 'fixture stage settings row is missing');
      originalStagesJson = JSON.stringify(stagesRow.rows[0].stages);

      await client.query('begin');
      try {
        await preflightAndReset(client);
        await insertProjectRows(client, TARGET, '目标');
        await insertProjectRows(client, CONTROL, '控制');
        await insertProjectRows(client, CROSS, '跨运行');
        await insertProjectRows(client, REGRESSION_A, '回归A');
        await insertProjectRows(client, REGRESSION_B, '回归B');
        await insertProjectRows(client, CROSS_CONVERSATION, '跨会话');
        await insertGenericConversation(client);
        await insertControlEvent(client);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error;
      }
    } catch (error) {
      setupError = error;
    } finally {
      client.release();
    }
    if (setupError) {
      // Release first, then close: ending a pool waits for checked-out clients.
      await closeResources();
      throw setupError;
    }

    const service = createWorkflowService({ store: createMemoryWorkflowStore() });
    await service.createFromTemplate('stage-reminder');
    const result = await service.publishDraft({ definitionId: 'stage-reminder', expectedDraftRevision: 1 });
    published = result.version;
    plan = compileDefinition(published.definition);
    const compose = published.definition.nodes.find((node) => node.nodeId === 'compose-deterministic');
    const template = String(compose?.config?.template ?? '');
    assert.ok(template.includes('{{stageLabel}}'), 'deterministic compose template is missing the host text port');
    composedBody = '「目标」当前施工已进入水路阶段。\n到现场重点看：打压记录。';
    usageBefore = await usageSnapshot();
  });

  after(async () => {
    if (!preflightOk || !owner) {
      // A failed preflight must not attempt any delete; only close resources.
      await closeResources();
      return;
    }
    await restoreStageSettings();
    const client = await ownerPool().connect();
    try {
      await client.query('begin');
      try {
        const rows = await readPrimaryRows(client);
        assertFixtureRowsOwned(rows, 'live-integration cleanup');
        await runOwnedCleanup(preflightOk, ownedRows, () => deleteOwnedRows(client, rows));
        await client.query('commit');
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error;
      }
    } finally {
      client.release();
      await closeResources();
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
      assert.equal(await projectOutboxCount(TARGET.project), 0, 'a forbidden save must not create an outbox row');
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
    assert.equal(await projectOutboxCount(TARGET.project), 1);

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
      assert.equal(await projectOutboxCount(TARGET.project), 1, 'a demoted manager must not create another outbox row');
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
    const original = await ownerPool().query<{ id: string; created_at: string; aggregate_version: number }>(
      `select id, created_at, aggregate_version from app.domain_event_outbox
       where enterprise_id=$1::bigint and type='construction.stage.updated.v1'
         and aggregate_type='construction_project' and aggregate_id=$2
       order by aggregate_version limit 1`,
      [ENTERPRISE_ID, TARGET.project],
    );
    const event = original.rows[0];
    assert.ok(event, 'the manager save should have created the original outbox event');
    assert.equal(Number(event.aggregate_version), 0);

    await ownerPool().query(
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
    await ownerPool().query(
      `update app.construction_projects
       set version=2, progress_note='原备注', progress_revision=0, updated_at=now()
       where enterprise_id=$1::bigint and id=$2::bigint`,
      [ENTERPRISE_ID, TARGET.project],
    );
    await ownerPool().query(
      `insert into app.construction_audits(enterprise_id,project_id,actor_ref,action,snapshot)
       values($1::bigint,$2::bigint,$3::jsonb,'progress',$4::jsonb)`,
      [
        ENTERPRISE_ID,
        TARGET.project,
        JSON.stringify({ kind: 'admin', id: MANAGER_ADMIN_ID }),
        JSON.stringify({ stageKey: STAGE_KEY, expectedVersion: 2, sendReminder: false, note: '备注变化' }),
      ],
    );
    await ownerPool().query(
      `update app.construction_projects
       set version=3, progress_note='备注变化', progress_revision=1, updated_at=now()
       where enterprise_id=$1::bigint and id=$2::bigint`,
      [ENTERPRISE_ID, TARGET.project],
    );

    const resolved = await resolveStageReminderBusinessEvent({
      actor: { enterpriseId: ENTERPRISE_ID, adminId: MANAGER_ADMIN_ID },
      projectId: TARGET.project,
      stageKey: STAGE_KEY,
      sourceEventKey: 'integration-evt-1',
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
    const controlEvent = await controlEventId();

    assert.equal(
      await deliveryCountForEvent(controlEvent),
      0,
      'the control event must have no delivery',
    );
    assert.equal(
      await stageMessageCount(CONTROL.conversation),
      0,
      'the control conversation must have no stage reminder message',
    );
  });

  it('persists real outbox, delivery and message rows without model usage', async () => {
    const outbox = await ownerPool().query<{ id: string; aggregate_version: number; payload: Record<string, unknown> }>(
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
    assert.equal(event.payload.sourceEventKey, 'integration-evt-1');
    assert.equal(event.payload.text, composedBody);

    const deliveries = await ownerPool().query<{ id: string; event_id: string; status: string }>(
      `select id, event_id, status from app.domain_event_deliveries
       where enterprise_id=$1::bigint and event_id=$2::bigint`,
      [ENTERPRISE_ID, event.id],
    );
    assert.equal(deliveries.rows.length, 1);
    const delivery = deliveries.rows[0];
    assert.match(String(delivery.id), /^\d+$/);
    assert.equal(String(delivery.event_id), String(event.id));
    assert.equal(delivery.status, 'delivered');

    const messages = await ownerPool().query<{ id: string; content: { blocks: Array<{ text?: string }> }; source_event_id: string }>(
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

  it('a note-only revision still resolves the original source event across runs', async () => {
    const firstBinding = await resolveStageReminderBusinessEvent({
      actor: integrationActor,
      projectId: CROSS.project,
      stageKey: STAGE_KEY,
      sourceEventKey: crossRunEvent.eventId,
    });
    assert.equal(firstBinding.source, 'current_project_revision');
    assert.equal(firstBinding.progressRevision, 0);

    const firstPorts = portsFor(MANAGER_ADMIN_ID);
    const firstContext = contextFor(CROSS.project, firstBinding, 'run-cross-1', crossRunEvent);
    const firstRead = await readContext(firstPorts, firstContext);
    assert.equal(firstRead.subscribed, true);
    const firstSaved = await saveReminder(firstPorts, firstContext, composedBody);
    assert.equal(firstSaved.saved, true);
    const firstReceipt = firstSaved.saveReceipt as Record<string, unknown>;
    assert.equal(firstReceipt.reused, false);
    const firstEventId = String(firstReceipt.eventId);
    assert.match(firstEventId, /^\d+$/);

    const stored = await ownerPool().query<{ aggregate_version: number; payload: Record<string, unknown> }>(
      'select aggregate_version, payload from app.domain_event_outbox where enterprise_id=$1::bigint and id=$2::bigint',
      [ENTERPRISE_ID, firstEventId],
    );
    assert.equal(Number(stored.rows[0]?.aggregate_version), 0);
    assert.equal(stored.rows[0]?.payload.sourceEventKey, crossRunEvent.eventId);

    const firstDelivered = await deliverReminder(firstPorts, firstContext, firstRead.receivers as WorkflowValue, composedBody);
    assert.equal(firstDelivered.delivered, true);
    const countsBefore = await crossCounts();
    assert.deepEqual(countsBefore, { outbox: 1, deliveries: 1, messages: 1 });

    // A note-only progress change increments the project revision but keeps the event current.
    await ownerPool().query(
      `insert into app.construction_audits(enterprise_id,project_id,actor_ref,action,snapshot,created_at)
       values($1::bigint,$2::bigint,$3::jsonb,'progress',$4::jsonb,
         (select created_at from app.domain_event_outbox where enterprise_id=$1::bigint and id=$5::bigint))`,
      [
        ENTERPRISE_ID,
        CROSS.project,
        JSON.stringify({ kind: 'admin', id: MANAGER_ADMIN_ID }),
        JSON.stringify({ stageKey: STAGE_KEY, expectedVersion: 1, sendReminder: false, note: '集成原备注' }),
        firstEventId,
      ],
    );
    await ownerPool().query(
      `update app.construction_projects
       set version=2, progress_note='集成原备注', progress_revision=0, updated_at=now()
       where enterprise_id=$1::bigint and id=$2::bigint`,
      [ENTERPRISE_ID, CROSS.project],
    );
    await ownerPool().query(
      `insert into app.construction_audits(enterprise_id,project_id,actor_ref,action,snapshot)
       values($1::bigint,$2::bigint,$3::jsonb,'progress',$4::jsonb)`,
      [
        ENTERPRISE_ID,
        CROSS.project,
        JSON.stringify({ kind: 'admin', id: MANAGER_ADMIN_ID }),
        JSON.stringify({ stageKey: STAGE_KEY, expectedVersion: 2, sendReminder: false, note: '集成备注变化' }),
      ],
    );
    await ownerPool().query(
      `update app.construction_projects
       set version=3, progress_note='集成备注变化', progress_revision=1, updated_at=now()
       where enterprise_id=$1::bigint and id=$2::bigint`,
      [ENTERPRISE_ID, CROSS.project],
    );
    const revision = await ownerPool().query<{ progress_revision: number }>(
      'select progress_revision from app.construction_projects where enterprise_id=$1::bigint and id=$2::bigint',
      [ENTERPRISE_ID, CROSS.project],
    );
    assert.equal(Number(revision.rows[0]?.progress_revision), 1);

    // No outboxEventId: the stable source key must find the original event, not revision 1.
    const resolved = await resolveStageReminderBusinessEvent({
      actor: integrationActor,
      projectId: CROSS.project,
      stageKey: STAGE_KEY,
      sourceEventKey: crossRunEvent.eventId,
    });
    assert.equal(resolved.source, 'outbox');
    assert.equal(resolved.outboxEventId, firstEventId);
    assert.equal(resolved.progressRevision, 0);
    assert.equal(resolved.settingsVersion, 1);

    const secondPorts = portsFor(MANAGER_ADMIN_ID);
    const secondContext = contextFor(CROSS.project, resolved, 'run-cross-2', crossRunEvent);
    const secondRead = await readContext(secondPorts, secondContext);
    assert.equal(secondRead.subscribed, true);
    const secondSaved = await saveReminder(secondPorts, secondContext, composedBody);
    assert.equal(secondSaved.saved, true);
    const secondReceipt = secondSaved.saveReceipt as Record<string, unknown>;
    assert.equal(secondReceipt.eventId, firstEventId);
    assert.equal(secondReceipt.reused, true);
    assert.equal(secondReceipt.progressRevision, 0);

    const secondDelivered = await deliverReminder(secondPorts, secondContext, secondRead.receivers as WorkflowValue, composedBody);
    assert.equal(secondDelivered.delivered, true);
    const secondReceiptDelivery = secondDelivered.deliveryReceipt as Record<string, unknown>;
    assert.equal(secondReceiptDelivery.eventId, firstEventId);
    assert.equal(secondReceiptDelivery.status, 'delivered');

    assert.deepEqual(await crossCounts(), countsBefore, 'a cross-run retry must not add outbox/delivery/message rows');
  });

  it('delivery re-checks assistant enabled after a save and keeps the saved outbox', async () => {
    const binding = await resolveStageReminderBusinessEvent({
      actor: integrationActor,
      projectId: CROSS.project,
      stageKey: STAGE_KEY,
      sourceEventKey: crossRunEvent.eventId,
    });
    const crossEvent = await ownerPool().query<{ id: string }>(
      `select id from app.domain_event_outbox where enterprise_id=$1::bigint
         and aggregate_id=$2 and type='construction.stage.updated.v1' order by aggregate_version limit 1`,
      [ENTERPRISE_ID, CROSS.project],
    );
    assert.equal(binding.outboxEventId, crossEvent.rows[0]?.id);

    const ports = portsFor(MANAGER_ADMIN_ID);
    const context = contextFor(CROSS.project, binding, 'run-delivery-disabled', crossRunEvent);
    const read = await readContext(ports, context);
    assert.equal(read.subscribed, true);
    const saved = await saveReminder(ports, context, composedBody);
    assert.equal(saved.saved, true);
    const countsBefore = await crossCounts();
    assert.deepEqual(countsBefore, { outbox: 1, deliveries: 1, messages: 1 });

    await ownerPool().query(
      'update app.assistant_enterprise_settings set enabled=false where enterprise_id=$1::bigint',
      [ENTERPRISE_ID],
    );
    try {
      const delivered = await deliverReminder(ports, context, read.receivers as WorkflowValue, composedBody);
      assert.equal(delivered.delivered, false);
      const receipt = delivered.deliveryReceipt as Record<string, unknown>;
      assert.equal(receipt.status, 'assistant_disabled');
      assert.equal(receipt.receiptId, '');
      assert.deepEqual(await crossCounts(), countsBefore, 'a disabled assistant must not add delivery/message rows');
      assert.equal(await projectOutboxCount(CROSS.project), 1, 'the saved outbox must remain');
    } finally {
      await ownerPool().query(
        'update app.assistant_enterprise_settings set enabled=true where enterprise_id=$1::bigint',
        [ENTERPRISE_ID],
      );
    }

    const restored = await ownerPool().query<{ enabled: boolean }>(
      'select enabled from app.assistant_enterprise_settings where enterprise_id=$1::bigint',
      [ENTERPRISE_ID],
    );
    assert.equal(restored.rows[0]?.enabled, true);
  });

  it('delivery re-checks the stage settings version after a save and keeps the saved outbox', async () => {
    const binding = await resolveStageReminderBusinessEvent({
      actor: integrationActor,
      projectId: CROSS.project,
      stageKey: STAGE_KEY,
      sourceEventKey: crossRunEvent.eventId,
    });
    const ports = portsFor(MANAGER_ADMIN_ID);
    const context = contextFor(CROSS.project, binding, 'run-delivery-settings', crossRunEvent);
    const read = await readContext(ports, context);
    assert.equal(read.subscribed, true);
    const saved = await saveReminder(ports, context, composedBody);
    assert.equal(saved.saved, true);
    const countsBefore = await crossCounts();
    assert.deepEqual(countsBefore, { outbox: 1, deliveries: 1, messages: 1 });

    await ownerPool().query(
      'update app.construction_stage_settings set version=2 where enterprise_id=$1::bigint',
      [ENTERPRISE_ID],
    );
    try {
      const delivered = await deliverReminder(ports, context, read.receivers as WorkflowValue, composedBody);
      assert.equal(delivered.delivered, false);
      const receipt = delivered.deliveryReceipt as Record<string, unknown>;
      assert.equal(receipt.status, 'settings_version_mismatch');
      assert.deepEqual(await crossCounts(), countsBefore, 'a settings mismatch must not add delivery/message rows');
      assert.equal(await projectOutboxCount(CROSS.project), 1, 'the saved outbox must remain');
    } finally {
      await ownerPool().query(
        'update app.construction_stage_settings set version=1 where enterprise_id=$1::bigint',
        [ENTERPRISE_ID],
      );
    }

    const restored = await ownerPool().query<{ version: number }>(
      'select version from app.construction_stage_settings where enterprise_id=$1::bigint',
      [ENTERPRISE_ID],
    );
    assert.equal(Number(restored.rows[0]?.version), 1);
  });

  it('restores follow-up and links for a lead-bound conversation without broad delivery', async () => {
    await setPlumbingFollowUps([{ field: 'style', room: '', question: '您希望家里整体是什么装修风格？' }]);
    try {
      // A new stage event for the target project at its current progress revision.
      const binding = await resolveStageReminderBusinessEvent({
        actor: integrationActor,
        projectId: TARGET.project,
        stageKey: STAGE_KEY,
        sourceEventKey: followUpEvent.eventId,
      });
      assert.equal(binding.source, 'current_project_revision');
      assert.equal(binding.progressRevision, 1);

      const ports = portsFor(MANAGER_ADMIN_ID);
      const context = contextFor(TARGET.project, binding, 'run-follow-up', followUpEvent);
      const read = await readContext(ports, context);
      assert.equal(read.subscribed, true);
      const saved = await saveReminder(ports, context, composedBody);
      assert.equal(saved.saved, true);
      const saveReceipt = saved.saveReceipt as Record<string, unknown>;
      assert.equal(saveReceipt.reused, false);
      const eventId = String(saveReceipt.eventId);
      assert.match(eventId, /^\d+$/);

      // A generic conversation spans several homes: the stage notice is delivered
      // but the ambiguous follow-up scope must be skipped.
      const genericDelivery = await deliverDirect(TARGET.project, eventId, GENERIC.conversation);
      assert.equal(genericDelivery.delivered, true);
      assert.equal(await stageMessageCount(GENERIC.conversation, eventId), 1, 'the generic conversation keeps the stage notice');
      assert.equal(await followUpMessageCount(GENERIC.conversation), 0, 'the generic scope must not append a follow-up');
      assert.equal(await linkCount(TARGET.project, GENERIC.conversation), 1);

      // The lead-bound conversation receives the follow-up and link, but never a
      // second stage message for the same event.
      const specificDelivery = await deliverDirect(TARGET.project, eventId, TARGET.conversation);
      assert.equal(specificDelivery.delivered, true);
      assert.equal(specificDelivery.messageId, genericDelivery.messageId);
      assert.equal(await stageMessageCount(TARGET.conversation, eventId), 0, 'no second stage message may be appended');
      assert.equal(await followUpMessageCount(TARGET.conversation), 1, 'the lead-bound scope must append the follow-up');
      assert.equal(await linkCount(TARGET.project, TARGET.conversation), 1);
      assert.equal(await stageMessageCount(GENERIC.conversation, eventId), 1, 'the original stage notice remains');

      // The control project's pending event shares the same customer/generic
      // scope but was never selected by the scoped delivery.
      const control = await controlEventId();
      assert.equal(await deliveryCountForEvent(control), 0, 'the control event must stay undelivered');
      assert.equal(await stageMessageCount(CONTROL.conversation, control), 0);
      assert.equal(await stageMessageCount(GENERIC.conversation, control), 0);
    } finally {
      await restoreStageSettings();
    }
  });

  it('rejects an explicit outbox event that would rebind an existing source event key', async () => {
    const sourceEventKey = 'regression-a-key';
    const event1 = await insertStageEvent(
      REGRESSION_A.project,
      0,
      stagePayload(REGRESSION_A.project, '回归A 事件一', sourceEventKey),
    );
    const event2 = await insertStageEvent(
      REGRESSION_A.project,
      1,
      stagePayload(REGRESSION_A.project, '回归A 事件二'),
    );
    const before = await ownerPool().query<{ payload: Record<string, unknown> }>(
      'select payload from app.domain_event_outbox where enterprise_id=$1::bigint and id=$2::bigint',
      [ENTERPRISE_ID, event1],
    );

    await assert.rejects(
      () => resolveStageReminderBusinessEvent({
        actor: integrationActor,
        projectId: REGRESSION_A.project,
        stageKey: STAGE_KEY,
        sourceEventKey,
        outboxEventId: event2,
      }),
      (error: unknown) => error instanceof WorkflowOperationError
        && error.code === 'stage_event_conflict',
      'an explicit event must not rebind an existing source event key',
    );

    const after = await ownerPool().query<{ id: string; payload: Record<string, unknown> }>(
      `select id, payload from app.domain_event_outbox
       where enterprise_id=$1::bigint and aggregate_id=$2 order by aggregate_version`,
      [ENTERPRISE_ID, REGRESSION_A.project],
    );
    assert.equal(after.rows.length, 2, 'the rejected resolve must not create an outbox row');
    assert.equal(String(after.rows[0].id), event1);
    assert.deepEqual(after.rows[0].payload, before.rows[0]?.payload, 'event1 payload must not be rewritten');
    assert.equal(after.rows[0].payload.sourceEventKey, sourceEventKey);
    assert.equal(after.rows[1].payload.sourceEventKey, undefined, 'event2 must not be bound');
    assert.equal(
      await countRows(
        `select count(*)::text as count from app.domain_event_outbox
         where enterprise_id=$1::bigint and aggregate_id=$2 and payload->>'sourceEventKey'=$3`,
        [ENTERPRISE_ID, REGRESSION_A.project, sourceEventKey],
      ),
      1,
      'the source event key must stay bound to exactly one outbox event',
    );
  });

  it('an interleaved note-only revision cannot create a second outbox for one source key', async () => {
    const sourceEventKey = 'regression-b-key';
    const original = await insertStageEvent(
      REGRESSION_B.project,
      0,
      stagePayload(REGRESSION_B.project, '回归B 原始事件'),
    );
    await ownerPool().query(
      `insert into app.construction_audits(enterprise_id,project_id,actor_ref,action,snapshot,created_at)
       values($1::bigint,$2::bigint,$3::jsonb,'progress',$4::jsonb,
         (select created_at from app.domain_event_outbox where enterprise_id=$1::bigint and id=$5::bigint))`,
      [
        ENTERPRISE_ID,
        REGRESSION_B.project,
        JSON.stringify({ kind: 'admin', id: MANAGER_ADMIN_ID }),
        JSON.stringify({ stageKey: STAGE_KEY, expectedVersion: 1, sendReminder: false, note: '回归原备注' }),
        original,
      ],
    );
    await ownerPool().query(
      `update app.construction_projects
       set version=2, progress_note='回归原备注', progress_revision=0, updated_at=now()
       where enterprise_id=$1::bigint and id=$2::bigint`,
      [ENTERPRISE_ID, REGRESSION_B.project],
    );

    const bindingA = await resolveStageReminderBusinessEvent({
      actor: integrationActor,
      projectId: REGRESSION_B.project,
      stageKey: STAGE_KEY,
      sourceEventKey,
    });
    assert.equal(bindingA.source, 'outbox');
    assert.equal(bindingA.outboxEventId, original);
    assert.equal(bindingA.progressRevision, 0);

    // A note-only progress change increments the revision but keeps the stage.
    await ownerPool().query(
      `insert into app.construction_audits(enterprise_id,project_id,actor_ref,action,snapshot)
       values($1::bigint,$2::bigint,$3::jsonb,'progress',$4::jsonb)`,
      [
        ENTERPRISE_ID,
        REGRESSION_B.project,
        JSON.stringify({ kind: 'admin', id: MANAGER_ADMIN_ID }),
        JSON.stringify({ stageKey: STAGE_KEY, expectedVersion: 2, sendReminder: false, note: '回归备注变化' }),
      ],
    );
    await ownerPool().query(
      `update app.construction_projects
       set version=3, progress_note='回归备注变化', progress_revision=1, updated_at=now()
       where enterprise_id=$1::bigint and id=$2::bigint`,
      [ENTERPRISE_ID, REGRESSION_B.project],
    );

    const bindingB = await resolveStageReminderBusinessEvent({
      actor: integrationActor,
      projectId: REGRESSION_B.project,
      stageKey: STAGE_KEY,
      sourceEventKey,
    });
    assert.equal(bindingB.source, 'current_project_revision');
    assert.equal(bindingB.outboxEventId, null);
    assert.equal(bindingB.progressRevision, 1);

    const trigger: TriggerEvent = {
      eventId: sourceEventKey,
      eventType: 'stage_changed',
      occurredAt: '2026-11-11T16:00:00.000Z',
      stageKey: STAGE_KEY,
      stageLabel: STAGE_LABEL,
    };
    const portsA = portsFor(MANAGER_ADMIN_ID);
    const savedA = await saveReminder(
      portsA,
      contextFor(REGRESSION_B.project, bindingA, 'run-regression-b-a', trigger),
      composedBody,
    );
    assert.equal(savedA.saved, true);
    const receiptA = savedA.saveReceipt as Record<string, unknown>;
    assert.equal(receiptA.eventId, original);
    assert.equal(receiptA.reused, true);
    assert.equal(receiptA.progressRevision, 0);

    const portsB = portsFor(MANAGER_ADMIN_ID);
    await assert.rejects(
      () => saveReminder(
        portsB,
        contextFor(REGRESSION_B.project, bindingB, 'run-regression-b-b', trigger),
        composedBody,
      ),
      (error: unknown) => error instanceof LiveOperationFailure
        && error.issue.code === 'stage_event_conflict',
      'a later revision must reuse the bound event or reject, never create a second one',
    );

    assert.equal(await projectOutboxCount(REGRESSION_B.project), 1, 'no second outbox row may be created');
    assert.equal(
      await countRows(
        `select count(*)::text as count from app.domain_event_outbox
         where enterprise_id=$1::bigint and aggregate_id=$2 and payload->>'sourceEventKey'=$3`,
        [ENTERPRISE_ID, REGRESSION_B.project, sourceEventKey],
      ),
      1,
      'the source event key must stay bound to exactly one outbox event',
    );
    const bound = await ownerPool().query<{ id: string; payload: Record<string, unknown> }>(
      'select id, payload from app.domain_event_outbox where enterprise_id=$1::bigint and id=$2::bigint',
      [ENTERPRISE_ID, original],
    );
    assert.equal(String(bound.rows[0]?.id), original);
    assert.equal(bound.rows[0]?.payload.sourceEventKey, sourceEventKey, 'save A must backfill the original event');
  });

  it('delivery receipt reports the real message conversation across conversations', async () => {
    const project = await ownerPool().query<{ progress_revision: number }>(
      'select progress_revision from app.construction_projects where enterprise_id=$1::bigint and id=$2::bigint',
      [ENTERPRISE_ID, CROSS_CONVERSATION.project],
    );
    const revision = Number(project.rows[0]?.progress_revision);
    assert.ok(Number.isSafeInteger(revision) && revision >= 0, 'the cross-conversation project revision is missing');

    const sourceEventKey = 'cross-conversation-key';
    const eventId = await insertStageEvent(
      CROSS_CONVERSATION.project,
      revision,
      stagePayload(CROSS_CONVERSATION.project, '跨会话阶段提醒', sourceEventKey),
    );

    // Deliver the new stage notice in the generic conversation C1 first; its
    // active participant is the customer.
    const c1Delivery = await deliverDirect(CROSS_CONVERSATION.project, eventId, GENERIC.conversation);
    assert.equal(c1Delivery.delivered, true);
    assert.equal(await stageMessageCount(GENERIC.conversation, eventId), 1);

    const evidence = await ownerPool().query<{ id: string; conversation_id: string; user_id: string }>(
      `select m.id::text as id, m.conversation_id::text as conversation_id, ap.user_id::text as user_id
       from app.assistant_messages m
       join app.assistant_participants ap on ap.enterprise_id=m.enterprise_id
         and ap.conversation_id=m.conversation_id and ap.status='active'
       where m.enterprise_id=$1::bigint and m.conversation_id=$2::bigint
         and m.purpose='construction.stage' and m.source_event_id=$3::bigint`,
      [ENTERPRISE_ID, GENERIC.conversation, eventId],
    );
    const c1Message = evidence.rows[0];
    assert.ok(c1Message, 'the generic conversation must hold the stage notice');
    assert.equal(c1Message.conversation_id, GENERIC.conversation);
    assert.equal(c1Message.user_id, CUSTOMER_USER_ID);

    const crossConversationEvent: TriggerEvent = {
      eventId: sourceEventKey,
      eventType: 'stage_changed',
      occurredAt: '2026-11-11T17:00:00.000Z',
      stageKey: STAGE_KEY,
      stageLabel: STAGE_LABEL,
    };
    const binding = await resolveStageReminderBusinessEvent({
      actor: integrationActor,
      projectId: CROSS_CONVERSATION.project,
      stageKey: STAGE_KEY,
      sourceEventKey,
    });
    assert.equal(binding.outboxEventId, eventId);
    assert.equal(binding.progressRevision, revision);

    const ports = portsFor(MANAGER_ADMIN_ID);
    const context = contextFor(CROSS_CONVERSATION.project, binding, 'run-cross-conversation', crossConversationEvent);
    const read = await readContext(ports, context);
    const receivers = read.receivers as Record<string, string>;
    assert.equal(receivers.conversationId, CROSS_CONVERSATION.conversation, 'the ports must request the lead-bound C2');

    const countsBefore = {
      outbox: await projectOutboxCount(CROSS_CONVERSATION.project),
      deliveries: await projectDeliveryCount(CROSS_CONVERSATION.project),
      generic: await stageMessageCount(GENERIC.conversation, eventId),
      target: await stageMessageCount(CROSS_CONVERSATION.conversation, eventId),
    };
    const saved = await saveReminder(ports, context, composedBody);
    assert.equal(saved.saved, true);
    const saveReceipt = saved.saveReceipt as Record<string, unknown>;
    assert.equal(saveReceipt.eventId, eventId);
    assert.equal(saveReceipt.reused, true);

    const delivered = await deliverReminder(ports, context, read.receivers as WorkflowValue, composedBody);
    assert.equal(delivered.delivered, true);
    const receipt = delivered.deliveryReceipt as Record<string, unknown>;
    assert.equal(receipt.status, 'delivered');
    assert.equal(receipt.eventId, eventId);
    assert.equal(receipt.progressRevision, revision);
    assert.equal(receipt.messageId, c1Message.id, 'the receipt must point at the real C1 message');
    assert.equal(receipt.conversationId, GENERIC.conversation, 'the receipt must report the real C1 conversation');
    assert.equal(
      receipt.requestedConversationId,
      CROSS_CONVERSATION.conversation,
      'the requested C2 must be reported separately',
    );
    assert.equal(receipt.recipientUserId, CUSTOMER_USER_ID);
    assert.equal(receipt.reusedConversation, true);

    assert.equal(await stageMessageCount(CROSS_CONVERSATION.conversation, eventId), 0, 'no stage notice may be added to C2');
    const countsAfter = {
      outbox: await projectOutboxCount(CROSS_CONVERSATION.project),
      deliveries: await projectDeliveryCount(CROSS_CONVERSATION.project),
      generic: await stageMessageCount(GENERIC.conversation, eventId),
      target: await stageMessageCount(CROSS_CONVERSATION.conversation, eventId),
    };
    assert.deepEqual(countsAfter, countsBefore, 'a cross-conversation receipt must not add outbox/delivery/stage rows');
  });
});
