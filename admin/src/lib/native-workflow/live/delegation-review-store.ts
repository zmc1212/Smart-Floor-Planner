import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, safeText, type ActorContext, type MessageContent } from '@/lib/assistant/contracts';
import { privateMemoryScope, type PrivateMemoryScope } from '@/lib/assistant/memory/scope';
import { completionCriteria, delegationKinds, delegationRefresh, nextWake, outcome, statusText,
  type ReviewDelegation, type DelegationKind, type DelegationOutcome, type DelegationScope, type DelegationStatus, type SpecialistWorkflowBinding } from './delegation-state';

import { appendDelegationEvent } from './delegation-store';

export type ReviewDelegationEvent = { id: string; type: string; aggregateId: string; aggregateVersion: number; projectId: string; payload: Row };
export type DelegationRequest = { kind: DelegationKind; room?: string; subject: string; quote: string; dueAt?: string };
export const delegationJson = (value: unknown) => JSON.stringify(value);

export function reviewDelegationFromRow(row: Row): ReviewDelegation {
  return {
    id: String(row.id), enterpriseId: String(row.enterprise_id), projectId: String(row.project_id),
    ownerId: String(row.owner_id), conversationId: String(row.conversation_id), originMessageId: String(row.origin_message_id),
    originHash: String(row.origin_hash), title: String(row.title), objective: String(row.objective), scope: row.scope as DelegationScope,
    completionCriteria: String(row.completion_criteria), status: row.current_status as DelegationStatus,
    assignedTo: row.assigned_to === null ? null : String(row.assigned_to), waitingFor: row.waiting_for as string | null,
    nextAction: String(row.next_action), dueAt: new Date(row.due_at as Date), nextWakeAt: row.next_wake_at ? new Date(row.next_wake_at as Date) : null,
    authorization: row.authorization_scope as ReviewDelegation['authorization'], evidence: row.evidence as ReviewDelegation['evidence'],
    version: Number(row.version), activationEventId: row.activation_event_id ? String(row.activation_event_id) : null,
    reminderStage: Number(row.reminder_stage), createdAt: new Date(row.created_at as Date), updatedAt: new Date(row.updated_at as Date),
    completedAt: row.completed_at ? new Date(row.completed_at as Date) : null,
  };
}

export function delegationActor(d: ReviewDelegation): ActorContext {
  return { enterpriseId: d.enterpriseId, principal: { kind: 'user', userId: d.ownerId }, contextVersion: 0, capabilities: [] };
}

/** A delegation survives client disconnects, but every use rechecks its original
 * conversation, exact owner message, role, project and active feature policy. */
export async function reviewDelegationOrigin(tx: PostgresTransaction, d: ReviewDelegation, conversation?: Row) {
  const c = conversation ?? await one(tx, sql`select * from app.assistant_conversations
    where enterprise_id=${d.enterpriseId} and id=${d.conversationId}`);
  if (!c || String(c.id) !== d.conversationId) return null;
  const scope = await privateMemoryScope(tx, delegationActor(d), c);
  if (!scope || scope.projectId !== d.projectId) return null;
  const source = await one(tx, sql`select content from app.assistant_messages where enterprise_id=${d.enterpriseId}
    and conversation_id=${d.conversationId} and id=${d.originMessageId} and user_id=${d.ownerId} and author_kind='user' for share`);
  return source && fingerprint(source.content) === d.originHash ? c : null;
}

export async function saveReviewDelegation(tx: PostgresTransaction, d: ReviewDelegation, next: DelegationOutcome, now: Date,
  options: { activate?: string; reminderStage?: number; dueAt?: Date } = {}) {
  const reminderStage = options.reminderStage ?? d.reminderStage, dueAt = options.dueAt ?? d.dueAt;
  const issueId = d.scope.issueId ?? (d.scope.kind === 'rectification_review' ? next.evidence?.issueId : null);
  const row = await one(tx, sql`update app.native_workflow_delegations set current_status=${next.status},state=app.native_delegation_review_state(${next.status}),assigned_to=${next.assignedTo},
    waiting_for=${next.waitingFor},next_action=${next.nextAction},evidence=${next.evidence ? delegationJson(next.evidence) : null}::jsonb,
    scope=jsonb_set(scope,'{issueId}',coalesce(to_jsonb(${issueId ?? null}::text),'null'::jsonb)),
    latest_event_id=greatest(latest_event_id,${options.activate ?? null}::bigint),
    activation_event_id=coalesce(${options.activate ?? null}::bigint,activation_event_id),
    reminder_stage=${reminderStage},due_at=${dueAt},next_wake_at=${nextWake({ dueAt, reminderStage }, next.status)},
    completed_at=case when ${next.status}='completed' then coalesce(completed_at,${now}::timestamptz) else null end,
    updated_at=${now},version=version+1 where enterprise_id=${d.enterpriseId} and id=${d.id} and version=${d.version} returning *`);
  if (!row) fail('delegation_version_conflict');
  return reviewDelegationFromRow(row);
}

export async function linkReviewDelegationEvent(tx: PostgresTransaction, before: ReviewDelegation | null, d: ReviewDelegation, eventId: string,
  result: 'applied' | 'unchanged' | 'paused' | 'unavailable' | 'control' | 'failed', receipt?: unknown) {
  await tx.execute(sql`insert into app.native_workflow_delegation_events
    (enterprise_id,delegation_id,event_id,from_status,to_status,delegation_version,outcome,receipt)
    values(${d.enterpriseId},${d.id},${eventId},${before?.status ?? null},${d.status},${d.version},${result},
      ${receipt == null ? null : delegationJson(receipt)}::jsonb) on conflict do nothing`);
}

function sourceAuthorizes(request: DelegationRequest, original: string) {
  const quote = request.quote.trim(), subject = request.subject.trim();
  // The model can classify and bind the user's request. An unrelated or
  // quoted example cannot grant a persistent background action.
  return delegationKinds.includes(request.kind) && quote.length > 0 && quote.length <= 800 && original.includes(quote)
    && subject.length > 0 && subject.length <= 80 && original.includes(subject)
    && (!request.room || original.includes(request.room))
    && !/假设|举例|举个例子|不用跟进|不要跟进|别跟进|取消|暂停|怎么委托|怎么跟进/u.test(original)
    && /跟进|盯一下|盯着|盯下|帮我.{0,14}(?:核对|核一下|确认|问问|留意|看看)|(?:等|让|请).{0,12}(?:设计师|师傅|工人).{0,14}(?:核对|核一下|看一下|回复|复核)|到时提醒我/u.test(original);
}

export class DelegationService {
  constructor(private readonly tx: PostgresTransaction, private readonly scope: PrivateMemoryScope) {}

  async create(messageId: string, request: DelegationRequest, now = new Date(), workflow?: SpecialistWorkflowBinding) {
    const { enterpriseId, ownerId, conversationId, projectId } = this.scope;
    if (!projectId) fail('delegation_project_required', 422);
    const source = await one(this.tx, sql`select content from app.assistant_messages where enterprise_id=${enterpriseId}
      and conversation_id=${conversationId} and id=${messageId} and author_kind='user' and user_id=${ownerId} for share`);
    const original = source ? safeText(source.content as MessageContent) : '';
    if (!source || !sourceAuthorizes(request, original)) fail('delegation_source_mismatch', 422);
    const rooms = request.room ? await rows(this.tx, sql`select id::text,name from app.construction_rooms
      where enterprise_id=${enterpriseId} and project_id=${projectId} and name=${request.room} limit 2 for share`) : [];
    const room = rooms.length === 1 ? rooms[0] : null;
    if ((!room && ['room_progress','design_review','rectification_review'].includes(request.kind)) || request.room && !room)
      fail('delegation_room_required', 422);
    const subject = request.subject.trim();
    const scope: DelegationScope = { kind: request.kind, roomId: room ? String(room.id) : null,
      roomName: room ? String(room.name) : '', subject, issueId: null, ...(workflow ? { workflow } : {}) };
    const dueAt = new Date(now.getTime() + 48 * 3600_000);
    if (request.dueAt) {
      // A model-supplied date must appear literally in the owner message. The
      // normal fallback is a reminder window, with no promise from the team.
      const date = new Date(request.dueAt);
      if (!Number.isFinite(date.getTime()) || date <= now || !original.includes(request.dueAt)) fail('delegation_due_date_unconfirmed', 422);
      dueAt.setTime(date.getTime());
    }
    const operationKey = fingerprint({ projectId, kind: scope.kind, roomId: scope.roomId, subject: subject.normalize('NFKC').toLowerCase(), ...(workflow ? { workflow: workflow.templateId } : {}) });
    await this.tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'native-delegation:' + enterpriseId + ':' + conversationId + ':' + operationKey},0))`);
    const existing = await one(this.tx, sql`select * from app.native_workflow_delegations
      where enterprise_id=${enterpriseId} and owner_id=${ownerId} and project_id=${projectId} and conversation_id=${conversationId}
        and (scope - 'issueId' - 'workflow')=(${delegationJson(scope)}::jsonb - 'issueId' - 'workflow')
        and coalesce(scope#>>'{workflow,templateId}','')=${workflow?.templateId ?? ''}
        and (origin_message_id=${messageId} or current_status not in ('cancelled','completed'))
      order by (origin_message_id=${messageId}) desc,created_at desc,id limit 1 for share`);
    if (existing) {
      const d = reviewDelegationFromRow(existing);
      if (!await reviewDelegationOrigin(this.tx, d)) fail('delegation_origin_unavailable', 409);
      return d;
    }
    const title = [scope.roomName, subject].filter(Boolean).join(' · ');
    const row = await one(this.tx, sql`insert into app.native_workflow_delegations
      (enterprise_id,project_id,requester_id,owner_id,conversation_id,origin_message_id,origin_hash,goal,title,objective,scope,completion_criteria,
        state,tasks,expires_at,current_status,next_action,due_at,authorization_scope,operation_key)
      values(${enterpriseId},${projectId},${ownerId},${ownerId},${conversationId},${messageId},${fingerprint(source.content)},${title},${title},${request.quote.trim()},
        ${delegationJson(scope)}::jsonb,${completionCriteria[scope.kind]},'active','[]'::jsonb,${dueAt},'pending',${statusText.pending},${dueAt},
        '{"inAppReminder":true,"share":"existing_project_grants"}'::jsonb,${fingerprint({ operationKey, messageId })}) returning *`);
    const d = reviewDelegationFromRow(row!);
    const eventId = (await appendDelegationEvent(this.tx, enterpriseId, delegationRefresh, d.id, 1,
      { delegationId: d.id, projectId, action: 'start' }, { kind: 'user', userId: ownerId }))!;
    await this.tx.execute(sql`update app.native_workflow_delegations set activation_event_id=${eventId}
      where enterprise_id=${enterpriseId} and id=${d.id}`);
    const auditId = (await appendDelegationEvent(this.tx, enterpriseId, 'native.delegation.control.v1', d.id, 1,
      { delegationId: d.id, projectId, action: 'start', sourceMessageId: messageId }, { kind: 'user', userId: ownerId }))!;
    await linkReviewDelegationEvent(this.tx, null, d, auditId, 'control', { action: 'start', sourceMessageId: messageId });
    return { ...d, activationEventId: eventId };
  }

  async find(id: string, lock = false) {
    const { enterpriseId, ownerId, projectId } = this.scope;
    if (!projectId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return null;
    const row = await one(this.tx, sql`select * from app.native_workflow_delegations
      where enterprise_id=${enterpriseId} and owner_id=${ownerId} and project_id=${projectId} and id=${id}
      ${lock ? sql`for update` : sql``}`);
    return row ? reviewDelegationFromRow(row) : null;
  }

  async list(originalConversationOnly = false) {
    const { enterpriseId, ownerId, projectId } = this.scope;
    if (!projectId) return [];
    const items = await rows(this.tx, sql`select * from app.native_workflow_delegations where enterprise_id=${enterpriseId}
      and owner_id=${ownerId} and project_id=${projectId}
      ${originalConversationOnly ? sql`and conversation_id=${this.scope.conversationId}` : sql``}
      order by updated_at desc,id limit 24`);
    const result: ReviewDelegation[] = [];
    for (const row of items) {
      const d = reviewDelegationFromRow(row);
      if (await reviewDelegationOrigin(this.tx, d)) result.push(d);
    }
    return result;
  }
}

export function controlOutcome(action: 'pause' | 'resume' | 'cancel', status: DelegationStatus) {
  if (status === 'cancelled' || status === 'completed') return null;
  if (action === 'pause' && status !== 'paused') return outcome('paused');
  if (action === 'cancel') return outcome('cancelled');
  if (action === 'resume' && ['paused','failed','waiting_for_authorization','waiting_for_external','waiting_for_user',
    'waiting_for_worker','waiting_for_designer','running'].includes(status)) return outcome('pending');
  return null;
}
