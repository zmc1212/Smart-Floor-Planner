import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { fingerprint, type ActorContext } from '@/lib/assistant/contracts';
import { nextDelegationWake, type Delegation, type DelegationState, type DelegationTask } from './delegation-state';
import { nativeWorkflowEnabled, nativeWorkflowEnterpriseIds } from './tenant-allowlist';

export function delegationEnterprises(env = process.env) {
  return nativeWorkflowEnabled(env.NATIVE_WORKFLOW_DELEGATION_ENABLED)
    ? nativeWorkflowEnterpriseIds(env.NATIVE_WORKFLOW_DELEGATION_ENTERPRISE_IDS) : [];
}

export function delegationsEnabled(enterpriseId: string) {
  return delegationEnterprises().includes(enterpriseId);
}

export function delegationFromRow(row: Row): Delegation {
  return {
    id: String(row.id), enterpriseId: String(row.enterprise_id), projectId: String(row.project_id),
    requesterId: String(row.requester_id), conversationId: String(row.conversation_id), originMessageId: String(row.origin_message_id),
    originHash: String(row.origin_hash), goal: String(row.goal), authorization: row.authorization_scope as Delegation['authorization'],
    state: row.state as DelegationState, tasks: row.tasks as DelegationTask[], expiresAt: new Date(row.expires_at as Date),
  };
}

export interface DelegationEvent {
  id: string;
  type: string;
  aggregateId: string;
  payload: Row;
}

export async function appendDelegationEvent(tx: PostgresTransaction, eid: string, type: string, aggregateId: string,
  revision: number, payload: Row, actor: Row = { kind: 'system' }) {
  const event = await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${eid},${type},'native_workflow_delegation',${aggregateId},${revision},${JSON.stringify(actor)}::jsonb,${aggregateId},${JSON.stringify(payload)}::jsonb)
    on conflict(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version) do nothing returning id`);
  return event ? String(event.id) : null;
}

export function delegationOwner(d: Delegation): ActorContext {
  return { enterpriseId: d.enterpriseId, principal: { kind: 'user', userId: d.requesterId }, contextVersion: 0, capabilities: [] };
}

/** Shared with projections. Live project/customer and the original owner
 * consent are checked before exposing any derived state. */
export async function delegationOrigin(tx: PostgresTransaction, d: Delegation, lock = false) {
  const origin = await one(tx, sql`select c.mode,c.entry_snapshot,p.status as project_status,p.current_stage_key,
      m.content as origin_content,e.status as enterprise_status,s.enabled as assistant_enabled, s.retention_days
    from app.assistant_conversations c
    join app.assistant_messages m on m.enterprise_id=c.enterprise_id and m.conversation_id=c.id
    join app.assistant_participants ap on ap.enterprise_id=c.enterprise_id and ap.conversation_id=c.id
      and ap.user_id=${d.requesterId} and ap.participant_role='owner' and ap.status='active'
    join app.construction_projects p on p.enterprise_id=c.enterprise_id and p.id=${d.projectId}
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    join app.enterprises e on e.id=c.enterprise_id
    left join app.assistant_enterprise_settings s on s.enterprise_id=c.enterprise_id
    where c.enterprise_id=${d.enterpriseId} and c.id=${d.conversationId}
      and c.purpose='customer_consultation' and c.status='open' and not coalesce((c.entry_snapshot->>'retentionRedacted')::boolean,false)
      and m.id=${d.originMessageId} and m.user_id=${d.requesterId} and m.author_kind='user'
      and p.customer_access and l.customer_user_id=${d.requesterId} and l.archived_at is null
      and (coalesce(c.entry_snapshot->>'kind','')<>'lead' or c.entry_snapshot->>'id'=l.id::text)
      ${lock ? sql`for share of m,ap,p,l,e` : sql``}`);
  return origin && origin.enterprise_status === 'active' && fingerprint(origin.origin_content) === d.originHash ? origin : null;
}

export async function saveDelegation(tx: PostgresTransaction, d: Delegation, tasks: readonly DelegationTask[],
  state: DelegationState, eventId: string, now: Date, nextAction: string | null, activate = false) {
  await tx.execute(sql`update app.native_workflow_delegations set tasks=${JSON.stringify(tasks)}::jsonb,state=${state},
    latest_event_id=${eventId},activation_event_id=case when ${activate} then ${eventId}::bigint else activation_event_id end,
    next_action=${nextAction},next_wake_at=${nextDelegationWake(state, tasks, d.expiresAt)},
    paused_at=case when ${state}='paused' then ${now}::timestamptz else null end,
    cancelled_at=case when ${state}='cancelled' then ${now}::timestamptz else cancelled_at end,updated_at=${now}
    where enterprise_id=${d.enterpriseId} and id=${d.id}`);
}

export async function linkDelegationEvent(tx: PostgresTransaction, d: Delegation, eventId: string,
  outcome: 'applied' | 'unchanged' | 'paused' | 'unavailable' | 'control', changes: unknown) {
  await tx.execute(sql`insert into app.native_workflow_delegation_events(enterprise_id,delegation_id,event_id,outcome,task_changes)
    values(${d.enterpriseId},${d.id},${eventId},${outcome},${JSON.stringify(changes)}::jsonb) on conflict do nothing`);
}
