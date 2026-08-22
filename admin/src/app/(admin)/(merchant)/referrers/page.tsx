'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PageContainer, ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { Alert, Button, Flex, Tag, Typography } from 'antd';
import { ArrowLeft } from 'lucide-react';
import { useConfirmDialog } from '@/components/admin/confirm-dialog';
import { notify } from '@/components/admin/operation-feedback';
import { useCurrentUser } from '@/hooks/useCurrentUser';

type ReferrerMember = {
  id: string;
  displayName: string;
  phone: string | null;
  status: string;
  joinedAt: string;
  exitedAt: string | null;
  hasActivePromotionCode: boolean;
};

function formatTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false });
}

export default function ReferrersPage() {
  const confirm = useConfirmDialog();
  const { user } = useCurrentUser();
  const actionRef = useRef<ActionType>(undefined);
  const [actingMembershipId, setActingMembershipId] = useState<string | null>(null);
  const [globalTenantId, setGlobalTenantId] = useState('all');

  const requiresTenantSelection = Boolean(
    ['super_admin', 'admin'].includes(user?.role || '') && globalTenantId === 'all'
  );

  useEffect(() => {
    const tenant = document.cookie.split('; ').find((item) => item.startsWith('global_tenant_id='));
    setGlobalTenantId(tenant?.split('=')[1] || 'all');
  }, []);

  const disableReferrerMembership = useCallback(async (member: ReferrerMember) => {
    if (member.status !== 'active') return;
    const accepted = await confirm({
      title: `停用 ${member.displayName} 的后续扫码`,
      description: '停用后该推荐人不能再出示活动推广码获客；历史线索和提成记录保持不变。',
      confirmText: '停用后续扫码',
    });
    if (!accepted) return;
    setActingMembershipId(member.id);
    try {
      const response = await fetch(`/api/enterprise/referrer-memberships/${member.id}/disable`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '停用推荐人失败');
      notify.success('已停用后续扫码');
      await actionRef.current?.reload();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '停用推荐人失败');
    } finally {
      setActingMembershipId(null);
    }
  }, [confirm]);

  const columns: ProColumns<ReferrerMember>[] = [
    {
      title: '姓名',
      dataIndex: 'displayName',
      hideInSearch: true,
      render: (_, item) => (
        <Flex vertical gap={0}>
          <Typography.Text strong>{item.displayName}</Typography.Text>
        </Flex>
      ),
    },
    {
      title: '手机号',
      dataIndex: 'phone',
      hideInSearch: true,
      width: 160,
      render: (_, item) => item.phone || '—',
    },
    {
      title: '关键词',
      dataIndex: 'query',
      hideInTable: true,
      fieldProps: { placeholder: '姓名或手机号' },
    },
    {
      title: '加入时间',
      dataIndex: 'joinedAt',
      hideInSearch: true,
      width: 180,
      render: (_, item) => formatTime(item.joinedAt),
    },
    {
      title: '活动推广码',
      key: 'code',
      hideInSearch: true,
      width: 120,
      render: (_, item) => <Tag color={item.hasActivePromotionCode ? 'green' : 'default'}>{item.hasActivePromotionCode ? '可出示' : '无活动码'}</Tag>,
    },
    {
      title: '成员状态',
      dataIndex: 'status',
      width: 110,
      valueEnum: {
        active: { text: '活动', status: 'Success' },
        disabled: { text: '已停用', status: 'Default' },
        exited: { text: '已退出', status: 'Default' },
      },
    },
    {
      title: '操作',
      key: 'actions',
      hideInSearch: true,
      width: 140,
      render: (_, item) => item.status === 'active'
        ? <Button size="small" danger loading={actingMembershipId === item.id} onClick={() => void disableReferrerMembership(item)}>停用后续扫码</Button>
        : '—',
    },
  ];

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="推荐人"
        content="查看当前企业已入驻推荐人的姓名和手机号。推荐人只能扫入驻码加入，后台不手工建档；停用只关闭后续扫码，不改历史线索和提成。"
        extra={<Button icon={<ArrowLeft size={16} />} href="/referrer-network-operations">返回运营工作台</Button>}
      >
        {requiresTenantSelection ? (
          <Alert showIcon type="info" message="请先选择企业" description="平台管理员需要先在左侧导航切换到具体企业，才能查看该企业的推荐人。" />
        ) : (
          <Flex vertical gap={16}>
            <Alert showIcon type="info" message="只管理后续扫码资格" description="停用不会改写历史线索或提成；后台不展示推广令牌明文，活动码仍由推荐人本人在小程序出示。" />
            <ProTable<ReferrerMember>
              rowKey="id"
              actionRef={actionRef}
              columns={columns}
              search={{ labelWidth: 'auto', defaultCollapsed: false, span: 8 }}
              options={{ reload: true, density: false, setting: false }}
              pagination={{ defaultPageSize: 20, showSizeChanger: true }}
              scroll={{ x: 860 }}
              request={async (params) => {
                const query = new URLSearchParams();
                if (params.query) query.set('query', String(params.query));
                if (params.status) query.set('status', String(params.status));
                const response = await fetch(`/api/enterprise/referrer-memberships${query.toString() ? `?${query}` : ''}`);
                const result = await response.json();
                if (!response.ok || !result.success) throw new Error(result.error || '读取推荐人失败');
                const rows = (result.data || []) as ReferrerMember[];
                return { data: rows, success: true, total: rows.length };
              }}
            />
          </Flex>
        )}
      </PageContainer>
    </div>
  );
}
