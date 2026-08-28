export const ASSIGNMENT_STATUS_LABELS: Record<string, string> = {
  assigned: '已派单',
  assignment_pending: '待派单',
  not_requested: '未请求派单',
};

export const ASSIGNMENT_ERROR_LABELS: Record<string, string> = {
  designer_unavailable: '暂无可用家装设计顾问',
  measurer_unavailable: '暂无可用家装现场顾问',
  designer_and_measurer_unavailable: '家装设计顾问和家装现场顾问都不可用',
};

export const ASSIGNMENT_PENDING_HINTS: Record<string, string> = {
  designer_unavailable:
    '请到员工管理为家装设计顾问补齐微信号和个人微信二维码后再重试',
  measurer_unavailable:
    '请到员工管理确认家装现场顾问已入驻且未暂停派单后再重试',
  designer_and_measurer_unavailable:
    '请到员工管理补齐可用家装设计顾问（含微信号与二维码）和家装现场顾问后再重试',
};

export function getAssignmentStatusLabel(
  status?: string | null,
  errorCode?: string | null
) {
  if (status === 'assignment_pending') {
    return errorCode
      ? ASSIGNMENT_ERROR_LABELS[errorCode] || '待派单'
      : '待派单';
  }
  return ASSIGNMENT_STATUS_LABELS[status || ''] || '未派单';
}

export function getAssignmentPendingHint(errorCode?: string | null) {
  if (!errorCode) return '可在下方重试派单';
  return ASSIGNMENT_PENDING_HINTS[errorCode] || '可在下方重试派单';
}

export function needsStaffWechatForAssignment(errorCode?: string | null) {
  return (
    errorCode === 'designer_unavailable' ||
    errorCode === 'designer_and_measurer_unavailable'
  );
}

export const ASSIGNMENT_EVENT_LABELS: Record<string, string> = {
  claim_opened: '进入抢单池',
  claim_succeeded: '设计师抢单成功',
  assignment_auto: '赛马自动派单',
  assignment_auto_pending: '自动派单待补全',
  assignment_pending: '派单待重试',
  assignment_created: '自动派单完成',
  assignment_manual: '负责人手动指派',
  assignment_reassigned: '负责人改派',
  assignment_manual_reassign: '负责人改派',
  assignment_manual_pending: '手动指派待补全',
  assignment_manual_reassign_pending: '改派待补全',
  assignment_retry_pending: '重试派单待补全',
  assignment_retry_succeeded: '重试派单成功',
  attribution_created: '锁定客户归属',
  attribution_reused: '复用已有归属',
};

export const CLAIM_WINDOW_RESOLUTION_LABELS: Record<string, string> = {
  lead_archived: '线索已归档',
  lead_closed: '线索已关闭',
  lead_closed_lost: '未签单结案',
  referrer_withdrawn: '推广人已撤销',
  designer_unavailable: '暂无可用家装设计顾问',
  designer_claimed: '设计师已抢单',
  manager_assignment: '负责人手动指派',
  lead_new: '线索状态变更为新线索',
  lead_measuring: '线索状态变更为量房中',
  lead_designing: '线索状态变更为方案设计',
  lead_converted: '线索状态变更为已签约',
};

export function getAssignmentEventTypeLabel(eventType: string | null | undefined) {
  const key = String(eventType || '').trim();
  if (!key) return '—';
  return ASSIGNMENT_EVENT_LABELS[key] || key;
}

export function getClaimResolutionReasonLabel(reason: string | null | undefined) {
  const key = String(reason || '').trim();
  if (!key) return '';
  return CLAIM_WINDOW_RESOLUTION_LABELS[key] || key;
}

export function getAssignmentErrorLabel(errorCode?: string | null) {
  const key = String(errorCode || '').trim();
  if (!key) return '';
  return ASSIGNMENT_ERROR_LABELS[key] || key;
}
