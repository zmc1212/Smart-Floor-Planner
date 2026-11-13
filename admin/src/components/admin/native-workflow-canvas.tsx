'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Descriptions, Empty, Select, Space, Tag, Typography, theme } from 'antd';
import type { Graph } from '@antv/x6';
import { specialists, waterproofAgentId } from '@/lib/assistant/specialists/registry';
import { capabilityCatalog } from '@/lib/native-workflow/registry';
import { WORKFLOW_BOUNDS, type NodeType, type WorkflowDefinition, type WorkflowEdge, type WorkflowNode } from '@/lib/native-workflow/types';

const labels: Partial<Record<NodeType, string>> = {
  trigger: '业主发起跟进', project_data: '项目及房间', knowledge_retrieval: '企业工艺', public_search: '公开规范',
  agent: '专业 Agent', condition: '条件判断', wait_event: '等待现场资料', create_issue: '登记施工事项',
  human_review: '项目经理复核', output: '回传原咨询',
};
const capabilities = Object.entries(capabilityCatalog).filter(([key, spec]) =>
  !!labels[spec.type] && (spec.type !== 'trigger' || key === 'trigger.specialist_followup')
    && (spec.type !== 'condition' || key === 'condition.compare_boolean'));
const specialist = specialists.active(waterproofAgentId)!;
const controlInput = 'control-in';
const controlPort = (when?: WorkflowEdge['when']) => 'control-' + (when ?? 'out');

interface CanvasProps {
  definition: WorkflowDefinition;
  onChange?: (definition: WorkflowDefinition) => void;
  pendingNodeId?: string | null;
}

function insertConnection(definition: WorkflowDefinition, from: string, sourcePort: string, to: string, targetPort: string) {
  const source = definition.nodes.find(node => node.nodeId === from);
  const target = definition.nodes.find(node => node.nodeId === to);
  if (!source || !target || from === to) return null;
  if (sourcePort.startsWith('out:') && targetPort.startsWith('in:')) {
    const outputPath = sourcePort.slice(4), inputPath = targetPort.slice(3);
    const valueType = capabilityCatalog[source.capabilityRef]?.outputs[outputPath];
    if (!valueType || valueType !== capabilityCatalog[target.capabilityRef]?.inputs[inputPath]) return null;
    return { ...definition, nodes: definition.nodes.map(node => node.nodeId === to
      ? { ...node, inputs: { ...node.inputs, [inputPath]: { nodeId: from, outputPath } } } : node) };
  }
  if (targetPort !== controlInput || target.type === 'trigger' || source.type === 'output') return null;
  const when = source.type === 'condition' ? sourcePort === controlPort('true') ? 'true' : 'false' : undefined;
  if (sourcePort !== controlPort(when)) return null;
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

export function NativeWorkflowCanvas({ definition, onChange, pendingNodeId }: CanvasProps) {
  const { token } = theme.useToken();
  const frame = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const latest = useRef({ definition, onChange });
  const fitted = useRef(false);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState(definition.entryNodeId);
  const editable = !!onChange;

  useEffect(() => { latest.current = { definition, onChange }; }, [definition, onChange]);
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
      instance.on('node:click', ({ node }) => setSelected(node.id));
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
      const spec = capabilityCatalog[node.capabilityRef];
      const focused = node.nodeId === selected || node.nodeId === pendingNodeId;
      return graph.createNode({
        id: node.nodeId, shape: 'rect', x, y, width: 143, height: 47,
        label: labels[node.type] ?? node.nodeId,
        attrs: {
          body: { rx: 6, ry: 6, stroke: focused ? token.colorPrimary : token.colorBorder, strokeWidth: focused ? 2 : 1,
            fill: focused ? token.colorPrimaryBg : token.colorBgContainer },
          label: { fill: token.colorText, fontSize: 13, fontWeight: focused ? 600 : 400 },
        },
        ports: { groups, items: [
          ...(node.type !== 'trigger' ? [{ id: controlInput, group: 'controlIn' }] : []),
          ...(node.type === 'output' ? [] : (node.type === 'condition' ? ['true', 'false'] as const : [undefined])
            .map(when => ({ id: controlPort(when), group: 'controlOut', attrs: { circle: { title: when === 'true' ? '满足' : when === 'false' ? '未满足' : '下一节点' } } }))),
          ...Object.keys(spec?.inputs ?? {}).map(key => ({ id: 'in:' + key, group: 'dataIn', attrs: { circle: { title: key } } })),
          ...Object.keys(spec?.outputs ?? {}).map(key => ({ id: 'out:' + key, group: 'dataOut', attrs: { circle: { title: key } } })),
        ] },
      });
    });
    const ids = new Set(nodes.map(node => node.id));
    const edges = definition.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)).map(edge => graph.createEdge({
      source: { cell: edge.from, port: controlPort(edge.when) }, target: { cell: edge.to, port: controlInput },
      labels: edge.when ? [edge.when === 'true' ? '满足' : '未满足'] : [],
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
  }, [definition, graph, pendingNodeId, selected, token]);

  const node = definition.nodes.find(item => item.nodeId === selected);
  const spec = node ? capabilityCatalog[node.capabilityRef] : undefined;
  const patchNode = (patch: Partial<WorkflowNode>) => {
    if (node) onChange?.({ ...definition, nodes: definition.nodes.map(item => item.nodeId === node.nodeId ? { ...item, ...patch } : item) });
  };
  const addNode = (ref: string) => {
    const cap = capabilityCatalog[ref];
    const nodeId = Array.from({ length: WORKFLOW_BOUNDS.maxNodes + 1 }, (_, index) => cap.type + '_' + (index + 1))
      .find(id => !definition.nodes.some(item => item.nodeId === id))!;
    const config: WorkflowNode['config'] = cap.type === 'agent' ? { agentId: specialist.agentId, agentVersion: specialist.version }
      : cap.type === 'condition' ? { op: 'eq', right: true } : undefined;
    onChange?.({ ...definition, nodes: [...definition.nodes, { nodeId, type: cap.type, typeVersion: cap.typeVersion, capabilityRef: ref,
      ...(config ? { config } : {}) }] });
    setSelected(nodeId);
  };
  const removeNode = (id: string) => {
    onChange?.({ ...definition, nodes: definition.nodes.filter(item => item.nodeId !== id).map(item => item.inputs
      ? { ...item, inputs: Object.fromEntries(Object.entries(item.inputs).filter(([, ref]) => ref.nodeId !== id)) } : item),
    edges: definition.edges.filter(edge => edge.from !== id && edge.to !== id) });
    setSelected(definition.entryNodeId);
  };

  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      <Space wrap>
        {editable ? <Select<string> aria-label="添加节点" placeholder="添加节点" value={undefined} style={{ minWidth: 184 }}
          disabled={definition.nodes.length >= WORKFLOW_BOUNDS.maxNodes} onSelect={addNode}
          options={capabilities.filter(([, cap]) => cap.type !== 'trigger').map(([value, cap]) => ({ value, label: labels[cap.type] }))} /> : null}
        <Select aria-label="选择节点" value={selected} onChange={setSelected} style={{ minWidth: 184 }}
          options={definition.nodes.map(item => ({ value: item.nodeId, label: (labels[item.type] ?? item.type) + ' · ' + item.nodeId }))} />
        <Button disabled={!graph} onClick={() => graph?.zoomToFit({ padding: 20, maxScale: 1 })}>适应画布</Button>
      </Space>
      {error ? <Alert type="warning" showIcon message="画布加载失败，仍可用节点配置或 JSON 编辑" /> : null}
      <div ref={frame} style={{ position: 'relative', height: 320, width: '100%', overflow: 'hidden', border: '1px solid ' + token.colorBorderSecondary, borderRadius: token.borderRadius }}>
        <div ref={container} aria-label="原生工作流画布" style={{ position: 'absolute', inset: 0 }} />
      </div>
      {node && spec ? (
        <Card size="small" title={labels[node.type]} extra={editable && node.type !== 'trigger'
          ? <Button size="small" danger onClick={() => removeNode(node.nodeId)}>移除节点</Button> : null}>
          <Descriptions size="small" column={2} items={[
            { key: 'node', label: '节点', children: <Typography.Text code>{node.nodeId}</Typography.Text> },
            { key: 'cap', label: '能力', children: <Typography.Text code>{node.capabilityRef} · v{spec.typeVersion}</Typography.Text> },
            ...(spec.permission ? [{ key: 'permission', label: '权限', children: spec.permission }] : []),
            { key: 'out', label: 'OUTPUT', children: Object.entries(spec.outputs).map(([name, kind]) => <Tag key={name}>{name} · {kind}</Tag>) },
          ]} />
          <Space wrap>
            {node.type === 'agent' ? <Select aria-label="专业 Agent 版本" disabled={!editable}
              value={String(node.config?.agentId) + '@' + String(node.config?.agentVersion)}
              options={[{ value: specialist.agentId + '@' + specialist.version, label: specialist.name + ' v' + specialist.version }]}
              onChange={() => patchNode({ config: { agentId: specialist.agentId, agentVersion: specialist.version } })} /> : null}
            {node.type === 'condition' ? <>
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
                  .filter(([, type]) => type === kind).map(([key]) => ({ label: item.nodeId + ' · ' + key, value: item.nodeId + ':' + key })));
              return <Space wrap key={name}><Typography.Text>INPUT {name} · {kind}</Typography.Text>
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
            {node.type !== 'output' && (node.type === 'condition' ? ['true', 'false'] as const : [undefined]).map(when => (
              <Space wrap key={when ?? 'next'}><Typography.Text>{when === 'true' ? '满足时' : when === 'false' ? '未满足时' : '下一节点'}</Typography.Text>
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
