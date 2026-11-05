import { fail } from './contracts';
import type { ModelTool } from './contracts/model';

/** Enterprise-wide source choice, independent of provider/model capability.
 * Kept in the existing enterprise JSON configuration; no second Agent/store. */
export const knowledgePolicyProtocol = 'enterprise-knowledge-policy-v1';
export type KnowledgePolicy = { protocol: typeof knowledgePolicyProtocol; enabled: boolean };
export function enterpriseKnowledgeEnabled(config: unknown): boolean {
  return !!config && typeof config === 'object' && !Array.isArray(config)
    && (config as Record<string, unknown>).enterpriseKnowledgeEnabled === true;
}
export function knowledgePolicy(config: unknown): KnowledgePolicy {
  return { protocol: knowledgePolicyProtocol, enabled: enterpriseKnowledgeEnabled(config) };
}
export function boundKnowledgePolicy(value: unknown): KnowledgePolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 2 || (value as KnowledgePolicy).protocol !== knowledgePolicyProtocol
    || typeof (value as KnowledgePolicy).enabled !== 'boolean') fail('context_changed');
  return value as KnowledgePolicy;
}
export function runKnowledgeEnabled(policy: Record<string, unknown>): boolean {
  return policy.knowledgePolicy === undefined ? true : boundKnowledgePolicy(policy.knowledgePolicy).enabled;
}
export function assertKnowledgePolicy(value: unknown, config: unknown) {
  // Historical runs predate the switch and may contain enterprise material.
  // Only the enabled mode can continue them; switching off never replays them.
  const enabled = value === undefined ? true : boundKnowledgePolicy(value).enabled;
  if (enabled !== enterpriseKnowledgeEnabled(config)) fail('context_changed');
}
export function knowledgeTools(tools: ModelTool[], enabled: boolean) {
  return enabled ? tools : tools.filter(tool => !['search_knowledge', 'recommend_references', 'record_reference_preference'].includes(tool.name));
}
export const generalKnowledgeInstructions = '当前未结合企业知识库。可用模型自身知识自然回答一般装修问题；按需使用实际联网来源。企业制度、指定企业文件内容及个人项目事实没有当前来源时明确待核实，不用通用知识冒充。不声称检索过企业资料，不沿用旧企业引用或旧知识结论。通用建议不代表企业标准、报价、工期或验收结论；实际业务和保存仅以当前获权服务回执为准。';
