import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fingerprint, safeText, type ActorContext } from '@/lib/assistant/contracts';
import { appendMessage } from '@/lib/assistant/core/conversation';
import type { IssueView } from './site-issues';

/** Conservative, bounded routing before any record/job is created. Ambiguity has no business side effect. */
export function siteMessageIntent(raw: string, photoCount: number): 'report' | 'query' | 'request' | 'clarify' {
  if (/(?:帮我|请|麻烦|给我)?(?:找(?:下|一下|出)?|查(?:下|一下|询|找)?|看看|看一下|调取|检索).*(?:图纸|需求|资料|原话|照片|记录|事项)|(?:图纸|需求|资料|记录|事项).*(?:在哪|哪里|有没有|进展|状态|谁|下文)|[？?]|(?:怎么|如何|是否|能否|能不能|在等谁|有没有下文)|(?:吗|么|呢)[。\s]*$/.test(raw)) return 'query';
  if (/(?:请|帮我|麻烦).*(?:跟进|处理|转交|取消)|(?:接手|转交|取消|回复|跟进)事项|(?:这件事|这条事项).*(?:我来|转交|取消|回复)/.test(raw)) return 'request';
  if (/^(?:收到|好的?|可以|谢谢|嗯|知道了)[。！!\s]*$/.test(raw)) return 'clarify';
  if (!raw && photoCount || /(?:今天|现场|已经|已完成|铺好|做好|装好|还没|尚未|未完成|未施工|等待.{0,20}核对|待核对|待确认|待沟通|完成了|施工进展)/.test(raw)) return 'report';
  return 'clarify';
}

export type SiteQuery = { roomId: string | null; roomName: string; resolution: 'resolved' | 'clarification' };
export type SiteMaterialSnapshot = { query: SiteQuery; projectId: string; version: string; queriedAt: string; sources: Row[]; text: string };

export async function resolveSiteQuery(tx: PostgresTransaction, eid: string, pid: string, raw: string): Promise<SiteQuery> {
  const rooms = await rows(tx, sql`select id,name from app.construction_rooms where enterprise_id=${eid} and project_id=${pid} order by id for share`);
  const found = rooms.filter(r => raw.includes(String(r.name)));
  if (found.length === 1) return { roomId: String(found[0].id), roomName: String(found[0].name), resolution: 'resolved' };
  if (!found.length && /(?:全屋|整个项目|本项目|本工地)/.test(raw)) return { roomId: null, roomName: '', resolution: 'resolved' };
  return { roomId: null, roomName: '', resolution: 'clarification' };
}

/** Caller must already hold SiteChatService's tenant, live-project and actor authorization. Never searches customer consultations. */
export async function querySiteMaterials(tx: PostgresTransaction, eid: string, pid: string, query: SiteQuery): Promise<SiteMaterialSnapshot> {
  const sources: Row[] = [], lines: string[] = [];
  const room = query.roomId ? await one(tx, sql`select id,name from app.construction_rooms where enterprise_id=${eid} and project_id=${pid} and id=${query.roomId} for share`) : null;
  const validRoom = !query.roomId || room?.name === query.roomName;
  if (query.resolution === 'clarification' || !validRoom) {
    lines.push('请说明本项目要查的具体房间，或说明查询全屋资料；暂不合并归属不明的材料。');
  } else {
    const records = await rows(tx, sql`select r.id,r.version,r.status,r.data,r.room_id,r.room_name_snapshot,r.source_message_id,m.content
      from app.construction_site_records r join app.assistant_messages m on m.enterprise_id=r.enterprise_id and m.id=r.source_message_id and m.conversation_id=r.conversation_id
      where r.enterprise_id=${eid} and r.project_id=${pid} and r.status in ('draft','published')
        ${query.roomId ? sql`and r.room_id=${query.roomId} and r.room_name_snapshot=${query.roomName}` : sql``}
      order by r.id desc limit 10 for share of r,m`);
    for (const r of records) {
      const media = await rows(tx, sql`select m.id,m.source_hash from app.construction_site_attachments a join app.construction_site_media m
        on m.enterprise_id=a.enterprise_id and m.project_id=a.project_id and m.id=a.media_id
        where a.enterprise_id=${eid} and a.project_id=${pid} and a.record_id=${String(r.id)} and m.deleted_at is null order by a.position`);
      const original = safeText(r.content as Parameters<typeof safeText>[0]);
      sources.push({ ref: { type: 'site_record', id: String(r.id), version: Number(r.version) }, sourceMessageId: String(r.source_message_id),
        roomId: r.room_id ? String(r.room_id) : null, roomName: String(r.room_name_snapshot), mediaIds: media.map(m => String(m.id)),
        hash: fingerprint({ content: r.content, data: r.data, status: r.status, media }), audience: 'project_members', basis: 'explicit_project_record', text: original });
      lines.push(`记录${r.id} · 版本${r.version} · ${r.room_name_snapshot || '部位待核对'}${r.status === 'draft' ? '（待核对草稿）' : '（已核对发布）'}：${original.slice(0,1200)}${media.length ? '\n原现场照片：' + media.length + '张，可在本条原记录查看。' : ''}`);
    }
    if (!sources.length) lines.push('本项目该范围内还没有可关联的有效现场记录。');
    lines.push('缺项：当前有效点位图、已授权共享的客户需求。项目成员身份不开放业主私人咨询；请有权设计师从原接待入口核对。正式户型不能代替点位图。');
    lines.push('以上按项目及房间标识关联原材料，不代表方案、费用、工期或验收批准。');
  }
  return { query, projectId: pid, version: fingerprint({ query, validRoom, sources }), sources, queriedAt: new Date().toISOString(), text: lines.join('\n') };
}

export async function appendSiteResponse(tx: PostgresTransaction, actor: ActorContext, cid: string, pid: string, sourceId: string,
  mediaIds: string[], intent: string, text: string, dependency: Row = {}) {
  const event = (await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${actor.enterpriseId},'construction.chat.response.v1','construction_chat_message',${sourceId},1,${JSON.stringify(actor.principal)}::jsonb,${sourceId},
      ${JSON.stringify({ projectId: pid, conversationId: cid, sourceMessageId: sourceId, mediaIds, intent, ...dependency })}::jsonb) returning id`))!;
  await appendMessage(tx, actor, cid, { author: 'system', eventId: String(event.id), purpose: 'site.response', content: { version: 1, blocks: [{ type: 'text', text }] } });
  return String(event.id);
}

/** Revalidate derived output on every reentry; immutable source messages remain separate. */
export async function siteResponse(tx: PostgresTransaction, eid: string, pid: string, cid: string, sourceId: string, issues: IssueView[] = []) {
  const response = await one(tx, sql`select m.content,e.payload from app.domain_event_outbox e join app.assistant_messages m
    on m.enterprise_id=e.enterprise_id and m.source_event_id=e.id and m.conversation_id=${cid} and m.purpose='site.response'
    where e.enterprise_id=${eid} and e.type='construction.chat.response.v1' and e.aggregate_id=${sourceId} and e.payload->>'projectId'=${pid}`);
  if (!response) return null;
  const payload = response.payload as Row;
  let text = safeText(response.content as Parameters<typeof safeText>[0]);
  if (payload.query && (await querySiteMaterials(tx, eid, pid, payload.query as SiteQuery)).version !== payload.version)
    text = '关联资料已变化，原查询结果不再沿用。请重新查询当前资料。';
  const issue = payload.issueId ? issues.find(i => i.issueId === payload.issueId) : null;
  if (payload.issueId) text = issue?.text || '原事项已不可用，请重新核对。';
  if (payload.issueQuery) text = issues.filter(i => !payload.issueQueryId || i.issueId === payload.issueQueryId).map(i => i.text).join('\n\n') || '本项目当前没有对应的持续事项。';
  const media = (payload.mediaIds as string[] || []).length ? await rows(tx, sql`select id,width,height,byte_size from app.construction_site_media where enterprise_id=${eid} and project_id=${pid}
    and id=any(ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(payload.mediaIds)}::jsonb))::bigint[]) and deleted_at is null order by id`) : [];
  return { text, intent: payload.intent, media, issue };
}

export function sharedMediaUsed(eid: string, pid: string, mediaId: string) {
  return sql`exists(select 1 from app.domain_event_outbox e join app.assistant_messages sm on sm.enterprise_id=e.enterprise_id
    and sm.id::text=e.payload->>'sourceMessageId' and sm.conversation_id::text=e.payload->>'conversationId'
    where e.enterprise_id=${eid} and e.type='construction.chat.response.v1' and e.payload->>'projectId'=${pid} and e.payload->'mediaIds' ? ${mediaId})`;
}
