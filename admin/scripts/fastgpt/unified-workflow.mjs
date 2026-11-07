import { nativeKnowledgeWorkflow } from './native-knowledge-workflow.mjs';

/** Same pinned native ToolCall graph, with native conversation history and a
 * plain final answer instead of the historical structured stop-tool wrapper. */
export function unifiedWorkflow(modelId, tools) {
  const workflow = nativeKnowledgeWorkflow(modelId, tools);
  workflow.name = '小K统一装修会话 · 通用/联网/企业工艺';
  workflow.intro = '隔离开发；原生ToolCall按需查询，原服务授权、原答保存和引用。';
  for (const node of workflow.nodes) {
    for (const input of node.inputs) {
      if (input.key === 'system_httpReqUrl') input.value = input.value.replace('/native-', '/unified-');
      if (node.nodeId === 'dialogue') {
        if (input.key === 'isResponseAnswerText') input.value = true;
        if (input.key === 'history') input.value = 6;
        if (input.key === 'temperature') input.value = 0.3;
        if (input.key === 'userChatInput') input.value = ['start', 'userChatInput'];
      }
    }
  }
  return workflow;
}
