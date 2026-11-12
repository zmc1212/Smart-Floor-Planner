
export function delegationEnterprises(env = process.env): string[] {
  if (!['1', 'true'].includes(env.NATIVE_WORKFLOW_DELEGATION_ENABLED?.trim().toLowerCase() ?? '')) return [];
  return [...new Set((env.NATIVE_WORKFLOW_DELEGATION_ENTERPRISE_IDS ?? '').split(',')
    .map(value => value.trim()).filter(value => /^[1-9]\d{0,17}$/.test(value)))];
}

export function delegationsEnabled(enterpriseId: string) {
  return delegationEnterprises().includes(enterpriseId);
}
