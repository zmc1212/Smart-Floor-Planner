import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { appendMessage } from '@/lib/assistant/core/conversation';
import { safeText, type ActorContext, type MessageContent } from '@/lib/assistant/contracts';
import { applyMaterialCommand, materialCommand } from './site-materials';

export function siteWatchIntent(text: string) {
  if (/[？?]|如果|假如|怎么|如何|是否|能否|意思|吗/.test(text)) return null;
  if (/不要取消|别取消|不想取消|不需要取消|不用取消/.test(text)) return null;
  if (/不用再提醒|不要再提醒|取消关注|停止提醒|不再提醒/.test(text)) return { cancel: true, photosOnly: false };
  if (/不想|不要|不用|不需要|暂不|以后再|别/.test(text)) return null;
  if (/(?:有|一旦有).{0,30}(?:新照片|照片|进展|更新).{0,8}(?:告诉我|通知我|提醒我)/.test(text)) return { cancel: false, photosOnly: /照片/.test(text) };
  return null;
}
async function receipt(tx: PostgresTransaction, actor: ActorContext, cid: string, sourceId: string, text: string, watchId?: string) {
  const event = (await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${actor.enterpriseId},'construction.watch.changed.v1','assistant_message',${sourceId},1,${JSON.stringify(actor.principal)}::jsonb,${sourceId},${JSON.stringify({ watchId: watchId || null })}::jsonb) returning id`))!;
  await appendMessage(tx, actor, cid, { author: 'system', eventId: String(event.id), purpose: 'construction.watch', content: { version: 1, blocks: [{ type: 'text', text }] } });
}
/** Explicit, bounded commands only. Ordinary approval words never change a watch. */
export async function applySiteWatch(tx: PostgresTransaction, actor: ActorContext, conversation: Row, message: Row) {
  if (actor.principal.kind !== 'user') return false;
  const raw = safeText(message.content as Parameters<typeof safeText>[0]).trim(), eid = actor.enterpriseId, uid = actor.principal.userId;
  const entry = conversation.entry_snapshot as Row, pending = entry.siteWatchQuestion as Row | undefined;
  let intent = siteWatchIntent(raw);
  const direct = !!intent;
  if (conversation.mode !== 'ai' && !intent?.cancel) return false;
  if (!intent && !pending) return false;
  if (intent?.cancel && /^(?:不用再提醒了?|不要再提醒了?|不再提醒了?|停止提醒|取消关注)[。！!]?$/u.test(raw)) {
    await tx.execute(sql`update app.construction_watches w set active=false,source_message_id=${String(message.id)},updated_at=now()
      where w.enterprise_id=${eid} and w.customer_id=${uid} ${entry.kind === 'lead' ? sql`and exists(select 1 from app.construction_projects p where p.enterprise_id=w.enterprise_id and p.id=w.project_id and p.lead_id=${String(entry.id)})` : sql``}`);
    await receipt(tx, actor, String(conversation.id), String(message.id), '已停止当前咨询范围的工地进展提醒。');
    await tx.execute(sql`update app.assistant_conversations set entry_snapshot=entry_snapshot-'siteWatchQuestion' where enterprise_id=${eid} and id=${String(conversation.id)}`);
    return true;
  }
  const projects = await rows(tx, sql`select p.id::text,p.name from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where p.enterprise_id=${eid} and ${intent?.cancel || pending?.cancel ? sql`p.status in ('active','paused')` : sql`p.status='active'`} and p.customer_access and l.customer_user_id=${uid} and l.archived_at is null
    ${entry.kind === 'lead' ? sql`and l.id=${String(entry.id)}` : sql``} order by p.id for share of p,l`);
  const rooms = await rows(tx, sql`select r.id::text,r.project_id::text,r.name from app.construction_rooms r join app.construction_projects p on p.enterprise_id=r.enterprise_id and p.id=r.project_id
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id where r.enterprise_id=${eid} and ${intent?.cancel || pending?.cancel ? sql`p.status in ('active','paused')` : sql`p.status='active'`} and p.customer_access and l.customer_user_id=${uid} and l.archived_at is null`);
  if (!intent && pending && (projects.some(p => p.name === raw) || rooms.some(r => r.name === raw) || /^(整个工地|全部房间)$/.test(raw))) intent = { cancel: pending.cancel === true, photosOnly: pending.photosOnly === true };
  if (!intent) {
    if (pending) await tx.execute(sql`update app.assistant_conversations set entry_snapshot=entry_snapshot-'siteWatchQuestion' where enterprise_id=${eid} and id=${String(conversation.id)}`);
    return false;
  }
  if (!projects.length) { await receipt(tx, actor, String(conversation.id), String(message.id), '当前没有对你开放的施工项目，可以先和项目团队确认。'); return true; }
  const hint = !direct && pending?.roomNameHint && !/^(整个工地|全部房间)$/.test(raw) ? raw + ' ' + String(pending.roomNameHint) : raw;
  const named = projects.filter(p => raw.includes(String(p.name))), hintedRooms = rooms.filter(r => hint.includes(String(r.name)) && projects.some(p => p.id === r.project_id));
  const chosen = named.length === 1 ? named[0] : projects.length === 1 ? projects[0]
    : hintedRooms.length === 1 ? projects.find(p => p.id === hintedRooms[0].project_id) : pending?.projectId ? projects.find(p => p.id === pending.projectId) : undefined;
  const selectedRooms = chosen ? hintedRooms.filter(r => r.project_id === chosen.id) : hintedRooms;
  const unknownRoom = !selectedRooms.length && /(?:卧室|书房|厨房|卫生间|客厅|阳台|餐厅)/.test(hint);
  if (!chosen || named.length > 1 || selectedRooms.length > 1 || unknownRoom) {
    const question = !chosen ? '想关注哪个工地？请说具体项目名。' : '想关注哪个房间？请说一个已登记的房间名，或说“整个工地”。';
    const names = [...new Set(hintedRooms.map(r => String(r.name)))];
    await tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot,'{siteWatchQuestion}',${JSON.stringify({ ...intent, projectId: chosen?.id || null, roomNameHint: names.length === 1 ? names[0] : null })}::jsonb) where enterprise_id=${eid} and id=${String(conversation.id)}`);
    await receipt(tx, actor, String(conversation.id), String(message.id), question); return true;
  }
  const room = selectedRooms[0], roomId = room?.id || null;
  if (intent.cancel) {
    await tx.execute(sql`update app.construction_watches set active=false,source_message_id=${String(message.id)},updated_at=now() where enterprise_id=${eid} and project_id=${String(chosen.id)} and customer_id=${uid}
      ${roomId ? sql`and room_id=${String(roomId)}` : sql``}`);
    await receipt(tx, actor, String(conversation.id), String(message.id), `已停止「${String(chosen.name)}${room ? ' · ' + String(room.name) : ''}」的进展提醒。已发布内容仍可在咨询中询问。`);
  } else {
    const watch = (await one(tx, sql`insert into app.construction_watches(enterprise_id,project_id,customer_id,room_id,room_name_snapshot,photos_only,source_message_id)
      values(${eid},${String(chosen.id)},${uid},${roomId},${String(room?.name || '')},${intent.photosOnly},${String(message.id)})
      on conflict(enterprise_id,project_id,customer_id,room_id) do update set active=true,photos_only=excluded.photos_only,room_name_snapshot=excluded.room_name_snapshot,
        source_message_id=excluded.source_message_id,started_at=case when construction_watches.active then construction_watches.started_at else now() end,updated_at=now() returning id`))!;
    await receipt(tx, actor, String(conversation.id), String(message.id), `记下了，「${String(chosen.name)}${room ? ' · ' + String(room.name) : ''}」有团队明确发布的${intent.photosOnly ? '新照片' : '进展'}时，会在这里告诉你。`, String(watch.id));
  }
  await tx.execute(sql`update app.assistant_conversations set entry_snapshot=entry_snapshot-'siteWatchQuestion' where enterprise_id=${eid} and id=${String(conversation.id)}`);
  return true;
}
export const siteWatchInterceptor = {
  matches(content: MessageContent, c: Row) { return !!materialCommand(safeText(content).trim()) || !!siteWatchIntent(safeText(content)) || !!(c.entry_snapshot as Row)?.siteWatchQuestion; },
  async apply(tx: PostgresTransaction, actor: ActorContext, c: Row, message: Row) {
    return await applyMaterialCommand(tx, actor, c, message) || await applySiteWatch(tx, actor, c, message);
  },
};
export async function siteWatchProjection(tx: PostgresTransaction, eid: string, cid: string, mid: string) {
  const watch = await one(tx, sql`select w.id::text,w.active,p.name as project_name,room.name as room_name from app.assistant_messages m
    join app.domain_event_outbox e on e.enterprise_id=m.enterprise_id and e.id=m.source_event_id
    join app.construction_watches w on w.enterprise_id=e.enterprise_id and w.id::text=e.payload->>'watchId'
    join app.construction_projects p on p.enterprise_id=w.enterprise_id and p.id=w.project_id
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id and l.customer_user_id=w.customer_id and l.archived_at is null
    join app.assistant_participants ap on ap.enterprise_id=m.enterprise_id and ap.conversation_id=m.conversation_id and ap.user_id=w.customer_id and ap.status='active'
    left join app.construction_rooms room on room.enterprise_id=w.enterprise_id and room.project_id=w.project_id and room.id=w.room_id
    where m.enterprise_id=${eid} and m.conversation_id=${cid} and m.id=${mid} and m.purpose='construction.watch' and w.active and p.status='active' and p.customer_access
    and (w.room_id is null or room.name=w.room_name_snapshot)`);
  return watch ? { id: String(watch.id), cancelText: `${String(watch.project_name)}${watch.room_name ? ' · ' + String(watch.room_name) : ''}不用再提醒` } : null;
}
