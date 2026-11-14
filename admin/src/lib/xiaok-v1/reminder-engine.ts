import { createHash } from 'node:crypto';
import { z } from 'zod';
import { stageForConstructionKey, type StageId } from './stages';

export const reminderRoles = ['owner', 'designer', 'boss', 'worker', 'manager'] as const;
export type ReminderRole = typeof reminderRoles[number];

export const reminderTriggerTypes = [
  'stage_entered', 'plan_node_due_soon', 'plan_node_overdue', 'assignee_todo',
  'owner_confirmation', 'designer_review', 'worker_missing_material', 'data_stale',
  'issue_overdue', 'stage_ending',
] as const;
export type ReminderTriggerType = typeof reminderTriggerTypes[number];

export const reminderStatuses = ['pending', 'delivered', 'failed', 'paused', 'cancelled', 'acknowledged', 'expired'] as const;
export type ReminderStatus = typeof reminderStatuses[number];

export type ReminderRecipient = { role: ReminderRole; userId: string | null };
export type PendingItem = { id: string; title: string; createdAt: string; dueAt?: string | null; actionUrl?: string;
  /** Stable revision-aware key when the same business item reopens. */
  dedupeSubject?: string };
export type ReminderPlanNode = {
  key: string; stageId: string | null; roomId: string | null; roomName: string;
  plannedStart: string; plannedEnd: string; color: 'green' | 'yellow' | 'red' | 'gray';
  completion: 'completed' | 'in_progress' | 'unknown';
};
export type ReminderIssue = { id: string; title: string; status: string; updatedAt: string; dueAt?: string | null };
export type ReminderProjectFacts = {
  enterpriseId: string; projectId: string; projectName: string;
  projectStatus: 'active' | 'paused' | 'archived';
  constructionStageKey: string | null; stageName: string | null;
  stageEventId: string | null; stageEnteredAt: string | null;
  schedule: { available: boolean; version: number | null; nodes: ReminderPlanNode[] };
  pending: {
    ownerConfirmations: PendingItem[]; designerReviews: PendingItem[];
    workerMissingMaterials: PendingItem[]; managerTodos: PendingItem[];
  };
  issues: ReminderIssue[];
  lastRecordAt: string | null;
  recipients: { owner: string[]; designer: string[]; worker: string[]; boss: string[]; manager: string[] };
};

export type StageReminderPolicy = {
  policyId: string; stageId: StageId; version: number; status: 'active' | 'draft' | 'disabled';
  enterStage: boolean;
  /** Mid-stage and ending reminders require a real published plan node. */
  midStageAfterDays: number | null;
  endPreparationDays: number | null;
  dueSoonDays: number;
  /** No record means unknown, not stalled; null disables the stale trigger. */
  staleRecordDays: number | null;
  issueOverdueGraceDays: number;
  /** Only a real exception this many days past a plan end or agreed deadline
   * reaches the company boss. Ordinary todos stay with their own role. */
  bossEscalationDays: number;
  cooldownHours: number;
  quietHours: { start: number; end: number } | null;
  roles: ReminderRole[];
};

export const reminderDraftSchema = z.strictObject({
  reminderId: z.string().regex(/^rem_[a-f0-9]{24}$/u),
  enterpriseId: z.string(), projectId: z.string(), stageId: z.string().nullable(),
  constructionStageKey: z.string().nullable(),
  targetRole: z.enum(reminderRoles), targetUserId: z.string().nullable(),
  relatedTaskId: z.string().nullable(), relatedIssueId: z.string().nullable(),
  triggerType: z.enum(reminderTriggerTypes),
  triggerEvidence: z.strictObject({
    kind: z.enum(['stage_event', 'plan_node', 'pending_item', 'issue', 'record_gap']),
    refId: z.string(), version: z.number().int().nonnegative().nullable(), at: z.string().nullable(),
    /** Stable exception subject used to dedupe one company escalation across projects. */
    subject: z.string().optional(),
  }),
  scheduledAt: z.string(), deliveredAt: z.string().nullable(),
  status: z.enum(reminderStatuses), dedupeKey: z.string().min(1), actionUrl: z.string().min(1),
  title: z.string().min(1), body: z.string().min(1),
});
export type ReminderDraft = z.infer<typeof reminderDraftSchema>;

const shanghaiParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false })
    .formatToParts(date);
  return Number(parts.find(part => part.type === 'hour')?.value ?? '0');
};

const dateOnly = (value: string) => value.slice(0, 10);
const startOfDay = (value: string) => value.slice(0, 10) + 'T00:00:00+08:00';
const dayDiff = (later: string, earlier: string) => Math.round((Date.parse(startOfDay(later)) - Date.parse(startOfDay(earlier))) / 86_400_000);
const weekBucket = (now: Date) => {
  const day = dateOnly(now.toISOString());
  return String(Math.floor((Date.parse(startOfDay(day)) - Date.parse('2026-01-05T00:00:00+08:00')) / (7 * 86_400_000)));
};

/** Quiet hours shift the reminder to the next permitted hour instead of dropping it. */
export function applyQuietHours(iso: string, quiet: StageReminderPolicy['quietHours']) {
  if (!quiet) return iso;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  const hour = shanghaiParts(date);
  const inQuiet = quiet.start < quiet.end ? hour >= quiet.start && hour < quiet.end : hour >= quiet.start || hour < quiet.end;
  if (!inQuiet) return iso;
  const shifted = new Date(date);
  const delta = (quiet.end - hour + 24) % 24;
  shifted.setTime(shifted.getTime() + delta * 3_600_000);
  return shifted.toISOString();
}

function reminderId(dedupeKey: string) {
  return 'rem_' + createHash('sha256').update(dedupeKey).digest('hex').slice(0, 24);
}

function dedupeKey(input: {
  enterpriseId: string; projectId: string; triggerType: ReminderTriggerType; stageId: string | null;
  targetRole: ReminderRole; targetUserId: string | null;
}, subject: string) {
  return [input.enterpriseId, input.projectId, input.triggerType, input.stageId ?? '-', input.targetRole,
    input.targetUserId ?? '-', subject].join(':');
}

const triggerTitles: Record<ReminderTriggerType, string> = {
  stage_entered: '阶段已更新', plan_node_due_soon: '计划节点临近', plan_node_overdue: '计划节点已过期',
  assignee_todo: '你有待处理事项', owner_confirmation: '有待确认事项', designer_review: '有待核对事项',
  worker_missing_material: '需要补充现场资料', data_stale: '现场记录需要更新', issue_overdue: '问题处理已超过约定期限',
  stage_ending: '当前阶段即将结束',
};
const roleLabels: Record<ReminderRole, string> = { owner: '业主', designer: '设计师', boss: '公司负责人', worker: '施工人员', manager: '项目经理' };

function bodyFor(trigger: ReminderTriggerType, role: ReminderRole, facts: ReminderProjectFacts, subject: string, detail: string) {
  return '「' + facts.projectName + '」当前处于' + (facts.stageName || '未识别阶段') + '。'
    + roleLabels[role] + '：' + detail + (subject ? '（' + subject + '）' : '')
    + '\n提醒只说明当前需要关注的事项，不代表对方已读、已承诺或已完成。';
}

function actionUrl(facts: ReminderProjectFacts, trigger: ReminderTriggerType, itemId?: string) {
  const base = '/packages/construction/projects/projects?project=' + encodeURIComponent(facts.projectId);
  if (itemId) return base + '&item=' + encodeURIComponent(itemId);
  return base + '&focus=' + trigger;
}

function draft(input: {
  facts: ReminderProjectFacts; policy: StageReminderPolicy; now: Date;
  triggerType: ReminderTriggerType; targetRole: ReminderRole; targetUserId: string | null;
  relatedTaskId?: string | null; relatedIssueId?: string | null;
  evidence: ReminderDraft['triggerEvidence']; subject: string; detail: string; itemId?: string;
  dedupeSubject?: string;
}): ReminderDraft {
  const { facts } = input;
  const stageId = stageForConstructionKey(facts.constructionStageKey)?.stageId ?? null;
  const key = dedupeKey({
    enterpriseId: facts.enterpriseId, projectId: facts.projectId, triggerType: input.triggerType,
    stageId, targetRole: input.targetRole, targetUserId: input.targetUserId,
  }, input.dedupeSubject ?? input.subject);
  return reminderDraftSchema.parse({
    reminderId: reminderId(key), enterpriseId: facts.enterpriseId, projectId: facts.projectId,
    stageId, constructionStageKey: facts.constructionStageKey,
    targetRole: input.targetRole, targetUserId: input.targetUserId,
    relatedTaskId: input.relatedTaskId ?? null, relatedIssueId: input.relatedIssueId ?? null,
    triggerType: input.triggerType, triggerEvidence: input.evidence,
    scheduledAt: applyQuietHours(input.now.toISOString(), input.policy.quietHours),
    deliveredAt: null, status: 'pending', dedupeKey: key,
    actionUrl: actionUrl(facts, input.triggerType, input.itemId),
    title: triggerTitles[input.triggerType],
    body: bodyFor(input.triggerType, input.targetRole, facts, input.subject, input.detail),
  });
}

function recipientsFor(facts: ReminderProjectFacts, role: ReminderRole) {
  const ids = facts.recipients[role] ?? [];
  return [...new Set(ids.filter(id => /^[1-9]\d*$/u.test(id)))];
}

/** Only real facts produce reminders. A missing plan, missing record or missing
 * recipient yields no reminder; the engine never guesses a deadline or stall. */
export function buildReminderDrafts(facts: ReminderProjectFacts, policy: StageReminderPolicy, now: Date): ReminderDraft[] {
  if (facts.projectStatus !== 'active' || policy.status !== 'active') return [];
  const stageId = stageForConstructionKey(facts.constructionStageKey)?.stageId;
  if (!stageId || stageId !== policy.stageId) return [];
  const drafts: ReminderDraft[] = [];
  const today = dateOnly(now.toISOString());

  // A. Stage changed. One reminder per real stage event, never per tick.
  if (policy.enterStage && facts.stageEnteredAt) {
    const subject = facts.stageEventId || facts.stageEnteredAt;
    for (const role of ['owner', 'worker', 'designer', 'manager'] as const) {
      if (!policy.roles.includes(role)) continue;
      for (const userId of recipientsFor(facts, role)) drafts.push(draft({ facts, policy, now, triggerType: 'stage_entered',
        targetRole: role, targetUserId: userId, evidence: { kind: 'stage_event', refId: subject, version: null, at: facts.stageEnteredAt },
        subject: facts.stageName || stageId, dedupeSubject: subject,
        detail: '项目已进入当前阶段，请查看本阶段关注事项和现场资料。' }));
    }
  }

  // B/C/J. Plan-driven reminders require a published plan with real dates.
  if (facts.schedule.available) {
    for (const node of facts.schedule.nodes) {
      if (node.stageId !== stageId || node.completion === 'completed') continue;
      const daysToEnd = dayDiff(node.plannedEnd, today);
      if (daysToEnd >= 0 && daysToEnd <= policy.dueSoonDays) {
        for (const role of ['owner', 'worker', 'manager'] as const) {
          if (!policy.roles.includes(role)) continue;
          for (const userId of recipientsFor(facts, role)) drafts.push(draft({ facts, policy, now, triggerType: 'plan_node_due_soon',
            targetRole: role, targetUserId: userId, relatedTaskId: node.key,
            evidence: { kind: 'plan_node', refId: node.key, version: facts.schedule.version, at: now.toISOString() },
            itemId: node.key, subject: node.roomName ? node.roomName + ' · ' + (facts.stageName || '') : (facts.stageName || ''),
            dedupeSubject: node.key + ':' + node.plannedEnd,
            detail: '计划节点临近结束日，请核对现场进展并补充需要的资料。' }));
        }
      }
      if (daysToEnd < 0) {
        for (const role of ['manager', 'owner'] as const) {
          if (!policy.roles.includes(role)) continue;
          for (const userId of recipientsFor(facts, role)) drafts.push(draft({ facts, policy, now, triggerType: 'plan_node_overdue',
            targetRole: role, targetUserId: userId, relatedTaskId: node.key,
            evidence: { kind: 'plan_node', refId: node.key, version: facts.schedule.version, at: now.toISOString() },
            itemId: node.key, subject: node.roomName ? node.roomName + ' · ' + (facts.stageName || '') : (facts.stageName || ''),
            dedupeSubject: node.key + ':' + node.plannedEnd,
            detail: '计划结束日已过且当前没有完成证据，请核对实际进展，不要直接认定未施工。' }));
        }
      }
      if (policy.endPreparationDays !== null && daysToEnd >= 0 && daysToEnd <= policy.endPreparationDays) {
        for (const role of ['worker', 'manager', 'designer'] as const) {
          if (!policy.roles.includes(role)) continue;
          for (const userId of recipientsFor(facts, role)) drafts.push(draft({ facts, policy, now, triggerType: 'stage_ending',
            targetRole: role, targetUserId: userId, relatedTaskId: node.key,
            evidence: { kind: 'plan_node', refId: node.key, version: facts.schedule.version, at: now.toISOString() },
            itemId: node.key, subject: node.roomName ? node.roomName + ' · ' + (facts.stageName || '') : (facts.stageName || ''),
            dedupeSubject: node.key + ':end',
            detail: '当前阶段即将结束，请整理待补资料、遗留事项和下一阶段衔接条件。' }));
        }
      }
      if (policy.midStageAfterDays !== null && daysToEnd > 0 && dayDiff(today, node.plannedStart) >= policy.midStageAfterDays) {
        for (const role of ['owner', 'worker'] as const) {
          if (!policy.roles.includes(role)) continue;
          for (const userId of recipientsFor(facts, role)) drafts.push(draft({ facts, policy, now, triggerType: 'plan_node_due_soon',
            targetRole: role, targetUserId: userId, relatedTaskId: node.key + ':mid',
            evidence: { kind: 'plan_node', refId: node.key, version: facts.schedule.version, at: now.toISOString() },
            itemId: node.key, subject: node.roomName ? node.roomName + ' · ' + (facts.stageName || '') : (facts.stageName || ''),
            dedupeSubject: node.key + ':mid',
            detail: '当前阶段已进行一段时间，请查看本阶段关注事项和现场记录。' }));
        }
      }
    }
  }

  // D-G. Role-specific pending items come from formal business services.
  const pendingGroups: Array<{ items: PendingItem[]; trigger: ReminderTriggerType; role: ReminderRole; detail: string }> = [
    { items: facts.pending.ownerConfirmations, trigger: 'owner_confirmation', role: 'owner', detail: '有事项等待你确认，请查看当前版本后再决定。' },
    { items: facts.pending.designerReviews, trigger: 'designer_review', role: 'designer', detail: '有需求或图纸等待你核对，请按当前版本处理。' },
    { items: facts.pending.workerMissingMaterials, trigger: 'worker_missing_material', role: 'worker', detail: '现场资料需要补充，请拍照或文字说明后提交。' },
    { items: facts.pending.managerTodos, trigger: 'assignee_todo', role: 'manager', detail: '有事项等待你处理，请在项目内核对。' },
  ];
  for (const group of pendingGroups) {
    if (!policy.roles.includes(group.role)) continue;
    for (const item of group.items) {
      const recipientIds = recipientsFor(facts, group.role);
      if (!recipientIds.length) continue;
      for (const userId of recipientIds) drafts.push(draft({ facts, policy, now, triggerType: group.trigger, targetRole: group.role,
        targetUserId: userId, relatedTaskId: item.id,
        evidence: { kind: 'pending_item', refId: item.id, version: null, at: item.createdAt },
        itemId: item.id, subject: item.title, dedupeSubject: item.dedupeSubject ?? item.id, detail: group.detail }));
    }
  }

  // H. Stale records only when a real record exists. No record is unknown.
  if (policy.staleRecordDays !== null && facts.lastRecordAt) {
    const staleDays = dayDiff(today, dateOnly(facts.lastRecordAt));
    if (staleDays >= policy.staleRecordDays) {
      for (const role of ['worker', 'manager'] as const) {
        if (!policy.roles.includes(role)) continue;
        for (const userId of recipientsFor(facts, role)) drafts.push(draft({ facts, policy, now, triggerType: 'data_stale',
          targetRole: role, targetUserId: userId,
          evidence: { kind: 'record_gap', refId: facts.lastRecordAt, version: null, at: facts.lastRecordAt },
          subject: facts.stageName || stageId, dedupeSubject: stageId + ':' + weekBucket(now),
          detail: '最近一次现场记录距今已超过配置天数，请补充当前进展；未记录不等于未施工。' }));
      }
    }
  }

  // Company exceptions. A boss sees only a real plan/deadline breach, never
  // ordinary role todos. The same exception subject is deduped across projects
  // by the persistence layer, so one company escalation is not repeated.
  const bossRecipients = recipientsFor(facts, 'boss');
  if (bossRecipients.length && policy.bossEscalationDays >= 0) {
    if (facts.schedule.available) {
      for (const node of facts.schedule.nodes) {
        if (node.stageId !== stageId || node.completion === 'completed') continue;
        if (dayDiff(today, node.plannedEnd) < policy.bossEscalationDays) continue;
        for (const userId of bossRecipients) drafts.push(draft({ facts, policy, now, triggerType: 'plan_node_overdue',
          targetRole: 'boss', targetUserId: userId, relatedTaskId: node.key,
          evidence: { kind: 'plan_node', refId: node.key, version: facts.schedule.version, at: now.toISOString(),
            subject: 'plan:' + node.key + ':' + node.plannedEnd },
          itemId: node.key, subject: node.roomName ? node.roomName + ' · ' + (facts.stageName || '') : (facts.stageName || ''),
          dedupeSubject: 'boss:plan:' + node.key + ':' + node.plannedEnd,
          detail: '计划结束日已超过公司介入阈值且没有完成证据，请公司核对是否需要协调资源或调整安排。' }));
      }
    }
    for (const issue of facts.issues) {
      if (!issue.dueAt || dayDiff(today, dateOnly(issue.dueAt)) < policy.bossEscalationDays) continue;
      for (const userId of bossRecipients) drafts.push(draft({ facts, policy, now, triggerType: 'issue_overdue',
        targetRole: 'boss', targetUserId: userId, relatedIssueId: issue.id,
        evidence: { kind: 'issue', refId: issue.id, version: null, at: issue.updatedAt, subject: 'issue:' + issue.id },
        itemId: issue.id, subject: issue.title, dedupeSubject: 'boss:issue:' + issue.id,
        detail: '事项已超过真实约定期限，按项目规则需要公司介入核对；提醒不代表问题已解决。' }));
    }
  }

  // I. Issue reminders require a real agreed deadline. No invented SLA.
  for (const issue of facts.issues) {
    if (!issue.dueAt || Date.parse(issue.dueAt) >= now.getTime()) continue;
    const graceDays = dayDiff(today, dateOnly(issue.dueAt));
    if (graceDays <= policy.issueOverdueGraceDays) continue;
    const role: ReminderRole = 'manager';
    if (!policy.roles.includes(role)) continue;
    for (const userId of recipientsFor(facts, role)) drafts.push(draft({ facts, policy, now, triggerType: 'issue_overdue',
      targetRole: role, targetUserId: userId, relatedIssueId: issue.id,
      evidence: { kind: 'issue', refId: issue.id, version: null, at: issue.updatedAt },
      itemId: issue.id, subject: issue.title, dedupeSubject: issue.id,
      detail: '问题处理已超过约定期限，请核对当前状态；发送提醒不代表问题已解决。' }));
  }

  return dedupeDrafts(drafts);
}

export function dedupeDrafts(drafts: readonly ReminderDraft[]) {
  const seen = new Map<string, ReminderDraft>();
  for (const draft of drafts) {
    const key = draft.dedupeKey;
    const old = seen.get(key);
    if (!old || Date.parse(draft.scheduledAt) < Date.parse(old.scheduledAt)) seen.set(key, draft);
  }
  return [...seen.values()];
}

/** Existing rows are reconciled against current facts. Delivered history stays;
 * only pending work can be cancelled, paused or expired. */
export function reconcileReminders(input: {
  facts: ReminderProjectFacts;
  current: readonly ReminderDraft[];
  existing: ReadonlyArray<Pick<ReminderDraft, 'reminderId' | 'dedupeKey' | 'stageId' | 'targetRole' | 'targetUserId' | 'status'>>;
  pausedPrefixes?: readonly string[];
}) {
  const keys = new Set(input.current.map(draft => draft.dedupeKey));
  const paused = input.pausedPrefixes ?? [];
  const stageId = stageForConstructionKey(input.facts.constructionStageKey)?.stageId ?? null;
  const cancellations: Array<{ reminderId: string; status: 'cancelled' | 'expired' | 'paused'; reason: string }> = [];
  for (const reminder of input.existing) {
    if (!['pending', 'paused', 'failed'].includes(reminder.status)) continue;
    if (input.facts.projectStatus !== 'active') {
      cancellations.push({ reminderId: reminder.reminderId, status: 'cancelled', reason: 'project_inactive' });
      continue;
    }
    if (reminder.stageId && reminder.stageId !== stageId) {
      cancellations.push({ reminderId: reminder.reminderId, status: 'expired', reason: 'stage_changed' });
      continue;
    }
    const recipients = input.facts.recipients[reminder.targetRole] ?? [];
    if (reminder.targetUserId && !recipients.includes(reminder.targetUserId)) {
      cancellations.push({ reminderId: reminder.reminderId, status: 'cancelled', reason: 'permission_revoked' });
      continue;
    }
    if (paused.some(prefix => reminder.dedupeKey.startsWith(prefix))) {
      cancellations.push({ reminderId: reminder.reminderId, status: 'paused', reason: 'paused' });
      continue;
    }
    if (!keys.has(reminder.dedupeKey)) {
      cancellations.push({ reminderId: reminder.reminderId, status: 'cancelled', reason: 'condition_cleared' });
    }
  }
  return cancellations;
}
