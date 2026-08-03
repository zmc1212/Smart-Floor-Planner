'use client';

import { useRef, useState } from 'react';
import { PageContainer, ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { Button, Card, Flex, Space, Statistic, Tag, Typography } from 'antd';
import { CheckCircle2, CircleDollarSign } from 'lucide-react';
import { notify } from '@/components/ui/operation-feedback';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { useCurrentUser } from '@/hooks/useCurrentUser';

type CommissionStatus = 'pending_settlement' | 'paid' | 'voided';

type CommissionRecord = {
  _id: string;
  recordId?: { _id: string; enterpriseName?: string; contactPerson?: string } | string;
  orderId?: { _id: string; packageName?: string; amount?: number; status?: string } | string;
  promoterId?: { _id: string; displayName?: string; username?: string; role?: string } | string;
  commissionAmount: number;
  commissionType?: string;
  status: CommissionStatus;
  generatedAt?: string;
  settledAt?: string | null;
};

type SummaryItem = { count?: number; amount?: number };
type CommissionSummary = Record<string, SummaryItem | undefined>;

const STATUS_OPTIONS: Array<{ label: string; value: CommissionStatus }> = [
  { label: '待结算', value: 'pending_settlement' },
  { label: '已发放', value: 'paid' },
  { label: '已作废', value: 'voided' },
];

const STATUS_CONFIG: Record<CommissionStatus, { label: string; color?: string }> = {
  pending_settlement: { label: '待结算', color: 'processing' },
  paid: { label: '已发放', color: 'success' },
  voided: { label: '已作废', color: 'default' },
};

function formatAmount(amount: number) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
  }).format(Number(amount || 0));
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '-';
}

function displayPromoter(record: CommissionRecord) {
  if (!record.promoterId || typeof record.promoterId === 'string') return '未识别渠道人员';
  return record.promoterId.displayName || record.promoterId.username || '未命名渠道人员';
}

function displayEnterprise(record: CommissionRecord) {
  return record.recordId && typeof record.recordId !== 'string' ? record.recordId.enterpriseName || '未知企业' : '未知企业';
}

function displayPackage(record: CommissionRecord) {
  return record.orderId && typeof record.orderId !== 'string' ? record.orderId.packageName || '标准套餐' : '标准套餐';
}

export default function CommissionsPage() {
  const actionRef = useRef<ActionType>(null);
  const confirmAction = useConfirmDialog();
  const { user: currentUser } = useCurrentUser();
  const [summary, setSummary] = useState<CommissionSummary>({});
  const [settlingId, setSettlingId] = useState<string | null>(null);

  const canSettle = Boolean(currentUser && ['admin', 'super_admin'].includes(currentUser.role));
  const pendingSummary = summary.pending_settlement || {};
  const paidSummary = summary.paid || {};

  const settleCommission = async (record: CommissionRecord) => {
    const confirmed = await confirmAction({
      title: '确认结算',
      description: `确认已向“${displayPromoter(record)}”完成线下打款，并将这笔提成标记为已发放吗？`,
      confirmText: '标记已结算',
    });
    if (!confirmed) return;

    setSettlingId(record._id);
    try {
      const response = await fetch(`/api/commissions/${record._id}/settle`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '结算提成失败');
      notify.success('提成已标记为已发放');
      await actionRef.current?.reload();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '结算提成失败');
    } finally {
      setSettlingId(null);
    }
  };

  const columns: ProColumns<CommissionRecord>[] = [
    {
      title: '关键词',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: { placeholder: '渠道人员、企业或套餐名称' },
    },
    {
      title: '状态',
      dataIndex: 'status',
      valueType: 'select',
      valueEnum: Object.fromEntries(STATUS_OPTIONS.map((item) => [item.value, item.label])),
      width: 130,
      render: (_, record) => {
        const config = STATUS_CONFIG[record.status];
        return <Tag color={config.color}>{config.label}</Tag>;
      },
    },
    {
      title: '渠道人员',
      dataIndex: 'promoterId',
      hideInSearch: true,
      width: 220,
      render: (_, record) => (
        <Flex vertical gap={2}>
          <Typography.Text strong>{displayPromoter(record)}</Typography.Text>
          {record.promoterId && typeof record.promoterId !== 'string' ? (
            <Typography.Text type="secondary" className="text-xs">@{record.promoterId.username || record.promoterId._id}</Typography.Text>
          ) : null}
        </Flex>
      ),
    },
    {
      title: '关联企业 / 订单',
      key: 'business',
      hideInSearch: true,
      width: 260,
      render: (_, record) => (
        <Flex vertical gap={2}>
          <Typography.Text>{displayEnterprise(record)}</Typography.Text>
          <Typography.Text type="secondary" className="text-xs">{displayPackage(record)}</Typography.Text>
        </Flex>
      ),
    },
    {
      title: '提成金额',
      dataIndex: 'commissionAmount',
      hideInSearch: true,
      width: 160,
      render: (value) => <Typography.Text strong>{formatAmount(Number(value))}</Typography.Text>,
    },
    {
      title: '生成时间',
      dataIndex: 'generatedAt',
      valueType: 'dateTime',
      hideInSearch: true,
      width: 190,
      render: (_, record) => formatDate(record.generatedAt),
    },
    {
      title: '结算状态',
      key: 'settlement',
      valueType: 'option',
      fixed: 'right',
      width: 170,
      hideInSearch: true,
      render: (_, record) => {
        if (record.status === 'pending_settlement' && canSettle) {
          return <Button type="primary" loading={settlingId === record._id} onClick={() => void settleCommission(record)}>确认发放</Button>;
        }
        if (record.status === 'paid') {
          return <Space size={4}><CheckCircle2 size={15} className="text-primary" /><Typography.Text type="secondary" className="text-xs">{formatDate(record.settledAt)}</Typography.Text></Space>;
        }
        return <Typography.Text type="secondary">不可操作</Typography.Text>;
      },
    },
  ];

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="提成结算中心"
        content="查看渠道提成核算与发放状态。付费订单会自动生成相应的提成记录。"
      >
        <Flex vertical gap={24}>
          <Flex gap={16} wrap="wrap">
            <Card className="admin-panel-card min-w-56 flex-1" size="small">
              <Statistic title="待结算总额" value={Number(pendingSummary.amount || 0)} precision={2} prefix="¥" />
              <Typography.Text type="secondary">{pendingSummary.count || 0} 笔待处理</Typography.Text>
            </Card>
            <Card className="admin-panel-card min-w-56 flex-1" size="small">
              <Statistic title="已发放总额" value={Number(paidSummary.amount || 0)} precision={2} prefix="¥" />
              <Typography.Text type="secondary">{paidSummary.count || 0} 笔已入账</Typography.Text>
            </Card>
            <Card className="admin-panel-card min-w-56 flex-1" size="small">
              <Flex justify="space-between" align="start"><Statistic title="累计核算" value={Number(pendingSummary.amount || 0) + Number(paidSummary.amount || 0)} precision={2} prefix="¥" /><CircleDollarSign size={20} className="text-primary" /></Flex>
              <Typography.Text type="secondary">成交转化产生的提成总额</Typography.Text>
            </Card>
          </Flex>

          <ProTable<CommissionRecord>
            className="admin-mobile-filter-stack"
            actionRef={actionRef}
            rowKey="_id"
            columns={columns}
            search={{ labelWidth: 'auto', defaultCollapsed: false, span: 12 }}
            options={{ reload: true, density: true, setting: true }}
            pagination={{ defaultPageSize: 20, showSizeChanger: true }}
            scroll={{ x: 1080 }}
          request={async (params) => {
              const query = new URLSearchParams();
              if (params.status) query.set('status', String(params.status));
              const response = await fetch(`/api/commissions${query.size ? `?${query}` : ''}`);
              const result = await response.json();
              if (!response.ok || !result.success) throw new Error(result.error || '读取提成记录失败');
              setSummary(result.summary || {});
              const keyword = String(params.keyword || '').trim().toLowerCase();
              const filtered = (result.data || []).filter((record: CommissionRecord) => !keyword || [
                displayPromoter(record),
                displayEnterprise(record),
                displayPackage(record),
              ].some((value) => value.toLowerCase().includes(keyword)));
              const pageSize = Number(params.pageSize || 20);
              const current = Number(params.current || 1);
              return {
                data: filtered.slice((current - 1) * pageSize, current * pageSize),
                total: filtered.length,
              success: true,
            };
          }}
          onRequestError={(error) => notify.error(error instanceof Error ? error.message : '读取提成记录失败')}
        />
        </Flex>
      </PageContainer>
    </div>
  );
}
