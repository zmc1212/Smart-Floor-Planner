import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, id, type ActorContext } from '@/lib/assistant/contracts';
import { text } from './contracts';
import { currentRecord, readSiteIssueBase, type IssueView, type SiteVersions } from './site-issues';
import { latestPlan, readPlan, type PlanView } from './site-plans';
import { collaborationEnabled, collaborationMember } from './collaboration-scope';
import { delegationConsumer } from '@/lib/native-workflow/live/delegation-state';
import { siteAccessRevoked } from './site-access';

const lifecycleType = 'construction.site.issue.lifecycle.v1', evidenceType = 'construction.site.issue.evidence.v1';
type State = 'implemented' | 'resolved' | 'closed' | 'reopened';
type Lifecycle = {
  projectId: string; issueId: string; issueRevision: number; ownerId: string; revision: number; state: State;
  actorId: string; conclusion: string; planId?: string; planHash?: string; evidenceId?: string;
  resolvedBy?: string; closedBy?: string; projectReview?: boolean;
};
type Evidence = {
  projectId: string; issueId: string; issueRevision: number; ownerId: string; actorId: string;
  planId?: string; planHash?: string; recordId: string; recordVersion: number; recordHash: string;
  recordAuthorId: string; reviewerId: string; media: Array<{ id: string; hash: string }>; conclusion: string;
};
export type ResolutionCommand = { action: 'implement'; issueId: string; planId?: string; recordId: string; conclusion: string }
  | { action: 'resolve' | 'close'; issueId: string; conclusion: string; excerpt: string; originals: boolean }
  | { action: 'reopen'; issueId: string; conclusion: string };
export type ResolutionView = Lifecycle & { id: string; available: boolean; text: string; hash: string; evidence?: Evidence };

/** Formal changes require an explicit command, exact objects and separately selected customer disclosure. */
export function resolutionCommand(raw: string): ResolutionCommand | null {
  let m = /^落实事项\s*([1-9]\d{0,18})方案\s*([1-9]\d{0,18})记录\s*([1-9]\d{0,18})[：:]\s*([^\n]+)\s*$/.exec(raw);
  if (m) return { action: 'implement', issueId: id(m[1]), planId: id(m[2]), recordId: id(m[3]), conclusion: text(m[4], 1200) };
  m = /^整改回传事项\s*([1-9]\d{0,18})记录\s*([1-9]\d{0,18})[：:]\s*([^\n]+)\s*$/.exec(raw);
  if (m) return { action: 'implement', issueId: id(m[1]), recordId: id(m[2]), conclusion: text(m[3], 1200) };
  m = /^(解决|关闭)事项\s*([1-9]\d{0,18})\s*\n结论[：:]([^\n]+)\n回传[：:]([^\n]+)\n回传原件[：:](是|否)\s*$/.exec(raw);
  if (m) return { action: m[1] === '解决' ? 'resolve' : 'close', issueId: id(m[2]), conclusion: text(m[3], 1200), excerpt: text(m[4], 1200), originals: m[5] === '是' };
  m = /^重新处理事项\s*([1-9]\d{0,18})[：:]\s*([^\n]+)\s*$/.exec(raw);
  if (m) return { action: 'reopen', issueId: id(m[1]), conclusion: text(m[2], 500) };
  if (/^(?:落实|解决|关闭|重新处理)事项\s*[1-9]\d*(?:方案|[：:\s])/.test(raw)) fail('invalid_site_resolution', 422);
  return null;
}
async function latest(tx: PostgresTransaction, eid: string, issueId: string, asOf?: Date) {
  return one(tx, sql`select * from app.domain_event_outbox where enterprise_id=${eid} and type=${lifecycleType}
    and aggregate_type='construction_site_issue' and aggregate_id=${issueId}
    ${asOf ? sql`and created_at<${asOf}` : sql``} order by aggregate_version desc limit 1`);
}
async function activeActor(tx: PostgresTransaction, eid: string, pid: string, aid: string, manager = false) {
  const a = await one(tx, sql`select app.construction_actor_access(${aid}::bigint,${eid}::bigint) as role,
    exists(select 1 from app.construction_members m join app.admin_users a on a.enterprise_id=m.enterprise_id and a.id=m.admin_id
      where m.enterprise_id=${eid} and m.project_id=${pid} and m.admin_id=${aid} and m.active and a.status='active'
      and ${manager ? sql`m.role='manager'` : sql`m.role<>'observer'`}) as member`);
  return a?.role === 'owner' || a?.role === 'member' && a.member === true;
}
function reviewable(issue: IssueView | null) {
  return issue && (issue.status === 'awaiting_review' || issue.status === 'rectifying' && issue.confirmed);
}
export async function readSiteResolution(tx: PostgresTransaction, eid: string, pid: string, issueId: string, base?: IssueView, asOf?: Date): Promise<ResolutionView | null> {
  const event = await latest(tx, eid, issueId, asOf); if (!event) return null;
  const p = event.payload as Lifecycle, issue = base || await readSiteIssueBase(tx, eid, pid, issueId, asOf);
  let available = p.projectId === pid && !!issue && !!reviewable(issue) && issue.revision === p.issueRevision && issue.ownerId === p.ownerId;
  available = available && (p.projectReview && p.state !== 'implemented'
    ? await collaborationMember(tx, eid, pid, p.actorId) === 'manager' : await activeActor(tx, eid, pid, p.actorId, p.state !== 'implemented'));
  if (available && p.state === 'reopened' && p.planId) {
    const plan = await readPlan(tx, eid, p.planId, asOf);
    available = plan?.status === 'approved' && plan.hash === p.planHash;
  }
  let evidence: Evidence | undefined;
  if (available && p.state !== 'reopened') {
    const plan = p.planId && await readPlan(tx, eid, p.planId, asOf);
    const original = p.evidenceId && await one(tx, sql`select payload,created_at from app.domain_event_outbox where enterprise_id=${eid}
      and id=${p.evidenceId} and type=${evidenceType} and aggregate_id=${issueId}
      ${asOf ? sql`and created_at<${asOf}` : sql``}`);
    evidence = original ? original.payload as Evidence : undefined;
    const currentBasis = p.planId ? !!plan && plan.status === 'approved' && plan.hash === p.planHash
      : p.projectReview === true && issue?.confirmed && !await latestPlan(tx, eid, issueId, asOf);
    available = !!currentBasis && !!evidence && evidence.planId === p.planId && evidence.planHash === p.planHash && evidence.issueRevision === p.issueRevision && evidence.ownerId === p.ownerId;
    if (available && evidence) {
      const record = await currentRecord(tx, eid, pid, evidence.recordId);
      available = !!record && record.row.status === 'published' && Number(record.row.version) === evidence.recordVersion && record.hash === evidence.recordHash;
      for (const aid of [evidence.actorId, evidence.recordAuthorId, evidence.reviewerId]) available = available && await activeActor(tx, eid, pid, aid);
      for (const aid of [p.resolvedBy, p.closedBy].filter(Boolean) as string[]) available = available && (p.projectReview
        ? await collaborationMember(tx, eid, pid, aid) === 'manager' : await activeActor(tx, eid, pid, aid, true));
      if (available && original) available = !await siteAccessRevoked(tx, eid, pid,
        [evidence.actorId, evidence.recordAuthorId, evidence.reviewerId, p.resolvedBy, p.closedBy].filter(Boolean) as string[], original.created_at as Date,
        { managers: [p.resolvedBy, p.closedBy].filter(Boolean) as string[] });
    }
  }
  const label = ({ implemented: '已记录现场落实证据，待管理人员正式核对解决', resolved: '已正式解决，尚未关闭', closed: '已正式关闭', reopened: '已重新打开，旧落实与关闭结论不再沿用' })[p.state];
  const display = available ? `事项${issueId} · 处理修订${p.revision} · ${label}。`
    + (evidence ? `\n${p.planId ? `依据方案${p.planId}、` : ''}现场记录${evidence.recordId} · 版本${evidence.recordVersion}、原件${evidence.media.length}张；负责人：${issue!.ownerName}。` : '')
    + `\n本次结论：${p.conclusion}\n现场落实、解决和关闭分别留痕；关闭不代表工程验收通过、付款或结算。`
    : `事项${issueId}的落实/解决/关闭依据或人员权限已变化，原结论停止沿用；请有权人员重新核对。`;
  return { ...p, id: String(event.id), available, text: display, hash: fingerprint({ id: String(event.id), ...p, available, evidence }), ...(available && evidence ? { evidence } : {}) };
}
export async function projectResolutionVersions(tx: PostgresTransaction, eid: string, pid: string) {
  const found = await rows(tx, sql`select distinct on(aggregate_id) aggregate_id,aggregate_version from app.domain_event_outbox
    where enterprise_id=${eid} and type=${lifecycleType} and payload->>'projectId'=${pid} order by aggregate_id,aggregate_version desc limit 100`);
  return Object.fromEntries(found.map(e => [String(e.aggregate_id), Number(e.aggregate_version)]));
}
export async function validateResolutionReceipt(tx: PostgresTransaction, eid: string, pid: string, result: Row) {
  if (!result.lifecycleId) return;
  const current = await readSiteResolution(tx, eid, pid, String(result.issueId));
  if (!current?.available || current.id !== result.lifecycleId || current.revision !== result.lifecycleRevision) fail('context_changed');
}
export async function handleSiteResolution(tx: PostgresTransaction, actor: ActorContext, pid: string, messageId: string, raw: string, versions: SiteVersions, manage: boolean) {
  const cmd = resolutionCommand(raw); if (!cmd) return null;
  return executeSiteResolution(tx, actor, pid, messageId, cmd, versions, manage);
}
/** Preview and execution authorize exactly the same immutable inputs. No writes. */
export async function prepareSiteResolution(tx: PostgresTransaction, actor: ActorContext, pid: string, cmd: ResolutionCommand, versions: SiteVersions, manage: boolean) {
  if (actor.principal.kind !== 'admin') fail('construction_forbidden', 403);
  const eid = actor.enterpriseId, aid = actor.principal.adminId;
  id(cmd.issueId); text(cmd.conclusion, cmd.action === 'reopen' ? 500 : 1200);
  const collaboration = collaborationEnabled(eid);
  if (cmd.action === 'implement') {
    if (cmd.planId) id(cmd.planId);
    else if (!collaboration) fail('invalid_site_resolution', 422);
    id(cmd.recordId);
  }
  if (cmd.action === 'resolve' || cmd.action === 'close') { text(cmd.excerpt, 1200); if (typeof cmd.originals !== 'boolean') fail('invalid_site_resolution', 422); }
  // Source consultation -> material advisory lock, matching formal customer decisions.
  await readSiteIssueBase(tx, eid, pid, cmd.issueId);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`site-material:${eid}:${pid}`},0))`);
  const issue = await readSiteIssueBase(tx, eid, pid, cmd.issueId);
  if (!issue || !reviewable(issue) || !issue.ownerId || !issue.roomId) fail('site_review_required', 422);
  if (versions.issues[issue.issueId] !== issue.revision || (issue.recordId && versions.records[issue.recordId] !== issue.recordVersion)
    || (!issue.confirmed || issue.materialVersion) && versions.materials?.[issue.roomId] !== issue.materialVersion) fail('version_conflict');
  const previous = await latest(tx, eid, issue.issueId), current = await readSiteResolution(tx, eid, pid, issue.issueId, issue);
  const revision = Number(previous?.aggregate_version || 0);
  if ((versions.resolutions?.[issue.issueId] || 0) !== revision) fail('version_conflict');
  const projectReview = collaboration || issue.sourceKind === 'need' || issue.confirmed || current?.projectReview === true;
  const role = projectReview ? await collaborationMember(tx, eid, pid, aid) : null;
  if (projectReview ? cmd.action !== 'implement' && role !== 'manager' || cmd.action === 'implement' && !['manager', 'worker'].includes(role || '')
    : cmd.action !== 'implement' && !manage || cmd.action === 'implement' && !manage && issue.ownerId !== aid) fail('construction_forbidden', 403);
  let data: Lifecycle = { projectId: pid, issueId: issue.issueId, issueRevision: issue.revision, ownerId: issue.ownerId,
    revision: revision + 1, state: 'reopened', actorId: aid, conclusion: cmd.conclusion, ...(projectReview ? { projectReview } : {}) };
  let proof: Evidence | undefined;
  let plan: PlanView | null = null;
  if (cmd.action === 'implement') {
    if (current?.available && ['resolved','closed'].includes(current.state)) fail('site_reopen_required', 422);
    if (cmd.planId) {
      plan = await readPlan(tx, eid, cmd.planId);
      if (!plan || plan.projectId !== pid || plan.issueId !== issue.issueId || plan.status !== 'approved') fail('approved_plan_required', 422);
      if (versions.plans?.[plan.id] !== plan.revision) fail('version_conflict');
    } else if (!issue.confirmed || issue.sourceKind === 'need' || await latestPlan(tx, eid, issue.issueId)) fail('approved_plan_required', 422);
    const record = await currentRecord(tx, eid, pid, cmd.recordId), draft = record?.row.data as Row | undefined;
    if (!record || record.row.status !== 'published' || String(record.row.room_id) !== issue.roomId || cmd.recordId === issue.recordId
      || !String(draft?.completed || '').trim() || String(draft?.pending || '').trim() || String(draft?.coordination || '').trim() || !record.media.length) fail('site_execution_evidence_required', 422);
    if (versions.records[cmd.recordId] !== Number(record.row.version)) fail('version_conflict');
    if (projectReview) {
      if (role === 'worker' && (String(record.row.author_id) !== aid || !plan && issue.ownerId !== aid)) fail('construction_forbidden', 403);
      const after = plan ? await one(tx, sql`select id from app.domain_event_outbox where enterprise_id=${eid}
        and type='construction.plan.status.v1' and aggregate_type='construction_plan' and aggregate_id=${plan.id}
        and aggregate_version=${plan.revision} and payload->>'status'='approved' and created_at<=${record.row.created_at as Date}`)
        : await one(tx, sql`select id from app.domain_event_outbox where enterprise_id=${eid} and type='construction.site.issue.progress.v1'
          and aggregate_type='construction_site_issue' and aggregate_id=${issue.issueId} and aggregate_version=${issue.revision}
          and created_at<=${record.row.created_at as Date}`);
      if (!after || current?.state === 'reopened' && new Date(record.row.created_at as Date) < new Date(previous!.created_at as Date))
        fail('site_execution_evidence_required', 422);
      if (current?.available && current.state === 'implemented' && current.evidence?.recordId === cmd.recordId
        && current.evidence.recordVersion === Number(record.row.version)) fail('site_resolution_state_conflict');
    }
    proof = { projectId: pid, issueId: issue.issueId, issueRevision: issue.revision, ownerId: issue.ownerId, actorId: aid,
      planId: plan?.id, planHash: plan?.hash, recordId: cmd.recordId, recordVersion: Number(record.row.version), recordHash: record.hash,
      recordAuthorId: String(record.row.author_id), reviewerId: String(record.row.approved_by),
      media: record.media.map(m => ({ id: String(m.id), hash: String(m.source_hash) })), conclusion: cmd.conclusion };
    for (const person of [proof.recordAuthorId, proof.reviewerId, aid]) if (!await activeActor(tx, eid, pid, person)) fail('construction_forbidden', 403);
    data = { ...data, state: 'implemented', planId: plan?.id, planHash: plan?.hash };
  } else if (cmd.action === 'reopen') {
    if (!previous || current?.available && current.state === 'reopened') fail('site_resolution_state_conflict');
    if (projectReview && current?.planId) {
      const effective = await readPlan(tx, eid, current.planId);
      if (effective?.status === 'approved') { plan = effective; data = { ...data, planId: plan.id, planHash: plan.hash }; }
    }
  } else {
    if (!current?.available || current.state !== (cmd.action === 'resolve' ? 'implemented' : 'resolved')) fail('site_resolution_state_conflict');
    if (projectReview && cmd.action === 'resolve' && current.evidence?.actorId === aid) fail('construction_forbidden', 403);
    plan = current.planId ? await readPlan(tx, eid, current.planId) : null;
    data = { ...current, ...data, state: cmd.action === 'resolve' ? 'resolved' : 'closed',
      resolvedBy: cmd.action === 'resolve' ? aid : current.resolvedBy, ...(cmd.action === 'close' ? { closedBy: aid } : {}) };
    // Keep immutable event payloads minimal: projection-only fields are not persisted.
    data = { projectId: data.projectId, issueId: data.issueId, issueRevision: data.issueRevision, ownerId: data.ownerId,
      revision: data.revision, state: data.state, actorId: data.actorId, conclusion: data.conclusion,
      planId: data.planId, planHash: data.planHash, evidenceId: data.evidenceId, resolvedBy: data.resolvedBy, closedBy: data.closedBy,
      ...(projectReview ? { projectReview } : {}) };
  }
  return { issue, data, proof, plan };
}
/** The original explicit writer is shared by legacy commands and author-confirmed natural previews. */
export async function executeSiteResolution(tx: PostgresTransaction, actor: ActorContext, pid: string, messageId: string, cmd: ResolutionCommand, versions: SiteVersions, manage: boolean) {
  const prepared = await prepareSiteResolution(tx, actor, pid, cmd, versions, manage), { issue, proof, plan } = prepared, eid = actor.enterpriseId;
  let { data } = prepared;
  if (proof) {
    const evidence = (await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
      values(${eid},${evidenceType},'construction_site_issue',${issue.issueId},${data.revision},${JSON.stringify(actor.principal)}::jsonb,${messageId},${JSON.stringify(proof)}::jsonb) returning id`))!;
    data = { ...data, evidenceId: String(evidence.id) };
  }
  const event = (await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${eid},${lifecycleType},'construction_site_issue',${issue.issueId},${data.revision},${JSON.stringify(actor.principal)}::jsonb,${messageId},${JSON.stringify(data)}::jsonb) returning id`))!;
  const view = await readSiteResolution(tx, eid, pid, issue.issueId, issue); if (!view?.available) fail('context_changed');
  if (data.projectReview && cmd.action === 'reopen') {
    await tx.execute(sql`insert into app.domain_event_deliveries(enterprise_id,event_id,consumer_key)
      select ${eid},${String(event.id)},${delegationConsumer} where exists(select 1 from app.native_workflow_delegations
        where enterprise_id=${eid} and project_id=${pid} and state='completed'
        and tasks @> ${JSON.stringify([{ issueId: issue.issueId }])}::jsonb) on conflict do nothing`);
  }
  if (plan && (data.projectReview || cmd.action === 'resolve' || cmd.action === 'close')) {
    const disclosure = cmd.action === 'resolve' || cmd.action === 'close' ? { shareOriginals: cmd.originals, text: cmd.excerpt }
      : { shareOriginals: false, text: cmd.action === 'reopen' ? '事项已重新打开，等待项目团队处理。' : '施工已回传，等待项目经理复核。' };
    await tx.execute(sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
      values(${eid},'construction.site.issue.result.v1','construction_site_resolution',${issue.issueId},${data.revision},${JSON.stringify(actor.principal)}::jsonb,${messageId},
        ${JSON.stringify({ projectId: pid, issueId: issue.issueId, revision: data.revision, issueRevision: issue.revision, conversationId: plan.conversationId,
          customerId: plan.customerId, needGrantId: plan.needGrantId, materialVersion: plan.materialVersion, roomName: issue.roomName,
          lifecycleId: String(event.id), planId: plan.id, planNumber: plan.number, evidenceId: data.evidenceId, state: data.state,
          ...disclosure })}::jsonb)`);
  }
  return { issueId: issue.issueId, revision: issue.revision, lifecycleId: String(event.id), lifecycleRevision: view.revision,
    evidenceId: view.evidenceId || null, text: view.text };
}
