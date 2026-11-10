import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { AssistantError, type ActorContext } from '@/lib/assistant/contracts';
import type { ConstructionActor } from '@/lib/construction/contracts';
import { recordStageReminder, syncConstructionReminders } from '@/lib/construction/reminders';
import { constructionAccess } from '@/lib/construction/service';
import { readStageSettings } from '@/lib/construction/stages-store';
import { workflowIssue } from '../errors';
import { isPlainObject } from '../guards';
import type { PendingOperation, WorkflowValue } from '../types';
import {
  LiveOperationFailure,
  LiveOperationUnknownError,
  type LiveOperationPorts,
  type LiveRunContext,
} from './types';

/**
 * B4 live adapter for the stage-reminder template.
 *
 * It reuses the existing construction authorization, outbox save and in-app
 * delivery services. The enterprise/user/project identity comes from the host
 * (this adapter's options and the run context), never from the definition.
 * Enterprise knowledge is explicitly off in this round: no retrieval, model or
 * embedding call exists in this file.
 */
export interface ConstructionStageReminderPortOptions {
  readonly actor: ConstructionActor;
  readonly knowledge: 'off';
}

interface SavedReminder {
  readonly eventId: string;
  readonly projectId: string;
  readonly stageKey: string;
  readonly body: string;
}

function actorContext(actor: ConstructionActor): ActorContext {
  return {
    enterpriseId: actor.enterpriseId,
    principal: { kind: 'admin', adminId: actor.adminId },
    contextVersion: 1,
    capabilities: [],
  };
}

function customerActor(enterpriseId: string, userId: string): ActorContext {
  return {
    enterpriseId,
    principal: { kind: 'user', userId },
    contextVersion: 1,
    capabilities: [],
  };
}

function failure(code: string, message: string, path = '$'): LiveOperationFailure {
  return new LiveOperationFailure(workflowIssue(code, path, message));
}

type LockMode = 'share' | 'update';

async function projectAccess(
  tx: PostgresTransaction,
  actor: ConstructionActor,
  projectId: string,
  lock: LockMode,
  owner: boolean,
): Promise<{ owner: boolean; project: Row }> {
  const lockSql = lock === 'update' ? sql`for update` : sql`for share`;
  const project = await one(
    tx,
    sql`select * from app.construction_projects
      where enterprise_id=${actor.enterpriseId} and id=${projectId} ${lockSql}`,
  );
  if (!project) throw new AssistantError('construction_not_found', 404);
  if (!owner) {
    const member = await one(
      tx,
      sql`select role from app.construction_members
        where enterprise_id=${actor.enterpriseId} and project_id=${projectId}
        and admin_id=${actor.adminId} and active ${lockSql}`,
    );
    if (!member) throw new AssistantError('construction_not_found', 404);
  }
  return { owner, project };
}

async function authorizeProject(
  tx: PostgresTransaction,
  actor: ConstructionActor,
  projectId: string,
  lock: LockMode,
): Promise<{ owner: boolean; project: Row }> {
  return projectAccess(tx, actor, projectId, lock, await constructionAccess(tx, actor));
}

function openCustomerConversation(
  tx: PostgresTransaction,
  enterpriseId: string,
  projectId: string,
  lock: LockMode,
) {
  const lockSql = lock === 'update' ? sql`for update of c` : sql`for share of c`;
  return one(
    tx,
    sql`select c.*, l.customer_user_id from app.assistant_conversations c
      join app.assistant_participants ap on ap.enterprise_id=c.enterprise_id
        and ap.conversation_id=c.id and ap.status='active'
      join app.leads l on l.enterprise_id=c.enterprise_id and l.customer_user_id=ap.user_id
        and l.archived_at is null
      join app.construction_projects p on p.enterprise_id=l.enterprise_id and p.lead_id=l.id
      where c.enterprise_id=${enterpriseId} and p.id=${projectId}
        and p.customer_access and p.status='active'
        and c.purpose='customer_consultation' and c.status='open' and c.mode='ai'
        and (coalesce(c.entry_snapshot->>'kind','')<>'lead' or c.entry_snapshot->>'id'=l.id::text)
      order by c.id desc limit 1 ${lockSql}`,
  );
}

async function readProjectContext(
  operation: PendingOperation,
  context: LiveRunContext,
  actor: ConstructionActor,
): Promise<Record<string, WorkflowValue>> {
  const eventStageKey = context.event.stageKey;
  if (!eventStageKey) throw new AssistantError('event_mismatch', 400);
  return withTenantTransaction(actor.enterpriseId, async (tx) => {
    // Match the existing service lock order: conversation, then project.
    const owner = await constructionAccess(tx, actor);
    const conversation = await openCustomerConversation(
      tx,
      actor.enterpriseId,
      context.projectId,
      'share',
    );
    const { project } = await projectAccess(tx, actor, context.projectId, 'share', owner);
    const settings = await readStageSettings(tx, actor.enterpriseId);
    const stage = settings.stages.find((candidate) => candidate.key === eventStageKey);
    if (!stage) {
      return {
        stageKey: eventStageKey,
        stageLabel: '',
        stageKnown: false,
        subscribed: false,
        receivers: { scope: 'none' },
        receiverCount: 0,
      };
    }
    if (String(project.current_stage_key) !== stage.key) {
      throw new AssistantError('stage_event_mismatch', 409);
    }
    if (project.status !== 'active') throw new AssistantError('construction_project_inactive', 409);

    const assistant = await one(
      tx,
      sql`select enabled from app.assistant_enterprise_settings
        where enterprise_id=${actor.enterpriseId}`,
    );
    const subscribed = Boolean(
      project.customer_access
      && stage.visitReminder
      && conversation?.customer_user_id
      && assistant?.enabled,
    );
    const receivers = subscribed
      ? {
          scope: 'customer_conversation',
          projectId: context.projectId,
          conversationId: String(conversation!.id),
          customerUserId: String(conversation!.customer_user_id),
        }
      : { scope: 'none' };
    return {
      stageKey: stage.key,
      stageLabel: stage.name,
      stageKnown: true,
      subscribed,
      receivers,
      receiverCount: subscribed ? 1 : 0,
    };
  });
}

async function saveStageReminder(
  operation: PendingOperation,
  context: LiveRunContext,
  actor: ConstructionActor,
  onSaved: (saved: SavedReminder) => void,
): Promise<Record<string, WorkflowValue>> {
  const body = String(operation.input.body ?? '');
  const eventStageKey = context.event.stageKey;
  if (!eventStageKey) throw failure('event_mismatch', 'stage event needs a stageKey');
  if (!body.trim() || Array.from(body).length > 4_000) {
    throw failure('invalid_reminder_content', 'reminder body must be non-empty and bounded', `nodes.${operation.nodeId}.body`);
  }
  return withTenantTransaction(actor.enterpriseId, async (tx) => {
    const { project } = await authorizeProject(tx, actor, context.projectId, 'update');
    if (project.status !== 'active') throw new AssistantError('construction_project_inactive', 409);
    if (String(project.current_stage_key) !== eventStageKey) {
      throw new AssistantError('stage_event_mismatch', 409);
    }
    const settings = await readStageSettings(tx, actor.enterpriseId);
    const stage = settings.stages.find((candidate) => candidate.key === eventStageKey);
    if (!stage) throw new AssistantError('construction_stage_unavailable', 422);

    // This is the existing business identity of a stage event: one project
    // progress revision may produce at most one outbox reminder, independent
    // of workflow revision or digest. The project row lock serializes with the
    // existing progress action, so check-then-insert is safe.
    const progressRevision = Number(project.progress_revision);
    const existing = await one(
      tx,
      sql`select id, payload from app.domain_event_outbox
        where enterprise_id=${actor.enterpriseId}
          and type='construction.stage.updated.v1'
          and aggregate_type='construction_project'
          and aggregate_id=${context.projectId}
          and aggregate_version=${progressRevision}
        limit 1`,
    );
    if (existing) {
      const payload = existing.payload as Row;
      if (String(payload.stageKey) !== eventStageKey) {
        throw new AssistantError('stage_event_conflict', 409);
      }
      const saved: SavedReminder = {
        eventId: String(existing.id),
        projectId: context.projectId,
        stageKey: eventStageKey,
        body,
      };
      onSaved(saved);
      return {
        saved: true,
        saveReceipt: {
          receiptId: saved.eventId,
          simulated: false,
          source: 'domain_event_outbox',
          eventId: saved.eventId,
          projectId: saved.projectId,
          stageKey: saved.stageKey,
          reused: true,
        },
      };
    }

    const outbox = await recordStageReminder(
      tx,
      actorContext(actor),
      project,
      settings.version,
      body,
    );
    const saved: SavedReminder = {
      eventId: String(outbox.id),
      projectId: context.projectId,
      stageKey: eventStageKey,
      body,
    };
    onSaved(saved);
    return {
      saved: true,
      saveReceipt: {
        receiptId: saved.eventId,
        simulated: false,
        source: 'domain_event_outbox',
        eventId: saved.eventId,
        projectId: saved.projectId,
        stageKey: saved.stageKey,
        reused: false,
      },
    };
  });
}

async function deliverInApp(
  operation: PendingOperation,
  context: LiveRunContext,
  actor: ConstructionActor,
  saved: SavedReminder | null,
): Promise<Record<string, WorkflowValue>> {
  if (!saved) throw failure('save_receipt_missing', 'delivery requires a confirmed save receipt');
  const receivers = operation.input.receivers;
  if (!isPlainObject(receivers)) {
    throw failure('receiver_scope_mismatch', 'delivery receivers must be the host read object');
  }
  return withTenantTransaction(actor.enterpriseId, async (tx) => {
    // Re-check the requesting admin; revocation between read and delivery must
    // still deny the effect. Conversation first, then project, matching the
    // existing progress/chat lock order.
    const owner = await constructionAccess(tx, actor);
    const conversation = await openCustomerConversation(
      tx,
      actor.enterpriseId,
      context.projectId,
      'update',
    );
    const { project } = await projectAccess(tx, actor, context.projectId, 'update', owner);
    if (!project.customer_access || project.status !== 'active') {
      return {
        delivered: false,
        deliveryReceipt: { receiptId: '', simulated: false, status: 'customer_access_revoked' },
      };
    }
    if (String(project.current_stage_key) !== saved.stageKey) {
      return {
        delivered: false,
        deliveryReceipt: { receiptId: '', simulated: false, status: 'stage_superseded' },
      };
    }
    if (!conversation) {
      return {
        delivered: false,
        deliveryReceipt: { receiptId: '', simulated: false, status: 'conversation_unavailable' },
      };
    }
    if (
      receivers.scope !== 'customer_conversation'
      || String(receivers.projectId ?? '') !== context.projectId
      || String(receivers.conversationId ?? '') !== String(conversation.id)
      || String(receivers.customerUserId ?? '') !== String(conversation.customer_user_id)
    ) {
      throw failure('receiver_scope_mismatch', 'delivery receivers do not match the authorized project');
    }
    const customerUserId = String(conversation.customer_user_id);
    await syncConstructionReminders(tx, customerActor(actor.enterpriseId, customerUserId), conversation);

    const delivery = await one(
      tx,
      sql`select id, status, last_error from app.domain_event_deliveries
        where enterprise_id=${actor.enterpriseId} and event_id=${saved.eventId}
          and consumer_key=${`construction:user:${customerUserId}`}`,
    );
    if (!delivery || delivery.status !== 'delivered') {
      return {
        delivered: false,
        deliveryReceipt: {
          receiptId: delivery ? String(delivery.id) : '',
          simulated: false,
          source: 'domain_event_deliveries',
          eventId: saved.eventId,
          status: delivery ? String(delivery.status) : 'missing',
          error: delivery?.last_error ? String(delivery.last_error).slice(0, 200) : null,
        },
      };
    }
    const message = await one(
      tx,
      sql`select id from app.assistant_messages
        where enterprise_id=${actor.enterpriseId} and conversation_id=${String(conversation.id)}
          and source_event_id=${saved.eventId} and purpose='construction.stage'
        limit 1`,
    );
    if (!message) {
      return {
        delivered: false,
        deliveryReceipt: {
          receiptId: String(delivery.id),
          simulated: false,
          source: 'domain_event_deliveries',
          eventId: saved.eventId,
          status: 'message_missing',
        },
      };
    }
    return {
      delivered: true,
      deliveryReceipt: {
        receiptId: String(delivery.id),
        simulated: false,
        source: 'domain_event_deliveries',
        eventId: saved.eventId,
        messageId: String(message.id),
        conversationId: String(conversation.id),
        status: 'delivered',
      },
    };
  });
}

export function createConstructionStageReminderPorts(
  options: ConstructionStageReminderPortOptions,
): LiveOperationPorts {
  if (options.knowledge !== 'off') {
    throw new Error('B4 only implements the enterprise-knowledge-off branch');
  }
  let saved: SavedReminder | null = null;

  return {
    async execute(operation, context) {
      try {
        switch (operation.capabilityRef) {
          case 'read.project_context':
            return await readProjectContext(operation, context, options.actor);
          case 'read.enterprise_craft':
            // Deterministic knowledge-off branch: no retrieval, model or
            // embedding call. The switch never reaches the model branch.
            return { craftEnabled: false, craftSummary: '' };
          case 'save.stage_reminder':
            return await saveStageReminder(operation, context, options.actor, (next) => {
              saved = next;
            });
          case 'deliver.inapp':
            return await deliverInApp(operation, context, options.actor, saved);
          default:
            throw failure(
              'unsupported_live_capability',
              `${operation.capabilityRef} is not supported by the B4 live adapter`,
              `nodes.${operation.nodeId}`,
            );
        }
      } catch (error) {
        if (error instanceof LiveOperationFailure || error instanceof LiveOperationUnknownError) throw error;
        if (error instanceof AssistantError) {
          throw new LiveOperationFailure(
            workflowIssue(error.code, `nodes.${operation.nodeId}`, error.message),
          );
        }
        throw new LiveOperationUnknownError(
          workflowIssue(
            'live_operation_unknown',
            `nodes.${operation.nodeId}`,
            error instanceof Error ? error.message.slice(0, 300) : 'operation outcome is unknown',
          ),
        );
      }
    },
  };
}
