// Official v4.17.4 ToolCall + HTTP tools + signal-only stopTool. The native
// shared agentLoop is the sole question/answer controller for this pilot.
export function nativeKnowledgeWorkflow(modelId, tools) {
  const input = (key, value, valueType = 'string', renderTypeList = ['hidden']) => ({ key, label: key, value, valueType, renderTypeList });
  const output = key => ({ id: key, key, label: key, valueType: 'string', type: 'static' });
  const http = (id, method, url, body, outputs = ['result']) => ({
    nodeId: id, name: id, flowNodeType: 'httpRequest468', showStatus: true, catchError: false,
    position: { x: 800, y: 100 }, inputs: [
      input('system_httpMethod', method), input('system_httpTimeout', 120, 'number'),
      input('system_httpReqUrl', 'http://host.docker.internal:18310' + url),
      input('system_httpHeader', [{ key: 'Authorization', value: 'Bearer {{workflowTicket}}', type: 'string' }], 'any'),
      input('system_httpContentType', 'json'), input('system_httpJsonBody', body, 'any'),
    ], outputs: [output('httpRawResponse'), ...outputs.map(output)],
  });
  const nodes = [
    { nodeId: 'start', name: '统一小K本轮问答', flowNodeType: 'workflowStart', position: { x: 0, y: 100 }, inputs: [], outputs: [output('userChatInput')] },
    http('load', 'GET', '/native-input', '', ['instructions', 'input']),
    { nodeId: 'dialogue', name: '小K原生问答与工具调用', flowNodeType: 'tools', version: '4.9.2', position: { x: 520, y: 100 }, showStatus: true, catchError: false,
      inputs: [input('modelId', modelId, 'string', ['settingLLMModel']), input('temperature', 0.2, 'number'),
        input('maxToken', 2048, 'number'), input('isResponseAnswerText', false, 'boolean'),
        input('aiChatVision', false, 'boolean'), input('aiChatReasoning', false, 'boolean'), input('history', 0, 'chatHistory'),
        input('systemPrompt', ['load', 'instructions'], 'string', ['reference']), input('userChatInput', ['load', 'input'], 'string', ['reference'])],
      outputs: [output('answerText')] },
  ];
  const edges = [
    { source: 'start', target: 'load', sourceHandle: 'start-source-right', targetHandle: 'load-target-left' },
    { source: 'load', target: 'dialogue', sourceHandle: 'load-source-right', targetHandle: 'dialogue-target-left' },
  ];
  for (const [index, tool] of tools.entries()) {
    const node = http(tool.name, 'POST', '/native-tool/' + tool.name, '{{payload}}');
    node.name = tool.name;
    node.intro = tool.description;
    node.position = { x: 900, y: index * 220 };
    // An object input keeps the existing nested JSON Schema intact. Fixed URL,
    // authorization and other HTTP settings are never model-generated fields.
    node.inputs.push({ key: 'payload', label: '参数', valueType: 'object', renderTypeList: ['agentGenerated'], selectedType: 'agentGenerated',
      required: true, customJsonSchema: tool.parameters });
    nodes.push(node);
    edges.push({ source: 'dialogue', target: node.nodeId, sourceHandle: 'dialogue-source-right', targetHandle: 'selectedTools' });
    if (tool.name === 'final_response') {
      nodes.push({ nodeId: 'done', name: '结束本轮问答', flowNodeType: 'stopTool', position: { x: 1200, y: index * 220 }, inputs: [], outputs: [] });
      edges.push({ source: node.nodeId, target: 'done', sourceHandle: node.nodeId + '-source-right', targetHandle: 'done-target-left' });
    }
  }
  return { name: '小K原生知识问答 · 最小对照', type: 'advanced',
    intro: '单一FastGPT原生问答循环；原服务守权限、来源、逐次计量与最终保存。仅隔离开发显式启用。', nodes, edges,
    chatConfig: { variables: [{ id: 'workflowTicket', key: 'workflowTicket', label: '本轮票据',
      description: '短期单任务权限票据，仅传输桥接使用，不进入实际模型输入', type: 'input', required: true }], questionGuide: { open: false } } };
}
