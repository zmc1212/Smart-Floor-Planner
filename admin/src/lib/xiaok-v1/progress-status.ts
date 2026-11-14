import { z } from 'zod';

export const planColors = ['green', 'yellow', 'red', 'gray'] as const;
export type PlanColor = typeof planColors[number];
export const planStatusLabels: Record<PlanColor, string> = { green: '提前', yellow: '正常', red: '落后', gray: '待核实' };

export const constructionStatuses = ['not_started', 'in_progress', 'pending_acceptance', 'completed'] as const;
export type ConstructionStatus = typeof constructionStatuses[number];
export const constructionStatusLabels: Record<ConstructionStatus, string> = {
  not_started: '未开始', in_progress: '施工中', pending_acceptance: '待验收', completed: '已完成',
};

export const issueStatuses = ['awaiting_verification', 'awaiting_rectification', 'rectifying', 'awaiting_review',
  'resolved', 'closed', 'dismissed', 'cancelled', 'invalidated'] as const;
export type IssueDisplayStatus = typeof issueStatuses[number];
export const issueStatusLabels: Record<IssueDisplayStatus, string> = {
  awaiting_verification: '待核实', awaiting_rectification: '待整改', rectifying: '整改中',
  awaiting_review: '已整改待复核', resolved: '已修正待关闭', closed: '已修正',
  dismissed: '已排除', cancelled: '已取消', invalidated: '待重新核对',
};

export const planStatusViewSchema = z.strictObject({
  color: z.enum(planColors),
  label: z.string().min(1),
  reason: z.string().min(1),
});
export type PlanStatusView = z.infer<typeof planStatusViewSchema>;

export type PlanTimingInput = {
  plannedStart: string;
  plannedEnd: string;
  now: Date;
  /** True only when a real, authorized site record or stage event exists. */
  observed: boolean;
  /** Actual completion evidence, never a self-reported plan checkbox. */
  completedAt?: string | null;
  /** Existing business tolerance. Zero preserves the current schedule rule. */
  normalToleranceDays?: number;
};

const dayStart = (day: string) => Date.parse(day + 'T00:00:00+08:00');
const dayAfter = (day: string) => dayStart(day) + 86_400_000;

/** The single plan-color calculation used by project, boss and weekly views.
 * No plan or no evidence produces gray, never green. */
export function classifyPlanTiming(input: PlanTimingInput): PlanStatusView {
  const tolerance = Math.max(0, Number.isSafeInteger(input.normalToleranceDays) ? Number(input.normalToleranceDays) : 0);
  const start = dayStart(input.plannedStart), end = dayAfter(input.plannedEnd) + tolerance * 86_400_000;
  if (input.completedAt) {
    const actual = new Date(input.completedAt).getTime();
    if (!Number.isFinite(actual)) return { color: 'gray', label: planStatusLabels.gray, reason: '完工证据时间不可核实。' };
    if (actual < dayStart(input.plannedEnd)) return { color: 'green', label: planStatusLabels.green, reason: '完工证据早于计划结束日。' };
    if (actual < end) return { color: 'yellow', label: planStatusLabels.yellow, reason: '完工证据在计划结束日容差内。' };
    return { color: 'red', label: planStatusLabels.red, reason: '完工证据晚于计划结束日。' };
  }
  if (input.now.getTime() >= end) return { color: 'red', label: '已落后', reason: '计划结束日已过，待核对完成情况。' };
  if (input.now.getTime() >= start && input.observed) {
    return { color: 'yellow', label: planStatusLabels.yellow, reason: '处于计划期内，已有现场进展。' };
  }
  return {
    color: 'gray', label: planStatusLabels.gray,
    reason: input.now.getTime() < start ? '尚未到计划开始日。' : '计划期内尚无有效现场记录。',
  };
}

/** Colors are counted per room/node. A completed room never proves the whole
 * project complete and no workload-free percentage is produced here. */
export function aggregatePlanStatus(nodes: ReadonlyArray<{ color: PlanColor }>): { color: PlanColor; label: string } {
  if (!nodes.length) return { color: 'gray', label: '未排期' };
  if (nodes.some(node => node.color === 'red')) return { color: 'red', label: planStatusLabels.red };
  if (nodes.some(node => node.color === 'gray')) return { color: 'gray', label: planStatusLabels.gray };
  if (nodes.some(node => node.color === 'yellow')) return { color: 'yellow', label: planStatusLabels.yellow };
  return { color: 'green', label: planStatusLabels.green };
}

/** Acceptance remains separate from a worker's completion report. */
export function constructionStatus(input: { observed: boolean; completed: boolean; acceptancePending?: boolean }): ConstructionStatus {
  if (input.acceptancePending) return 'pending_acceptance';
  if (input.completed) return 'completed';
  return input.observed ? 'in_progress' : 'not_started';
}

export function issueStatusLabel(status: string): string {
  return issueStatusLabels[status as IssueDisplayStatus] ?? '待核实';
}
