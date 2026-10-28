import { z } from 'zod';
import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { appendMessage } from '@/lib/assistant/core/conversation';
import { fail, fingerprint, safeText, type ActorContext, type MessageContent } from '@/lib/assistant/contracts';
import { materialShareInputSchema as schema, materialShareReplyIntent, materialShareAcknowledgement, materialShareCurrentCancellation } from './material-sharing-contract';
export { materialSharingRequested, materialShareReplyIntent } from './material-sharing-contract';
import { grantMaterial, revokeMaterial, sharedMaterial } from './site-materials';

const proposalType = 'construction.material.proposed.v1';
type Proposal = z.infer<typeof schema> & { id: string; projectId: string; roomId: string; sourceHash: string;
  mediaId: string | null; mediaHash: string | null; previousGrantId: string | null; runId: string; triggerId: string; expiresAt: string; text: string };

/** The model selects only private preview data. Audience consent is never a model parameter. */
async function scopes(tx: PostgresTransaction, actor: ActorContext, c: Row) {
  if (actor.principal.kind !== 'user' || c.purpose !== 'customer_consultation' || c.status !== 'open'
    || (c.entry_snapshot as Row).retentionRedacted) fail('assistant_capability_forbidden', 403);
  if (!await one(tx, sql`select c.id from app.assistant_conversations c join app.assistant_participants ap
    on ap.enterprise_id=c.enterprise_id and ap.conversation_id=c.id and ap.user_id=${actor.principal.userId} and ap.status='active'
    where c.enterprise_id=${actor.enterpriseId} and c.id=${String(c.id)} and c.purpose='customer_consultation' and c.status='open'
      and not coalesce((c.entry_snapshot->>'retentionRedacted')::boolean,false) for share of c,ap`)) fail('assistant_resource_not_found', 404);
  return rows(tx, sql`select p.id::text project_id,p.name project_name,r.id::text room_id,r.name room_name
    from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    join app.construction_rooms r on r.enterprise_id=p.enterprise_id and r.project_id=p.id
    join app.assistant_participants ap on ap.enterprise_id=p.enterprise_id and ap.conversation_id=${String(c.id)}
      and ap.user_id=l.customer_user_id and ap.status='active'
    where p.enterprise_id=${actor.enterpriseId} and p.status='active' and p.customer_access and l.archived_at is null
      and l.customer_user_id=${actor.principal.userId}
      and (coalesce(${JSON.stringify(c.entry_snapshot)}::jsonb->>'kind','')<>'lead' or l.id::text=${JSON.stringify(c.entry_snapshot)}::jsonb->>'id')
    order by p.id,r.id for share of p,l,r,ap`);
}
async function lastGrant(tx: PostgresTransaction, eid: string, pid: string, rid: string, kind: string) {
  return (await one(tx, sql`select id::text from app.domain_event_outbox where enterprise_id=${eid} and type='construction.material.shared.v1'
    and payload->>'projectId'=${pid} and payload->>'roomId'=${rid} and payload->>'kind'=${kind} order by id desc limit 1`))?.id as string | undefined || null;
}
async function sourceMessage(tx: PostgresTransaction, actor: ActorContext, cid: string, sourceId: string) {
  if (actor.principal.kind !== 'user') fail('assistant_capability_forbidden', 403);
  const source = await one(tx, sql`select id,seq,content from app.assistant_messages where enterprise_id=${actor.enterpriseId}
    and conversation_id=${cid} and user_id=${actor.principal.userId} and author_kind='user' and id=${sourceId} for share`);
  if (!source) fail('assistant_resource_not_found', 404);
  return source;
}
export async function prepareMaterialShare(tx: PostgresTransaction, actor: ActorContext, c: Row, trigger: Row, runId: string, raw: unknown) {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) fail('invalid_message', 422);
  const input = parsed.data, available = await scopes(tx, actor, c), cid = String(c.id), eid = actor.enterpriseId;
  // A new attempted selection invalidates an older unconfirmed selection even
  // when the new scope needs clarification. It cannot confirm stale contents.
  await tx.execute(sql`update app.assistant_conversations set entry_snapshot=entry_snapshot-'materialShareProposal'
    where enterprise_id=${eid} and id=${cid} and entry_snapshot->'materialShareProposal'->>'status'='pending'
      and not exists(select 1 from app.domain_event_outbox where enterprise_id=${eid} and type=${proposalType}
        and id::text=entry_snapshot->'materialShareProposal'->>'id' and aggregate_id=${String(trigger.id)})`);
  const candidates = available.filter(r => (!input.project || r.project_name === input.project) && input.room && r.room_name === input.room);
  if (candidates.length !== 1) return { status: 'clarification', text: available.length
    ? `还没有共享。请明确这次资料对应的项目和房间：${available.map(r => `${r.project_name} · ${r.room_name}`).join('、')}。`
    : '还没有共享。当前没有对你开放的项目房间，请先与项目团队核对。' };
  const room = candidates[0], source = await sourceMessage(tx, actor, cid, input.sourceMessageId || String(trigger.id));
  if (Number(source.seq) > Number(trigger.seq) || !input.excerpt.trim() || !safeText(source.content as MessageContent).includes(input.excerpt))
    return { status: 'clarification', text: '还没有共享。请说明要给团队看的具体需求原文或这张图的说明；其他私聊继续保密。' };
  const sourceText = safeText(source.content as MessageContent), triggerText = safeText(trigger.content as MessageContent);
  if (!sourceText.includes(input.room) && !triggerText.includes(input.room))
    return { status: 'clarification', text: '还没有共享。请明确这份资料对应哪个房间，不会按同名或最近使用的房间猜测。' };
  if (new Set(available.map(r => r.project_id)).size > 1 && !triggerText.includes(String(room.project_name)))
    return { status: 'clarification', text: '还没有共享。你有多个施工项目，请明确本次要共享给哪个项目。' };
  const pid = String(room.project_id), rid = String(room.room_id);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`site-material:${eid}:${pid}`},0))`);
  const media = input.kind === 'drawing' ? await one(tx, sql`select a.id::text,a.source_hash from app.assistant_messages m join app.assistant_media a
    on a.enterprise_id=m.enterprise_id and a.conversation_id=m.conversation_id and m.client_message_id='media:' || a.request_key
    where m.enterprise_id=${eid} and m.conversation_id=${cid} and m.user_id=${actor.principal.kind === 'user' ? actor.principal.userId : ''}
    and m.author_kind='user' and a.deleted_at is null and a.source_ref is null and a.customer_user_id=m.user_id
    and m.id=(select id from app.assistant_messages where enterprise_id=${eid}
      and conversation_id=${cid} and author_kind='user' and user_id=m.user_id and seq<${String(trigger.seq)} order by seq desc limit 1) for share of a,m`) : null;
  if (input.kind === 'drawing' && !media) return { status: 'clarification', text: '还没有共享图片。请先在本咨询上传本次要共享的点位图，再说明对应项目和房间；不会搜索其他私密照片。' };
  const text = `请核对这次共享范围：\n项目：${room.project_name}；房间：${room.room_name}。\n${input.kind === 'drawing' ? '本次上传的点位图原件及说明' : '需求原文节选'}：${input.excerpt}\n收件范围：该项目全体有效成员，包括设计师、经理、师傅、观察员和有权管理者。目前不能只开放给某位设计师；其他私聊不共享。\n当前尚未共享。若同意这个范围，请明确说明共享给该项目团队；若只想给个人看，可取消本次共享。${input.kind === 'drawing' ? '图纸仍需核对，不代表施工批准。' : ''}`;
  const payload = { ...input, project: String(room.project_name), projectId: pid, roomId: rid, sourceMessageId: String(source.id),
    sourceHash: fingerprint(source.content), mediaId: media ? String(media.id) : null, mediaHash: media ? String(media.source_hash) : null,
    previousGrantId: await lastGrant(tx, eid, pid, rid, input.kind), runId, triggerId: String(trigger.id), text };
  const existing = await one(tx, sql`select id,payload from app.domain_event_outbox where enterprise_id=${eid}
    and type=${proposalType} and aggregate_id=${String(trigger.id)} and aggregate_type='assistant_message'`);
  if (existing && fingerprint({ ...(existing.payload as Row), expiresAt: undefined }) !== fingerprint(payload)) fail('context_changed');
  const event = existing || (await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${eid},${proposalType},'assistant_message',${String(trigger.id)},1,${JSON.stringify(actor.principal)}::jsonb,${String(trigger.id)},
      ${JSON.stringify({ ...payload, expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() })}::jsonb) returning id,payload`))!;
  await tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot,'{materialShareProposal}',
    ${JSON.stringify({ id: String(event.id), digest: fingerprint(event.payload), status: 'pending' })}::jsonb) where enterprise_id=${eid} and id=${cid}`);
  return { status: 'pending', proposalId: String(event.id), text };
}

export function hasMaterialShareReply(text: string, c: Row) {
  const intent = materialShareReplyIntent(text);
  return Boolean((c.entry_snapshot as Row)?.materialShareProposal && (intent === 'confirm' || intent === 'cancel' && materialShareCurrentCancellation(text)));
}
/** Only an explicit customer answer to a durably displayed, exact preview grants team access. */
export async function applyMaterialShareReply(tx: PostgresTransaction, actor: ActorContext, c: Row, message: Row) {
  const marker = (c.entry_snapshot as Row)?.materialShareProposal as Row | undefined;
  const intent = materialShareReplyIntent(safeText(message.content as MessageContent));
  const raw = safeText(message.content as MessageContent);
  if (!marker || !intent || !hasMaterialShareReply(raw, c)) return false;
  await scopes(tx, actor, c);
  const event = await one(tx, sql`select id,payload from app.domain_event_outbox where enterprise_id=${actor.enterpriseId}
    and id=${String(marker.id)} and type=${proposalType} and actor_ref=${JSON.stringify(actor.principal)}::jsonb for share`);
  if (!event || fingerprint(event.payload) !== marker.digest) fail('context_changed');
  const p = { ...(event.payload as Proposal), id: String(event.id) };
  if (intent === 'cancel') {
    if (/这张图/.test(raw) && p.kind !== 'drawing' || /这份需求/.test(raw) && p.kind !== 'need') return false;
    if (marker.status === 'applied') await revokeMaterial(tx, actor, c, message, String(marker.grantId));
    else {
      await appendMessage(tx, actor, String(c.id), { author: 'system', eventId: p.id, purpose: 'construction.material.cancelled',
        content: { version: 1, blocks: [{ type: 'text', text: '已取消本次共享，资料没有向项目团队开放。' }] } });
    }
    await tx.execute(sql`update app.assistant_conversations set entry_snapshot=entry_snapshot-'materialShareProposal'
      where enterprise_id=${actor.enterpriseId} and id=${String(c.id)}`);
    return true;
  }
  if (marker.status === 'applied') return true; // A second acknowledgement cannot create another grant.
  const eid = actor.enterpriseId, cid = String(c.id);
  const displayed = await one(tx, sql`select m.content from app.assistant_runs r join app.assistant_messages m
    on m.enterprise_id=r.enterprise_id and m.conversation_id=r.conversation_id and m.id=r.output_message_id
    where r.enterprise_id=${eid} and r.conversation_id=${cid} and r.id=${p.runId} and r.status='succeeded'`);
  if (!displayed || !safeText(displayed.content as MessageContent).includes(p.text) || Date.now() >= Date.parse(p.expiresAt)) fail('context_changed');
  const request = await sourceMessage(tx, actor, cid, p.triggerId);
  const later = await rows(tx, sql`select content from app.assistant_messages where enterprise_id=${eid} and conversation_id=${cid}
    and user_id=${actor.principal.kind === 'user' ? actor.principal.userId : ''} and author_kind='user'
    and seq>${String(request.seq)} and seq<${String(message.seq)} order by seq`);
  // A failed/interrupted clarification must not leave an older selection
  // confirmable after a project correction, extra condition or a new photo.
  if (later.some(m => !materialShareAcknowledgement(safeText(m.content as MessageContent)))) fail('context_changed');
  const room = (await scopes(tx, actor, c)).find(r => r.project_id === p.projectId && r.room_id === p.roomId
    && r.room_name === p.room && r.project_name === p.project);
  if (!room) fail('context_changed');
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`site-material:${eid}:${p.projectId}`},0))`);
  const source = await sourceMessage(tx, actor, cid, p.sourceMessageId);
  if (fingerprint(source.content) !== p.sourceHash || await lastGrant(tx, eid, p.projectId, p.roomId, p.kind) !== p.previousGrantId) fail('context_changed');
  if (p.mediaId && !await one(tx, sql`select id from app.assistant_media where enterprise_id=${eid} and conversation_id=${cid}
    and id=${p.mediaId} and source_hash=${p.mediaHash} and deleted_at is null and source_ref is null for share`)) fail('context_changed');
  const grant = await grantMaterial(tx, actor, c, source, room as Parameters<typeof grantMaterial>[4], p.kind, p.excerpt, p.mediaId, message);
  await tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot,'{materialShareProposal}',
    ${JSON.stringify({ ...marker, status: 'applied', grantId: grant.id })}::jsonb) where enterprise_id=${eid} and id=${cid}`);
  return true;
}

export async function revokeMaterialShare(tx: PostgresTransaction, actor: ActorContext, c: Row, trigger: Row, raw: unknown) {
  const input = z.object({ grantId: z.string().regex(/^(?:[1-9]\d{0,18})?$/), quote: z.string().min(1).max(1000) }).strict().safeParse(raw);
  if (!input.success) fail('invalid_message', 422);
  const available = await scopes(tx, actor, c);
  const text = safeText(trigger.content as MessageContent);
  if (!text.includes(input.data.quote) || materialShareReplyIntent(text) !== 'cancel' || materialShareReplyIntent(input.data.quote) !== 'cancel')
    return { status: 'clarification', text: '没有撤回资料。请明确说明要停止共享哪份资料。' };
  const eid = actor.enterpriseId, cid = String(c.id);
  const candidates = await rows(tx, sql`select id::text,payload from app.domain_event_outbox where enterprise_id=${eid}
    and type='construction.material.shared.v1' and payload->>'conversationId'=${cid}
    and payload->>'customerId'=${actor.principal.kind === 'user' ? actor.principal.userId : ''} order by id desc`);
  const active = [];
  for (const candidate of candidates) {
    const p = candidate.payload as Row;
    if (await sharedMaterial(tx, eid, String(p.projectId), String(candidate.id))) active.push(candidate);
  }
  const ids = [...new Set([...text.matchAll(/(?:共享)?资料\s*([1-9]\d{0,18})/g)].map(m => m[1]))];
  const need = /需求/.test(text), drawing = /图纸|点位图|图片|这张图/.test(text);
  const projects = [...new Set(available.map(r => String(r.project_name)))].filter(n => text.includes(n));
  const rooms = [...new Set(available.map(r => String(r.room_name)))].filter(n => text.includes(n));
  const namedProjectIds = available.filter(r => projects.includes(String(r.project_name))).map(r => String(r.project_id));
  let remainder = text.replace(/(?:共享)?资料\s*([1-9]\d{0,18})/g, '');
  for (const name of [...projects, ...rooms].sort((a, b) => b.length - a.length)) remainder = remainder.split(name).join('');
  remainder = remainder.replace(/停止|取消|撤回|共享|分享|资料|内容|需求|图纸|点位图|图片|这张图|这份|那份|这次|本次|刚才|之前|刚刚|帮我|麻烦|请|把|将|的|了|吧|先|再|[。！!，,\s]/g, '');
  const matches = active.filter(g => {
    const p = g.payload as Row;
    return (!need && !drawing || need !== drawing && p.kind === (need ? 'need' : 'drawing'))
      && (!projects.length || namedProjectIds.includes(String(p.projectId))) && (!rooms.length || rooms.includes(String(p.roomName)));
  });
  const grant = !remainder && ids.length === 1 ? candidates.find(g => g.id === ids[0])
    : !remainder && !ids.length && matches.length === 1 ? matches[0] : null;
  if (grant && input.data.grantId && input.data.grantId !== grant.id)
    return { status: 'clarification', text: '没有撤回资料。所选资料与本次请求不一致，请核对具体资料号或项目、房间和资料类型。' };
  if (!grant) return { status: 'clarification', text: active.length
    ? `没有撤回资料。请说明要停止共享哪份资料：${active.map(g => `资料${g.id}（${(g.payload as Row).roomName}）`).join('、')}。`
    : '当前咨询没有可撤回的共享资料。' };
  const result = await revokeMaterial(tx, actor, c, trigger, String(grant.id));
  return { status: 'revoked', text: result.text };
}
