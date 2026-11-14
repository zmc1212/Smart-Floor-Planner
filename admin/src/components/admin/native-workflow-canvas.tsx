'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Descriptions, Empty, Flex, Select, Space, Tag, Typography, theme } from 'antd';
import type { Graph } from '@antv/x6';
import { specialists, waterproofAgentId } from '@/lib/assistant/specialists/registry';
import { capabilityCatalog, specialistInputMatches, specialistNodeSettings, getCapability } from '@/lib/native-workflow/registry';
import { WORKFLOW_BOUNDS, type JsonValue, type NodeType, type WorkflowDefinition, type WorkflowEdge, type WorkflowNode } from '@/lib/native-workflow/types';

const labels: Partial<Record<NodeType, string>> = {
  trigger: '业主发起跟进', project_data: '项目及房间', knowledge_retrieval: '企业工艺', public_search: '公开规范',
  agent: '专业 Agent', condition: '条件判断', wait_event: '等待现场资料', create_issue: '登记施工事项',
  evidence_assessment: '复核引用依据',
  human_review: '项目经理复核', output: '回传原咨询', checklist: '生成检查清单', request_material: '请求补充资料',
};
const capabilities = Object.entries(capabilityCatalog).filter(([key, spec]) =>
  !!labels[spec.type] && (spec.type !== 'trigger' || key === 'trigger.specialist_followup')
    && (spec.type !== 'condition' || ['condition.compare_boolean', 'condition.specialist_evidence'].includes(key)));
const publishedAgents = specialists.list().filter(agent => agent.status !== 'draft');
const defaultSpecialist = (specialists.active(waterproofAgentId) ?? publishedAgents[0])!;
const agentKey = (agent: Readonly<{ agentId: string; version: number }>) => `${agent.agentId}@${agent.version}`;
const controlInput = 'control-in';
const controlPort = (when?: WorkflowEdge['when']) => 'control-' + (when ?? 'out');
const dragType = 'application/x-sfp-workflow-node';
const branchLabel = (when?: WorkflowEdge['when']) => when === 'true' ? '满足' : when === 'false' ? '依据不足' : when === 'issue' ? '现场问题' : '下一节点';

function branches(node: WorkflowNode): ReadonlyArray<WorkflowEdge['when']> {
  if (node.type === 'output') return [];
  if (node.type !== 'condition') return [undefined];
  return node.capabilityRef === 'condition.specialist_evidence' ? ['true', 'false', 'issue'] : ['true', 'false'];
}

const settings = specialistNodeSettings;
type SettingOption = { value: string | number; label: string };
type NodeSetting = { key: string; label: string; fallback: string | number; options: readonly SettingOption[] };
const options = <T extends string | number>(values: readonly T[], labels?: readonly string[]) =>
  values.map((value, index) => ({ value, label: labels?.[index] ?? String(value) }));
const siteWaitDays = { key: 'waitDays', label: '现场等待天数', fallback: 30, options: options(settings.siteWaitDays) };
const nodeSettings: Readonly<Record<string, readonly NodeSetting[]>> = {
  'read.specialist_project': [{ key: 'recordLimit', label: '现场记录上限', fallback: 10, options: options(settings.projectRecords) }],
  'read.specialist_knowledge': [
    { key: 'scope', label: '知识范围', fallback: 'authorized', options: options(settings.knowledgeScopes, ['全部获权范围', '企业通用', '本项目']) },
    { key: 'topK', label: '检索条目数', fallback: 3, options: options(settings.knowledgeLimits) },
  ],
  'read.specialist_public_standard': [{ key: 'coverage', label: '规范页范围', fallback: 'subject',
    options: options(settings.publicCoverage, ['按问题选页', '施工与室内节点', '试验与验收']) }],
  'condition.specialist_evidence': [{ key: 'evidencePolicy', label: '清单所需依据', fallback: 'any',
    options: options(settings.evidencePolicies, ['企业或公开任一', '同时需要企业和公开', '仅要求企业', '仅要求公开', '企业、公开或图纸任一']) }],
  'wait.specialist_site_record.v2': [siteWaitDays],
  'wait.specialist_review': [{ ...siteWaitDays, label: '复核等待天数', options: options(settings.reviewWaitDays) }],
  'save.specialist_issue.v2': [{ key: 'policy', label: '事项准入', fallback: 'open_or_reuse',
    options: options(settings.issuePolicies, ['获权工人或经理记录', '仅经理现场记录']) }],
  'deliver.specialist_result': [{ key: 'milestone', label: '回传节点', fallback: 'resolved',
    options: options(settings.reviewMilestones, ['经理正式解决', '经理正式关闭']) }],
};

const effectLabels = { none: '本地计算', read: '读取获权数据', compose: '运行专业 Agent', save: '写入正式事项',
  wait: '持久化等待', deliver: '原咨询投递' } as const;

interface CanvasProps {
  definition: WorkflowDefinition;
  onChange?: (definition: WorkflowDefinition) => void;
  pendingNodeId?: string | null;
  focusNodeId?: string | null;
  onSelectNode?: (nodeId: string) => void;
  invalidNodeIds?: readonly string[];
}

const hasEvidenceBranches = (definition: WorkflowDefinition) =>
  definition.nodes.some(node => node.capabilityRef === 'condition.specialist_evidence');
const hasEvidenceAssessment = (definition: WorkflowDefinition) =>
  definition.nodes.some(node => node.capabilityRef === 'read.specialist_evidence' || node.capabilityRef === 'compose.stage_specialist.v3');

function insertConnection(definition: WorkflowDefinition, from: string, sourcePort: string, to: string, targetPort: string) {
  const source = definition.nodes.find(node => node.nodeId === from);
  const target = definition.nodes.find(node => node.nodeId === to);
  if (!source || !target || from === to) return null;
  if (sourcePort.startsWith('out:') && targetPort.startsWith('in:')) {
    const outputPath = sourcePort.slice(4), inputPath = targetPort.slice(3);
    const valueType = capabilityCatalog[source.capabilityRef]?.outputs[outputPath];
    if (!valueType || valueType !== capabilityCatalog[target.capabilityRef]?.inputs[inputPath]
      || !specialistInputMatches(hasEvidenceBranches(definition), target, inputPath, source, outputPath, hasEvidenceAssessment(definition))) return null;
    return { ...definition, nodes: definition.nodes.map(node => node.nodeId === to
      ? { ...node, inputs: { ...node.inputs, [inputPath]: { nodeId: from, outputPath } } } : node) };
  }
  if (targetPort !== controlInput || target.type === 'trigger' || source.type === 'output') return null;
  const validBranches = branches(source);
  if (!validBranches.some(when => controlPort(when) === sourcePort)) return null;
  const when = validBranches.find(when => controlPort(when) === sourcePort);
  const edge: WorkflowEdge = { from, to, ...(when ? { when } : {}) };
  return { ...definition, edges: [...definition.edges.filter(item => item.from !== from || item.when !== when), edge] };
}

function layout(definition: WorkflowDefinition) {
  const columns = new Map<string, number>([[definition.entryNodeId, 0]]);
  const rows = new Map<number, number>();
  for (let pass = 0; pass < definition.nodes.length; pass++) {
    let changed = false;
    for (const { from, to } of definition.edges) {
      const column = columns.get(from);
      if (column === undefined || columns.has(to)) continue;
      columns.set(to, column + 1);
      changed = true;
    }
    if (!changed) break;
  }
  return definition.nodes.map(node => {
    const index = columns.get(node.nodeId) ?? 0, column = index % 5;
    const row = rows.get(index) ?? 0;
    rows.set(index, row + 1);
    return { node, x: 30 + column * 185, y: 50 + (Math.floor(index / 5) + row) * 112 };
  });
}

export function NativeWorkflowCanvas({ definition, onChange, pendingNodeId, focusNodeId, onSelectNode, invalidNodeIds }: CanvasProps) {
  const { token } = theme.useToken();
  const frame = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const latest = useRef({ definition, onChange, onSelectNode });
  const fitted = useRef(false);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState(definition.entryNodeId);
  const editable = !!onChange;

  useEffect(() => { latest.current = { definition, onChange, onSelectNode }; }, [definition, onChange, onSelectNode]);
  useEffect(() => {
    let active = true;
    let instance: Graph | undefined;
    void import('@antv/x6').then(({ Graph }) => {
      if (!active || !container.current || !frame.current) return;
      instance = new Graph({
        container: container.current, autoResize: frame.current, grid: true, panning: true,
        mousewheel: { enabled: true, modifiers: ['ctrl', 'meta'], minScale: 0.45, maxScale: 1.6 },
        interacting: { edgeMovable: false, arrowheadMovable: false, nodeMovable: false },
        connecting: {
          allowBlank: false, allowLoop: false, allowNode: false, allowEdge: false, allowMulti: 'withPort',
          validateMagnet: () => editable,
          validateConnection: ({ sourceCell, targetCell, sourcePort, targetPort }) =>
            editable && !!sourceCell && !!targetCell && !!sourcePort && !!targetPort
            && !!insertConnection(latest.current.definition, sourceCell.id, sourcePort, targetCell.id, targetPort),
        },
      });
      instance.on('node:click', ({ node }) => {
        setSelected(node.id);
        latest.current.onSelectNode?.(node.id);
      });
      instance.on('edge:connected', ({ edge, isNew }) => {
        if (!isNew) return;
        const from = edge.getSourceCellId(), to = edge.getTargetCellId();
        const source = edge.getSourcePortId(), target = edge.getTargetPortId();
        const next = from && to && source && target ? insertConnection(latest.current.definition, from, source, to, target) : null;
        instance?.removeCell(edge);
        if (next) latest.current.onChange?.(next);
      });
      fitted.current = false;
      setGraph(instance);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; instance?.dispose(); };
  }, [editable]);

  useEffect(() => {
    if (!graph) return;
    const circle = (magnet: boolean | 'passive', fill: string) => ({
      r: 4, magnet, stroke: fill, strokeWidth: 1.5, fill: token.colorBgContainer,
    });
    const groups = {
      controlIn: { position: 'left', attrs: { circle: circle('passive', token.colorPrimary) } },
      controlOut: { position: 'right', attrs: { circle: circle(true, token.colorPrimary) } },
      dataIn: { position: 'top', attrs: { circle: circle('passive', token.colorTextTertiary) } },
      dataOut: { position: 'bottom', attrs: { circle: circle(true, token.colorTextTertiary) } },
    };
    const nodes = layout(definition).map(({ node, x, y }) => {
      const spec = getCapability(node.capabilityRef);
      const focused = node.nodeId === (focusNodeId ?? selected) || node.nodeId === pendingNodeId;
      const invalid = invalidNodeIds?.includes(node.nodeId);
      return graph.createNode({
        id: node.nodeId, shape: 'rect', x, y, width: 143, height: 47,
        label: labels[node.type] ?? node.nodeId,
        attrs: {
          body: { rx: 6, ry: 6, stroke: invalid ? token.colorError : focused ? token.colorPrimary : token.colorBorder, strokeWidth: focused || invalid ? 2 : 1,
            fill: focused ? token.colorPrimaryBg : token.colorBgContainer },
          label: { fill: token.colorText, fontSize: 13, fontWeight: focused ? 600 : 400 },
        },
        ports: { groups, items: [
          ...(node.type !== 'trigger' ? [{ id: controlInput, group: 'controlIn' }] : []),
          ...branches(node).map(when => ({ id: controlPort(when), group: 'controlOut', attrs: { circle: { title: branchLabel(when) } } })),
          ...Object.keys(spec?.inputs ?? {}).map(key => ({ id: 'in:' + key, group: 'dataIn', attrs: { circle: { title: key } } })),
          ...Object.keys(spec?.outputs ?? {}).map(key => ({ id: 'out:' + key, group: 'dataOut', attrs: { circle: { title: key } } })),
        ] },
      });
    });
    const ids = new Set(nodes.map(node => node.id));
    const edges = definition.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)).map(edge => graph.createEdge({
      source: { cell: edge.from, port: controlPort(edge.when) }, target: { cell: edge.to, port: controlInput },
      labels: edge.when ? [branchLabel(edge.when)] : [],
      connector: 'rounded', attrs: { line: { stroke: token.colorPrimary, strokeWidth: 1.4 } }, zIndex: -1,
    }));
    const dataEdges = definition.nodes.flatMap(node => Object.entries(node.inputs ?? {}).flatMap(([key, ref]) =>
      !ids.has(ref.nodeId) ? [] : [graph.createEdge({
        source: { cell: ref.nodeId, port: 'out:' + ref.outputPath }, target: { cell: node.nodeId, port: 'in:' + key },
        connector: 'smooth', attrs: { line: { stroke: token.colorTextTertiary, strokeWidth: 1, strokeDasharray: '4 5' } }, zIndex: -2,
      })]));
    graph.resetCells([...nodes, ...edges, ...dataEdges]);
    if (!fitted.current && frame.current?.clientWidth && frame.current.clientHeight) {
      graph.zoomToFit({ padding: 20, maxScale: 1 });
      fitted.current = true;
    }
  }, [definition, graph, pendingNodeId, selected, focusNodeId, invalidNodeIds, token]);

  const node = definition.nodes.find(item => item.nodeId === (focusNodeId ?? selected));
  const spec = node ? getCapability(node.capabilityRef) : undefined;
  const patchNode = (patch: Partial<WorkflowNode>) => {
    if (node) onChange?.({ ...definition, nodes: definition.nodes.map(item => item.nodeId === node.nodeId ? { ...item, ...patch } : item) });
  };
  const addNode = (ref: string) => {
    const cap = getCapability(ref);
    if (!onChange || !cap || !capabilities.some(([key]) => key === ref) || cap.type === 'trigger'
      || definition.nodes.length >= WORKFLOW_BOUNDS.maxNodes) return;
    const nodeId = Array.from({ length: WORKFLOW_BOUNDS.maxNodes + 1 }, (_, index) => cap.type + '_' + (index + 1))
      .find(id => !definition.nodes.some(item => item.nodeId === id))!;
    const config: WorkflowNode['config'] = cap.type === 'agent' ? { agentId: defaultSpecialist.agentId, agentVersion: defaultSpecialist.version }
      : ref === 'condition.compare_boolean' ? { op: 'eq', right: true }
      : Object.fromEntries((nodeSettings[ref] ?? []).map(field => [field.key, field.fallback]));
    onChange?.({ ...definition, nodes: [...definition.nodes, { nodeId, type: cap.type, typeVersion: cap.typeVersion, capabilityRef: ref,
      ...(config ? { config } : {}) }] });
    setSelected(nodeId);
    onSelectNode?.(nodeId);
  };
  const removeNode = (id: string) => {
    onChange?.({ ...definition, nodes: definition.nodes.filter(item => item.nodeId !== id).map(item => item.inputs
      ? { ...item, inputs: Object.fromEntries(Object.entries(item.inputs).filter(([, ref]) => ref.nodeId !== id)) } : item),
    edges: definition.edges.filter(edge => edge.from !== id && edge.to !== id) });
    setSelected(definition.entryNodeId);
    onSelectNode?.(definition.entryNodeId);
  };

  const branched = definition.nodes.some(item => item.typeVersion === 2 || item.capabilityRef === 'condition.specialist_evidence');
  const explicitAssessment = hasEvidenceAssessment(definition);
  const palette = capabilities.filter(([key, capability]) => capability.type !== 'trigger'
    && (!['read.specialist_evidence', 'compose.stage_specialist.v3'].includes(key) || explicitAssessment)
    && (branched ? !['compose.stage_specialist', 'wait.specialist_site_record', 'save.specialist_issue', 'condition.compare_boolean'].includes(key)
      && (!explicitAssessment || key !== 'compose.stage_specialist.v2')
      : !['compose.specialist_checklist', 'compose.specialist_material_request', 'condition.specialist_evidence'].includes(key) && capability.typeVersion === 1));
  const selectNode = (id: string) => {
    setSelected(id);
    onSelectNode?.(id);
  };

  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      <Space wrap>
        {editable ? <Select<string> aria-label="添加节点" placeholder="添加节点" value={undefined} style={{ minWidth: 184 }}
          disabled={definition.nodes.length >= WORKFLOW_BOUNDS.maxNodes} onSelect={addNode}
          options={palette.map(([value, cap]) => ({ value, label: labels[cap.type] }))} /> : null}
        <Select aria-label="选择节点" value={focusNodeId ?? selected} onChange={selectNode} style={{ minWidth: 184 }}
          options={definition.nodes.map(item => ({ value: item.nodeId, label: (labels[item.type] ?? item.type) + ' · ' + item.nodeId }))} />
        <Button disabled={!graph} onClick={() => graph?.zoomToFit({ padding: 20, maxScale: 1 })}>适应画布</Button>
      </Space>
      {error ? <Alert type="warning" showIcon message="画布加载失败，仍可用节点配置或 JSON 编辑" /> : null}
      <Flex gap={12} align="stretch">
        {editable ? <Card size="small" title="节点面板" style={{ flex: '0 0 145px' }}>
          <Space direction="vertical" size={4}>
            {palette.map(([ref, cap]) => <Button key={ref} size="small" type="text" draggable
              disabled={definition.nodes.length >= WORKFLOW_BOUNDS.maxNodes}
              onDragStart={event => {
                event.dataTransfer.setData(dragType, ref);
                event.dataTransfer.effectAllowed = 'copy';
              }} onClick={() => addNode(ref)}>{labels[cap.type]}</Button>)}
          </Space>
        </Card> : null}
        <div ref={frame} onDragOver={event => {
          if (editable && event.dataTransfer.types.includes(dragType)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }
        }} onDrop={event => {
          if (!editable) return;
          const ref = event.dataTransfer.getData(dragType);
          if (!ref) return;
          event.preventDefault();
          addNode(ref);
        }} style={{ position: 'relative', height: 390, minWidth: 0, flex: 1, overflow: 'hidden', border: '1px solid ' + token.colorBorderSecondary, borderRadius: token.borderRadius }}>
          <div ref={container} aria-label="原生工作流画布" style={{ position: 'absolute', inset: 0 }} />
        </div>
      </Flex>
      {node && spec ? (
        <Card size="small" title={labels[node.type]} extra={editable && node.type !== 'trigger'
          ? <Button size="small" danger onClick={() => removeNode(node.nodeId)}>移除节点</Button> : null}>
          <Descriptions size="small" column={2} items={[
            { key: 'node', label: '节点', children: <Typography.Text code>{node.nodeId}</Typography.Text> },
            { key: 'cap', label: '能力', children: <Typography.Text code>{node.capabilityRef} · v{node.typeVersion}</Typography.Text> },
            { key: 'type', label: '类型', children: node.type },
            { key: 'effect', label: '执行', children: effectLabels[spec.effect] },
            { key: 'permission', label: '权限', children: spec.permission ?? '原流程权限' },
            { key: 'failure', label: '异常', children: spec.effect === 'wait' ? '继续等待或记录超时' : '保留错误及当前运行' },
            { key: 'schema', label: '配置 Schema', children: spec.configKeys.length ? spec.configKeys.join(' / ') : '固定能力' },
            { key: 'out', label: 'OUTPUT', children: Object.entries(spec.outputs).map(([name, kind]) => <Tag key={name}>{name} · {kind}</Tag>) },
          ]} />
          <Space wrap>
            {node.type === 'agent' ? (() => {
              const current = String(node.config?.agentId) + '@' + String(node.config?.agentVersion);
              const choices = publishedAgents.map(agent => ({ value: agentKey(agent),
                label: `${agent.name} v${agent.version}${agent.status === 'candidate' ? '（候选）' : ''}` }));
              const selected = choices.some(choice => choice.value === current)
                ? choices : [...choices, { value: current, label: current }];
              return <Select aria-label="专业 Agent 版本" disabled={!editable} value={current}
                options={selected} onChange={value => {
                  const selectedAgent = publishedAgents.find(agent => agentKey(agent) === value);
                  if (selectedAgent) patchNode({ config: { agentId: selectedAgent.agentId, agentVersion: selectedAgent.version } });
                }} />;
            })() : null}
            {(nodeSettings[node.capabilityRef] ?? []).map(field => <Space key={field.key} wrap>
              <Typography.Text>{field.label}</Typography.Text>
              <Select aria-label={field.label} style={{ minWidth: 120 }} disabled={!editable}
                value={node.config?.[field.key] as string | number ?? field.fallback}
                options={[...field.options]} onChange={(value: JsonValue) => patchNode({ config: { ...node.config, [field.key]: value } })} />
            </Space>)}
            {node.capabilityRef === 'condition.compare_boolean' ? <>
              <Select aria-label="比较方式" disabled={!editable} value={String(node.config?.op)} onChange={op => patchNode({ config: { ...node.config, op } })}
                options={[{ value: 'eq', label: '等于' }, { value: 'ne', label: '不等于' }]} />
              <Select aria-label="布尔目标" disabled={!editable} value={String(node.config?.right)} onChange={right => patchNode({ config: { ...node.config, right: right === 'true' } })}
                options={[{ value: 'true', label: '真' }, { value: 'false', label: '假' }]} />
            </> : null}
          </Space>
          <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>
            {Object.entries(spec.inputs).map(([name, kind]) => {
              const ref = node.inputs?.[name];
              const options = definition.nodes.filter(item => item.nodeId !== node.nodeId)
                .flatMap(item => Object.entries(capabilityCatalog[item.capabilityRef]?.outputs ?? {})
                  .filter(([key, type]) => type === kind && specialistInputMatches(hasEvidenceBranches(definition), node, name, item, key, explicitAssessment))
                  .map(([key]) => ({ label: item.nodeId + ' · ' + key, value: item.nodeId + ':' + key })));
              return <Space wrap key={'input:' + name}><Typography.Text>INPUT {name} · {kind}</Typography.Text>
                <Select allowClear disabled={!editable} aria-label={'输入 ' + name} style={{ minWidth: 225 }} placeholder="连接输出端口"
                  value={ref ? ref.nodeId + ':' + ref.outputPath : undefined} options={options}
                  onChange={value => {
                    const inputs = { ...node.inputs };
                    if (value) {
                      const [nodeId, outputPath] = value.split(':');
                      inputs[name] = { nodeId, outputPath };
                    } else delete inputs[name];
                    patchNode({ inputs });
                  }} />
              </Space>;
            })}
            {branches(node).map(when => (
              <Space wrap key={'branch:' + (when ?? 'next')}><Typography.Text>{branchLabel(when)}</Typography.Text>
                <Select allowClear disabled={!editable} aria-label={'后续节点 ' + (when ?? 'next')} style={{ minWidth: 225 }} placeholder="连接流程节点"
                  value={definition.edges.find(edge => edge.from === node.nodeId && edge.when === when)?.to}
                  options={definition.nodes.filter(item => item.nodeId !== node.nodeId && item.type !== 'trigger')
                    .map(item => ({ value: item.nodeId, label: item.nodeId }))}
                  onChange={to => onChange?.({ ...definition, edges: [...definition.edges.filter(edge => edge.from !== node.nodeId || edge.when !== when),
                    ...(to ? [{ from: node.nodeId, to, ...(when ? { when } : {}) }] : [])] })} />
              </Space>
            ))}
          </Space>
        </Card>
      ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择节点查看配置" />}
    </Space>
  );
}
