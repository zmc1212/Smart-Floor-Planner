/** Platform administrators manage selected-enterprise knowledge; other XiaoK grants remain opt-in. */
export const ASSISTANT_PERMISSIONS = ['assistant-knowledge', 'assistant-usage', 'assistant-retention'] as const;

export function assistantPermissions(role: string | undefined, permissions: readonly string[] = []) {
  if (role === 'super_admin' || role === 'admin') return ['assistant-knowledge'];
  return role === 'enterprise_admin' ? permissions.filter(key => ASSISTANT_PERMISSIONS.some(value => value === key)) : [];
}

export function hasAssistantKnowledgeAccess(role: string | undefined, permissions: readonly string[] = []) {
  return assistantPermissions(role, permissions).includes('assistant-knowledge');
}
