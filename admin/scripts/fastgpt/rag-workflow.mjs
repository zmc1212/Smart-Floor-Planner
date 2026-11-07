// Extend the accepted native RAG with the original service's authorization
// boundary. The dataset, search settings and native quote prompt stay exact.
export function ragWorkflow(original, transportModelId) {
  const workflow = structuredClone(original), search = workflow.nodes.find(n => n.flowNodeType === 'datasetSearchNode'),
    chat = workflow.nodes.find(n => n.flowNodeType === 'chatNode');
  if (workflow.nodes.length !== 3 || !search || !chat) throw Error('Expected the verified three-node native RAG');
  const input = (key, value, valueType = 'string') => ({ key, label: key, value, valueType, renderTypeList: ['hidden'] });
  const output = (key, valueType) => ({ id: key, key, label: key, valueType, type: 'static' });
  const guard = { nodeId: 'xiaokSources', name: '原服务当前来源授权', flowNodeType: 'httpRequest468', catchError: false, showStatus: true,
    position: { x: 2300, y: -500 }, inputs: [input('system_httpMethod', 'POST'), input('system_httpTimeout', 30, 'number'),
      input('system_httpReqUrl', 'http://host.docker.internal:18310/rag-sources'),
      input('system_httpHeader', [{ key: 'Authorization', value: 'Bearer {{workflowTicket}}', type: 'string' }], 'any'),
      input('system_httpContentType', 'json'), input('system_httpJsonBody', '{{$' + search.nodeId + '.quoteQA$}}', 'any')],
    outputs: [output('httpRawResponse', 'any'), output('quotes', 'datasetQuote'), output('instructions', 'string')] };
  chat.inputs.find(i => i.key === 'modelId').value = transportModelId;
  chat.inputs.find(i => i.key === 'quoteQA').value = [guard.nodeId, 'quotes'];
  Object.assign(chat.inputs.find(i => i.key === 'systemPrompt'), { value: [guard.nodeId, 'instructions'], selectedType: 'reference', renderTypeList: ['reference'] });
  workflow.nodes.splice(2, 0, guard);
  const previous = workflow.edges.find(e => e.source === search.nodeId && e.target === chat.nodeId);
  previous.target = guard.nodeId; previous.targetHandle = guard.nodeId + '-target-left';
  workflow.edges.push({ source: guard.nodeId, sourceHandle: guard.nodeId + '-source-right', target: chat.nodeId, targetHandle: chat.nodeId + '-target-left' });
  workflow.chatConfig = { variables: [{ id: 'workflowTicket', key: 'workflowTicket', label: '原服务本轮票据', description: '短期单任务授权票据，仅传输使用', type: 'input', required: true }], questionGuide: { open: false } };
  return { ...workflow, name: '合成测试·微云1454·PPT工艺小K会话接入', type: 'advanced', intro: '原生RAG；原服务授权、模型计量、保存与引用撤回。仅隔离开发库。' };
}
