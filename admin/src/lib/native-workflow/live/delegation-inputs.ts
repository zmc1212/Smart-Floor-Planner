import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fingerprint, safeText, type ActorContext, type MessageContent } from '@/lib/assistant/contracts';
import type { NeedFact } from '@/lib/assistant/agent/memory';
import { availableNeedMemory } from '@/lib/assistant/agent/memory-sources';
import { sharedMaterials } from '@/lib/construction/site-materials';
import { siteAccessRevoked } from '@/lib/construction/site-access';
import { resolveSiteQuery } from '@/lib/construction/site-queries';
import { latestScheduleEvent } from '@/lib/construction/site-schedule';
import { collaborationEnabled } from '@/lib/construction/collaboration-scope';
import { delegationNotice, delegationRefresh, delegationRequirement, delegationTimeout, type Delegation, type DelegationEvidence, type DelegationTask } from './delegation-state';
import { appendDelegationEvent, delegationFromRow, delegationOrigin, delegationsEnabled, type DelegationEvent } from './delegation-store';

export const outletFields: readonly NeedFact['field'][] = ['desk', 'devices', 'use'];
export type DelegationReply = { delegationId: string; roomId: string; roomName: string };

export async function boundDelegationReply(tx: PostgresTransaction, actor: ActorContext, cid: string, messageId: string, raw: string): Promise<DelegationReply | null> {
  if (actor.principal.kind !== 'user' || !delegationsEnabled(actor.enterpriseId)) return null;
  const eid = actor.enterpriseId;
  const row = await one(tx, sql`select d.*,e.payload->>'waitKey' as question_key
    from app.assistant_messages m
    join lateral (select source_event_id from app.assistant_messages where enterprise_id=m.enterprise_id
      and conversation_id=m.conversation_id and seq<m.seq order by seq desc limit 1) prior on true
    join app.domain_event_outbox e on e.enterprise_id=m.enterprise_id and e.id=prior.source_event_id
    join app.native_workflow_delegations d on d.enterprise_id=e.enterprise_id and d.id::text=e.payload->>'delegationId'
    where m.enterprise_id=${eid} and m.conversation_id=${cid} and m.id=${messageId} and m.user_id=${actor.principal.userId}
      and e.type=${delegationNotice} and e.payload->>'waitKey' is not null and d.conversation_id=m.conversation_id
      and d.requester_id=m.user_id and d.state not in ('paused','completed','failed','cancelled','expired')`);
  if (!row) return null;
  const d = delegationFromRow(row), origin = await delegationOrigin(tx, d, true);
  if (origin?.project_status !== 'active' || origin.mode !== 'ai' || d.expiresAt <= new Date()) return null;
  const task = d.tasks.find(t => t.kind === 'outlet' && t.next === 'ask_owner' && t.wait?.key === row.question_key);
  if (!task) return null;
  const otherRooms = await rows(tx, sql`select name from app.construction_rooms
    where enterprise_id=${eid} and project_id=${d.projectId} and id<>${task.roomId}`);
  return otherRooms.some(room => raw.includes(String(room.name))) ? null
    : { delegationId: d.id, roomId: task.roomId, roomName: task.roomName };
}

export async function recordDelegationRequirements(tx: PostgresTransaction, actor: ActorContext, conversationId: string,
  messageId: string, operationId: string, changed: readonly NeedFact[], reply: DelegationReply | null) {
  if (actor.principal.kind !== 'user' || !delegationsEnabled(actor.enterpriseId)) return;
  const roomNames = [...new Set(changed.filter(fact => outletFields.includes(fact.field)).map(fact => fact.room))];
  if (!roomNames.length) return;
  if (!await one(tx, sql`select id from app.native_workflow_delegations where enterprise_id=${actor.enterpriseId}
    and conversation_id=${conversationId} and requester_id=${actor.principal.userId} and state not in ('completed','failed','cancelled','expired') limit 1`)) return;
  await appendDelegationEvent(tx, actor.enterpriseId, delegationRequirement, operationId, 1,
    { conversationId, messageId, roomNames, ...(reply ? { reply } : {}) }, actor.principal);
}

export interface DelegationInput {
  kind: 'refresh' | 'timeout' | 'record' | 'requirement' | 'material' | 'issue' | 'plan' | 'project';
  projectId?: string;
  conversationId?: string;
  delegationId?: string;
  roomIds?: string[];
  roomNames?: string[];
  recordId?: string;
  issueId?: string;
}

const recordTypes = new Set([
  'construction.record.captured.v1', 'construction.record.publish.v1', 'construction.record.edit.v1',
  'construction.record.withdraw.v1', 'construction.record.request_changes.v1', 'construction.record.resubmit.v1',
]);
const issueTypes = new Set(['construction.site.issue.opened.v1', 'construction.site.issue.progress.v1', 'construction.site.issue.lifecycle.v1']);

export async function delegationInput(tx: PostgresTransaction, eid: string, event: DelegationEvent): Promise<DelegationInput | null> {
  const p = event.payload;
  if (event.type === delegationRefresh || event.type === delegationTimeout) {
    return { kind: event.type === delegationRefresh ? 'refresh' : 'timeout', projectId: String(p.projectId), delegationId: String(p.delegationId) };
  }
  if (event.type === delegationRequirement) return { kind: 'requirement', conversationId: String(p.conversationId), roomNames: p.roomNames as string[] };
  if (event.type === 'assistant.run.terminal.v1' || recordTypes.has(event.type)) {
    const record = await one(tx, sql`select r.id::text,r.project_id::text,r.room_id::text,r.status,m.content
      from app.construction_site_records r join app.assistant_messages m on m.enterprise_id=r.enterprise_id and m.id=r.source_message_id
      where r.enterprise_id=${eid} and ${event.type === 'assistant.run.terminal.v1' ? sql`r.run_id=${event.aggregateId}` : sql`r.id=${String(p.recordId)} and r.project_id=${String(p.projectId)}`}`);
    if (!record) return null;
    const projectId = String(record.project_id), recordId = String(record.id);
    const roomId = record.room_id ? String(record.room_id) : record.status === 'organizing'
      ? (await resolveSiteQuery(tx, eid, projectId, safeText(record.content as MessageContent))).roomId : null;
    return { kind: 'record', projectId, recordId, roomIds: roomId ? [roomId] : [] };
  }
  if (event.type === 'construction.material.revoked.v1' || event.type === 'construction.plan.status.v1') {
    const material = event.type === 'construction.material.revoked.v1';
    const source = await one(tx, sql`select payload from app.domain_event_outbox where enterprise_id=${eid} and id=${event.aggregateId}
      and type=${material ? 'construction.material.shared.v1' : 'construction.plan.published.v1'}`);
    if (!source) return null;
    const ref = source.payload as Row;
    return { kind: material ? 'material' : 'plan', projectId: String(ref.projectId), roomIds: [String(ref.roomId)],
      ...(material ? {} : { issueId: String(ref.issueId) }) };
  }
  if (event.type === 'construction.material.shared.v1') return { kind: 'material', projectId: String(p.projectId), roomIds: [String(p.roomId)] };
  if (event.type === 'construction.plan.published.v1') return { kind: 'plan', projectId: String(p.projectId),
    roomIds: [String(p.roomId)], issueId: String(p.issueId) };
  if (issueTypes.has(event.type)) return { kind: 'issue', projectId: String(p.projectId),
    roomIds: p.roomId ? [String(p.roomId)] : [], issueId: event.type === 'construction.site.issue.opened.v1' ? event.id : event.aggregateId };
  if (event.type === 'construction.schedule.published.v1') return { kind: 'project', projectId: String(p.projectId) };
  if (event.type === 'construction.schedule.changed.v1') {
    const roomIds = p.operation === 'UPDATE' && (!p.previousRoomId || !p.currentRoomId) ? undefined
      : [...new Set([p.currentRoomId, p.previousRoomId].filter(Boolean).map(String))];
    return { kind: 'project', projectId: String(p.projectId), roomIds: roomIds?.length ? roomIds : undefined };
  }
  if (event.type === 'construction.project.changed.v1') return { kind: 'project', projectId: String(p.projectId),
    roomIds: p.roomId ? [String(p.roomId)] : undefined };
  return null;
}

export function affectsDelegationTask(input: DelegationInput, task: DelegationTask) {
  if (input.kind === 'requirement') return task.kind === 'outlet'
    && (input.roomNames?.includes(task.roomName) || input.roomNames?.includes('') && task.next === 'ask_owner');
  if (input.kind === 'material') return task.kind === 'outlet' && input.roomIds?.includes(task.roomId);
  if (input.kind === 'record') return input.roomIds?.includes(task.roomId) || task.evidence?.recordId === input.recordId;
  if (input.kind === 'issue' || input.kind === 'plan') return task.kind === 'outlet'
    && (task.issueId ? input.issueId === task.issueId : input.roomIds?.includes(task.roomId));
  return !input.roomIds || input.roomIds.includes(task.roomId);
}

export async function electricalInputs(tx: PostgresTransaction, d: Delegation, task: DelegationTask, origin: Row, event: DelegationEvent) {
  const materials = await sharedMaterials(tx, d.enterpriseId, d.projectId, task.roomId);
  const need = materials.sources.find(s => s.kind === 'need' && s.customerId === d.requesterId && s.conversationId === d.conversationId);
  const drawing = materials.sources.find(s => s.kind === 'drawing');
  const memory = await availableNeedMemory(tx, d.enterpriseId, d.conversationId, origin.entry_snapshot);
  const reply = event.type === delegationRequirement ? event.payload.reply as DelegationReply | undefined : undefined;
  const answerId = reply?.delegationId === d.id && reply.roomId === task.roomId ? String(event.payload.messageId) : task.basis?.replyMessageId;
  const facts = memory.facts.filter(fact => outletFields.includes(fact.field) && (fact.room === task.roomName
    || !fact.room && (task.basis?.factIds.includes(fact.id) || fact.sourceMessageId === answerId)));
  return { need, drawing, facts, basis: {
    needGrantId: need?.id ?? null, drawingGrantId: drawing?.id ?? null, factIds: facts.map(f => f.id).sort(),
    replyMessageId: facts.some(fact => fact.sourceMessageId === answerId) ? answerId : undefined,
    materialVersion: materials.version, scheduleVersion: await delegationScheduleVersion(tx, d, task.roomId, origin.current_stage_key),
  } };
}

export async function delegationScheduleVersion(tx: PostgresTransaction, d: Delegation, roomId: string, stage: unknown) {
  const schedule = await rows(tx, sql`select id::text,room_id::text,title,status,starts_at::text,ends_at::text,note,version from app.construction_plans
    where enterprise_id=${d.enterpriseId} and project_id=${d.projectId} and (room_id is null or room_id=${roomId}) order by id`);
  const current = collaborationEnabled(d.enterpriseId) ? await latestScheduleEvent(tx, d.enterpriseId, d.projectId) : null;
  const nodes = current ? ((current.payload as Row).nodes as Row[]).filter(node => !node.roomId || node.roomId === roomId) : [];
  return fingerprint({ stage, schedule, ...(nodes.length ? { nodes } : {}) });
}

export async function activeProjectStaff(tx: PostgresTransaction, eid: string, projectId: string, adminId: string) {
  const row = await one(tx, sql`select a.status,m.role,app.construction_actor_access(${adminId}::bigint,${eid}::bigint) as access,
      case when a.user_id is not null then app.construction_miniprogram_access(a.id,${eid}::bigint,a.user_id,u.context_version) end as mini_access
    from (select ${adminId}::bigint as id) subject
    left join app.admin_users a on a.id=subject.id
    left join app.users u on u.id=a.user_id
    left join app.construction_members m on m.enterprise_id=${eid} and m.project_id=${projectId} and m.admin_id=subject.id and m.active`);
  if (row?.access === 'owner' || row?.mini_access === 'owner') return 'manager';
  return (row?.access === 'member' || row?.mini_access === 'member') && row.status === 'active' && row.role !== 'observer' && row.role
    ? String(row.role) : null;
}

export async function soleProjectStaff(tx: PostgresTransaction, d: Delegation, role: string) {
  const found = await rows(tx, sql`select m.admin_id::text from app.construction_members m
    join app.admin_users a on a.enterprise_id=m.enterprise_id and a.id=m.admin_id and a.status='active'
    where m.enterprise_id=${d.enterpriseId} and m.project_id=${d.projectId} and m.role=${role} and m.active
    order by m.admin_id`);
  const eligible = [];
  for (const member of found) {
    const id = String(member.admin_id);
    if (await activeProjectStaff(tx, d.enterpriseId, d.projectId, id)) eligible.push(id);
    if (eligible.length > 1) return null;
  }
  return eligible[0] ?? null;
}

export async function electricalEvidence(tx: PostgresTransaction, d: Delegation, task: DelegationTask,
  recordId: string, event: DelegationEvent, target: 'outlet' | 'progress'): Promise<DelegationEvidence | null> {
  const record = await one(tx, sql`select r.*,q.status as run_status,m.content from app.construction_site_records r
    left join app.assistant_runs q on q.enterprise_id=r.enterprise_id and q.id=r.run_id
    join app.assistant_messages m on m.enterprise_id=r.enterprise_id and m.id=r.source_message_id
    where r.enterprise_id=${d.enterpriseId} and r.project_id=${d.projectId} and r.id=${recordId}`);
  if (!record
    || !['organizing','draft','published'].includes(String(record.status))
    || !await activeProjectStaff(tx, d.enterpriseId, d.projectId, String(record.author_id))
    || await siteAccessRevoked(tx, d.enterpriseId, d.projectId, [String(record.author_id)], record.created_at as Date)) return null;
  const raw = safeText(record.content as MessageContent);
  const scope = record.room_id ? { roomId: String(record.room_id), roomName: record.room_name_snapshot }
    : record.status === 'organizing' ? await resolveSiteQuery(tx, d.enterpriseId, d.projectId, raw) : null;
  if (scope?.roomId !== task.roomId || scope.roomName !== task.roomName) return null;
  const data = record.data as Row;
  const description = record.status === 'organizing' ? raw : [data.title, data.completed, data.pending, data.coordination].join(' ');
  const electrical = target === 'outlet' ? /插座|底盒/ : /水电|电路|穿线|线管|布线|给排水|水路|电线|排水|试水|插座|底盒/;
  if (!electrical.test(description)) return null;
  const attachments = await rows(tx, sql`select m.id::text,m.deleted_at from app.construction_site_attachments a
    join app.construction_site_media m on m.enterprise_id=a.enterprise_id and m.project_id=a.project_id and m.id=a.media_id
    where a.enterprise_id=${d.enterpriseId} and a.project_id=${d.projectId} and a.record_id=${recordId} order by a.position`);
  if (attachments.some(m => m.deleted_at)) return null;
  const status = record.status === 'published' ? 'published' : record.status === 'draft' ? 'reported'
    : ['failed','cancelled'].includes(String(record.run_status)) ? 'failed' : 'organizing';
  const previous = task.evidence;
  return {
    recordId, version: Number(record.version), runId: record.run_id ? String(record.run_id) : null,
    eventId: previous?.recordId === recordId && previous.version === Number(record.version) && previous.status === status ? previous.eventId : event.id,
    photoIds: attachments.map(m => String(m.id)), status,
    complete: Boolean(String(data.completed ?? '').trim()) && !String(data.pending ?? '').trim() && !String(data.coordination ?? '').trim(),
    customerVisible: record.status === 'published' && record.audience === 'customer' && String(record.published_customer_id) === d.requesterId,
  };
}
