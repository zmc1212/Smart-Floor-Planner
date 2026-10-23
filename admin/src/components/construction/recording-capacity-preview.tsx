'use client';
import { useEffect, useState } from 'react';
import { Alert, Button, Space } from 'antd';
import { constructionRequest } from './client';
import { capacityGB, retentionCapacity, type RecordingCapacity } from '@/lib/construction/recording-capacity';

export function RecordingCapacityPreview({ projectId, bindingId, days, open }: { projectId: string; bindingId?: string; days: number; open: boolean }) {
  const [state, setState] = useState<RecordingCapacity>(), [failed, setFailed] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    if (open && bindingId) {
      void constructionRequest<RecordingCapacity>('video-capacity/projects/' + projectId + '/bindings/' + bindingId, { signal: controller.signal })
        .then(value => { if (!controller.signal.aborted) setState(value); })
        .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    }
    return () => controller.abort();
  }, [projectId, bindingId, open, revision]);
  if (!open) return null;
  const estimate = retentionCapacity(state?.bytesPerDay ?? null, days);
  return <Alert type="info" showIcon message="录像容量估算" description={failed ? <Space direction="vertical" size="small"><span>暂时无法估算，可重试；录像设置仍按原规则保存。</span><Button size="small" onClick={() => { setState(undefined); setFailed(false); setRevision(r => r + 1); }}>重新估算</Button></Space> : !state ? '正在读取已封口录像样本…' : <Space direction="vertical" size="small">
    {state.bytesPerDay ? <><span>实测平均 {state.averageMbps?.toFixed(3)} Mbps，每天约 {capacityGB(state.bytesPerDay)}。</span>{estimate && <span>保留 {days} 天预计 {capacityGB(estimate.bytes)}；含 25% 余量约 {capacityGB(estimate.withReserve)}。</span>}</> : <span>样本暂不足；累计至少 60 秒已封口录像后可估算。</span>}
    <span>基于最近 {state.sample.segments} 段、累计 {Math.round(state.sample.seconds)} 秒样本。估算不含其他工地及磁盘任务，实际随码率变化。</span>
    <span>登记存量 {state.indexed.segments} 段、约 {capacityGB(state.indexed.bytes)}；待清理 {state.indexed.pendingDeletion} 段，其中失败待重试 {state.indexed.failedDeletion} 段。</span>
  </Space>} />;
}
