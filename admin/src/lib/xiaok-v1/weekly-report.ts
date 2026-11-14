import { createHash } from 'node:crypto';
import { z } from 'zod';
import { issueStatusLabels, type PlanColor } from './progress-status';

export const weeklyReportRoles = ['owner', 'designer', 'boss', 'worker'] as const;
export type WeeklyReportRole = typeof weeklyReportRoles[number];
export const weeklyReportRoleLabels: Record<WeeklyReportRole, string> = {
  owner: '业主周报', designer: '设计师周报', boss: '公司老板周报', worker: '施工人员周报',
};

export const weeklySourceRefSchema = z.strictObject({
  refId: z.string().min(1),
  kind: z.enum(['stage_event', 'plan_node', 'record', 'issue', 'pending_item', 'arrangement']),
  projectId: z.string().nullable(),
  entityId: z.string().min(1),
  version: z.number().int().nonnegative().nullable(),
});
export type WeeklySourceRef = z.infer<typeof weeklySourceRefSchema>;

export const weeklyReportContractSchema = z.strictObject({
  reportId: z.string().min(1),
  reportType: z.literal('weekly'),
  enterpriseId: z.string().min(1),
  projectId: z.string().nullable(),
  recipientId: z.string().min(1),
  recipientRole: z.enum(weeklyReportRoles),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  sourceSnapshotVersion: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceRefs: z.array(weeklySourceRefSchema),
  generatedAt: z.string().min(1),
  reportVersion: z.number().int().positive(),
  deliveryStatus: z.enum(['pending', 'delivered', 'failed', 'muted', 'revoked']),
});
export type WeeklyReportContract = z.infer<typeof weeklyReportContractSchema>;

export type WeeklyPendingItem = { id: string; title: string; dueAt?: string | null };
export type WeeklyPlanNode = {
  key: string; roomName: string; stageName: string; color: PlanColor; label: string;
  plannedStart: string; plannedEnd: string;
  completion: 'completed' | 'in_progress' | 'unknown';
  completedAt?: string | null;
};
export type WeeklyRecord = {
  id: string; version: number; room: string; publishedAt: string;
  completed: string; pending: string; coordination: string;
};
export type WeeklyIssue = {
  id: string; status: string; title: string; room: string; createdAt: string;
  dueAt?: string | null; ownerName?: string | null;
};
export type WeeklyArrangement = { id: string; title: string; room: string; confirmedAt: string };
export type WeeklyProjectFacts = {
  projectId: string; projectName: string;
  stageId: string | null; stageKey: string | null; stageName: string | null;
  stageEnteredAt: string | null; stageEventId: string | null;
  nextStageName: string | null;
  plan: { available: boolean; version: number | null; color: PlanColor; label: string; nodes: WeeklyPlanNode[] } | null;
  records: WeeklyRecord[];
  issues: WeeklyIssue[];
  arrangements: WeeklyArrangement[];
  pending: {
    ownerConfirmations: WeeklyPendingItem[];
    designerReviews: WeeklyPendingItem[];
    workerTasks: WeeklyPendingItem[];
    missingMaterials: WeeklyPendingItem[];
  };
};

export type WeeklyDigestLine = { text: string; sourceRefs: string[] };
export type WeeklyDigestSection = { key: string; label: string; lines: WeeklyDigestLine[]; emptyText: string };
export type WeeklyReportDigest = {
  protocol: 'xiaok-weekly-report-v1';
  contract: WeeklyReportContract;
  summary: string;
  sections: WeeklyDigestSection[];
  exceptions: string[];
};

const ref = (input: Omit<WeeklySourceRef, 'refId'>, refId: string): WeeklySourceRef => ({ refId, ...input });
const unique = <T>(items: T[]) => [...new Set(items)];
const lines = (items: Array<{ text: string; refs?: string[] }>): WeeklyDigestLine[] =>
  items.filter(item => item.text.trim()).map(item => ({ text: item.text.trim(), sourceRefs: unique(item.refs ?? []) }));
const section = (key: string, label: string, items: Array<{ text: string; refs?: string[] }>, emptyText: string): WeeklyDigestSection =>
  ({ key, label, lines: lines(items), emptyText });

const stageRef = (project: WeeklyProjectFacts) => project.stageEnteredAt
  ? ref({ kind: 'stage_event', projectId: project.projectId, entityId: project.stageEventId || project.stageEnteredAt, version: null },
    `stage:${project.projectId}:${project.stageEventId || project.stageEnteredAt}`) : null;
const nodeRefs = (project: WeeklyProjectFacts, nodes: WeeklyPlanNode[]) => nodes.map(node =>
  ref({ kind: 'plan_node', projectId: project.projectId, entityId: node.key, version: project.plan?.version ?? null },
    `plan:${project.projectId}:${project.plan?.version ?? 0}:${node.key}`));
const recordRefs = (project: WeeklyProjectFacts, records: WeeklyRecord[]) => records.map(record =>
  ref({ kind: 'record', projectId: project.projectId, entityId: record.id, version: record.version },
    `record:${project.projectId}:${record.id}:v${record.version}`));
const issueRefs = (project: WeeklyProjectFacts, issues: WeeklyIssue[]) => issues.map(issue =>
  ref({ kind: 'issue', projectId: project.projectId, entityId: issue.id, version: null }, `issue:${project.projectId}:${issue.id}`));
const pendingRefs = (project: WeeklyProjectFacts, items: WeeklyPendingItem[], kind = 'pending_item') => items.map(item =>
  ref({ kind: 'pending_item', projectId: project.projectId, entityId: item.id, version: null }, `${kind}:${project.projectId}:${item.id}`));
const arrangementRefs = (project: WeeklyProjectFacts, items: WeeklyArrangement[]) => items.map(item =>
  ref({ kind: 'arrangement', projectId: project.projectId, entityId: item.id, version: null }, `arrangement:${project.projectId}:${item.id}`));

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value);
}
export function weeklySnapshotVersion(projects: readonly WeeklyProjectFacts[]) {
  return createHash('sha256').update(canonical(projects)).digest('hex');
}
export function weeklyReportId(input: { enterpriseId: string; role: WeeklyReportRole; recipientId: string; periodStart: string; periodEnd: string }) {
  return 'wr_' + createHash('sha256').update(canonical(input)).digest('hex').slice(0, 24);
}
export function weeklyReportDedupeKey(input: { enterpriseId: string; role: WeeklyReportRole; recipientId: string; projectId: string | null; periodStart: string; periodEnd: string }) {
  return ['weekly', input.enterpriseId, input.role, input.recipientId, input.projectId ?? 'all', input.periodStart, input.periodEnd].join(':');
}

function issueLabel(status: string) {
  return issueStatusLabels[status as keyof typeof issueStatusLabels] ?? '待核实';
}
function recordLine(record: WeeklyRecord) {
  const pieces = [record.room, record.completed ? '完成：' + record.completed : '', record.pending ? '待处理：' + record.pending : '',
    record.coordination ? '需配合：' + record.coordination : ''].filter(Boolean);
  return pieces.join('；');
}

function ownerSections(project: WeeklyProjectFacts) {
  const stage = stageRef(project);
  const completedNodes = project.plan?.nodes.filter(node => node.completion === 'completed') ?? [];
  const activeNodes = project.plan?.nodes.filter(node => node.completion === 'in_progress') ?? [];
  const openIssues = project.issues.filter(issue => !['closed', 'dismissed', 'cancelled'].includes(issue.status));
  return [
    section('progress', '本周施工进展', [
      { text: project.stageName ? '本周项目处于' + project.stageName + '阶段。' : '本周项目阶段尚未识别，进度无法核实。', refs: stage ? [stage.refId] : [] },
      ...project.records.map(record => ({ text: recordLine(record), refs: [recordRefs(project, [record])[0].refId] })),
      ...(project.records.length ? [] : [{ text: '本周暂无已发布的现场记录，未记录不等于未施工。' }]),
    ], '本周暂无已发布的现场记录，未记录不等于未施工。'),
    section('stage', '当前装修阶段', [
      { text: project.stageName ? '当前阶段：' + project.stageName + '。' : '当前阶段未识别，不能据此判断进度。', refs: stage ? [stage.refId] : [] },
      { text: project.plan?.available ? '已发布施工计划V' + (project.plan.version ?? 0) + '，整体' + project.plan.label + '。'
        : '本项目尚未发布施工计划，红黄绿状态显示待核实，不视为正常。', refs: project.plan?.available ? nodeRefs(project, project.plan.nodes).map(r => r.refId) : [] },
    ], '当前阶段与计划状态待核实。'),
    section('completed', '本周完成的事项', [
      ...completedNodes.map(node => ({ text: node.roomName + ' · ' + node.stageName + '已完成，计划状态' + node.label + '。', refs: nodeRefs(project, [node]).map(r => r.refId) })),
      ...project.records.filter(record => record.completed).map(record => ({ text: record.room + '：' + record.completed, refs: [recordRefs(project, [record])[0].refId] })),
    ], '本周没有已核对的完成记录。'),
    section('in_progress', '目前正在处理的事项', [
      ...activeNodes.map(node => ({ text: node.roomName + ' · ' + node.stageName + '正在施工，计划状态' + node.label + '。', refs: nodeRefs(project, [node]).map(r => r.refId) })),
      ...project.records.filter(record => record.pending || record.coordination).map(record => ({ text: recordLine(record), refs: [recordRefs(project, [record])[0].refId] })),
    ], '目前没有已记录的在处理事项，未记录不等于未施工。'),
    section('confirmations', '需要你确认的需求或事项', project.pending.ownerConfirmations.map(item => ({
      text: item.title, refs: pendingRefs(project, [item]).map(r => r.refId),
    })), '目前没有需要你确认的事项。'),
    section('issues', '当前问题和整改情况', openIssues.map(issue => ({
      text: issue.room + ' · ' + issue.title + '（' + issueLabel(issue.status) + '）', refs: issueRefs(project, [issue]).map(r => r.refId),
    })), '目前没有需要你关注的问题。'),
    section('next_week', '下周需要关注的事项', [
      ...(project.nextStageName ? [{ text: '下一阶段为' + project.nextStageName + '，具体安排以项目发布计划为准。', refs: stage ? [stage.refId] : [] }] : []),
      ...project.pending.ownerConfirmations.map(item => ({ text: '待确认：' + item.title, refs: pendingRefs(project, [item]).map(r => r.refId) })),
      ...(project.plan?.available ? [] : [{ text: '施工计划尚未发布，下周安排待项目负责人确认。' }]),
    ], '下周暂无已发布的安排，待计划确认后更新。'),
    section('records', '重要资料和现场照片', project.records.map(record => ({
      text: record.room + ' · ' + record.publishedAt.slice(0, 10) + ' 现场记录（版本' + record.version + '）', refs: [recordRefs(project, [record])[0].refId],
    })), '本周暂无已发布的现场资料。'),
  ];
}

function designerSections(project: WeeklyProjectFacts, periodStart: string) {
  const weekIssues = project.issues.filter(issue => issue.createdAt >= periodStart);
  const designIssues = project.issues.filter(issue => issue.status !== 'closed' || issue.createdAt >= periodStart);
  return [
    section('requirements', '本周需求变化', project.arrangements.filter(item => item.confirmedAt >= periodStart).map(item => ({
      text: item.room + ' · 已确认：' + item.title, refs: arrangementRefs(project, [item]).map(r => r.refId),
    })), '本周没有已确认的需求变更。'),
    section('reviews', '待核对图纸和方案', [
      ...project.pending.designerReviews.map(item => ({ text: item.title, refs: pendingRefs(project, [item]).map(r => r.refId) })),
      ...project.issues.filter(issue => ['awaiting_verification', 'awaiting_rectification'].includes(issue.status)).map(issue => ({
        text: issue.room + ' · ' + issue.title, refs: issueRefs(project, [issue]).map(r => r.refId),
      })),
    ], '目前没有待核对的图纸或方案。'),
    section('opinions', '待完善的设计意见', project.pending.designerReviews.map(item => ({
      text: item.title, refs: pendingRefs(project, [item]).map(r => r.refId),
    })), '目前没有待完善的设计意见。'),
    section('issues', '设计相关问题', designIssues.map(issue => ({
      text: issue.room + ' · ' + issue.title + '（' + issueLabel(issue.status) + '）', refs: issueRefs(project, [issue]).map(r => r.refId),
    })), '本周没有与设计相关的问题。'),
    section('versions', '需要确认的版本', project.plan?.available ? [{
      text: '当前项目处于' + (project.stageName || '未识别阶段') + '，施工计划V' + (project.plan.version ?? 0)
        + '为有效版本，变更需发布新版本。', refs: nodeRefs(project, project.plan.nodes).map(r => r.refId),
    }] : [{ text: '当前项目处于' + (project.stageName || '未识别阶段') + '，没有已发布的施工计划版本。' }], '当前没有需要确认的版本。'),
    section('completed_reviews', '已完成核对', [
      ...project.records.filter(record => record.completed).map(record => ({ text: record.room + '：' + record.completed, refs: [recordRefs(project, [record])[0].refId] })),
      ...weekIssues.filter(issue => ['resolved', 'closed'].includes(issue.status)).map(issue => ({
        text: issue.room + ' · ' + issue.title + '（' + issueLabel(issue.status) + '）', refs: issueRefs(project, [issue]).map(r => r.refId),
      })),
    ], '本周没有已完成核对的事项。'),
    section('next_week', '下周设计工作', [
      ...project.pending.designerReviews.map(item => ({ text: '继续核对：' + item.title, refs: pendingRefs(project, [item]).map(r => r.refId) })),
      ...(project.nextStageName ? [{ text: '为下一阶段' + project.nextStageName + '准备设计与交底资料。', refs: stageRef(project) ? [stageRef(project)!.refId] : [] }] : []),
    ], '下周设计工作待项目安排。'),
  ];
}

function bossSections(projects: WeeklyProjectFacts[], periodStart: string, now: string) {
  const newIssues = projects.flatMap(project => project.issues.filter(issue => issue.createdAt >= periodStart).map(issue => ({ project, issue })));
  const rectifying = projects.flatMap(project => project.issues.filter(issue => ['awaiting_rectification', 'rectifying'].includes(issue.status)).map(issue => ({ project, issue })));
  const review = projects.flatMap(project => project.issues.filter(issue => issue.status === 'awaiting_review').map(issue => ({ project, issue })));
  const fixed = projects.flatMap(project => project.issues.filter(issue => ['resolved', 'closed'].includes(issue.status)).map(issue => ({ project, issue })));
  const exceptions: string[] = [];
  for (const project of projects) {
    for (const node of project.plan?.nodes.filter(node => node.color === 'red') ?? []) {
      exceptions.push(project.projectName + ' · ' + node.roomName + ' · ' + node.stageName + '已落后');
    }
    for (const issue of project.issues.filter(issue => issue.dueAt && Date.parse(issue.dueAt) < Date.parse(now) && !['closed', 'resolved', 'dismissed', 'cancelled'].includes(issue.status))) {
      exceptions.push(project.projectName + ' · 问题超期：' + issue.title);
    }
    if (!project.plan?.available) exceptions.push(project.projectName + ' · 尚未发布施工计划，无法判断红黄绿');
  }
  return [
    section('overview', '授权范围内项目总览', projects.map(project => ({
      text: project.projectName + ' · ' + (project.stageName || '阶段未识别') + ' · 现场记录' + project.records.length + '条', refs: [stageRef(project)?.refId].filter(Boolean) as string[],
    })), '授权范围内暂无项目。'),
    section('stages', '各项目当前阶段', projects.map(project => ({
      text: project.projectName + '：' + (project.stageName || '阶段未识别'), refs: [stageRef(project)?.refId].filter(Boolean) as string[],
    })), '暂无项目阶段信息。'),
    section('colors', '提前、正常、落后三种计划状态', projects.map(project => ({
      text: project.projectName + '：' + (project.plan?.available ? '计划V' + (project.plan.version ?? 0) + ' ' + project.plan.label
        + '（提前' + project.plan.nodes.filter(n => n.color === 'green').length + '、正常' + project.plan.nodes.filter(n => n.color === 'yellow').length
        + '、落后' + project.plan.nodes.filter(n => n.color === 'red').length + '、待核实' + project.plan.nodes.filter(n => n.color === 'gray').length + '）'
        : '未排期/待核实'),
      refs: project.plan?.available ? nodeRefs(project, project.plan.nodes).map(r => r.refId) : [stageRef(project)?.refId].filter(Boolean) as string[],
    })), '暂无已发布的施工计划。'),
    section('new_issues', '本周新增问题', newIssues.map(({ project, issue }) => ({
      text: project.projectName + ' · ' + issue.room + ' · ' + issue.title, refs: issueRefs(project, [issue]).map(r => r.refId),
    })), '本周没有新增问题。'),
    section('rectifying', '待整改问题', rectifying.map(({ project, issue }) => ({
      text: project.projectName + ' · ' + issue.room + ' · ' + issue.title + '（' + issueLabel(issue.status) + '）', refs: issueRefs(project, [issue]).map(r => r.refId),
    })), '目前没有待整改问题。'),
    section('review', '已整改待复核', review.map(({ project, issue }) => ({
      text: project.projectName + ' · ' + issue.room + ' · ' + issue.title, refs: issueRefs(project, [issue]).map(r => r.refId),
    })), '目前没有已整改待复核事项。'),
    section('fixed', '已修正问题', fixed.map(({ project, issue }) => ({
      text: project.projectName + ' · ' + issue.room + ' · ' + issue.title + '（' + issueLabel(issue.status) + '）', refs: issueRefs(project, [issue]).map(r => r.refId),
    })), '目前没有已修正问题。'),
    section('exceptions', '需要老板介入的例外', exceptions.map(text => ({ text })), '本周没有需要老板介入的例外。'),
    section('next_week', '下周重点事项', projects.map(project => ({
      text: project.projectName + '：' + (project.plan?.available ? '按计划V' + (project.plan.version ?? 0) + '跟进' + (project.stageName || '当前阶段')
        : '先确认施工计划，再判断红黄绿'), refs: [stageRef(project)?.refId].filter(Boolean) as string[],
    })), '下周重点待项目计划确认。'),
  ];
}

function workerSections(project: WeeklyProjectFacts) {
  const unfinished = project.plan?.nodes.filter(node => node.completion !== 'completed') ?? [];
  return [
    section('tasks', '本周负责项目和施工任务', [
      { text: project.projectName + ' · ' + (project.stageName || '阶段未识别'), refs: [stageRef(project)?.refId].filter(Boolean) as string[] },
      ...unfinished.map(node => ({ text: node.roomName + ' · ' + node.stageName + '（' + node.label + '）', refs: nodeRefs(project, [node]).map(r => r.refId) })),
    ], '本周暂无已分配的施工任务。'),
    section('records', '已提交的现场记录', project.records.map(record => ({
      text: record.room + ' · ' + record.publishedAt.slice(0, 10) + ' · 版本' + record.version, refs: [recordRefs(project, [record])[0].refId],
    })), '本周还没有已提交的现场记录。'),
    section('handled', '已处理事项', [
      ...project.records.filter(record => record.completed).map(record => ({ text: record.room + '：' + record.completed, refs: [recordRefs(project, [record])[0].refId] })),
      ...project.issues.filter(issue => ['resolved', 'closed'].includes(issue.status)).map(issue => ({
        text: issue.room + ' · ' + issue.title + '（' + issueLabel(issue.status) + '）', refs: issueRefs(project, [issue]).map(r => r.refId),
      })),
    ], '本周没有已记录的处理完成事项。'),
    section('unfinished', '尚未完成事项', [
      ...project.pending.workerTasks.map(item => ({ text: item.title, refs: pendingRefs(project, [item]).map(r => r.refId) })),
      ...unfinished.map(node => ({ text: node.roomName + ' · ' + node.stageName + '：' + node.label, refs: nodeRefs(project, [node]).map(r => r.refId) })),
    ], '目前没有尚未完成事项。'),
    section('materials', '待补充的资料', project.pending.missingMaterials.map(item => ({
      text: item.title, refs: pendingRefs(project, [item]).map(r => r.refId),
    })), '目前没有待补充资料。'),
    section('next_step', '需要配合的下一步工作', [
      ...(project.nextStageName ? [{ text: '下一阶段' + project.nextStageName + '前，按项目交底准备交接条件。', refs: [stageRef(project)?.refId].filter(Boolean) as string[] }] : []),
      ...project.pending.workerTasks.map(item => ({ text: '待处理：' + item.title, refs: pendingRefs(project, [item]).map(r => r.refId) })),
    ], '下一步工作待项目安排。'),
  ];
}

export function buildWeeklyDigest(input: {
  enterpriseId: string; role: WeeklyReportRole; recipientId: string;
  periodStart: string; periodEnd: string; generatedAt: string;
  projects: WeeklyProjectFacts[];
  reportId?: string; reportVersion?: number;
  sourceSnapshotVersion?: string;
  deliveryStatus?: WeeklyReportContract['deliveryStatus'];
}): WeeklyReportDigest {
  const projects = input.role === 'boss' || input.role === 'owner' ? input.projects : input.projects.slice(0, 1);
  const sections = !projects.length ? [section('empty', '本期范围', [], '当前授权范围内没有可用项目。')]
    : input.role === 'owner' ? ownerSections(projects[0])
    : input.role === 'designer' ? designerSections(projects[0], input.periodStart)
    : input.role === 'worker' ? workerSections(projects[0])
    : bossSections(projects, input.periodStart, input.generatedAt);
  const allRefs = sections.flatMap(item => item.lines.flatMap(line => line.sourceRefs));
  const refs = new Map<string, WeeklySourceRef>();
  for (const item of input.role === 'owner' ? projects : input.role === 'boss' ? projects : projects.slice(0, 1)) {
    const stage = stageRef(item); if (stage) refs.set(stage.refId, stage);
    for (const node of item.plan?.nodes ?? []) for (const r of nodeRefs(item, [node])) refs.set(r.refId, r);
    for (const r of recordRefs(item, item.records)) refs.set(r.refId, r);
    for (const r of issueRefs(item, item.issues)) refs.set(r.refId, r);
    for (const r of arrangementRefs(item, item.arrangements)) refs.set(r.refId, r);
    for (const r of pendingRefs(item, [...item.pending.ownerConfirmations, ...item.pending.designerReviews, ...item.pending.workerTasks, ...item.pending.missingMaterials])) refs.set(r.refId, r);
  }
  const contract = weeklyReportContractSchema.parse({
    reportId: input.reportId ?? weeklyReportId({ enterpriseId: input.enterpriseId, role: input.role, recipientId: input.recipientId,
      periodStart: input.periodStart, periodEnd: input.periodEnd }),
    reportType: 'weekly', enterpriseId: input.enterpriseId,
    projectId: input.role === 'boss' ? null : projects[0]?.projectId ?? null,
    recipientId: input.recipientId, recipientRole: input.role,
    periodStart: input.periodStart, periodEnd: input.periodEnd,
    sourceSnapshotVersion: input.sourceSnapshotVersion ?? weeklySnapshotVersion(projects),
    sourceRefs: [...refs.values()].filter(r => allRefs.includes(r.refId)),
    generatedAt: input.generatedAt, reportVersion: input.reportVersion ?? 1,
    deliveryStatus: input.deliveryStatus ?? 'pending',
  });
  const summary = input.role === 'boss'
    ? '本周共' + projects.length + '个项目；' + (sections.find(item => item.key === 'colors')?.lines.map(line => line.text).join('；') || '计划状态待核实') + '。'
    : projects[0]
      ? '本周' + projects[0].projectName + '处于' + (projects[0].stageName || '阶段未识别') + '；现场记录' + projects[0].records.length + '条，待处理问题'
        + projects[0].issues.filter(issue => !['closed', 'dismissed', 'cancelled'].includes(issue.status)).length + '个。'
      : '本周没有可用项目。';
  return {
    protocol: 'xiaok-weekly-report-v1', contract, summary, sections,
    exceptions: input.role === 'boss' ? (sections.find(item => item.key === 'exceptions')?.lines.map(line => line.text) ?? []) : [],
  };
}
