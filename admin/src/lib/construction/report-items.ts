import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { fingerprint } from '@/lib/assistant/contracts';
import { readSiteIssue, readSiteIssueBase, type currentRecord } from './site-issues';
import { readPlan } from './site-plans';
import { siteAccessRevoked } from './site-access';

export type ReportIssue = { id: string; revision: number; status: string; room: string;
  ownerId: string | null; ownerName: string; recordId: string; recordVersion: number;
  sourceHash: string; eventId: string; updatedAt: string; carriedOver: boolean; text: string; hash: string };
export type ReportArrangement = { id: string; revision: number; number: number; issueId: string; issueRevision: number;
  title: string; difference: string; room: string; costDeltaCents: number; scheduleDeltaDays: number;
  decisionEventId: string; confirmedAt: string; carriedOver: boolean; hash: string };
export type ReportItems = { itemsCutoffAt: string; itemsPeriodStart: string; issues: ReportIssue[]; issuesTruncated: boolean;
  arrangements: ReportArrangement[]; arrangementsTruncated: boolean };
type RecordAccess = (recordId: string) => Promise<boolean>;
type PublishedRecordAccess = (recordId: string) => ReturnType<typeof currentRecord>;
export type ReportPublishedRecordItem = { recordId: string; recordVersion: number; sourceHash: string;
  publishedAt: string; room: string; pending: string; coordination: string; carriedOver: boolean };
export type CustomerReportItems = { itemsCutoffAt: string; itemsPeriodStart: string;
  publishedRecordItems: ReportPublishedRecordItem[]; publishedRecordItemsTruncated: boolean };

/** Only the exact customer publication is portable across the owner's chats.
 * These are recorded pending/coordination excerpts, never internal issue state,
 * private replies, confirmed arrangements or a grant from another consultation. */
function publishedRecordItem(source: Awaited<ReturnType<typeof currentRecord>>, start: Date, cutoff: Date): ReportPublishedRecordItem | null {
  if (!source || source.row.status !== 'published' || source.row.audience !== 'customer') return null;
  const r = source.row, publishedAt = new Date(String(r.published_at)), data = r.data as { pending?: string; coordination?: string };
  if (!(publishedAt < cutoff)) return null;
  const pending = typeof data.pending === 'string' ? data.pending : '', coordination = typeof data.coordination === 'string' ? data.coordination : '';
  if (!pending.trim() && !coordination.trim()) return null;
  return { recordId: String(r.id), recordVersion: Number(r.published_version), sourceHash: source.hash,
    publishedAt: publishedAt.toISOString(), room: String(r.room_name_snapshot), pending, coordination, carriedOver: publishedAt < start };
}

export async function collectCustomerReportItems(tx: PostgresTransaction, eid: string, pid: string, uid: string, start: Date, cutoff: Date,
  canRead: PublishedRecordAccess): Promise<CustomerReportItems> {
  // Filter by recipient and publication before applying the candidate bound.
  const candidates = await rows(tx, sql`select id from app.construction_site_records where enterprise_id=${eid} and project_id=${pid}
    and status='published' and audience='customer' and published_customer_id=${uid} and published_at<${cutoff}
    and (coalesce(btrim(data->>'pending'),'')<>'' or coalesce(btrim(data->>'coordination'),'')<>'')
    order by published_at desc,id desc limit 51`);
  const publishedRecordItems: ReportPublishedRecordItem[] = [];
  for (const candidate of candidates.slice(0, 50)) {
    const item = publishedRecordItem(await canRead(String(candidate.id)), start, cutoff);
    if (item) publishedRecordItems.push(item);
  }
  return { itemsCutoffAt: cutoff.toISOString(), itemsPeriodStart: start.toISOString(), publishedRecordItems,
    publishedRecordItemsTruncated: candidates.length > 50 };
}

/** Revalidate saved originals, without adding later publications to an old report. */
export async function customerReportItemsAvailable(project: Partial<CustomerReportItems>, canRead: PublishedRecordAccess) {
  if (!project.itemsCutoffAt || !project.itemsPeriodStart) return !project.publishedRecordItems?.length;
  const start = new Date(project.itemsPeriodStart), cutoff = new Date(project.itemsCutoffAt);
  for (const saved of project.publishedRecordItems || []) {
    const current = publishedRecordItem(await canRead(saved.recordId), start, cutoff);
    if (!current || fingerprint(current) !== fingerprint(saved)) return false;
  }
  return true;
}

/** Select event history at the report's exclusive cutoff, then reuse the live
 * original/source/member guards. Current state is never substituted for history. */
async function reportIssue(tx: PostgresTransaction, eid: string, pid: string, issueId: string, start: Date, cutoff: Date, canRead: RecordAccess): Promise<ReportIssue | null> {
  const opened = await one(tx, sql`select created_at from app.domain_event_outbox where enterprise_id=${eid} and id=${issueId}
    and type='construction.site.issue.opened.v1' and payload->>'projectId'=${pid} and created_at<${cutoff}`);
  if (!opened) return null;
  const issue = await readSiteIssue(tx, eid, pid, issueId, cutoff);
  if (!issue?.sourceAvailable || issue.status === 'invalidated' || (issue.recordId && !await canRead(issue.recordId))
    || await siteAccessRevoked(tx, eid, pid, [issue.openedBy, issue.ownerId].filter(Boolean) as string[], opened.created_at as Date)) return null;
  const last = (await one(tx, sql`select id,created_at from app.domain_event_outbox where enterprise_id=${eid} and created_at<${cutoff}
    and (id=${issueId} or (aggregate_type='construction_site_issue' and aggregate_id=${issueId}
      and type in ('construction.site.issue.progress.v1','construction.site.issue.lifecycle.v1')))
    order by created_at desc,id desc limit 1`))!;
  const carriedOver = new Date(String(last.created_at)) < start;
  if (carriedOver && ['cancelled','resolved','closed'].includes(issue.status)) return null;
  return { id: issueId, revision: issue.revision, status: issue.status, room: issue.roomName,
    ownerId: issue.ownerId, ownerName: issue.ownerName, recordId: issue.recordId, recordVersion: issue.recordVersion,
    sourceHash: issue.sourceHash, eventId: String(last.id), updatedAt: new Date(String(last.created_at)).toISOString(), carriedOver,
    text: issue.text, hash: fingerprint(issue) };
}

async function reportArrangement(tx: PostgresTransaction, eid: string, pid: string, planId: string, start: Date, cutoff: Date, canRead: RecordAccess): Promise<ReportArrangement | null> {
  const plan = await readPlan(tx, eid, planId, cutoff);
  if (!plan || plan.projectId !== pid || plan.status !== 'approved') return null;
  const issue = await readSiteIssueBase(tx, eid, pid, plan.issueId, cutoff);
  if (!issue?.sourceAvailable || (issue.recordId && !await canRead(issue.recordId))) return null;
  const decision = await one(tx, sql`select id,created_at from app.domain_event_outbox where enterprise_id=${eid}
    and type='construction.plan.status.v1' and aggregate_type='construction_plan' and aggregate_id=${planId}
    and created_at<${cutoff} and payload->>'status'='approved' order by aggregate_version desc limit 1`);
  if (!decision) return null;
  return { id: planId, revision: plan.revision, number: plan.number, issueId: plan.issueId, issueRevision: plan.issueRevision,
    title: plan.title, difference: plan.difference, room: plan.roomName, costDeltaCents: plan.costDeltaCents,
    scheduleDeltaDays: plan.scheduleDeltaDays, decisionEventId: String(decision.id), confirmedAt: new Date(String(decision.created_at)).toISOString(),
    carriedOver: new Date(String(decision.created_at)) < start, hash: plan.hash };
}

/** Shared-site matters and customer decisions keep their existing audience.
 * Customer return grants belong to the original consultation, not this private
 * follow-up. Callers must exclude that audience rather than copying its chats. */
export async function collectReportItems(tx: PostgresTransaction, eid: string, pid: string, start: Date, cutoff: Date, canRead: RecordAccess): Promise<ReportItems> {
  const candidates = await rows(tx, sql`select id from app.domain_event_outbox where enterprise_id=${eid}
    and type='construction.site.issue.opened.v1' and payload->>'projectId'=${pid} and created_at<${cutoff}
    order by id desc limit 51`);
  const plans = await rows(tx, sql`select distinct on(aggregate_id) id from app.domain_event_outbox where enterprise_id=${eid}
    and type='construction.plan.published.v1' and payload->>'projectId'=${pid} and created_at<${cutoff}
    order by aggregate_id,aggregate_version desc limit 51`);
  const issues: ReportIssue[] = [], arrangements: ReportArrangement[] = [];
  for (const c of candidates.slice(0, 50)) {
    const issue = await reportIssue(tx, eid, pid, String(c.id), start, cutoff, canRead); if (issue) issues.push(issue);
  }
  for (const c of plans.slice(0, 50)) {
    const plan = await reportArrangement(tx, eid, pid, String(c.id), start, cutoff, canRead); if (plan) arrangements.push(plan);
  }
  return { itemsCutoffAt: cutoff.toISOString(), itemsPeriodStart: start.toISOString(), issues, issuesTruncated: candidates.length > 50,
    arrangements, arrangementsTruncated: plans.length > 50 };
}

/** Recheck the same historical revisions; later ordinary progress neither
 * rewrites the saved report nor authorizes a withdrawn original. */
export async function reportItemsAvailable(tx: PostgresTransaction, eid: string, pid: string, project: Partial<ReportItems>, canRead: RecordAccess) {
  if (!project.itemsCutoffAt || !project.itemsPeriodStart) return !(project.issues?.length || project.arrangements?.length);
  const cutoff = new Date(project.itemsCutoffAt), start = new Date(project.itemsPeriodStart);
  for (const issue of project.issues || []) {
    const current = await reportIssue(tx, eid, pid, issue.id, start, cutoff, canRead);
    if (!current || fingerprint(current) !== fingerprint(issue)) return false;
  }
  for (const plan of project.arrangements || []) {
    const current = await reportArrangement(tx, eid, pid, plan.id, start, cutoff, canRead);
    if (!current || fingerprint(current) !== fingerprint(plan)) return false;
  }
  return true;
}
