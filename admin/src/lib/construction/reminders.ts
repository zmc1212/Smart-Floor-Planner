import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { appendMessage } from '@/lib/assistant/core/conversation';
import type { ActorContext } from '@/lib/assistant/contracts';
import { currentStage, readStageSettings } from './stages-store';
import { appendStageFollowUp } from './follow-ups';
import { syncSitePublications } from './site-publications';
import { syncPublicConsents } from './public-projections';

/** Outbox writes, progress and chat delivery commit together; no model invents a construction fact. */
export async function recordStageReminder(tx: PostgresTransaction, actor: ActorContext, project: Row, settingsVersion: number, text: string) {
  return (await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${actor.enterpriseId},'construction.stage.updated.v1','construction_project',${String(project.id)},${Number(project.progress_revision)},
    ${JSON.stringify(actor.principal)}::jsonb,${String(project.id)},${JSON.stringify({ projectId: String(project.id), stageKey: project.current_stage_key, settingsVersion, text })}::jsonb)
    returning *`))!;
}
/** The caller holds the conversation lock. The shared project lock serializes progress/revocation. */
export async function syncConstructionReminders(tx: PostgresTransaction, actor: ActorContext, conversation: Row) {
  await syncPublicConsents(tx, actor, conversation);
  if (actor.principal.kind !== 'user' || conversation.status !== 'open' || conversation.mode !== 'ai') return;
  if (!await one(tx, sql`select enterprise_id from app.assistant_enterprise_settings where enterprise_id=${actor.enterpriseId} and enabled`)) return;
  await syncSitePublications(tx, actor, conversation);
  await one(tx, sql`select version from app.construction_stage_settings where enterprise_id=${actor.enterpriseId} for share`);
  const cid = String(conversation.id), uid = actor.principal.userId;
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
      and e.aggregate_version=${Number(p.progress_revision)} and e.payload->>'settingsVersion'=coalesce(s.version,1)::text`);
    if (!event) continue;
    const consumer = 'construction:user:' + uid;
    const delivery = await one(tx, sql`insert into app.domain_event_deliveries(enterprise_id,event_id,consumer_key,status)
      values(${actor.enterpriseId},${String(event.id)},${consumer},'processing') on conflict(enterprise_id,event_id,consumer_key) do nothing returning id`);
    const settings = await readStageSettings(tx, actor.enterpriseId), stage = currentStage(p, settings.stages);
    if (!stage) continue;
    if (delivery && stage.visitReminder) await appendMessage(tx, actor, cid, { author: 'system', eventId: String(event.id), purpose: 'construction.stage',
      content: { version: 1, blocks: [{ type: 'text', text: String((event.payload as Row).text) }] } });
    await appendStageFollowUp(tx, actor, conversation, p, stage, event, settings.version);
    if (delivery) await tx.execute(sql`update app.domain_event_deliveries set status='delivered',updated_at=now() where enterprise_id=${actor.enterpriseId} and id=${String(delivery.id)}`);
    await tx.execute(sql`insert into app.construction_links(enterprise_id,project_id,conversation_id) values(${actor.enterpriseId},${String(p.id)},${cid}) on conflict do nothing`);
  }
}
