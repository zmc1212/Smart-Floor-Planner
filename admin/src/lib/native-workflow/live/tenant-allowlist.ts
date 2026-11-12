export const MAX_NATIVE_WORKFLOW_SCHEDULE_ENTERPRISES = 20;

export function nativeWorkflowEnabled(value: string | undefined) {
  const flag = value?.trim().toLowerCase();
  return flag === '1' || flag === 'true';
}

export function nativeWorkflowEnterpriseIds(value: string | undefined) {
  return [...new Set((value ?? '').split(/[\s,]+/).filter(id =>
    /^[1-9]\d{0,18}$/.test(id) && BigInt(id) <= 9223372036854775807n))];
}
