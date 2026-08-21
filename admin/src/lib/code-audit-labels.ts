/**
 * Chinese labels for join-code / open-account-code Admin audit tables.
 * Keys stay English in the database; only the Admin UI maps them for operators.
 */

export const CODE_AUDIT_EVENT_TYPE_LABELS: Record<string, string> = {
  reveal: '查看二维码',
  rotate_out: '换新（旧码失效）',
  rotate_in: '换新（新码生效）',
  disable: '停用',
  resolve: '扫码解析',
  staff_onboarding: '员工入驻',
  referrer_onboarding: '推荐人入驻',
  submit: '提交开户申请',
};

export const CODE_AUDIT_RESULT_LABELS: Record<string, string> = {
  ok: '解析成功',
  active: '已生效',
  token_revealed: '已展示二维码',
  code_rotated: '码已换新',
  code_disabled: '码已停用',
  code_expired: '码已过期',
  code_not_found: '码不存在',
  code_type_mismatch: '码类型不匹配',
  phone_authorization_required: '需授权手机号',
  staff_enterprise_conflict: '已加入其他企业',
  already_joined: '已入驻',
  joined: '入驻成功',
  referrer_disabled: '推荐人已停用',
  membership_limit_reached: '推荐人企业数已达上限',
  submitted: '开户申请已提交',
  phone_mismatch: '手机号不匹配',
  submit_failed: '提交失败',
  VALIDATION: '资料校验失败',
  ACCOUNT_CONFLICT: '账号冲突',
  '23505': '唯一约束冲突',
};

const SUCCESS_RESULTS = new Set([
  'ok',
  'active',
  'joined',
  'already_joined',
  'token_revealed',
  'submitted',
]);

const ERROR_RESULTS = new Set([
  'staff_enterprise_conflict',
  'membership_limit_reached',
  'code_not_found',
  'phone_mismatch',
  'submit_failed',
  'ACCOUNT_CONFLICT',
  'VALIDATION',
  '23505',
  'referrer_disabled',
  'code_type_mismatch',
  'phone_authorization_required',
]);

const WARNING_RESULTS = new Set([
  'code_expired',
  'code_disabled',
  'code_rotated',
]);

export function getCodeAuditEventTypeLabel(eventType: string | null | undefined) {
  const key = String(eventType || '').trim();
  if (!key) return '—';
  return CODE_AUDIT_EVENT_TYPE_LABELS[key] || key;
}

export function getCodeAuditResultLabel(result: string | null | undefined) {
  const key = String(result || '').trim();
  if (!key) return '—';
  return CODE_AUDIT_RESULT_LABELS[key] || key;
}

export function getCodeAuditResultTagColor(result: string | null | undefined) {
  const key = String(result || '').trim();
  if (SUCCESS_RESULTS.has(key)) return 'green';
  if (ERROR_RESULTS.has(key)) return 'red';
  if (WARNING_RESULTS.has(key)) return 'orange';
  return 'default';
}
