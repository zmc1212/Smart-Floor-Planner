import type { LeadWithRelations } from '@/db/repositories';
import { ActionPermissionRepository } from '@/db/repositories';
import type { LeadLifecycleImpact } from '@/db/repositories';
import type { PostgresTransaction } from '@/db/transaction';
import { httpError } from '@/lib/http-error';

export const LEAD_ARCHIVE_CAPABILITY = 'leads.archive_manage';

export const LEAD_ARCHIVE_REASONS = {
  no_intent: '无意向',
  lost_contact: '失联',
  invalid_contact: '无效联系方式',
  duplicate: '重复线索',
  mistaken_entry: '误录',
  other: '其他',
} as const;

export type LeadArchiveReason = keyof typeof LEAD_ARCHIVE_REASONS;
export type LeadArchiveCapabilityOverride = 'inherit' | 'allow' | 'deny';

const MANAGER_ROLES = new Set(['super_admin', 'admin', 'enterprise_admin']);
const DELEGATABLE_ROLES = new Set(['designer', 'measurer']);

export function isLeadArchiveReason(value: unknown): value is LeadArchiveReason {
  return typeof value === 'string' && value in LEAD_ARCHIVE_REASONS;
}

export function leadArchivedError() {
  return Object.assign(httpError('该客户线索已归档，请先恢复后再操作', 409), {
    code: 'LEAD_ARCHIVED',
  });
}

export function archivedLeadExistsError() {
  return Object.assign(httpError('该手机号已有归档客户档案，请先恢复后再继续', 409), {
    code: 'ARCHIVED_LEAD_EXISTS',
  });
}

export function canAccessLeadForActor(
  lead: Pick<LeadWithRelations, 'promoterId' | 'assignedTo'>,
  role: string,
  actorId: bigint
) {
  return MANAGER_ROLES.has(role) || lead.promoterId === actorId || lead.assignedTo === actorId;
}

export function canPurgeLeads(role: string) {
  return MANAGER_ROLES.has(role);
}

export function resolveDelegatedLeadArchiveCapability(input: {
  role: string;
  roleDefault?: boolean;
  override?: LeadArchiveCapabilityOverride;
}) {
  if (MANAGER_ROLES.has(input.role)) return true;
  if (!DELEGATABLE_ROLES.has(input.role)) return false;
  if (input.override === 'allow') return true;
  if (input.override === 'deny') return false;
  return input.roleDefault === true;
}

export async function canManageLeadArchive(
  transaction: PostgresTransaction,
  input: { role: string; actorId: bigint; enterpriseId: bigint }
) {
  if (MANAGER_ROLES.has(input.role)) return true;
  if (!DELEGATABLE_ROLES.has(input.role)) return false;
  return new ActionPermissionRepository(transaction).resolve(
    input.enterpriseId,
    input.actorId,
    input.role,
    LEAD_ARCHIVE_CAPABILITY
  );
}

export function getPurgeBlockers(impact: LeadLifecycleImpact) {
  const blockers: string[] = [];
  if (!impact.archived) blockers.push('线索尚未归档');
  if (impact.floorPlanCount > 0) blockers.push(`关联 ${impact.floorPlanCount} 个户型或量房档案`);
  if (impact.aiWorkflowCount > 0) blockers.push(`关联 ${impact.aiWorkflowCount} 个 AI 方案工作流`);
  if (impact.aiGenerationCount > 0) blockers.push(`关联 ${impact.aiGenerationCount} 条 AI 生成记录`);
  if (impact.inFlightAiCount > 0) blockers.push(`仍有 ${impact.inFlightAiCount} 个 AI 任务运行中`);
  if (impact.hasAcquisition) blockers.push('存在获客确认事实');
  if (impact.commissionCount > 0) blockers.push(`存在 ${impact.commissionCount} 条获客提成记录`);
  if (impact.followUpCount > 0) blockers.push(`存在 ${impact.followUpCount} 条跟进记录`);
  return blockers;
}

export function serializeLeadLifecycleImpact(impact: LeadLifecycleImpact) {
  const blockers = getPurgeBlockers(impact);
  return {
    leadId: impact.leadId.toString(),
    archived: impact.archived,
    floorPlanCount: impact.floorPlanCount,
    aiWorkflowCount: impact.aiWorkflowCount,
    aiGenerationCount: impact.aiGenerationCount,
    inFlightAiCount: impact.inFlightAiCount,
    followUpCount: impact.followUpCount,
    hasAcquisition: impact.hasAcquisition,
    commissionCount: impact.commissionCount,
    canArchive: !impact.archived && impact.inFlightAiCount === 0,
    archiveBlockers:
      impact.inFlightAiCount > 0
        ? [`仍有 ${impact.inFlightAiCount} 个 AI 任务运行中`]
        : [],
    canPurge: blockers.length === 0,
    purgeBlockers: blockers,
  };
}
