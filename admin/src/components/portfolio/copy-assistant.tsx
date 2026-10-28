'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Input, Space, Typography } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import type { PortfolioCopy } from '@/lib/portfolio/copy-contract';
import { errorText, PortfolioMutations, portfolioRequest } from './client';
type Task = { id: string; state: string; result: PortfolioCopy | null; adopted: boolean; error: string | null };
const pending = (task: Task | null) => !!task && ['prepared', 'running', 'submitting'].includes(task.state);
export function CopyAssistant({ workId, version, editable, disabled, onAdopt }: {
  workId: string; version: number; editable: boolean; disabled: boolean; onAdopt(): Promise<void>;
}) {
  const [task, setTask] = useState<Task | null>(null), [instruction, setInstruction] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const mutations = useRef(new PortfolioMutations()), generation = useRef(0);
  const load = useCallback(async () => {
    const epoch = ++generation.current;
    try {
      const result = await portfolioRequest<{ task: Task | null }>(`works/${workId}/copy-drafts`);
      if (generation.current === epoch) { setTask(result.task); setError(''); }
    } catch (e) { if (generation.current === epoch) { setTask(null); setError(errorText(e)); } }
  }, [workId]);
  useEffect(() => { const guard = generation; void load(); return () => { guard.current++; }; }, [load, version]);
  useEffect(() => { const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 2500); return () => clearInterval(timer); }, [load]);
  useEffect(() => { const visibility = () => { if (document.visibilityState === 'hidden') { generation.current++; setTask(null); } else void load(); }; document.addEventListener('visibilitychange', visibility); return () => document.removeEventListener('visibilitychange', visibility); }, [load]);
  const run = async (action: 'create' | 'adopt') => {
    if (busy) return; setBusy(action);
    try {
      if (action === 'create') {
        const result = await mutations.current.write<Task>(`works/${workId}/copy-drafts`, { expectedVersion: version, instruction });
        setTask(result); notify.success('已提交文案草稿任务', { description: '可退出重进查看，生成结果仍需核对。' });
      } else if (task) {
        await mutations.current.write(`works/${workId}/adopt-copy`, { expectedVersion: version, taskId: task.id });
        notify.success('已采用到作品草稿', { description: '请继续核对并提交企业审核。' }); await onAdopt();
      }
      setError('');
    } catch (e) { setError(errorText(e)); notify.error('操作失败', { description: errorText(e) }); }
    finally { setBusy(''); }
  };
  return <Card title="小K文案辅助" style={{ marginTop: 20 }}>
    <Space direction="vertical" style={{ width: '100%' }}>
      <Typography.Paragraph type="secondary">先保存作品资料与许可，再说明写作要求。只整理已填资料，不识别图片；生成后请核对作者、图片性质与事实。</Typography.Paragraph>
      {error && <Alert type="error" message={error} action={<Button onClick={() => void load()}>重新读取</Button>} />}
      <Input.TextArea aria-label="文案要求" value={instruction} onChange={e => setInstruction(e.target.value)} maxLength={500} rows={2} placeholder="例如：介绍客餐厅的收纳思路，分享时语气自然一些" disabled={disabled || !!busy || pending(task)} />
      <Button loading={busy === 'create' || pending(task)} disabled={!editable || disabled || !!busy || !instruction.trim() || pending(task) || task?.state === 'indeterminate'} onClick={() => void run('create')}>生成文案草稿</Button>
      {pending(task) && <Typography.Text type="secondary">正在生成，退出后任务仍会继续。</Typography.Text>}
      {task?.state === 'indeterminate' && <Alert type="warning" message="生成结果待核对，已保留原任务与用量。请联系管理员核查，暂不重复生成。" />}
      {task?.state === 'failed' && <Alert type="warning" message="本次生成未完成，作品草稿未改变。请核对资料后重试。" />}
      {task?.state === 'stale' && <Typography.Text type="secondary">作品或许可已变化，旧文案已失效。</Typography.Text>}
      {task?.result && <>
        <Typography.Text strong>{task.result.title}</Typography.Text><Typography.Paragraph>{task.result.description}</Typography.Paragraph>
        <Typography.Text strong>分享文案草稿</Typography.Text><Typography.Paragraph>{task.result.shareText}</Typography.Paragraph>
        {!!task.result.checks.length && <Alert type="info" message="待核对" description={task.result.checks.join('；')} />}
        <Button disabled={!editable || disabled || !!busy || task.adopted} loading={busy === 'adopt'} onClick={() => void run('adopt')}>{task.adopted ? '已采用到草稿' : '已核对，采用标题与介绍'}</Button>
        {task.adopted && <Button onClick={async () => { try {
          const latest = await portfolioRequest<{ task: Task | null }>(`works/${workId}/copy-drafts`);
          if (latest.task?.id !== task.id || !latest.task.adopted || !latest.task.result) { setTask(latest.task); throw Error('作品或许可已变化，请重新核对。'); }
          await navigator.clipboard.writeText(latest.task.result.shareText); notify.success('已复制分享草稿', { description: '请核对并随已审核作品分享。' });
        } catch (e) { setTask(null); notify.error('复制失败', { description: errorText(e) }); } }}>复制分享草稿</Button>}
      </>}
    </Space>
  </Card>;
}
