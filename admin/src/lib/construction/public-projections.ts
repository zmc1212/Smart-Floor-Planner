import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { appendMessage } from '@/lib/assistant/core/conversation';
import type { ActorContext } from '@/lib/assistant/contracts';
import { publicMaterial, publicMaterialDto, publishedPublicMaterial } from './public-read';
import { publicStatusLabels, type PublicContent } from './public-contract';

export type PublicContextRef = { siteId: string; versionId: string };
export async function publicContextSnapshot(tx: PostgresTransaction, eid: string, ref: PublicContextRef) {
  const m = await publishedPublicMaterial(tx, eid, ref.siteId, ref.versionId);
  return m ? { ...ref, contentHash: String(m.version.content_hash), content: m.version.content as PublicContent } : null;
}
export async function publicContextAvailable(tx: PostgresTransaction, eid: string, ref: PublicContextRef & { contentHash?: string }) {
  const m = await publishedPublicMaterial(tx, eid, ref.siteId, ref.versionId);
  return !!m && (!ref.contentHash || m.version.content_hash === ref.contentHash);
}
export async function publicMessageProjection(tx: PostgresTransaction, actor: ActorContext, c: Row, messageId: string) {
  const event = await one(tx, sql`select e.type,e.payload from app.assistant_messages m join app.domain_event_outbox e on e.enterprise_id=m.enterprise_id and e.id=m.source_event_id
    where m.enterprise_id=${actor.enterpriseId} and m.conversation_id=${String(c.id)} and m.id=${messageId} and m.purpose in ('construction.public.consent','construction.public.context')`);
  if (!event) {
    const refs = await one(tx, sql`select s.source_refs from app.assistant_run_steps s join app.assistant_messages m on m.enterprise_id=s.enterprise_id and m.run_id=s.run_id
      where m.enterprise_id=${actor.enterpriseId} and m.conversation_id=${String(c.id)} and m.id=${messageId} and s.kind='agent_public_context'`);
    if (!refs) return null;
    const references = [];
    for (const ref of (refs.source_refs || []) as PublicContextRef[]) {
      const material = await publishedPublicMaterial(tx, actor.enterpriseId, ref.siteId, ref.versionId);
      if (!material) return { available: false };
      references.push(await publicMaterialDto(tx, material.site, material.version));
    }
    return { available: true, publicReferences: references };
  }
  const ref = event.payload as PublicContextRef & { customerId?: string };
  if (event.type === 'construction.public.context.v1') {
    const material = await publishedPublicMaterial(tx, actor.enterpriseId, ref.siteId, ref.versionId);
    return material ? { available: true, publicContext: await publicMaterialDto(tx, material.site, material.version) } : { available: false };
  }
  const owner = await one(tx, sql`select user_id::text from app.assistant_participants where enterprise_id=${actor.enterpriseId} and conversation_id=${String(c.id)} and status='active' and user_id is not null order by id limit 1`);
  if (!owner || String(owner.user_id) !== ref.customerId) return { available: false };
  const material = await publicMaterial(tx, actor.enterpriseId, ref.siteId, ref.versionId);
  if (!material || String(material.site.customer_id) !== ref.customerId) return { available: false };
  const content = material.version.content as PublicContent;
  const ownAction = actor.principal.kind === 'user' && actor.principal.userId === ref.customerId;
  const dto = await publicMaterialDto(tx, material.site, material.version);
  return { available: true, publicConsent: { ...dto, excerpts: content.excerpts.slice(0, 1), excerptCount: content.excerpts.length,
    canDecide: ownAction && material.site.status === 'pending_owner' && c.status === 'open',
    canWithdraw: ownAction && ['pending_owner','owner_approved','published','rejected'].includes(String(material.site.status)) && c.status === 'open',
    reason: String(material.site.reason || '') } };
}
export async function publicMessageAvailable(tx: PostgresTransaction, eid: string, cid: string, mid: string) {
  const m = await one(tx, sql`select m.purpose,e.payload from app.assistant_messages m left join app.domain_event_outbox e on e.enterprise_id=m.enterprise_id and e.id=m.source_event_id
    where m.enterprise_id=${eid} and m.conversation_id=${cid} and m.id=${mid}`);
  if (m?.purpose === 'construction.public.context') return publicContextAvailable(tx, eid, m.payload as PublicContextRef);
  const dependency = await one(tx, sql`select s.source_refs from app.assistant_run_steps s join app.assistant_messages m on m.enterprise_id=s.enterprise_id and m.run_id=s.run_id
    where m.enterprise_id=${eid} and m.conversation_id=${cid} and m.id=${mid} and s.kind='agent_public_context'`);
  for (const ref of (dependency?.source_refs || []) as PublicContextRef[]) if (!await publicContextAvailable(tx, eid, ref)) return false;
  return true;
}
/** Necessary decision cards are service events, including while a real person is serving the owner. */
export async function syncPublicConsents(tx: PostgresTransaction, actor: ActorContext, c: Row) {
  if (actor.principal.kind !== 'user' || c.purpose !== 'customer_consultation' || c.status !== 'open') return;
  const eid = actor.enterpriseId, uid = actor.principal.userId, entry = c.entry_snapshot as Row;
  const events = await rows(tx, sql`select e.* from app.domain_event_outbox e join app.construction_public_sites s
    on s.enterprise_id=e.enterprise_id and s.id::text=e.aggregate_id and s.revision=e.aggregate_version
    join app.construction_projects p on p.enterprise_id=s.enterprise_id and p.id=s.project_id
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id and l.customer_user_id=s.customer_id
    where e.enterprise_id=${eid} and e.type in ('construction.public.consent.v1','construction.public.status.v1') and s.customer_id=${uid}
      and e.payload->>'versionId'=s.current_version_id::text and p.status='active' and p.customer_access and l.archived_at is null and l.status<>'closed'
      ${entry.kind === 'lead' ? sql`and p.lead_id=${String(entry.id)}` : sql``}
      and not exists(select 1 from app.domain_event_deliveries d where d.enterprise_id=e.enterprise_id and d.event_id=e.id and d.consumer_key=${'public-consent:user:' + uid})
    order by e.id limit 30`);
  for (const event of events) {
    const ref = event.payload as { siteId: string; versionId: string };
    const material = await publicMaterial(tx, eid, ref.siteId, ref.versionId);
    if (!material) continue;
    const delivery = await one(tx, sql`insert into app.domain_event_deliveries(enterprise_id,event_id,consumer_key,status)
      values(${eid},${String(event.id)},${'public-consent:user:' + uid},'processing') on conflict do nothing returning id`);
    if (!delivery) continue;
    await appendMessage(tx, actor, String(c.id), { author: 'system', eventId: String(event.id), purpose: 'construction.public.consent',
      content: { version: 1, blocks: [{ type: 'text', text: material.site.status === 'pending_owner'
        ? '团队整理了一份公开预览，想请你核对。是否公开，由你决定。'
        : `这份公开材料的状态：${publicStatusLabels[String(material.site.status)] || '已更新'}。` }] } });
    await tx.execute(sql`update app.domain_event_deliveries set status='delivered',updated_at=now() where enterprise_id=${eid} and id=${String(delivery.id)}`);
  }
}
export async function deliverPublicConsents() {
  const candidates = await withPlatformTransaction(tx => rows(tx, sql`select distinct s.enterprise_id,s.customer_id,c.id as conversation_id,u.context_version from app.construction_public_sites s
    join app.users u on u.id=s.customer_id join app.construction_projects p on p.enterprise_id=s.enterprise_id and p.id=s.project_id
    join lateral(select c.id from app.assistant_conversations c join app.assistant_participants ap on ap.enterprise_id=c.enterprise_id and ap.conversation_id=c.id and ap.user_id=s.customer_id and ap.status='active'
      where c.enterprise_id=s.enterprise_id and c.purpose='customer_consultation' and c.status='open'
        and (coalesce(c.entry_snapshot->>'kind','')<>'lead' or c.entry_snapshot->>'id'=p.lead_id::text) order by c.id desc limit 1) c on true
    where s.status<>'draft' and exists(select 1 from app.domain_event_outbox e where e.enterprise_id=s.enterprise_id and e.aggregate_id=s.id::text and e.aggregate_version=s.revision
      and e.type in ('construction.public.consent.v1','construction.public.status.v1')
      and not exists(select 1 from app.domain_event_deliveries d where d.enterprise_id=e.enterprise_id and d.event_id=e.id and d.consumer_key='public-consent:user:' || s.customer_id::text)) limit 20`));
  let count = 0;
  for (const item of candidates) await withTenantTransaction(String(item.enterprise_id), async tx => {
    const actor: ActorContext = { enterpriseId: String(item.enterprise_id), principal: { kind: 'user', userId: String(item.customer_id) }, contextVersion: Number(item.context_version), capabilities: [] };
    if (!(await one(tx, sql`select app.assistant_identity_is_current(${String(item.customer_id)}::bigint,${Number(item.context_version)}::integer) as allowed`))?.allowed) return;
    if (!await one(tx, sql`select enterprise_id from app.assistant_enterprise_settings where enterprise_id=${actor.enterpriseId} and enabled for update`)) return;
    const c = await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${String(item.conversation_id)} and status='open' for update`);
    if (c) { await syncPublicConsents(tx, actor, c); count++; }
  });
  return count;
}
