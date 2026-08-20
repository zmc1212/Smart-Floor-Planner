'use client';

import { useRef } from 'react';
import {
  PageContainer,
  ProTable,
  type ActionType,
  type ProColumns,
} from '@ant-design/pro-components';
import { Avatar, Button, Flex, Tag, Typography } from 'antd';
import { ExternalLink, UserRound } from 'lucide-react';
import { notify } from '@/components/admin/operation-feedback';
import { getAdminRoute } from '@/config/admin-routes';

type UserAuditItem = {
  _id: string;
  openid?: string | null;
  nickname?: string | null;
  avatar?: string | null;
  phone?: string | null;
  communityName?: string | null;
  city?: string | null;
  planCount?: number;
  createdAt?: string;
};

type UserListResponse = {
  success: boolean;
  error?: string;
  data?: UserAuditItem[];
  pagination?: {
    total: number;
  };
};

const userAuditRoute = getAdminRoute('/users');

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN') : '-';
}

export default function UsersPage() {
  const actionRef = useRef<ActionType>(null);

  const columns: ProColumns<UserAuditItem>[] = [
    {
      title: '关键词',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: {
        placeholder: '昵称、手机号、OpenID 或小区名称',
        allowClear: true,
      },
    },
    {
      title: '用户',
      dataIndex: 'nickname',
      hideInSearch: true,
      width: 260,
      render: (_, item) => (
        <Flex align="center" gap={12}>
          <Avatar icon={<UserRound />} src={item.avatar || undefined} />
          <Flex vertical gap={2} className="min-w-0">
            <Typography.Text strong ellipsis={{ tooltip: item.nickname || '微信用户' }}>
              {item.nickname || '微信用户'}
            </Typography.Text>
            <Typography.Text type="secondary" ellipsis={{ tooltip: item.openid || '未绑定 OpenID' }} className="text-xs">
              {item.openid || '未绑定 OpenID'}
            </Typography.Text>
          </Flex>
        </Flex>
      ),
    },
    {
      title: '联系方式',
      dataIndex: 'phone',
      hideInSearch: true,
      width: 150,
      renderText: (value?: string | null) => value || '-',
    },
    {
      title: '所属小区',
      dataIndex: 'communityName',
      hideInSearch: true,
      width: 220,
      render: (_, item) => (
        <Flex vertical gap={2}>
          <Typography.Text>{item.communityName || '-'}</Typography.Text>
          {item.city ? <Typography.Text type="secondary" className="text-xs">{item.city}</Typography.Text> : null}
        </Flex>
      ),
    },
    {
      title: '正式户型',
      dataIndex: 'planCount',
      hideInSearch: true,
      width: 132,
      render: (value) => <Tag color="green">{Number(value || 0)} 个</Tag>,
    },
    {
      title: '注册时间',
      dataIndex: 'createdAt',
      hideInSearch: true,
      width: 180,
      render: (_, item) => formatDate(item.createdAt),
    },
    {
      title: '操作',
      key: 'actions',
      valueType: 'option',
      fixed: 'right',
      width: 120,
      hideInSearch: true,
      render: (_, item) => item.openid ? (
        <Button
          aria-label={`查看用户 ${item.nickname || item.openid} 的户型`}
          icon={<ExternalLink size={14} />}
          size="small"
          href={`/users/${encodeURIComponent(item.openid)}`}
        >
          查看详情
        </Button>
      ) : '-',
    },
  ];

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title={userAuditRoute?.label || '用户审计'}
        content="查看小程序用户身份资料及其正式量房户型。"
      >
        <ProTable<UserAuditItem>
          className="admin-mobile-filter-stack"
          actionRef={actionRef}
          rowKey="_id"
          columns={columns}
          search={{ labelWidth: 'auto', defaultCollapsed: false, span: 12 }}
          options={{ reload: true, density: true, setting: true }}
          pagination={{ defaultPageSize: 20, showSizeChanger: true }}
          scroll={{ x: 1040 }}
          request={async (params) => {
            try {
              const query = new URLSearchParams({
                page: String(params.current || 1),
                limit: String(params.pageSize || 20),
              });
              if (params.keyword) query.set('search', String(params.keyword));
              const response = await fetch(`/api/users?${query.toString()}`);
              const result = (await response.json()) as UserListResponse;
              if (!response.ok || !result.success) {
                throw new Error(result.error || '加载用户审计数据失败');
              }
              return {
                data: result.data || [],
                success: true,
                total: result.pagination?.total || 0,
              };
            } catch (error) {
              notify.error(error instanceof Error ? error.message : '加载用户审计数据失败');
              return { data: [], success: false, total: 0 };
            }
          }}
        />
      </PageContainer>
    </div>
  );
}
