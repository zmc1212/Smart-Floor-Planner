'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PageContainer, ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import {
  Alert,
  Badge,
  Button,
  Card,
  Collapse,
  Empty,
  Flex,
  Segmented,
  Spin,
  Table,
  Tag,
  Typography,
  type TableColumnsType,
} from 'antd';
import { ArrowLeft } from 'lucide-react';
import { useConfirmDialog } from '@/components/admin/confirm-dialog';
import { notify } from '@/components/admin/operation-feedback';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { isStaffReferrerRosterRole } from '@/lib/referrer-roster-access';

type ReferrerMember = {
  id: string;
  displayName: string;
  phone: string | null;
  status: string;
  joinedAt: string;
  exitedAt: string | null;
  hasActivePromotionCode: boolean;
};

type ReferrerNetworkMember = Pick<
  ReferrerMember,
  'id' | 'displayName' | 'phone' | 'status' | 'joinedAt' | 'hasActivePromotionCode'
>;

type ReferrerNetworkBranch = {
  staff: {
    id: string | null;
    displayName: string;
    role: string | null;
    status: string;
  } | null;
  total: number;
  activeCount: number;
  items: ReferrerNetworkMember[];
};

type ReferrerNetwork = {
  summary: { total: number; activeCount: number; employeeCount: number };
  branches: ReferrerNetworkBranch[];
};

const STAFF_ROLE_LABELS: Record<string, string> = {
  enterprise_admin: '企业负责人',
  designer: '设计师',
  measurer: '测量员',
  salesperson: '渠道地推',
};

function formatTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false });
}

function membershipStatusTag(status: string) {
  const statusMap: Record<string, { label: string; color: string }> = {
    active: { label: '活动', color: 'green' },
    disabled: { label: '已停用', color: 'default' },
    exited: { label: '已退出', color: 'default' },
  };
  const current = statusMap[status] || { label: status || '未知', color: 'default' };
  return <Tag color={current.color}>{current.label}</Tag>;
}

function networkBranchTitle(branch: ReferrerNetworkBranch) {
  if (!branch.staff) return '未归属员工的历史推广人';
  if (branch.staff.status === 'deleted') return `${branch.staff.displayName}（已离职）`;
  return branch.staff.displayName;
}

export default function ReferrersPage() {
  const confirm = useConfirmDialog();
  const { user } = useCurrentUser();
  const actionRef = useRef<ActionType>(undefined);
  const [actingMembershipId, setActingMembershipId] = useState<string | null>(null);
  const [globalTenantId, setGlobalTenantId] = useState('all');
  const [rosterView, setRosterView] = useState<'network' | 'all'>('all');
  const [network, setNetwork] = useState<ReferrerNetwork | null>(null);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkError, setNetworkError] = useState('');

  const requiresTenantSelection = Boolean(
    ['super_admin', 'admin'].includes(user?.role || '') && globalTenantId === 'all'
  );
  const isStaffReferrerViewer = isStaffReferrerRosterRole(user?.role);
  const canViewReferrerNetwork = Boolean(
    !isStaffReferrerViewer &&
    (user?.role === 'enterprise_admin' ||
    (['super_admin', 'admin'].includes(user?.role || '') && !requiresTenantSelection))
  );
  const canDisableReferrers = Boolean(
    user?.role === 'enterprise_admin' ||
    ['super_admin', 'admin'].includes(user?.role || '')
  );
  const hasReferrerOperationsAccess = Boolean(
    user?.effectivePermissions?.includes('referrer-network-operations')
  );

  useEffect(() => {
    const tenant = document.cookie.split('; ').find((item) => item.startsWith('global_tenant_id='));
    setGlobalTenantId(tenant?.split('=')[1] || 'all');
  }, []);

  useEffect(() => {
    if (canViewReferrerNetwork) {
      setRosterView('network');
    }
  }, [canViewReferrerNetwork]);

  const loadNetwork = useCallback(async () => {
    if (!canViewReferrerNetwork || requiresTenantSelection) return;
    setNetworkLoading(true);
    setNetworkError('');
    try {
      const response = await fetch('/api/enterprise/referrer-memberships?view=network');
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '读取推广网络失败');
      setNetwork(result.data as ReferrerNetwork);
    } catch (error) {
      setNetwork(null);
      setNetworkError(error instanceof Error ? error.message : '读取推广网络失败');
    } finally {
      setNetworkLoading(false);
    }
  }, [canViewReferrerNetwork, requiresTenantSelection]);

  useEffect(() => {
    if (rosterView === 'network') void loadNetwork();
  }, [loadNetwork, rosterView]);

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
    ...(canDisableReferrers
      ? [{
          title: '操作',
          key: 'actions',
          hideInSearch: true,
          width: 140,
          render: (_: unknown, item: ReferrerMember) => item.status === 'active'
            ? <Button size="small" danger loading={actingMembershipId === item.id} onClick={() => void disableReferrerMembership(item)}>停用后续扫码</Button>
            : '—',
        } satisfies ProColumns<ReferrerMember>]
      : []),
  ];

  const networkColumns: TableColumnsType<ReferrerNetworkMember> = [
    {
      title: '推广人',
      dataIndex: 'displayName',
      render: (_, item) => (
        <Flex vertical gap={0}>
          <Typography.Text strong>{item.displayName}</Typography.Text>
          {item.phone ? <Typography.Text type="secondary">{item.phone}</Typography.Text> : null}
        </Flex>
      ),
    },
    {
      title: '加入时间',
      dataIndex: 'joinedAt',
      width: 180,
      render: (value) => formatTime(value),
    },
    {
      title: '服务码',
      dataIndex: 'hasActivePromotionCode',
      width: 110,
      render: (value) => <Tag color={value ? 'green' : 'default'}>{value ? '可出示' : '无活动码'}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value) => membershipStatusTag(value),
    },
  ];

  const networkPanels = (network?.branches || []).map((branch, index) => ({
    key: branch.staff?.id || `historical-${index}`,
    label: (
      <Flex align="center" justify="space-between" gap={16} wrap>
        <Flex align="center" gap={10}>
          <Badge status={branch.activeCount > 0 ? 'success' : 'default'} />
          <Typography.Text strong>{networkBranchTitle(branch)}</Typography.Text>
          {branch.staff?.role ? <Tag>{STAFF_ROLE_LABELS[branch.staff.role] || branch.staff.role}</Tag> : null}
        </Flex>
        <Typography.Text type="secondary">
          推广人 {branch.total} 名 · 活动 {branch.activeCount} 名
        </Typography.Text>
      </Flex>
    ),
    children: branch.items.length ? (
      <Table<ReferrerNetworkMember>
        rowKey="id"
        columns={networkColumns}
        dataSource={branch.items}
        pagination={false}
        size="small"
        scroll={{ x: 680 }}
      />
    ) : (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该员工暂未邀请推广人" />
    ),
  }));

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title={isStaffReferrerViewer ? '我的推广人' : '推荐人'}
        content={isStaffReferrerViewer
          ? '查看本人直接邀请的推广人。推荐人只能扫你的个人入驻码加入；后台不手工建档，也不能停用后续扫码。'
          : canViewReferrerNetwork
          ? '查看员工推广分支或企业全部推广人。推广关系归属企业，首次邀请员工会保留在对应分支。'
          : '查看当前企业已入驻推荐人的姓名和手机号。推荐人只能扫入驻码加入，后台不手工建档；停用只关闭后续扫码，不改历史线索和提成。'}
        extra={hasReferrerOperationsAccess
          ? <Button icon={<ArrowLeft size={16} />} href="/referrer-network-operations">返回运营工作台</Button>
          : undefined}
      >
        {requiresTenantSelection ? (
          <Alert showIcon type="info" message="请先选择企业" description="平台管理员需要先在左侧导航切换到具体企业，才能查看该企业的推荐人。" />
        ) : (
          <Flex vertical gap={16}>
            {canViewReferrerNetwork ? (
              <Segmented
                value={rosterView}
                onChange={(value) => setRosterView(value as 'network' | 'all')}
                options={[
                  { label: '推广网络', value: 'network' },
                  { label: '全部推广人', value: 'all' },
                ]}
              />
            ) : null}
            {rosterView === 'network' && canViewReferrerNetwork ? (
              <Card className="admin-panel-card" title="员工推广网络">
                {networkLoading ? (
                  <Flex justify="center" style={{ padding: 40 }}><Spin tip="正在加载推广网络" /></Flex>
                ) : networkError ? (
                  <Alert showIcon type="error" message="推广网络加载失败" description={networkError} action={<Button size="small" onClick={() => void loadNetwork()}>重试</Button>} />
                ) : network ? (
                  <Flex vertical gap={16}>
                    <Typography.Text type="secondary">
                      共 {network.summary.employeeCount} 个员工分支，{network.summary.total} 名推广人，其中活动 {network.summary.activeCount} 名。展开员工可查看其直接邀请的推广人。
                    </Typography.Text>
                    {networkPanels.length ? <Collapse items={networkPanels} /> : <Empty description="当前企业暂无可展示的员工分支" />}
                  </Flex>
                ) : null}
              </Card>
            ) : (
              <>
                {canDisableReferrers ? (
                  <Alert showIcon type="info" message="只管理后续扫码资格" description="停用不会改写历史线索或提成；后台不展示推广令牌明文，活动码仍由推荐人本人在小程序出示。" />
                ) : null}
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
              </>
            )}
          </Flex>
        )}
      </PageContainer>
    </div>
  );
}
