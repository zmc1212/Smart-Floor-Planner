'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  ModalForm,
  PageContainer,
  ProFormDigit,
  ProFormSelect,
  ProFormTextArea,
  ProTable,
  type ActionType,
  type ProColumns,
  type ProFormInstance,
} from '@ant-design/pro-components';
import { Button, Dropdown, Flex, Space, Tag, Tooltip, Typography, type MenuProps } from 'antd';
import { CheckCircle2, Ellipsis, Plus } from 'lucide-react';
import { notify } from '@/components/admin/operation-feedback';
import { useConfirmDialog } from '@/components/admin/confirm-dialog';
import { useCurrentUser } from '@/hooks/useCurrentUser';

type OrderStatus = 'draft' | 'signed' | 'paid' | 'cancelled';

type EnterpriseOrder = {
  _id: string;
  enterpriseId?: string | null;
  enterpriseNameSnapshot: string;
  packageName: string;
  amount: number;
  currency?: string;
  status: OrderStatus;
  createdAt?: string;
  remark?: string | null;
  recordId?: { _id: string; enterpriseName?: string } | string;
};

type PromotionRecord = {
  _id: string;
  enterpriseName: string;
};

type PackageItem = {
  _id: string;
  name: string;
  price: number;
};

type OrderForm = {
  recordId: string;
  packageId: string;
  amount: number;
  status: Exclude<OrderStatus, 'cancelled'>;
  remark?: string;
};

const ORDER_STATUS_OPTIONS: Array<{ label: string; value: OrderStatus }> = [
  { label: '草稿', value: 'draft' },
  { label: '已签约', value: 'signed' },
  { label: '已支付', value: 'paid' },
  { label: '已取消', value: 'cancelled' },
];

const ORDER_STATUS_CONFIG: Record<OrderStatus, { label: string; color?: string }> = {
  draft: { label: '草稿' },
  signed: { label: '已签约', color: 'blue' },
  paid: { label: '已支付', color: 'green' },
  cancelled: { label: '已取消', color: 'default' },
};

function formatAmount(amount: number, currency = 'CNY') {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(Number(amount || 0));
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN') : '-';
}

function recordIdOf(order: EnterpriseOrder) {
  return typeof order.recordId === 'string' ? order.recordId : order.recordId?._id;
}

export default function EnterpriseOrdersPage() {
  const actionRef = useRef<ActionType>(null);
  const formRef = useRef<ProFormInstance<OrderForm>>(null);
  const confirmAction = useConfirmDialog();
  const { user: currentUser } = useCurrentUser();
  const [createOpen, setCreateOpen] = useState(false);
  const [records, setRecords] = useState<PromotionRecord[]>([]);
  const [packages, setPackages] = useState<PackageItem[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [activatingOrderId, setActivatingOrderId] = useState<string | null>(null);

  const canManageOrders = ['enterprise_admin', 'admin', 'super_admin'].includes(currentUser?.role || '');
  const canActivateEnterprise = ['admin', 'super_admin'].includes(currentUser?.role || '');

  const loadCreateOptions = useCallback(async () => {
    setLoadingOptions(true);
    try {
      const [recordsResponse, packagesResponse] = await Promise.all([
        fetch('/api/promotion-records'),
        fetch('/api/admin/packages?status=active'),
      ]);
      const [recordsResult, packagesResult] = await Promise.all([
        recordsResponse.json(),
        packagesResponse.json(),
      ]);
      if (!recordsResponse.ok || !recordsResult.success) {
        throw new Error(recordsResult.error || '读取企业报备失败');
      }
      if (!packagesResponse.ok || !packagesResult.success) {
        throw new Error(packagesResult.error || '读取套餐失败');
      }
      setRecords(recordsResult.data || []);
      setPackages(packagesResult.data || []);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '读取订单创建资料失败');
    } finally {
      setLoadingOptions(false);
    }
  }, []);

  const openCreateForm = () => {
    setCreateOpen(true);
    void loadCreateOptions();
  };

  const createOrder = async (values: OrderForm) => {
    const selectedPackage = packages.find((item) => item._id === values.packageId);
    if (!selectedPackage) {
      notify.error('请选择有效的成交套餐');
      return false;
    }

    try {
      const response = await fetch('/api/enterprise-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: values.recordId,
          packageId: values.packageId,
          packageName: selectedPackage.name,
          amount: values.amount,
          status: values.status,
          remark: values.remark || '',
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '创建订单失败');
      notify.success('订单创建成功');
      setCreateOpen(false);
      await actionRef.current?.reload();
      return true;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '创建订单失败');
      return false;
    }
  };

  const updateStatus = async (order: EnterpriseOrder, status: OrderStatus) => {
    try {
      const response = await fetch(`/api/enterprise-orders/${order._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '更新订单状态失败');
      notify.success('订单状态已更新');
      await actionRef.current?.reload();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '更新订单状态失败');
    }
  };

  const activateEnterprise = async (order: EnterpriseOrder) => {
    const recordId = recordIdOf(order);
    if (!recordId) {
      notify.error('订单缺少对应的企业报备，无法开通账号');
      return;
    }
    const confirmed = await confirmAction({
      title: '开通正式账号',
      description: `确定要为“${order.enterpriseNameSnapshot}”开通正式账号吗？系统将自动创建企业并分配管理员账号。`,
      confirmText: '开通',
    });
    if (!confirmed) return;

    setActivatingOrderId(order._id);
    try {
      const response = await fetch('/api/admin/enterprises/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId, orderId: order._id }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '开通失败');
      notify.success(`开通成功：${result.data.enterpriseName}，管理员账号为 ${result.data.adminUsername}`);
      await actionRef.current?.reload();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '开通失败');
    } finally {
      setActivatingOrderId(null);
    }
  };

  const columns: ProColumns<EnterpriseOrder>[] = [
    {
      title: '关键词',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: { placeholder: '企业名称或套餐名称' },
    },
    {
      title: '订单状态',
      dataIndex: 'status',
      valueType: 'select',
      valueEnum: Object.fromEntries(ORDER_STATUS_OPTIONS.map((item) => [item.value, item.label])),
      width: 120,
      render: (_, order) => {
        const config = ORDER_STATUS_CONFIG[order.status];
        return <Tag color={config.color}>{config.label}</Tag>;
      },
    },
    {
      title: '企业',
      dataIndex: 'enterpriseNameSnapshot',
      hideInSearch: true,
      width: 260,
      render: (_, order) => (
        <Flex vertical gap={4}>
          <Typography.Text strong>{order.enterpriseNameSnapshot}</Typography.Text>
          {order.enterpriseId ? (
            <Space size={4}>
              <CheckCircle2 size={14} className="text-primary" />
              <Typography.Text type="secondary" className="text-xs">已开通企业账号</Typography.Text>
            </Space>
          ) : (
            <Typography.Text type="secondary" className="text-xs">待企业账号开通</Typography.Text>
          )}
        </Flex>
      ),
    },
    {
      title: '成交套餐',
      dataIndex: 'packageName',
      hideInSearch: true,
      width: 180,
      render: (value) => value || '-',
    },
    {
      title: '成交金额',
      dataIndex: 'amount',
      hideInSearch: true,
      width: 150,
      render: (_, order) => <Typography.Text strong>{formatAmount(order.amount, order.currency)}</Typography.Text>,
    },
    {
      title: '备注',
      dataIndex: 'remark',
      hideInSearch: true,
      ellipsis: true,
      render: (value) => value || <Typography.Text type="secondary">-</Typography.Text>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      hideInSearch: true,
      width: 190,
      render: (_, order) => formatDate(order.createdAt),
    },
    {
      title: '操作',
      key: 'actions',
      valueType: 'option',
      fixed: 'right',
      width: 170,
      hideInSearch: true,
      render: (_, order) => {
        const actions: ReactNode[] = [];
        if (!order.enterpriseId && order.status === 'paid' && canActivateEnterprise) {
          actions.push(
            <Button key="activate" size="small" type="primary" icon={<CheckCircle2 size={14} />} loading={activatingOrderId === order._id} onClick={() => void activateEnterprise(order)}>
              开通账号
            </Button>,
          );
        }
        if (canManageOrders && order.status !== 'paid') {
          const items: MenuProps['items'] = ORDER_STATUS_OPTIONS
            .filter((option) => option.value !== order.status)
            .map((option) => ({
              key: option.value,
              label: `标记为${option.label}`,
              onClick: () => void updateStatus(order, option.value),
            }));
          actions.push(
            <Dropdown key="status" menu={{ items }} trigger={['click']}>
              <Tooltip title="更新订单状态">
                <Button size="small" aria-label={`${order.enterpriseNameSnapshot} 更多操作`} icon={<Ellipsis size={16} />} />
              </Tooltip>
            </Dropdown>,
          );
        }
        return actions.length ? <Space size={8}>{actions}</Space> : '-';
      },
    },
  ];

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="成交订单"
        content="登记企业成交并跟踪订单状态；订单支付后将自动生成对应的渠道提成记录。"
        extra={canManageOrders ? [
          <Button key="create" type="primary" icon={<Plus size={16} />} onClick={openCreateForm}>新建订单</Button>,
        ] : undefined}
      >
        <ProTable<EnterpriseOrder>
          actionRef={actionRef}
          rowKey="_id"
          columns={columns}
          search={{ labelWidth: 'auto', defaultCollapsed: false, span: 12 }}
          options={{ reload: true, density: true, setting: true }}
          pagination={{ defaultPageSize: 20, showSizeChanger: true }}
          scroll={{ x: 1120 }}
          request={async (params) => {
            const response = await fetch('/api/enterprise-orders');
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || '读取订单失败');
            const keyword = String(params.keyword || '').trim().toLowerCase();
            const filtered = (result.data || []).filter((order: EnterpriseOrder) => {
              const matchesKeyword = !keyword || [order.enterpriseNameSnapshot, order.packageName]
                .filter(Boolean)
                .some((value) => value.toLowerCase().includes(keyword));
              const matchesStatus = !params.status || order.status === params.status;
              return matchesKeyword && matchesStatus;
            });
            const pageSize = Number(params.pageSize || 20);
            const current = Number(params.current || 1);
            return {
              data: filtered.slice((current - 1) * pageSize, current * pageSize),
              total: filtered.length,
              success: true,
            };
          }}
        />
      </PageContainer>

      <ModalForm<OrderForm>
        formRef={formRef}
        title="新建成交订单"
        open={createOpen}
        initialValues={{ status: 'draft' }}
        modalProps={{ destroyOnHidden: true, maskClosable: false }}
        onOpenChange={(open) => setCreateOpen(open)}
        onFinish={createOrder}
        submitter={{
          searchConfig: { submitText: '保存订单' },
          render: (_, dom) => <Flex justify="end" gap={12} style={{ marginTop: 24 }}>{dom}</Flex>,
        }}
      >
        <ProFormSelect
          name="recordId"
          label="企业报备"
          options={records.map((record) => ({ label: record.enterpriseName, value: record._id }))}
          rules={[{ required: true, message: '请选择企业报备' }]}
          fieldProps={{ loading: loadingOptions, showSearch: true, optionFilterProp: 'label', placeholder: '选择企业报备' }}
        />
        <ProFormSelect
          name="packageId"
          label="成交套餐"
          options={packages.map((item) => ({ label: `${item.name} (${formatAmount(item.price)})`, value: item._id }))}
          rules={[{ required: true, message: '请选择成交套餐' }]}
          fieldProps={{
            loading: loadingOptions,
            showSearch: true,
            optionFilterProp: 'label',
            placeholder: '选择成交套餐',
            onChange: (packageId) => {
              const selected = packages.find((item) => item._id === packageId);
              if (selected) formRef.current?.setFieldValue('amount', selected.price);
            },
          }}
        />
        <ProFormDigit name="amount" label="成交金额（元）" min={0} fieldProps={{ precision: 2, className: 'w-full', placeholder: '请输入成交金额' }} rules={[{ required: true, message: '请输入成交金额' }]} />
        <ProFormSelect
          name="status"
          label="订单状态"
          options={ORDER_STATUS_OPTIONS.filter((option) => option.value !== 'cancelled')}
          rules={[{ required: true, message: '请选择订单状态' }]}
        />
        <ProFormTextArea name="remark" label="备注" fieldProps={{ rows: 4, placeholder: '记录成交、合同或款项说明...' }} />
      </ModalForm>
    </div>
  );
}
