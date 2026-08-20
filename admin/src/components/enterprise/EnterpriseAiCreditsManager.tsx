'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ProForm,
  ProFormDigit,
  ProFormSelect,
  ProFormText,
  ProTable,
  type ProColumns,
  type ProFormInstance,
} from '@ant-design/pro-components';
import { Button, Card, Checkbox, Flex, Statistic, Tabs, Tag, Typography } from 'antd';
import { Coins, RefreshCw, RotateCcw, Save } from 'lucide-react';
import { useFetch } from '@/hooks/useFetch';
import { notify } from '@/components/admin/operation-feedback';

type CreditsData = {
  account: { balance: number; frozenBalance: number; availableBalance: number };
  policy: { enabledActionKeys: string[]; logicalModelTier: 'standard' };
  ledger: Array<{ id: string; type: string; amount: number; balanceAfter?: number; frozenAfter?: number; note?: string; operator: string; createdAt: string }>;
  tasks: Array<{ id: string; mode: string; actionKey?: string; channel?: string; status: string; externalStatus?: string; credits: number; provider?: string; model?: string; error?: string; operator: string; createdAt: string }>;
};

type AdjustmentForm = { action: 'grant' | 'adjust'; amount: number; note: string };

const TYPE_LABELS: Record<string, string> = { grant: '发放', adjust: '人工调整', hold: '任务冻结', consume: '成功扣费', release: '失败释放' };
const MODE_LABELS: Record<string, string> = { reference_recreate: '复刻参考图', style_transform: '空间换风格', floor_plan_style: '户型风格', furnishing_render: '空间效果图', soft_furnishing_render: '软装效果图', scenario: '场景方案', advice: '设计建议' };
const ACTIONS = [
  ['image.reference_recreate', '复刻参考图'], ['image.style_transform', '空间换风格'],
  ['image.floor_plan_style', '户型风格'], ['image.furnishing_render', '空间效果图'],
  ['image.soft_furnishing_render', '软装效果图'], ['image.scenario', '场景方案'],
  ['text.design_advice', '设计建议'],
] as const;
const formatDate = (value: string) => value ? new Date(value).toLocaleString('zh-CN') : '-';

export default function EnterpriseAiCreditsManager({ enterpriseId }: { enterpriseId: string }) {
  const { data, isLoading, mutate } = useFetch<CreditsData>(enterpriseId ? `/api/admin/enterprises/${enterpriseId}/ai-credits` : null);
  const adjustmentFormRef = useRef<ProFormInstance<AdjustmentForm>>(null);
  const [policyActions, setPolicyActions] = useState<string[]>([]);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [retryingId, setRetryingId] = useState('');
  const account = data?.account || { balance: 0, frozenBalance: 0, availableBalance: 0 };

  useEffect(() => {
    if (data?.policy.enabledActionKeys) setPolicyActions(data.policy.enabledActionKeys);
  }, [data?.policy.enabledActionKeys]);

  const actionOptions = useMemo(() => ACTIONS.map(([value, label]) => ({ value, label })), []);

  const savePolicy = async () => {
    if (!policyActions.length) {
      notify.error('至少保留一个企业 AI 功能');
      return;
    }
    setSavingPolicy(true);
    try {
      const response = await fetch(`/api/admin/enterprises/${enterpriseId}/ai-credits`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabledActionKeys: policyActions, logicalModelTier: 'standard' }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存企业 AI 策略失败');
      await mutate();
      notify.success('企业 AI 功能策略已保存');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存企业 AI 策略失败');
    } finally {
      setSavingPolicy(false);
    }
  };

  const submitAdjustment = async (values: AdjustmentForm) => {
    const amount = Number(values.amount);
    if (!Number.isInteger(amount) || amount === 0 || (values.action === 'grant' && amount < 0)) {
      notify.error(values.action === 'grant' ? '发放点数必须是正整数' : '调整点数必须是非零整数');
      return false;
    }
    try {
      const response = await fetch(`/api/admin/enterprises/${enterpriseId}/ai-credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: values.action, amount, note: values.note.trim() }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '调整 AI 点数失败');
      adjustmentFormRef.current?.resetFields();
      await mutate();
      notify.success(values.action === 'grant' ? 'AI 点数已发放' : 'AI 点数已调整');
      return true;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '调整 AI 点数失败');
      return false;
    }
  };

  const retryTask = async (id: string) => {
    setRetryingId(id);
    try {
      const response = await fetch(`/api/admin/ai-generations/${id}/retry`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '任务重试失败');
      await mutate();
      notify.success('AI 任务已进入新计费周期');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '任务重试失败');
    } finally {
      setRetryingId('');
    }
  };

  const ledgerColumns: ProColumns<CreditsData['ledger'][number]>[] = [
    { title: '时间', dataIndex: 'createdAt', width: 180, render: (_, item) => <Typography.Text type="secondary">{formatDate(item.createdAt)}</Typography.Text> },
    { title: '类型', dataIndex: 'type', width: 110, render: (_, item) => <Tag>{TYPE_LABELS[item.type] || item.type}</Tag> },
    { title: '数量', dataIndex: 'amount', width: 100, render: (_, item) => <Typography.Text type={item.amount < 0 ? 'danger' : 'success'} strong>{item.amount > 0 ? '+' : ''}{item.amount}</Typography.Text> },
    { title: '余额 / 冻结', key: 'balance', width: 140, render: (_, item) => `${item.balanceAfter ?? '-'} / ${item.frozenAfter ?? '-'}` },
    { title: '操作人', dataIndex: 'operator', width: 130 },
    { title: '原因', dataIndex: 'note', ellipsis: true, render: (value) => value || <Typography.Text type="secondary">-</Typography.Text> },
  ];
  const taskColumns: ProColumns<CreditsData['tasks'][number]>[] = [
    { title: '时间', dataIndex: 'createdAt', width: 180, render: (_, task) => <Typography.Text type="secondary">{formatDate(task.createdAt)}</Typography.Text> },
    { title: '业务动作', dataIndex: 'mode', width: 200, render: (_, task) => <Flex vertical gap={2}><Typography.Text>{MODE_LABELS[task.mode] || task.mode}</Typography.Text><Typography.Text type="secondary" className="font-mono text-xs">{task.actionKey || '-'}</Typography.Text></Flex> },
    { title: '客户端', dataIndex: 'channel', width: 110, render: (value) => value || 'admin' },
    { title: '状态', dataIndex: 'status', width: 145, render: (_, task) => <>{<Tag color={task.status === 'failed' ? 'error' : task.status === 'succeeded' ? 'success' : 'processing'}>{task.status}</Tag>}{task.externalStatus === 'unknown' ? <Tag>待对账</Tag> : null}</> },
    { title: '点数', dataIndex: 'credits', width: 90 },
    { title: '实际路由', key: 'routing', width: 180, render: (_, task) => `${task.provider || '-'} / ${task.model || '-'}` },
    { title: '操作人', dataIndex: 'operator', width: 120 },
    { title: '操作', key: 'actions', valueType: 'option', fixed: 'right', width: 100, render: (_, task) => task.status === 'failed' && task.channel === 'miniprogram' ? <Button size="small" icon={<RotateCcw size={14} />} loading={retryingId === task.id} onClick={() => void retryTask(task.id)}>重试</Button> : '-' },
  ];

  return (
    <Flex vertical gap={24} className="admin-config-stack">
      <section>
        <Flex justify="space-between" align="start" gap={16} wrap>
          <div>
            <Typography.Title level={4} className="!mb-1"><Coins size={20} className="mr-2 inline text-primary" />企业 AI 点数</Typography.Title>
            <Typography.Text type="secondary">后台与小程序共用余额；创建任务冻结，正式结果持久化后扣除，明确失败后释放。</Typography.Text>
          </div>
          <Button icon={<RefreshCw size={16} />} loading={isLoading} onClick={() => void mutate()}>刷新</Button>
        </Flex>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border bg-card p-4"><Statistic title="可用点数" value={account.availableBalance} valueStyle={{ color: '#16a34a' }} /></div>
          <div className="rounded-lg border bg-card p-4"><Statistic title="账户点数" value={account.balance} /></div>
          <div className="rounded-lg border bg-card p-4"><Statistic title="冻结点数" value={account.frozenBalance} /></div>
        </div>
      </section>

      <Card title="允许的 AI 功能" extra={<Button icon={<Save size={16} />} loading={savingPolicy} onClick={() => void savePolicy()}>保存策略</Button>} className="admin-panel-card">
        <Flex vertical gap={16}>
          <Typography.Text type="secondary">逻辑模型档位：standard</Typography.Text>
          <Checkbox.Group value={policyActions} options={actionOptions} onChange={(values) => setPolicyActions(values as string[])} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" />
        </Flex>
      </Card>

      <Card title="人工调整点数" className="admin-panel-card">
        <ProForm<AdjustmentForm>
          formRef={adjustmentFormRef}
          layout="vertical"
          initialValues={{ action: 'grant' }}
          onFinish={submitAdjustment}
          submitter={{
            searchConfig: { submitText: '确认调整' },
            render: (_, dom) => <Flex justify="end" gap={12} className="admin-form-actions">{dom}</Flex>,
          }}
        >
          <div className="grid gap-x-5 lg:grid-cols-[180px_160px_1fr]">
            <ProFormSelect name="action" label="操作类型" options={[{ value: 'grant', label: '发放点数' }, { value: 'adjust', label: '人工调整' }]} rules={[{ required: true }]} />
            <ProFormDigit name="amount" label="点数" min={-100000} max={100000} fieldProps={{ precision: 0, className: 'w-full' }} rules={[{ required: true, message: '请输入调整点数' }]} />
            <ProFormText name="note" label="调整原因" fieldProps={{ placeholder: '用于运营审计，不可为空' }} rules={[{ required: true, whitespace: true, message: '请填写调整原因' }]} />
          </div>
        </ProForm>
      </Card>

      <Tabs
        defaultActiveKey="ledger"
        items={[
          { key: 'ledger', label: '点数流水', children: <ProTable<CreditsData['ledger'][number]> rowKey="id" columns={ledgerColumns} dataSource={data?.ledger || []} loading={isLoading} search={false} options={false} pagination={{ defaultPageSize: 10, showSizeChanger: true }} scroll={{ x: 920 }} /> },
          { key: 'tasks', label: 'AI 任务', children: <ProTable<CreditsData['tasks'][number]> rowKey="id" columns={taskColumns} dataSource={data?.tasks || []} loading={isLoading} search={false} options={false} pagination={{ defaultPageSize: 10, showSizeChanger: true }} scroll={{ x: 1120 }} /> },
        ]}
      />
    </Flex>
  );
}
