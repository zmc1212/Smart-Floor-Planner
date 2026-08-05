'use client';

import { useRef } from 'react';
import {
  PageContainer,
  ProTable,
  type ActionType,
  type ProColumns,
} from '@ant-design/pro-components';
import { Button, Flex, Tag, Typography } from 'antd';
import { Eye, Search } from 'lucide-react';
import { notify } from '@/components/ui/operation-feedback';
import { getAdminRoute } from '@/config/admin-routes';

type SurveySpace = {
  closed?: boolean;
};

type SurveyFloor = {
  walls?: unknown[];
  openings?: unknown[];
  spaces?: SurveySpace[];
};

type FormalSurveyLayout = {
  version?: number;
  measurementMode?: string;
  surveyGraph?: {
    kind?: string;
    floors?: SurveyFloor[];
  };
};

type FloorPlanItem = {
  _id: string;
  name?: string | null;
  status?: 'draft' | 'completed' | null;
  source?: 'manual' | 'template' | 'kujiale' | null;
  layoutData?: FormalSurveyLayout | string | null;
  createdAt?: string;
  updatedAt?: string;
  creator?: {
    nickname?: string | null;
    communityName?: string | null;
    phone?: string | null;
  } | null;
  externalSource?: {
    layoutLabel?: string | null;
  } | null;
};

type FloorPlanListResponse = {
  success: boolean;
  error?: string;
  data?: FloorPlanItem[];
  pagination?: {
    total: number;
  };
};

const floorPlansRoute = getAdminRoute('/floorplans');

function parseFormalSurveyLayout(layoutData: FloorPlanItem['layoutData']) {
  if (!layoutData) return null;
  const parsed = typeof layoutData === 'string'
    ? (() => {
        try {
          return JSON.parse(layoutData) as FormalSurveyLayout;
        } catch {
          return null;
        }
      })()
    : layoutData;
  if (
    !parsed ||
    parsed.version !== 4 ||
    parsed.measurementMode !== 'surveying' ||
    parsed.surveyGraph?.kind !== 'survey-wall-graph'
  ) {
    return null;
  }
  return parsed;
}

function getSurveyStats(layoutData: FloorPlanItem['layoutData']) {
  const floors = parseFormalSurveyLayout(layoutData)?.surveyGraph?.floors || [];
  return floors.reduce(
    (totals, floor) => ({
      walls: totals.walls + (floor.walls?.length || 0),
      openings: totals.openings + (floor.openings?.length || 0),
      spaces: totals.spaces + (floor.spaces?.filter((space) => space.closed).length || 0),
    }),
    { walls: 0, openings: 0, spaces: 0 }
  );
}

function getSourceLabel(source?: FloorPlanItem['source']) {
  if (source === 'kujiale') return '酷家乐';
  if (source === 'template') return '模板';
  return '手动量房';
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN') : '-';
}

export default function FloorPlansPage() {
  const actionRef = useRef<ActionType>(null);
  const columns: ProColumns<FloorPlanItem>[] = [
    {
      title: '关键词',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: {
        placeholder: '户型名称',
        allowClear: true,
      },
    },
    {
      title: '户型',
      dataIndex: 'name',
      hideInSearch: true,
      width: 300,
      render: (_, item) => (
        <Flex vertical gap={2}>
          <Typography.Text strong ellipsis={{ tooltip: item.name || '未命名户型' }}>
            {item.name || '未命名户型'}
          </Typography.Text>
          <Typography.Text type="secondary" className="text-xs" ellipsis={{ tooltip: item.externalSource?.layoutLabel || item.creator?.communityName || '-' }}>
            {item.externalSource?.layoutLabel || item.creator?.communityName || '-'}
          </Typography.Text>
        </Flex>
      ),
    },
    {
      title: '来源',
      dataIndex: 'source',
      hideInSearch: true,
      width: 130,
      render: (_, item) => <Tag>{getSourceLabel(item.source)}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      valueType: 'select',
      valueEnum: {
        completed: { text: '已完成' },
        draft: { text: '草稿' },
      },
      width: 132,
      render: (_, item) => item.status === 'completed'
        ? <Tag color="green">已完成</Tag>
        : <Tag>草稿</Tag>,
    },
    {
      title: '正式空间',
      key: 'spaces',
      hideInSearch: true,
      width: 120,
      render: (_, item) => <Tag color="blue">{getSurveyStats(item.layoutData).spaces} 个</Tag>,
    },
    {
      title: '墙体 / 开口',
      key: 'geometry',
      hideInSearch: true,
      width: 140,
      render: (_, item) => {
        const stats = getSurveyStats(item.layoutData);
        return `${stats.walls} / ${stats.openings}`;
      },
    },
    {
      title: '测量人员',
      key: 'creator',
      hideInSearch: true,
      width: 160,
      render: (_, item) => item.creator?.nickname || item.creator?.phone || '-',
    },
    {
      title: '最后更新',
      dataIndex: 'updatedAt',
      hideInSearch: true,
      width: 180,
      render: (_, item) => formatDate(item.updatedAt || item.createdAt),
    },
    {
      title: '操作',
      key: 'actions',
      valueType: 'option',
      fixed: 'right',
      width: 120,
      hideInSearch: true,
      render: (_, item) => (
        <Button
          aria-label={`查看户型 ${item.name || item._id}`}
          icon={<Eye size={16} />}
          href={`/floorplans/${item._id}`}
        >
          查看详情
        </Button>
      ),
    },
  ];

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title={floorPlansRoute?.label || '户型图库'}
        content="查看小程序正式量房生成的 version-4 墙图和其只读几何摘要。"
        extra={[
          <Button key="kujiale" icon={<Search size={16} />} href="/floorplans/kujiale">
            酷家乐搜索
          </Button>,
        ]}
      >
        <ProTable<FloorPlanItem>
          className="admin-data-table admin-mobile-filter-stack"
          actionRef={actionRef}
          rowKey="_id"
          columns={columns}
          search={{ labelWidth: 'auto', defaultCollapsed: false, span: 12 }}
          options={{ reload: true, density: true, setting: true }}
          pagination={{ defaultPageSize: 20, showSizeChanger: true }}
          scroll={{ x: 1280 }}
          request={async (params) => {
            try {
              const query = new URLSearchParams({
                page: String(params.current || 1),
                limit: String(params.pageSize || 20),
              });
              if (params.keyword) query.set('search', String(params.keyword));
              if (params.status) query.set('status', String(params.status));
              const response = await fetch(`/api/floorplans?${query.toString()}`);
              const result = (await response.json()) as FloorPlanListResponse;
              if (!response.ok || !result.success) {
                throw new Error(result.error || '加载户型图库失败');
              }
              return {
                data: result.data || [],
                success: true,
                total: result.pagination?.total || 0,
              };
            } catch (error) {
              notify.error(error instanceof Error ? error.message : '加载户型图库失败');
              return { data: [], success: false, total: 0 };
            }
          }}
        />
      </PageContainer>
    </div>
  );
}
