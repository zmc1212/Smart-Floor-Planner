import { fingerprint } from '@/lib/assistant/contracts';
import { issueStatusLabel } from '@/lib/xiaok-v1/progress-status';
import { weeklyProjectStageName } from '@/lib/xiaok-v1/weekly-report-service';
import type { FollowupAudience, ReportFacts, ReportProject, WeeklyScheduleFacts } from './report-scope';

const periodDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
});
const cutoffTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const titles: Record<FollowupAudience, string> = {
  customer: '我家施工', designer: '项目设计', worker: '施工跟进', boss: '企业工地',
};
const openIssues = new Set([
  'awaiting_verification', 'awaiting_rectification', 'awaiting_owner', 'rectifying', 'reopened', 'awaiting_review', 'implemented',
]);

export function reportDateKey(value: Date | string) {
  const date = new Date(value);
  return Number.isFinite(+date) ? periodDate.format(date) : '';
}

export function reportDateRange(start: string, end: string) {
  const date = start.replaceAll('-', '.');
  const last = (start.slice(0, 4) === end.slice(0, 4) ? end.slice(5) : end).replaceAll('-', '.');
  return start && end && start !== end ? `${date}—${last}` : date || last;
}

export function reportText(text: unknown) {
  return typeof text === 'string' ? text.replace(/\s+/gu, ' ').trim() : '';
}

export function reportRecordLine(project: string, room: string, text: string) {
  const detail = text.startsWith(project) ? text.slice(project.length).replace(/^[ ·：:]+/u, '') || text : text;
  return !room || detail.startsWith(room) ? detail : `${room} · ${detail}`;
}

export function reportProgressLine(project: ReportProject, kind: 'daily' | 'weekly') {
  const latest = [...project.records].reverse().find(record => reportText(record.data?.completed));
  if (latest) return reportRecordLine(project.name, reportText(latest.room), reportText(latest.data.completed));
  const period = kind === 'weekly' ? '本周' : '当日';
  return project.records.length ? `${period}有 ${project.records.length} 条现场记录。` : `${period}暂无新现场记录。`;
}

export function nextReportScheduleNode(plan: WeeklyScheduleFacts | undefined, reportEnd: string) {
  if (!plan?.available || !reportEnd) return undefined;
  const nextWeek = reportDateKey(new Date(Date.parse(`${reportEnd}T00:00:00+08:00`) + 7 * 86_400_000));
  return plan.nodes.filter(node => node.completion !== 'completed' && node.plannedStart > reportEnd && node.plannedStart <= nextWeek)
    .sort((left, right) => left.plannedStart.localeCompare(right.plannedStart))[0];
}

function excerpt(text: string) {
  const characters = Array.from(text);
  return characters.length > 76 ? characters.slice(0, 75).join('').trimEnd() + '…' : text;
}

function projectSummary(project: ReportProject, kind: 'daily' | 'weekly', audience: FollowupAudience, lastDay: string) {
  const issues = (project.issues || []).filter(issue => openIssues.has(issue.status));
  const plan = audience === 'boss' && kind === 'weekly' ? project.weekSchedule : undefined;
  const late = plan?.available ? plan.nodes.find(node => node.color === 'red' && node.completion !== 'completed') : undefined;
  const publishedNotes = project.publishedRecordItems || [];
  const published = publishedNotes.at(0);
  const record = published ? undefined : [...project.records].reverse().find(({ data }) => reportText(data?.coordination) || reportText(data?.pending));
  const note = published || record?.data;
  const pendingText = reportText(note?.coordination) || reportText(note?.pending);
  const pendingRoom = published?.room || record?.room || '';
  const issue = issues.find(item => reportText(item.text));
  const attention = late ? `计划落后 · ${late.roomName}${late.stageName}` : issue
    ? [issueStatusLabel(issue.status), reportRecordLine(project.name, issue.room, reportText(issue.text)), issue.ownerName].filter(Boolean).join(' · ')
    : pendingText ? `待跟进 · ${reportRecordLine(project.name, pendingRoom, pendingText)}` : '';
  const arrangement = [...(project.arrangements || [])].sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt))[0];
  const confirmed = arrangement ? [reportText(arrangement.title), reportText(arrangement.difference)].filter(Boolean).join(' · ') : '';
  const next = confirmed ? undefined : nextReportScheduleNode(plan, lastDay);
  const nextPlan = next ? `下周计划 · ${next.plannedStart.slice(5).replace('-', '/')} ${next.roomName}${next.stageName}` : '';
  return {
    row: { id: project.id, name: project.name, stage: weeklyProjectStageName(project), progress: excerpt(reportProgressLine(project, kind)),
      attention: excerpt(attention), arrangement: confirmed ? '已确认安排 · ' + excerpt(confirmed) : excerpt(nextPlan) },
    intervention: audience === 'customer' ? publishedNotes.length : issues.length + Number(Boolean(late)),
  };
}

export function buildReportReading(input: { kind: 'daily' | 'weekly'; audience: FollowupAudience; facts: ReportFacts;
  periodStart: Date | string; periodEnd: Date | string; cutoffAt: Date | string; projectId?: string }) {
  const { kind, audience, facts, projectId } = input;
  const weekly = kind === 'weekly', start = reportDateKey(input.periodStart), cutoffDay = reportDateKey(input.cutoffAt);
  const cutoff = cutoffDay ? (cutoffDay === start ? '' : cutoffDay.slice(5).replace('-', '/') + ' ') + cutoffTime.format(new Date(input.cutoffAt)) : '';
  const lastDay = reportDateKey(new Date(+new Date(input.periodEnd) - 1));
  const projects = projectId ? facts.projects.filter(project => project.id === projectId) : facts.projects;
  const summaries = projects.map(project => projectSummary(project, kind, audience, lastDay));
  const truncated = !projectId && facts.projectsTruncated;
  const issueCoverage = projects.every(project => audience === 'customer'
    ? Array.isArray(project.publishedRecordItems) && !project.publishedRecordItemsTruncated
    : Array.isArray(project.issues) && !project.issuesTruncated);
  const intervention = summaries.reduce((total, summary) => total + summary.intervention, 0);
  const count = (value: number) => (truncated ? '≥' : '') + value;
  const waiting = weekly && audience === 'boss' ? projects.filter(project => !project.weekSchedule?.available).length : 0;
  const reading = {
    title: titles[audience] + (weekly ? '周报' : '日报'),
    period: weekly ? reportDateRange(start, lastDay) : [start.replaceAll('-', '.'), cutoff && '截至' + cutoff].filter(Boolean).join(' · '),
    section: weekly ? '本周工地进展' : '当日工地进展',
    stats: [
      { label: '在建工地', value: count(projects.length) },
      { label: '有现场更新', value: count(projects.filter(project => project.records.length > 0).length) },
      { label: audience === 'customer' ? '待沟通' : audience === 'boss' ? '需介入' : '待跟进',
        value: issueCoverage ? count(intervention) : intervention ? '≥' + intervention : '—' },
    ],
    notices: [waiting ? `${waiting} 个工地排期待核实` : '', truncated ? '本份简报未包含全部工地' : ''].filter(Boolean),
    projects: summaries.map(summary => summary.row),
  };
  return { ...reading, key: fingerprint(reading) };
}

export type ReportReading = ReturnType<typeof buildReportReading>;
