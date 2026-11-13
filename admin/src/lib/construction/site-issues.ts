import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, id, safeText, type ActorContext } from '@/lib/assistant/contracts';
import { text } from './contracts';
import { sharedMaterial, sharedMaterials } from './site-materials';
import { readSiteResolution } from './site-resolution';
import { collaborationEnabled, collaborationMember } from './collaboration-scope';
import { publishedSiteRecord } from './site-publications';

export type SiteIssueCommand = { action: 'open' | 'claim' | 'transfer' | 'reply' | 'cancel' | 'resume' | 'refresh' | 'check' | 'return' | 'confirm' | 'rectify' | 'dismiss'; target: string; value: string };
type Issue = { issueId: string; revision: number; projectId: string; recordId: string; recordVersion: number;
  sourceHash: string; sourceMessageId: string; roomId: string | null; roomName: string; openedBy: string;
  ownerId: string | null; state: 'awaiting_owner' | 'awaiting_review' | 'rectifying' | 'cancelled' | 'dismissed'; progressMessageId: string | null; action: string;
  materialVersion?: string; drawingGrantId?: string | null;
  requestMessageId?: string; requestHash?: string; requestText?: string;
  projectReview?: boolean;
  specialistDelegationId?: string;
  specialistManagerOnly?: boolean;
  confirmed?: boolean; confirmedAt?: string; confirmedBy?: string; confirmationReason?: string; rectifyingAt?: string; dismissedAt?: string; dismissReason?: string;
  /** A record item follows onsite work; a need item follows a customer's explicitly shared requirement. */
  sourceKind?: 'record' | 'need'; needGrantId?: string; customerId?: string; conversationId?: string };
export type IssueClassification = 'awaiting_verification' | 'awaiting_rectification' | 'rectifying' | 'awaiting_review'
  | 'resolved' | 'closed' | 'dismissed' | 'cancelled' | 'invalidated';
export const issueClassificationLabels: Record<IssueClassification, string> = {
  awaiting_verification: '待核实', awaiting_rectification: '待整改', rectifying: '整改中', awaiting_review: '已整改待复核',
  resolved: '已修正待关闭', closed: '已修正', dismissed: '已排除或误报', cancelled: '已取消', invalidated: '待重新核对',
};
export type IssueView = Issue & { status: string; ownerName: string; sourceAvailable: boolean; text: string;
  classification: IssueClassification; classificationLabel: string; confirmed: boolean; designRelated: boolean;
  lifecycleId?: string; lifecycleRevision?: number; evidenceId?: string; executionRecordId?: string; executionRecordVersion?: number; planId?: string };
export function classifyIssue(status: string, issue: Pick<Issue, 'state' | 'confirmed'>): IssueClassification {
  if (status === 'cancelled') return 'cancelled';
  if (status === 'invalidated') return 'invalidated';
  if (status === 'dismissed' || issue.state === 'dismissed') return 'dismissed';
  if (status === 'closed') return 'closed';
  if (status === 'resolved') return 'resolved';
  if (status === 'implemented') return 'awaiting_review';
  if (status === 'rectifying' || issue.state === 'rectifying') return 'rectifying';
  if (status === 'awaiting_review') return issue.confirmed ? 'awaiting_review' : 'awaiting_verification';
  return issue.confirmed ? 'awaiting_rectification' : 'awaiting_verification';
}
export function siteIssueSummary(issue: IssueView) {
  const { issueId, revision, roomId, roomName, status, classification, classificationLabel, confirmed, ownerId, ownerName,
    sourceAvailable, designRelated, lifecycleId, lifecycleRevision, evidenceId, executionRecordId, executionRecordVersion, planId } = issue;
  return { issueId, revision, roomId, roomName, status, classification, classificationLabel, confirmed, ownerId, ownerName,
    sourceAvailable, designRelated, lifecycleId, lifecycleRevision, evidenceId, executionRecordId, executionRecordVersion, planId,
    sourceKind: issue.sourceKind || 'record', recordId: issue.recordId || null, recordVersion: issue.recordVersion || null };
}

/** Counts and lists come from the same set of current issue revisions. */
export function groupProjectIssues(issues: IssueView[], viewerId?: string, includeText = false) {
  const empty = { awaitingVerification: [] as Row[], awaitingRectification: [] as Row[], rectifying: [] as Row[],
    awaitingReview: [] as Row[], fixed: [] as Row[], excluded: [] as Row[], cancelled: [] as Row[], designReviews: [] as Row[] };
  const counts: Record<IssueClassification, number> = { awaiting_verification: 0, awaiting_rectification: 0, rectifying: 0,
    awaiting_review: 0, resolved: 0, closed: 0, dismissed: 0, cancelled: 0, invalidated: 0 };
  const quality = { open: 0, fixed: 0, excluded: 0 };
  for (const issue of issues) {
    const item = { ...siteIssueSummary(issue), mine: !!viewerId && issue.ownerId === viewerId, ...(includeText ? { text: issue.text.slice(0, 1200) } : {}) };
    const fixed = issue.classification === 'resolved' || issue.classification === 'closed';
    if (!issue.confirmed && (issue.sourceKind === 'need' || issue.designRelated || fixed)) {
      empty.designReviews.push(item);
      continue;
    }
    counts[issue.classification]++;
    if (issue.classification === 'dismissed') quality.excluded++;
    else if (issue.confirmed && issue.sourceAvailable && !['cancelled', 'invalidated'].includes(issue.classification)) {
      if (fixed) quality.fixed++;
      else quality.open++;
    }
    if (issue.classification === 'cancelled') empty.cancelled.push(item);
    else if (issue.classification === 'dismissed') empty.excluded.push(item);
    else if (issue.classification === 'resolved' || issue.classification === 'closed') empty.fixed.push(item);
    else if (issue.classification === 'awaiting_rectification') empty.awaitingRectification.push(item);
    else if (issue.classification === 'rectifying') empty.rectifying.push(item);
    else if (issue.classification === 'awaiting_review') empty.awaitingReview.push(item);
    else empty.awaitingVerification.push(item);
  }
  const openCount = empty.awaitingVerification.length + empty.awaitingRectification.length + empty.rectifying.length + empty.awaitingReview.length;
  return { ...empty, counts, quality, openCount };
}
export type SiteVersions = { records: Record<string, number>; issues: Record<string, number>; materials?: Record<string, string>; plans?: Record<string, number>; resolutions?: Record<string, number> };

export function parseSiteVersions(value: unknown): SiteVersions {
  if (value === undefined) return { records: {}, issues: {} };
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['records','issues','materials','plans','resolutions'].includes(k))) fail('invalid_construction', 422);
  const result: SiteVersions = { records: {}, issues: {}, materials: {} };
  for (const kind of ['records','issues'] as const) {
    const map = (value as Row)[kind];
    if (!map || typeof map !== 'object' || Array.isArray(map) || Object.keys(map).length > (kind === 'records' ? 150 : 100)) fail('invalid_construction', 422);
    for (const [key, version] of Object.entries(map)) {
      id(key); if (!Number.isSafeInteger(version) || Number(version) < 1) fail('invalid_construction', 422);
      result[kind][key] = Number(version);
    }
  }
  const materials = (value as Row).materials;
  for (const kind of ['plans','resolutions'] as const) if ((value as Row)[kind] !== undefined) {
    const plans = (value as Row)[kind];
    if (!plans || typeof plans !== 'object' || Array.isArray(plans) || Object.keys(plans).length > 100) fail('invalid_construction', 422);
    result[kind] = {};
    for (const [pid, revision] of Object.entries(plans)) {
      id(pid); if (!Number.isSafeInteger(revision) || Number(revision) < 1) fail('invalid_construction', 422);
      result[kind]![pid] = Number(revision);
    }
  }
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
export function siteIssueCommand(raw: string): SiteIssueCommand | null {
  const prefix = '(?:(?:请|帮我|麻烦)\\s*)?';
  let m = new RegExp('^' + prefix + '跟进(?:现场)?记录\\s*[#＃]?([1-9]\\d{0,18})(?:[：:，,\\s]+(.+))?[。！!\\s]*$').exec(raw);
  if (m) return { action: 'open', target: id(m[1]), value: m[2] || '' };
  m = new RegExp('^' + prefix + '接手事项\\s*[#＃]?([1-9]\\d{0,18})[。！!\\s]*$').exec(raw);
  if (m) return { action: 'claim', target: id(m[1]), value: '' };
  m = new RegExp('^' + prefix + '转交事项\\s*[#＃]?([1-9]\\d{0,18})\\s*(?:给|至)\\s*(.{1,80}?)\\s*$').exec(raw);
  if (m) return { action: 'transfer', target: id(m[1]), value: m[2].replace(/[。！!]$/, '') };
  m = new RegExp('^' + prefix + '核对事项\\s*([1-9]\\d{0,18})图纸\\s*([1-9]\\d{0,18})[。！!\\s]*$').exec(raw);
  if (m) return { action: 'check', target: id(m[1]), value: id(m[2]) };
  m = new RegExp('^' + prefix + '确认事项\\s*[#＃]?([1-9]\\d{0,18})[：:]\\s*([\\s\\S]{1,500})$').exec(raw);
  if (m) return { action: 'confirm', target: id(m[1]), value: text(m[2], 500) };
  m = new RegExp('^' + prefix + '确认事项\\s*[#＃]?([1-9]\\d{0,18})[。！!\\s]*$').exec(raw);
  if (m) return { action: 'confirm', target: id(m[1]), value: '' };
  m = new RegExp('^' + prefix + '开始整改事项\\s*[#＃]?([1-9]\\d{0,18})(?:[：:]\\s*([\\s\\S]{1,1200}))?[。！!\\s]*$').exec(raw);
  if (m) return { action: 'rectify', target: id(m[1]), value: (m[2] || '').trim() };
  m = new RegExp('^' + prefix + '(?:排除|标记误报)事项\\s*[#＃]?([1-9]\\d{0,18})[：:]\\s*([\\s\\S]{1,500})$').exec(raw);
  if (m) return { action: 'dismiss', target: id(m[1]), value: text(m[2], 500) };
  m = new RegExp('^' + prefix + '(回复|取消|恢复|重新核对|回传)事项\\s*[#＃]?([1-9]\\d{0,18})[：:]\\s*(.{1,2000})$', 's').exec(raw);
  if (m && m[3].trim()) return { action: m[1] === '回复' ? 'reply' : m[1] === '取消' ? 'cancel' : m[1] === '恢复' ? 'resume' : m[1] === '回传' ? 'return' : 'refresh', target: id(m[2]), value: m[3].trim() };
  return null;
}

export async function currentRecord(tx: PostgresTransaction, eid: string, pid: string, rid: string, allowUnassignedRoom = false) {
  const r = await one(tx, sql`select r.*,m.content,room.name as current_room_name from app.construction_site_records r
    join app.assistant_messages m on m.enterprise_id=r.enterprise_id and m.conversation_id=r.conversation_id and m.id=r.source_message_id
    left join app.construction_rooms room on room.enterprise_id=r.enterprise_id and room.project_id=r.project_id and room.id=r.room_id
    where r.enterprise_id=${eid} and r.project_id=${pid} and r.id=${rid} for share of r,m`);
  // Formal matters keep the original room requirement. A management brief may
  // also read a legitimate project-wide record, but never a broken room link.
  if (!r || !['draft','published'].includes(String(r.status))
    || (r.room_id ? r.current_room_name !== r.room_name_snapshot : !allowUnassignedRoom || r.room_name_snapshot !== '')) return null;
  const media = await rows(tx, sql`select m.id::text,m.source_hash,m.deleted_at from app.construction_site_attachments a join app.construction_site_media m
    on m.enterprise_id=a.enterprise_id and m.project_id=a.project_id and m.id=a.media_id
    where a.enterprise_id=${eid} and a.project_id=${pid} and a.record_id=${rid} order by a.position`);
  if (media.some(m => m.deleted_at)) return null;
  return { row: r, media, hash: fingerprint({ data: r.data, content: r.content, roomId: String(r.room_id), roomName: r.room_name_snapshot, status: r.status, media }) };
}

async function issueData(tx: PostgresTransaction, eid: string, pid: string, issueId: string, asOf?: Date): Promise<Issue | null> {
  const opened = await one(tx, sql`select id,payload from app.domain_event_outbox where enterprise_id=${eid} and id=${issueId}
    and type='construction.site.issue.opened.v1' and payload->>'projectId'=${pid}
    ${asOf ? sql`and created_at<${asOf}` : sql``}`);
  if (!opened) return null;
  const latest = await one(tx, sql`select payload from app.domain_event_outbox where enterprise_id=${eid} and type='construction.site.issue.progress.v1'
    and aggregate_type='construction_site_issue' and aggregate_id=${issueId}
    ${asOf ? sql`and created_at<${asOf}` : sql``} order by aggregate_version desc limit 1`);
  const original = opened.payload as Issue;
  const projectReview = original.projectReview ?? (original.sourceKind === 'need' && !original.requestMessageId);
  return { ...(latest?.payload || original) as Issue, issueId, ...(projectReview ? { projectReview } : {}) };
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
/** One live project-member name, shared by preview and the original transfer writer. */
export async function siteTransferAssignee(tx: PostgresTransaction, eid: string, pid: string, name: string) {
  const candidates = await rows(tx, sql`select a.id::text,a.display_name from app.admin_users a join app.construction_members m on m.enterprise_id=a.enterprise_id and m.admin_id=a.id
    where m.enterprise_id=${eid} and m.project_id=${pid} and m.active and m.role<>'observer' and a.status='active' and a.display_name=${name} for share of a,m`);
  if (candidates.length !== 1 || !await effectiveOwner(tx, eid, pid, String(candidates[0].id))) fail('construction_staff_unavailable', 422);
  return { id: String(candidates[0].id), name: String(candidates[0].display_name) };
}

/** Source/assignment revision stays independent of formal execution/closure revisions. */
export async function readSiteIssueBase(tx: PostgresTransaction, eid: string, pid: string, issueId: string, asOf?: Date): Promise<IssueView | null> {
  const issue = await issueData(tx, eid, pid, issueId, asOf); if (!issue) return null;
  // A need item binds the customer's explicitly shared requirement instead of an
  // onsite record. Both source kinds keep their own hash, room and material version.
  const isNeed = issue.sourceKind === 'need';
  const need = isNeed && issue.needGrantId ? await sharedMaterial(tx, eid, pid, issue.needGrantId) : null;
  const source = isNeed ? null : await currentRecord(tx, eid, pid, issue.recordId);
  const materials = issue.roomId ? await sharedMaterials(tx, eid, pid, issue.roomId) : null;
  const request = !isNeed && issue.requestMessageId ? await one(tx, sql`select m.content from app.assistant_messages m join app.construction_chats c
    on c.enterprise_id=m.enterprise_id and c.conversation_id=m.conversation_id where m.enterprise_id=${eid} and c.project_id=${pid}
      and m.id=${issue.requestMessageId} and m.author_kind='admin' and m.admin_id=${issue.openedBy} for share of m`) : null;
  // Legacy items have no request binding. New items retain the explicit action
  // separately from the onsite report; changed originals cannot revive it.
  const requestAvailable = isNeed
    ? !!need && need.projectId === pid && need.roomId === issue.roomId && need.roomName === issue.roomName
      && need.customerId === issue.customerId && need.conversationId === issue.conversationId && need.sourceHash === issue.sourceHash
    : !issue.requestMessageId || !!request && fingerprint(request.content) === issue.requestHash;
  let specialistAuthorized = true;
  if (issue.specialistDelegationId) {
    const { specialistIssueOrigin, specialistPublicationAuthorized } = await import('./specialist-issues');
    const origin = await specialistIssueOrigin(tx, eid, pid, issue.specialistDelegationId);
    const publication = origin && await publishedSiteRecord(tx, eid, origin.ownerId, issue.recordId, issue.recordVersion, true);
    specialistAuthorized = !!publication && await specialistPublicationAuthorized(tx, origin, publication, issue.specialistManagerOnly);
  }
  const valid = requestAvailable && specialistAuthorized && (isNeed ? true : !!source && Number(source!.row.version) === issue.recordVersion && source!.hash === issue.sourceHash)
    && (!issue.materialVersion || materials?.version === issue.materialVersion);
  const owner = issue.ownerId && (!isNeed || issue.confirmed || await collaborationMember(tx, eid, pid, issue.ownerId) === 'designer')
    ? await effectiveOwner(tx, eid, pid, issue.ownerId) : null;
  // Historical selection does not restore a removed assignee or turn that
  // removal into a newly recorded historical "unassigned" state.
  if (asOf && issue.ownerId && !owner) return null;
  const ownerName = owner ? String(owner.display_name || owner.username) : '';
  const status = issue.state === 'cancelled' ? 'cancelled' : issue.state === 'dismissed' ? 'dismissed'
    : !valid ? 'invalidated' : !owner ? 'awaiting_owner' : issue.state;
  let text = `事项${issueId} · 修订${issue.revision} · ${issue.sourceKind === 'need' ? '需求资料' + issue.needGrantId : '原记录' + issue.recordId}：`;
  if (status === 'cancelled') text += '已取消跟进；原记录与其他关注保持各自状态。';
  else if (status === 'dismissed') text += `${issue.roomName}，已排除为误报或非施工质量问题，不计入施工质量；内部排除原因不向业主公开。原记录仍可追溯。`;
  else if (status === 'invalidated') text += '原材料或房间已变化，等待有权人员重新核对，旧处理结果不再沿用。';
  else {
    text += `${issue.roomName}，${ownerName ? '当前负责人：' + ownerName : '尚未分配有效负责人'}。`;
    if (need) text += '\n业主明确共享的需求原话：' + need.text;
    else if (source) text += '\n原现场记录：' + safeText(source.row.content as Parameters<typeof safeText>[0]);
    if (!need && issue.requestText) text += '\n跟进请求原话：' + issue.requestText;
    if (issue.drawingGrantId) text += `\n图纸资料${issue.drawingGrantId}已核对关联，仍需结合现场尺寸核对点位；这不是方案批准。`;
    if (issue.progressMessageId) {
      const reply = await one(tx, sql`select m.content from app.assistant_messages m join app.construction_chats c on c.enterprise_id=m.enterprise_id and c.conversation_id=m.conversation_id
        where m.enterprise_id=${eid} and c.project_id=${pid} and m.id=${issue.progressMessageId} and m.author_kind='admin'`);
      if (reply) text += '\n最近处理原话：' + safeText(reply.content as Parameters<typeof safeText>[0]);
    }
    if (isNeed && !issue.confirmed) text += status === 'awaiting_review' ? '\n设计意见已提交，等待团队和业主确认当前版本。' : '\n等待设计师核对需求和图纸。';
    else if (!issue.confirmed) text += '\n待有权人员核实是否属于施工问题；资料缺失和记录更正沿原记录处理。';
    else if (status === 'rectifying') text += '\n已确认需要整改，负责人正在处理；施工回传不等于复核通过。';
    else if (status === 'awaiting_review') text += '\n已有处理回复，仍待团队核对；回复不等于已解决或正式批准。';
    else text += issue.confirmed ? '\n已确认需要整改，等待负责人处理。' : '\n等待负责人处理；没有已确认期限，不推断逾期。';
    if (issue.action === 'return') text += '\n本次明确回复已授权回传原咨询；真人接待期间等待恢复小K后投递，投递前仍会重核来源和权限。';
  }
  if (issue.action === 'resume') text += '\n已沿原事项恢复，按当前资料重新处理；旧回复、图纸核对及正式决定不自动恢复。';
  const classification = classifyIssue(status, issue);
  return { ...issue, ...(issue.requestMessageId && !requestAvailable ? { requestText: '' } : {}),
    ownerId: owner ? issue.ownerId : null, ownerName, status, sourceAvailable: !!valid, text,
    classification, classificationLabel: issueClassificationLabels[classification], confirmed: issue.confirmed === true,
    designRelated: issue.sourceKind === 'need' || !!issue.drawingGrantId };
}

export async function readSiteIssue(tx: PostgresTransaction, eid: string, pid: string, issueId: string, asOf?: Date): Promise<IssueView | null> {
  const issue = await readSiteIssueBase(tx, eid, pid, issueId, asOf); if (!issue) return null;
  const resolution = await readSiteResolution(tx, eid, pid, issueId, issue, asOf);
  if (!resolution) return issue;
  if (resolution.issueRevision !== issue.revision) return issue;
  const status = !resolution.available ? 'invalidated' : resolution.state === 'reopened'
    ? issue.confirmed ? 'awaiting_owner' : issue.status : resolution.state;
  const classification = classifyIssue(status, resolution.state === 'reopened' ? { ...issue, state: 'awaiting_owner' } : issue);
  return { ...issue, status, classification, classificationLabel: issueClassificationLabels[classification],
    lifecycleId: resolution.id, lifecycleRevision: resolution.revision,
    ...(resolution.available && resolution.evidence ? { evidenceId: resolution.evidenceId, executionRecordId: resolution.evidence.recordId,
      executionRecordVersion: resolution.evidence.recordVersion, planId: resolution.planId } : {}),
    text: issue.text.replace(/\n已有处理回复，仍待团队核对；回复不等于已解决或正式批准。/, '') + '\n' + resolution.text };
}

export async function projectSiteIssues(tx: PostgresTransaction, eid: string, pid: string, limit: number | null = 50) {
  const events = await rows(tx, sql`select id from app.domain_event_outbox where enterprise_id=${eid} and type='construction.site.issue.opened.v1'
    and payload->>'projectId'=${pid} order by id desc ${limit === null ? sql`` : sql`limit ${limit}`}`);
  const result: IssueView[] = [];
  for (const event of events) { const issue = await readSiteIssue(tx, eid, pid, String(event.id)); if (issue) result.push(issue); }
  return result;
}

export async function handleSiteIssue(tx: PostgresTransaction, actor: ActorContext, pid: string, sourceMessageId: string, raw: string, versions: SiteVersions, manage: boolean) {
  const cmd = siteIssueCommand(raw); if (!cmd) return null;
  return executeSiteIssue(tx, actor, pid, sourceMessageId, cmd, versions, manage);
}

/** Trusted service input only. Natural actions reach here after the original
 * staff member confirms the exact persisted preview; model output alone cannot. */
export async function openRecordIssue(tx: PostgresTransaction, eid: string, pid: string, recordId: string,
  source: NonNullable<Awaited<ReturnType<typeof currentRecord>>>,
  request: Pick<Issue, 'openedBy' | 'requestMessageId' | 'requestHash' | 'requestText' | 'projectReview' | 'specialistDelegationId' | 'specialistManagerOnly' | 'customerId' | 'conversationId'>,
  principal: ActorContext['principal'], correlationId: string) {
  const issue: Issue = { issueId: '', revision: 1, projectId: pid, recordId, recordVersion: Number(source.row.version), sourceHash: source.hash,
    sourceMessageId: String(source.row.source_message_id), roomId: String(source.row.room_id), roomName: String(source.row.room_name_snapshot),
    ownerId: null, state: 'awaiting_owner', progressMessageId: null, action: 'open', ...request };
  const event = (await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${eid},'construction.site.issue.opened.v1','construction_site_record',${recordId},1,${JSON.stringify(principal)}::jsonb,${correlationId},${JSON.stringify(issue)}::jsonb) returning id`))!;
  return (await readSiteIssue(tx, eid, pid, String(event.id)))!;
}

export async function executeSiteIssue(tx: PostgresTransaction, actor: ActorContext, pid: string, sourceMessageId: string, cmd: SiteIssueCommand, versions: SiteVersions, manage: boolean) {
  if (actor.principal.kind !== 'admin') fail('construction_forbidden', 403);
  const eid = actor.enterpriseId, aid = actor.principal.adminId;
  const collaboration = collaborationEnabled(eid);
  if (collaboration && cmd.action !== 'open') await readSiteIssueBase(tx, eid, pid, cmd.target);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`site-material:${eid}:${pid}`},0))`);
  if (cmd.action === 'open') {
    const existing = await one(tx, sql`select id from app.domain_event_outbox where enterprise_id=${eid} and type='construction.site.issue.opened.v1'
      and aggregate_type='construction_site_record' and aggregate_id=${cmd.target} and payload->>'projectId'=${pid}`);
    if (existing) return (await readSiteIssue(tx, eid, pid, String(existing.id)))!;
    const source = await currentRecord(tx, eid, pid, cmd.target); if (!source) fail('context_changed');
    if (versions.records[cmd.target] !== Number(source.row.version)) fail('version_conflict');
    const data = source.row.data as Row;
    if (!String(data.pending || '').trim() && !String(data.coordination || '').trim()
      && !(collaboration && cmd.value && source.media.length)) fail('site_review_required', 422);
    const request = await one(tx, sql`select m.content from app.assistant_messages m join app.construction_chats c
      on c.enterprise_id=m.enterprise_id and c.conversation_id=m.conversation_id where m.enterprise_id=${eid} and c.project_id=${pid}
        and m.id=${sourceMessageId} and m.author_kind='admin' and m.admin_id=${aid} for share of m`);
    if (!request) fail('context_changed');
    return openRecordIssue(tx, eid, pid, cmd.target, source, {
      openedBy: aid, requestMessageId: sourceMessageId, requestHash: fingerprint(request.content), requestText: cmd.value.trim(),
      ...(collaboration ? { projectReview: true } : {}),
    }, actor.principal, sourceMessageId);
  }
  const previous = await issueData(tx, eid, pid, cmd.target); if (!previous) fail('construction_not_found', 404);
  if (versions.issues[cmd.target] !== previous.revision) fail('version_conflict');
  const view = (await readSiteIssue(tx, eid, pid, cmd.target))!;
  if (['implemented','resolved','closed'].includes(view.status)) fail('site_reopen_required', 422);
  if (previous.state === 'cancelled' && !['resume','return'].includes(cmd.action)) fail('context_changed');
  if (previous.state === 'dismissed' && cmd.action !== 'resume') fail('context_changed');
  if (cmd.action === 'resume' && !['cancelled','dismissed'].includes(previous.state)) fail('context_changed');
  if (view.status === 'invalidated' && !['cancel','refresh'].includes(cmd.action)) fail('context_changed');
  const issue: Issue = { ...previous, revision: previous.revision + 1, action: cmd.action };
  const design = previous.sourceKind === 'need';
  const projectReview = collaboration || design || previous.confirmed === true;
  const role = projectReview ? await collaborationMember(tx, eid, pid, aid) : null;
  const manager = projectReview && collaboration ? role === 'manager' : manage || role === 'manager';
  const assignedDesigner = view.ownerId === aid && role === 'designer';
  const canHandle = manager || view.ownerId === aid;
  if (projectReview && (!role || previous.confirmed && role === 'designer')) fail('construction_forbidden', 403);
  if (design && !previous.confirmed && (['reply', 'check'].includes(cmd.action) ? !assignedDesigner
    : ['claim', 'refresh'].includes(cmd.action) ? role !== 'designer' && !manager : !manager)) fail('construction_forbidden', 403);
  const materials = previous.roomId ? await sharedMaterials(tx, eid, pid, previous.roomId) : null;
  if (['reply','refresh','check','return'].includes(cmd.action) && materials && (materials.sources.length || previous.materialVersion)
    && versions.materials?.[previous.roomId!] !== materials.version) fail('version_conflict');
  if (cmd.action === 'confirm') {
    if (!manager) fail('construction_forbidden', 403);
    if (design && collaboration || !['awaiting_owner','awaiting_review'].includes(view.status) || !view.sourceAvailable) fail('site_review_required', 422);
    if (issue.confirmed) return view;
    if (!design) {
      const source = await currentRecord(tx, eid, pid, issue.recordId);
      if (source?.row.status !== 'published' || !source.media.length) fail('site_review_required', 422);
      if (versions.records[issue.recordId] !== issue.recordVersion) fail('version_conflict');
    }
    issue.confirmed = true; issue.confirmedAt = new Date().toISOString(); issue.confirmedBy = aid;
    if (cmd.value) issue.confirmationReason = text(cmd.value, 500);
    issue.state = 'awaiting_owner';
  } else if (cmd.action === 'rectify') {
    if (!canHandle) fail('construction_forbidden', 403);
    // Rectification starts only under an effective responsible person; an
    // unassigned item must be claimed or transferred first.
    if (!issue.confirmed || view.status !== 'awaiting_owner' || !view.ownerId) fail('site_review_required', 422);
    issue.state = 'rectifying'; issue.rectifyingAt = new Date().toISOString();
  } else if (cmd.action === 'dismiss') {
    if (!manager) fail('construction_forbidden', 403);
    if (!cmd.value.trim()) fail('invalid_construction', 422);
    issue.state = 'dismissed'; issue.dismissedAt = new Date().toISOString(); issue.dismissReason = cmd.value;
    issue.progressMessageId = null; issue.drawingGrantId = null; issue.materialVersion = materials?.version;
    delete issue.rectifyingAt;
  } else if (cmd.action === 'claim') {
    if (view.ownerId === aid) return view;
    if (design && !previous.confirmed && role !== 'designer' || view.ownerId && view.ownerId !== aid && !manager) fail('construction_forbidden', 403);
    if (!await effectiveOwner(tx, eid, pid, aid)) fail('construction_forbidden', 403);
    issue.ownerId = aid; issue.state = 'awaiting_owner';
  } else if (cmd.action === 'resume') {
    if (!manager && previous.openedBy !== aid) fail('construction_forbidden', 403);
    const isNeed = previous.sourceKind === 'need';
    const need = isNeed ? await sharedMaterial(tx, eid, pid, previous.needGrantId || '') : null;
    const source = isNeed ? null : await currentRecord(tx, eid, pid, previous.recordId);
    if (isNeed ? !need : !source) fail('context_changed');
    const roomId = String(need ? need.roomId : source!.row.room_id), currentMaterials = await sharedMaterials(tx, eid, pid, roomId);
    if ((need ? versions.materials?.[roomId] : versions.records[previous.recordId]) !== (need ? currentMaterials.version : Number(source!.row.version))
      || versions.materials?.[roomId] !== currentMaterials.version) fail('version_conflict');
    // Recovery is a new revision of the same item. Never revive an old reply,
    // drawing check, customer decision or a removed assignee's authority.
    Object.assign(issue, need
      ? { recordId: '', recordVersion: 0, sourceHash: need.sourceHash, roomId, roomName: need.roomName,
        sourceMessageId: need.consentMessageId || need.sourceMessageId, ownerId: view.ownerId, state: 'awaiting_owner', progressMessageId: null,
        materialVersion: currentMaterials.version, drawingGrantId: null, requestMessageId: need.sourceMessageId, requestHash: need.sourceHash, requestText: need.text }
      : { recordVersion: Number(source!.row.version), sourceHash: source!.hash, roomId, roomName: String(source!.row.room_name_snapshot),
        sourceMessageId: String(source!.row.source_message_id), ownerId: view.ownerId, state: 'awaiting_owner', progressMessageId: null,
        materialVersion: currentMaterials.version, drawingGrantId: null });
    // Reopening an excluded item returns it to verification; a former dismissal
    // or confirmation is history, not a current quality conclusion.
    issue.confirmed = false; issue.confirmedAt = undefined; issue.confirmedBy = undefined; issue.confirmationReason = undefined;
    issue.rectifyingAt = undefined; issue.dismissedAt = undefined; issue.dismissReason = undefined;
  } else if (cmd.action === 'cancel') {
    if (!manager && previous.openedBy !== aid) fail('construction_forbidden', 403);
    issue.state = 'cancelled'; issue.progressMessageId = null; issue.drawingGrantId = null;
    issue.materialVersion = materials?.version;
  } else if (cmd.action === 'return') {
    // Management explicitly discloses a bounded state/excerpt to the original
    // consultation. Private replies and later state changes are never copied.
    if (!manager) fail('construction_forbidden', 403);
    const need = materials?.sources.find(s => s.kind === 'need' && (!design || s.id === previous.needGrantId));
    if (!need || !view.sourceAvailable || !['awaiting_owner','awaiting_review','cancelled'].includes(view.status)) fail('site_review_required', 422);
    const returnState = view.status as Issue['state'];
    if (returnState === 'awaiting_review' && (!previous.progressMessageId
      || materials?.sources.some(s => s.kind === 'drawing') && !previous.drawingGrantId)) fail('site_review_required', 422);
    const waitingFor = returnState === 'cancelled' ? 'none' : view.ownerId ? 'team' : 'unassigned';
    // A removed assignee cannot turn a new, explicitly unassigned return into
    // an old awaiting-review claim, or regain that assignment merely by rejoining.
    issue.state = returnState; issue.ownerId = view.ownerId;
    if (returnState === 'awaiting_owner' && previous.state === 'awaiting_review') {
      issue.progressMessageId = null; issue.drawingGrantId = null;
    }
    await tx.execute(sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
      values(${eid},'construction.site.issue.result.v1','construction_site_issue',${previous.issueId},${issue.revision},${JSON.stringify(actor.principal)}::jsonb,${sourceMessageId},
      ${JSON.stringify({ projectId: pid, issueId: previous.issueId, revision: issue.revision, conversationId: need.conversationId, customerId: need.customerId,
        materialVersion: materials!.version, needGrantId: need.id, drawingGrantId: issue.drawingGrantId || null, text: cmd.value, roomName: previous.roomName,
        state: returnState, ownerId: view.ownerId, ownerName: view.ownerName, waitingFor })}::jsonb)`);
    issue.materialVersion = materials!.version;
  } else {
    if (!canHandle) fail('construction_forbidden', 403);
    if (cmd.action === 'transfer') {
      const assignee = await siteTransferAssignee(tx, eid, pid, cmd.value);
      if (design && !previous.confirmed && await collaborationMember(tx, eid, pid, assignee.id) !== 'designer') fail('construction_staff_unavailable', 422);
      if (view.ownerId === assignee.id) return view;
      issue.ownerId = assignee.id; issue.state = 'awaiting_owner';
    } else if (cmd.action === 'refresh') {
      const isNeed = previous.sourceKind === 'need';
      const need = isNeed ? await sharedMaterial(tx, eid, pid, previous.needGrantId || '') : null;
      const source = isNeed ? null : await currentRecord(tx, eid, pid, previous.recordId);
      if (isNeed ? !need : !source) fail('context_changed');
      if (!isNeed && versions.records[previous.recordId] !== Number(source!.row.version)) fail('version_conflict');
      Object.assign(issue, need
        ? { recordId: '', recordVersion: 0, sourceHash: need.sourceHash, roomId: need.roomId, roomName: need.roomName,
          sourceMessageId: need.consentMessageId || need.sourceMessageId, ownerId: view.ownerId, state: 'awaiting_owner', progressMessageId: null,
          requestMessageId: need.sourceMessageId, requestHash: need.sourceHash, requestText: need.text }
        : { recordVersion: Number(source!.row.version), sourceHash: source!.hash, roomId: String(source!.row.room_id), roomName: String(source!.row.room_name_snapshot),
          sourceMessageId: String(source!.row.source_message_id), ownerId: view.ownerId, state: 'awaiting_owner', progressMessageId: null });
      issue.materialVersion = (await sharedMaterials(tx, eid, pid, issue.roomId!)).version; issue.drawingGrantId = null;
      if (projectReview) {
        issue.confirmed = false; issue.confirmedAt = undefined; issue.confirmedBy = undefined;
        issue.confirmationReason = undefined; issue.rectifyingAt = undefined;
      }
    } else if (cmd.action === 'check') {
      const source = materials?.sources.find(s => s.id === cmd.value && s.kind === 'drawing');
      const reviewer = await one(tx, sql`select role from app.admin_users where enterprise_id=${eid} and id=${aid} and status='active' for share`);
      if (projectReview ? !assignedDesigner : !manage && reviewer?.role !== 'designer') fail('construction_forbidden', 403);
      if (!source) fail('context_changed');
      issue.drawingGrantId = source.id; issue.materialVersion = materials!.version;
    } else {
      if (!issue.confirmed || !collaboration) issue.state = 'awaiting_review';
      issue.progressMessageId = sourceMessageId;
      issue.materialVersion = materials?.version;
    }
  }
  await tx.execute(sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${eid},'construction.site.issue.progress.v1','construction_site_issue',${issue.issueId},${issue.revision},${JSON.stringify(actor.principal)}::jsonb,${sourceMessageId},${JSON.stringify(issue)}::jsonb)`);
  return (await readSiteIssue(tx, eid, pid, issue.issueId))!;
}
