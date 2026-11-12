
import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fingerprint } from '@/lib/assistant/contracts';
import { syncSiteResults } from '@/lib/construction/site-results';
import { delegationReceipt, delegationSummary } from './delegation-chat';
import { delegationEnterprises } from './delegation-config';
import { delegationConsumer, delegationExternalResult, delegationOwnerInput, delegationRefresh, delegationTimeout,
  isSuspended, isWaiting, outcome, type Delegation, type DelegationOutcome } from './delegation-state';
import { appendDelegationEvent, delegationActor, delegationFromRow, delegationOrigin, linkDelegationEvent, saveDelegation, type DelegationEvent } from './delegation-store';
import { observeDelegation } from './delegation-sources';
import { queueDelegationStaffNotice } from './delegation-staff';

const maxAttempts = 5;
const batchSize = 12;
type Options = { now?: Date; observe?: typeof observeDelegation };

async function enqueueDue(tx: PostgresTransaction, eid: string, now: Date) {
  const due = await rows(tx, sql`select id::text,project_id::text,version,reminder_stage from app.native_workflow_delegations
    where enterprise_id=${eid} and next_wake_at<=${now}
    order by next_wake_at,id limit ${batchSize}`);
  for (const item of due) {
    await appendDelegationEvent(tx, eid, delegationTimeout, String(item.id), Number(item.version),
      { delegationId: String(item.id), projectId: String(item.project_id), reminderStage: Number(item.reminder_stage) });
  }
}

function relevant(d: Delegation, event: DelegationEvent) {
  if (event.payload.delegationId) return event.payload.delegationId === d.id;
  if (event.type === delegationOwnerInput) return event.payload.ownerId === d.ownerId && d.scope.kind !== 'external_review'
    && (event.payload.conversationId === d.conversationId || event.payload.memoryChanged === true && d.scope.kind === 'design_review');
  if (event.type === delegationExternalResult) return d.scope.kind === 'external_review' && event.payload.conversationId === d.conversationId;
  const roomId = event.payload.roomId;
  if (roomId && d.scope.roomId && roomId !== d.scope.roomId) return false;
  const issueId = event.payload.issueId;
  const boundIssue = d.scope.issueId ?? d.evidence?.issueId;
  if (issueId && boundIssue && issueId !== boundIssue) return false;
  return ['room_progress','design_review','rectification_review'].includes(d.scope.kind);
}

async function candidates(tx: PostgresTransaction, eid: string, event: DelegationEvent) {
  const target = event.payload.delegationId;
  if (!/^[1-9]\d{0,17}$/.test(event.projectId)) return [];
  return rows(tx, sql`select id::text,conversation_id::text from app.native_workflow_delegations
    where enterprise_id=${eid} and project_id=${event.projectId} and current_status not in ('cancelled','failed')
      and (activation_event_id is null or activation_event_id<=${event.id})
      ${typeof target === 'string' ? sql`and id::text=${target}` : sql``}
    order by conversation_id,id`);
}

async function applyEvent(tx: PostgresTransaction, eid: string, event: DelegationEvent, now: Date, observe: typeof observeDelegation) {
  let applied = 0;
  const tasks = await candidates(tx, eid, event);
  if (!tasks.length) return applied;
  // Match the chat path's settings -> conversation -> delegation lock order.
  await one(tx, sql`select enterprise_id from app.assistant_enterprise_settings where enterprise_id=${eid} for share`);
  for (const candidate of tasks) {
    const conversation = await one(tx, sql`select * from app.assistant_conversations
      where enterprise_id=${eid} and id=${String(candidate.conversation_id)} for update`);
    const row = await one(tx, sql`select * from app.native_workflow_delegations
      where enterprise_id=${eid} and id=${String(candidate.id)} for update`);
    if (!conversation || !row) continue;
    const d = delegationFromRow(row);
    if (!relevant(d, event) || await one(tx, sql`select event_id from app.native_workflow_delegation_events
      where enterprise_id=${eid} and delegation_id=${d.id} and event_id=${event.id}`)) continue;
    if (isSuspended(d.status) || d.activationEventId && BigInt(d.activationEventId) > BigInt(event.id)) {
      await linkDelegationEvent(tx, d, d, event.id, 'paused');
      continue;
    }
    const origin = await delegationOrigin(tx, d, conversation);
    if (!origin) {
      const next = d.status === 'waiting_for_authorization' && d.nextAction === '项目权限或原咨询已变更，等业主恢复后重新核对'
        ? d : await saveDelegation(tx, d, outcome('waiting_for_authorization', '项目权限或原咨询已变更，等业主恢复后重新核对', 'owner'),
          now, { reminderStage: 2 });
      await linkDelegationEvent(tx, d, next, event.id, 'unavailable');
      continue;
    }
    if (event.type === delegationTimeout) {
      if (!d.nextWakeAt || d.nextWakeAt > now || event.payload.reminderStage !== d.reminderStage
        || (!isWaiting(d.status) && d.status !== 'running')) {
        await linkDelegationEvent(tx, d, d, event.id, 'unchanged');
        continue;
      }
      const stage = d.reminderStage + 1;
      const next = await saveDelegation(tx, d, d, now, { reminderStage: stage });
      const notice = d.authorization.inAppReminder ? await delegationReceipt(tx, next, 'due:' + d.id + ':' + event.id,
        stage === 1 ? '跟进提醒。' + delegationSummary(next)
          : '这项委托在提醒后仍待处理。请在原咨询补充资料，或通过工地入口联系项目负责人。' + delegationSummary(next)) : null;
      const escalation = stage === 2 ? await queueDelegationStaffNotice(tx, next, true) : null;
      await linkDelegationEvent(tx, d, next, event.id, 'applied', { reminderStage: stage, notice, escalation });
      applied++;
      continue;
    }
    if (event.type === 'construction.site.issue.result.v1' && event.payload.conversationId === d.conversationId
      && event.payload.customerId === d.ownerId) {
      await syncSiteResults(tx, delegationActor(d), origin, event.id);
    }
    const result = await observe(tx, d, origin, event, true);
    if (!result.ok) throw new Error(result.record.error?.code ?? 'delegation_tool_failed');
    const envelope = JSON.parse(result.content) as { result?: { next: DelegationOutcome; memoryRefs: unknown[]; standardCheck?: unknown } };
    if (!envelope.result) throw new Error('delegation_tool_result_unavailable');
    const { next, memoryRefs, standardCheck } = envelope.result;
    const before = { status: d.status, assignedTo: d.assignedTo, waitingFor: d.waitingFor, nextAction: d.nextAction, evidence: d.evidence };
    const changed = fingerprint(before) !== fingerprint(next);
    const saved = changed ? await saveDelegation(tx, d, next, now) : d;
    const notice = changed ? await delegationReceipt(tx, saved, d.id + ':' + event.id, delegationSummary(saved)) : null;
    const staffNotice = await queueDelegationStaffNotice(tx, saved);
    await linkDelegationEvent(tx, d, saved, event.id, changed ? 'applied' : 'unchanged', {
      tool: result.record.tool, status: result.status, operationKey: result.record.operationKey, resultHash: result.record.resultHash,
      evidence: next.evidence, memoryRefs, standardCheck, notice, staffNotice,
    });
    if (changed) applied++;
  }
  return applied;
}

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'delegation_event_failed';
  const detail = error as Error & { code?: string; cause?: unknown };
  if (detail.code && /^[0-9A-Z]{5}$/.test(detail.code)) return detail.code;
  if (/^(?:tool|delegation)_[a-z_]+$/.test(detail.message)) return detail.message;
  return detail.cause ? errorCode(detail.cause) : 'delegation_event_failed';
}

async function markTargetFailed(tx: PostgresTransaction, eid: string, event: DelegationEvent, now: Date, error: string) {
  if (event.type !== delegationRefresh || typeof event.payload.delegationId !== 'string') return;
  const target = await one(tx, sql`select conversation_id::text from app.native_workflow_delegations
    where enterprise_id=${eid} and project_id=${event.projectId} and id::text=${event.payload.delegationId}`);
  if (!target) return;
  await one(tx, sql`select id from app.assistant_conversations where enterprise_id=${eid}
    and id=${String(target.conversation_id)} for update`);
  const row = await one(tx, sql`select * from app.native_workflow_delegations
    where enterprise_id=${eid} and project_id=${event.projectId} and id::text=${event.payload.delegationId} for update`);
  if (!row) return;
  const d = delegationFromRow(row);
  if (d.activationEventId !== event.id || d.status !== 'pending') return;
  const next = await saveDelegation(tx, d, outcome('failed'), now);
  if (await delegationOrigin(tx, d)) await delegationReceipt(tx, next, d.id + ':' + event.id + ':dead', delegationSummary(next));
  await linkDelegationEvent(tx, d, next, event.id, 'failed', { error });
}

async function processOne(eid: string, now: Date, observe: typeof observeDelegation, enqueue: boolean) {
  return withTenantTransaction(eid, async tx => {
    const lock = await one(tx, sql`select pg_try_advisory_xact_lock(hashtextextended(${'native.delegation:' + eid},0)) as owned`);
    if (lock?.owned !== true) return { status: 'busy', applied: 0 };
    await tx.execute(sql`set local statement_timeout='8s'`);
    if (enqueue) await enqueueDue(tx, eid, now);
    const delivery = await one(tx, sql`select d.id::text as delivery_id,d.attempts,e.id::text,e.type,e.aggregate_id,e.aggregate_version,
        e.payload,coalesce(e.payload->>'projectId',parent.payload->>'projectId',r.project_id::text) as project_id,
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
      where d.enterprise_id=${eid} and d.consumer_key=${delegationConsumer} and d.status in ('pending','retry_wait') and d.available_at<=${now}
      order by d.event_id limit 1 for update of d skip locked`);
    if (!delivery) return { status: 'idle', applied: 0 };
    const event: DelegationEvent = { id: String(delivery.id), type: String(delivery.type), aggregateId: String(delivery.aggregate_id),
      aggregateVersion: Number(delivery.aggregate_version), projectId: String(delivery.project_id),
      payload: { ...delivery.payload as Row, ...(delivery.room_id ? { roomId: String(delivery.room_id) } : {}) } };
    if (event.type === 'construction.site.issue.opened.v1') event.payload.issueId = event.id;
    const id = String(delivery.delivery_id), attempts = Number(delivery.attempts) + 1;
    await tx.execute(sql`savepoint native_delegation_apply`);
    let status = 'delivered', applied = 0, availableAt = now, lastError: string | null = null;
    try {
      applied = await applyEvent(tx, eid, event, now, observe);
    } catch (error) {
      await tx.execute(sql`rollback to savepoint native_delegation_apply`);
      lastError = errorCode(error);
      status = attempts >= maxAttempts ? 'dead' : 'retry_wait';
      availableAt = new Date(now.getTime() + 1000 * 2 ** attempts);
      if (status === 'dead') await markTargetFailed(tx, eid, event, now, lastError);
    }
    await tx.execute(sql`release savepoint native_delegation_apply`);
    await tx.execute(sql`update app.domain_event_deliveries set status=${status},attempts=${attempts},available_at=${availableAt},
      last_error=${lastError},updated_at=${now},version=version+1 where enterprise_id=${eid} and id=${id}`);
    return { status, applied };
  });
}

export async function runDelegationTick(options: Options = {}) {
  const counts = { applied: 0, delivered: 0, retry_wait: 0, dead: 0, errors: 0 };
  for (const eid of delegationEnterprises()) {
    try {
      for (let i = 0; i < batchSize; i++) {
        const result = await processOne(eid, options.now ?? new Date(), options.observe ?? observeDelegation, i === 0);
        if (result.status === 'idle' || result.status === 'busy') break;
        if (result.status === 'delivered' || result.status === 'retry_wait' || result.status === 'dead') counts[result.status]++;
        counts.applied += result.applied;
      }
    } catch {
      counts.errors++;
    }
  }
  return counts;
}
