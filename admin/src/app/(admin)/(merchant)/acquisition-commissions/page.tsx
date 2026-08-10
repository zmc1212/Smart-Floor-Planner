'use client';

import { useRef, useState } from 'react';
import { PageContainer, ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { Button, Card, Flex, Statistic, Tag, Typography } from 'antd';
import { CheckCircle2, Coins } from 'lucide-react';
import { notify } from '@/components/ui/operation-feedback';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';

type RecordItem = {
  _id: string;
  leadId?: { _id: string; name?: string; communityName?: string | null } | string;
  measurerId?: { displayName?: string; username?: string } | string;
  designerId?: { displayName?: string; username?: string } | string;
  commissionAmount: number;
  status: 'pending_settlement' | 'paid' | 'voided';
  generatedAt?: string;
  settledAt?: string | null;
};

const statusLabels = { pending_settlement: '待结算', paid: '已发放', voided: '已作废' };

function person(value?: RecordItem['measurerId']) {
  return value && typeof value !== 'string' ? value.displayName || value.username || '未命名' : '未识别';
}

export default function AcquisitionCommissionsPage() {
  const actionRef = useRef<ActionType>(null);
  const confirmAction = useConfirmDialog();
  const [summary, setSummary] = useState<Record<string, { count?: number; amount?: number }>>({});
  const [settlingId, setSettlingId] = useState<string | null>(null);

  const settle = async (item: RecordItem) => {
    const confirmed = await confirmAction({ title: '确认发放获客提成', description: `确认已向${person(item.measurerId)}完成线下打款吗？`, confirmText: '标记已发放' });
    if (!confirmed) return;
    setSettlingId(item._id);
    try {
      const response = await fetch(`/api/acquisition-commissions/${item._id}/settle`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '结算失败');
      notify.success('获客提成已标记为已发放');
      await actionRef.current?.reload();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '结算失败');
    } finally {
      setSettlingId(null);
    }
  };

  const columns: ProColumns<RecordItem>[] = [
    { title: '状态', dataIndex: 'status', valueType: 'select', valueEnum: Object.fromEntries(Object.entries(statusLabels).map(([value, label]) => [value, label])), render: (_, item) => <Tag color={item.status === 'pending_settlement' ? 'processing' : item.status === 'paid' ? 'success' : 'default'}>{statusLabels[item.status]}</Tag> },
    { title: '客户线索', dataIndex: 'leadId', hideInSearch: true, render: (_, item) => <Flex vertical><Typography.Text strong>{typeof item.leadId === 'string' ? item.leadId : item.leadId?.name || '客户'}</Typography.Text><Typography.Text type="secondary">{typeof item.leadId === 'string' ? '' : item.leadId?.communityName || '未记录小区'}</Typography.Text></Flex> },
    { title: '测量员', dataIndex: 'measurerId', hideInSearch: true, render: (_, item) => person(item.measurerId) },
    { title: '设计师', dataIndex: 'designerId', hideInSearch: true, render: (_, item) => person(item.designerId) },
    { title: '提成金额', dataIndex: 'commissionAmount', hideInSearch: true, render: (value) => <Typography.Text strong>¥ {Number(value || 0).toFixed(2)}</Typography.Text> },
    { title: '生成时间', dataIndex: 'generatedAt', valueType: 'dateTime', hideInSearch: true },
    { title: '操作', key: 'actions', valueType: 'option', fixed: 'right', hideInSearch: true, render: (_, item) => item.status === 'pending_settlement' ? <Button size="small" type="primary" icon={<CheckCircle2 size={14} />} loading={settlingId === item._id} onClick={() => void settle(item)}>确认发放</Button> : <Typography.Text type="secondary">{item.status === 'paid' && item.settledAt ? new Date(item.settledAt).toLocaleString() : '不可操作'}</Typography.Text> },
  ];

  return <div className="admin-page-frame"><PageContainer breadcrumbRender={false} title="测量员获客提成" content="管理线索获客提成的核算与发放状态。"><Flex vertical gap={24}><Flex gap={16} wrap="wrap"><Card className="admin-panel-card min-w-56 flex-1" size="small"><Statistic title="待结算" value={Number(summary.pending_settlement?.amount || 0)} precision={2} prefix="¥" /><Typography.Text type="secondary">{summary.pending_settlement?.count || 0} 笔</Typography.Text></Card><Card className="admin-panel-card min-w-56 flex-1" size="small"><Statistic title="已发放" value={Number(summary.paid?.amount || 0)} precision={2} prefix="¥" /><Typography.Text type="secondary">{summary.paid?.count || 0} 笔</Typography.Text></Card><Card className="admin-panel-card min-w-56 flex-1" size="small"><Flex justify="space-between"><Statistic title="获客提成" value="按企业配置" /><Coins size={20} className="text-primary" /></Flex></Card></Flex><ProTable<RecordItem> actionRef={actionRef} rowKey="_id" columns={columns} search={{ labelWidth: 'auto' }} pagination={{ defaultPageSize: 20 }} request={async (params) => { const query = new URLSearchParams(); if (params.status) query.set('status', String(params.status)); const response = await fetch(`/api/acquisition-commissions?${query}`); const result = await response.json(); if (!response.ok || !result.success) throw new Error(result.error || '读取获客提成失败'); setSummary(result.summary || {}); return { data: result.data || [], total: (result.data || []).length, success: true }; }} onRequestError={(error) => notify.error(error instanceof Error ? error.message : '读取获客提成失败')} /></Flex></PageContainer></div>;
}
