import { nativeKnowledgeWorkflow } from './native-knowledge-workflow.mjs';

/** Same pinned native ToolCall graph, with native conversation history and a
 * plain final answer instead of the historical structured stop-tool wrapper. */
export function unifiedWorkflow(modelId, tools, datasetNode, classifications) {
  if (datasetNode) tools = tools.filter(t => t.name !== 'search_enterprise');
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
  if (datasetNode) {
    const search = structuredClone(datasetNode), load = workflow.nodes.find(n => n.nodeId === 'load');
    search.nodeId = 'enterprise'; search.name = '获权企业知识·原生混合检索';
    search.position = { x: 350, y: 100 };
    search.inputs.find(i => i.key === 'datasetSearchInput').value = [['load', 'knowledgeQuery']];
    load.outputs.push({ id: 'knowledgeQuery', key: 'knowledgeQuery', label: 'knowledgeQuery', valueType: 'string', type: 'static' });
    // An empty authorized query uses the upstream emptyResult path: no search,
    // embedding or enterprise material. No topic classifier or prompt router.
    const guard = structuredClone(load);
    guard.nodeId = 'sources'; guard.name = '原服务复核知识原文与当前权限'; guard.position = { x: 520, y: 100 };
    guard.inputs.find(i => i.key === 'system_httpMethod').value = 'POST';
    guard.inputs.find(i => i.key === 'system_httpReqUrl').value = 'http://host.docker.internal:18310/unified-sources';
    guard.inputs.find(i => i.key === 'system_httpJsonBody').value = '{{$enterprise.quoteQA$}}';
    guard.outputs = load.outputs.filter(i => i.key !== 'knowledgeQuery' && i.key !== 'input');
    const dialogue = workflow.nodes.find(n => n.nodeId === 'dialogue');
    dialogue.inputs.find(i => i.key === 'systemPrompt').value = ['sources', 'instructions'];
    dialogue.position = { x: 750, y: 100 };
    workflow.nodes.splice(2, 0, search, guard);
    const edge = (source, target) => ({ source, target, sourceHandle: source + '-source-right', targetHandle: target + '-target-left' });
    workflow.edges = workflow.edges.filter(e => !(e.source === 'load' && e.target === 'dialogue'));
    workflow.edges.push(edge('load', 'enterprise'), edge('enterprise', 'sources'), edge('sources', 'dialogue'));
    workflow.intro = '隔离开发；原生知识检索前置、原服务授权、原生ToolCall联网与作答，原答保存及引用。';
    if (classifications) {
      load.outputs.push({ id: 'classifierMarker', key: 'classifierMarker', label: 'classifierMarker', valueType: 'string', type: 'static' });
      const input = (key, value, valueType = 'string') => ({ key, label: key, value, valueType, renderTypeList: ['hidden'] });
      const classify = { nodeId: 'classify', name: '原生问题分类·企业材料需求', flowNodeType: 'classifyQuestion', version: '4.9.2',
        position: { x: 320, y: -160 }, showStatus: true, catchError: false,
        inputs: [input('modelId', modelId), input('systemPrompt', ['load', 'classifierMarker']), input('history', 6, 'chatHistory'),
          input('userChatInput', ['start', 'userChatInput']), input('agents', classifications, 'any')],
        outputs: [{ id: 'cqResult', key: 'cqResult', label: 'cqResult', valueType: 'string', type: 'static' }] };
      for (const key of ['systemPrompt', 'userChatInput']) Object.assign(classify.inputs.find(i => i.key === key), {
        renderTypeList: ['reference'], selectedType: 'reference',
      });
      const query = structuredClone(guard);
      query.nodeId = 'query'; query.name = '原服务按分类与权限准备查询'; query.position = { x: 480, y: -160 };
      query.inputs.find(i => i.key === 'system_httpReqUrl').value = 'http://host.docker.internal:18310/unified-query';
      query.inputs.find(i => i.key === 'system_httpJsonBody').value = '{"selection":"{{$classify.cqResult$}}"}';
      query.outputs = [load.outputs.find(i => i.key === 'knowledgeQuery')];
      search.inputs.find(i => i.key === 'datasetSearchInput').value = [['query', 'knowledgeQuery']];
      workflow.nodes.splice(2, 0, classify, query);
      workflow.edges = workflow.edges.filter(e => !(e.source === 'load' && e.target === 'enterprise'));
      workflow.edges.push(edge('load', 'classify'), edge('query', 'enterprise'),
        ...classifications.map(c => ({ ...edge('classify', 'query'), sourceHandle: 'classify-source-' + c.key })));
      workflow.intro = '隔离开发；原生问题分类控制企业检索，原服务守权限，原生ToolCall联网与作答，原答保存及引用。';
    }
  }
  return workflow;
}
