'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageContainer, ProTable, type ProColumns } from '@ant-design/pro-components';
import { StageWorkflowCallers, useStageCallers } from '@/components/admin/stage-workflow-callers';
import '@/components/admin/stage-workflow-studio.css';
import { Button, Input, Modal, Result, Select, Space, Tag, Typography } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import { useCurrentUser } from '@/hooks/useCurrentUser';

interface DefinitionSummary {
  name?: string;
  description?: string;
  definitionId: string;
  eventType: 'stage_changed' | 'period_report' | 'specialist_followup' | 'stage_consultation';
  periodKind: 'daily' | 'weekly' | null;
  latestPublishedRevision: number | null;
  draftRevision: number;
  updatedAt: string;
  publishedAt: string | null;
}

const TEMPLATE_OPTIONS = [
  { value: 'public-assistant', label: '通用小K（平台内置应用）' },
  { value: 'stage-guidance', label: '阶段知识问答（多 Agent 共用）' },
  { value: 'stage-checklist', label: '现场核对清单（多 Agent 共用）' },
  { value: 'stage-reminder', label: '阶段提醒（实际阶段变化后）' },
  { value: 'period-report-daily', label: '施工日报（共用 period）' },
  { value: 'period-report-weekly', label: '施工周报（共用 period）' },
  { value: 'waterproof-inspection-v1', label: '防水现场核对' },
  { value: 'electrical-inspection-v1', label: '水电现场核对' },
];

function eventLabel(record: DefinitionSummary): string {
  if (record.eventType === 'stage_consultation') return '阶段 Agent 调用';
  if (record.eventType === 'stage_changed') return '实际阶段变化';
  if (record.eventType === 'specialist_followup') {
    return record.definitionId.startsWith('electrical') ? '业主发起水电跟进' : '业主发起防水跟进';
  }
  return record.periodKind === 'weekly' ? '周报计划' : '日报计划';
}

export default function NativeWorkflowListPage() {
  const router = useRouter();
  const { user } = useCurrentUser();
  const canManage = ['super_admin', 'admin'].includes(user?.role || '');
  const [creating, setCreating] = useState(false);
  const [templateId, setTemplateId] = useState('stage-guidance');
  const [displayName, setDisplayName] = useState('');
  const [stageTemplates,setStageTemplates]=useState<DefinitionSummary[]>([]);
  const callers=useStageCallers(canManage);
  const callable = templateId === 'stage-guidance' || templateId === 'stage-checklist';
  const publicAssistant = templateId === 'public-assistant';
  const [createSaving, setCreateSaving] = useState(false);

  const createDraft = async () => {
    if (publicAssistant) {
      setCreating(false);
      router.push('/public-assistant');
      return;
    }
    setCreateSaving(true);
    try {
      const response = await fetch('/api/native-workflow/definitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId, ...(callable ? { name: displayName.trim() || (templateId === 'stage-checklist' ? '现场核对清单' : '阶段知识问答') } : {}) }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || result.error || '创建草稿失败');
      setCreating(false);
      notify.success('已从模板创建草稿');
      router.push(`/native-workflow/${result.data.definitionId}`);
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
        title: '工作流模板',
        extra: <Space><Button href="/assistant-knowledge?tab=stage-agents">阶段 Agent</Button><Button href="/public-assistant">通用小K</Button><Button type="primary" onClick={()=>{setDisplayName('');setCreating(true);}}>从模板新建</Button></Space>,
      }}
    >
      <section className="nw-library" aria-label="阶段工作流模板">{stageTemplates.map(row=><article key={row.definitionId}>
        <div className="nw-card-heading"><a href={'/native-workflow/'+row.definitionId}>{row.name || row.definitionId}</a><Tag color={row.latestPublishedRevision?'green':undefined}>{row.latestPublishedRevision?'v'+row.latestPublishedRevision:'草稿'}</Tag></div>
        <p>{row.description}</p><div className="nw-card-label">调用阶段</div><StageWorkflowCallers id={row.definitionId} source={callers}/>
        <Button href={'/native-workflow/'+row.definitionId}>打开画布</Button></article>)}</section>
      <ProTable<DefinitionSummary>
        headerTitle="业务工作流"
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
            setStageTemplates(data.filter(item=>item.eventType==='stage_consultation'));
            const business=data.filter(item=>item.eventType!=='stage_consultation');
            return { data:business, success:true, total:business.length };
          } catch (error) {
            notify.error(error instanceof Error ? error.message : '读取流程失败');
            return { data: [], success: false, total: 0 };
          }
        }}
        columns={columns}
        toolbar={undefined}
      />
      <Modal
        title={publicAssistant ? '打开平台内置应用' : '从模板新建草稿'}
        open={creating}
        okText={publicAssistant ? '打开配置' : '创建'}
        cancelText="取消"
        confirmLoading={createSaving}
        onOk={() => void createDraft()}
        onCancel={() => setCreating(false)}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Select aria-label="模板类型" value={templateId} onChange={setTemplateId} options={TEMPLATE_OPTIONS} style={{ width: '100%' }} />
          {callable && <label>模板名称<Input aria-label="模板名称" placeholder={templateId==='stage-checklist'?'现场核对清单':'阶段知识问答'} maxLength={60} value={displayName} onChange={event=>setDisplayName(event.target.value)} /></label>}
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {publicAssistant
              ? '通用小K使用现有平台对话 Agent 和平台配置。进入后可配置开场白与“猜你想问”；此入口不会创建工作流草稿，也不会改变阶段 Agent 的工作流配置。'
              : '创建模板会保存草稿。可检查节点、端口和模拟轨迹，正式运行使用已发布版本。'}
          </Typography.Paragraph>
        </Space>
      </Modal>
    </PageContainer>
  );
}
