import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { appendMessage } from '@/lib/assistant/core/conversation';
import type { ActorContext } from '@/lib/assistant/contracts';
import { currentStage, readStageSettings } from './stages-store';
import type { ConstructionStage } from './stages';
import { appendStageFollowUp } from './follow-ups';
import { syncSitePublications } from './site-publications';
import { syncPublicConsents } from './public-projections';
import { currentStageEvent } from './stage-events';

/** Outbox writes, progress and chat delivery commit together; no model invents a construction fact. */
export async function recordStageReminder(tx: PostgresTransaction, actor: ActorContext, project: Row, settingsVersion: number, text: string) {
  return (await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${actor.enterpriseId},'construction.stage.updated.v1','construction_project',${String(project.id)},${Number(project.progress_revision)},
    ${JSON.stringify(actor.principal)}::jsonb,${String(project.id)},${JSON.stringify({ projectId: String(project.id), stageKey: project.current_stage_key, settingsVersion, text })}::jsonb)
    returning *`))!;
}
export interface StageReminderDeliveryResult {
  delivered: boolean;
  deliveryId: string | null;
  messageId: string | null;
  reason?: 'stage_event_invalid' | 'conversation_invalid' | 'delivery_in_progress' | 'delivery_already_claimed';
}

/** Deliver exactly one stage event to exactly one customer consultation. The
 * caller holds the conversation lock; the project row is locked by the event
 * freshness check, matching the aggregate sync loop's order. */
export async function deliverStageReminderToConversation(tx: PostgresTransaction, actor: ActorContext, project: Row,
  stageEvent: Row, conversation: Row, settings: { stages: ConstructionStage[]; version: number }): Promise<StageReminderDeliveryResult> {
  if (actor.principal.kind !== 'user' || conversation.status !== 'open' || conversation.mode !== 'ai'
    || conversation.purpose !== 'customer_consultation') {
    return { delivered: false, deliveryId: null, messageId: null, reason: 'conversation_invalid' };
  }
  const eid = actor.enterpriseId, uid = actor.principal.userId, cid = String(conversation.id);
  const current = await currentStageEvent(tx, eid, String(stageEvent.id), true), stage = currentStage(project, settings.stages);
  if (!current || String(current.aggregate_id) !== String(project.id) || !stage
    || String((current.payload as Row).stageKey) !== String(project.current_stage_key)) {
    return { delivered: false, deliveryId: null, messageId: null, reason: 'stage_event_invalid' };
  }
  const consumer = 'construction:user:' + uid;
  const delivery = await one(tx, sql`insert into app.domain_event_deliveries(enterprise_id,event_id,consumer_key,status)
    values(${eid},${String(stageEvent.id)},${consumer},'processing') on conflict(enterprise_id,event_id,consumer_key) do nothing returning id`);
  if (!delivery) {
    const existing = await one(tx, sql`select id,status from app.domain_event_deliveries
      where enterprise_id=${eid} and event_id=${String(stageEvent.id)} and consumer_key=${consumer}`);
    if (!existing) return { delivered: false, deliveryId: null, messageId: null, reason: 'delivery_already_claimed' };
    if (existing.status !== 'delivered') return { delivered: false, deliveryId: String(existing.id), messageId: null, reason: 'delivery_in_progress' };
    const message = await one(tx, sql`select id from app.assistant_messages
      where enterprise_id=${eid} and conversation_id=${cid} and source_event_id=${String(stageEvent.id)} and purpose='construction.stage' limit 1`);
    return message
      ? { delivered: true, deliveryId: String(existing.id), messageId: String(message.id) }
      : { delivered: false, deliveryId: String(existing.id), messageId: null, reason: 'delivery_already_claimed' };
  }
  let messageId: string | null = null;
  if (stage.visitReminder) {
    const message = await appendMessage(tx, actor, cid, { author: 'system', eventId: String(stageEvent.id), purpose: 'construction.stage',
      content: { version: 1, blocks: [{ type: 'text', text: String((stageEvent.payload as Row).text) }] } });
    messageId = String(message.id);
  }
  await appendStageFollowUp(tx, actor, conversation, project, stage, stageEvent, settings.version);
  await tx.execute(sql`update app.domain_event_deliveries set status='delivered',updated_at=now() where enterprise_id=${eid} and id=${String(delivery.id)}`);
  await tx.execute(sql`insert into app.construction_links(enterprise_id,project_id,conversation_id) values(${eid},${String(project.id)},${cid}) on conflict do nothing`);
  return { delivered: true, deliveryId: String(delivery.id), messageId };
}

/** The caller holds the conversation lock. The shared project lock serializes progress/revocation. */
export async function syncConstructionReminders(tx: PostgresTransaction, actor: ActorContext, conversation: Row) {
  await syncPublicConsents(tx, actor, conversation);
  if (actor.principal.kind !== 'user' || conversation.status !== 'open' || conversation.mode !== 'ai') return;
  if (!await one(tx, sql`select enterprise_id from app.assistant_enterprise_settings where enterprise_id=${actor.enterpriseId} and enabled`)) return;
  await syncSitePublications(tx, actor, conversation);
  // Private follow-up has its own report delivery and must not consume C01's
  // original per-customer stage/need consumer keys.
  if (conversation.purpose !== 'customer_consultation') return;
  await one(tx, sql`select version from app.construction_stage_settings where enterprise_id=${actor.enterpriseId} for share`);
  const uid = actor.principal.userId;
  const projects = await rows(tx, sql`select p.* from app.construction_projects p
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where p.enterprise_id=${actor.enterpriseId} and p.customer_access and p.status='active' and l.customer_user_id=${uid} and l.archived_at is null
    and (coalesce(${JSON.stringify(conversation.entry_snapshot || {})}::jsonb->>'kind','')<>'lead'
      or p.lead_id::text=${JSON.stringify(conversation.entry_snapshot || {})}::jsonb->>'id')
    order by p.id limit 30 for share of p,l`);
  for (const p of projects) {
    const event = await one(tx, sql`select e.* from app.domain_event_outbox e
      left join app.construction_stage_settings s on s.enterprise_id=e.enterprise_id
      where e.enterprise_id=${actor.enterpriseId} and e.type='construction.stage.updated.v1' and e.aggregate_id=${String(p.id)}
      and e.payload->>'settingsVersion'=coalesce(s.version,1)::text order by e.aggregate_version desc limit 1`);
    if (!event) continue;
    await deliverStageReminderToConversation(tx, actor, p, event, conversation, await readStageSettings(tx, actor.enterpriseId));
  }
}
