import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { appendMessage } from '@/lib/assistant/core/conversation';
import { safeText, type ActorContext, type MessageContent } from '@/lib/assistant/contracts';
import { applyMaterialCommand, materialCommand } from './site-materials';
import { applyMaterialShareReply, hasMaterialShareReply } from './material-sharing';
import { siteWatchIntent, siteWatchReply, unscopedSiteWatchCancel } from './site-watch-contract';

import { applyDelegationCommand, delegationCommand } from '@/lib/native-workflow/live/delegation-chat';
import { delegationsEnabled } from '@/lib/native-workflow/live/delegation-store';

export { siteWatchIntent } from './site-watch-contract';
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
  if (conversation.mode !== 'ai' && (intent ? !intent.cancel : pending?.cancel !== true)) return false;
  if (!intent && !pending) return false;
  if (intent?.cancel && unscopedSiteWatchCancel(raw)) {
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
  const reply = !intent && pending ? siteWatchReply(raw, projects.map(p => String(p.name)), rooms.flatMap(r => {
    const project = projects.find(p => p.id === r.project_id);
    return project ? [{ project: String(project.name), name: String(r.name) }] : [];
  })) : null;
  if (reply) intent = { cancel: pending!.cancel === true, photosOnly: pending!.photosOnly === true };
  if (!intent) {
    if (pending) await tx.execute(sql`update app.assistant_conversations set entry_snapshot=entry_snapshot-'siteWatchQuestion' where enterprise_id=${eid} and id=${String(conversation.id)}`);
    return false;
  }
  if (!projects.length) { await receipt(tx, actor, String(conversation.id), String(message.id), '当前没有对你开放的施工项目，可以先和项目团队确认。'); return true; }
  const selection = reply || raw;
  const hasRoomChoice = rooms.some(r => selection.includes(String(r.name)));
  const hint = !direct && pending?.roomNameHint && !hasRoomChoice && !/^(整个工地|全部房间)$/.test(selection) ? selection + ' ' + String(pending.roomNameHint) : selection;
  const named = projects.filter(p => raw.includes(String(p.name))), hintedRooms = rooms.filter(r => hint.includes(String(r.name)) && projects.some(p => p.id === r.project_id));
  const chosen = named.length === 1 ? named[0] : !direct && pending?.projectId ? projects.find(p => p.id === pending.projectId) : projects.length === 1 ? projects[0]
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
  matches(content: MessageContent, c: Row) {
    const text = safeText(content).trim();
    return c.purpose === 'customer_consultation' && delegationsEnabled(String(c.enterprise_id)) && !!delegationCommand(text)
      || !!materialCommand(text) || hasMaterialShareReply(text, c) || !!siteWatchIntent(text) || !!(c.entry_snapshot as Row)?.siteWatchQuestion;
  },
  async apply(tx: PostgresTransaction, actor: ActorContext, c: Row, message: Row) {
    return await applyDelegationCommand(tx, actor, c, message) || !!await applyMaterialCommand(tx, actor, c, message)
      || await applyMaterialShareReply(tx, actor, c, message) || await applySiteWatch(tx, actor, c, message);
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
