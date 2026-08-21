export const ENTERPRISE_STATUSES = [
  'pending_approval',
  'active',
  'disabled',
  'rejected',
] as const;

export type EnterpriseStatus = (typeof ENTERPRISE_STATUSES)[number];

export const ENTERPRISE_STATUS_ACTIONS = [
  'approve',
  'reject',
  'disable',
  'enable',
  'resubmit_review',
] as const;

export type EnterpriseStatusAction = (typeof ENTERPRISE_STATUS_ACTIONS)[number];

const TRANSITIONS: Record<
  EnterpriseStatusAction,
  { from: readonly EnterpriseStatus[]; to: EnterpriseStatus; reasonRequired: boolean }
> = {
  approve: {
    from: ['pending_approval', 'rejected'],
    to: 'active',
    reasonRequired: false,
  },
  reject: {
    from: ['pending_approval'],
    to: 'rejected',
    reasonRequired: true,
  },
  disable: {
    from: ['active'],
    to: 'disabled',
    reasonRequired: true,
  },
  enable: {
    from: ['disabled'],
    to: 'active',
    reasonRequired: false,
  },
  resubmit_review: {
    from: ['rejected'],
    to: 'pending_approval',
    reasonRequired: false,
  },
};

export const ENTERPRISE_STATUS_REASON_MIN = 4;
export const ENTERPRISE_STATUS_REASON_MAX = 200;

export class EnterpriseStatusTransitionError extends Error {
  readonly code: 'INVALID_ACTION' | 'INVALID_TRANSITION' | 'REASON_REQUIRED' | 'REASON_INVALID';

  constructor(
    code: EnterpriseStatusTransitionError['code'],
    message: string
  ) {
    super(message);
    this.code = code;
    this.name = 'EnterpriseStatusTransitionError';
  }
}

export function isEnterpriseStatus(value: unknown): value is EnterpriseStatus {
  return (
    typeof value === 'string' &&
    (ENTERPRISE_STATUSES as readonly string[]).includes(value)
  );
}

export function isEnterpriseStatusAction(
  value: unknown
): value is EnterpriseStatusAction {
  return (
    typeof value === 'string' &&
    (ENTERPRISE_STATUS_ACTIONS as readonly string[]).includes(value)
  );
}

export function isEnterpriseOperationallyActive(status: string | null | undefined) {
  return status === 'active';
}

export function enterpriseAccessDeniedMessage(status: string | null | undefined) {
  if (status === 'pending_approval') {
    return '企业仍在审核中，暂时无法登录';
  }
  if (status === 'rejected') {
    return '企业入驻申请未通过，暂时无法登录';
  }
  if (status === 'disabled') {
    return '企业已停用，暂时无法登录';
  }
  return '企业状态异常，暂时无法登录';
}

export function normalizeEnterpriseStatusReason(
  reason: unknown,
  required: boolean
): string | null {
  const trimmed =
    typeof reason === 'string' ? reason.trim() : reason == null ? '' : '';
  if (!trimmed) {
    if (required) {
      throw new EnterpriseStatusTransitionError(
        'REASON_REQUIRED',
        '请填写操作原因'
      );
    }
    return null;
  }
  if (
    trimmed.length < ENTERPRISE_STATUS_REASON_MIN ||
    trimmed.length > ENTERPRISE_STATUS_REASON_MAX
  ) {
    throw new EnterpriseStatusTransitionError(
      'REASON_INVALID',
      `操作原因需为 ${ENTERPRISE_STATUS_REASON_MIN}-${ENTERPRISE_STATUS_REASON_MAX} 个字符`
    );
  }
  return trimmed;
}

export function resolveEnterpriseStatusTransition(input: {
  currentStatus: string;
  action: unknown;
  reason?: unknown;
}) {
  if (!isEnterpriseStatusAction(input.action)) {
    throw new EnterpriseStatusTransitionError(
      'INVALID_ACTION',
      '不支持的企业状态操作'
    );
  }
  if (!isEnterpriseStatus(input.currentStatus)) {
    throw new EnterpriseStatusTransitionError(
      'INVALID_TRANSITION',
      '当前企业状态无效，无法变更'
    );
  }

  const transition = TRANSITIONS[input.action];
  if (!transition.from.includes(input.currentStatus)) {
    throw new EnterpriseStatusTransitionError(
      'INVALID_TRANSITION',
      `当前状态不允许执行该操作`
    );
  }

  const reason = normalizeEnterpriseStatusReason(
    input.reason,
    transition.reasonRequired
  );

  return {
    action: input.action,
    fromStatus: input.currentStatus,
    toStatus: transition.to,
    reason,
  };
}
