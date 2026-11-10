import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { AssistantError, type ActorContext } from '@/lib/assistant/contracts';
import type { ConstructionActor } from '@/lib/construction/contracts';
import { deliverStageReminderToConversation, recordStageReminder } from '@/lib/construction/reminders';
import { constructionAccess } from '@/lib/construction/service';
import { currentStageEvent } from '@/lib/construction/stage-events';
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
import { assertProjectWrite, projectAccess, writeProjectAccess } from './project-access';

/**
 * B4 live adapter for the stage-reminder template.
 *
 * It reuses the existing construction authorization, outbox save and scoped
 * in-app delivery services. The enterprise/user/project identity and the
 * original business event/progress revision come from the host run binding,
 * never from the definition. Enterprise knowledge is explicitly off in this
 * round: no retrieval, model or embedding call exists in this file.
 */
export interface ConstructionStageReminderPortOptions {
  readonly actor: ConstructionActor;
  readonly knowledge: 'off';
}

interface SavedReminder {
  readonly eventId: string;
  readonly projectId: string;
  readonly stageKey: string;
  readonly progressRevision: number;
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
  _operation: PendingOperation,
  context: LiveRunContext,
  actor: ConstructionActor,
): Promise<Record<string, WorkflowValue>> {
  const binding = context.businessEvent;
  if (!binding || binding.stageKey !== context.event.stageKey) {
    throw new AssistantError('stage_event_conflict', 409);
  }
  return withTenantTransaction(actor.enterpriseId, async (tx) => {
    // Match the existing service lock order: conversation, then project.
    const owner = await constructionAccess(tx, actor);
    const conversation = await openCustomerConversation(
      tx,
      actor.enterpriseId,
      context.projectId,
      'share',
    );
    const access = await projectAccess(tx, actor, context.projectId, 'share', owner);
    const project = access.project;
    const settings = await readStageSettings(tx, actor.enterpriseId);
    const stage = settings.stages.find((candidate) => candidate.key === binding.stageKey);
    if (!stage) {
      return {
        stageKey: binding.stageKey,
        stageLabel: '',
        stageKnown: false,
        subscribed: false,
        receivers: { scope: 'none' },
        receiverCount: 0,
      };
    }
    if (String(project.current_stage_key) !== binding.stageKey) {
      throw new AssistantError('stage_event_invalidated', 409);
    }
    if (project.status !== 'active') throw new AssistantError('construction_project_inactive', 409);
    if (binding.source === 'outbox') {
      if (!binding.outboxEventId) throw new AssistantError('stage_event_invalid', 409);
      if (!await currentStageEvent(tx, actor.enterpriseId, binding.outboxEventId, true)) {
        throw new AssistantError('stage_event_invalidated', 409);
      }
    } else if (Number(project.progress_revision) !== binding.progressRevision) {
      throw new AssistantError('stage_event_invalidated', 409);
    }

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
      stageKey: binding.stageKey,
      stageLabel: stage.name,
      stageKnown: true,
      subscribed,
      receivers,
      receiverCount: subscribed ? 1 : 0,
    };
  });
}

function saveReceipt(saved: SavedReminder, reused: boolean): Record<string, WorkflowValue> {
  return {
    saved: true,
    saveReceipt: {
      receiptId: saved.eventId,
      simulated: false,
      source: 'domain_event_outbox',
      eventId: saved.eventId,
      projectId: saved.projectId,
      stageKey: saved.stageKey,
      progressRevision: saved.progressRevision,
      reused,
    },
  };
}

async function reuseFromOutbox(
  tx: PostgresTransaction,
  enterpriseId: string,
  context: LiveRunContext,
  event: Row,
): Promise<{ saved: SavedReminder; reused: true }> {
  const binding = context.businessEvent;
  const payload = event.payload as Row;
  if (String(payload.stageKey) !== binding.stageKey) {
    throw new AssistantError('stage_event_conflict', 409);
  }
  if (Number(event.aggregate_version) !== binding.progressRevision) {
    throw new AssistantError('stage_event_conflict', 409);
  }
  if (!await currentStageEvent(tx, enterpriseId, String(event.id), true)) {
    throw new AssistantError('stage_event_invalidated', 409);
  }
  return {
    saved: {
      eventId: String(event.id),
      projectId: context.projectId,
      stageKey: binding.stageKey,
      progressRevision: binding.progressRevision,
      body: typeof payload.text === 'string' ? payload.text : '',
    },
    reused: true,
  };
}

async function saveStageReminder(
  operation: PendingOperation,
  context: LiveRunContext,
  actor: ConstructionActor,
  onSaved: (saved: SavedReminder) => void,
): Promise<Record<string, WorkflowValue>> {
  const body = String(operation.input.body ?? '');
  const binding = context.businessEvent;
  if (!binding) throw failure('stage_event_invalid', 'run has no fixed business event');
  if (!body.trim() || Array.from(body).length > 4_000) {
    throw failure('invalid_reminder_content', 'reminder body must be non-empty and bounded', `nodes.${operation.nodeId}.body`);
  }
  return withTenantTransaction(actor.enterpriseId, async (tx) => {
    const access = await writeProjectAccess(tx, actor, context.projectId, 'update');
    const project = access.project;
    if (project.status !== 'active') throw new AssistantError('construction_project_inactive', 409);
    if (String(project.current_stage_key) !== binding.stageKey) {
      throw new AssistantError('stage_event_invalidated', 409);
    }
    const settings = await readStageSettings(tx, actor.enterpriseId);
    const stage = settings.stages.find((candidate) => candidate.key === binding.stageKey);
    if (!stage) throw new AssistantError('construction_stage_unavailable', 422);

    if (binding.source === 'outbox' && binding.outboxEventId) {
      const event = await one(
        tx,
        sql`select * from app.domain_event_outbox
          where enterprise_id=${actor.enterpriseId} and id=${binding.outboxEventId}
            and type='construction.stage.updated.v1'
            and aggregate_type='construction_project' and aggregate_id=${context.projectId}`,
      );
      if (!event) throw new AssistantError('stage_event_not_found', 404);
      const reused = await reuseFromOutbox(tx, actor.enterpriseId, context, event);
      onSaved(reused.saved);
      return saveReceipt(reused.saved, true);
    }

    const existing = await one(
      tx,
      sql`select * from app.domain_event_outbox
        where enterprise_id=${actor.enterpriseId}
          and type='construction.stage.updated.v1'
          and aggregate_type='construction_project'
          and aggregate_id=${context.projectId}
          and aggregate_version=${binding.progressRevision}
        limit 1`,
    );
    if (existing) {
      const reused = await reuseFromOutbox(tx, actor.enterpriseId, context, existing);
      onSaved(reused.saved);
      return saveReceipt(reused.saved, true);
    }

    // No event exists yet. Only the revision fixed at run start may create it;
    // a later note/stage update must not turn the old event into a new one.
    if (Number(project.progress_revision) !== binding.progressRevision) {
      throw new AssistantError('stage_event_invalidated', 409);
    }
    const outbox = await recordStageReminder(
      tx,
      actorContext(actor),
      project,
      binding.settingsVersion,
      body,
    );
    const saved: SavedReminder = {
      eventId: String(outbox.id),
      projectId: context.projectId,
      stageKey: binding.stageKey,
      progressRevision: binding.progressRevision,
      body,
    };
    onSaved(saved);
    return saveReceipt(saved, false);
  });
}

async function deliverInApp(
  operation: PendingOperation,
  context: LiveRunContext,
  actor: ConstructionActor,
  saved: SavedReminder | null,
): Promise<Record<string, WorkflowValue>> {
  const binding = context.businessEvent;
  if (!binding) throw failure('stage_event_invalid', 'run has no fixed business event');
  if (!saved) throw failure('save_receipt_missing', 'delivery requires a confirmed save receipt');
  if (
    saved.projectId !== context.projectId
    || saved.stageKey !== binding.stageKey
    || saved.progressRevision !== binding.progressRevision
  ) {
    throw failure('stage_event_binding_mismatch', 'save receipt does not match the fixed business event');
  }
  const receivers = operation.input.receivers;
  if (!isPlainObject(receivers)) {
    throw failure('receiver_scope_mismatch', 'delivery receivers must be the host read object');
  }
  return withTenantTransaction(actor.enterpriseId, async (tx) => {
    // Re-check the requesting admin; a manager demoted after read must not
    // deliver. Conversation first, then project, matching the existing lock order.
    const owner = await constructionAccess(tx, actor);
    const conversation = await openCustomerConversation(
      tx,
      actor.enterpriseId,
      context.projectId,
      'update',
    );
    const access = await projectAccess(tx, actor, context.projectId, 'update', owner);
    assertProjectWrite(access);
    const project = access.project;
    if (!project.customer_access || project.status !== 'active') {
      return {
        delivered: false,
        deliveryReceipt: { receiptId: '', simulated: false, status: 'customer_access_revoked' },
      };
    }
    if (String(project.current_stage_key) !== saved.stageKey) {
      throw failure('stage_event_invalidated', 'the project has moved to another stage');
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

    const stageEvent = await one(
      tx,
      sql`select * from app.domain_event_outbox
        where enterprise_id=${actor.enterpriseId} and id=${saved.eventId}
          and type='construction.stage.updated.v1'
          and aggregate_type='construction_project' and aggregate_id=${context.projectId}`,
    );
    if (!stageEvent) throw failure('stage_event_not_found', 'the saved stage event no longer exists');
    if (!await currentStageEvent(tx, actor.enterpriseId, saved.eventId, true)) {
      throw failure('stage_event_invalidated', 'the saved stage event is no longer current');
    }

    const customerUserId = String(conversation.customer_user_id);
    const settings = await readStageSettings(tx, actor.enterpriseId);
    const result = await deliverStageReminderToConversation(
      tx,
      customerActor(actor.enterpriseId, customerUserId),
      project,
      stageEvent,
      conversation,
      settings,
    );
    if (result.reason === 'stage_event_invalid') {
      throw failure('stage_event_invalidated', 'the saved stage event is no longer current');
    }
    if (result.reason === 'conversation_invalid') {
      return {
        delivered: false,
        deliveryReceipt: { receiptId: '', simulated: false, status: 'conversation_invalid' },
      };
    }
    if (!result.delivered || !result.deliveryId || !result.messageId) {
      return {
        delivered: false,
        deliveryReceipt: {
          receiptId: result.deliveryId ?? '',
          simulated: false,
          source: 'domain_event_deliveries',
          eventId: saved.eventId,
          status: result.reason ?? 'delivery_not_confirmed',
        },
      };
    }
    return {
      delivered: true,
      deliveryReceipt: {
        receiptId: result.deliveryId,
        simulated: false,
        source: 'domain_event_deliveries',
        eventId: saved.eventId,
        messageId: result.messageId,
        conversationId: String(conversation.id),
        status: 'delivered',
        progressRevision: saved.progressRevision,
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
