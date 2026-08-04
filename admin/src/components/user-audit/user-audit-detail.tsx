'use client';

import { useRouter } from 'next/navigation';
import {
  PageContainer,
  ProDescriptions,
  ProTable,
  type ProColumns,
} from '@ant-design/pro-components';
import { Avatar, Button, Flex, Tag, Typography } from 'antd';
import { Eye, UserRound } from 'lucide-react';
import { getAdminRoute } from '@/config/admin-routes';

type UserAuditDetailProps = {
  user: {
    _id: string;
    openid?: string | null;
    nickname?: string | null;
    avatar?: string | null;
    phone?: string | null;
    communityName?: string | null;
    city?: string | null;
    createdAt?: string | Date;
  };
  plans: Array<{
    _id: string;
    name?: string | null;
    status?: string | null;
    source?: string | null;
    createdAt?: string | Date;
    updatedAt?: string | Date;
  }>;
};

const userAuditRoute = getAdminRoute('/users');

function formatDate(value?: string | Date) {
  return value ? new Date(value).toLocaleString('zh-CN') : '-';
}

function getStatusTag(status?: string | null) {
  return status === 'completed'
    ? <Tag color="green">已完成</Tag>
    : <Tag>草稿</Tag>;
}

function getSourceLabel(source?: string | null) {
  if (source === 'kujiale') return '酷家乐';
  if (source === 'template') return '模板';
  return '手动量房';
}

export function UserAuditDetail({ user, plans }: UserAuditDetailProps) {
  const router = useRouter();
  const columns: ProColumns<UserAuditDetailProps['plans'][number]>[] = [
    {
      title: '户型名称',
      dataIndex: 'name',
      width: 300,
      renderText: (value?: string | null) => value || '未命名户型',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (_, item) => getStatusTag(item.status),
    },
    {
      title: '来源',
      dataIndex: 'source',
      width: 130,
      render: (_, item) => getSourceLabel(item.source),
    },
    {
      title: '最后更新',
      dataIndex: 'updatedAt',
      width: 180,
      render: (_, item) => formatDate(item.updatedAt || item.createdAt),
    },
    {
      title: '操作',
      key: 'actions',
      valueType: 'option',
      fixed: 'right',
      width: 110,
      render: (_, item) => (
        <Button type="link" icon={<Eye size={16} />} href={`/floorplans/${item._id}`}>
          查看图纸
        </Button>
      ),
    },
  ];

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title={`${user.nickname || '微信用户'}的户型`}
        content={userAuditRoute?.label || '用户审计'}
        onBack={() => router.push('/users')}
      >
        <Flex vertical gap={24}>
          <ProDescriptions
            title="用户资料"
            column={{ xs: 1, sm: 2, md: 3 }}
            dataSource={user}
            columns={[
              {
                title: '用户',
                dataIndex: 'nickname',
                render: (_, item) => (
                  <Flex align="center" gap={8}>
                    <Avatar icon={<UserRound />} src={item.avatar || undefined} />
                    <Typography.Text strong>{item.nickname || '微信用户'}</Typography.Text>
                  </Flex>
                ),
              },
              { title: 'OpenID', dataIndex: 'openid', renderText: (value?: string | null) => value || '-' },
              { title: '手机号', dataIndex: 'phone', renderText: (value?: string | null) => value || '-' },
              { title: '所属小区', dataIndex: 'communityName', renderText: (value?: string | null) => value || '-' },
              { title: '城市', dataIndex: 'city', renderText: (value?: string | null) => value || '-' },
              { title: '注册时间', dataIndex: 'createdAt', renderText: (value?: string | Date) => formatDate(value) },
            ]}
          />
          <ProTable<UserAuditDetailProps['plans'][number]>
            headerTitle={`正式户型 (${plans.length})`}
            rowKey="_id"
            columns={columns}
            dataSource={plans}
            search={false}
            options={false}
            pagination={{ defaultPageSize: 20, showSizeChanger: true }}
            scroll={{ x: 840 }}
          />
        </Flex>
      </PageContainer>
    </div>
  );
}
