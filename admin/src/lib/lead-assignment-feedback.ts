export const ASSIGNMENT_STATUS_LABELS: Record<string, string> = {
  assigned: '已派单',
  assignment_pending: '待派单',
  not_requested: '未请求派单',
};

export const ASSIGNMENT_ERROR_LABELS: Record<string, string> = {
  designer_unavailable: '暂无可用设计师',
  measurer_unavailable: '暂无可用测量员',
  designer_and_measurer_unavailable: '设计师和测量员都不可用',
};

export const ASSIGNMENT_PENDING_HINTS: Record<string, string> = {
  designer_unavailable:
    '请到员工管理为设计师补齐微信号和个人微信二维码后再重试',
  measurer_unavailable:
    '请到员工管理确认测量员已入驻且未暂停派单后再重试',
  designer_and_measurer_unavailable:
    '请到员工管理补齐可用设计师（含微信号与二维码）和测量员后再重试',
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
