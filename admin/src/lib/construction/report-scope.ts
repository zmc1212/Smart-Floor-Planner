import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fingerprint, type ActorContext } from '@/lib/assistant/contracts';
import { currentRecord } from './site-issues';
import { publishedSiteRecord } from './site-publications';
import { siteAccessRevoked } from './site-access';

export type FollowupAudience = 'customer' | 'worker' | 'designer' | 'boss';
export type ReportRecord = { id: string; version: number; hash: string; publishedAt: string; room: string; data: Row };
export type ReportProject = { id: string; name: string; stageKey: string | null; progressRevision: number;
  stageEvents: Array<{ id: string; revision: number; stageKey: string; at: string }>;
  stageEventsTruncated: boolean; records: ReportRecord[]; recordsTruncated: boolean; noPublishedRecords: boolean };
export type ReportFacts = { protocol: 'construction-report-facts-v1'; projects: ReportProject[]; projectsTruncated: boolean;
  knowledgeStatus: 'not_generated'; arrangementsStatus: 'not_aggregated'; issuesStatus: 'not_aggregated' };

/** Server-only routing actor. HTTP assembly must use followup.self plus its
 * existing signed Mini/Web identity; this capability never comes from input. */
export function deliveryActor(eid: string, binding: Row): ActorContext {
  return { enterpriseId: eid, principal: binding.user_id ? { kind: 'user', userId: String(binding.user_id) }
    : { kind: 'admin', adminId: String(binding.admin_id) }, contextVersion: 0, capabilities: ['assistant.followup.delivery'] };
}
/** Retention redacts the conversation, not the underlying construction record.
 * A saved report must never rehydrate that conversation's removed content. */
export async function followupAvailable(tx: PostgresTransaction, eid: string, binding: Row) {
  return !!(await one(tx, sql`select app.assistant_followup_conversation_access(
    ${binding.user_id ? 'user' : 'admin'},${String(binding.user_id || binding.admin_id)}::bigint,${eid}::bigint,${String(binding.conversation_id)}::bigint) as allowed
    from app.assistant_conversations c where c.enterprise_id=${eid} and c.id=${String(binding.conversation_id)}
    and coalesce(c.entry_snapshot->>'retentionRedacted','false')<>'true'`))?.allowed;
}
export async function followupProjects(tx: PostgresTransaction, eid: string, binding: Row, activeOnly = false, projectIds: string[] = [], stageKeys: string[] = []) {
  if (!await followupAvailable(tx, eid, binding)) return [];
  return rows(tx, sql`select p.* from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where p.enterprise_id=${eid} and p.status${activeOnly ? sql`='active'` : sql`<>'archived'`} and l.archived_at is null
    and (jsonb_array_length(${JSON.stringify(projectIds)}::jsonb)=0 or ${JSON.stringify(projectIds)}::jsonb ? p.id::text)
    and (jsonb_array_length(${JSON.stringify(stageKeys)}::jsonb)=0 or ${JSON.stringify(stageKeys)}::jsonb ? p.current_stage_key)
    and (${binding.audience === 'boss'} or
      (${binding.audience === 'customer'} and p.id=${binding.project_id ? String(binding.project_id) : null} and p.customer_access and l.customer_user_id=${binding.user_id ? String(binding.user_id) : null}) or
      (${['worker','designer'].includes(String(binding.audience))} and exists(select 1 from app.construction_members m
        where m.enterprise_id=p.enterprise_id and m.project_id=p.id and m.admin_id=${binding.admin_id ? String(binding.admin_id) : null} and m.active)))
    order by p.id limit 21 for share of p,l`);
}
async function accessibleRecord(tx: PostgresTransaction, eid: string, binding: Row, pid: string, rid: string) {
  const record = await currentRecord(tx, eid, pid, rid, true);
  if (!record || record.row.status !== 'published') return null;
  const r = record.row;
  if (binding.audience === 'customer' && !await publishedSiteRecord(tx, eid, String(binding.user_id), rid, Number(r.published_version), true)) return null;
  const authors = [r.author_id, r.approved_by].filter(Boolean).map(String);
  if (await siteAccessRevoked(tx, eid, pid, authors, new Date(String(r.published_at)), { reviewers: r.approved_by ? [String(r.approved_by)] : [] })) return null;
  return record;
}
/** Facts are selected for one private recipient before serialization, never
 * generated enterprise-wide and then hidden in a client. Published time is the
 * recorded-time boundary; it is not a claim about when construction occurred. */
export async function collectReportFacts(tx: PostgresTransaction, eid: string, binding: Row, report: Row, settings: Row): Promise<ReportFacts> {
  const projectIds = settings.project_ids as string[], stageKeys = settings.stage_keys as string[];
  const projects = (await followupProjects(tx, eid, binding, true, projectIds, stageKeys))
    .filter(p => !report.stage_event_id || String(p.id) === String((report.stage_event as Row)?.aggregate_id));
  const result: ReportProject[] = [];
  for (const p of projects.slice(0, 20)) {
    const pid = String(p.id);
    const candidates = report.kind === 'stage' ? [] : await rows(tx, sql`select r.id from app.construction_site_records r
      where r.enterprise_id=${eid} and r.project_id=${pid} and r.status='published' and r.published_at>=${report.period_start as Date}
      and r.published_at<${report.period_end as Date}
      and (${binding.audience !== 'customer'} or (r.audience='customer' and r.published_customer_id=${binding.user_id ? String(binding.user_id) : null}))
      order by r.published_at,r.id limit 51`);
    const records: ReportRecord[] = [];
    for (const candidate of candidates.slice(0, 50)) {
      const source = await accessibleRecord(tx, eid, binding, pid, String(candidate.id));
      if (!source) continue;
      const r = source.row;
      records.push({ id: String(r.id), version: Number(r.published_version), hash: source.hash,
        publishedAt: new Date(String(r.published_at)).toISOString(), room: String(r.room_name_snapshot), data: r.data as Row });
    }
    const events = await rows(tx, sql`select id,aggregate_version,payload,created_at from app.domain_event_outbox
      where enterprise_id=${eid} and type='construction.stage.updated.v1' and aggregate_id=${pid}
      and created_at<=${report.cutoff_at as Date} order by aggregate_version desc limit 31`);
    const latest = events[0], stageKey = latest ? String((latest.payload as Row).stageKey) : null;
    // Unknown history stays unknown; the current stage must not rewrite an old period.
    result.push({ id: pid, name: String(p.name), stageKey, progressRevision: Number(latest?.aggregate_version || 0),
      stageEvents: events.slice(0, 30).filter(e => new Date(String(e.created_at)) >= new Date(String(report.period_start))).reverse().map(e => ({
        id: String(e.id), revision: Number(e.aggregate_version), stageKey: String((e.payload as Row).stageKey), at: new Date(String(e.created_at)).toISOString() })),
      stageEventsTruncated: events.length > 30, records, recordsTruncated: candidates.length > 50, noPublishedRecords: records.length === 0 });
  }
  return { protocol: 'construction-report-facts-v1', projects: result, projectsTruncated: projects.length > 20,
    knowledgeStatus: 'not_generated', arrangementsStatus: 'not_aggregated', issuesStatus: 'not_aggregated' };
}
/** Revalidate originals and current relationships on every read and delivery.
 * No stored project title, count or summary escapes a revoked section. */
export async function projectReportFacts(tx: PostgresTransaction, eid: string, binding: Row, facts: ReportFacts, generatedAt: Date): Promise<ReportFacts> {
  const allowed = new Set((await followupProjects(tx, eid, binding, false, facts.projects.map(p => p.id))).map(p => String(p.id)));
  const projects: ReportProject[] = [];
  for (const p of facts.projects) {
    if (!allowed.has(p.id)) continue;
    if (binding.admin_id && await siteAccessRevoked(tx, eid, p.id, [String(binding.admin_id)], generatedAt)) continue;
    const records: ReportRecord[] = [];
    for (const r of p.records) {
      const current = await accessibleRecord(tx, eid, binding, p.id, r.id);
      if (current && Number(current.row.published_version) === r.version && current.hash === r.hash) records.push(r);
    }
    // A withdrawn original invalidates this saved section rather than silently
    // presenting a different historical report. Corrections create a new version.
    if (records.length !== p.records.length) continue;
    projects.push(p);
  }
  return { ...facts, projects, projectsTruncated: projects.length === facts.projects.length && facts.projectsTruncated };
}
export const reportFactsHash = (facts: ReportFacts) => fingerprint(facts);
