import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, id, type ActorContext } from '@/lib/assistant/contracts';
import { text } from './contracts';
import { currentRecord, readSiteIssueBase, type IssueView, type SiteVersions } from './site-issues';
import { readPlan } from './site-plans';
import { siteAccessRevoked } from './site-access';

const lifecycleType = 'construction.site.issue.lifecycle.v1', evidenceType = 'construction.site.issue.evidence.v1';
type State = 'implemented' | 'resolved' | 'closed' | 'reopened';
type Lifecycle = {
  projectId: string; issueId: string; issueRevision: number; ownerId: string; revision: number; state: State;
  actorId: string; conclusion: string; planId?: string; planHash?: string; evidenceId?: string;
  resolvedBy?: string; closedBy?: string;
};
type Evidence = {
  projectId: string; issueId: string; issueRevision: number; ownerId: string; actorId: string;
  planId: string; planHash: string; recordId: string; recordVersion: number; recordHash: string;
  recordAuthorId: string; reviewerId: string; media: Array<{ id: string; hash: string }>; conclusion: string;
};
type Command = { action: 'implement'; issueId: string; planId: string; recordId: string; conclusion: string }
  | { action: 'resolve' | 'close'; issueId: string; conclusion: string; excerpt: string; originals: boolean }
  | { action: 'reopen'; issueId: string; conclusion: string };
export type ResolutionView = Lifecycle & { id: string; available: boolean; text: string; hash: string; evidence?: Evidence };

/** Formal changes require an explicit command, exact objects and separately selected customer disclosure. */
export function resolutionCommand(raw: string): Command | null {
  let m = /^落实事项\s*([1-9]\d{0,18})方案\s*([1-9]\d{0,18})记录\s*([1-9]\d{0,18})[：:]\s*([^\n]+)\s*$/.exec(raw);
  if (m) return { action: 'implement', issueId: id(m[1]), planId: id(m[2]), recordId: id(m[3]), conclusion: text(m[4], 1200) };
  m = /^(解决|关闭)事项\s*([1-9]\d{0,18})\s*\n结论[：:]([^\n]+)\n回传[：:]([^\n]+)\n回传原件[：:](是|否)\s*$/.exec(raw);
  if (m) return { action: m[1] === '解决' ? 'resolve' : 'close', issueId: id(m[2]), conclusion: text(m[3], 1200), excerpt: text(m[4], 1200), originals: m[5] === '是' };
  m = /^重新处理事项\s*([1-9]\d{0,18})[：:]\s*([^\n]+)\s*$/.exec(raw);
  if (m) return { action: 'reopen', issueId: id(m[1]), conclusion: text(m[2], 500) };
  if (/^(?:落实|解决|关闭|重新处理)事项\s*[1-9]\d*(?:方案|[：:\s])/.test(raw)) fail('invalid_site_resolution', 422);
  return null;
}
async function latest(tx: PostgresTransaction, eid: string, issueId: string) {
  return one(tx, sql`select * from app.domain_event_outbox where enterprise_id=${eid} and type=${lifecycleType}
    and aggregate_type='construction_site_issue' and aggregate_id=${issueId} order by aggregate_version desc limit 1`);
}
async function activeActor(tx: PostgresTransaction, eid: string, pid: string, aid: string, manager = false) {
  const a = await one(tx, sql`select app.construction_actor_access(${aid}::bigint,${eid}::bigint) as role,
    exists(select 1 from app.construction_members m join app.admin_users a on a.enterprise_id=m.enterprise_id and a.id=m.admin_id
      where m.enterprise_id=${eid} and m.project_id=${pid} and m.admin_id=${aid} and m.active and a.status='active'
      and ${manager ? sql`m.role='manager'` : sql`m.role<>'observer'`}) as member`);
  return a?.role === 'owner' || a?.role === 'member' && a.member === true;
}
export async function readSiteResolution(tx: PostgresTransaction, eid: string, pid: string, issueId: string, base?: IssueView): Promise<ResolutionView | null> {
  const event = await latest(tx, eid, issueId); if (!event) return null;
  const p = event.payload as Lifecycle, issue = base || await readSiteIssueBase(tx, eid, pid, issueId);
  let available = p.projectId === pid && !!issue && issue.status === 'awaiting_review' && issue.revision === p.issueRevision && issue.ownerId === p.ownerId;
  available = available && await activeActor(tx, eid, pid, p.actorId, p.state !== 'implemented');
  let evidence: Evidence | undefined;
  if (available && p.state !== 'reopened') {
    const plan = p.planId && await readPlan(tx, eid, p.planId);
    const original = p.evidenceId && await one(tx, sql`select payload,created_at from app.domain_event_outbox where enterprise_id=${eid}
      and id=${p.evidenceId} and type=${evidenceType} and aggregate_id=${issueId}`);
    evidence = original ? original.payload as Evidence : undefined;
    available = !!plan && plan.status === 'approved' && plan.hash === p.planHash && !!evidence
      && evidence.planId === p.planId && evidence.planHash === p.planHash && evidence.issueRevision === p.issueRevision && evidence.ownerId === p.ownerId;
    if (available && evidence) {
      const record = await currentRecord(tx, eid, pid, evidence.recordId);
      available = !!record && record.row.status === 'published' && Number(record.row.version) === evidence.recordVersion && record.hash === evidence.recordHash;
      for (const aid of [evidence.actorId, evidence.recordAuthorId, evidence.reviewerId]) available = available && await activeActor(tx, eid, pid, aid);
      for (const aid of [p.resolvedBy, p.closedBy].filter(Boolean) as string[]) available = available && await activeActor(tx, eid, pid, aid, true);
      if (available && original) available = !await siteAccessRevoked(tx, eid, pid,
        [evidence.actorId, evidence.recordAuthorId, evidence.reviewerId, p.resolvedBy, p.closedBy].filter(Boolean) as string[], original.created_at as Date,
        { managers: [p.resolvedBy, p.closedBy].filter(Boolean) as string[] });
    }
  }
  const label = ({ implemented: '已记录现场落实证据，待管理人员正式核对解决', resolved: '已正式解决，尚未关闭', closed: '已正式关闭', reopened: '已重新打开，旧落实与关闭结论不再沿用' })[p.state];
  const display = available ? `事项${issueId} · 处理修订${p.revision} · ${label}。`
    + (evidence ? `\n依据方案${p.planId}、现场记录${evidence.recordId} · 版本${evidence.recordVersion}、原件${evidence.media.length}张；负责人：${issue!.ownerName}。` : '')
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
  if (actor.principal.kind !== 'admin') fail('construction_forbidden', 403);
  const eid = actor.enterpriseId, aid = actor.principal.adminId;
  // Source consultation -> material advisory lock, matching formal customer decisions.
  const issue = await readSiteIssueBase(tx, eid, pid, cmd.issueId);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`site-material:${eid}:${pid}`},0))`);
  if (!issue || issue.status !== 'awaiting_review' || !issue.ownerId || !issue.roomId) fail('site_review_required', 422);
  if (versions.issues[issue.issueId] !== issue.revision || versions.records[issue.recordId] !== issue.recordVersion
    || versions.materials?.[issue.roomId] !== issue.materialVersion) fail('version_conflict');
  const previous = await latest(tx, eid, issue.issueId), current = await readSiteResolution(tx, eid, pid, issue.issueId, issue);
  const revision = Number(previous?.aggregate_version || 0);
  if ((versions.resolutions?.[issue.issueId] || 0) !== revision) fail('version_conflict');
  if (cmd.action !== 'implement' && !manage || cmd.action === 'implement' && !manage && issue.ownerId !== aid) fail('construction_forbidden', 403);
  let data: Lifecycle = { projectId: pid, issueId: issue.issueId, issueRevision: issue.revision, ownerId: issue.ownerId,
    revision: revision + 1, state: 'reopened', actorId: aid, conclusion: cmd.conclusion };
  if (cmd.action === 'implement') {
    if (current?.available && ['resolved','closed'].includes(current.state)) fail('site_reopen_required', 422);
    const plan = await readPlan(tx, eid, cmd.planId);
    if (!plan || plan.projectId !== pid || plan.issueId !== issue.issueId || plan.status !== 'approved') fail('approved_plan_required', 422);
    if (versions.plans?.[plan.id] !== plan.revision) fail('version_conflict');
    const record = await currentRecord(tx, eid, pid, cmd.recordId), draft = record?.row.data as Row | undefined;
    if (!record || record.row.status !== 'published' || String(record.row.room_id) !== issue.roomId || cmd.recordId === issue.recordId
      || !String(draft?.completed || '').trim() || String(draft?.pending || '').trim() || String(draft?.coordination || '').trim() || !record.media.length) fail('site_execution_evidence_required', 422);
    if (versions.records[cmd.recordId] !== Number(record.row.version)) fail('version_conflict');
    const proof: Evidence = { projectId: pid, issueId: issue.issueId, issueRevision: issue.revision, ownerId: issue.ownerId, actorId: aid,
      planId: plan.id, planHash: plan.hash, recordId: cmd.recordId, recordVersion: Number(record.row.version), recordHash: record.hash,
      recordAuthorId: String(record.row.author_id), reviewerId: String(record.row.approved_by),
      media: record.media.map(m => ({ id: String(m.id), hash: String(m.source_hash) })), conclusion: cmd.conclusion };
    for (const person of [proof.recordAuthorId, proof.reviewerId, aid]) if (!await activeActor(tx, eid, pid, person)) fail('construction_forbidden', 403);
    const event = (await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
      values(${eid},${evidenceType},'construction_site_issue',${issue.issueId},${data.revision},${JSON.stringify(actor.principal)}::jsonb,${messageId},${JSON.stringify(proof)}::jsonb) returning id`))!;
    data = { ...data, state: 'implemented', planId: plan.id, planHash: plan.hash, evidenceId: String(event.id) };
  } else if (cmd.action === 'reopen') {
    if (!previous) fail('site_resolution_state_conflict');
  } else {
    if (!current?.available || current.state !== (cmd.action === 'resolve' ? 'implemented' : 'resolved')) fail('site_resolution_state_conflict');
    data = { ...current, ...data, state: cmd.action === 'resolve' ? 'resolved' : 'closed',
      resolvedBy: cmd.action === 'resolve' ? aid : current.resolvedBy, ...(cmd.action === 'close' ? { closedBy: aid } : {}) };
    // Keep immutable event payloads minimal: projection-only fields are not persisted.
    data = { projectId: data.projectId, issueId: data.issueId, issueRevision: data.issueRevision, ownerId: data.ownerId,
      revision: data.revision, state: data.state, actorId: data.actorId, conclusion: data.conclusion,
      planId: data.planId, planHash: data.planHash, evidenceId: data.evidenceId, resolvedBy: data.resolvedBy, closedBy: data.closedBy };
  }
  const event = (await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${eid},${lifecycleType},'construction_site_issue',${issue.issueId},${data.revision},${JSON.stringify(actor.principal)}::jsonb,${messageId},${JSON.stringify(data)}::jsonb) returning id`))!;
  const view = await readSiteResolution(tx, eid, pid, issue.issueId, issue); if (!view?.available) fail('context_changed');
  if (cmd.action === 'resolve' || cmd.action === 'close') {
    const plan = (await readPlan(tx, eid, data.planId!))!;
    await tx.execute(sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
      values(${eid},'construction.site.issue.result.v1','construction_site_resolution',${issue.issueId},${data.revision},${JSON.stringify(actor.principal)}::jsonb,${messageId},
        ${JSON.stringify({ projectId: pid, issueId: issue.issueId, revision: data.revision, issueRevision: issue.revision, conversationId: plan.conversationId,
          customerId: plan.customerId, needGrantId: plan.needGrantId, materialVersion: plan.materialVersion, roomName: issue.roomName,
          lifecycleId: String(event.id), planId: plan.id, planNumber: plan.number, evidenceId: data.evidenceId, state: data.state,
          shareOriginals: cmd.originals, text: cmd.excerpt })}::jsonb)`);
  }
  return { issueId: issue.issueId, revision: issue.revision, lifecycleId: String(event.id), lifecycleRevision: view.revision,
    evidenceId: view.evidenceId || null, text: view.text };
}
