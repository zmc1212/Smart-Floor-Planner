import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { appendMessage } from '@/lib/assistant/core/conversation';
import { fail, type ActorContext } from '@/lib/assistant/contracts';
import { siteRecordText, type SiteDraft } from './site-contract';
import { deliverSiteResults, syncSiteResults } from './site-results';

/** Public projection: an exact publication/version/customer grant, never the internal conversation. */
export async function publishedSiteRecord(tx: PostgresTransaction, eid: string, uid: string, recordId: string, expectedVersion?: number, lock = false) {
  return one(tx, sql`select r.*,p.name as project_name from app.construction_site_records r
    join app.construction_projects p on p.enterprise_id=r.enterprise_id and p.id=r.project_id
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where r.enterprise_id=${eid} and r.id=${recordId} and r.status='published' and r.audience='customer' and r.published_customer_id=${uid}
    and l.customer_user_id=${uid} and l.archived_at is null and p.customer_access and p.status='active' and r.source_message_id is not null
    ${expectedVersion ? sql`and r.published_version=${expectedVersion}` : sql``}
    and (r.room_id is null or exists(select 1 from app.construction_rooms room where room.enterprise_id=r.enterprise_id and room.project_id=r.project_id and room.id=r.room_id and room.name=r.room_name_snapshot))
    ${lock ? sql`for share of p,l,r` : sql``}`);
}
export async function siteRecordProjection(tx: PostgresTransaction, eid: string, cid: string, mid: string, lock = false) {
  const source = await one(tx, sql`select e.aggregate_id,e.aggregate_version from app.assistant_messages m join app.domain_event_outbox e on e.enterprise_id=m.enterprise_id and e.id=m.source_event_id
    where m.enterprise_id=${eid} and m.conversation_id=${cid} and m.id=${mid} and m.purpose='construction.record' and e.type='construction.record.publish.v1'`);
  if (!source) return null;
  const owner = await one(tx, sql`select user_id from app.assistant_participants where enterprise_id=${eid} and conversation_id=${cid} and user_id is not null and status='active' order by id limit 1`);
  const r = owner && await publishedSiteRecord(tx, eid, String(owner.user_id), String(source.aggregate_id), Number(source.aggregate_version), lock);
  if (!r) return { available: false };
  const assets = await rows(tx, sql`select m.id::text from app.construction_site_attachments a join app.construction_site_media m on m.enterprise_id=a.enterprise_id and m.project_id=a.project_id and m.id=a.media_id
    where a.enterprise_id=${eid} and a.project_id=${String(r.project_id)} and a.record_id=${String(r.id)} and m.deleted_at is null order by a.position`);
  return { available: true, id: String(r.id), version: Number(r.published_version), assets: assets.map(m => String(m.id)) };
}
export async function siteBusinessRecords(tx: PostgresTransaction, eid: string, cid: string, mid: string) {
  const step = await one(tx, sql`select s.private_checkpoint from app.assistant_messages m join app.assistant_run_steps s on s.enterprise_id=m.enterprise_id and s.run_id=m.run_id
    where m.enterprise_id=${eid} and m.conversation_id=${cid} and m.id=${mid} and s.kind='agent_business_result'`);
  const snapshot = step?.private_checkpoint as { customerId?: string; query?: { domain?: string }; data?: Array<{ records?: Array<{ id: string; version: number }> }> } | undefined;
  if (snapshot?.query?.domain !== 'construction' || !snapshot.customerId) return [];
  const result = [];
  for (const project of snapshot.data || []) for (const source of project.records || []) {
    const r = await publishedSiteRecord(tx, eid, snapshot.customerId, source.id, source.version);
    if (!r) continue;
    const assets = await rows(tx, sql`select m.id::text from app.construction_site_attachments a join app.construction_site_media m on m.enterprise_id=a.enterprise_id and m.project_id=a.project_id and m.id=a.media_id
      where a.enterprise_id=${eid} and a.project_id=${String(r.project_id)} and a.record_id=${String(r.id)} and m.deleted_at is null order by a.position`);
    result.push({ available: true, id: String(r.id), version: Number(r.published_version), assets: assets.map(a => String(a.id)) });
  }
  return result;
}
export async function customerSiteMedia(tx: PostgresTransaction, actor: ActorContext, conversation: Row, recordId: string, mediaId: string, expectedVersion: number) {
  if (actor.principal.kind !== 'user' || conversation.purpose !== 'customer_consultation') fail('assistant_resource_not_found', 404);
  const r = await publishedSiteRecord(tx, actor.enterpriseId, actor.principal.userId, recordId, expectedVersion, true);
  const entry = conversation.entry_snapshot as Row;
  if (!r || (entry?.kind === 'lead' && !await one(tx, sql`select id from app.construction_projects where enterprise_id=${actor.enterpriseId} and id=${String(r.project_id)} and lead_id=${String(entry.id)}`))) fail('assistant_resource_not_found', 404);
  const m = await one(tx, sql`select m.data,m.mime_type from app.construction_site_attachments a join app.construction_site_media m on m.enterprise_id=a.enterprise_id and m.project_id=a.project_id and m.id=a.media_id
    where a.enterprise_id=${actor.enterpriseId} and a.project_id=${String(r.project_id)} and a.record_id=${recordId} and m.id=${mediaId} and m.deleted_at is null`);
  if (!m) fail('assistant_resource_not_found', 404);
  return { data: m.data as Buffer, mime: String(m.mime_type) };
}
export async function syncSitePublications(tx: PostgresTransaction, actor: ActorContext, conversation: Row) {
  await syncSiteResults(tx, actor, conversation);
  if (actor.principal.kind !== 'user' || conversation.purpose !== 'customer_consultation' || conversation.mode !== 'ai' || conversation.status !== 'open') return;
  const eid = actor.enterpriseId, uid = actor.principal.userId, entry = conversation.entry_snapshot as Row;
  if (!await one(tx, sql`select id from app.assistant_participants where enterprise_id=${eid} and conversation_id=${String(conversation.id)} and user_id=${uid} and status='active' for share`)) return;
  const events = await rows(tx, sql`select e.* from app.domain_event_outbox e join app.construction_site_records r on r.enterprise_id=e.enterprise_id and r.id::text=e.aggregate_id and r.published_version=e.aggregate_version
    join app.construction_projects p on p.enterprise_id=r.enterprise_id and p.id=r.project_id
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where e.enterprise_id=${eid} and e.type='construction.record.publish.v1' and r.published_customer_id=${uid}
    and r.status='published' and r.audience='customer' and p.status='active' and p.customer_access and l.customer_user_id=${uid} and l.archived_at is null
    and r.source_message_id is not null
    and (r.room_id is null or exists(select 1 from app.construction_rooms room where room.enterprise_id=r.enterprise_id and room.project_id=r.project_id and room.id=r.room_id and room.name=r.room_name_snapshot))
    and not exists(select 1 from app.domain_event_deliveries d where d.enterprise_id=e.enterprise_id and d.event_id=e.id and d.consumer_key=${'construction:record:user:' + uid})
    ${entry?.kind === 'lead' ? sql`and p.lead_id=${String(entry.id)}` : sql``}
    and exists(select 1 from app.construction_watches w where w.enterprise_id=r.enterprise_id and w.project_id=r.project_id and w.customer_id=${uid}
      and w.active and w.started_at<=r.published_at and (w.room_id is null or (w.room_id=r.room_id and w.room_name_snapshot=r.room_name_snapshot))
      and (not w.photos_only or exists(select 1 from app.construction_site_attachments a join app.construction_site_media m on m.enterprise_id=a.enterprise_id and m.project_id=a.project_id and m.id=a.media_id
        where a.enterprise_id=r.enterprise_id and a.project_id=r.project_id and a.record_id=r.id and m.deleted_at is null))) order by e.id limit 50`);
  for (const e of events) {
    const r = await publishedSiteRecord(tx, eid, uid, String(e.aggregate_id), Number(e.aggregate_version), true);
    if (!r) continue;
    const watch = await one(tx, sql`select w.id from app.construction_watches w where w.enterprise_id=${eid} and w.project_id=${String(r.project_id)} and w.customer_id=${uid} and w.active
      and w.started_at<=${r.published_at as Date} and (w.room_id is null or (w.room_id=${r.room_id as string | null} and w.room_name_snapshot=${String(r.room_name_snapshot)}))
      and (not w.photos_only or exists(select 1 from app.construction_site_attachments a join app.construction_site_media m on m.enterprise_id=a.enterprise_id and m.project_id=a.project_id and m.id=a.media_id
        where a.enterprise_id=w.enterprise_id and a.project_id=w.project_id and a.record_id=${String(r.id)} and m.deleted_at is null)) limit 1 for share`);
    if (!watch) continue;
    const delivery = await one(tx, sql`insert into app.domain_event_deliveries(enterprise_id,event_id,consumer_key,status)
      values(${eid},${String(e.id)},${'construction:record:user:' + uid},'processing') on conflict do nothing returning id`);
    if (!delivery) continue;
    await appendMessage(tx, actor, String(conversation.id), { author: 'system', eventId: String(e.id), purpose: 'construction.record',
      content: { version: 1, blocks: [{ type: 'text', text: `「${String(r.project_name)}」有一条已发布进展：\n${siteRecordText(r.data as SiteDraft, String(r.room_name_snapshot))}` }] } });
    await tx.execute(sql`update app.domain_event_deliveries set status='delivered',updated_at=now() where enterprise_id=${eid} and id=${String(delivery.id)}`);
  }
}
/** Existing Worker also consumes publication outbox events while all Mini pages are closed. */
export async function deliverSiteNotifications() {
  const candidates = await withPlatformTransaction(tx => rows(tx, sql`select distinct r.enterprise_id,c.id as conversation_id,r.published_customer_id as customer_id
    from app.domain_event_outbox e join app.construction_site_records r on r.enterprise_id=e.enterprise_id and r.id::text=e.aggregate_id and r.published_version=e.aggregate_version
    join app.construction_projects p on p.enterprise_id=r.enterprise_id and p.id=r.project_id
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id and l.customer_user_id=r.published_customer_id and l.archived_at is null
    join app.enterprises ent on ent.id=r.enterprise_id and ent.status='active'
    join app.assistant_enterprise_settings s on s.enterprise_id=r.enterprise_id and s.enabled
    join lateral(select c.id from app.assistant_conversations c join app.assistant_participants ap on ap.enterprise_id=c.enterprise_id and ap.conversation_id=c.id and ap.user_id=r.published_customer_id and ap.status='active'
      where c.enterprise_id=r.enterprise_id and c.purpose='customer_consultation' and c.status='open' and c.mode='ai'
        and (coalesce(c.entry_snapshot->>'kind','')<>'lead' or c.entry_snapshot->>'id'=p.lead_id::text)
      order by (c.entry_snapshot->>'kind'='lead') desc nulls last,c.id desc limit 1) c on true
    where e.type='construction.record.publish.v1' and r.status='published' and r.audience='customer' and p.status='active' and p.customer_access
    and r.source_message_id is not null
    and (r.room_id is null or exists(select 1 from app.construction_rooms room where room.enterprise_id=r.enterprise_id and room.project_id=r.project_id and room.id=r.room_id and room.name=r.room_name_snapshot))
    and not exists(select 1 from app.domain_event_deliveries d where d.enterprise_id=e.enterprise_id and d.event_id=e.id and d.consumer_key='construction:record:user:' || r.published_customer_id::text)
    and exists(select 1 from app.construction_watches w where w.enterprise_id=r.enterprise_id and w.project_id=r.project_id and w.customer_id=r.published_customer_id and w.active and w.started_at<=r.published_at
      and (w.room_id is null or (w.room_id=r.room_id and w.room_name_snapshot=r.room_name_snapshot)) and (not w.photos_only or exists(select 1 from app.construction_site_attachments a where a.enterprise_id=r.enterprise_id and a.project_id=r.project_id and a.record_id=r.id)))
    limit 20`));
  let delivered = 0;
  for (const candidate of candidates) {
    await withTenantTransaction(String(candidate.enterprise_id), async tx => {
      if (!await one(tx, sql`select id from app.enterprises where id=${String(candidate.enterprise_id)} and status='active' for share`)) return;
      if (!await one(tx, sql`select id from app.assistant_enterprise_settings where enterprise_id=${String(candidate.enterprise_id)} and enabled for update`)) return;
      const c = await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${String(candidate.enterprise_id)} and id=${String(candidate.conversation_id)} and purpose='customer_consultation' for update`);
      if (!c) return;
      const before = Number(c.last_seq);
      await syncSitePublications(tx, { enterpriseId: String(candidate.enterprise_id), principal: { kind: 'user', userId: String(candidate.customer_id) }, contextVersion: 0, capabilities: [] }, c);
      const after = await one(tx, sql`select last_seq from app.assistant_conversations where enterprise_id=${String(candidate.enterprise_id)} and id=${String(c.id)}`);
      delivered += Number(after?.last_seq || before) - before;
    });
  }
  return delivered + await deliverSiteResults();
}
