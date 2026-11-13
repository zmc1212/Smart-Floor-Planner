'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Card, Collapse, Descriptions, Empty, Input, Space, Tag, Typography } from 'antd';
import type { WorkflowDefinitionRecord } from '@/lib/native-workflow/store/types';
import { capabilityCatalog } from '@/lib/native-workflow/registry';
import { NativeWorkflowCanvas } from './native-workflow-canvas';

interface Observation {
  binding: { runId: string; definitionId: string; revision: number; digest: string };
  status: string;
  currentNodeId: string | null;
  error: { code: string; path: string } | null;
  operations: Array<{ nodeId: string; capability: string; version: string; status: string; durationMs: number;
    outputPorts: string[]; analysis?: unknown; publicStandard?: unknown; error?: string }>;
  trace: Array<{ seq: number; at: string; kind: string; nodeId: string | null; detail?: unknown }>;
}

const statusLabels: Record<string, string> = { completed: '已完成', running: '运行中', waiting: '等待中', failed: '失败',
  unknown: '结果待核实', halted: '已停止' };

export function NativeWorkflowSpecialistStatus({ record, initialRunId }: { record: WorkflowDefinitionRecord; initialRunId: string }) {
  const [value, setValue] = useState(initialRunId);
  const [request, setRequest] = useState({ runId: initialRunId, refresh: 0 });
  const [observation, setObservation] = useState<Observation | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!request.runId) return;
    const controller = new AbortController();
    setLoading(true);
    setObservation(null);
    setError('');
    void (async () => {
      try {
        const res = await fetch('/api/native-workflow/runs/' + encodeURIComponent(request.runId) + '/specialist-status',
          { cache: 'no-store', signal: controller.signal });
        const result = await res.json();
        if (!res.ok || !result.success) throw new Error(result.error || '读取运行失败');
        if (result.data.binding.definitionId !== record.definitionId) throw new Error('运行属于其他流程定义');
        if (!controller.signal.aborted) setObservation(result.data);
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '读取运行失败');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [record.definitionId, request]);

  const version = record.versions.find(item => item.revision === observation?.binding.revision && item.digest === observation.binding.digest);
  const lookup = () => setRequest(previous => ({ runId: value.trim(), refresh: previous.refresh + 1 }));
  return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    <Space wrap>
      <Input aria-label="防水运行 ID" placeholder="specialist:运行编号" value={value} onChange={event => setValue(event.target.value)} onPressEnter={lookup} />
      <Button loading={loading} disabled={!value.trim()} onClick={lookup}>读取运行</Button>
    </Space>
    {error ? <Alert showIcon type="error" message={error} /> : null}
    {!observation && !error && !loading ? <Empty description="输入委托回执对应的运行 ID" /> : null}
    {observation ? <Card size="small" title={<Space wrap><Typography.Text code>{observation.binding.runId}</Typography.Text>
      <Tag>{statusLabels[observation.status] ?? observation.status}</Tag></Space>}>
      <Descriptions size="small" items={[
        { key: 'revision', label: '发布版本', children: 'v' + observation.binding.revision },
        { key: 'node', label: '当前节点', children: observation.currentNodeId ?? '—' },
        { key: 'error', label: '错误', children: observation.error?.code ?? '—' },
      ]} />
      {version ? <NativeWorkflowCanvas definition={version.definition} pendingNodeId={observation.currentNodeId} /> : null}
      <Collapse size="small" style={{ marginTop: 12 }} items={[
        { key: 'operations', label: '节点运行', children: <Collapse size="small" items={observation.operations.map((operation, index) => ({
          key: operation.nodeId + ':' + index,
          label: operation.nodeId + ' · ' + operation.status + ' · ' + operation.durationMs + ' ms',
          children: <Descriptions size="small" column={1} items={[
            { key: 'cap', label: '能力版本', children: operation.capability + ' · ' + operation.version },
            { key: 'in', label: 'INPUT', children: Object.keys(capabilityCatalog[operation.capability]?.inputs ?? {}).join('、') || '—' },
            { key: 'out', label: 'OUTPUT', children: operation.outputPorts.join('、') || '—' },
            ...(operation.error ? [{ key: 'error', label: '错误', children: operation.error }] : []),
            ...(operation.analysis || operation.publicStandard ? [{ key: 'source', label: 'Agent、用量及来源',
              children: <pre style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(operation.analysis ?? operation.publicStandard, null, 2)}</pre> }] : []),
          ]} />,
        }))} /> },
        { key: 'trace', label: '等待、恢复与分支', children: observation.trace
          .filter(item => ['node_waiting', 'run_resumed', 'branch_selected'].includes(item.kind)).map(item => (
            <Typography.Paragraph key={item.seq} style={{ marginBottom: 4 }}>
              {item.at} · {item.nodeId || '—'} · {item.kind} · {JSON.stringify(item.detail)}
            </Typography.Paragraph>
          )) },
      ]} />
    </Card> : null}
  </Space>;
}
