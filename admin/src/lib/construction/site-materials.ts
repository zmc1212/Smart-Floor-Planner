import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, safeText, type ActorContext, type MessageContent } from '@/lib/assistant/contracts';
import { appendMessage } from '@/lib/assistant/core/conversation';

export type SharedMaterial = { id: string; projectId: string; roomId: string; roomName: string; kind: 'need' | 'drawing';
  conversationId: string; customerId: string; sourceMessageId: string; sourceHash: string; text: string;
  mediaId: string | null; mediaHash: string | null };
const grantType = 'construction.material.shared.v1';
const revokeType = 'construction.material.revoked.v1';

export function materialCommand(raw: string) {
  const revoke = /^撤回共享资料\s*([1-9]\d{0,18})[。！!\s]*$/.exec(raw);
  if (revoke) return { action: 'revoke' as const, id: revoke[1] };
  const share = new RegExp('^共享(.{1,100}?)(需求|点位图)[：:]\\s*(.{1,2000})$', 's').exec(raw);
  return share ? { action: 'share' as const, scope: share[1].trim(), kind: share[2] === '需求' ? 'need' as const : 'drawing' as const, text: share[3].trim() } : null;
}

/** An S01 staff grant is deliberately insufficient here. Only the customer's exact opt-in creates this audience. */
export async function applyMaterialCommand(tx: PostgresTransaction, actor: ActorContext, c: Row, message: Row) {
  const cmd = materialCommand(safeText(message.content as MessageContent).trim());
  if (!cmd || actor.principal.kind !== 'user' || c.purpose !== 'customer_consultation') return false;
  const eid = actor.enterpriseId, uid = actor.principal.userId, cid = String(c.id);
  let event: Row, feedback: string;
  if (cmd.action === 'revoke') {
    const grant = await one(tx, sql`select payload from app.domain_event_outbox where enterprise_id=${eid} and id=${cmd.id}
      and type=${grantType} and payload->>'customerId'=${uid} and payload->>'conversationId'=${cid}`);
    if (!grant) fail('assistant_resource_not_found', 404);
    const payload = grant.payload as SharedMaterial;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`site-material:${eid}:${payload.projectId}`},0))`);
    event = (await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
      values(${eid},${revokeType},'construction_shared_material',${cmd.id},1,${JSON.stringify(actor.principal)}::jsonb,${String(message.id)},
      ${JSON.stringify({ projectId: payload.projectId, grantId: cmd.id, customerId: uid, conversationId: cid })}::jsonb)
      on conflict(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version) do update set aggregate_id=excluded.aggregate_id returning id`))!;
    feedback = `共享资料${cmd.id}已撤回，项目成员不能继续读取，相关旧处理结果不再沿用。`;
  } else {
    const scope = await rows(tx, sql`select p.id::text as project_id,r.id::text as room_id,r.name as room_name,p.name as project_name
      from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
      join app.construction_rooms r on r.enterprise_id=p.enterprise_id and r.project_id=p.id
      where p.enterprise_id=${eid} and p.status='active' and p.customer_access and l.customer_user_id=${uid} and l.archived_at is null
      and (coalesce(${JSON.stringify(c.entry_snapshot)}::jsonb->>'kind','')<>'lead' or l.id::text=${JSON.stringify(c.entry_snapshot)}::jsonb->>'id')
      and (r.name=${cmd.scope} or p.name || '·' || r.name=${cmd.scope}) for share of p,l,r`);
    if (scope.length !== 1 || !cmd.text) fail('construction_material_scope_required', 422);
    const room = scope[0], pid = String(room.project_id), roomId = String(room.room_id);
    // Grants and issue writes serialize on the same project key. Re-read sources inside this transaction.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`site-material:${eid}:${pid}`},0))`);
    let mediaId: string | null = null;
    if (cmd.kind === 'drawing') {
      // C01 sends a chosen photo immediately. Only the immediately preceding own
      // upload can be explicitly shared this way; never search an arbitrary private gallery.
      const previous = await one(tx, sql`select a.id from app.assistant_messages m join app.assistant_media a
        on a.enterprise_id=m.enterprise_id and a.conversation_id=m.conversation_id and m.client_message_id='media:' || a.request_key
        where m.enterprise_id=${eid} and m.conversation_id=${cid} and m.user_id=${uid} and m.author_kind='user'
        and m.id=(select id from app.assistant_messages where enterprise_id=${eid} and conversation_id=${cid} and author_kind='user'
          and user_id=${uid} and seq<${String(message.seq)} order by seq desc limit 1)
        and a.customer_user_id=${uid} and a.deleted_at is null and a.source_ref is null for share of a,m`);
      mediaId = previous ? String(previous.id) : null;
      if (!mediaId) fail('construction_material_image_required', 422);
    }
    const media = mediaId ? await one(tx, sql`select id,source_hash from app.assistant_media where enterprise_id=${eid}
      and conversation_id=${cid} and customer_user_id=${uid} and id=${mediaId} and deleted_at is null and source_ref is null for share`) : null;
    if (mediaId && !media) fail('assistant_resource_not_found', 404);
    const payload: Omit<SharedMaterial, 'id'> = { projectId: pid, roomId, roomName: String(room.room_name), kind: cmd.kind,
      customerId: uid, conversationId: cid, sourceMessageId: String(message.id), sourceHash: fingerprint(message.content), text: cmd.text,
      mediaId, mediaHash: media ? String(media.source_hash) : null };
    event = (await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
      values(${eid},${grantType},'assistant_message',${String(message.id)},1,${JSON.stringify(actor.principal)}::jsonb,${String(message.id)},${JSON.stringify(payload)}::jsonb) returning id`))!;
    feedback = `已将「${room.project_name} · ${room.room_name}」本次${cmd.kind === 'need' ? '需求节选' : '点位图原件及说明'}共享给当前项目成员，资料${event.id}。本次内容替换该房间同类共享资料；其他私聊没有共享。${cmd.kind === 'drawing' ? '图纸仍待有权人员核对关联，不代表批准。' : ''}处理回复可由有权管理者明确回传本咨询。需要停止共享可说“撤回共享资料${event.id}”。`;
  }
  await appendMessage(tx, actor, cid, { author: 'system', eventId: String(event.id), purpose: 'construction.material',
    content: { version: 1, blocks: [{ type: 'text', text: feedback }] } });
  return true;
}

/** Internal source validation does not grant access to the source consultation or its other media. */
export async function sharedMaterial(tx: PostgresTransaction, eid: string, pid: string, grantId: string): Promise<SharedMaterial | null> {
  const event = await one(tx, sql`select e.id,e.payload,m.content,r.name as room_name from app.domain_event_outbox e
    join app.construction_projects p on p.enterprise_id=e.enterprise_id and p.id::text=e.payload->>'projectId'
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id and l.customer_user_id::text=e.payload->>'customerId'
    join app.construction_rooms r on r.enterprise_id=p.enterprise_id and r.project_id=p.id and r.id::text=e.payload->>'roomId'
    join app.assistant_conversations c on c.enterprise_id=e.enterprise_id and c.id::text=e.payload->>'conversationId'
    join app.assistant_participants ap on ap.enterprise_id=c.enterprise_id and ap.conversation_id=c.id and ap.user_id=l.customer_user_id and ap.status='active'
    join app.assistant_messages m on m.enterprise_id=c.enterprise_id and m.conversation_id=c.id and m.id::text=e.payload->>'sourceMessageId' and m.user_id=l.customer_user_id and m.author_kind='user'
    where e.enterprise_id=${eid} and e.id=${grantId} and e.type=${grantType} and p.id=${pid} and p.status='active' and p.customer_access
    and l.archived_at is null and c.status='open' and not coalesce((c.entry_snapshot->>'retentionRedacted')::boolean,false)
    and (coalesce(c.entry_snapshot->>'kind','')<>'lead' or c.entry_snapshot->>'id'=p.lead_id::text)
    and not exists(select 1 from app.domain_event_outbox revoked where revoked.enterprise_id=e.enterprise_id and revoked.type=${revokeType} and revoked.aggregate_id=e.id::text)
    and not exists(select 1 from app.domain_event_outbox newer where newer.enterprise_id=e.enterprise_id and newer.type=${grantType} and newer.id>e.id
      and newer.payload->>'projectId'=e.payload->>'projectId' and newer.payload->>'roomId'=e.payload->>'roomId' and newer.payload->>'kind'=e.payload->>'kind')
    for share of p,l,r,c,ap,m`);
  if (!event) return null;
  const source = { ...(event.payload as Omit<SharedMaterial, 'id'>), id: String(event.id) };
  if (source.roomName !== event.room_name || source.sourceHash !== fingerprint(event.content)) return null;
  if (source.mediaId && !await one(tx, sql`select id from app.assistant_media where enterprise_id=${eid} and conversation_id=${source.conversationId}
    and customer_user_id=${source.customerId} and id=${source.mediaId} and source_hash=${source.mediaHash} and source_ref is null and deleted_at is null for share`)) return null;
  return source;
}

export async function sharedMaterials(tx: PostgresTransaction, eid: string, pid: string, roomId: string) {
  const events = await rows(tx, sql`select distinct on (payload->>'kind') id from app.domain_event_outbox where enterprise_id=${eid}
    and type=${grantType} and payload->>'projectId'=${pid} and payload->>'roomId'=${roomId} order by payload->>'kind',id desc`);
  const sources: SharedMaterial[] = [];
  for (const e of events) { const source = await sharedMaterial(tx, eid, pid, String(e.id)); if (source) sources.push(source); }
  return { sources, version: fingerprint(sources.map(s => ({ id: s.id, sourceHash: s.sourceHash, mediaHash: s.mediaHash, roomId: s.roomId, roomName: s.roomName }))) };
}

export async function sharedMaterialMedia(tx: PostgresTransaction, eid: string, pid: string, grantId: string, mediaId: string) {
  const source = await sharedMaterial(tx, eid, pid, grantId);
  if (!source || source.mediaId !== mediaId) fail('construction_not_found', 404);
  const media = (await one(tx, sql`select data,mime_type from app.assistant_media where enterprise_id=${eid}
    and id=${mediaId} and conversation_id=${source.conversationId} and deleted_at is null and source_hash=${source.mediaHash} for share`))!;
  return { data: media.data as Buffer, mime: String(media.mime_type) };
}
