import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { adaptSurveyGraphToRooms, parseFormalSurveyLayout } from '@/lib/survey-graph';
import { customerProjects } from '@/lib/construction/customer';
import { publishedSiteRecord } from '@/lib/construction/site-publications';
import { siteRecordText, type SiteDraft } from '@/lib/construction/site-contract';
import { sharedMaterials } from '@/lib/construction/site-materials';
import { fail, fingerprint, id, safeText, type ActorContext } from '../contracts';
import type { ModelTool } from '../contracts/model';
import { availableNeedMemory } from './memory-sources';

export const materialTool: ModelTool = {
  name: 'query_materials',
  description: '按当前客户有权读取的明确房屋和房间组合本咨询原话、本人在本咨询明确共享的有效需求/点位图原件说明、正式v4户型和已向本人发布的现场记录。共享参考图不等于正式核对图纸，原件引用不代表已识读图内细节。找资料、回顾需求或追问均可用。leadId不知道用空串；room仅用明确房间名，不猜代词。多房屋/重名房间先澄清；缺项如实说明，不从墙图虚构点位。只读，不建立进度草稿或批准。',
  parameters: { type: 'object', properties: { leadId: { type: 'string' }, room: { type: 'string' } }, required: ['leadId', 'room'], additionalProperties: false },
};
export type MaterialQuery = { leadId: string; room: string };
export type MaterialSource = {
  ref: { type: 'customer_need' | 'shared_need' | 'shared_drawing' | 'formal_floorplan' | 'site_record'; id: string; version: string };
  hash: string; leadId: string; projectId: string | null; roomId: string | null; roomName: string;
  sourceMessageId: string | null; mediaIds: string[]; audience: 'customer_self';
  basis: 'owned_conversation' | 'customer_shared_grant' | 'primary_plan' | 'published_project_record'; status: 'current'; text: string;
  original?: { grantId: string; conversationId: string; sourceHash: string; mediaHash: string | null; authority: 'customer_reference'; imagePixels: false };
};
export type MaterialSnapshot = {
  query: MaterialQuery & { domain: 'materials'; conversationId: string }; customerId: string; leadIds: string[];
  version: string; displayText: string; queriedAt: string;
  data: { resolution: 'resolved' | 'clarification' | 'missing'; sources: MaterialSource[]; missing: string[] };
};
export type MaterialDependency = Pick<MaterialSnapshot, 'query' | 'customerId' | 'version'>;

export function parseMaterialQuery(raw: unknown): MaterialQuery {
  const value = raw as MaterialQuery;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['leadId', 'room'].includes(k))
    || typeof value.leadId !== 'string' || typeof value.room !== 'string' || value.room.length > 40
    || /[\n\r]|^(?:(?:这|那)(?:一)?(?:个|间)(?:房间|房)?|它|刚才(?:说的)?(?:房间)?|前面(?:说的)?(?:房间)?)$/.test(value.room)) fail('invalid_message', 422);
  if (value.leadId) id(value.leadId);
  return { leadId: value.leadId, room: value.room.trim() };
}

/** The existing conversation, lead ownership and published-record services remain authoritative. */
export async function queryMaterials(tx: PostgresTransaction, actor: ActorContext, conversationId: string, query: MaterialQuery): Promise<MaterialSnapshot> {
  if (actor.principal.kind !== 'user') fail('assistant_capability_forbidden', 403);
  const eid = actor.enterpriseId, uid = actor.principal.userId;
  const conversation = await one(tx, sql`select c.* from app.assistant_conversations c join app.assistant_participants p
    on p.enterprise_id=c.enterprise_id and p.conversation_id=c.id and p.user_id=${uid} and p.status='active'
    where c.enterprise_id=${eid} and c.id=${id(conversationId)} and c.purpose='customer_consultation'
      and not coalesce((c.entry_snapshot->>'retentionRedacted')::boolean,false) for share of c,p`);
  if (!conversation) fail('assistant_resource_not_found', 404);
  const entry = conversation.entry_snapshot as Row;
  const boundLead = entry.kind === 'lead' ? String(entry.id) : '';
  if (boundLead && query.leadId && boundLead !== query.leadId) fail('assistant_resource_not_found', 404);
  const selected = boundLead || query.leadId;
  const leads = await rows(tx, sql`select id,community_name,primary_floor_plan_id from app.leads where enterprise_id=${eid}
    and customer_user_id=${uid} and archived_at is null ${selected ? sql`and id=${id(selected)}` : sql``} order by id limit 11 for share`);
  if (selected && !leads.length) fail('assistant_resource_not_found', 404);
  const sources: MaterialSource[] = [], missing: string[] = [], lines: string[] = [];
  let resolution: MaterialSnapshot['data']['resolution'] = 'resolved';
  const finish = (): MaterialSnapshot => {
    const data = { resolution, sources, missing };
    return { query: { ...query, domain: 'materials', conversationId }, customerId: uid, leadIds: leads.map(l => String(l.id)),
      version: fingerprint({ data, leadIds: leads.map(l => String(l.id)) }), data,
      displayText: lines.join('\n'), queriedAt: new Date().toISOString() };
  };
  if (leads.length !== 1) {
    resolution = leads.length ? 'clarification' : 'missing';
    lines.push(leads.length ? '你有多个房屋档案，请先说明要核对哪一套房屋；当前没有把不同房屋的资料合在一起。' : '目前没有可关联的本人房屋档案，可以继续聊装修想法。');
    missing.push('明确的本人房屋档案'); return finish();
  }
  const lead = leads[0], leadId = String(lead.id), projects = await customerProjects(tx, eid, uid, leadId);
  const activeProjects = projects.filter(p => p.status === 'active');
  if (activeProjects.length > 1) {
    resolution = 'clarification'; missing.push('明确的施工项目');
    lines.push('这套房屋有多个施工项目，请先核对项目；当前没有按最近时间选择一个项目。'); return finish();
  }
  const project = activeProjects[0], projectId = project ? String(project.id) : null;
  const rooms = project ? await rows(tx, sql`select id,name from app.construction_rooms where enterprise_id=${eid} and project_id=${projectId} order by id for share`) : [];
  const matchingRooms = query.room ? rooms.filter(r => String(r.name) === query.room) : rooms;
  const plan = lead.primary_floor_plan_id ? await one(tx, sql`select id,name,layout_data from app.floor_plans
    where enterprise_id=${eid} and id=${String(lead.primary_floor_plan_id)} and status='completed' for share`) : null;
  const layout = plan && parseFormalSurveyLayout(plan.layout_data);
  const planRooms = layout ? layout.surveyGraph.floors.flatMap(floor => adaptSurveyGraphToRooms({ ...layout, surveyGraph: { ...layout.surveyGraph, activeFloorId: floor.id } })
    .map(r => ({ id: r.id, name: r.name, floorId: floor.id }))) : [];
  const matchingPlanRooms = query.room ? planRooms.filter(r => r.name === query.room) : planRooms;
  // Equal names across business domains are candidate matches, never an invented ID mapping.
  if (query.room && (matchingRooms.length > 1 || matchingPlanRooms.length > 1)) {
    resolution = 'clarification'; missing.push('唯一房间标识');
    lines.push(`这套房屋有重名的「${query.room}」，请先核对具体房间；暂不合并同名资料。`); return finish();
  }
  lines.push(`「${String(lead.community_name || '本人房屋')}」${query.room ? ' / ' + query.room : ''}的当前资料：`);
  // A generic chat is bound only when there is exactly one owned home. No other chat is searched.
  const homeCount = boundLead ? 1 : Number((await one(tx, sql`select count(*) n from app.leads where enterprise_id=${eid} and customer_user_id=${uid} and archived_at is null`))?.n);
  const memory = await availableNeedMemory(tx, eid, conversationId, entry);
  for (const fact of memory.facts.filter(f => homeCount === 1 && f.status === 'current' && (!query.room || !f.room || f.room === query.room)).slice(-20)) {
    const origin = await one(tx, sql`select id,content from app.assistant_messages where enterprise_id=${eid} and conversation_id=${conversationId}
      and id=${fact.sourceMessageId} and author_kind='user' for share`);
    if (!origin || !safeText(origin.content as Parameters<typeof safeText>[0]).includes(fact.quote)) continue;
    sources.push({ ref: { type: 'customer_need', id: fact.id, version: fingerprint(fact) }, hash: fingerprint(origin.content), leadId,
      projectId: null, roomId: null, roomName: fact.room, sourceMessageId: fact.sourceMessageId, mediaIds: [], audience: 'customer_self',
      basis: 'owned_conversation', status: 'current', text: fact.quote });
    lines.push(`客户原话${fact.room ? '（' + fact.room + '）' : ''}：“${fact.quote}”。`);
  }
  if (!sources.length) missing.push('这次咨询中对应的有效原话需求');
  if (project) {
    // The project grant alone never exposes another private consultation, even
    // for the same homeowner. Reuse the original source/revocation validator.
    for (const room of matchingRooms.slice(0, 20)) {
      const shared = await sharedMaterials(tx, eid, projectId!, String(room.id));
      for (const source of shared.sources) {
        if (source.customerId !== uid || source.conversationId !== conversationId) continue;
        sources.push({ ref: { type: source.kind === 'need' ? 'shared_need' : 'shared_drawing', id: source.id, version: fingerprint(source) },
          hash: fingerprint({ sourceHash: source.sourceHash, mediaHash: source.mediaHash }), leadId, projectId,
          roomId: source.roomId, roomName: source.roomName, sourceMessageId: source.sourceMessageId,
          mediaIds: source.mediaId ? [source.mediaId] : [], audience: 'customer_self', basis: 'customer_shared_grant', status: 'current', text: source.text,
          original: { grantId: source.id, conversationId: source.conversationId, sourceHash: source.sourceHash, mediaHash: source.mediaHash,
            authority: 'customer_reference', imagePixels: false } });
        lines.push(`客户共享${source.kind === 'need' ? '需求原话' : '点位图原件说明'}（${source.roomName}）：${source.text}`);
      }
    }
    if (matchingRooms.length > 20) missing.push('其余房间共享资料请指定房间查询');
  }
  if (sources.some(s => s.ref.type === 'shared_need')) {
    const index = missing.indexOf('这次咨询中对应的有效原话需求'); if (index >= 0) missing.splice(index, 1);
  }
  if (plan && layout && (!query.room || matchingPlanRooms.length === 1)) {
    sources.push({ ref: { type: 'formal_floorplan', id: String(plan.id), version: fingerprint(layout) }, hash: fingerprint(layout), leadId,
      projectId: null, roomId: query.room ? matchingPlanRooms[0].id : null, roomName: query.room, sourceMessageId: null, mediaIds: [],
      audience: 'customer_self', basis: 'primary_plan', status: 'current', text: String(plan.name) });
    lines.push(`正式户型：「${String(plan.name)}」${query.room ? '包含「' + query.room + '」' : '，房间：' + planRooms.map(r => r.name).join('、')}。`);
  } else missing.push(query.room ? '含该房间的已完成正式主户型' : '已完成正式主户型');
  if (project && (!query.room || matchingRooms.length === 1)) {
    const candidates = await rows(tx, sql`select id from app.construction_site_records where enterprise_id=${eid} and project_id=${projectId}
      and status='published' and audience='customer' ${query.room ? sql`and room_id=${String(matchingRooms[0].id)}` : sql``} order by published_at desc,id desc limit 10`);
    for (const candidate of candidates) {
      const record = await publishedSiteRecord(tx, eid, uid, String(candidate.id));
      if (!record) continue;
      const media = await rows(tx, sql`select a.media_id from app.construction_site_attachments a join app.construction_site_media m
        on m.enterprise_id=a.enterprise_id and m.id=a.media_id and m.deleted_at is null where a.enterprise_id=${eid} and a.record_id=${String(record.id)} order by a.position`);
      const text = siteRecordText(record.data as SiteDraft, String(record.room_name_snapshot));
      sources.push({ ref: { type: 'site_record', id: String(record.id), version: String(record.published_version) }, hash: fingerprint({ data: record.data, media }),
        leadId, projectId, roomId: record.room_id ? String(record.room_id) : null, roomName: String(record.room_name_snapshot),
        sourceMessageId: record.source_message_id ? String(record.source_message_id) : null, mediaIds: media.map(m => String(m.media_id)),
        audience: 'customer_self', basis: 'published_project_record', status: 'current', text });
      lines.push(`团队已核对发布的现场记录（${String(record.room_name_snapshot || project.name)}）：${text}`);
    }
  }
  if (!sources.some(s => s.ref.type === 'site_record')) missing.push('向本人明确发布的对应现场记录');
  const drawings = sources.filter(s => s.ref.type === 'shared_drawing');
  missing.push(drawings.length ? '点位图的正式核对、图内细节及对应现场尺寸' : '当前有效点位图及其对应房间');
  if (drawings.length) lines.push('客户共享点位图原件和说明已关联到上述项目房间；本次工具未识读图片像素，说明仅是客户提供的参考，不证明图内位置、尺寸、设计师核对或正式批准。');
  lines.push('来源范围：本咨询的有效原话和明确共享资料、这套房屋的当前正式户型及团队已向你发布的记录。正式户型与施工房间的映射、具体点位仍需设计师核对。');
  lines.push('待核对：' + missing.join('；') + '。这些资料尚不代表方案、费用、工期或验收已获批准。');
  return finish();
}

export async function materialSnapshotAvailable(tx: PostgresTransaction, enterpriseId: string, snapshot: MaterialDependency) {
  try {
    const current = await queryMaterials(tx, { enterpriseId, principal: { kind: 'user', userId: snapshot.customerId }, contextVersion: 0, capabilities: [] },
      snapshot.query.conversationId, { leadId: snapshot.query.leadId, room: snapshot.query.room });
    return current.version === snapshot.version;
  } catch { return false; }
}
