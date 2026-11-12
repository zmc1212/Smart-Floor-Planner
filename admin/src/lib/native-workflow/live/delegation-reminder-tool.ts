import { sql } from 'drizzle-orm';
import { one } from '@/db/repositories/assistant-repository';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { WorkflowOperationError } from '../errors';
import { delegationOwnerPurpose, delegationReminderKey, sendDelegationOwnerReminder } from './delegation-chat';
import { delegationIsTerminal, delegationNotice, delegationTimeout, type Delegation, type DelegationTask, type DelegationWait } from './delegation-state';
import { appendDelegationEvent, delegationEnterprises, delegationFromRow, delegationOrigin, linkDelegationEvent } from './delegation-store';
import { assertPostgresDurableTaskLease, createPostgresDurableTaskStore } from './durable-task-postgres-store';
import { createDurableTaskRuntime } from './durable-task-runtime';
import {
  persistDurableToolRequest, type DurableToolDispatchInput, type DurableToolPort,
  type DurableToolProbeResult, type DurableToolSaveInput, type DurableToolWritebackInput,
} from './durable-tool-execution';
import { nativeWorkflowEnabled } from './tenant-allowlist';
import { nativeStoreBackend } from './runtime-stores';

export const delegationReminderTool = 'native.delegation.owner_reminder.v1';
export const delegationReminderResult = 'native.delegation.reminder.result.v1';
export const nativeToolResultConsumer = 'native.tool.result.v1';
export const reminderUnavailable = 'delegation_reminder_unavailable';

export function durableDelegationToolEnabled(env = process.env): boolean {
  if (!nativeWorkflowEnabled(env.NATIVE_WORKFLOW_DURABLE_TOOL_ENABLED)) return false;
  if (nativeStoreBackend(env.NATIVE_WORKFLOW_TASK_STORE) !== 'postgres') {
    throw new WorkflowOperationError('durable_tool_postgres_required', 503, 'durable delegation tools require the PostgreSQL task store');
  }
  return true;
}

export async function stageDelegationReminder(
  tx: PostgresTransaction, d: Delegation, task: DelegationTask, wait: DelegationWait, eventId: string, now: Date,
) {
  const runtime = createDurableTaskRuntime({ store: createPostgresDurableTaskStore({ tx, enterpriseId: d.enterpriseId }) });
  await persistDurableToolRequest(runtime, {
    enterpriseId: d.enterpriseId, projectId: d.projectId,
    tool: delegationReminderTool, idempotencyKey: delegationReminderKey(d, task, wait),
    delegation: { requestedBy: d.requesterId, conversationId: d.conversationId, messageId: d.originMessageId, runId: null, delegationId: d.id },
    authorization: { allowed: true, actorId: d.requesterId, checkedAt: now.toISOString(), scope: 'delegation.remindOwner', reason: null },
    payload: { delegationId: d.id, taskKey: task.key, waitKey: wait.key, timeoutEventId: eventId },
    effect: 'deliver', workerId: 'assistant-worker',
    timeouts: { attemptTimeoutMs: 30_000, externalCallTimeoutMs: 2_500 },
  });
}

async function lockedDelegation(tx: PostgresTransaction, enterpriseId: string, delegationId: string): Promise<Delegation | null> {
  const row = await one(tx, sql`select conversation_id from app.native_workflow_delegations
    where enterprise_id=${enterpriseId} and id::text=${delegationId}`);
  if (!row) return null;
  // Same lock order as the delegation consumer and the conversation API.
  await one(tx, sql`select id from app.assistant_conversations where enterprise_id=${enterpriseId}
    and id=${String(row.conversation_id)} for update`);
  const current = await one(tx, sql`select * from app.native_workflow_delegations
    where enterprise_id=${enterpriseId} and id::text=${delegationId} for update`);
  return current ? delegationFromRow(current) : null;
}

async function authorizedWait(tx: PostgresTransaction, d: Delegation, input: DurableToolDispatchInput) {
  const task = d.tasks.find((entry) => entry.key === input.payload.taskKey);
  const wait = task?.wait;
  if (input.projectId !== d.projectId || !d.authorization.remindOwner || d.state === 'paused'
    || delegationIsTerminal(d.state) || d.expiresAt <= new Date()
    || !task || !wait || wait.key !== input.payload.waitKey || !wait.timedOutAt
    || wait.for !== 'owner' || wait.personId !== d.requesterId
    || delegationReminderKey(d, task, wait) !== input.idempotencyKey) return null;
  const timeout = await one(tx, sql`select e.id from app.native_workflow_delegation_events a
    join app.domain_event_outbox e on e.enterprise_id=a.enterprise_id and e.id=a.event_id
    where a.enterprise_id=${d.enterpriseId} and a.delegation_id=${d.id} and a.outcome='applied'
      and e.type=${delegationTimeout} and e.id::text=${String(input.payload.timeoutEventId)}
      and e.payload->>'taskKey'=${task.key} and e.payload->>'waitKey'=${wait.key}`);
  if (!timeout) return null;
  const settings = await one(tx, sql`select enabled,retention_days from app.assistant_enterprise_settings
    where enterprise_id=${d.enterpriseId} for share`);
  const origin = await delegationOrigin(tx, d, true);
  return origin?.mode === 'ai' && origin.project_status === 'active' && settings?.enabled === true
    && Number(settings.retention_days) >= 1 ? { task, wait } : null;
}

async function existingNotice(tx: PostgresTransaction, d: Delegation, key: string) {
  return one<{ id: string }>(tx, sql`select m.id::text from app.domain_event_outbox e
    join app.assistant_messages m on m.enterprise_id=e.enterprise_id and m.source_event_id=e.id
    where e.enterprise_id=${d.enterpriseId} and e.type=${delegationNotice}
      and e.aggregate_type='native_workflow_delegation' and e.aggregate_id=${key} and e.aggregate_version=1
      and e.payload->>'delegationId'=${d.id} and m.conversation_id=${d.conversationId}
      and m.reply_to_message_id=${d.originMessageId} and m.purpose=${delegationOwnerPurpose}`);
}

interface ReminderResultRow {
  id: string;
  delegation_id: string;
  message_id: string | null;
  error_code: string | null;
}

function executionResult(row: ReminderResultRow): DurableToolProbeResult {
  if (!row.message_id) return { status: 'failed', errorCode: row.error_code ?? reminderUnavailable };
  return { status: 'succeeded', result: { eventId: row.id, messageId: row.message_id } };
}

async function verifiedResult(tx: PostgresTransaction, input: DurableToolSaveInput | DurableToolWritebackInput) {
  const row = await one<{ event_id: string; message_id: string; delegation_id: string }>(tx, sql`
    select e.id::text as event_id,m.id::text as message_id,d.id::text as delegation_id
    from app.domain_event_outbox e
    join app.native_workflow_delegations d on d.enterprise_id=e.enterprise_id and d.id::text=e.payload->>'delegationId'
    join app.assistant_messages m on m.enterprise_id=d.enterprise_id and m.conversation_id=d.conversation_id
      and m.reply_to_message_id=d.origin_message_id and m.id::text=e.payload->>'messageId'
    join app.domain_event_outbox n on n.enterprise_id=m.enterprise_id and n.id=m.source_event_id
      and n.type=${delegationNotice} and n.payload->>'delegationId'=d.id::text
    where e.enterprise_id=${input.enterpriseId} and e.type=${delegationReminderResult}
      and e.id::text=${String(input.result?.eventId)} and e.payload->>'taskId'=${input.taskId}
      and d.project_id::text=${input.projectId} and m.id::text=${String(input.result?.messageId)}
      and m.purpose=${delegationOwnerPurpose}`);
  if (!row) throw new WorkflowOperationError('delegation_tool_receipt_missing', 409, 'original reminder receipt was not found');
  return row;
}

export function createDelegationReminderPort(env = process.env): DurableToolPort {
  return {
    dispatch: (input) => withTenantTransaction(input.enterpriseId, async (tx) => {
      await tx.execute(sql`set local lock_timeout='1500ms'`);
      const d = await lockedDelegation(tx, input.enterpriseId, String(input.payload.delegationId));
      await assertPostgresDurableTaskLease(tx, input.enterpriseId, input.taskId, input.lease);
      const enabled = input.tool === delegationReminderTool && durableDelegationToolEnabled(env)
        && delegationEnterprises(env).includes(input.enterpriseId);
      const allowed = enabled && d ? await authorizedWait(tx, d, input) : null;
      let messageId: string | null = null;
      let adopted = false;
      if (allowed && d) {
        const existing = await existingNotice(tx, d, input.idempotencyKey);
        adopted = Boolean(existing);
        const message = existing ?? await sendDelegationOwnerReminder(tx, d, allowed.task, allowed.wait);
        if (!message) throw new WorkflowOperationError('delegation_tool_receipt_missing', 409, 'reminder receipt was not written');
        messageId = String(message.id);
      }
      const errorCode = messageId ? null : reminderUnavailable;
      const eventId = await appendDelegationEvent(tx, input.enterpriseId, delegationReminderResult,
        `${input.taskId}:${input.dispatchId}`, 1, {
          delegationId: String(input.payload.delegationId), projectId: input.projectId,
          taskId: input.taskId, dispatchId: input.dispatchId, messageId, errorCode,
        });
      if (!eventId) throw new WorkflowOperationError('delegation_tool_receipt_conflict', 409, 'dispatch result key already exists');
      await tx.execute(sql`insert into app.domain_event_deliveries(enterprise_id,event_id,consumer_key)
        values (${input.enterpriseId},${eventId},${nativeToolResultConsumer})`);
      if (!messageId && d) await linkDelegationEvent(tx, d, eventId, 'unavailable', { taskId: input.taskId, errorCode });
      // The business write and its async receipt commit together. An already
      // saved notice can also be adopted as a synchronous result.
      if (!messageId) return { externalId: eventId, receipt: { status: 'failed', errorCode: reminderUnavailable } };
      if (adopted) return { externalId: eventId, receipt: { status: 'succeeded', result: { eventId, messageId } } };
      return { externalId: eventId };
    }),
    probe: (input) => withTenantTransaction(input.enterpriseId, async (tx) => {
      const row = await one<ReminderResultRow>(tx, sql`select id::text,payload->>'delegationId' as delegation_id,
        payload->>'messageId' as message_id,payload->>'errorCode' as error_code
        from app.domain_event_outbox where enterprise_id=${input.enterpriseId} and type=${delegationReminderResult}
          and aggregate_type='native_workflow_delegation' and aggregate_id=${`${input.taskId}:${input.dispatchId}`}
          and aggregate_version=1 and payload->>'projectId'=${input.projectId}`);
      return row ? executionResult(row) : { status: 'unknown' };
    }),
    saveResult: (input) => withTenantTransaction(input.enterpriseId, async (tx) => {
      await assertPostgresDurableTaskLease(tx, input.enterpriseId, input.taskId, input.lease);
      const row = await verifiedResult(tx, input);
      return { savedId: row.message_id };
    }),
    writeback: (input) => withTenantTransaction(input.enterpriseId, async (tx) => {
      await assertPostgresDurableTaskLease(tx, input.enterpriseId, input.taskId, input.lease);
      const row = await verifiedResult(tx, input);
      if (row.message_id !== input.savedId) throw new WorkflowOperationError('delegation_tool_receipt_conflict', 409, 'saved reminder receipt changed');
      const d = { enterpriseId: input.enterpriseId, id: row.delegation_id };
      await linkDelegationEvent(tx, d, row.event_id, 'applied', { taskId: input.taskId, messageId: input.savedId });
    }),
  };
}
