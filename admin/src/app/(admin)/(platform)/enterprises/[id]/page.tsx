'use client';

import { useParams, usePathname, useRouter } from 'next/navigation';
import { PageContainer, ProDescriptions } from '@ant-design/pro-components';
import { Button, Card, Col, Flex, Input, InputNumber, Modal, Row, Skeleton, Space, Switch, Tag, Timeline, Typography } from 'antd';
import { Settings2, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useFetch } from '@/hooks/useFetch';
import { useConfirmDialog } from '@/components/admin/confirm-dialog';
import EnterpriseEditorDialog from '@/components/enterprise/EnterpriseEditorDialog';
import EnterpriseOverviewCards from '@/components/enterprise/EnterpriseOverviewCards';
import {
  EnterpriseListItem,
  EnterpriseStatusEventItem,
} from '@/components/enterprise/types';
import { notify } from '@/components/admin/operation-feedback';
import { PlatformEnterpriseDeleteModal } from '@/components/admin/platform-enterprise-delete-modal';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { isPlatformAdminRole } from '@/lib/referrer-join-limits';

const ENTERPRISE_TABS = [
  { suffix: '', label: '企业概览' },
  { suffix: '/ai', label: 'AI 管理' },
  { suffix: '/automation', label: '自动化配置' },
];

const ACTION_LABEL: Record<EnterpriseStatusEventItem['action'], string> = {
  approve: '审核通过',
  reject: '拒绝审核',
  disable: '停用企业',
  enable: '启用企业',
  resubmit_review: '重新提交审核',
};

const STATUS_LABEL: Record<EnterpriseListItem['status'], string> = {
  pending_approval: '待审核',
  active: '正常',
  disabled: '已停用',
  rejected: '已拒绝',
};

function EnterpriseStatus({ status }: { status: EnterpriseListItem['status'] }) {
  if (status === 'active') return <Tag color="success">正常</Tag>;
  if (status === 'pending_approval') return <Tag color="warning">待审核</Tag>;
  if (status === 'rejected') return <Tag color="error">已拒绝</Tag>;
  return <Tag>已停用</Tag>;
}

export default function EnterpriseDetailPage() {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const enterpriseId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const { data: enterprise, isLoading, mutate } = useFetch<EnterpriseListItem>(
    enterpriseId ? `/api/admin/enterprises/${enterpriseId}` : null,
  );
  const { user } = useCurrentUser();
  const canEditProtection = isPlatformAdminRole(user?.role);
  const canPurge = isPlatformAdminRole(user?.role);
  const confirmAction = useConfirmDialog();
  const [showEditor, setShowEditor] = useState(false);
  const [workingAction, setWorkingAction] = useState('');
  const [reasonModalAction, setReasonModalAction] = useState<'reject' | 'disable' | null>(null);
  const [reasonDraft, setReasonDraft] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [protectionEnabled, setProtectionEnabled] = useState(false);
  const [protectionLimit, setProtectionLimit] = useState(0);
  const [savingProtection, setSavingProtection] = useState(false);

  const statusEvents = useMemo(
    () => enterprise?.statusEvents || [],
    [enterprise?.statusEvents]
  );

  useEffect(() => {
    setProtectionEnabled(enterprise?.referrerAdditionalEnterpriseLimit != null);
    setProtectionLimit(enterprise?.referrerAdditionalEnterpriseLimit ?? 0);
  }, [enterprise?.referrerAdditionalEnterpriseLimit]);

  const runStatusAction = async (
    action: EnterpriseStatusEventItem['action'],
    reason?: string
  ) => {
    if (!enterprise) return;
    setWorkingAction(action);
    try {
      const response = await fetch(`/api/admin/enterprises/${enterprise._id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '企业状态更新失败');
      await mutate();
      notify.success(`${ACTION_LABEL[action]}成功`);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '企业状态更新失败');
    } finally {
      setWorkingAction('');
    }
  };

  const confirmStatusAction = async (action: EnterpriseStatusEventItem['action']) => {
    if (!enterprise) return;
    if (action === 'reject' || action === 'disable') {
      setReasonDraft('');
      setReasonModalAction(action);
      return;
    }
    const confirmed = await confirmAction({
      title: ACTION_LABEL[action],
      description: `确认对「${enterprise.name}」执行${ACTION_LABEL[action]}？`,
      confirmText: '确认',
      cancelText: '取消',
    });
    if (!confirmed) return;
    await runStatusAction(action);
  };

  const saveReferrerProtection = async () => {
    if (!enterprise) return;
    setSavingProtection(true);
    try {
      const response = await fetch(`/api/admin/enterprises/${enterprise._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referrerAdditionalEnterpriseLimit: protectionEnabled ? protectionLimit : null,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存推广人企业保护失败');
      await mutate();
      notify.success('推广人企业保护已保存');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存推广人企业保护失败');
    } finally {
      setSavingProtection(false);
    }
  };

  if (isLoading || !enterprise) {
    return (
      <div className="admin-page-frame">
        <PageContainer breadcrumbRender={false} className="admin-page-container" title="企业概览">
          <Card className="admin-panel-card"><Skeleton active paragraph={{ rows: 5 }} /></Card>
        </PageContainer>
      </div>
    );
  }

  const tabs = ENTERPRISE_TABS.map((item) => ({
    key: `/enterprises/${enterprise._id}${item.suffix}`,
    tab: item.label,
  }));

  const statusActions: Array<{ key: EnterpriseStatusEventItem['action']; label: string; danger?: boolean }> = [];
  if (enterprise.status === 'pending_approval') {
    statusActions.push(
      { key: 'approve', label: '审核通过' },
      { key: 'reject', label: '拒绝审核', danger: true }
    );
  } else if (enterprise.status === 'rejected') {
    statusActions.push(
      { key: 'resubmit_review', label: '重新提交审核' },
      { key: 'approve', label: '审核通过' }
    );
  } else if (enterprise.status === 'active') {
    statusActions.push({ key: 'disable', label: '停用企业', danger: true });
  } else if (enterprise.status === 'disabled') {
    statusActions.push({ key: 'enable', label: '启用企业' });
  }

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title={enterprise.name}
        content={(
          <Space size={12} wrap>
            <EnterpriseStatus status={enterprise.status} />
            <Typography.Text type="secondary">企业编码：{enterprise.code}</Typography.Text>
            <Typography.Text type="secondary">联系人：{enterprise.contactPerson?.name || '-'}</Typography.Text>
            <Typography.Text type="secondary">创建时间：{enterprise.createdAt ? new Date(enterprise.createdAt).toLocaleString() : '-'}</Typography.Text>
          </Space>
        )}
        onBack={() => router.push('/enterprises')}
        tabList={tabs}
        tabActiveKey={pathname}
        onTabChange={(key) => router.push(key)}
        extra={[
          ...statusActions.map((action) => (
            <Button
              key={action.key}
              danger={action.danger}
              loading={workingAction === action.key}
              onClick={() => confirmStatusAction(action.key)}
            >
              {action.label}
            </Button>
          )),
          canPurge ? (
            <Button key="delete" danger onClick={() => setDeleteOpen(true)}>
              删除企业
            </Button>
          ) : null,
          <Button key="edit" onClick={() => setShowEditor(true)}>编辑基础信息</Button>,
          <Button key="ai" type="primary" icon={<Sparkles size={16} />} onClick={() => router.push(`/enterprises/${enterprise._id}/ai`)}>AI 管理</Button>,
        ]}
      >
        <Flex vertical gap={24}>
          <EnterpriseOverviewCards enterprise={enterprise} />

          {canEditProtection ? (
            <Card title="推广人企业保护" className="admin-panel-card">
              <Flex vertical gap={16}>
                <Typography.Paragraph type="secondary" className="!mb-0">
                  开启后，加入该企业的推广人最多再加入 M 家其他企业。0 表示只能服务本企业。收紧后已超限成员不会被退出。
                </Typography.Paragraph>
                <Flex align="center" gap={12} wrap>
                  <Switch
                    checked={protectionEnabled}
                    onChange={(checked) => {
                      setProtectionEnabled(checked);
                      if (checked && protectionLimit < 0) setProtectionLimit(0);
                    }}
                  />
                  <Typography.Text>{protectionEnabled ? '已开启保护' : '未开启，仅受全局上限约束'}</Typography.Text>
                </Flex>
                {protectionEnabled ? (
                  <Flex align="center" gap={12} wrap>
                    <Typography.Text>最多再加入其他企业</Typography.Text>
                    <InputNumber
                      min={0}
                      max={99}
                      precision={0}
                      value={protectionLimit}
                      onChange={(value) => setProtectionLimit(Number(value ?? 0))}
                    />
                    <Typography.Text type="secondary">0 表示只能服务本企业</Typography.Text>
                  </Flex>
                ) : null}
                <div>
                  <Button type="primary" loading={savingProtection} onClick={() => void saveReferrerProtection()}>
                    保存
                  </Button>
                </div>
              </Flex>
            </Card>
          ) : null}

          <Row gutter={[24, 24]}>
            <Col xs={24} lg={14}>
              <Card title="基础信息" className="admin-panel-card">
                <ProDescriptions<EnterpriseListItem>
                  column={{ xs: 1, sm: 2 }}
                  dataSource={enterprise}
                  columns={[
                    { title: '企业名称', dataIndex: 'name' },
                    { title: '企业编码', dataIndex: 'code', copyable: true },
                    { title: '联系人', dataIndex: ['contactPerson', 'name'], render: (_, item) => item.contactPerson?.name || '-' },
                    { title: '联系电话', dataIndex: ['contactPerson', 'phone'], render: (_, item) => item.contactPerson?.phone || '-' },
                    { title: '联系邮箱', dataIndex: ['contactPerson', 'email'], render: (_, item) => item.contactPerson?.email || '-' },
                    { title: '地推固定提成', dataIndex: 'groundPromotionFixedCommission', render: (value) => `${Number(value || 0).toFixed(2)} 元/单` },
                    {
                      title: '主色',
                      dataIndex: ['branding', 'primaryColor'],
                      render: (_, item) => <Space size={8}><span className="h-5 w-5 rounded border" style={{ backgroundColor: item.branding?.primaryColor || '#171717' }} />{item.branding?.primaryColor || '#171717'}</Space>,
                    },
                    {
                      title: '强调色',
                      dataIndex: ['branding', 'accentColor'],
                      render: (_, item) => <Space size={8}><span className="h-5 w-5 rounded border" style={{ backgroundColor: item.branding?.accentColor || '#0070f3' }} />{item.branding?.accentColor || '#0070f3'}</Space>,
                    },
                    {
                      title: '最近状态原因',
                      dataIndex: 'statusReason',
                      span: 2,
                      render: (_, item) => item.statusReason || '-',
                    },
                    {
                      title: '最近状态变更时间',
                      dataIndex: 'statusChangedAt',
                      render: (_, item) =>
                        item.statusChangedAt
                          ? new Date(item.statusChangedAt).toLocaleString()
                          : '-',
                    },
                  ]}
                />
              </Card>
            </Col>

            <Col xs={24} lg={10}>
              <Flex vertical gap={24}>
                <Card title="专项管理入口" className="admin-panel-card">
                  <Flex vertical gap={16}>
                    <Button block size="large" icon={<Sparkles size={16} />} onClick={() => router.push(`/enterprises/${enterprise._id}/ai`)}>AI 管理</Button>
                    <Button block size="large" icon={<Settings2 size={16} />} onClick={() => router.push(`/enterprises/${enterprise._id}/automation`)}>自动化配置</Button>
                  </Flex>
                </Card>

                <Card title="状态变更记录" className="admin-panel-card">
                  {statusEvents.length ? (
                    <Timeline
                      items={statusEvents.map((event) => ({
                        children: (
                          <Space direction="vertical" size={0}>
                            <Typography.Text>
                              {ACTION_LABEL[event.action]}：
                              {STATUS_LABEL[event.fromStatus as EnterpriseListItem['status']] || event.fromStatus}
                              {' → '}
                              {STATUS_LABEL[event.toStatus as EnterpriseListItem['status']] || event.toStatus}
                            </Typography.Text>
                            {event.reason ? (
                              <Typography.Text type="secondary">{event.reason}</Typography.Text>
                            ) : null}
                            <Typography.Text type="secondary" className="text-xs">
                              {event.createdAt ? new Date(event.createdAt).toLocaleString() : '-'}
                              {event.actorAdminId ? ` · 操作人 #${event.actorAdminId}` : ''}
                            </Typography.Text>
                          </Space>
                        ),
                      }))}
                    />
                  ) : (
                    <Typography.Text type="secondary">暂无状态变更记录</Typography.Text>
                  )}
                </Card>
              </Flex>
            </Col>
          </Row>
        </Flex>
      </PageContainer>

      <EnterpriseEditorDialog
        open={showEditor}
        onOpenChange={setShowEditor}
        enterprise={enterprise}
        onSaved={async () => { await mutate(); }}
      />

      <PlatformEnterpriseDeleteModal
        mode="single"
        open={deleteOpen}
        enterprise={enterprise}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => {
          setDeleteOpen(false);
          router.push('/enterprises');
        }}
      />

      <Modal
        title={reasonModalAction ? ACTION_LABEL[reasonModalAction] : '操作原因'}
        open={Boolean(reasonModalAction)}
        okText="确认"
        cancelText="取消"
        confirmLoading={Boolean(reasonModalAction && workingAction === reasonModalAction)}
        okButtonProps={{ disabled: reasonDraft.trim().length < 4 }}
        onCancel={() => {
          setReasonModalAction(null);
          setReasonDraft('');
        }}
        onOk={async () => {
          if (!reasonModalAction) return;
          await runStatusAction(reasonModalAction, reasonDraft.trim());
          setReasonModalAction(null);
          setReasonDraft('');
        }}
      >
        <Typography.Paragraph type="secondary">
          请填写操作原因（4-200 字）。
        </Typography.Paragraph>
        <Input.TextArea
          value={reasonDraft}
          onChange={(event) => setReasonDraft(event.target.value)}
          rows={4}
          maxLength={200}
          showCount
          placeholder="请输入原因"
        />
      </Modal>
    </div>
  );
}
