import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { appendMessage } from '@/lib/assistant/core/conversation';
import type { ActorContext } from '@/lib/assistant/contracts';
import { readSiteIssue } from './site-issues';
import { sharedMaterial, sharedMaterials } from './site-materials';

const resultType = 'construction.site.issue.result.v1';

/** The recipient is the original opt-in consultation, never the latest or another customer thread. */
async function validResult(tx: PostgresTransaction, eid: string, cid: string, event: Row) {
  const p = event.payload as Row;
  if (p.conversationId !== cid) return false;
  const need = await sharedMaterial(tx, eid, String(p.projectId), String(p.needGrantId));
  if (!need || need.conversationId !== cid || need.customerId !== p.customerId) return false;
  const issue = await readSiteIssue(tx, eid, String(p.projectId), String(p.issueId));
  if (!issue || issue.status !== 'awaiting_review' || issue.revision !== p.revision || !issue.ownerId) return false;
  const materials = await sharedMaterials(tx, eid, String(p.projectId), need.roomId);
  if (materials.version !== p.materialVersion || issue.materialVersion !== p.materialVersion) return false;
  const publisher = (event.actor_ref as Row)?.adminId;
  if (typeof publisher !== 'string') return false;
  const permission = await one(tx, sql`select app.construction_actor_access(${publisher}::bigint,${eid}::bigint) as role,
    exists(select 1 from app.construction_members where enterprise_id=${eid} and project_id=${String(p.projectId)}
      and admin_id=${publisher} and active and role='manager') as manager`);
  return permission?.role === 'owner' || (permission?.role === 'member' && permission.manager === true);
}

export async function siteResultAvailable(tx: PostgresTransaction, eid: string, cid: string, mid: string) {
  const event = await one(tx, sql`select e.* from app.assistant_messages m join app.domain_event_outbox e on e.enterprise_id=m.enterprise_id and e.id=m.source_event_id
    where m.enterprise_id=${eid} and m.conversation_id=${cid} and m.id=${mid} and m.purpose='construction.result' and e.type=${resultType}`);
  return !event || await validResult(tx, eid, cid, event);
}

/** Original-consultation read model for query_followups. Never exposes the shared conversation or unpublished replies. */
export async function customerSiteResults(tx: PostgresTransaction, eid: string, uid: string, cid: string) {
  const events = await rows(tx, sql`select distinct on (e.aggregate_id) e.*,m.id::text as result_message_id
    from app.domain_event_outbox e join app.assistant_messages m on m.enterprise_id=e.enterprise_id and m.source_event_id=e.id
    and m.conversation_id=${cid} and m.purpose='construction.result'
    where e.enterprise_id=${eid} and e.type=${resultType} and e.payload->>'customerId'=${uid} and e.payload->>'conversationId'=${cid}
    order by e.aggregate_id,e.aggregate_version desc limit 30`);
  const projected = [];
  for (const e of events) {
    const p = e.payload as Row, available = await validResult(tx, eid, cid, e);
    projected.push({ issueId: String(p.issueId), revision: Number(p.revision), projectId: String(p.projectId),
      room: available ? String(p.roomName) : '', status: available ? 'awaiting_review' as const : 'invalidated' as const,
      messageId: String(e.result_message_id), text: available ? String(p.text) : '', sourceVersion: available ? String(p.materialVersion) : '' });
  }
  return projected;
}

export async function syncSiteResults(tx: PostgresTransaction, actor: ActorContext, c: Row) {
  if (actor.principal.kind !== 'user' || c.status !== 'open' || c.mode !== 'ai' || c.purpose !== 'customer_consultation') return 0;
  const eid = actor.enterpriseId, cid = String(c.id), uid = actor.principal.userId;
  const events = await rows(tx, sql`select e.* from app.domain_event_outbox e where e.enterprise_id=${eid} and e.type=${resultType}
    and e.payload->>'conversationId'=${cid} and e.payload->>'customerId'=${uid}
    and not exists(select 1 from app.domain_event_deliveries d where d.enterprise_id=e.enterprise_id and d.event_id=e.id and d.consumer_key=${'construction:result:' + cid})
    order by e.id limit 20`);
  let delivered = 0;
  for (const event of events) {
    if (!await validResult(tx, eid, cid, event)) {
      await tx.execute(sql`insert into app.domain_event_deliveries(enterprise_id,event_id,consumer_key,status,last_error)
        values(${eid},${String(event.id)},${'construction:result:' + cid},'dead','source_or_permission_changed')
        on conflict(enterprise_id,event_id,consumer_key) do nothing`);
      continue;
    }
    const d = await one(tx, sql`insert into app.domain_event_deliveries(enterprise_id,event_id,consumer_key,status)
      values(${eid},${String(event.id)},${'construction:result:' + cid},'processing') on conflict(enterprise_id,event_id,consumer_key) do nothing returning id`);
    if (!d) continue;
    const p = event.payload as Row;
    await appendMessage(tx, actor, cid, { author: 'system', eventId: String(event.id), purpose: 'construction.result',
      content: { version: 1, blocks: [{ type: 'text', text: `「${p.roomName}」事项${p.issueId} · 修订${p.revision}，项目团队回传：\n${p.text}\n这是处理回复，仍待核对，不代表方案、费用、工期或验收批准。` }] } });
    await tx.execute(sql`update app.domain_event_deliveries set status='delivered',updated_at=now() where enterprise_id=${eid} and id=${String(d.id)}`);
    delivered++;
  }
  return delivered;
}

/** Reuses the existing Worker poll; pages may be closed. Human mode defers the same event without consuming it. */
export async function deliverSiteResults() {
  const candidates = await withPlatformTransaction(tx => rows(tx, sql`select distinct e.enterprise_id,c.id as conversation_id,e.payload->>'customerId' as customer_id
    from app.domain_event_outbox e join app.enterprises ent on ent.id=e.enterprise_id and ent.status='active'
    join app.assistant_enterprise_settings s on s.enterprise_id=e.enterprise_id and s.enabled
    join app.assistant_conversations c on c.enterprise_id=e.enterprise_id and c.id::text=e.payload->>'conversationId' and c.status='open' and c.mode='ai'
    where e.type=${resultType} and not exists(select 1 from app.domain_event_deliveries d where d.enterprise_id=e.enterprise_id and d.event_id=e.id
      and d.consumer_key='construction:result:' || c.id::text) limit 20`));
  let count = 0;
  for (const candidate of candidates) await withTenantTransaction(String(candidate.enterprise_id), async tx => {
    const eid = String(candidate.enterprise_id), cid = String(candidate.conversation_id);
    if (!await one(tx, sql`select id from app.enterprises where id=${eid} and status='active' for share`)) return;
    if (!await one(tx, sql`select id from app.assistant_enterprise_settings where enterprise_id=${eid} and enabled for share`)) return;
    const c = await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${eid} and id=${cid} for update`);
    if (c) count += await syncSiteResults(tx, { enterpriseId: eid, principal: { kind: 'user', userId: String(candidate.customer_id) }, contextVersion: 0, capabilities: [] }, c);
  });
  return count;
}
