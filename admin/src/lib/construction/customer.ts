import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, id, type ActorContext } from '@/lib/assistant/contracts';
import { currentStage, readStageSettings, stageContact } from './stages-store';
import { publishedSiteRecord, siteRecordProjection } from './site-publications';
import { siteRecordText, type SiteDraft } from './site-contract';

export async function customerProjects(tx: PostgresTransaction, eid: string, uid: string, leadId = '') {
  return rows(tx, sql`select p.* from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where p.enterprise_id=${eid} and p.customer_access and l.customer_user_id=${uid} and l.archived_at is null
    ${leadId ? sql`and l.id=${id(leadId)}` : sql``} order by p.id limit 30`);
}
export async function constructionRead(tx: PostgresTransaction, eid: string, uid: string, leadId: string) {
  const projects = await customerProjects(tx, eid, uid, leadId), settings = await readStageSettings(tx, eid), data: Row[] = [], lines: string[] = [];
  for (const p of projects) {
    const stage = currentStage(p, settings.stages), contact = stage && p.status === 'active' ? await stageContact(tx, eid, p, stage.key) : null;
    data.push({ projectId: String(p.id), leadId: String(p.lead_id), name: p.name, status: p.status, version: Number(p.version),
      settingsVersion: settings.version, stageKey: stage?.key || null, stageName: stage?.name || null,
      visitReminder: stage?.visitReminder || false, visitReason: stage?.visitReason || '', watchPoints: stage?.watchPoints || '',
      progressNote: p.progress_note, contactAvailable: !!contact, contactName: contact?.name || '' });
    const records = await rows(tx, sql`select id::text from app.construction_site_records where enterprise_id=${eid} and project_id=${String(p.id)} and status='published' and audience='customer' order by published_at desc,id desc limit 10`);
    const published = [];
    for (const candidate of records) {
      const r = await publishedSiteRecord(tx, eid, uid, String(candidate.id));
      if (r) {
        published.push({ id: String(r.id), version: Number(r.published_version), roomName: String(r.room_name_snapshot), data: r.data });
        lines.push(`团队已核对发布的现场记录（${String(p.name)}，记录${String(r.id)}，版本${Number(r.published_version)}；不代表正式验收/费用或工期批准）：\n${siteRecordText(r.data as SiteDraft, String(r.room_name_snapshot))}`);
      }
    }
    data[data.length - 1].records = published;
    lines.push(`「${String(p.name)}」：${p.status === 'active' ? '进行中' : p.status === 'paused' ? '已暂停' : '已归档'}。`);
    if (!stage) { lines.push('团队尚未标记实际施工节点，暂时无法确定当前阶段的施工联系人。'); continue; }
    lines.push(`团队标记的当前节点：${stage.name}。${String(p.progress_note || '')}`);
    if (p.status !== 'active') { lines.push('项目当前未开放到场联系，请等团队恢复服务。'); continue; }
    if (stage.visitReminder) lines.push(stage.visitReason);
    if (stage.watchPoints) lines.push('到现场重点看：\n' + stage.watchPoints);
    lines.push(contact ? `当前阶段联系人：${contact.name}。到场时间请点击“联系管家”，直接与当前阶段施工人员电话沟通。`
      : '当前阶段联系电话尚未配置，请等项目团队补充后再联系。');
  }
  return { data, lines };
}
/** Source access is shared by customer history and staff packets. */
export async function constructionNoticeAvailable(tx: PostgresTransaction, eid: string, cid: string, mid: string, lock = false, requireNotice = false) {
  const notice = await one(tx, sql`select e.aggregate_id,e.aggregate_version,e.payload,m.purpose from app.assistant_messages m
    join app.domain_event_outbox e on e.enterprise_id=m.enterprise_id and e.id=m.source_event_id
    where m.enterprise_id=${eid} and m.conversation_id=${cid} and m.id=${mid} and m.purpose in ('construction.update','construction.stage','construction.followup','construction.record','construction.result')`);
  if (!notice) return !requireNotice;
  if (notice.purpose === 'construction.result') {
    const { siteResultAvailable } = await import('./site-results');
    return siteResultAvailable(tx, eid, cid, mid);
  }
  if (notice.purpose === 'construction.record') return !!(await siteRecordProjection(tx, eid, cid, mid, lock))?.available;
  // Earlier visit/plan notices no longer represent an executable customer workflow.
  if (!['construction.stage','construction.followup'].includes(String(notice.purpose))) return false;
  const payload = notice.payload as Row;
  const followUp = notice.purpose === 'construction.followup';
  if (lock) await one(tx, sql`select version from app.construction_stage_settings where enterprise_id=${eid} for share`);
  return !!await one(tx, sql`select p.id from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    join app.assistant_participants ap on ap.enterprise_id=p.enterprise_id and ap.conversation_id=${cid} and ap.user_id=l.customer_user_id and ap.status='active'
    left join app.construction_stage_settings s on s.enterprise_id=p.enterprise_id
    where p.enterprise_id=${eid} and p.id=${String(followUp ? payload.projectId : notice.aggregate_id)} and p.customer_access and p.status='active' and l.archived_at is null
    ${followUp ? sql`and l.customer_user_id=${String(payload.customerId)}` : sql``}
    ${followUp && payload.room ? sql`and exists(select 1 from app.construction_rooms r where r.enterprise_id=p.enterprise_id and r.project_id=p.id and r.name=${String(payload.room)})` : sql``}
    and p.progress_revision=${Number(followUp ? payload.progressRevision : notice.aggregate_version)} and p.current_stage_key=${String(payload.stageKey)}
    and coalesce(s.version,1)=${Number(payload.settingsVersion)} ${lock ? sql`for share of p,l,ap` : sql``}`);
}
/** Only server-projected, currently authorized sources can expose a dial action; model text cannot. */
export async function constructionMessageActions(tx: PostgresTransaction, actor: ActorContext, cid: string, mid: string) {
  if (actor.principal.kind !== 'user') return [];
  const notice = await one(tx, sql`select e.payload from app.assistant_messages m join app.domain_event_outbox e on e.enterprise_id=m.enterprise_id and e.id=m.source_event_id
    where m.enterprise_id=${actor.enterpriseId} and m.conversation_id=${cid} and m.id=${mid} and m.purpose='construction.stage'`);
  const business = notice ? null : await one(tx, sql`select s.private_checkpoint from app.assistant_messages m join app.assistant_run_steps s on s.enterprise_id=m.enterprise_id and s.run_id=m.run_id
    where m.enterprise_id=${actor.enterpriseId} and m.conversation_id=${cid} and m.id=${mid} and s.kind='agent_business_result'`);
  const snapshot = business?.private_checkpoint as { query?: { domain?: string }; data?: Row[] } | undefined;
  const sources = notice ? [notice.payload as Row] : snapshot?.query?.domain === 'construction' ? snapshot.data || [] : [];
  const projects = sources.length ? await customerProjects(tx, actor.enterpriseId, actor.principal.userId) : [];
  const actions = [];
  for (const source of sources) {
    const project = projects.find(p => String(p.id) === source.projectId && p.status === 'active' && p.current_stage_key === source.stageKey);
    if (project && await stageContact(tx, actor.enterpriseId, project, String(source.stageKey))) actions.push({ projectId: String(project.id), projectName: String(project.name), stageKey: String(source.stageKey) });
  }
  return actions;
}
/** Lock before revalidating the originating message, so a changed node/phone cannot race the dial lookup. */
export async function currentConstructionContact(tx: PostgresTransaction, actor: ActorContext, projectId: string) {
  if (actor.principal.kind !== 'user') fail('assistant_resource_not_found', 404);
  const p = await one(tx, sql`select p.* from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where p.enterprise_id=${actor.enterpriseId} and p.id=${id(projectId)} and p.customer_access and p.status='active'
    and l.customer_user_id=${actor.principal.userId} and l.archived_at is null for share of p,l`);
  const settings = await readStageSettings(tx, actor.enterpriseId), stage = p && currentStage(p, settings.stages), contact = p && stage && await stageContact(tx, actor.enterpriseId, p, stage.key);
  if (!p || !stage || !contact) fail('construction_contact_unavailable', 404);
  return { projectId, stageKey: stage.key, contactName: contact.name, phone: contact.phone };
}
