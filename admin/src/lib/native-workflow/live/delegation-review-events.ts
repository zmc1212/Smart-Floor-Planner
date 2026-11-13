import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { fingerprint } from '@/lib/assistant/contracts';
import { syncSiteResults } from '@/lib/construction/site-results';
import { delegationReceipt, delegationSummary } from './delegation-review-chat';
import { delegationExternalResult, delegationOwnerInput, delegationRefresh, delegationTimeout,
  isSuspended, isWaiting, outcome, type ReviewDelegation, type DelegationOutcome } from './delegation-state';
import { appendDelegationEvent } from './delegation-store';
import { delegationActor, reviewDelegationFromRow, reviewDelegationOrigin, linkReviewDelegationEvent, saveReviewDelegation, type ReviewDelegationEvent } from './delegation-review-store';
import { observeDelegation } from './delegation-sources';
import { advanceSpecialistDelegation } from './specialist-workflow';
import { queueDelegationStaffNotice } from './delegation-staff';

const batchSize = 12;

export async function enqueueReviewDue(tx: PostgresTransaction, eid: string, now: Date) {
  const due = await rows(tx, sql`select id::text,project_id::text,version,reminder_stage from app.native_workflow_delegations
    where enterprise_id=${eid} and scope is not null and next_wake_at<=${now}
    order by next_wake_at,id limit ${batchSize}`);
  for (const item of due) {
    await appendDelegationEvent(tx, eid, delegationTimeout, String(item.id), Number(item.version),
      { delegationId: String(item.id), projectId: String(item.project_id), reminderStage: Number(item.reminder_stage) });
  }
}

function relevant(d: ReviewDelegation, event: ReviewDelegationEvent) {
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

async function candidates(tx: PostgresTransaction, eid: string, event: ReviewDelegationEvent) {
  const target = event.payload.delegationId;
  if (!/^[1-9]\d{0,17}$/.test(event.projectId)) return [];
  return rows(tx, sql`select id::text,conversation_id::text from app.native_workflow_delegations
    where enterprise_id=${eid} and project_id=${event.projectId} and scope is not null and state not in ('cancelled','failed','expired')
      and (activation_event_id is null or activation_event_id<=${event.id})
      ${typeof target === 'string' ? sql`and id::text=${target}` : sql``}
    order by conversation_id,id`);
}

export async function applyReviewEvent(tx: PostgresTransaction, eid: string, event: ReviewDelegationEvent, now: Date, observe: typeof observeDelegation) {
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
    const d = reviewDelegationFromRow(row);
    if (!relevant(d, event) || await one(tx, sql`select event_id from app.native_workflow_delegation_events
      where enterprise_id=${eid} and delegation_id=${d.id} and event_id=${event.id}`)) continue;
    if (isSuspended(d.status) || d.activationEventId && BigInt(d.activationEventId) > BigInt(event.id)) {
      await linkReviewDelegationEvent(tx, d, d, event.id, 'paused');
      continue;
    }
    const origin = await reviewDelegationOrigin(tx, d, conversation);
    if (!origin) {
      const next = d.status === 'waiting_for_authorization' && d.nextAction === '项目权限或原咨询已变更，等业主恢复后重新核对'
        ? d : await saveReviewDelegation(tx, d, outcome('waiting_for_authorization', '项目权限或原咨询已变更，等业主恢复后重新核对', 'owner'),
          now, { reminderStage: 2 });
      await linkReviewDelegationEvent(tx, d, next, event.id, 'unavailable');
      continue;
    }
    if (event.type === delegationTimeout) {
      if (!d.nextWakeAt || d.nextWakeAt > now || event.payload.reminderStage !== d.reminderStage
        || (!isWaiting(d.status) && d.status !== 'running')) {
        await linkReviewDelegationEvent(tx, d, d, event.id, 'unchanged');
        continue;
      }
      const stage = d.reminderStage + 1;
      const next = await saveReviewDelegation(tx, d, d, now, { reminderStage: stage });
      const notice = d.authorization.inAppReminder ? await delegationReceipt(tx, next, 'due:' + d.id + ':' + event.id,
        stage === 1 ? '跟进提醒。' + delegationSummary(next)
          : '这项委托在提醒后仍待处理。请在原咨询补充资料，或通过工地入口联系项目负责人。' + delegationSummary(next)) : null;
      const escalation = stage === 2 ? await queueDelegationStaffNotice(tx, next, true) : null;
      await linkReviewDelegationEvent(tx, d, next, event.id, 'applied', { reminderStage: stage, notice, escalation });
      applied++;
      continue;
    }
    if (event.type === 'construction.site.issue.result.v1' && event.payload.conversationId === d.conversationId
      && event.payload.customerId === d.ownerId) {
      await syncSiteResults(tx, delegationActor(d), origin, event.id);
    }
    if (d.scope.workflow) {
      const next = await advanceSpecialistDelegation(tx, d, origin, event, now);
      const before = { status: d.status, assignedTo: d.assignedTo, waitingFor: d.waitingFor, nextAction: d.nextAction, evidence: d.evidence };
      const changed = fingerprint(before) !== fingerprint(next);
      const saved = changed ? await saveReviewDelegation(tx, d, next, now) : d;
      const notice = changed ? await delegationReceipt(tx, saved, d.id + ':' + event.id, delegationSummary(saved)) : null;
      await linkReviewDelegationEvent(tx, d, saved, event.id, changed ? 'applied' : 'unchanged', { notice, evidence: next.evidence });
      if (changed) applied++;
      continue;
    }
    const result = await observe(tx, d, origin, event, true);
    if (!result.ok) throw new Error(result.record.error?.code ?? 'delegation_tool_failed');
    const envelope = JSON.parse(result.content) as { result?: { next: DelegationOutcome; memoryRefs: unknown[]; standardCheck?: unknown } };
    if (!envelope.result) throw new Error('delegation_tool_result_unavailable');
    const { next, memoryRefs, standardCheck } = envelope.result;
    const before = { status: d.status, assignedTo: d.assignedTo, waitingFor: d.waitingFor, nextAction: d.nextAction, evidence: d.evidence };
    const changed = fingerprint(before) !== fingerprint(next);
    const saved = changed ? await saveReviewDelegation(tx, d, next, now) : d;
    const notice = changed ? await delegationReceipt(tx, saved, d.id + ':' + event.id, delegationSummary(saved)) : null;
    const staffNotice = await queueDelegationStaffNotice(tx, saved);
    await linkReviewDelegationEvent(tx, d, saved, event.id, changed ? 'applied' : 'unchanged', {
      tool: result.record.tool, status: result.status, operationKey: result.record.operationKey, resultHash: result.record.resultHash,
      evidence: next.evidence, memoryRefs, standardCheck, notice, staffNotice,
    });
    if (changed) applied++;
  }
  return applied;
}

export async function markReviewTargetFailed(tx: PostgresTransaction, eid: string, event: ReviewDelegationEvent, now: Date, error: string) {
  if (event.type !== delegationRefresh || typeof event.payload.delegationId !== 'string') return;
  const target = await one(tx, sql`select conversation_id::text from app.native_workflow_delegations
    where enterprise_id=${eid} and project_id=${event.projectId} and scope is not null and id::text=${event.payload.delegationId}`);
  if (!target) return;
  await one(tx, sql`select id from app.assistant_conversations where enterprise_id=${eid}
    and id=${String(target.conversation_id)} for update`);
  const row = await one(tx, sql`select * from app.native_workflow_delegations
    where enterprise_id=${eid} and project_id=${event.projectId} and scope is not null and id::text=${event.payload.delegationId} for update`);
  if (!row) return;
  const d = reviewDelegationFromRow(row);
  if (d.activationEventId !== event.id || d.status !== 'pending') return;
  const next = await saveReviewDelegation(tx, d, outcome('failed'), now);
  if (await reviewDelegationOrigin(tx, d)) await delegationReceipt(tx, next, d.id + ':' + event.id + ':dead', delegationSummary(next));
  await linkReviewDelegationEvent(tx, d, next, event.id, 'failed', { error });
}
