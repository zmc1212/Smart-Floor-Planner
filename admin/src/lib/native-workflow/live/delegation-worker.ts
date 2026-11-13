import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fingerprint } from '@/lib/assistant/contracts';
import { collaborationEnabled } from '@/lib/construction/collaboration-scope';
import { sendDelegationOwnerReminder } from './delegation-chat';
import { durableDelegationToolEnabled, stageDelegationReminder } from './delegation-reminder-tool';
import { affectsDelegationTask, delegationInput } from './delegation-inputs';
import { applyElectricalDelegationTask } from './electrical-delegation';
import { applyReviewEvent, enqueueReviewDue, markReviewTargetFailed } from './delegation-review-events';
import { observeDelegation } from './delegation-sources';
import type { ReviewDelegationEvent } from './delegation-review-store';
import { delegationConsumer, delegationTimeout, deriveDelegationState, type Delegation, type DelegationTask } from './delegation-state';
import { appendDelegationEvent, delegationEnterprises, delegationFromRow, delegationOrigin, linkDelegationEvent,
  saveDelegation, type DelegationEvent } from './delegation-store';
import { claimDelegationDelivery, delegationDeliveryAttempts, settleDelegationDelivery } from './delegation-execution';
import { assertPostgresDurableTaskLease } from './durable-task-postgres-store';
import type { DurableTaskLeaseRef } from './durable-task-runtime';

const batchSize = 12;
type DeliveryResult = { status: 'idle' | 'busy' | 'delivered' | 'retry_wait' | 'dead'; applied: number };

async function enqueueDue(tx: PostgresTransaction, eid: string, now: Date) {
  const due = await rows(tx, sql`select d.* from app.native_workflow_delegations d
    where d.enterprise_id=${eid} and d.scope is null and d.next_wake_at<=${now} and (
      (d.expires_at<=${now} and not exists(select 1 from app.domain_event_outbox e
        where e.enterprise_id=d.enterprise_id and e.type=${delegationTimeout}
          and e.aggregate_type='native_workflow_delegation' and e.aggregate_id=d.id::text || ':expires'))
      or (d.expires_at>${now} and d.state<>'paused' and exists(
        select 1 from jsonb_array_elements(d.tasks) task
        where task->'wait'->>'timedOutAt' is null and (task->'wait'->>'deadlineAt')::timestamptz<=${now}
          and not exists(select 1 from app.domain_event_outbox e where e.enterprise_id=d.enterprise_id and e.type=${delegationTimeout}
            and e.aggregate_type='native_workflow_delegation'
            and e.aggregate_id=d.id::text || ':' || (task->>'key') || ':' || (task->'wait'->>'key'))
      ))
    ) order by d.next_wake_at,d.id limit ${batchSize}`);
  for (const row of due) {
    const d = delegationFromRow(row), scope = { delegationId: d.id, projectId: d.projectId };
    if (d.expiresAt <= now) {
      await appendDelegationEvent(tx, eid, delegationTimeout, d.id + ':expires', 1, { ...scope, expire: true });
    } else if (d.state !== 'paused') {
      for (const task of d.tasks) {
        if (!task.wait || task.wait.timedOutAt || Date.parse(task.wait.deadlineAt) > now.getTime()) continue;
        await appendDelegationEvent(tx, eid, delegationTimeout, `${d.id}:${task.key}:${task.wait.key}`, 1,
          { ...scope, taskKey: task.key, waitKey: task.wait.key });
      }
    }
  }
}

async function elapsedWait(tx: PostgresTransaction, d: Delegation, task: DelegationTask, event: DelegationEvent, origin: Row, now: Date, durableTool: boolean) {
  const wait = task.wait;
  if (task.key !== event.payload.taskKey || !wait || wait.key !== event.payload.waitKey || wait.timedOutAt
    || Date.parse(wait.deadlineAt) > now.getTime()) return task;
  if (d.authorization.remindOwner && wait.for === 'owner' && wait.personId === d.requesterId && origin.mode === 'ai') {
    if (durableTool) await stageDelegationReminder(tx, d, task, wait, event.id, now);
    else await sendDelegationOwnerReminder(tx, d, task, wait);
  }
  return { ...task, wait: { ...wait, timedOutAt: now.toISOString() } };
}

async function applyEvent(tx: PostgresTransaction, eid: string, event: DelegationEvent, now: Date, durableTool: boolean) {
  const input = await delegationInput(tx, eid, event);
  if (!input) return 0;
  const reopen = collaborationEnabled(eid) && event.type === 'construction.site.issue.lifecycle.v1' && event.payload.state === 'reopened' && input.issueId;
  const scope = sql`(state not in ('completed','failed','cancelled','expired') ${reopen ? sql`or (state='completed'
    and tasks @> ${JSON.stringify([{ issueId: reopen }])}::jsonb)` : sql``})`;
  const candidates = await rows(tx, sql`select id::text,conversation_id::text,tasks from app.native_workflow_delegations
    where enterprise_id=${eid} and app.native_workflow_delegations.scope is null and ${scope}
    ${input.projectId ? sql`and project_id=${input.projectId}` : sql`and conversation_id=${input.conversationId!}`}
    ${input.delegationId ? sql`and id=${input.delegationId}` : sql``} order by conversation_id,id`);
  let applied = 0;
  for (const candidate of candidates) {
    const selected = (task: DelegationTask) => affectsDelegationTask(input, task);
    if (!(candidate.tasks as DelegationTask[]).some(selected)) continue;
    // Same lock order as ConversationService.send. Pause/cancel and each
    // derived state/receipt therefore have a single database ordering.
    await one(tx, sql`select id from app.assistant_conversations where enterprise_id=${eid}
      and id=${String(candidate.conversation_id)} for update`);
    const row = await one(tx, sql`select * from app.native_workflow_delegations where enterprise_id=${eid} and id=${String(candidate.id)}
      and app.native_workflow_delegations.scope is null and ${scope} for update`);
    if (!row || await one(tx, sql`select event_id from app.native_workflow_delegation_events where enterprise_id=${eid}
      and delegation_id=${String(candidate.id)} and event_id=${event.id}`)) continue;
    const d = delegationFromRow(row);
    const affected = d.tasks.filter(selected);
    if (!affected.length) continue;
    const links = affected.map(task => ({ key: task.key, roomId: task.roomId }));
    if (d.expiresAt <= now) {
      await saveDelegation(tx, d, d.tasks, 'expired', event.id, now, null);
      await linkDelegationEvent(tx, d, event.id, 'applied', { from: d.state, to: 'expired', tasks: links });
      applied++;
      continue;
    }
    if (d.state === 'paused' || row.activation_event_id && BigInt(event.id) < BigInt(String(row.activation_event_id))) {
      await linkDelegationEvent(tx, d, event.id, 'paused', { tasks: links });
      continue;
    }
    const origin = await delegationOrigin(tx, d, true);
    if (!origin || origin.project_status !== 'active' || (origin.assistant_enabled !== true || Number(origin.retention_days) < 1) || row.next_action === 'resume_authorization') {
      if (row.next_action !== 'resume_authorization') {
        await saveDelegation(tx, d, d.tasks.map(task => ({ ...task, wait: undefined, staffNoticeId: undefined })),
          'blocked', event.id, now, 'resume_authorization');
      }
      await linkDelegationEvent(tx, d, event.id, 'unavailable', { tasks: links });
      continue;
    }
    const tasks: DelegationTask[] = [];
    const changes = [];
    for (const task of d.tasks) {
      const next = !selected(task) ? task : input.kind === 'timeout' ? await elapsedWait(tx, d, task, event, origin, now, durableTool)
        : await applyElectricalDelegationTask(tx, d, task, input, event, origin, now);
      tasks.push(next);
      if (fingerprint(task) !== fingerprint(next)) changes.push({ key: task.key, roomId: task.roomId, before: task, after: next });
    }
    const state = deriveDelegationState(tasks);
    const changed = changes.length > 0 || state !== d.state;
    if (changed) {
      await saveDelegation(tx, d, tasks, state, event.id, now, tasks.find(task => task.next !== 'done')?.next ?? null);
      applied++;
    }
    await linkDelegationEvent(tx, d, event.id, changed ? 'applied' : 'unchanged',
      { from: d.state, to: state, tasks: links, changes });
  }
  return applied;
}

function databaseErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'delegation_event_failed';
  const details = error as { code?: unknown; cause?: unknown; message?: unknown };
  if (typeof details.message === 'string' && /^(?:tool|delegation)_[a-z_]+$/.test(details.message)) return details.message;
  if (typeof details.code === 'string' && /^durable_task_[a-z_]+$/.test(details.code)) return details.code;
  return typeof details.code === 'string' && /^[0-9A-Z]{5}$/.test(details.code)
    ? details.code : details.cause ? databaseErrorCode(details.cause) : 'delegation_event_failed';
}

async function lockDelegationConsumer(tx: PostgresTransaction, eid: string) {
  const lock = await one(tx, sql`select pg_try_advisory_xact_lock(hashtextextended(${'native.delegation:' + eid},0)) as owned`);
  return lock?.owned === true;
}

async function nextDelivery(tx: PostgresTransaction, eid: string, now: Date, enqueue: boolean) {
  await tx.execute(sql`set local statement_timeout='8s'`);
  if (enqueue) {
    await enqueueDue(tx, eid, now);
    await enqueueReviewDue(tx, eid, now);
  }
  // One short transaction owns the earliest open delivery. An earlier retry
  // is held until its due time; a dead receipt releases following events.
  const delivery = await one(tx, sql`select d.id::text as delivery_id,d.attempts,d.available_at,
      e.id::text,e.type,e.aggregate_id,e.aggregate_version,e.payload,e.actor_ref,
      coalesce(e.payload->>'projectId',parent.payload->>'projectId',r.project_id::text) as project_id,
      coalesce(nullif(e.payload->>'roomId',''),parent.payload->>'roomId',issue.payload->>'roomId',r.room_id::text) as room_id
    from app.domain_event_deliveries d join app.domain_event_outbox e on e.enterprise_id=d.enterprise_id and e.id=d.event_id
    left join app.domain_event_outbox parent on parent.enterprise_id=e.enterprise_id and parent.id::text=e.aggregate_id
      and e.type in ('construction.material.revoked.v1','construction.plan.status.v1')
      and parent.type in ('construction.material.shared.v1','construction.plan.published.v1')
    left join app.domain_event_outbox issue on issue.enterprise_id=e.enterprise_id and issue.id::text=e.payload->>'issueId'
      and issue.type='construction.site.issue.opened.v1' and issue.payload->>'projectId'=e.payload->>'projectId'
    left join app.construction_site_records r on r.enterprise_id=e.enterprise_id
      and ((e.type='assistant.run.terminal.v1' and r.run_id::text=e.aggregate_id)
        or (e.aggregate_type='construction_site_record' and r.id::text=e.aggregate_id))
    where d.enterprise_id=${eid} and d.consumer_key=${delegationConsumer} and d.status in ('pending','retry_wait')
    order by d.event_id limit 1 for update of d`);
  if (!delivery || (Number(delivery.attempts) > 0 && new Date(delivery.available_at as Date) > now))
    return null;

  const event: DelegationEvent = {
    id: String(delivery.id), type: String(delivery.type), aggregateId: String(delivery.aggregate_id),
    payload: delivery.payload as Row,
  };
  const review: ReviewDelegationEvent = {
    ...event, aggregateVersion: Number(delivery.aggregate_version), projectId: String(delivery.project_id),
    payload: { ...event.payload, ...(delivery.room_id ? { roomId: String(delivery.room_id) } : {}) },
  };
  if (event.type === 'construction.site.issue.opened.v1') review.payload.issueId = event.id;
  return {
    id: String(delivery.delivery_id), attempt: Number(delivery.attempts) + 1,
    event, review, projectId: delivery.project_id ? String(delivery.project_id) : null,
    actor: delivery.actor_ref as Row,
  };
}

async function applyDelivery(tx: PostgresTransaction, eid: string, now: Date, delivery: NonNullable<Awaited<ReturnType<typeof nextDelivery>>>,
  durableTool: boolean, observe: typeof observeDelegation, fence: DurableTaskLeaseRef): Promise<DeliveryResult> {
  const { id, attempt, event, review } = delivery;
  await assertPostgresDurableTaskLease(tx, eid, fence.taskId, fence);
  await tx.execute(sql`savepoint native_delegation_delivery`);
  try {
    await tx.execute(sql`set local lock_timeout='1500ms'`);
    const reviewed = await applyReviewEvent(tx, eid, review, now, observe);
    const applied = reviewed + await applyEvent(tx, eid, event, now, durableTool);
    await settleDelegationDelivery(tx, fence, applied);
    await tx.execute(sql`update app.domain_event_deliveries set status='delivered',attempts=${attempt},last_error=null,updated_at=${now},version=version+1
      where enterprise_id=${eid} and id=${id}`);
    await tx.execute(sql`release savepoint native_delegation_delivery`);
    return { status: 'delivered', applied };
  } catch (error) {
    await tx.execute(sql`rollback to savepoint native_delegation_delivery`);
    await tx.execute(sql`release savepoint native_delegation_delivery`);
    const code = databaseErrorCode(error);
    const exhausted = attempt >= delegationDeliveryAttempts;
    const executionStatus = await settleDelegationDelivery(tx, fence, 0, { code, exhausted });
    const status = exhausted || executionStatus === 'dead' ? 'dead' : 'retry_wait';
    if (status === 'dead') await markReviewTargetFailed(tx, eid, review, now, code);
    await tx.execute(sql`update app.domain_event_deliveries set status=${status},attempts=${attempt},
      available_at=${new Date(now.getTime() + 1000 * 2 ** attempt)},last_error=${code},updated_at=${now},version=version+1
      where enterprise_id=${eid} and id=${id}`);
    return { status, applied: 0 };
  }
}

async function processOne(eid: string, now: Date, enqueue: boolean, durableTool: boolean, observe: typeof observeDelegation,
  workerId: string) {
  const prepared = await withTenantTransaction(eid, async tx => {
    if (!await lockDelegationConsumer(tx, eid)) return { status: 'busy' as const, applied: 0 };
    const delivery = await nextDelivery(tx, eid, now, enqueue);
    if (!delivery) return { status: 'idle' as const, applied: 0 };
    const claim = await claimDelegationDelivery(tx, eid, delivery.id, delivery.event, delivery.projectId, delivery.actor, workerId);
    if (claim.status === 'claimed') return { ...claim, delivery };
    if (claim.status !== 'busy') {
      if (claim.status === 'dead') await markReviewTargetFailed(tx, eid, delivery.review, now, claim.error);
      await tx.execute(sql`update app.domain_event_deliveries set status=${claim.status},
        last_error=${claim.status === 'dead' ? claim.error : null},updated_at=${now},version=version+1
        where enterprise_id=${eid} and id=${delivery.id}`);
    }
    return { status: claim.status, applied: 0 };
  });
  if (prepared.status !== 'claimed') return prepared;
  return withTenantTransaction(eid, async tx => {
    // Another Worker may briefly inspect the committed claim. Wait for that
    // transaction before locking the delivery, as in the original lock order.
    await tx.execute(sql`set local statement_timeout='8s'`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'native.delegation:' + eid},0))`);
    const delivery = await nextDelivery(tx, eid, now, false);
    if (!delivery || delivery.id !== prepared.delivery.id) throw new Error('delegation_delivery_changed');
    return applyDelivery(tx, eid, now, delivery, durableTool, observe, prepared.fence);
  });
}

export async function runNativeDelegationTick(env: NodeJS.ProcessEnv = process.env, now = new Date(), observe = observeDelegation) {
  const enterprises = delegationEnterprises(env);
  const workerId = 'native-delegation:' + randomUUID();
  const results = [];
  for (const enterpriseId of enterprises) {
    const counters = { delivered: 0, applied: 0, retried: 0, dead: 0 };
    try {
      for (let index = 0; index < batchSize; index++) {
        const result = await processOne(enterpriseId, now, index === 0, durableDelegationToolEnabled(env), observe, workerId);
        if (result.status === 'idle' || result.status === 'busy') break;
        if (result.status === 'delivered') {
          counters.delivered++;
          counters.applied += result.applied;
        } else if (result.status === 'dead') counters.dead++;
        else { counters.retried++; break; }
      }
      results.push({ enterpriseId, ...counters });
    } catch (error) {
      results.push({ enterpriseId, ...counters, error: databaseErrorCode(error) });
    }
  }
  return { enabled: enterprises.length > 0, enterprises: results };
}

/** Compatibility for the existing review acceptance driver. The worker and
 * advisory lock are shared with the runtime entry. */
export async function runDelegationTick({ now = new Date(), observe = observeDelegation } = {}) {
  const result = await runNativeDelegationTick(process.env, now, observe);
  return result.enterprises.reduce((counts, item) => ({
    delivered: counts.delivered + item.delivered, applied: counts.applied + item.applied,
    retry_wait: counts.retry_wait + item.retried, dead: counts.dead + item.dead,
    errors: counts.errors + ('error' in item ? 1 : 0),
  }), { delivered: 0, applied: 0, retry_wait: 0, dead: 0, errors: 0 });
}
