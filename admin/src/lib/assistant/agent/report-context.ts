import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, type ActorContext } from '../contracts';
import { reportContext, resolveReportReference, selectedReport, type ReportReference } from '@/lib/construction/report-reference';
import { siteRecordText, type SiteDraft } from '@/lib/construction/site-contract';
import type { ReportProject } from '@/lib/construction/report-scope';
import type { BusinessSnapshot } from './business-tools';

export type ReportBusinessReference = { selection: ReportReference; userId: string };
export const reportContextStep = 740;
export function reportFactText(selection: ReportReference, project: ReportProject) {
  return `报告所选项目：${project.name}。报告周期：${selection.periodStart}至${selection.periodEnd}；事实截止：${selection.cutoffAt}（Asia/Shanghai）。\n`
    + `报告保存时团队标记阶段：${project.stageKey || '尚未标记'}。这不是当前施工状态或验收结论。\n`
    + project.records.map(r => `团队核对发布的原记录${r.id}（版本${r.version}，${r.publishedAt}）：\n${siteRecordText(r.data as SiteDraft, r.room)}`).join('\n')
    + (!project.records.length ? '\n本期无可见的已发布记录，未记录不等于未施工。' : '')
    + (project.publishedRecordItems?.length ? '\n原记录中的待核对项：\n' + project.publishedRecordItems.map(r => [r.pending, r.coordination].filter(Boolean).join('\n')).join('\n') : '')
    + '\n本报告尚未生成企业工艺说明。用户后续补充是用户原话，不是团队核对、工程决定或原报告更改。截止后变化须另查当前原服务，不把旧报告当成最新事实。';
}
export async function reportBusinessAvailable(tx: PostgresTransaction, enterpriseId: string, ref: ReportBusinessReference) {
  return !!await resolveReportReference(tx, { enterpriseId, principal: { kind: 'user', userId: ref.userId }, contextVersion: 0, capabilities: [] }, ref.selection, ref.selection);
}
/** Use the original durable business snapshot/catalog. No report prose is a
 * fact source and no additional model, retriever or citation store is created. */
export async function boundReportContext(tx: PostgresTransaction, actor: ActorContext, conversation: Row, runId: string) {
  if (!reportContext(conversation.entry_snapshot).selection) return null;
  const resolved = await selectedReport(tx, actor, conversation);
  if (!resolved || actor.principal.kind !== 'user') fail('context_changed');
  const previous = await one(tx, sql`select private_checkpoint from app.assistant_run_steps where enterprise_id=${actor.enterpriseId}
    and run_id=${runId} and step_seq=${reportContextStep}`);
  const resultKey = 'report:' + runId;
  const snapshot: BusinessSnapshot = { query: { domain: 'construction', leadId: resolved.leadId }, customerId: actor.principal.userId,
    leadIds: [resolved.leadId], version: resolved.selection.factsHash, queriedAt: resolved.selection.cutoffAt,
    reportReference: { selection: resolved.selection, userId: actor.principal.userId },
    data: [{ ...resolved.project, projectId: resolved.project.id, leadId: resolved.leadId }],
    displayText: reportFactText(resolved.selection, resolved.project) };
  const saved = previous?.private_checkpoint as { resultKey: string; snapshot: BusinessSnapshot } | undefined;
  if (saved && fingerprint(saved) !== fingerprint({ resultKey, snapshot })) fail('context_changed');
  if (!saved) await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,capability_name,capability_version,status,private_checkpoint,input_summary)
    values(${actor.enterpriseId},${runId},${reportContextStep},'agent_source','synthesis.bound_construction.v1',1,'succeeded',
      ${JSON.stringify({ resultKey, snapshot })}::jsonb,'{"scope":"explicit_report_originals","protocol":"explicit-report-context-v1"}'::jsonb)`);
  return { resultKey, snapshot };
}
