import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { AppointmentRepository, CustomerProjectRepository } from '@/db/repositories';
import { appointmentToDto } from '@/lib/appointment-api';
import { adaptSurveyGraphToRooms, parseFormalSurveyLayout } from '@/lib/survey-graph';
import { fail, fingerprint, id, type ActorContext } from '../contracts';
import type { ModelTool } from '../contracts/model';
import { constructionRead } from '@/lib/construction/customer';
import { materialSnapshotAvailable, type MaterialSnapshot } from './materials';

export const businessToolDefinitions: ModelTool[] = [
  { name: 'recommend_references', description: '按客户明确方向查询本企业已授权发布的少量参考案例；query仅用风格/房型/用途关键词，泛看参考时传空字符串。不联网、不生成图片，不是正式施工方案。', parameters: {
    type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false,
  } },
  { name: 'record_reference_preference', description: '记录客户对最近一次推荐中某个案例明确说出的喜欢/不合适。ordinal为该次推荐的1到3顺序；多例但指代不明时先询问。quote逐字摘自本轮原话。浏览/点击不是选择。', parameters: {
    type: 'object', properties: { ordinal: { type: 'integer' }, quote: { type: 'string' }, sentiment: { type: 'string', enum: ['like','dislike'] } }, required: ['ordinal','quote','sentiment'], additionalProperties: false,
  } },
  { name: 'query_business', description: '只查当前客户本人本企业的量房预约、已发布方案、正式户型或实际施工节点/到场注意事项/本阶段电话联系人及向本人明确发布的现场记录。现场记录不等于正式验收或变更批准。客户想去现场时查询construction，电话沟通，不记录施工预约。没有记录就返回没有；不编造进度。leadId为空列本人档案，多个项目分开。', parameters: {
    type: 'object', properties: { domain: { type: 'string', enum: ['appointments','schemes','floorplans','construction'] }, leadId: { type: 'string' } }, required: ['domain','leadId'], additionalProperties: false,
  } },
  { name: 'request_designer', description: '仅当前客户明确要求找设计师时提交真实人工接续。不是模型之间的handoff。quote须为当前消息的直接请求原话，不得用于否定/假设/引用。', parameters: {
    type: 'object', properties: { quote: { type: 'string' }, expectedVersion: { type: 'integer' } }, required: ['quote','expectedVersion'], additionalProperties: false,
  } },
  { name: 'search_knowledge', description: '查询本企业已发布的政策/流程/服务知识。一般设计讨论无需检索。只选择直接回答当前问题的selectionId，不把一般规则当项目报价或工期。', parameters: {
    type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false,
  } },
];
export type BusinessQuery = { domain: 'appointments' | 'schemes' | 'floorplans' | 'construction'; leadId: string };
export type BusinessSnapshot = { query: BusinessQuery; customerId: string; leadIds: string[]; version: string; displayText: string; data: unknown[]; queriedAt: string } | MaterialSnapshot;
export function parseBusinessQuery(raw: unknown): BusinessQuery {
  const value = raw as BusinessQuery;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['domain','leadId'].includes(k))
    || !['appointments','schemes','floorplans','construction'].includes(value.domain) || typeof value.leadId !== 'string') fail('invalid_message', 422);
  if (value.leadId) id(value.leadId);
  return value;
}
/** Reuses existing service repositories/read adapters inside the caller's authorized tenant transaction. */
export async function queryBusiness(tx: PostgresTransaction, actor: ActorContext, query: BusinessQuery): Promise<BusinessSnapshot> {
  if (actor.principal.kind !== 'user') fail('assistant_capability_forbidden', 403);
  const customerId = actor.principal.userId;
  const leads = await rows(tx, sql`select id,community_name,primary_floor_plan_id from app.leads where enterprise_id=${actor.enterpriseId}
    and customer_user_id=${customerId} and archived_at is null ${query.leadId ? sql`and id=${query.leadId}` : sql``} order by id desc limit 10`);
  if (query.leadId && !leads.length) fail('assistant_resource_not_found', 404);
  const data: unknown[] = [], lines: string[] = [];
  for (const lead of leads) {
    const label = `${String(lead.community_name || '服务档案')}（${String(lead.id)}）`;
    if (query.domain === 'construction') {
      const result = await constructionRead(tx, actor.enterpriseId, customerId, String(lead.id));
      data.push(...result.data); lines.push(...result.lines);
    } else if (query.domain === 'appointments') {
      const appointments = await new AppointmentRepository(tx).listByLead(BigInt(actor.enterpriseId), BigInt(String(lead.id)));
      for (const a of appointments.slice(-10)) {
        const dto = appointmentToDto(a);
        const record = { id: dto.id, leadId: String(lead.id), version: dto.version, status: dto.status, timeRange: dto.timeRange };
        data.push(record);
        const labels: Record<string, string> = { pending: '待确认', confirmed: '已确认', completed: '已完成', cancelled: '已取消', expired: '已过期' };
        lines.push(`${label}：预约${dto.id}，${labels[dto.status] || dto.status}，时间${dto.timeRange}（版本${dto.version}）。`);
      }
    } else if (query.domain === 'schemes') {
      const publications = await new CustomerProjectRepository(tx).listActivePublicationSummaries(BigInt(actor.enterpriseId), BigInt(String(lead.id)));
      for (const { publication: p } of publications.slice(0, 10)) {
        data.push({ id: String(p.id), leadId: String(lead.id), title: p.schemeTitle, workflowId: String(p.workflowId), publishedAt: p.publishedAt });
        lines.push(`${label}：已发布方案「${p.schemeTitle || '装修方案'}」（发布记录${String(p.id)}）。可在该档案的方案中查看；发布不代表客户批准。`);
      }
    } else if (lead.primary_floor_plan_id) {
      const plan = await one(tx, sql`select id,name,layout_data from app.floor_plans where enterprise_id=${actor.enterpriseId} and id=${String(lead.primary_floor_plan_id)} and status='completed'`);
      if (plan && parseFormalSurveyLayout(plan.layout_data)) {
        const rooms = adaptSurveyGraphToRooms(plan.layout_data).map(r => ({ id: r.id, name: r.name }));
        data.push({ id: String(plan.id), leadId: String(lead.id), name: plan.name, layoutHash: fingerprint(plan.layout_data), rooms });
        lines.push(`${label}：已完成正式户型「${String(plan.name)}」，房间：${rooms.map(r => r.name).join('、') || '暂无房间名称'}。这里仅查询，不修改测量数据。`);
      }
    }
  }
  const name = { appointments: '预约', schemes: '已发布方案', floorplans: '已完成正式户型', construction: '已关联施工项目及实际节点' }[query.domain];
  return { query, customerId, leadIds: leads.map(l => String(l.id)), version: fingerprint(data), data,
    displayText: lines.length ? lines.join('\n') : `目前没有查到你在本企业的${name}记录。`, queriedAt: new Date().toISOString() };
}
export async function businessSnapshotAvailable(tx: PostgresTransaction, enterpriseId: string, snapshot: BusinessSnapshot) {
  if (snapshot.query.domain === 'materials') return materialSnapshotAvailable(tx, enterpriseId, snapshot as MaterialSnapshot);
  const current = await queryBusiness(tx, { enterpriseId, principal: { kind: 'user', userId: snapshot.customerId }, contextVersion: 0, capabilities: [] }, snapshot.query);
  return current.version === snapshot.version && fingerprint(current.leadIds) === fingerprint(snapshot.leadIds);
}
