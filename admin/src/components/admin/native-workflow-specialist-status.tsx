'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Card, Collapse, Descriptions, Empty, Input, Space, Tag, Typography } from 'antd';
import type { WorkflowDefinitionRecord } from '@/lib/native-workflow/store/types';
import type { SpecialistStatus } from '@/lib/native-workflow/live/specialist-status';
import { NativeWorkflowCanvas } from './native-workflow-canvas';

const statusLabels: Record<string, string> = { queued: '排队中', running: '运行中', waiting: '等待中',
  succeeded: '已完成', failed: '失败', cancelled: '已取消', indeterminate: '结果待核实' };

function Summary({ value }: { value: unknown }) {
  return <pre style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(value, null, 2)}</pre>;
}

export function NativeWorkflowSpecialistStatus({ record, initialRunId }: { record: WorkflowDefinitionRecord; initialRunId: string }) {
  const [value, setValue] = useState(initialRunId);
  const [request, setRequest] = useState({ runId: initialRunId, refresh: 0 });
  const [observation, setObservation] = useState<SpecialistStatus | null>(null);
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
      <Input aria-label="专业运行 ID" placeholder="specialist:运行编号" value={value} onChange={event => setValue(event.target.value)} onPressEnter={lookup} />
      <Button loading={loading} disabled={!value.trim()} onClick={lookup}>读取运行</Button>
    </Space>
    {error ? <Alert showIcon type="error" message={error} /> : null}
    {!observation && !error && !loading ? <Empty description="输入委托回执对应的运行 ID" /> : null}
    {observation ? <Card size="small" title={<Space wrap><Typography.Text code>{observation.binding.runId}</Typography.Text>
      <Tag>{statusLabels[observation.status] ?? observation.status}</Tag></Space>}>
      <Descriptions size="small" items={[
        { key: 'workflow', label: 'Workflow ID', children: observation.binding.definitionId },
        { key: 'revision', label: '发布版本', children: 'v' + observation.binding.revision },
        { key: 'agent', label: 'Agent', children: observation.binding.agentId + ' · v' + observation.binding.agentVersion },
        { key: 'digest', label: 'Digest', children: <Typography.Text code copyable>{observation.binding.digest}</Typography.Text>, span: 3 },
        { key: 'done', label: '已完成节点', children: observation.completedNodeIds.join('、') || '—' },
        { key: 'waiting', label: '等待节点', children: observation.waitingNodeId ?? '—' },
        { key: 'recoveries', label: '恢复次数', children: observation.recoveryCount },
        { key: 'review', label: '人工复核', children: observation.humanReview.status === 'waiting' ? '等待经理复核'
          : observation.humanReview.status === 'recheck_required' ? '依据或授权已变化，待重新核对'
          : observation.humanReview.status === 'not_started' ? '未登记' : observation.humanReview.status + ' · v' + observation.humanReview.reviewVersion },
        { key: 'issue', label: '正式事项 ID', children: observation.humanReview.issueId ? String(observation.humanReview.issueId) : '—' },
        { key: 'node', label: '当前节点', children: observation.currentNodeId ?? '—' },
        { key: 'error', label: '错误', children: observation.error?.code ?? '—' },
      ]} />
      {version ? <NativeWorkflowCanvas definition={version.definition} pendingNodeId={observation.currentNodeId} /> : null}
      <Collapse size="small" style={{ marginTop: 12 }} items={[
        { key: 'evidence', label: 'Evidence 来源与版本', children: <Summary value={observation.evidence} /> },
        { key: 'models', label: '模型、请求与用量', children: <Summary value={observation.model} /> },
        { key: 'operations', label: '节点运行', children: <Collapse size="small" items={observation.operations.map((operation, index) => ({
          key: operation.nodeId + ':' + index,
          label: operation.nodeId + ' · ' + operation.status + ' · ' + operation.durationMs + ' ms',
          children: <Descriptions size="small" column={1} items={[
            { key: 'cap', label: '能力版本', children: operation.capability + ' · ' + operation.version },
            { key: 'in', label: '输入摘要', children: <Summary value={{ ports: operation.inputPorts, sources: operation.inputs, config: operation.config }} /> },
            { key: 'out', label: '输出摘要', children: operation.outputPorts.join('、') || '—' },
            ...(operation.error ? [{ key: 'error', label: '错误', children: operation.error }] : []),
            ...(operation.summary ? [{ key: 'source', label: '执行回执', children: <Summary value={operation.summary} /> }] : []),
          ]} />,
        }))} /> },
        { key: 'trace', label: '等待、恢复与分支', children: <>
          {observation.nodeSummaries.length ? <Summary value={observation.nodeSummaries} /> : null}
          {observation.trace.filter(item => ['node_waiting', 'run_resumed', 'branch_selected'].includes(item.kind)).map(item => (
            <Typography.Paragraph key={item.seq} style={{ marginBottom: 4 }}>
              {item.at} · {item.nodeId || '—'} · {item.kind} · {JSON.stringify(item.detail)}
            </Typography.Paragraph>
          ))}</> },
      ]} />
    </Card> : null}
  </Space>;
}
