'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Drawer, Empty, List, Popconfirm, Skeleton, Space, Table, Tag, Typography } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import { AssistantMutations, AssistantRequestError, assistantError, assistantRequest, formatTime, statusLabels } from './client';
import { KnowledgeBatchPreparationClient, sameKnowledgeScope } from './knowledge-batch-client';
import type { KnowledgeBatchList, KnowledgeBatchProgress, KnowledgeBatchProgressItem, KnowledgeOperationScope } from '@/lib/assistant/knowledge/operation-batch-view';

type Props = {
  selected: Array<{ id: string; version: number }>;
  disabled: boolean;
  onPrepared(): void;
  onReloadCases(): void;
  onOpenEvaluation(caseId: string, evaluationId: string): Promise<void>;
};
const base = 'knowledge/operations/';
function batchUrl(batchId: string | null) {
  const url = new URL(window.location.href);
  if (batchId) url.searchParams.set('knowledgeBatch', batchId); else url.searchParams.delete('knowledgeBatch');
  window.history.replaceState(window.history.state, '', url);
}
function stateLabel(item: KnowledgeBatchProgressItem) {
  if (item.status === 'dispatch_pending') return item.dispatchState === 'not_started' ? '待执行' : '回执待核对';
  return ({ source_changed: '问题或资料已变化', unavailable: '记录不可用' } as Record<string, string>)[item.status] || statusLabels[item.status] || item.status;
}

export function KnowledgeBatches({ selected, disabled, onPrepared, onReloadCases, onOpenEvaluation }: Props) {
  const [open, setOpen] = useState(false), [scope, setScope] = useState<KnowledgeOperationScope | null>(null);
  const [history, setHistory] = useState<KnowledgeBatchList['items']>([]), [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null), [progress, setProgress] = useState<KnowledgeBatchProgress | null>(null);
  const [detailError, setDetailError] = useState(''), [detailLoading, setDetailLoading] = useState(false), [reload, setReload] = useState(0);
  const [pending, setPending] = useState<ReturnType<KnowledgeBatchPreparationClient['pending']>>(null);
  const scopeRef = useRef<KnowledgeOperationScope | null>(null), lock = useRef(false), historySequence = useRef(0);
  const client = useRef<KnowledgeBatchPreparationClient | null>(null), mutations = useRef(new AssistantMutations());
  const getClient = useCallback(() => {
    if (!client.current) {
      let storage: Storage | undefined;
      try { storage = window.sessionStorage; } catch { /* Owner-private server history remains the reentry path. */ }
      client.current = new KnowledgeBatchPreparationClient(storage);
    }
    return client.current;
  }, []);
  const loadHistory = useCallback(async (before?: string, signal?: AbortSignal) => {
    const sequence = ++historySequence.current;
    setLoading(true); setError('');
    try {
      const result = await assistantRequest<KnowledgeBatchList>(base + 'batches' + (before ? '?beforeId=' + before : ''), { signal });
      if (signal?.aborted || sequence !== historySequence.current) return undefined;
      const changed = scopeRef.current && !sameKnowledgeScope(scopeRef.current, result.scope);
      if (changed) { setProgress(null); setBatchId(null); onReloadCases(); }
      scopeRef.current = result.scope; setScope(result.scope);
      setHistory(previous => before && !changed ? [...previous, ...result.items] : result.items); setCursor(result.nextCursor);
      setPending(getClient().pending(result.scope));
      return result.scope;
    } catch (failure) {
      if (!signal?.aborted && sequence === historySequence.current) {
        setError(assistantError(failure)); setHistory([]); setScope(null); scopeRef.current = null; setProgress(null); setPending(null);
      }
      return undefined;
    } finally { if (!signal?.aborted && sequence === historySequence.current) setLoading(false); }
  }, [getClient, onReloadCases]);
  useEffect(() => {
    const controller = new AbortController();
    void loadHistory(undefined, controller.signal).then(owner => {
      if (!owner || controller.signal.aborted) return;
      const requested = new URL(window.location.href).searchParams.get('knowledgeBatch');
      if (requested && /^[a-zA-Z0-9._:-]{1,128}$/.test(requested)) { setBatchId(requested); setOpen(true); }
    });
    return () => { controller.abort(); };
  }, [loadHistory]);
  useEffect(() => {
    if (!open || !batchId || !scope) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    setProgress(null); setDetailError(''); setDetailLoading(true);
    const read = async () => {
      try {
        const result = await assistantRequest<KnowledgeBatchProgress>(base + 'batches/' + encodeURIComponent(batchId), { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!sameKnowledgeScope(scopeRef.current, result.scope)) throw new AssistantRequestError('context_changed', 409);
        setProgress(result); setDetailError('');
        if (result.items.some(item => item.available && ['queued', 'running'].includes(item.status))) timer = setTimeout(read, 1800);
      } catch (failure) { if (!controller.signal.aborted) { setProgress(null); setDetailError(assistantError(failure)); } }
      finally { if (!controller.signal.aborted) setDetailLoading(false); }
    };
    void read(); return () => { controller.abort(); clearTimeout(timer); };
  }, [batchId, open, reload, scope]);
  const selectBatch = (id: string) => { setProgress(null); setDetailError(''); setBatchId(id); setOpen(true); setReload(value => value + 1); batchUrl(id); };
  const prepare = async (recover = false) => {
    if (lock.current || !scope) return;
    lock.current = true; setBusy(true); setError('');
    const owner = scope;
    try {
      const fresh = await assistantRequest<KnowledgeBatchList>(base + 'batches?limit=1');
      if (!sameKnowledgeScope(owner, fresh.scope)) { await loadHistory(); onReloadCases(); throw new AssistantRequestError('context_changed', 409); }
      const result = recover ? await getClient().retry(owner) : await getClient().prepare(owner, selected.map(item => ({ caseId: item.id, expectedVersion: item.version })));
      if (!sameKnowledgeScope(scopeRef.current, owner)) throw new AssistantRequestError('context_changed', 409);
      notify.success('所选问题已准备，尚未派发试问'); onPrepared();
      const currentOwner = await loadHistory();
      if (sameKnowledgeScope(currentOwner ?? null, owner)) selectBatch(result.batchId);
    } catch (failure) { setProgress(null); setError(assistantError(failure)); notify.error(assistantError(failure)); }
    finally { if (sameKnowledgeScope(scopeRef.current, owner)) setPending(getClient().pending(owner)); setBusy(false); lock.current = false; }
  };
  const resume = async (item: KnowledgeBatchProgressItem) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setDetailError('');
    try {
      await mutations.current.write(base + `evaluations/${item.evaluationId}/resume`, {});
      notify.success('已提交原次执行，将使用本人试问额度'); setReload(value => value + 1);
    } catch (failure) { setProgress(null); setDetailError(assistantError(failure)); notify.error(assistantError(failure)); }
    finally { setBusy(false); lock.current = false; }
  };
  const cancel = async (item: KnowledgeBatchProgressItem) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setDetailError('');
    try {
      const result = await mutations.current.write<{ status: string }>(base + `evaluations/${item.evaluationId}/cancel`, {});
      notify.success(result.status === 'cancelled' ? '原次执行已取消，已提交用量仍需核对' : `原次状态：${statusLabels[result.status] || result.status}`);
      setProgress(null); setReload(value => value + 1);
    } catch (failure) { setProgress(null); setDetailError(assistantError(failure)); notify.error(assistantError(failure)); }
    finally { setBusy(false); lock.current = false; }
  };
  return <>
    <Button disabled={disabled || busy || !scope || !selected.length || !!pending} loading={busy} onClick={() => void prepare()}>准备所选 {selected.length || ''} 题</Button>
    <Button disabled={disabled || busy} onClick={() => { setProgress(null); setOpen(true); void loadHistory(); }}>本人批次</Button>
    {(pending || error) && <Alert type={error ? 'error' : 'warning'} showIcon message={error || `上次 ${pending!.cases.length} 题的准备结果待核对`}
      action={pending ? <Button disabled={disabled || busy || !scope} onClick={() => void prepare(true)}>用原键核对准备</Button> : <Button onClick={() => void loadHistory()}>重新读取批次</Button>} />}
    <Drawer title="本人批次与原次执行" width={720} open={open} onClose={() => { setOpen(false); setProgress(null); batchUrl(null); }}>
      <Space direction="vertical" size={20} style={{ width: '100%' }}>
        <Alert type="info" showIcon message="准备保存快照，逐项执行原次试问" description="批次与评测仅本人可见。准备不会自动派发；执行状态不代表专业含义已经核对，回答与引用仍在原次评测查看。" />
        {error && <Alert type="error" showIcon message={error} action={<Button onClick={() => void loadHistory()}>重新读取</Button>} />}
        {pending && <Alert type="warning" message={`上次 ${pending.cases.length} 题的准备结果待核对`} action={<Button loading={busy} onClick={() => void prepare(true)}>用原键核对准备</Button>} />}
        <List loading={loading} dataSource={history} locale={{ emptyText: <Empty description="尚未准备批次，请先在问题集中选择问题。" /> }} renderItem={item => <List.Item>
          <Button type="link" onClick={() => selectBatch(item.batchId)}>{item.count} 题 · {formatTime(item.createdAt)}</Button>
        </List.Item>} />
        {cursor && <Button loading={loading} onClick={() => void loadHistory(cursor)}>加载更早批次</Button>}
        {batchId && <Button onClick={() => { setProgress(null); setReload(value => value + 1); }}>刷新本批次</Button>}
        {detailLoading && !progress && <Skeleton active />}
        {detailError && <Alert type="error" showIcon message={detailError} />}
        {progress && <>
          <Descriptions column={2} items={[{ key: 'time', label: '准备时间', children: formatTime(progress.createdAt) }, { key: 'count', label: '问题数', children: progress.items.length },
            { key: 'pending', label: '待执行 / 待核对', children: progress.counts.dispatch_pending }, { key: 'active', label: '执行中', children: progress.counts.queued + progress.counts.running },
            { key: 'done', label: '执行成功', children: progress.counts.succeeded }, { key: 'changed', label: '资料变化 / 不可用', children: progress.counts.source_changed + progress.counts.unavailable }]} />
          {progress.contextChanged && <Alert type="warning" showIcon message="准备时的知识或配置已变化，请按当前问题重新准备批次。" />}
          <Table<KnowledgeBatchProgressItem> rowKey="evaluationId" size="small" pagination={false} dataSource={progress.items} scroll={{ x: 570 }} columns={[
            { title: '问题', dataIndex: 'title' }, { title: '问题修订', dataIndex: 'caseRevision', width: 90 },
            { title: '执行状态', render: (_, item) => <Space direction="vertical" size={4}><Tag>{stateLabel(item)}</Tag>{item.awaitingReconciliation && <Tag>用量待核对</Tag>}</Space> },
            { title: '操作', width: 180, render: (_, item) => <Space wrap>
              {item.available && item.status === 'dispatch_pending' && <Button loading={busy} disabled={disabled} onClick={() => void resume(item)}>{item.dispatchState === 'not_started' ? '执行原次' : '恢复原次'}</Button>}
              {item.available && ['queued', 'running'].includes(item.status) && <Popconfirm title="取消本次执行？" description="已提交的调用仍可能产生用量，取消后不会自动重跑。" onConfirm={() => cancel(item)} disabled={busy || disabled}>
                <Button disabled={busy || disabled}>取消原次</Button>
              </Popconfirm>}
              <Button disabled={busy || !item.available} onClick={() => { setOpen(false); setProgress(null); void onOpenEvaluation(item.caseId, item.evaluationId); }}>查看原次</Button>
            </Space> },
          ]} />
          <Typography.Text type="secondary">费用未知；来源结构与专业核对以原次结果为准。页面重进后可从本人批次继续读取相同评测。</Typography.Text>
        </>}
      </Space>
    </Drawer>
  </>;
}
