import type { WorkflowDefinition, WorkflowNode } from './types';

export const stageConsultationTemplates = {
  'stage-guidance': { name: '阶段知识问答', description: '按当前阶段和提问查找装修常识与准备事项。', port: 'answer' },
  'stage-checklist': { name: '现场核对清单', description: '整理当前阶段到现场可以逐项核对的事项。', port: 'checklist' },
} as const;

export type StageTemplateId = keyof typeof stageConsultationTemplates;
export const stageConsultationNodeLabels: Readonly<Record<string, string>> = {
  'trigger.stage_consultation': '阶段 Agent 调用',
  'read.stage_guide': '读取当前阶段知识',
  'condition.compare_boolean': '条件判断',
  'output.stage_guide': '返回给 Agent',
};
export const stageGuidePorts = { answer: '阶段解答', checklist: '现场核对清单', nextStage: '下一阶段准备', matched: '匹配到常见问题' } as const;

export function createStageConsultationDefinition(templateId: StageTemplateId): WorkflowDefinition {
  const { name, description, port } = stageConsultationTemplates[templateId];
  return {
    schemaVersion: 1, definitionId: templateId, revision: 1, entryNodeId: 'entry',
    inputSchema: { eventType: 'stage_consultation' },
    nodes: [
      { nodeId: 'entry', type: 'trigger', typeVersion: 1, capabilityRef: 'trigger.stage_consultation',
        config: { eventType: 'stage_consultation', name, description } },
      { nodeId: 'guide', type: 'read_materials', typeVersion: 1, capabilityRef: 'read.stage_guide' },
      { nodeId: 'reply', type: 'output', typeVersion: 1, capabilityRef: 'output.stage_guide',
        inputs: { text: { nodeId: 'guide', outputPath: port } } },
    ],
    edges: [{ from: 'entry', to: 'guide' }, { from: 'guide', to: 'reply' }],
  };
}

export function stageWorkflowMetadata(definition: WorkflowDefinition) {
  const entry = definition.nodes.find((node: WorkflowNode) => node.nodeId === definition.entryNodeId);
  return { name: String(entry?.config?.name ?? definition.definitionId), description: String(entry?.config?.description ?? '') };
}
