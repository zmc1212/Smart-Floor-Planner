export const delegationConsumer = 'native.delegation.v1';
export const delegationRefresh = 'native.delegation.refresh.v1';
export const delegationTimeout = 'native.delegation.timeout.v1';
export const delegationRequirement = 'native.delegation.requirement.v1';
export const delegationNotice = 'native.delegation.notice.v1';

export const terminalDelegations = ['completed', 'failed', 'cancelled', 'expired'] as const;
export type DelegationState = typeof terminalDelegations[number] |
  'active' | 'processing' | 'waiting' | 'blocked' | 'awaiting_authorization' | 'paused';

export type DelegationAction = 'collect_report' | 'organize_report' | 'review_report' | 'ask_owner' | 'share_need' |
  'assign_designer' | 'review_design' | 'authorize_plan' | 'perform_work' | 'review_work' | 'recheck_source' |
  'retry_report' | 'done' | 'room_removed';

export interface DelegationWait {
  readonly key: string;
  readonly for: 'owner' | 'designer' | 'worker' | 'manager';
  readonly personId: string | null;
  readonly requested: readonly string[];
  readonly startedAt: string;
  readonly deadlineAt: string;
  readonly timedOutAt?: string;
}

export interface DelegationEvidence {
  readonly recordId: string;
  readonly version: number;
  readonly runId: string | null;
  readonly eventId: string;
  readonly photoIds: readonly string[];
  readonly status: 'organizing' | 'reported' | 'published' | 'failed';
  readonly complete: boolean;
  readonly customerVisible: boolean;
}

export interface DelegationBasis {
  readonly needGrantId: string | null;
  readonly drawingGrantId: string | null;
  readonly factIds: readonly string[];
  readonly replyMessageId?: string;
  readonly materialVersion: string;
  readonly scheduleVersion: string;
}

export interface DelegationTask {
  readonly key: string;
  readonly roomId: string;
  readonly roomName: string;
  readonly kind: 'progress' | 'outlet';
  readonly completion: 'published_progress' | 'manager_resolution';
  readonly next: DelegationAction;
  readonly wait?: DelegationWait;
  readonly evidence?: DelegationEvidence;
  readonly basis?: DelegationBasis;
  readonly issueId?: string;
  readonly issueRevision?: number;
  readonly issueStatus?: string;
  readonly opinionEventId?: string;
  readonly plan?: { readonly id: string; readonly hash: string; readonly revision: number; readonly status: string; readonly scheduleVersion: string };
  readonly resultEventId?: string;
  readonly staffNoticeId?: string;
}

export interface Delegation {
  readonly id: string;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly requesterId: string;
  readonly conversationId: string;
  readonly originMessageId: string;
  readonly originHash: string;
  readonly goal: string;
  readonly authorization: { readonly trackElectrical: true; readonly remindOwner: boolean };
  readonly state: DelegationState;
  readonly tasks: readonly DelegationTask[];
  readonly expiresAt: Date;
}

export function delegationIsTerminal(state: DelegationState) {
  return terminalDelegations.some(terminal => terminal === state);
}

const waitingHours = 48;
export const delegationLifetimeMs = 30 * 24 * 60 * 60 * 1000;

export function setDelegationWait(task: DelegationTask, next: DelegationAction, eventId: string, now: Date,
  target: Omit<DelegationWait, 'key' | 'startedAt' | 'deadlineAt' | 'timedOutAt'> | null): DelegationTask {
  const old = task.wait;
  const same = old && target && task.next === next && old.for === target.for && old.personId === target.personId
    && old.requested.join('\n') === target.requested.join('\n');
  return { ...task, next, wait: !target ? undefined : same ? old : {
    ...target, key: eventId, startedAt: now.toISOString(), deadlineAt: new Date(now.getTime() + waitingHours * 3600_000).toISOString(),
  } };
}

export function deriveDelegationState(tasks: readonly DelegationTask[]): DelegationState {
  if (tasks.every(task => task.next === 'done')) return 'completed';
  if (tasks.some(task => task.next === 'room_removed')) return 'failed';
  if (tasks.some(task => task.next === 'authorize_plan' || task.next === 'share_need')) return 'awaiting_authorization';
  if (tasks.some(task => ['assign_designer', 'recheck_source', 'retry_report'].includes(task.next))) return 'blocked';
  if (tasks.some(task => task.next === 'organize_report')) return 'processing';
  if (tasks.some(task => task.wait)) return 'waiting';
  return 'active';
}

export function nextDelegationWake(state: DelegationState, tasks: readonly DelegationTask[], expiresAt: Date) {
  if (delegationIsTerminal(state)) return null;
  const due = state === 'paused' ? [] : tasks.flatMap(task => task.wait && !task.wait.timedOutAt ? [Date.parse(task.wait.deadlineAt)] : []);
  return new Date(Math.min(expiresAt.getTime(), ...due));
}

export const delegationActionText: Record<DelegationAction, string> = {
  collect_report: '待现场上报水电进展',
  organize_report: '已收到现场材料，正在整理',
  review_report: '现场进展已记录，待核对发布',
  ask_owner: '等业主补充插座核对所需信息',
  share_need: '等业主确认把本次需求共享给项目团队',
  assign_designer: '等项目负责人安排有权核对的设计师',
  review_design: '等设计师核对需求和图纸',
  authorize_plan: '等有权人员走正式方案确认',
  perform_work: '方案已确认，等现场上报',
  review_work: '等项目负责人复核现场记录',
  recheck_source: '执行依据已变化，等项目团队重新核对',
  retry_report: '本次现场整理未完成，原件已保留',
  done: '本项跟进已完成',
  room_removed: '已登记的施工部位不可用',
};
