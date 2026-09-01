'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { PageContainer, ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { Avatar, Button, Result, Skeleton, Space, Tag, Typography } from 'antd';
import { Pencil } from 'lucide-react';
import {
  AI_PRESET_TYPE_LABELS,
  type AiPreset,
  resolveLogicalModel,
} from '@/components/ai-presets/types';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { FloorPlanConstraintSettings } from '@/components/ai-presets/floor-plan-constraint-settings';

const TYPE_VALUE_ENUM = {
  floor_plan_style: { text: 'AI 室内平面' },
  furnishing_style: { text: 'AI 风格设计' },
  scenario: { text: 'AI 设计工作流' },
};

const STATUS_VALUE_ENUM = {
  true: { text: '已启用', status: 'Success' },
  false: { text: '已停用', status: 'Default' },
};

export default function AiPresetsPage() {
  const actionRef = useRef<ActionType>(null);
  const { user, isLoading: loadingUser } = useCurrentUser();
  const canManage = user?.role === 'super_admin' || user?.role === 'admin';

  const columns: ProColumns<AiPreset>[] = [
    {
      title: '预设名称',
      dataIndex: 'name',
      render: (_, preset) => (
        <Space size={12} align="start">
          <Avatar shape="square" className="!bg-primary !text-primary-foreground">
            {preset.icon || 'AI'}
          </Avatar>
          <Space direction="vertical" size={0}>
            <Link className="font-medium text-foreground hover:text-primary" href={`/ai-presets/${preset._id}`}>
              {preset.name}
            </Link>
            <Typography.Text type="secondary" ellipsis={{ tooltip: preset.description }} className="max-w-80 text-xs">
              {preset.description || '暂无描述'}
            </Typography.Text>
          </Space>
        </Space>
      ),
    },
    {
      title: '标识',
      dataIndex: 'key',
      width: 180,
      copyable: true,
      render: (value) => <Typography.Text className="font-mono text-xs">{value}</Typography.Text>,
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 160,
      valueType: 'select',
      valueEnum: TYPE_VALUE_ENUM,
      render: (_, preset) => <Tag color={preset.type === 'scenario' ? 'blue' : 'green'}>{AI_PRESET_TYPE_LABELS[preset.type]}</Tag>,
    },
    {
      title: '生图配置',
      key: 'image',
      width: 250,
      hideInSearch: true,
      render: (_, preset) => (
        <Space direction="vertical" size={0}>
          <Typography.Text className="font-mono text-xs">{resolveLogicalModel(preset)}</Typography.Text>
          <Typography.Text type="secondary" className="text-xs">
            {preset.image.size} · {preset.image.quality} · {preset.image.mode}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 110,
      valueType: 'select',
      valueEnum: STATUS_VALUE_ENUM,
      render: (_, preset) => preset.enabled ? <Tag color="success">已启用</Tag> : <Tag>已停用</Tag>,
    },
    {
      title: '排序',
      dataIndex: 'sortOrder',
      width: 90,
      hideInSearch: true,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 180,
      valueType: 'dateTime',
      hideInSearch: true,
      render: (_, preset) => preset.updatedAt ? new Date(preset.updatedAt).toLocaleString() : '—',
    },
    {
      title: '操作',
      key: 'actions',
      valueType: 'option',
      fixed: 'right',
      width: 108,
      render: (_, preset) => [
        <Button key="edit" aria-label={`编辑 AI 预设 ${preset.name}`} icon={<Pencil size={14} />} size="small" href={`/ai-presets/${preset._id}`}>
          编辑
        </Button>,
      ],
    },
  ];

  if (loadingUser) {
    return (
      <div className="admin-page-frame">
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="admin-page-frame">
        <PageContainer breadcrumbRender={false} className="admin-page-container" title="AI 预设配置">
          <Result status="403" title="无权访问" subTitle="仅平台 admin / super_admin 可以管理 AI 预设。" />
        </PageContainer>
      </div>
    );
  }

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="AI 预设配置"
        content="统一维护正式户型结构约束、室内平面、风格设计与 AI 设计工作流的提示词和生图参数。"
      >
        <Space direction="vertical" size={20} className="w-full">
          <FloorPlanConstraintSettings />
          <ProTable<AiPreset>
            actionRef={actionRef}
            rowKey="_id"
            columns={columns}
            options={{ reload: true, density: true, setting: true }}
            pagination={{ defaultPageSize: 10, showSizeChanger: true }}
            search={{ labelWidth: 'auto', defaultCollapsed: false }}
            scroll={{ x: 1220 }}
            request={async (params) => {
              const response = await fetch('/api/ai/presets?includeDisabled=true');
              const result = await response.json();
              if (!response.ok || !result.success) throw new Error(result.error || '读取 AI 预设失败');

              const query = String(params.name || '').trim().toLocaleLowerCase();
              const type = params.type ? String(params.type) : '';
              const enabled = params.enabled === undefined ? '' : String(params.enabled);
              const filtered = (result.data as AiPreset[]).filter((preset) => {
                const matchesQuery = !query || [preset.name, preset.key, preset.description]
                  .some((value) => value.toLocaleLowerCase().includes(query));
                const matchesType = !type || preset.type === type;
                const matchesEnabled = !enabled || String(preset.enabled) === enabled;
                return matchesQuery && matchesType && matchesEnabled;
              });
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
        </Space>
      </PageContainer>
    </div>
  );
}
