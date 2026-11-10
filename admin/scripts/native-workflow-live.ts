/** Development-only B4 entry for one published stage-reminder flow.
 *
 * It binds one published revision and one fixed server-side business event,
 * then runs the real construction authorization, outbox save and scoped in-app
 * delivery services. It never calls a model, embedding or enterprise-knowledge
 * retrieval, and it does not modify the Worker or global scheduling.
 *
 * Required environment:
 *   B4_LIVE_APP_DATABASE_URL=postgresql://sfp_app:...@127.0.0.1:55433/smart_floor_planner
 *
 * Usage (from admin/):
 *   npx tsx scripts/native-workflow-live.ts --development --ensure-published \
 *     --admin-id 1454000001 --project-id 1454000004 \
 *     --event-id b4-stage-20261111-0001 --stage-key plumbing --stage-label 水路
 *
 * Optional `--outbox-event-id <id>` replays one existing stage event instead
 * of deriving the event from the project's current progress revision.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { one } from '@/db/repositories/assistant-repository';
import { withTenantTransaction } from '@/db/transaction';
import type { ConstructionActor } from '@/lib/construction/contracts';
import { createFileWorkflowStore, resolveNativeWorkflowStoreDir } from '@/lib/native-workflow/store/file-store';
import { createWorkflowService } from '@/lib/native-workflow/service';
import { resolveStageReminderBusinessEvent } from '@/lib/native-workflow/live/business-event';
import { createConstructionStageReminderPorts } from '@/lib/native-workflow/live/construction-ports';
import { describeB4DatabaseTarget, resolveB4DatabaseTarget } from '@/lib/native-workflow/live/dev-config';
import { runPublishedLive } from '@/lib/native-workflow/live/runner';
import { createFileWorkflowRunStore } from '@/lib/native-workflow/live/run-store';
import type { LiveBusinessEvent, LiveOperationPorts, LiveRunRecord } from '@/lib/native-workflow/live/types';
import type { PendingOperation, TriggerEvent } from '@/lib/native-workflow/types';

loadEnvConfig(process.cwd());

const DEFAULT_ENTERPRISE_ID = '1454';

function fail(message: string): never {
  console.error(JSON.stringify({ success: false, error: message }));
  process.exit(1);
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) fail(`${name} requires a value`);
  return value;
}

function required(name: string): string {
  const value = option(name);
  if (!value) fail(`${name} is required`);
  return value;
}

function positiveId(name: string, value: string): string {
  if (!/^[1-9]\d{0,18}$/.test(value)) fail(`${name} must be a positive integer id`);
  return value;
}

const showRun = option('--show-run');
const executing = !showRun;
const enterpriseId = positiveId('--enterprise-id', option('--enterprise-id') ?? DEFAULT_ENTERPRISE_ID);
const adminId = executing ? positiveId('--admin-id', required('--admin-id')) : '';
const projectId = executing ? positiveId('--project-id', required('--project-id')) : '';
const eventId = executing ? required('--event-id') : '';
if (executing && !/^[a-zA-Z0-9._:-]{1,96}$/.test(eventId)) fail('--event-id must be a short business event key');
const stageKey = executing ? required('--stage-key') : '';
const stageLabel = option('--stage-label') ?? stageKey;
const occurredAt = option('--occurred-at') ?? new Date().toISOString();
const definitionId = option('--definition-id') ?? 'stage-reminder';
const requestedRevision = option('--revision');
const outboxEventId = option('--outbox-event-id');
if (executing && outboxEventId !== undefined && !/^[1-9]\d{0,18}$/.test(outboxEventId)) {
  fail('--outbox-event-id must be a positive integer id');
}
const ensurePublished = process.argv.includes('--ensure-published');
const closeAfterSave = process.argv.includes('--close-conversation-after-save');
const disableAdminAfterRead = process.argv.includes('--disable-admin-after-read');
const runId = option('--run-id') ?? `native-stage-${Date.now()}-${randomUUID().slice(0, 8)}`;

const definitionStore = createFileWorkflowStore({ rootDir: resolveNativeWorkflowStoreDir() });
const workflowService = createWorkflowService({ store: definitionStore });
const runStore = createFileWorkflowRunStore({ rootDir: resolveRunDir() });

function resolveRunDir(): string {
  return process.env.NATIVE_WORKFLOW_RUN_DIR?.trim()
    || path.resolve(process.cwd(), 'tmp/native-workflow-runs');
}

async function resolvePublished() {
  let record = await definitionStore.get(definitionId);
  if (!record) {
    if (!ensurePublished) fail(`definition ${definitionId} was not found; pass --ensure-published to create the template`);
    await workflowService.createFromTemplate('stage-reminder');
    record = await definitionStore.get(definitionId);
  }
  if (!record) fail(`definition ${definitionId} could not be created`);
  const latest = record.versions[record.versions.length - 1];
  let version = requestedRevision === undefined
    ? latest
    : record.versions.find((candidate) => candidate.revision === Number(requestedRevision));
  if (!version) {
    if (!ensurePublished || requestedRevision !== undefined) {
      fail(`published revision ${requestedRevision ?? '(latest)'} was not found for ${definitionId}`);
    }
    const published = await workflowService.publishDraft({
      definitionId,
      expectedDraftRevision: record.draft.draftRevision,
    });
    version = published.version;
  }
  return version;
}

async function resolveOpenConversationId(): Promise<string | null> {
  return withTenantTransaction(enterpriseId, async (tx) => {
    const conversation = await one(tx, sql`select c.id from app.assistant_conversations c
      join app.assistant_participants ap on ap.enterprise_id=c.enterprise_id
        and ap.conversation_id=c.id and ap.status='active'
      join app.leads l on l.enterprise_id=c.enterprise_id and l.customer_user_id=ap.user_id
        and l.archived_at is null
      join app.construction_projects p on p.enterprise_id=l.enterprise_id and p.lead_id=l.id
      where c.enterprise_id=${enterpriseId} and p.id=${projectId}
        and p.customer_access and p.status='active'
        and c.purpose='customer_consultation' and c.status='open' and c.mode='ai'
        and (coalesce(c.entry_snapshot->>'kind','')<>'lead' or c.entry_snapshot->>'id'=l.id::text)
      order by c.id desc limit 1`);
    return conversation ? String(conversation.id) : null;
  });
}

async function setConversationStatus(conversationId: string, status: 'open' | 'closed'): Promise<void> {
  await withTenantTransaction(enterpriseId, async (tx) => {
    await tx.execute(sql`update app.assistant_conversations
      set status=${status}, updated_at=now(), version=version+1
      where enterprise_id=${enterpriseId} and id=${conversationId}`);
  });
}

async function setAdminStatus(status: 'active' | 'disabled'): Promise<void> {
  await withTenantTransaction(enterpriseId, async (tx) => {
    await tx.execute(sql`update app.admin_users
      set status=${status}, updated_at=now()
      where enterprise_id=${enterpriseId} and id=${adminId}`);
  });
}

async function evidence() {
  return withTenantTransaction(enterpriseId, async (tx) => {
    const outbox = await one(tx, sql`select count(*)::int as count from app.domain_event_outbox
      where enterprise_id=${enterpriseId} and type='construction.stage.updated.v1'
        and aggregate_type='construction_project' and aggregate_id=${projectId}`);
    const deliveries = await one(tx, sql`select count(*)::int as count from app.domain_event_deliveries d
      join app.domain_event_outbox e on e.enterprise_id=d.enterprise_id and e.id=d.event_id
      where d.enterprise_id=${enterpriseId} and e.type='construction.stage.updated.v1'
        and e.aggregate_id=${projectId}`);
    const messages = await one(tx, sql`select count(*)::int as count from app.assistant_messages m
      join app.domain_event_outbox e on e.enterprise_id=m.enterprise_id and e.id=m.source_event_id
      where m.enterprise_id=${enterpriseId} and e.type='construction.stage.updated.v1'
        and e.aggregate_id=${projectId} and m.purpose='construction.stage'`);
    const usage = await one(tx, sql`select count(*)::int as count from app.assistant_usage_records
      where enterprise_id=${enterpriseId}`);
    const attempts = await one(tx, sql`select count(*)::int as count from app.ai_provider_attempts
      where enterprise_id=${enterpriseId}`);
    return {
      outboxEvents: Number(outbox?.count ?? 0),
      deliveries: Number(deliveries?.count ?? 0),
      constructionMessages: Number(messages?.count ?? 0),
      assistantUsageRecords: Number(usage?.count ?? 0),
      aiProviderAttempts: Number(attempts?.count ?? 0),
    };
  });
}

function receiptOf(record: LiveRunRecord, port: 'saveReceipt' | 'deliveryReceipt') {
  for (const operation of [...record.operations].reverse()) {
    const value = operation.outputs?.[port];
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  }
  return null;
}

async function main() {
  if (showRun) {
    const record = await runStore.get(showRun);
    if (!record) fail(`run ${showRun} was not found`);
    console.log(JSON.stringify({ success: true, run: record }, null, 2));
    return;
  }

  const database = resolveB4DatabaseTarget({ purpose: 'app' });
  process.env.DATABASE_URL = database.url;
  const version = await resolvePublished();
  const actor: ConstructionActor = { enterpriseId, adminId };

  // An existing runId is never re-resolved against current business state:
  // return or reject its original binding. A new run fixes the server event now.
  const existingRun = await runStore.get(runId);
  let businessEvent: LiveBusinessEvent;
  if (existingRun) {
    businessEvent = existingRun.binding.businessEvent;
  } else {
    businessEvent = await resolveStageReminderBusinessEvent({
      actor,
      projectId,
      stageKey,
      outboxEventId: outboxEventId ?? null,
    });
  }
  const event: TriggerEvent = {
    eventId,
    eventType: 'stage_changed',
    occurredAt,
    stageKey: businessEvent.stageKey,
    stageLabel,
  };

  const basePorts = createConstructionStageReminderPorts({ actor, knowledge: 'off' });
  const conversationId = closeAfterSave ? await resolveOpenConversationId() : null;
  if (closeAfterSave && !conversationId) {
    fail('--close-conversation-after-save requires an open customer conversation for the project');
  }
  let closed = false;
  let adminDisabled = false;
  const ports: LiveOperationPorts = closeAfterSave || disableAdminAfterRead
    ? {
        async execute(operation: PendingOperation, context) {
          const outputs = await basePorts.execute(operation, context);
          if (operation.capabilityRef === 'read.project_context' && disableAdminAfterRead) {
            await setAdminStatus('disabled');
            adminDisabled = true;
          }
          if (operation.effect === 'save' && closeAfterSave) {
            await setConversationStatus(conversationId!, 'closed');
            closed = true;
          }
          return outputs;
        },
      }
    : basePorts;

  let record: LiveRunRecord | null = null;
  let runnerError: unknown = null;
  let restored = false;
  let restoreError: string | null = null;
  let adminRestored = false;
  let adminRestoreError: string | null = null;
  try {
    record = await runPublishedLive({
      published: version,
      enterpriseId,
      projectId,
      event,
      businessEvent,
      ports,
      store: runStore,
      runId,
    });
  } catch (error) {
    runnerError = error;
  } finally {
    if (adminDisabled) {
      try {
        await setAdminStatus('active');
        adminRestored = true;
      } catch (error) {
        adminRestoreError = error instanceof Error ? error.message : String(error);
      }
    }
    if (closed && conversationId) {
      try {
        await setConversationStatus(conversationId, 'open');
        restored = true;
      } catch (error) {
        restoreError = error instanceof Error ? error.message : String(error);
      }
    }
  }
  if (!record) {
    console.error(JSON.stringify({
      success: false,
      runId,
      error: runnerError instanceof Error ? runnerError.message : String(runnerError),
      database: describeB4DatabaseTarget(database),
      businessEvent,
      conversationClosedForFailureTest: closed,
      conversationRestored: restored,
      restoreError,
      adminDisabledForFailureTest: adminDisabled,
      adminRestored,
      adminRestoreError,
    }));
    process.exitCode = 1;
    return;
  }
  const business = await evidence();
  console.log(JSON.stringify({
    success: record.status === 'completed',
    runId,
    runReused: Boolean(existingRun),
    status: record.status,
    database: describeB4DatabaseTarget(database),
    binding: record.binding,
    businessEvent,
    operations: record.operations.map((operation) => ({
      nodeId: operation.nodeId,
      capabilityRef: operation.capabilityRef,
      effect: operation.effect,
      outcome: operation.outcome,
      error: operation.error ?? null,
    })),
    saveReceipt: receiptOf(record, 'saveReceipt'),
    deliveryReceipt: receiptOf(record, 'deliveryReceipt'),
    error: record.state.error,
    business,
    conversationClosedForFailureTest: closed,
    conversationRestored: restored,
    restoreError,
    adminDisabledForFailureTest: adminDisabled,
    adminRestored,
    adminRestoreError,
  }, null, 2));
  process.exitCode = record.status === 'completed' ? 0 : 2;
}

main().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
});
