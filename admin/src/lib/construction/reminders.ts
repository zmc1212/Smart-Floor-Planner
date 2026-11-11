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
export async function recordStageReminder(tx: PostgresTransaction, actor: ActorContext, project: Row, settingsVersion: number,
  text: string, options?: { sourceEventKey?: string }) {
  const payload = { projectId: String(project.id), stageKey: project.current_stage_key, settingsVersion, text,
    ...(options?.sourceEventKey === undefined ? {} : { sourceEventKey: options.sourceEventKey }) };
  return (await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${actor.enterpriseId},'construction.stage.updated.v1','construction_project',${String(project.id)},${Number(project.progress_revision)},
    ${JSON.stringify(actor.principal)}::jsonb,${String(project.id)},${JSON.stringify(payload)}::jsonb)
    returning *`))!;
}
export interface StageReminderDeliveryResult {
  delivered: boolean;
  deliveryId: string | null;
  messageId: string | null;
  /** The conversation that actually holds the delivered stage message. */
  messageConversationId?: string | null;
  /** The recipient confirmed through that conversation's active participant. */
  messageUserId?: string | null;
  reason?: 'customer_access_revoked' | 'project_inactive' | 'assistant_disabled' | 'settings_version_mismatch'
    | 'stage_event_invalid' | 'conversation_invalid' | 'delivery_in_progress' | 'delivery_already_claimed';
}

const undeliverable = (reason: NonNullable<StageReminderDeliveryResult['reason']>): StageReminderDeliveryResult =>
  ({ delivered: false, deliveryId: null, messageId: null, reason });

/** Deliver exactly one stage event to exactly one customer consultation. The
 * caller holds the conversation lock; the project row is locked by the event
 * freshness check, matching the aggregate sync loop's order. A notification may
 * be re-checked long after the outbox row was written, so access, settings and
 * conversation are re-validated before any delivery or message write. */
export async function deliverStageReminderToConversation(tx: PostgresTransaction, actor: ActorContext, project: Row,
  stageEvent: Row, conversation: Row, settings: { stages: ConstructionStage[]; version: number }): Promise<StageReminderDeliveryResult> {
  if (actor.principal.kind !== 'user' || conversation.status !== 'open' || conversation.mode !== 'ai'
    || conversation.purpose !== 'customer_consultation') return undeliverable('conversation_invalid');
  const eid = actor.enterpriseId, uid = actor.principal.userId, cid = String(conversation.id), pid = String(project.id);
  // Lock the project before reading it, then the freshness check below re-locks
  // the same row; the caller already holds the conversation lock.
  const fresh = await one(tx, sql`select * from app.construction_projects
    where enterprise_id=${eid} and id=${pid} for share`);
  if (!fresh || !fresh.customer_access) return undeliverable('customer_access_revoked');
  if (fresh.status !== 'active') return undeliverable('project_inactive');
  if (!await one(tx, sql`select enterprise_id from app.assistant_enterprise_settings
    where enterprise_id=${eid} and enabled`)) return undeliverable('assistant_disabled');
  const payload = (stageEvent.payload || {}) as Row;
  if (payload.settingsVersion === undefined || payload.settingsVersion === null
    || String(payload.settingsVersion) !== String(settings.version)) return undeliverable('settings_version_mismatch');
  const current = await currentStageEvent(tx, eid, String(stageEvent.id), true);
  if (!current || String(current.aggregate_id) !== pid) return undeliverable('stage_event_invalid');
  const currentKey = String(current.project_stage_key);
  const stage = currentStage(fresh, settings.stages);
  if (!stage || String(stage.key) !== currentKey || String((current.payload as Row).stageKey) !== currentKey) {
    return undeliverable('stage_event_invalid');
  }
  const live = await one(tx, sql`select status,mode,purpose from app.assistant_conversations
    where enterprise_id=${eid} and id=${cid}`);
  if (!live || live.status !== 'open' || live.mode !== 'ai' || live.purpose !== 'customer_consultation') {
    return undeliverable('conversation_invalid');
  }
  const consumer = 'construction:user:' + uid;
  const delivery = await one(tx, sql`insert into app.domain_event_deliveries(enterprise_id,event_id,consumer_key,status)
    values(${eid},${String(stageEvent.id)},${consumer},'processing') on conflict(enterprise_id,event_id,consumer_key) do nothing returning id`);
  if (!delivery) {
    const existing = await one(tx, sql`select id,status from app.domain_event_deliveries
      where enterprise_id=${eid} and event_id=${String(stageEvent.id)} and consumer_key=${consumer}`);
    if (!existing) return undeliverable('delivery_already_claimed');
    if (existing.status === 'pending') return { delivered: false, deliveryId: String(existing.id), messageId: null, reason: 'delivery_already_claimed' };
    if (existing.status !== 'delivered') return { delivered: false, deliveryId: String(existing.id), messageId: null, reason: 'delivery_in_progress' };
    // The stage notice is already delivered, so no second message is appended.
    // Follow-up and the construction link keep their own independent idempotency.
    await appendStageFollowUp(tx, actor, conversation, fresh, stage, stageEvent, settings.version);
    await tx.execute(sql`insert into app.construction_links(enterprise_id,project_id,conversation_id) values(${eid},${pid},${cid}) on conflict do nothing`);
    // The original notice may live in another conversation. Return that real
    // conversation and its active participant as the recipient evidence; do
    // not claim the currently requested conversation. If the relation cannot
    // be confirmed, report an unconfirmed delivery instead of fabricating one.
    const message = await one(tx, sql`select m.id,m.conversation_id,ap.user_id
      from app.assistant_messages m
      join app.assistant_participants ap on ap.enterprise_id=m.enterprise_id
        and ap.conversation_id=m.conversation_id and ap.status='active' and ap.user_id=${uid}
      where m.enterprise_id=${eid} and m.source_event_id=${String(stageEvent.id)}
        and m.purpose='construction.stage'
      order by m.id limit 1`);
    return message && message.conversation_id != null && message.user_id != null
      ? {
          delivered: true,
          deliveryId: String(existing.id),
          messageId: String(message.id),
          messageConversationId: String(message.conversation_id),
          messageUserId: String(message.user_id),
        }
      : { delivered: false, deliveryId: String(existing.id), messageId: null, reason: 'delivery_already_claimed' };
  }
  let messageId: string | null = null;
  if (stage.visitReminder) {
    const message = await appendMessage(tx, actor, cid, { author: 'system', eventId: String(stageEvent.id), purpose: 'construction.stage',
      content: { version: 1, blocks: [{ type: 'text', text: String((stageEvent.payload as Row).text) }] } });
    messageId = String(message.id);
  }
  await appendStageFollowUp(tx, actor, conversation, fresh, stage, stageEvent, settings.version);
  await tx.execute(sql`insert into app.construction_links(enterprise_id,project_id,conversation_id) values(${eid},${pid},${cid}) on conflict do nothing`);
  await tx.execute(sql`update app.domain_event_deliveries set status='delivered',updated_at=now() where enterprise_id=${eid} and id=${String(delivery.id)}`);
  return {
    delivered: true,
    deliveryId: String(delivery.id),
    messageId,
    messageConversationId: messageId ? cid : null,
    messageUserId: messageId ? uid : null,
  };
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
