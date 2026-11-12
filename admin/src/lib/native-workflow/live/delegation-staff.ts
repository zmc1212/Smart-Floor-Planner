
import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { appendMessage } from '@/lib/assistant/core/conversation';
import type { ActorContext, MessageContent } from '@/lib/assistant/contracts';
import { sharedMaterial, sharedMaterials } from '@/lib/construction/site-materials';
import { delegationsEnabled } from './delegation-config';
import { isSuspended, type Delegation } from './delegation-state';
import { appendDelegationEvent, delegationFromRow, delegationOrigin } from './delegation-store';

const staffNotice = 'native.delegation.staff_notice.v1';
export const staffDelegationPurpose = 'construction.delegation.staff';

export async function queueDelegationStaffNotice(tx: PostgresTransaction, d: Delegation, escalate = false) {
  if (!d.scope.roomId || (!escalate && d.status !== 'waiting_for_designer') || isSuspended(d.status)) return null;
  const materials = await sharedMaterials(tx, d.enterpriseId, d.projectId, d.scope.roomId);
  const grant = materials.sources.find(item => item.kind === 'need' && item.customerId === d.ownerId && item.conversationId === d.conversationId);
  if (!grant) return null;
  const eventId = await appendDelegationEvent(tx, d.enterpriseId, staffNotice,
    [d.id, grant.id, escalate ? 'escalation' : 'design'].join(':'), 1,
    { projectId: d.projectId, delegationId: d.id, grantId: grant.id, roomId: grant.roomId, escalate });
  return eventId ? { eventId, delivery: 'queued_in_app' } : null;
}

async function staffProjection(tx: PostgresTransaction, actor: ActorContext, projectId: string, event: Row, manage: boolean) {
  if (!delegationsEnabled(actor.enterpriseId) || actor.principal.kind !== 'admin') return null;
  const p = event.payload as Row, escalate = p.escalate === true;
  if (escalate ? !manage : !manage && !await one(tx, sql`select admin_id from app.construction_members
    where enterprise_id=${actor.enterpriseId} and project_id=${projectId} and admin_id=${actor.principal.adminId}
    and active and role='designer' for share`)) return null;
  const row = await one(tx, sql`select * from app.native_workflow_delegations
    where enterprise_id=${actor.enterpriseId} and project_id=${projectId} and id::text=${String(p.delegationId)}`);
  if (!row) return null;
  const d = delegationFromRow(row);
  if (isSuspended(d.status) || d.status === 'completed' || !escalate && d.status !== 'waiting_for_designer'
    || !await delegationOrigin(tx, d)) return null;
  const grant = await sharedMaterial(tx, actor.enterpriseId, projectId, String(p.grantId));
  if (!grant || grant.kind !== 'need' || grant.customerId !== d.ownerId || grant.conversationId !== d.conversationId
    || grant.roomId !== d.scope.roomId) return null;
  return { title: escalate ? '待协调的工地跟进' : '待核对的业主共享需求',
    text: escalate ? grant.roomName + '的跟进在提醒后仍待处理。请核对当前分工和获权材料。' : grant.roomName + '有一项业主已共享的需求等待设计核对。请沿工地现有流程处理和回传。' };
}

export async function syncDelegationStaffNotices(tx: PostgresTransaction, actor: ActorContext, c: Row, projectId: string, manage: boolean) {
  if (!delegationsEnabled(actor.enterpriseId) || c.status !== 'open') return;
  const events = await rows(tx, sql`select e.id::text,e.payload from app.domain_event_outbox e
    where e.enterprise_id=${actor.enterpriseId} and e.type=${staffNotice} and e.payload->>'projectId'=${projectId}
      and not exists(select 1 from app.assistant_messages m where m.enterprise_id=e.enterprise_id
        and m.conversation_id=${String(c.id)} and m.source_event_id=e.id and m.purpose=${staffDelegationPurpose})
    order by e.id desc limit 24`);
  for (const event of events.reverse()) {
    const projection = await staffProjection(tx, actor, projectId, event, manage);
    if (!projection) continue;
    await appendMessage(tx, actor, String(c.id), { author: 'system', eventId: String(event.id),
      purpose: staffDelegationPurpose, content: { version: 1, blocks: [{ type: 'text', text: projection.title }] } });
  }
}

export async function delegationStaffResponse(tx: PostgresTransaction, actor: ActorContext, projectId: string, message: Row, manage: boolean) {
  const event = await one(tx, sql`select e.id::text,e.payload from app.domain_event_outbox e join app.assistant_messages m
    on m.enterprise_id=e.enterprise_id and m.source_event_id=e.id
    where e.enterprise_id=${actor.enterpriseId} and m.id=${String(message.id)} and e.type=${staffNotice}
      and e.payload->>'projectId'=${projectId}`);
  if (!event) return null;
  const projection = await staffProjection(tx, actor, projectId, event, manage);
  if (!projection) return null;
  const content: MessageContent = { version: 1, blocks: [{ type: 'text', text: projection.title }] };
  return { message: { ...message, display_name: '小K', content }, record: null, response: { status: 'succeeded', text: projection.text } };
}
