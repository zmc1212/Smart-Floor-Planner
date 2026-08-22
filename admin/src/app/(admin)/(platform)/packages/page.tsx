'use client';

import { useRef, useState } from 'react';
import {
  ModalForm,
  PageContainer,
  ProFormDigit,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
  ProTable,
  type ActionType,
  type ProColumns,
} from '@ant-design/pro-components';
import { Button, Flex, Space, Tag, Typography } from 'antd';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { notify } from '@/components/admin/operation-feedback';
import { useConfirmDialog } from '@/components/admin/confirm-dialog';
import { useCurrentUser } from '@/hooks/useCurrentUser';

type PackageStatus = 'active' | 'disabled';

type PackageItem = {
  _id: string;
  name: string;
  price: number;
  promotionCommission: number;
  description?: string | null;
  status: PackageStatus;
  createdAt?: string;
};

type PackageForm = {
  name: string;
  price: number;
  promotionCommission: number;
  description?: string;
  status: PackageStatus;
};

const STATUS_OPTIONS: Array<{ label: string; value: PackageStatus }> = [
  { label: '已启用', value: 'active' },
  { label: '已禁用', value: 'disabled' },
];

function formatAmount(amount: number) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
  }).format(Number(amount || 0));
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN') : '-';
}

export default function PackagesPage() {
  const actionRef = useRef<ActionType>(null);
  const confirmAction = useConfirmDialog();
  const { user: currentUser } = useCurrentUser();
  const [editingItem, setEditingItem] = useState<PackageItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const canManagePackages = ['admin', 'super_admin'].includes(currentUser?.role || '');

  const savePackage = async (values: PackageForm) => {
    const isEdit = Boolean(editingItem);
    try {
      const response = await fetch(
        isEdit ? `/api/admin/packages/${editingItem?._id}` : '/api/admin/packages',
        {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        },
      );
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存套餐失败');
      notify.success(isEdit ? '套餐已更新' : '套餐已创建');
      setFormOpen(false);
      setEditingItem(null);
      await actionRef.current?.reload();
      return true;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存套餐失败');
      return false;
    }
  };

  const deletePackage = async (item: PackageItem) => {
    if (deletingId) return;
    const confirmed = await confirmAction({
      title: '删除套餐',
      description: `确定删除“${item.name}”吗？此操作不可撤销。`,
      confirmText: '删除',
      destructive: true,
    });
    if (!confirmed) return;
    setDeletingId(item._id);
    try {
      const response = await fetch(`/api/admin/packages/${item._id}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '删除套餐失败');
      notify.success('套餐已删除');
      await actionRef.current?.reload();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '删除套餐失败');
    } finally {
      setDeletingId(null);
    }
  };

  const columns: ProColumns<PackageItem>[] = [
    {
      title: '关键词',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: { placeholder: '套餐名称或描述' },
    },
    {
      title: '状态',
      dataIndex: 'status',
      valueType: 'select',
      valueEnum: Object.fromEntries(STATUS_OPTIONS.map((item) => [item.value, item.label])),
      width: 120,
      render: (_, item) => <Tag color={item.status === 'active' ? 'green' : 'default'}>{item.status === 'active' ? '已启用' : '已禁用'}</Tag>,
    },
    {
      title: '套餐',
      dataIndex: 'name',
      hideInSearch: true,
      width: 300,
      render: (_, item) => (
        <Flex vertical gap={4}>
          <Typography.Text strong>{item.name}</Typography.Text>
          <Typography.Text type="secondary" ellipsis={{ tooltip: item.description || '暂无描述' }} className="text-xs">
            {item.description || '暂无描述'}
          </Typography.Text>
        </Flex>
      ),
    },
    {
      title: '套餐金额',
      dataIndex: 'price',
      hideInSearch: true,
      width: 160,
      render: (value) => <Typography.Text strong>{formatAmount(Number(value))}</Typography.Text>,
    },
    {
      title: '渠道提成',
      dataIndex: 'promotionCommission',
      hideInSearch: true,
      width: 160,
      render: (value) => <Typography.Text>{formatAmount(Number(value))}</Typography.Text>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      hideInSearch: true,
      width: 190,
      render: (_, item) => formatDate(item.createdAt),
    },
    {
      title: '操作',
      key: 'actions',
      valueType: 'option',
      fixed: 'right',
      width: 180,
      hideInSearch: true,
      render: (_, item) => {
        if (!canManagePackages) return '-';
        const isDeleting = deletingId === item._id;
        return <Space size={8}>
          <Button size="small" disabled={isDeleting} icon={<Pencil size={14} />} onClick={() => { setEditingItem(item); setFormOpen(true); }}>编辑</Button>
          <Button size="small" danger loading={isDeleting} icon={<Trash2 size={14} />} onClick={() => void deletePackage(item)}>删除</Button>
        </Space>;
      },
    },
  ];

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="套餐管理"
        content="维护企业入驻套餐及渠道提成金额，供成交订单登记时选择。"
        extra={canManagePackages ? [
          <Button key="create" type="primary" icon={<Plus size={16} />} onClick={() => { setEditingItem(null); setFormOpen(true); }}>新增套餐</Button>,
        ] : undefined}
      >
        <ProTable<PackageItem>
          className="admin-mobile-filter-stack"
          actionRef={actionRef}
          rowKey="_id"
          columns={columns}
          search={{ labelWidth: 'auto', defaultCollapsed: false, span: 12 }}
          options={{ reload: true, density: true, setting: true }}
          pagination={{ defaultPageSize: 20, showSizeChanger: true }}
          scroll={{ x: 940 }}
          request={async (params) => {
            const query = new URLSearchParams();
            if (params.status) query.set('status', String(params.status));
            const response = await fetch(`/api/admin/packages${query.size ? `?${query}` : ''}`);
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || '读取套餐失败');
            const keyword = String(params.keyword || '').trim().toLowerCase();
            const filtered = (result.data || []).filter((item: PackageItem) => !keyword || [item.name, item.description]
              .filter(Boolean)
              .some((value) => value?.toLowerCase().includes(keyword)));
            const pageSize = Number(params.pageSize || 20);
            const current = Number(params.current || 1);
            return {
              data: filtered.slice((current - 1) * pageSize, current * pageSize),
              total: filtered.length,
              success: true,
            };
          }}
          onRequestError={(error) => notify.error(error instanceof Error ? error.message : '读取套餐失败')}
        />
      </PageContainer>

      <ModalForm<PackageForm>
        key={editingItem?._id || 'create-package'}
        title={editingItem ? '编辑套餐' : '新增套餐'}
        open={formOpen}
        initialValues={editingItem ? {
          name: editingItem.name,
          price: editingItem.price,
          promotionCommission: editingItem.promotionCommission,
          description: editingItem.description || '',
          status: editingItem.status,
        } : {
          promotionCommission: 0,
          status: 'active',
        }}
        modalProps={{ destroyOnHidden: true, maskClosable: false }}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingItem(null);
        }}
        onFinish={savePackage}
        submitter={{
          searchConfig: { submitText: editingItem ? '保存套餐' : '创建套餐' },
          render: (_, dom) => <Flex justify="end" gap={12} style={{ marginTop: 24 }}>{dom}</Flex>,
        }}
      >
        <ProFormText name="name" label="套餐名称" rules={[{ required: true, message: '请输入套餐名称' }]} fieldProps={{ placeholder: '例如：基础版、专业版' }} />
        <ProFormDigit name="price" label="套餐金额（元）" min={0} fieldProps={{ precision: 2, className: 'w-full', placeholder: '0.00' }} rules={[{ required: true, message: '请输入套餐金额' }]} />
        <ProFormDigit name="promotionCommission" label="渠道提成金额（元）" min={0} fieldProps={{ precision: 2, className: 'w-full', placeholder: '0.00' }} rules={[{ required: true, message: '请输入渠道提成金额' }]} />
        <ProFormTextArea name="description" label="套餐说明" fieldProps={{ rows: 4, placeholder: '简要说明套餐的适用范围或服务内容...' }} />
        <ProFormSelect name="status" label="状态" options={STATUS_OPTIONS} rules={[{ required: true, message: '请选择套餐状态' }]} />
      </ModalForm>
    </div>
  );
}
