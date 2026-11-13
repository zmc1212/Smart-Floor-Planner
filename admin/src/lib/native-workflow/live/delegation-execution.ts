import { sql } from 'drizzle-orm';
import { one, type Row } from '@/db/repositories/assistant-repository';
import type { PostgresTransaction } from '@/db/transaction';
import { createPostgresDurableTaskStore } from './durable-task-postgres-store';
import { createDurableTaskRuntime, type DurableTaskLeaseRef } from './durable-task-runtime';
import { isTerminalDurableTaskStatus } from './durable-task-types';
import type { DelegationEvent } from './delegation-store';

export const delegationDeliveryKind = 'delegation.delivery';
export const delegationDeliveryAttempts = 5;
export const delegationDeliveryLeaseMs = 60_000;

function runtimeFor(tx: PostgresTransaction, enterpriseId: string) {
  return createDurableTaskRuntime({ store: createPostgresDurableTaskStore({ tx, enterpriseId }) });
}

/** Commit a claim before doing business work. The delivery is shared by both
 * delegation shapes and may affect several main delegation records. */
export async function claimDelegationDelivery(tx: PostgresTransaction, enterpriseId: string, deliveryId: string,
  event: DelegationEvent, projectId: string | null, principal: Row, owner: string) {
  const runtime = runtimeFor(tx, enterpriseId);
  const requestedBy = typeof principal.userId === 'string' ? principal.userId
    : typeof principal.adminId === 'string' ? principal.adminId : 'system';
  const target = typeof event.payload.delegationId === 'string'
    ? await one(tx, sql`select id::text,requester_id::text,conversation_id::text,origin_message_id::text
      from app.native_workflow_delegations where enterprise_id=${enterpriseId} and id::text=${event.payload.delegationId}`)
    : null;
  const { record } = await runtime.create({
    enterpriseId, projectId, kind: delegationDeliveryKind, businessKey: event.id,
    delegation: {
      requestedBy: target ? String(target.requester_id) : requestedBy,
      conversationId: target ? String(target.conversation_id) : null,
      messageId: target ? String(target.origin_message_id) : null, runId: null,
      ...(target ? { delegationId: String(target.id) } : {}),
    },
    timeouts: { taskTimeoutMs: 30 * 24 * 3600_000, attemptTimeoutMs: delegationDeliveryLeaseMs },
    retry: { maxAttempts: delegationDeliveryAttempts, baseDelayMs: 0, jitterRatio: 0 },
    data: { eventId: event.id, deliveryId },
  });
  const taskId = record.taskId;
  if (record.status === 'succeeded') return { status: 'delivered' as const };
  if (isTerminalDurableTaskStatus(record.status))
    return { status: 'dead' as const, error: record.lastError?.code ?? 'delegation_task_terminal' };
  if (record.status === 'running') {
    const recovered = await runtime.recover(enterpriseId, { taskId, kind: delegationDeliveryKind, limit: 1 });
    if (recovered.errors.length) throw new Error(recovered.errors[0].code);
  }
  await runtime.enqueue({ enterpriseId, taskId });
  const claim = await runtime.claim({ enterpriseId, taskId, owner, leaseTtlMs: delegationDeliveryLeaseMs });
  if (!claim) {
    const current = await runtime.get(enterpriseId, taskId);
    if (current && isTerminalDurableTaskStatus(current.status))
      return { status: 'dead' as const, error: current.lastError?.code ?? 'delegation_task_terminal' };
    return { status: 'busy' as const };
  }
  return { status: 'claimed' as const, fence: { enterpriseId, taskId, owner, token: claim.lease.token } };
}

export async function settleDelegationDelivery(tx: PostgresTransaction, fence: DurableTaskLeaseRef, applied: number,
  failure?: { code: string; exhausted: boolean }) {
  const runtime = runtimeFor(tx, fence.enterpriseId);
  if (!failure) {
    const result = await runtime.complete({ ...fence, data: { applied } });
    // Expiry cannot commit alongside business effects.
    if (result.status !== 'succeeded') throw new Error('delegation_task_lease_expired');
    return 'delivered';
  }
  const result = await runtime.fail({ ...fence, errorClass: failure.exhausted ? 'permanent' : 'transient',
    code: failure.code, message: 'delegation event transaction rolled back' });
  return isTerminalDurableTaskStatus(result.status) ? 'dead' : 'retry_wait';
}
