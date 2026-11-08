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

/** Use the verified native chatNode template and its stock quote renderer.
 * ToolCall is only a web reader and its intermediate text is not an answer. */
export function unifiedQuoteWorkflow(modelId, tools, datasetNode, classifications, chatNode) {
  const workflow = unifiedWorkflow(modelId, tools, datasetNode, classifications);
  const get = id => workflow.nodes.find(n => n.nodeId === id);
  const set = (node, key, value) => { node.inputs.find(i => i.key === key).value = value; };
  const output = (key, valueType) => ({ id: key, key, label: key, valueType, type: 'static' });
  const edge = (source, target, handle = 'right') => ({ source, target, sourceHandle: `${source}-source-${handle}`, targetHandle: `${target}-target-left` });
  const condition = (nodeId, name, position, variable, branchId) => ({ nodeId, name, position, flowNodeType: 'ifElseNode',
    inputs: [{ key: 'ifElseList', label: '', valueType: 'any', renderTypeList: ['hidden'], value: [
      { branchId, condition: 'AND', list: [{ variable, condition: 'equalTo', value: true, valueType: 'input' }] },
    ] }], outputs: [output('ifElseResult', 'string')] });
  const sources = get('sources'), research = get('dialogue');
  sources.outputs.push(output('webRequired', 'boolean'));
  research.name = '原生联网取证';
  set(research, 'isResponseAnswerText', false);
  const route = condition('web-route', '按原生分类决定本轮联网', { x: 715, y: -150 }, ['sources', 'webRequired'], 'web');
  const quotes = structuredClone(get('load'));
  Object.assign(quotes, { nodeId: 'quotes', name: '原服务提供获权引用', position: { x: 1070, y: -150 },
    outputs: [output('instructions', 'string'), output('quotes', 'datasetQuote'), output('history', 'chatHistory'), output('quotePrompt', 'string')] });
  set(quotes, 'system_httpReqUrl', 'http://host.docker.internal:18310/unified-quotes');
  const answer = structuredClone(chatNode);
  Object.assign(answer, { nodeId: 'answer', name: '原生AI对话与引用', position: { x: 1290, y: -150 } });
  set(answer, 'modelId', modelId);
  set(answer, 'maxToken', 2048);
  set(answer, 'userChatInput', ['start', 'userChatInput']);
  set(answer, 'systemPrompt', ['quotes', 'instructions']);
  set(answer, 'quoteQA', ['quotes', 'quotes']);
  for (const key of ['history', 'quotePrompt']) Object.assign(answer.inputs.find(i => i.key === key), {
    value: ['quotes', key], renderTypeList: ['reference'], selectedType: 'reference',
  });
  workflow.nodes.push(route, quotes, answer);
  workflow.edges = workflow.edges.filter(e => !(e.source === 'sources' && e.target === 'dialogue'));
  workflow.edges.push(edge('sources', 'web-route'), edge('web-route', 'dialogue', 'web'), edge('web-route', 'quotes', 'ELSE'),
    edge('dialogue', 'quotes'), edge('quotes', 'answer'));
  for (const id of ['search_web', 'read_web']) {
    const tool = get(id), budget = `${id}-budget`, stop = `${id}-stop`, result = `${id}-result`, y = tool.position.y;
    tool.outputs.push(output('researchDone', 'boolean'));
    workflow.nodes.push(condition(budget, '取证轮次已用完', { x: 1100, y }, [id, 'researchDone'], 'stop'),
      { nodeId: stop, name: '交接已读取的原文', flowNodeType: 'stopTool', position: { x: 1300, y: y - 75 }, inputs: [], outputs: [] },
      // Native IfElse emits its branch label as the tool result. Restore the
      // actual guarded response for the research model on the continue branch.
      { nodeId: result, name: '返回原搜索或读取回执', flowNodeType: 'pluginOutput', position: { x: 1300, y: y + 75 },
        inputs: [{ key: 'result', label: '', valueType: 'string', renderTypeList: ['reference'], selectedType: 'reference', value: [id, 'result'] }],
        outputs: [] });
    workflow.edges.push(edge(id, budget), edge(budget, stop, 'stop'), edge(budget, result, 'ELSE'));
  }
  workflow.name = '小K统一装修会话 · 原生引用范围';
  workflow.intro = '隔离开发；按需检索企业或网页原文，复用原服务授权、保存和引用，原生AI对话按quoteQA作答。';
  return workflow;
}
