'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageContainer, ProTable, type ProColumns } from '@ant-design/pro-components';
import { Button, Modal, Result, Select, Space, Tag, Typography } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import { useCurrentUser } from '@/hooks/useCurrentUser';

interface DefinitionSummary {
  definitionId: string;
  eventType: 'stage_changed' | 'period_report';
  periodKind: 'daily' | 'weekly' | null;
  latestPublishedRevision: number | null;
  draftRevision: number;
  updatedAt: string;
  publishedAt: string | null;
}

const TEMPLATE_OPTIONS = [
  { value: 'stage-reminder', label: '阶段提醒（实际阶段变化后）' },
  { value: 'period-report-daily', label: '施工日报（共用 period）' },
  { value: 'period-report-weekly', label: '施工周报（共用 period）' },
];

function eventLabel(record: DefinitionSummary): string {
  if (record.eventType === 'stage_changed') return '实际阶段变化';
  return record.periodKind === 'weekly' ? '周报计划' : '日报计划';
}

export default function NativeWorkflowListPage() {
  const router = useRouter();
  const { user } = useCurrentUser();
  const canManage = ['super_admin', 'admin'].includes(user?.role || '');
  const [creating, setCreating] = useState(false);
  const [templateId, setTemplateId] = useState('stage-reminder');
  const [createSaving, setCreateSaving] = useState(false);

  const createDraft = async () => {
    setCreateSaving(true);
    try {
      const response = await fetch('/api/native-workflow/definitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || result.error || '创建草稿失败');
      setCreating(false);
      notify.success('已从模板创建草稿');
      router.push(`/native-workflow/${templateId}`);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '创建草稿失败');
    } finally {
      setCreateSaving(false);
    }
  };

  if (!canManage) {
    return (
      <PageContainer header={{ title: '家客来原生编排' }}>
        <Result status="403" title="仅平台管理员可访问" subTitle="该调试入口仅对 super_admin / admin 开放。" />
      </PageContainer>
    );
  }

  const columns: ProColumns<DefinitionSummary>[] = [
    {
      title: '流程定义',
      dataIndex: 'definitionId',
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{record.definitionId}</Typography.Text>
          <Typography.Text type="secondary">{eventLabel(record)}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '最新发布',
      dataIndex: 'latestPublishedRevision',
      width: 120,
      render: (_, record) =>
        record.latestPublishedRevision ? (
          <Tag color="green">v{record.latestPublishedRevision}</Tag>
        ) : (
          <Tag>未发布</Tag>
        ),
    },
    {
      title: '草稿版本',
      dataIndex: 'draftRevision',
      width: 100,
      render: (_, record) => <Tag>r{record.draftRevision}</Tag>,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      valueType: 'dateTime',
      width: 180,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 120,
      render: (_, record) => (
        <Button type="link" onClick={() => router.push(`/native-workflow/${record.definitionId}`)}>
          打开调试
        </Button>
      ),
    },
  ];

  return (
    <PageContainer
      header={{
        title: '家客来原生编排',
        subTitle: '草稿、发布版本与模拟调试；模拟结果不会真实保存或投递',
      }}
    >
      <ProTable<DefinitionSummary>
        rowKey="definitionId"
        search={false}
        options={false}
        pagination={false}
        request={async () => {
          try {
            const response = await fetch('/api/native-workflow/definitions', { cache: 'no-store' });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message || result.error || '读取流程失败');
            const data = result.data as DefinitionSummary[];
            return { data, success: true, total: data.length };
          } catch (error) {
            notify.error(error instanceof Error ? error.message : '读取流程失败');
            return { data: [], success: false, total: 0 };
          }
        }}
        columns={columns}
        toolBarRender={() => [
          <Button key="create" type="primary" onClick={() => setCreating(true)}>
            从模板新建草稿
          </Button>,
        ]}
      />
      <Modal
        title="从模板新建草稿"
        open={creating}
        okText="创建"
        cancelText="取消"
        confirmLoading={createSaving}
        onOk={() => void createDraft()}
        onCancel={() => setCreating(false)}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Select value={templateId} onChange={setTemplateId} options={TEMPLATE_OPTIONS} style={{ width: '100%' }} />
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            模板包含固定节点、能力白名单与模拟 fixture。创建后只写入 B 线独立调试存储，不连接真实业务。
          </Typography.Paragraph>
        </Space>
      </Modal>
    </PageContainer>
  );
}
