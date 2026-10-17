import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { fingerprint, type ActorContext } from '@/lib/assistant/contracts';
import { appendMessage } from '@/lib/assistant/core/conversation';
import type { NeedMemory } from '@/lib/assistant/agent/memory';
import { availableNeedMemory } from '@/lib/assistant/agent/memory-sources';
import type { NeedFollowUp, ConstructionStage } from './stages';

const remainingDevices = (prompt: NeedFollowUp) => prompt.field === 'devices' && /其他|还有|新增|补充/.test(prompt.question);

/** Existing excerpts count as known, including uncertainty: never chase a customer who deferred a topic. */
export function followUpKnown(prompt: NeedFollowUp, memory: NeedMemory, draft: Row = {}, confirmed: Row = {}) {
  const known = memory.facts.filter(f => f.status === 'current' && f.field === prompt.field && f.room === prompt.room && f.value.trim());
  if (known.length) {
    // A named device is not an exhaustive inventory. Only explicitly configured
    // remaining-item questions may ask beyond it, once per stable need identity.
    return !remainingDevices(prompt) || known.some(f => /暂未|暂时没|没想好|没确定|未确定|不确定|以后再|稍后|没有其他|没有别的|没有新增|不再新增|暂不添置|不需要其他|不需要更多/.test(f.value));
  }
  if (prompt.room) return false;
  const candidate = draft[prompt.field] as { text?: string } | undefined;
  return !!candidate?.text?.trim() || (typeof confirmed[prompt.field] === 'string' && !!String(confirmed[prompt.field]).trim());
}

/** Called under the conversation and current project locks, only after claiming this stage's delivery. */
export async function appendStageFollowUp(tx: PostgresTransaction, actor: ActorContext, conversation: Row, project: Row,
  stage: ConstructionStage, stageEvent: Row, settingsVersion: number) {
  if (actor.principal.kind !== 'user' || !stage.followUps?.length) return;
  const eid = actor.enterpriseId, uid = actor.principal.userId, cid = String(conversation.id), pid = String(project.id);
  const entry = conversation.entry_snapshot as Row;
  // A generic conversation may span homes. Never use one home's needs to fill another project's gaps.
  if (entry?.kind !== 'lead') {
    const scope = await one(tx, sql`select count(distinct l.id) leads,count(distinct p.id) projects
      from app.leads l left join app.construction_projects p on p.enterprise_id=l.enterprise_id and p.lead_id=l.id
        and p.status='active' and p.customer_access
      where l.enterprise_id=${eid} and l.customer_user_id=${uid} and l.archived_at is null`);
    if (Number(scope?.leads) !== 1 || Number(scope?.projects) !== 1) return;
  } else if (String(entry.id) !== String(project.lead_id)) return;
  if (entry?.retentionRedacted) return;
  const delivery = await one(tx, sql`insert into app.domain_event_deliveries(enterprise_id,event_id,consumer_key,status)
    values(${eid},${String(stageEvent.id)},${'construction:need:user:' + uid},'processing')
    on conflict(enterprise_id,event_id,consumer_key) do nothing returning id`);
  if (!delivery) return;
  const latest = await one(tx, sql`select draft_fields from app.assistant_requirement_summaries
    where enterprise_id=${eid} and conversation_id=${cid} and status!='redacted' order by id desc limit 1`);
  const confirmed = await one(tx, sql`select confirmed_fields from app.assistant_requirement_summaries
    where enterprise_id=${eid} and conversation_id=${cid} and status='confirmed' order by id desc limit 1`);
  const memory = await availableNeedMemory(tx, eid, cid, entry);
  for (const prompt of stage.followUps) {
    if (prompt.room && !await one(tx, sql`select id from app.construction_rooms
      where enterprise_id=${eid} and project_id=${pid} and name=${prompt.room} for share`)) continue;
    if (followUpKnown(prompt, memory, latest?.draft_fields as Row, confirmed?.confirmed_fields as Row)) continue;
    // Stable project/customer/field/room identity survives stage/configuration changes and other chats.
    const aggregate = `${pid}:${uid}:${fingerprint([prompt.field, prompt.room])}`;
    const event = await one(tx, sql`insert into app.domain_event_outbox
      (enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
      values(${eid},'construction.need.asked.v1','construction_need',${aggregate},1,'{"kind":"system"}'::jsonb,
        ${String(stageEvent.id)},${JSON.stringify({ projectId: pid, customerId: uid, stageKey: stage.key,
          progressRevision: Number(project.progress_revision), settingsVersion, triggerEventId: String(stageEvent.id), ...prompt })}::jsonb)
      on conflict(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version) do nothing returning *`);
    if (!event) continue;
    const known = remainingDevices(prompt) ? memory.facts.filter(f => f.field === prompt.field && f.room === prompt.room).slice(-2) : [];
    const context = known.length ? `你前面提到“${known.map(f => f.value).join('；')}”。` : '';
    await appendMessage(tx, actor, cid, { author: 'system', eventId: String(event.id), purpose: 'construction.followup',
      content: { version: 1, blocks: [{ type: 'text', text: `「${String(project.name)}」当前是${stage.name}阶段。${context}${prompt.question}\n可以直接回复或发图，也可以稍后再聊。补充供设计师核对，不代表正式方案或费用、工期变更已获批准。` }] } });
    break;
  }
  await tx.execute(sql`update app.domain_event_deliveries set status='delivered',updated_at=now()
    where enterprise_id=${eid} and id=${String(delivery.id)}`);
}
