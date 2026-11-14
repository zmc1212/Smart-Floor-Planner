import type { Row } from '@/db/repositories/assistant-repository';
import type { ReportFacts, ReportProject, WeeklyScheduleFacts } from '@/lib/construction/report-scope';
import type { ReportIssue } from '@/lib/construction/report-items';
import { stageDefinitions, stageIdForConstructionKey } from './stages';
import { buildWeeklyDigest, type WeeklyProjectFacts, type WeeklyReportDigest, type WeeklyReportRole, type WeeklyIssue } from './weekly-report';

export type WeeklyReportSource = {
  id: string;
  revision: number;
  period_start: Date | string;
  period_end: Date | string;
  generated_at: Date | string | null;
  facts_hash: string | null;
  delivery_state?: string | null;
};

const roleForAudience: Record<string, WeeklyReportRole> = {
  customer: 'owner', designer: 'designer', boss: 'boss', worker: 'worker',
};

const constructionKeys = (stage: typeof stageDefinitions[number]) => stage.constructionKeys as readonly string[];

function nextStageName(stageKey: string | null) {
  const index = stageKey ? stageDefinitions.findIndex(stage => constructionKeys(stage).includes(stageKey)) : -1;
  return index >= 0 && index < stageDefinitions.length - 1 ? stageDefinitions[index + 1].name : null;
}

function stageNameOf(project: ReportProject) {
  if (!project.stageKey) return null;
  if (project.weekStageNames?.[project.stageKey]) return project.weekStageNames[project.stageKey];
  return project.stageName || stageDefinitions.find(stage => constructionKeys(stage).includes(project.stageKey!))?.name || null;
}

function planOf(schedule: WeeklyScheduleFacts | undefined): WeeklyProjectFacts['plan'] {
  if (!schedule) return null;
  return {
    available: schedule.available, version: schedule.version, color: schedule.color, label: schedule.label,
    nodes: schedule.nodes.map(node => ({
      key: node.key, roomName: node.roomName, stageName: node.stageName,
      color: node.color, label: node.label, plannedStart: node.plannedStart, plannedEnd: node.plannedEnd,
      completion: node.completion, completedAt: null,
    })),
  };
}

function issueOf(issue: ReportIssue): WeeklyIssue {
  return { id: issue.id, status: issue.status, title: issue.text, room: issue.room, createdAt: issue.createdAt,
    ownerName: issue.ownerName || null };
}

function customerIssues(project: ReportProject): WeeklyIssue[] {
  return (project.publishedRecordItems || []).flatMap(item => ['pending', 'coordination']
    .filter(field => item[field as 'pending' | 'coordination'])
    .map(field => ({ id: item.recordId + ':' + field, status: 'awaiting_verification',
      title: item[field as 'pending' | 'coordination'], room: item.room, createdAt: item.publishedAt })));
}

function pendingFor(role: WeeklyReportRole, issues: ReportIssue[], recipientId: string) {
  const assigned = issues.filter(issue => issue.ownerId === recipientId);
  return {
    ownerConfirmations: [] as Array<{ id: string; title: string }>,
    designerReviews: role === 'designer' ? assigned.filter(issue => ['awaiting_verification', 'awaiting_rectification'].includes(issue.status))
      .map(issue => ({ id: issue.id, title: issue.text })) : [],
    workerTasks: role === 'worker' ? assigned.filter(issue => !['closed', 'dismissed', 'cancelled'].includes(issue.status))
      .map(issue => ({ id: issue.id, title: issue.text })) : [],
    missingMaterials: role === 'worker' ? assigned.filter(issue => !['closed', 'dismissed', 'cancelled'].includes(issue.status)
      && /资料|照片|补|材料|上传/u.test(issue.text)).map(issue => ({ id: issue.id, title: issue.text })) : [],
  };
}

/** Project one immutable weekly report fact snapshot into the role-specific
 * digest. This adds no second report runtime and no second fact store. */
export function buildRoleWeeklyDigest(input: {
  facts: ReportFacts; binding: Row; report: WeeklyReportSource;
}): WeeklyReportDigest | null {
  const role = roleForAudience[String(input.binding.audience)];
  if (!role || !Array.isArray(input.facts.projects) || !input.facts.projects.length) return null;
  const recipientId = String(input.binding.user_id || input.binding.admin_id || '');
  if (!/^[1-9]\d*$/u.test(recipientId)) return null;
  const projects: WeeklyProjectFacts[] = input.facts.projects.map(project => {
    const stageId = stageIdForConstructionKey(project.stageKey);
    const stageEvent = [...(project.stageEvents || [])].reverse().find(event => event.stageKey === project.stageKey);
    const issues = role === 'owner' ? [] : (project.issues || []);
    return {
      projectId: project.id, projectName: project.name,
      stageId, stageKey: project.stageKey, stageName: stageNameOf(project),
      stageEnteredAt: stageEvent?.at ?? null, stageEventId: stageEvent?.id ?? null,
      nextStageName: nextStageName(project.stageKey),
      plan: planOf(project.weekSchedule),
      records: (project.records || []).map(record => ({
        id: record.id, version: record.version, room: record.room, publishedAt: record.publishedAt,
        completed: String((record.data as Row)?.completed || ''),
        pending: String((record.data as Row)?.pending || ''),
        coordination: String((record.data as Row)?.coordination || ''),
      })),
      issues: role === 'owner' ? customerIssues(project) : issues.map(issueOf),
      arrangements: (project.arrangements || []).map(item => ({ id: item.id, title: item.title, room: item.room, confirmedAt: item.confirmedAt })),
      pending: role === 'owner'
        ? { ownerConfirmations: (project.publishedRecordItems || []).filter(item => item.coordination?.trim())
          .map(item => ({ id: item.recordId, title: item.coordination })), designerReviews: [], workerTasks: [], missingMaterials: [] }
        : pendingFor(role, issues, recipientId),
    };
  });
  const delivery = ({ delivered: 'delivered', pending: 'pending', held: 'pending', revoked: 'revoked', muted: 'muted' } as const)
    [String(input.report.delivery_state || 'pending') as 'delivered' | 'pending' | 'held' | 'revoked' | 'muted'] || 'pending';
  return buildWeeklyDigest({
    enterpriseId: String(input.binding.enterprise_id), role, recipientId,
    periodStart: new Date(String(input.report.period_start)).toISOString(),
    periodEnd: new Date(String(input.report.period_end)).toISOString(),
    generatedAt: String(input.report.generated_at || new Date().toISOString()),
    projects, reportId: String(input.report.id), reportVersion: Number(input.report.revision),
    sourceSnapshotVersion: /^[a-f0-9]{64}$/u.test(String(input.report.facts_hash || '')) ? String(input.report.facts_hash) : undefined,
    deliveryStatus: delivery,
  });
}
