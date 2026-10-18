import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, id, safeText, type ActorContext } from '@/lib/assistant/contracts';
import { sharedMaterials } from './site-materials';

type Command = { action: 'open' | 'claim' | 'transfer' | 'reply' | 'cancel' | 'refresh' | 'check' | 'return'; target: string; value: string };
type Issue = { issueId: string; revision: number; projectId: string; recordId: string; recordVersion: number;
  sourceHash: string; sourceMessageId: string; roomId: string | null; roomName: string; openedBy: string;
  ownerId: string | null; state: 'awaiting_owner' | 'awaiting_review' | 'cancelled'; progressMessageId: string | null; action: string;
  materialVersion?: string; drawingGrantId?: string | null };
export type IssueView = Issue & { status: string; ownerName: string; text: string };
export type SiteVersions = { records: Record<string, number>; issues: Record<string, number>; materials?: Record<string, string> };

export function parseSiteVersions(value: unknown): SiteVersions {
  if (value === undefined) return { records: {}, issues: {} };
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['records','issues','materials'].includes(k))) fail('invalid_construction', 422);
  const result: SiteVersions = { records: {}, issues: {}, materials: {} };
  for (const kind of ['records','issues'] as const) {
    const map = (value as Row)[kind];
    if (!map || typeof map !== 'object' || Array.isArray(map) || Object.keys(map).length > 100) fail('invalid_construction', 422);
    for (const [key, version] of Object.entries(map)) {
      id(key); if (!Number.isSafeInteger(version) || Number(version) < 1) fail('invalid_construction', 422);
      result[kind][key] = Number(version);
    }
  }
  const materials = (value as Row).materials;
  if (materials !== undefined) {
    if (!materials || typeof materials !== 'object' || Array.isArray(materials) || Object.keys(materials).length > 100) fail('invalid_construction', 422);
    for (const [roomId, hash] of Object.entries(materials)) {
      id(roomId); if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) fail('invalid_construction', 422);
      result.materials![roomId] = hash;
    }
  }
  return result;
}

/** Explicit chat commands only. Questions, quotations, acknowledgements and model text cannot authorize an action. */
export function siteIssueCommand(raw: string): Command | null {
  const prefix = '(?:(?:请|帮我|麻烦)\\s*)?';
  let m = new RegExp('^' + prefix + '跟进(?:现场)?记录\\s*[#＃]?([1-9]\\d{0,18})(?:[：:，,\\s]+(.+))?[。！!\\s]*$').exec(raw);
  if (m) return { action: 'open', target: id(m[1]), value: m[2] || '' };
  m = new RegExp('^' + prefix + '接手事项\\s*[#＃]?([1-9]\\d{0,18})[。！!\\s]*$').exec(raw);
  if (m) return { action: 'claim', target: id(m[1]), value: '' };
  m = new RegExp('^' + prefix + '转交事项\\s*[#＃]?([1-9]\\d{0,18})\\s*(?:给|至)\\s*(.{1,80}?)\\s*$').exec(raw);
  if (m) return { action: 'transfer', target: id(m[1]), value: m[2].replace(/[。！!]$/, '') };
  m = new RegExp('^' + prefix + '核对事项\\s*([1-9]\\d{0,18})图纸\\s*([1-9]\\d{0,18})[。！!\\s]*$').exec(raw);
  if (m) return { action: 'check', target: id(m[1]), value: id(m[2]) };
  m = new RegExp('^' + prefix + '(回复|取消|重新核对|回传)事项\\s*[#＃]?([1-9]\\d{0,18})[：:]\\s*(.{1,2000})$', 's').exec(raw);
  if (m && m[3].trim()) return { action: m[1] === '回复' ? 'reply' : m[1] === '取消' ? 'cancel' : m[1] === '回传' ? 'return' : 'refresh', target: id(m[2]), value: m[3].trim() };
  return null;
}

async function currentRecord(tx: PostgresTransaction, eid: string, pid: string, rid: string) {
  const r = await one(tx, sql`select r.*,m.content,room.name as current_room_name from app.construction_site_records r
    join app.assistant_messages m on m.enterprise_id=r.enterprise_id and m.conversation_id=r.conversation_id and m.id=r.source_message_id
    left join app.construction_rooms room on room.enterprise_id=r.enterprise_id and room.project_id=r.project_id and room.id=r.room_id
    where r.enterprise_id=${eid} and r.project_id=${pid} and r.id=${rid} for share of r,m`);
  if (!r || !['draft','published'].includes(String(r.status)) || !r.room_id || r.current_room_name !== r.room_name_snapshot) return null;
  const media = await rows(tx, sql`select m.id::text,m.source_hash,m.deleted_at from app.construction_site_attachments a join app.construction_site_media m
    on m.enterprise_id=a.enterprise_id and m.project_id=a.project_id and m.id=a.media_id
    where a.enterprise_id=${eid} and a.project_id=${pid} and a.record_id=${rid} order by a.position`);
  if (media.some(m => m.deleted_at)) return null;
  return { row: r, hash: fingerprint({ data: r.data, content: r.content, roomId: String(r.room_id), roomName: r.room_name_snapshot, status: r.status, media }) };
}

async function issueData(tx: PostgresTransaction, eid: string, pid: string, issueId: string): Promise<Issue | null> {
  const opened = await one(tx, sql`select id,payload from app.domain_event_outbox where enterprise_id=${eid} and id=${issueId}
    and type='construction.site.issue.opened.v1' and payload->>'projectId'=${pid}`);
  if (!opened) return null;
  const latest = await one(tx, sql`select payload from app.domain_event_outbox where enterprise_id=${eid} and type='construction.site.issue.progress.v1'
    and aggregate_type='construction_site_issue' and aggregate_id=${issueId} order by aggregate_version desc limit 1`);
  return { ...(latest?.payload || opened.payload) as Issue, issueId };
}

async function effectiveOwner(tx: PostgresTransaction, eid: string, pid: string, aid: string) {
  // Resolve management permission before the tenant-filtered profile read: platform
  // administrators need no employee row in the selected enterprise.
  const access = await one(tx, sql`select app.construction_actor_access(${aid}::bigint,${eid}::bigint) as role`);
  const subject = await one(tx, sql`select a.id::text,a.display_name,a.username,
    case when a.user_id is not null then app.construction_miniprogram_access(a.id,${eid}::bigint,a.user_id,u.context_version) end as mini_role,
    exists(select 1 from app.construction_members m where m.enterprise_id=${eid} and m.project_id=${pid}
      and m.admin_id=a.id and m.active and m.role<>'observer') as member
    from app.admin_users a left join app.users u on u.id=a.user_id
    where a.id=${aid} and a.enterprise_id=${eid} and a.status='active' for share of a`);
  if (access?.role === 'owner') return subject || { id: aid, display_name: '平台管理员' };
  return subject && (subject.mini_role === 'owner' || (subject.member && (access?.role === 'member' || subject.mini_role === 'member'))) ? subject : null;
}

export async function readSiteIssue(tx: PostgresTransaction, eid: string, pid: string, issueId: string): Promise<IssueView | null> {
  const issue = await issueData(tx, eid, pid, issueId); if (!issue) return null;
  const source = await currentRecord(tx, eid, pid, issue.recordId);
  const materials = issue.roomId ? await sharedMaterials(tx, eid, pid, issue.roomId) : null;
  const valid = source && Number(source.row.version) === issue.recordVersion && source.hash === issue.sourceHash
    && (!issue.materialVersion || materials?.version === issue.materialVersion);
  const owner = issue.ownerId ? await effectiveOwner(tx, eid, pid, issue.ownerId) : null;
  const ownerName = owner ? String(owner.display_name || owner.username) : '';
  const status = issue.state === 'cancelled' ? 'cancelled' : !valid ? 'invalidated' : !owner ? 'awaiting_owner' : issue.state;
  let text = `事项${issueId} · 修订${issue.revision} · 原记录${issue.recordId}：`;
  if (status === 'cancelled') text += '已取消跟进；原记录与其他关注保持各自状态。';
  else if (status === 'invalidated') text += '原材料或房间已变化，等待有权人员重新核对，旧处理结果不再沿用。';
  else {
    text += `${issue.roomName}，${ownerName ? '当前负责人：' + ownerName : '尚未分配有效负责人'}。`;
    if (issue.drawingGrantId) text += `\n图纸资料${issue.drawingGrantId}已核对关联，仍需结合现场尺寸核对点位；这不是方案批准。`;
    if (issue.progressMessageId) {
      const reply = await one(tx, sql`select m.content from app.assistant_messages m join app.construction_chats c on c.enterprise_id=m.enterprise_id and c.conversation_id=m.conversation_id
        where m.enterprise_id=${eid} and c.project_id=${pid} and m.id=${issue.progressMessageId} and m.author_kind='admin'`);
      if (reply) text += '\n最近处理原话：' + safeText(reply.content as Parameters<typeof safeText>[0]);
    }
    text += status === 'awaiting_review' ? '\n已有处理回复，仍待团队核对；回复不等于已解决或正式批准。' : '\n等待负责人处理；没有已确认期限，不推断逾期。';
    if (issue.action === 'return') text += '\n本次明确回复已授权回传原咨询；真人接待期间等待恢复小K后投递，投递前仍会重核来源和权限。';
  }
  return { ...issue, ownerId: owner ? issue.ownerId : null, ownerName, status, text };
}

export async function projectSiteIssues(tx: PostgresTransaction, eid: string, pid: string) {
  const events = await rows(tx, sql`select id from app.domain_event_outbox where enterprise_id=${eid} and type='construction.site.issue.opened.v1'
    and payload->>'projectId'=${pid} order by id desc limit 50`);
  const result: IssueView[] = [];
  for (const event of events) { const issue = await readSiteIssue(tx, eid, pid, String(event.id)); if (issue) result.push(issue); }
  return result;
}

export async function handleSiteIssue(tx: PostgresTransaction, actor: ActorContext, pid: string, sourceMessageId: string, raw: string, versions: SiteVersions, manage: boolean) {
  const cmd = siteIssueCommand(raw); if (!cmd) return null;
  if (actor.principal.kind !== 'admin') fail('construction_forbidden', 403);
  const eid = actor.enterpriseId, aid = actor.principal.adminId;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`site-material:${eid}:${pid}`},0))`);
  let issue: Issue;
  if (cmd.action === 'open') {
    const existing = await one(tx, sql`select id from app.domain_event_outbox where enterprise_id=${eid} and type='construction.site.issue.opened.v1'
      and aggregate_type='construction_site_record' and aggregate_id=${cmd.target} and payload->>'projectId'=${pid}`);
    if (existing) return (await readSiteIssue(tx, eid, pid, String(existing.id)))!;
    const source = await currentRecord(tx, eid, pid, cmd.target); if (!source) fail('context_changed');
    if (versions.records[cmd.target] !== Number(source.row.version)) fail('version_conflict');
    const data = source.row.data as Row;
    if (!String(data.pending || '').trim() && !String(data.coordination || '').trim()) fail('site_review_required', 422);
    issue = { issueId: '', revision: 1, projectId: pid, recordId: cmd.target, recordVersion: Number(source.row.version), sourceHash: source.hash,
      sourceMessageId: String(source.row.source_message_id), roomId: String(source.row.room_id), roomName: String(source.row.room_name_snapshot),
      openedBy: aid, ownerId: null, state: 'awaiting_owner', progressMessageId: null, action: 'open' };
    const event = (await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
      values(${eid},'construction.site.issue.opened.v1','construction_site_record',${cmd.target},1,${JSON.stringify(actor.principal)}::jsonb,${sourceMessageId},${JSON.stringify(issue)}::jsonb) returning id`))!;
    return (await readSiteIssue(tx, eid, pid, String(event.id)))!;
  }
  const previous = await issueData(tx, eid, pid, cmd.target); if (!previous) fail('construction_not_found', 404);
  if (versions.issues[cmd.target] !== previous.revision) fail('version_conflict');
  const view = (await readSiteIssue(tx, eid, pid, cmd.target))!;
  if (previous.state === 'cancelled' || (view.status === 'invalidated' && !['cancel','refresh'].includes(cmd.action))) fail('context_changed');
  issue = { ...previous, revision: previous.revision + 1, action: cmd.action };
  const canHandle = manage || view.ownerId === aid;
  const materials = previous.roomId ? await sharedMaterials(tx, eid, pid, previous.roomId) : null;
  if (['reply','refresh','check','return'].includes(cmd.action) && materials && (materials.sources.length || previous.materialVersion)
    && versions.materials?.[previous.roomId!] !== materials.version) fail('version_conflict');
  if (cmd.action === 'claim') {
    if (view.ownerId === aid) return view;
    if (view.ownerId && view.ownerId !== aid && !manage) fail('construction_forbidden', 403);
    if (!await effectiveOwner(tx, eid, pid, aid)) fail('construction_forbidden', 403);
    issue.ownerId = aid; issue.state = 'awaiting_owner';
  } else if (cmd.action === 'cancel') {
    if (!manage && previous.openedBy !== aid) fail('construction_forbidden', 403);
    issue.state = 'cancelled'; issue.progressMessageId = sourceMessageId;
  } else {
    if (!canHandle) fail('construction_forbidden', 403);
    if (cmd.action === 'transfer') {
      const candidates = await rows(tx, sql`select a.id::text from app.admin_users a join app.construction_members m on m.enterprise_id=a.enterprise_id and m.admin_id=a.id
        where m.enterprise_id=${eid} and m.project_id=${pid} and m.active and m.role<>'observer' and a.status='active' and a.display_name=${cmd.value} for share of a,m`);
      if (candidates.length !== 1 || !await effectiveOwner(tx, eid, pid, String(candidates[0].id))) fail('construction_staff_unavailable', 422);
      if (view.ownerId === String(candidates[0].id)) return view;
      issue.ownerId = String(candidates[0].id); issue.state = 'awaiting_owner';
    } else if (cmd.action === 'refresh') {
      const source = await currentRecord(tx, eid, pid, previous.recordId); if (!source) fail('context_changed');
      if (versions.records[previous.recordId] !== Number(source.row.version)) fail('version_conflict');
      Object.assign(issue, { recordVersion: Number(source.row.version), sourceHash: source.hash, roomId: String(source.row.room_id), roomName: String(source.row.room_name_snapshot),
        sourceMessageId: String(source.row.source_message_id), ownerId: view.ownerId, state: 'awaiting_owner', progressMessageId: null });
      issue.materialVersion = materials?.version; issue.drawingGrantId = null;
    } else if (cmd.action === 'check') {
      const source = materials?.sources.find(s => s.id === cmd.value && s.kind === 'drawing');
      const reviewer = await one(tx, sql`select role from app.admin_users where enterprise_id=${eid} and id=${aid} and status='active' for share`);
      if (!manage && reviewer?.role !== 'designer') fail('construction_forbidden', 403);
      if (!source) fail('context_changed');
      issue.drawingGrantId = source.id; issue.materialVersion = materials!.version;
    } else if (cmd.action === 'return') {
      // A team reply is not a customer publication. Only this explicit owner/manager action opts in the exact excerpt.
      if (!manage) fail('construction_forbidden', 403);
      const need = materials?.sources.find(s => s.kind === 'need');
      if (!need || !previous.progressMessageId || previous.state !== 'awaiting_review') fail('site_review_required', 422);
      if (materials?.sources.some(s => s.kind === 'drawing') && !previous.drawingGrantId) fail('site_review_required', 422);
      await tx.execute(sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
        values(${eid},'construction.site.issue.result.v1','construction_site_issue',${previous.issueId},${issue.revision},${JSON.stringify(actor.principal)}::jsonb,${sourceMessageId},
        ${JSON.stringify({ projectId: pid, issueId: previous.issueId, revision: issue.revision, conversationId: need.conversationId, customerId: need.customerId,
          materialVersion: materials!.version, needGrantId: need.id, drawingGrantId: previous.drawingGrantId || null, text: cmd.value, roomName: previous.roomName })}::jsonb)`);
      issue.materialVersion = materials!.version;
    } else {
      issue.state = 'awaiting_review'; issue.progressMessageId = sourceMessageId;
      issue.materialVersion = materials?.version;
    }
  }
  await tx.execute(sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${eid},'construction.site.issue.progress.v1','construction_site_issue',${issue.issueId},${issue.revision},${JSON.stringify(actor.principal)}::jsonb,${sourceMessageId},${JSON.stringify(issue)}::jsonb)`);
  return (await readSiteIssue(tx, eid, pid, issue.issueId))!;
}
