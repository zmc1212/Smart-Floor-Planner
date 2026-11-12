import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fingerprint } from '@/lib/assistant/contracts';
import { collaborationEnabled } from '@/lib/construction/collaboration-scope';
import { delegationOwnerReceipt } from './delegation-chat';
import { affectsDelegationTask, delegationInput } from './delegation-inputs';
import { applyElectricalDelegationTask } from './electrical-delegation';
import { delegationConsumer, delegationTimeout, deriveDelegationState, type Delegation, type DelegationTask } from './delegation-state';
import { appendDelegationEvent, delegationEnterprises, delegationFromRow, delegationOrigin, linkDelegationEvent,
  saveDelegation, type DelegationEvent } from './delegation-store';

const eventAttempts = 5;
const batchSize = 12;

async function enqueueDue(tx: PostgresTransaction, eid: string, now: Date) {
  const due = await rows(tx, sql`select d.* from app.native_workflow_delegations d
    where d.enterprise_id=${eid} and d.next_wake_at<=${now} and (
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

async function elapsedWait(tx: PostgresTransaction, d: Delegation, task: DelegationTask, event: DelegationEvent, origin: Row, now: Date) {
  const wait = task.wait;
  if (task.key !== event.payload.taskKey || !wait || wait.key !== event.payload.waitKey || wait.timedOutAt
    || Date.parse(wait.deadlineAt) > now.getTime()) return task;
  if (d.authorization.remindOwner && wait.for === 'owner' && wait.personId === d.requesterId && origin.mode === 'ai') {
    await delegationOwnerReceipt(tx, d, `${d.id}:${task.key}:reminder:${wait.key}`,
      `提醒一下，${task.roomName}插座的跟进还在等你：${wait.requested.join('，')}。方便时在这次咨询补充即可。`,
      task.next === 'ask_owner' ? { waitKey: wait.key } : undefined);
  }
  return { ...task, wait: { ...wait, timedOutAt: now.toISOString() } };
}

async function applyEvent(tx: PostgresTransaction, eid: string, event: DelegationEvent, now: Date) {
  const input = await delegationInput(tx, eid, event);
  if (!input) return 0;
  const reopen = collaborationEnabled(eid) && event.type === 'construction.site.issue.lifecycle.v1' && event.payload.state === 'reopened' && input.issueId;
  const scope = sql`(state not in ('completed','failed','cancelled','expired') ${reopen ? sql`or (state='completed'
    and tasks @> ${JSON.stringify([{ issueId: reopen }])}::jsonb)` : sql``})`;
  const candidates = await rows(tx, sql`select id::text,conversation_id::text,tasks from app.native_workflow_delegations
    where enterprise_id=${eid} and ${scope}
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
      and ${scope} for update`);
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
      const next = !selected(task) ? task : input.kind === 'timeout' ? await elapsedWait(tx, d, task, event, origin, now)
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
  const details = error as { code?: unknown; cause?: unknown };
  return typeof details.code === 'string' && /^[0-9A-Z]{5}$/.test(details.code)
    ? details.code : details.cause ? databaseErrorCode(details.cause) : 'delegation_event_failed';
}

async function processOne(eid: string, now: Date, enqueue: boolean) {
  return withTenantTransaction(eid, async tx => {
    const lock = await one(tx, sql`select pg_try_advisory_xact_lock(hashtextextended(${'native.delegation:' + eid},0)) as owned`);
    if (lock?.owned !== true) return { status: 'busy' as const, applied: 0 };
    if (enqueue) await enqueueDue(tx, eid, now);
    // One short transaction owns the earliest open delivery. An earlier retry
    // is held until its due time; a dead receipt releases following events.
    const delivery = await one(tx, sql`select d.id::text as delivery_id,d.attempts,d.available_at,
        e.id::text,e.type,e.aggregate_id,e.payload
      from app.domain_event_deliveries d join app.domain_event_outbox e on e.enterprise_id=d.enterprise_id and e.id=d.event_id
      where d.enterprise_id=${eid} and d.consumer_key=${delegationConsumer} and d.status in ('pending','retry_wait')
      order by d.event_id limit 1 for update of d`);
    if (!delivery || (Number(delivery.attempts) > 0 && new Date(delivery.available_at as Date) > now))
      return { status: 'idle' as const, applied: 0 };

    const event: DelegationEvent = {
      id: String(delivery.id), type: String(delivery.type), aggregateId: String(delivery.aggregate_id),
      payload: delivery.payload as Row,
    };
    const id = String(delivery.delivery_id), attempt = Number(delivery.attempts) + 1;
    await tx.execute(sql`savepoint native_delegation_delivery`);
    try {
      await tx.execute(sql`set local lock_timeout='1500ms'`);
      const applied = await applyEvent(tx, eid, event, now);
      await tx.execute(sql`update app.domain_event_deliveries set status='delivered',attempts=${attempt},last_error=null,updated_at=${now}
        where enterprise_id=${eid} and id=${id}`);
      await tx.execute(sql`release savepoint native_delegation_delivery`);
      return { status: 'delivered' as const, applied };
    } catch (error) {
      await tx.execute(sql`rollback to savepoint native_delegation_delivery`);
      await tx.execute(sql`release savepoint native_delegation_delivery`);
      const status = attempt >= eventAttempts ? 'dead' : 'retry_wait';
      await tx.execute(sql`update app.domain_event_deliveries set status=${status},attempts=${attempt},
        available_at=${new Date(now.getTime() + 1000 * 2 ** attempt)},last_error=${databaseErrorCode(error)},updated_at=${now}
        where enterprise_id=${eid} and id=${id}`);
      return { status, applied: 0 };
    }
  });
}

export async function runNativeDelegationTick(env: NodeJS.ProcessEnv = process.env, now = new Date()) {
  const enterprises = delegationEnterprises(env);
  const results = [];
  for (const enterpriseId of enterprises) {
    const counters = { delivered: 0, applied: 0, retried: 0, dead: 0 };
    try {
      for (let index = 0; index < batchSize; index++) {
        const result = await processOne(enterpriseId, now, index === 0);
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
