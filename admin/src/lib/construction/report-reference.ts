import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, id, principalKey, type ActorContext } from '@/lib/assistant/contracts';
import { followupAvailable, projectReportFacts, type ReportFacts } from './report-scope';

export const reportContextProtocol = 'explicit-report-context-v1';
/** Reception consent shares conversation messages, not the recipient's private
 * report grant. Includes replies restored from an ancestor report snapshot. */
export const privateReportReply = sql`exists(select 1 from app.assistant_run_steps report_step
  where report_step.enterprise_id=app.assistant_messages.enterprise_id and report_step.run_id=app.assistant_messages.run_id
  and (report_step.private_checkpoint->'snapshot' ? 'reportReference'
    or jsonb_path_exists(coalesce(report_step.private_checkpoint,'{}'::jsonb),'$.snapshots[*].reportReference')
    or jsonb_path_exists(coalesce(report_step.source_refs,'{}'::jsonb),'$.snapshots[*].reportReference')))`;
export type ReportChoice = { bindingId: string; reportId: string; revision: number; projectId: string };
export type ReportReference = ReportChoice & { conversationId: string; kind: string; periodStart: string; periodEnd: string; cutoffAt: string; factsHash: string };
export type ReportContext = { protocol: typeof reportContextProtocol; revision: number; selection: ReportReference | null };
export function reportChoice(value: unknown): ReportChoice {
  const v = value as ReportChoice;
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !['bindingId','reportId','revision','projectId'].includes(k))
    || !Number.isSafeInteger(v.revision) || v.revision < 1) fail('invalid_message', 422);
  return { bindingId: id(v.bindingId), reportId: id(v.reportId), revision: v.revision, projectId: id(v.projectId) };
}
export function reportContext(entry: unknown): ReportContext {
  const v = (entry as Row | undefined)?.reportContext as ReportContext | undefined;
  return v?.protocol === reportContextProtocol && Number.isSafeInteger(v.revision) && v.revision >= 0
    ? v : { protocol: reportContextProtocol, revision: 0, selection: null };
}
/** A locator is not a grant. Use the same recipient binding and original-fact
 * projection as report reads; never consume a model's saved report as facts. */
export async function resolveReportReference(tx: PostgresTransaction, actor: ActorContext, choice: ReportChoice, expected?: ReportReference) {
  const b = await one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${actor.enterpriseId}
    and id=${choice.bindingId} and principal_key=${principalKey(actor)} and status<>'deleted'
    and ${actor.principal.kind === 'user' ? sql`audience='customer'` : sql`audience in ('worker','designer','boss')`} for share`);
  if (!b || !await followupAvailable(tx, actor.enterpriseId, b)) return null;
  const r = await one(tx, sql`select r.kind,r.period_start,v.period_end,v.cutoff_at,v.generated_at,v.facts,v.facts_hash
    from app.construction_reports r join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id
    join app.assistant_runs run on run.enterprise_id=v.enterprise_id and run.id=v.run_id
    where r.enterprise_id=${actor.enterpriseId} and r.binding_id=${choice.bindingId} and r.id=${choice.reportId}
    and v.revision=${choice.revision} and v.status='facts_ready' and run.status='succeeded'
    and run.conversation_id=${String(b.conversation_id)}`);
  if (!r) return null;
  const facts = await projectReportFacts(tx, actor.enterpriseId, b, r.facts as ReportFacts, new Date(String(r.generated_at)));
  const project = facts.projects.find(p => p.id === choice.projectId);
  if (!project) return null;
  const p = await one(tx, sql`select lead_id from app.construction_projects where enterprise_id=${actor.enterpriseId} and id=${choice.projectId}`);
  if (!p?.lead_id) return null;
  const iso = (v: unknown) => new Date(String(v)).toISOString();
  const selection: ReportReference = { bindingId: choice.bindingId, reportId: choice.reportId, revision: choice.revision, projectId: choice.projectId,
    conversationId: String(b.conversation_id), kind: String(r.kind), periodStart: iso(r.period_start),
    periodEnd: iso(r.period_end), cutoffAt: iso(r.cutoff_at), factsHash: fingerprint({ saved: r.facts_hash, project }) };
  if (expected && fingerprint(expected) !== fingerprint(selection)) return null;
  return { selection, project, leadId: String(p.lead_id) };
}
export async function selectedReport(tx: PostgresTransaction, actor: ActorContext, c: Row) {
  const stored = reportContext(c.entry_snapshot);
  if (!stored.selection || (c.entry_snapshot as Row)?.retentionRedacted) return null;
  const resolved = await resolveReportReference(tx, actor, stored.selection, stored.selection);
  if (!resolved || c.purpose === 'construction_followup' && resolved.selection.conversationId !== String(c.id)
    || (c.entry_snapshot as Row)?.kind === 'lead' && String((c.entry_snapshot as Row).id) !== resolved.leadId) return null;
  return resolved;
}
export async function reportContextView(tx: PostgresTransaction, actor: ActorContext, c: Row) {
  const stored = reportContext(c.entry_snapshot), resolved = await selectedReport(tx, actor, c);
  return { conversationId: String(c.id), version: stored.revision, invalidated: !!stored.selection && !resolved, topicAvailable: actor.principal.kind === 'user',
    selected: resolved ? { ...resolved.selection, projectName: resolved.project.name,
      summary: resolved.project.records.find(r => r.data.pending || r.data.coordination)?.data.pending
        || resolved.project.records.find(r => r.data.coordination)?.data.coordination || '' } : null };
}
