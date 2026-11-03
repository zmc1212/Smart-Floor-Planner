import { fail } from '../contracts';
import type { BusinessSnapshot } from './business-tools';
import type { ReportProject } from '@/lib/construction/report-scope';
import type { SynthesisSource } from './synthesis';
import { siteRecordText, type SiteDraft } from '@/lib/construction/site-contract';
import { reportLocalTime } from './report-time';

export const reportAnswerGroundingProtocol = 'report-answer-grounding-v1';
export type ReportSourceScope = {
  protocol: typeof reportAnswerGroundingProtocol;
  reportId: string; revision: number; factsHash: string; projectId: string; cutoffAt: string;
  kind: 'metadata' | 'stage' | 'record' | 'published_pending' | 'issue' | 'arrangement';
  itemId?: string; itemVersion?: number; sourceHash?: string;
  room: { status: 'recorded'; name: string } | { status: 'unspecified' };
};

/** Admission pins the consumption/review mechanism. Absence on an old run is
 * deliberate: a resume must not silently replace its source IDs or validator. */
export function boundReportAnswerGrounding(value: unknown, native: boolean) {
  if (value === undefined) return false;
  if (!native || value !== reportAnswerGroundingProtocol) fail('context_changed');
  return true;
}

/** Read projection of the SAME authorized immutable report snapshot. Metadata
 * and each original have independent citation spans and explicit scope; a
 * user's room correction cannot supply a missing room on a published record. */
export function scopedReportSynthesisSources(resultKey: string, snapshot: BusinessSnapshot): SynthesisSource[] | null {
  if (!('reportAnswerGrounding' in snapshot) || snapshot.reportAnswerGrounding === undefined) return null;
  if (snapshot.reportAnswerGrounding !== reportAnswerGroundingProtocol || !snapshot.reportReference) fail('context_changed');
  const selection = snapshot.reportReference.selection;
  const projects = snapshot.data as ReportProject[];
  if (projects.length !== 1 || String(projects[0].id) !== selection.projectId) fail('context_changed');
  const project = projects[0];
  const common = { protocol: reportAnswerGroundingProtocol, reportId: selection.reportId, revision: selection.revision,
    factsHash: selection.factsHash, projectId: selection.projectId, cutoffAt: selection.cutoffAt } as const;
  const source = (key: string, title: string, text: string, kind: ReportSourceScope['kind'], room = '',
    item?: Pick<ReportSourceScope, 'itemId' | 'itemVersion' | 'sourceHash'>): SynthesisSource => ({
    sourceId: `B${resultKey}:${key}`, kind: 'project', title, summaryTitle: title, text, resultKey,
    reportScope: { ...common, kind, ...item, room: room ? { status: 'recorded', name: room } : { status: 'unspecified' } },
  });
  const roomText = (room: string) => room ? `原记录明确房间：${room}。` : '原记录未注明房间，不能据此确定对应哪个房间。';
  const sources = [source('metadata', '原报告周期与事实截止',
    `报告所选项目：${project.name}。报告周期：${reportLocalTime(selection.periodStart)}至${reportLocalTime(selection.periodEnd)}；事实截止：${reportLocalTime(selection.cutoffAt)}。\n`
    + '这是原报告的统计范围，不是当前施工状态、完成期限或安装排期。截止后变化须另查当前原服务。用户后续补充是用户原话，不是团队核对、工程决定或原报告更改。'
    + (!project.records.length ? '\n本期未提供可见的已发布现场记录，未记录不等于未施工。' : '')
    + (project.recordsTruncated || project.issuesTruncated || project.arrangementsTruncated || project.publishedRecordItemsTruncated
      ? '\n本次原报告的部分记录有截断，未列出不表示现实不存在。' : ''), 'metadata'),
  source('stage', '原报告保存时的团队阶段标记',
    `报告保存时团队标记阶段：${project.stageKey || '尚未标记'}。这不是当前施工状态或验收结论。`, 'stage')];
  for (const record of project.records) sources.push(source(`record:${record.id}:${record.version}`, '报告中的已发布现场原记录',
    `团队核对发布的原记录${record.id}（版本${record.version}，${record.publishedAt}）：\n${roomText(record.room)}\n`
    + siteRecordText(record.data as SiteDraft, record.room), 'record', record.room,
    { itemId: record.id, itemVersion: record.version, sourceHash: record.hash }));
  for (const item of project.publishedRecordItems || []) sources.push(source(`pending:${item.recordId}:${item.recordVersion}`, '报告中的原记录待核对项',
    `原记录${item.recordId}（版本${item.recordVersion}）的已发布待核对内容：\n${roomText(item.room)}\n`
    + [item.pending, item.coordination].filter(Boolean).join('\n'), 'published_pending', item.room,
    { itemId: item.recordId, itemVersion: item.recordVersion, sourceHash: item.sourceHash }));
  for (const issue of project.issues || []) sources.push(source(`issue:${issue.id}:${issue.revision}`, '报告截止时的原事项',
    `事项${issue.id}（版本${issue.revision}）：\n${roomText(issue.room)}\n${issue.text}`, 'issue', issue.room,
    { itemId: issue.id, itemVersion: issue.revision, sourceHash: issue.hash }));
  for (const arrangement of project.arrangements || []) sources.push(source(`arrangement:${arrangement.id}:${arrangement.revision}`, '报告截止时的原安排',
    `安排${arrangement.id}（版本${arrangement.revision}）：\n${roomText(arrangement.room)}\n${arrangement.title}\n${arrangement.difference}`,
    'arrangement', arrangement.room, { itemId: arrangement.id, itemVersion: arrangement.revision, sourceHash: arrangement.hash }));
  return sources;
}
