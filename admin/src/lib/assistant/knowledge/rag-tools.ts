import { ToolRegistry } from '../tools/registry';
import type { ToolDefinition, ToolJsonSchema } from '../tools/contract';
import { knowledgeProviderMode } from './bailian-provider';
export const knowledgeSearchModes = ['hybrid', 'keyword', 'vector'] as const;

export const knowledgeToolProtocol = 'enterprise-rag-tools-v1';
export const knowledgeToolNames = ['knowledge_search', 'knowledge_get_document', 'knowledge_get_source', 'knowledge_search_by_category'] as const;
export type KnowledgeToolName = typeof knowledgeToolNames[number];

export function isKnowledgeTool(name: string): name is KnowledgeToolName {
  return knowledgeToolNames.some(tool => tool === name);
}

const identifier = { type: 'string', pattern: '^[1-9][0-9]{0,18}$' };
const search = {
  query: { type: 'string', minLength: 1, maxLength: 1000 },
  mode: { type: 'string', enum: [...knowledgeSearchModes], description: '默认混合检索，已知原词可用keyword。' },
  scope: { type: 'string', enum: ['enterprise', 'project'], description: '可缩小到企业通用或当前项目；项目身份由会话绑定。' },
  topK: { type: 'integer', minimum: 1, maximum: 5 },
  minSimilarity: { type: 'number', minimum: 0, maximum: 1, description: '适用于当前供应商的向量或混合分数。' },
  category: { type: 'string', minLength: 1, maxLength: 100, description: '文档分类的完整名称。' },
  documentId: identifier,
};
function params(required: string[], properties: Record<string, unknown>): ToolJsonSchema {
  return { type: 'object', properties, required, additionalProperties: false };
}
export const knowledgeToolDefinitions = [
  { name: 'knowledge_search', parameters: params(['query'], search),
    description: '检索当前有效的企业工艺、施工标准及适用项目文件，提供原文片段、版本与定位。用于询问本企业做法、施工条件或企业规定。' },
  { name: 'knowledge_get_document', parameters: params(['documentId'], { documentId: identifier }),
    description: '根据已获权的文档ID读取当前有效版本的元数据和开头片段。需要特定段落时对该文档检索。' },
  { name: 'knowledge_get_source', parameters: params(['chunkId', 'versionId'], { chunkId: identifier, versionId: identifier }),
    description: '根据工具返回的片段ID和版本ID，读取同一获权原文及章节、页码或原件定位。' },
  { name: 'knowledge_search_by_category', parameters: params(['query', 'category'], search),
    description: '在已知分类名称内检索当前获权片段。施工标准、材料与产品、验收规范和历史案例的适用范围由文档及会话决定。历史案例只提供参考。' },
] satisfies Array<{ name: KnowledgeToolName; description: string; parameters: ToolJsonSchema }>;

export function knowledgeToolsForProvider() {
  if (knowledgeProviderMode() === 'local') return knowledgeToolDefinitions;
  return knowledgeToolDefinitions.map(definition => definition.name === 'knowledge_search' || definition.name === 'knowledge_search_by_category'
    ? { ...definition, parameters: params(definition.parameters.required ?? [], { ...search, mode: { ...search.mode, enum: ['hybrid','keyword'] } }) }
    : definition);
}

export function createKnowledgeToolRegistry(ports: Pick<ToolDefinition, 'authorize' | 'execute'>) {
  const registry = new ToolRegistry();
  for (const definition of knowledgeToolsForProvider()) registry.register({ ...definition, ...ports, risk: 'read', timeoutMs: 40_000 });
  return registry;
}
