'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { Building2, Check, Copy, Ellipsis, Eye, Plus } from 'lucide-react';
import { PageContainer, ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { Avatar, Button, Dropdown, Space, Tag, Typography } from 'antd';
import type { MenuProps } from 'antd';
import EnterpriseEditorDialog from '@/components/enterprise/EnterpriseEditorDialog';
import type { EnterpriseListItem } from '@/components/enterprise/types';
import { notify } from '@/components/admin/operation-feedback';

const ENTERPRISE_STATUS = {
  pending_approval: { text: '待审核', status: 'Warning' },
  active: { text: '正常', status: 'Success' },
  disabled: { text: '已停用', status: 'Default' },
};

function EnterpriseStatus({ status }: { status: EnterpriseListItem['status'] }) {
  if (status === 'active') return <Tag color="success">正常</Tag>;
  if (status === 'pending_approval') return <Tag color="warning">待审核</Tag>;
  return <Tag>已停用</Tag>;
}

export default function EnterprisesPage() {
  const actionRef = useRef<ActionType>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [editingEnterprise, setEditingEnterprise] = useState<EnterpriseListItem | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [workingId, setWorkingId] = useState('');

  const copyInvitationLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/register`);
      setCopyFeedback(true);
      notify.success('邀请链接已复制');
      window.setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
      notify.error('邀请链接复制失败');
    }
  };

  const updateStatus = async (enterprise: EnterpriseListItem, status: EnterpriseListItem['status']) => {
    setWorkingId(`${enterprise._id}:${status}`);
    try {
      const response = await fetch(`/api/admin/enterprises/${enterprise._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '企业状态更新失败');
      await actionRef.current?.reload();
      notify.success('企业状态已更新');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '企业状态更新失败');
    } finally {
      setWorkingId('');
    }
  };

  const columns: ProColumns<EnterpriseListItem>[] = [
    {
      title: '企业名称',
      dataIndex: 'name',
      width: 270,
      render: (_, enterprise) => (
        <Space align="start" size={12}>
          <Avatar shape="square" src={enterprise.logo} icon={<Building2 size={17} />} className="!bg-primary !text-primary-foreground" />
          <Space direction="vertical" size={0}>
            <Link className="font-medium text-foreground hover:text-primary" href={`/enterprises/${enterprise._id}`}>
              {enterprise.name}
            </Link>
            <Typography.Text type="secondary" className="text-xs">
              {enterprise.registrationMode === 'self_service' ? '自主注册' : '后台录入'}
            </Typography.Text>
          </Space>
        </Space>
      ),
    },
    {
      title: '企业编码',
      dataIndex: 'code',
      width: 180,
      copyable: true,
      render: (value) => <Typography.Text className="font-mono text-xs">{value}</Typography.Text>,
    },
    {
      title: '联系人',
      key: 'contact',
      width: 190,
      render: (_, enterprise) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{enterprise.contactPerson?.name || '-'}</Typography.Text>
          <Typography.Text type="secondary" className="text-xs">{enterprise.contactPerson?.phone || '-'}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      valueType: 'select',
      valueEnum: ENTERPRISE_STATUS,
      render: (_, enterprise) => <EnterpriseStatus status={enterprise.status} />,
    },
    {
      title: 'AI 概览',
      key: 'ai',
      width: 200,
      hideInSearch: true,
      render: (_, enterprise) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{enterprise.aiUsageSnapshot?.keyInfo?.valid === false ? '凭证异常' : enterprise.aiConfig ? '已配置' : '尚未配置'}</Typography.Text>
          <Typography.Text type="secondary" className="text-xs">
            余额 {Number(enterprise.aiUsageSnapshot?.balance || 0).toFixed(2)} · 今日 {enterprise.aiUsageSnapshot?.summary?.today?.requests || 0} 次
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 180,
      valueType: 'dateTime',
      hideInSearch: true,
      render: (_, enterprise) => enterprise.createdAt ? new Date(enterprise.createdAt).toLocaleString() : '-',
    },
    {
      title: '操作',
      key: 'actions',
      valueType: 'option',
      fixed: 'right',
      width: 150,
      render: (_, enterprise) => {
        const items: MenuProps['items'] = [
          {
            key: 'ai',
            label: <Link href={`/enterprises/${enterprise._id}/ai`}>AI 管理</Link>,
          },
          {
            key: 'edit',
            label: '编辑基础信息',
            disabled: Boolean(workingId),
            onClick: () => {
              setEditingEnterprise(enterprise);
              setIsEditorOpen(true);
            },
          },
          enterprise.status === 'pending_approval' ? {
            key: 'approve',
            label: '审核通过',
            disabled: Boolean(workingId),
            onClick: () => updateStatus(enterprise, 'active'),
          } : null,
        ];
        return <Space size={8}>
          <Button key="overview" size="small" icon={<Eye size={14} />} href={`/enterprises/${enterprise._id}`}>详情</Button>
          <Dropdown key="more" menu={{ items }} trigger={['click']}>
            <Button size="small" aria-label={`${enterprise.name} 更多操作`} loading={workingId.startsWith(`${enterprise._id}:`)} icon={<Ellipsis size={16} />} />
          </Dropdown>
        </Space>;
      },
    },
  ];

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="企业管理"
        content="管理企业入驻、联系人、审核状态和 AI 服务入口。"
        extra={[
          <Button key="copy" icon={copyFeedback ? <Check size={16} /> : <Copy size={16} />} onClick={copyInvitationLink}>
            {copyFeedback ? '已复制邀请链接' : '复制邀请链接'}
          </Button>,
          <Button
            key="create"
            type="primary"
            icon={<Plus size={16} />}
            onClick={() => {
              setEditingEnterprise(null);
              setIsEditorOpen(true);
            }}
          >
            手动添加企业
          </Button>,
        ]}
      >
        <ProTable<EnterpriseListItem>
          actionRef={actionRef}
          rowKey="_id"
          columns={columns}
          search={{ labelWidth: 'auto', defaultCollapsed: false }}
          options={{ reload: true, density: true, setting: true }}
          pagination={{ defaultPageSize: 10, showSizeChanger: true }}
          scroll={{ x: 1200 }}
          request={async (params) => {
            const response = await fetch('/api/admin/enterprises');
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || '读取企业数据失败');
            const name = String(params.name || '').trim().toLocaleLowerCase();
            const code = String(params.code || '').trim().toLocaleLowerCase();
            const status = params.status ? String(params.status) : '';
            const filtered = (result.data as EnterpriseListItem[]).filter((enterprise) => (
              (!name || enterprise.name.toLocaleLowerCase().includes(name))
              && (!code || enterprise.code.toLocaleLowerCase().includes(code))
              && (!status || enterprise.status === status)
            ));
            const current = Number(params.current || 1);
            const pageSize = Number(params.pageSize || 10);
            const start = (current - 1) * pageSize;
            return {
              data: filtered.slice(start, start + pageSize),
              total: filtered.length,
              success: true,
            };
          }}
        />
      </PageContainer>

      <EnterpriseEditorDialog
        open={isEditorOpen}
        onOpenChange={setIsEditorOpen}
        enterprise={editingEnterprise}
        onSaved={async () => {
          await actionRef.current?.reload();
        }}
      />
    </div>
  );
}
