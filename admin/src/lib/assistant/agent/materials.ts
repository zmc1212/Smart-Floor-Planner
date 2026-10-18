import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { adaptSurveyGraphToRooms, parseFormalSurveyLayout } from '@/lib/survey-graph';
import { customerProjects } from '@/lib/construction/customer';
import { publishedSiteRecord } from '@/lib/construction/site-publications';
import { siteRecordText, type SiteDraft } from '@/lib/construction/site-contract';
import { sharedMaterials } from '@/lib/construction/site-materials';
import { customerMaterialReviews } from '@/lib/construction/site-results';
import { customerPlans } from '@/lib/construction/site-plans';
import { fail, fingerprint, id, safeText, type ActorContext } from '../contracts';
import type { ModelTool } from '../contracts/model';
import { availableNeedMemory } from './memory-sources';
import { needQualifications, type NeedFact, type NeedQualification, type NeedInterpretation } from './memory';

export const materialTool: ModelTool = {
  name: 'query_materials',
  description: '按当前客户有权读取的明确房屋和房间组合本咨询原话、有效共享需求/点位图说明、明确回传到本咨询的团队图纸核对关联、已送达的精确正式方案版本及客户决定、正式v4户型和已发布现场记录。客户参考、团队关联核对、正式版本决定分别溯源，均不证明现场落实。原件引用不代表识读像素。leadId不知道用空串；room仅用明确房间名。多房屋/重名房间先澄清，缺项不推成现实中未发生。只读，不建事项或批准。',
  parameters: { type: 'object', properties: { leadId: { type: 'string' }, room: { type: 'string' } }, required: ['leadId', 'room'], additionalProperties: false },
};
export type MaterialQuery = { leadId: string; room: string };
export type MaterialSource = {
  ref: { type: 'customer_need' | 'shared_need' | 'shared_drawing' | 'team_review' | 'formal_plan' | 'formal_floorplan' | 'site_record'; id: string; version: string };
  hash: string; leadId: string; projectId: string | null; roomId: string | null; roomName: string;
  sourceMessageId: string | null; mediaIds: string[]; audience: 'customer_self';
  basis: 'owned_conversation' | 'customer_shared_grant' | 'returned_drawing_review' | 'delivered_formal_plan' | 'primary_plan' | 'published_project_record'; status: 'current'; text: string;
  original?: { grantId: string; conversationId: string; sourceHash: string; mediaHash: string | null; authority: 'customer_reference'; imagePixels: false };
  review?: { issueId: string; issueRevision: number; needGrantId: string; drawingGrantId: string; materialVersion: string; authority: 'team_returned_association' };
  formal?: { issueId: string; issueRevision: number; number: number; revision: number; decision: string; previousVersionId: string | null;
    needGrantId: string; materialVersion: string; mediaHash: string; authority: 'enterprise_published_version'; imagePixels: false };
  need?: { field: NeedFact['field']; value: string; supersedes: string | null; authority: 'customer_statement'; formalApproval: false; qualifiedBy?: NeedQualification[]; interpretation?: NeedInterpretation };
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
      // The added need metadata is already bound by ref.version=fingerprint(fact).
      // Do not invalidate unchanged historical sources solely on a code upgrade.
      version: fingerprint({ data: { ...data, sources: sources.map(source => { const copy = { ...source }; delete copy.need; return copy; }) }, leadIds: leads.map(l => String(l.id)) }), data,
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
  const currentNeeds = memory.facts.filter(f => homeCount === 1 && f.status === 'current' && (!query.room || !f.room || f.room === query.room)).slice(-20);
  const origins = new Map<string, Row>(), originalTexts = new Map<string, string>();
  for (const sourceId of new Set(currentNeeds.map(f => f.sourceMessageId))) {
    const origin = await one(tx, sql`select id,content from app.assistant_messages where enterprise_id=${eid} and conversation_id=${conversationId}
      and id=${sourceId} and author_kind='user' for share`);
    if (origin) { origins.set(sourceId, origin); originalTexts.set(sourceId, safeText(origin.content as Parameters<typeof safeText>[0])); }
  }
  for (const fact of currentNeeds) {
    const origin = origins.get(fact.sourceMessageId);
    if (!origin || !safeText(origin.content as Parameters<typeof safeText>[0]).includes(fact.quote)) continue;
    const qualifiedBy = needQualifications(fact, currentNeeds, originalTexts);
    const interpretation = memory.interpretations?.find(i => i.factId === fact.id);
    sources.push({ ref: { type: 'customer_need', id: fact.id, version: fingerprint(fact) }, hash: fingerprint(origin.content), leadId,
      projectId: null, roomId: null, roomName: fact.room, sourceMessageId: fact.sourceMessageId, mediaIds: [], audience: 'customer_self',
      basis: 'owned_conversation', status: 'current', text: fact.quote,
      need: { field: fact.field, value: fact.value, supersedes: fact.supersedes, authority: 'customer_statement', formalApproval: false,
        ...(qualifiedBy.length ? { qualifiedBy } : {}), ...(interpretation ? { interpretation } : {}) } });
    lines.push(`客户原话${fact.room ? '（' + fact.room + '）' : ''}：“${fact.quote}”。`);
    if (interpretation) lines.push(interpretation.currentFactId
      ? '这条混合原话的人数只作历史背景，以当前有效用途更正为准；位置、桌型和设备仍分别保留。'
      : '这条混合原话的人数已有后续更正，但更正来源当前不可用；不能恢复旧人数，位置、桌型和设备仍按有效原话分别核对。');
  }
  if (memory.interpretations?.some(i => i.currentFactId === null && currentNeeds.some(f => f.id === i.factId))) missing.push('当前有效的办公人数更正来源');
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
  if (project && (!query.room || matchingRooms.length === 1)) {
    const inScope = (source: { projectId: string; roomId: string }) => source.projectId === projectId
      && matchingRooms.slice(0, 20).some(room => String(room.id) === source.roomId);
    for (const review of (await customerMaterialReviews(tx, eid, uid, conversationId)).filter(inScope)) {
      sources.push({ ref: { type: 'team_review', id: review.id, version: review.version }, hash: review.version, leadId, projectId,
        roomId: review.roomId, roomName: review.roomName, sourceMessageId: review.messageId, mediaIds: [], audience: 'customer_self',
        basis: 'returned_drawing_review', status: 'current', text: review.text,
        review: { issueId: review.issueId, issueRevision: review.issueRevision, needGrantId: review.needGrantId,
          drawingGrantId: review.drawingGrantId, materialVersion: review.materialVersion, authority: 'team_returned_association' } });
      lines.push(review.text);
    }
    for (const plan of (await customerPlans(tx, eid, uid, conversationId)).filter(inScope)) {
      sources.push({ ref: { type: 'formal_plan', id: plan.id, version: plan.hash }, hash: plan.hash, leadId, projectId,
        roomId: plan.roomId, roomName: plan.roomName, sourceMessageId: plan.messageId, mediaIds: [plan.mediaId], audience: 'customer_self',
        basis: 'delivered_formal_plan', status: 'current', text: plan.text,
        formal: { issueId: plan.issueId, issueRevision: plan.issueRevision, number: plan.number, revision: plan.revision, decision: plan.status,
          previousVersionId: plan.previousVersionId, needGrantId: plan.needGrantId, materialVersion: plan.materialVersion, mediaHash: plan.mediaHash,
          authority: 'enterprise_published_version', imagePixels: false } });
      lines.push(plan.text);
    }
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
  const extended = sources.some(s => s.ref.type === 'team_review' || s.ref.type === 'formal_plan');
  // Keep earlier material dependency hashes when no newly available source or
  // business state has changed. A code upgrade alone must not redact history.
  if (!drawings.length) missing.push('当前有效点位图及其对应房间');
  else if (!extended) missing.push('点位图的正式核对、图内细节及对应现场尺寸');
  else {
    if (drawings.some(d => !sources.some(s => s.review?.drawingGrantId === d.ref.id))) missing.push('向本咨询明确回传的当前参考图核对关联');
    missing.push('图内细节、对应现场尺寸及实际落实依据');
  }
  if (extended && !sources.some(s => s.ref.type === 'formal_plan')) missing.push('向本咨询送达的当前精确正式方案版本及决定');
  if (drawings.length) lines.push('客户共享点位图说明只作参考；团队核对关联和正式版本分别以对应独立来源为准，不能由客户说明推断。');
  lines.push('本次材料投影未识读图片像素，不据文字推断图内位置或尺寸；缺项仅表示本次授权范围未提供，不表示现实中未发生。');
  lines.push('来源范围：本咨询原话/共享参考、明确回传的核对关联、已送达的精确正式版本、当前正式户型和向本人发布的记录。正式户型与施工房间的映射、具体点位仍分别核对。');
  lines.push('待核对：' + missing.join('；') + '。客户参考与团队关联核对不替代精确正式版本决定；该版真实决定以独立正式来源为准，实际落实和验收另行核对。');
  return finish();
}

export async function materialSnapshotAvailable(tx: PostgresTransaction, enterpriseId: string, snapshot: MaterialDependency) {
  try {
    const current = await queryMaterials(tx, { enterpriseId, principal: { kind: 'user', userId: snapshot.customerId }, contextVersion: 0, capabilities: [] },
      snapshot.query.conversationId, { leadId: snapshot.query.leadId, room: snapshot.query.room });
    return current.version === snapshot.version;
  } catch { return false; }
}
