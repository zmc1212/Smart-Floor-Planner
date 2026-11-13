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

export const delegationOwnerInput = 'native.delegation.owner_input.v1';
export const delegationExternalResult = 'native.delegation.external_result.v1';
export const delegationPurpose = 'construction.delegation';

export const delegationKinds = ['design_review','room_progress','rectification_review','owner_followup','external_review'] as const;
export type DelegationKind = typeof delegationKinds[number];
export type DelegationStatus = 'pending' | 'running' | 'waiting_for_user' | 'waiting_for_worker'
  | 'waiting_for_designer' | 'waiting_for_external' | 'waiting_for_authorization'
  | 'failed' | 'paused' | 'cancelled' | 'completed';
export type DelegationControl = 'status' | 'pause' | 'resume' | 'cancel';
export type SpecialistWorkflowBinding = { templateId: string; revision: number; digest: string; agentId: string; agentVersion: number;
  originRunId: string; originBound?: true };
export const specialistWorkflowRunId = (delegationId: string) => 'specialist:' + delegationId;
export type DelegationScope = { workflow?: SpecialistWorkflowBinding; kind: DelegationKind; roomId: string | null; roomName: string; subject: string; issueId: string | null };
export type ReviewDelegationEvidence = {
  type: 'record' | 'designer_reply' | 'issue' | 'rectification' | 'review' | 'owner_reply' | 'external_result';
  id: string;
  version: string;
  messageId?: string;
  issueId?: string;
  state?: string;
};
export type DelegationOutcome = {
  status: DelegationStatus;
  assignedTo: string | null;
  waitingFor: string | null;
  nextAction: string;
  evidence: ReviewDelegationEvidence | null;
};
export type ReviewDelegation = DelegationOutcome & {
  id: string;
  enterpriseId: string;
  projectId: string;
  ownerId: string;
  conversationId: string;
  originMessageId: string;
  originHash: string;
  title: string;
  objective: string;
  scope: DelegationScope;
  completionCriteria: string;
  dueAt: Date;
  nextWakeAt: Date | null;
  authorization: { inAppReminder: boolean; share: 'existing_project_grants' };
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  version: number;
  activationEventId: string | null;
  reminderStage: number;
};

export const completionCriteria: Record<DelegationKind, string> = {
  design_review: '有权设计师回复，且项目负责人将该回复回传原咨询',
  room_progress: '对应房间的工作由团队核对并对业主发布，记录明确该项已完成',
  rectification_review: '对应事项的现场落实证据由有权人员复核，并回传原咨询',
  owner_followup: '收到原咨询中业主对本事项的补充，等待核对后继续处理',
  external_review: '原咨询有新获取并保存的公开来源可供核对',
};

export const statusText: Record<DelegationStatus, string> = {
  pending: '已登记，等待核对当前资料',
  running: '资料已关联，待核对后继续',
  waiting_for_user: '等你补充资料',
  waiting_for_worker: '等项目团队提交并核对对应的现场进展',
  waiting_for_designer: '等待设计师核对，回传后会在原咨询更新',
  waiting_for_external: '等当前咨询取得新的公开资料',
  waiting_for_authorization: '等待本事项所需的项目授权或资料共享',
  failed: '处理遇到问题，可在原咨询继续跟进',
  paused: '已暂停',
  cancelled: '已取消',
  completed: '委托的跟进条件已满足',
};

export const isSuspended = (status: DelegationStatus) => ['paused','cancelled','failed'].includes(status);
export const isWaiting = (status: DelegationStatus) => status.startsWith('waiting_');

export function outcome(status: DelegationStatus, nextAction = statusText[status], waitingFor: string | null = null,
  evidence: ReviewDelegationEvidence | null = null, assignedTo: string | null = null): DelegationOutcome {
  return { status, nextAction, waitingFor, assignedTo, evidence };
}

export function nextWake(d: Pick<ReviewDelegation, 'dueAt' | 'reminderStage'>, status: DelegationStatus) {
  if ((!isWaiting(status) && status !== 'running') || d.reminderStage >= 2) return null;
  return new Date(d.dueAt.getTime() + d.reminderStage * 24 * 60 * 60 * 1000);
}
