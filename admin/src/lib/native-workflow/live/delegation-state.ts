
export const delegationConsumer = 'native.delegation.v1';
export const delegationRefresh = 'native.delegation.refresh.v1';
export const delegationTimeout = 'native.delegation.timeout.v1';
export const delegationOwnerInput = 'native.delegation.owner_input.v1';
export const delegationExternalResult = 'native.delegation.external_result.v1';
export const delegationNotice = 'native.delegation.notice.v1';
export const delegationPurpose = 'construction.delegation';

export const delegationKinds = ['design_review','room_progress','rectification_review','owner_followup','external_review'] as const;
export type DelegationKind = typeof delegationKinds[number];
export type DelegationStatus = 'pending' | 'running' | 'waiting_for_user' | 'waiting_for_worker'
  | 'waiting_for_designer' | 'waiting_for_external' | 'waiting_for_authorization'
  | 'failed' | 'paused' | 'cancelled' | 'completed';
export type DelegationControl = 'status' | 'pause' | 'resume' | 'cancel';
export type DelegationScope = { kind: DelegationKind; roomId: string | null; roomName: string; subject: string; issueId: string | null };
export type DelegationEvidence = {
  type: 'record' | 'designer_reply' | 'rectification' | 'review' | 'owner_reply' | 'external_result';
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
  evidence: DelegationEvidence | null;
};
export type Delegation = DelegationOutcome & {
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
  rectification_review: '对应事项的现场落实证据由有权人员复核，并回传结论',
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
  evidence: DelegationEvidence | null = null, assignedTo: string | null = null): DelegationOutcome {
  return { status, nextAction, waitingFor, assignedTo, evidence };
}

export function nextWake(d: Pick<Delegation, 'dueAt' | 'reminderStage'>, status: DelegationStatus) {
  if ((!isWaiting(status) && status !== 'running') || d.reminderStage >= 2) return null;
  return new Date(d.dueAt.getTime() + d.reminderStage * 24 * 60 * 60 * 1000);
}
