'use client';

import Link from 'next/link';
import { useRef, useState, type Key } from 'react';
import { Building2, Check, Copy, Ellipsis, Eye, Plus, Trash2 } from 'lucide-react';
import { PageContainer, ProForm, ProFormDigit, ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { Avatar, Button, Card, Dropdown, Flex, Input, Modal, Space, Tag, Typography } from 'antd';
import type { MenuProps } from 'antd';
import EnterpriseEditorDialog from '@/components/enterprise/EnterpriseEditorDialog';
import type { EnterpriseListItem } from '@/components/enterprise/types';
import { useConfirmDialog } from '@/components/admin/confirm-dialog';
import { notify } from '@/components/admin/operation-feedback';
import { PlatformEnterpriseDeleteModal } from '@/components/admin/platform-enterprise-delete-modal';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFetch } from '@/hooks/useFetch';
import { PLATFORM_ENTERPRISE_BATCH_PURGE_MAX } from '@/lib/platform-enterprise-purge-contract';
import { isPlatformAdminRole } from '@/lib/referrer-join-limits';

const ENTERPRISE_STATUS = {
  pending_approval: { text: '待审核', status: 'Warning' },
  active: { text: '正常', status: 'Success' },
  disabled: { text: '已停用', status: 'Default' },
  rejected: { text: '已拒绝', status: 'Error' },
};

type StatusAction = 'approve' | 'reject' | 'disable' | 'enable' | 'resubmit_review';

const ACTION_LABEL: Record<StatusAction, string> = {
  approve: '审核通过',
  reject: '拒绝审核',
  disable: '停用企业',
  enable: '启用企业',
  resubmit_review: '重新提交审核',
};

function EnterpriseStatus({ status }: { status: EnterpriseListItem['status'] }) {
  if (status === 'active') return <Tag color="success">正常</Tag>;
  if (status === 'pending_approval') return <Tag color="warning">待审核</Tag>;
  if (status === 'rejected') return <Tag color="error">已拒绝</Tag>;
  return <Tag>已停用</Tag>;
}

function truncateReason(reason?: string | null) {
  if (!reason) return null;
  return reason.length > 24 ? `${reason.slice(0, 24)}…` : reason;
}

export default function EnterprisesPage() {
  const actionRef = useRef<ActionType>(null);
  const confirmAction = useConfirmDialog();
  const { user } = useCurrentUser();
  const canEditJoinLimit = isPlatformAdminRole(user?.role);
  const canPurge = isPlatformAdminRole(user?.role);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [editingEnterprise, setEditingEnterprise] = useState<EnterpriseListItem | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [workingId, setWorkingId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<EnterpriseListItem | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [selectedEnterprises, setSelectedEnterprises] = useState<EnterpriseListItem[]>([]);
  const [reasonModal, setReasonModal] = useState<{
    enterprise: EnterpriseListItem;
    action: Extract<StatusAction, 'reject' | 'disable'>;
  } | null>(null);
  const [reasonDraft, setReasonDraft] = useState('');
  const {
    data: promotionConfig,
    isLoading: promotionConfigLoading,
    mutate: mutatePromotionConfig,
  } = useFetch<{ referrerMembershipLimit: number }>(
    canEditJoinLimit ? '/api/platform/promotion-config' : null
  );

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

  const runStatusAction = async (
    enterprise: EnterpriseListItem,
    action: StatusAction,
    reason?: string
  ) => {
    setWorkingId(`${enterprise._id}:${action}`);
    try {
      const response = await fetch(`/api/admin/enterprises/${enterprise._id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '企业状态更新失败');
      await actionRef.current?.reload();
      notify.success(`${ACTION_LABEL[action]}成功`);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '企业状态更新失败');
    } finally {
      setWorkingId('');
    }
  };

  const confirmStatusAction = async (enterprise: EnterpriseListItem, action: StatusAction) => {
    if (action === 'reject' || action === 'disable') {
      setReasonDraft('');
      setReasonModal({ enterprise, action });
      return;
    }
    const confirmed = await confirmAction({
      title: ACTION_LABEL[action],
      description: `确认对「${enterprise.name}」执行${ACTION_LABEL[action]}？`,
      confirmText: '确认',
      cancelText: '取消',
    });
    if (!confirmed) return;
    await runStatusAction(enterprise, action);
  };

  const columns: ProColumns<EnterpriseListItem>[] = [
    {
      title: '企业名称',
      dataIndex: 'name',
      width: 270,
      render: (_, enterprise) => (
        <Space align="start" size={12}>
          <Avatar shape="square" src={enterprise.logo || undefined} icon={<Building2 size={17} />} className="!bg-primary !text-primary-foreground" />
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
      width: 160,
      valueType: 'select',
      valueEnum: ENTERPRISE_STATUS,
      render: (_, enterprise) => (
        <Space direction="vertical" size={0}>
          <EnterpriseStatus status={enterprise.status} />
          {truncateReason(enterprise.statusReason) ? (
            <Typography.Text type="secondary" className="text-xs" title={enterprise.statusReason || undefined}>
              {truncateReason(enterprise.statusReason)}
            </Typography.Text>
          ) : null}
        </Space>
      ),
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
        ];

        if (enterprise.status === 'pending_approval') {
          items.push(
            {
              key: 'approve',
              label: '审核通过',
              disabled: Boolean(workingId),
              onClick: () => confirmStatusAction(enterprise, 'approve'),
            },
            {
              key: 'reject',
              label: '拒绝审核',
              danger: true,
              disabled: Boolean(workingId),
              onClick: () => confirmStatusAction(enterprise, 'reject'),
            }
          );
        } else if (enterprise.status === 'rejected') {
          items.push(
            {
              key: 'resubmit',
              label: '重新提交审核',
              disabled: Boolean(workingId),
              onClick: () => confirmStatusAction(enterprise, 'resubmit_review'),
            },
            {
              key: 'approve',
              label: '审核通过',
              disabled: Boolean(workingId),
              onClick: () => confirmStatusAction(enterprise, 'approve'),
            }
          );
        } else if (enterprise.status === 'active') {
          items.push({
            key: 'disable',
            label: '停用企业',
            danger: true,
            disabled: Boolean(workingId),
            onClick: () => confirmStatusAction(enterprise, 'disable'),
          });
        } else if (enterprise.status === 'disabled') {
          items.push({
            key: 'enable',
            label: '启用企业',
            disabled: Boolean(workingId),
            onClick: () => confirmStatusAction(enterprise, 'enable'),
          });
        }

        if (canPurge) {
          items.push({
            type: 'divider',
          });
          items.push({
            key: 'delete',
            label: '删除企业',
            danger: true,
            disabled: Boolean(workingId),
            onClick: () => setDeleteTarget(enterprise),
          });
        }

        return (
          <Space size={8}>
            <Button key="overview" size="small" icon={<Eye size={14} />} href={`/enterprises/${enterprise._id}`}>详情</Button>
            <Dropdown key="more" menu={{ items }} trigger={['click']}>
              <Button size="small" aria-label={`${enterprise.name} 更多操作`} loading={workingId.startsWith(`${enterprise._id}:`)} icon={<Ellipsis size={16} />} />
            </Dropdown>
          </Space>
        );
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
        <Flex vertical gap={24}>
          {canEditJoinLimit ? (
            <Card title="推广人可加入企业数" className="admin-panel-card" loading={promotionConfigLoading}>
              <Typography.Paragraph type="secondary">
                每个微信同时可作为推荐人加入的企业上限。收紧后已超限成员不会被退出，只阻止再加入新企业。单家企业若要限制推广人再服务其他店，请进入该企业「详情」设置「推广人企业保护」。
              </Typography.Paragraph>
              <ProForm
                key={promotionConfig?.referrerMembershipLimit ?? 'loading'}
                initialValues={{
                  referrerMembershipLimit: promotionConfig?.referrerMembershipLimit ?? 3,
                }}
                submitter={{ searchConfig: { submitText: '保存' } }}
                onFinish={async (values) => {
                  try {
                    const response = await fetch('/api/platform/promotion-config', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        referrerMembershipLimit: values.referrerMembershipLimit,
                      }),
                    });
                    const result = await response.json();
                    if (!response.ok || !result.success) {
                      throw new Error(result.error || '保存推广人可加入企业数失败');
                    }
                    await mutatePromotionConfig();
                    notify.success('推广人可加入企业数已保存');
                    return true;
                  } catch (error) {
                    notify.error(error instanceof Error ? error.message : '保存推广人可加入企业数失败');
                    return false;
                  }
                }}
              >
                <ProFormDigit
                  name="referrerMembershipLimit"
                  label="同时可加入企业数"
                  min={1}
                  rules={[{ required: true }]}
                  extra="默认 3 家。"
                  formItemProps={{ style: { width: '100%' } }}
                  fieldProps={{ className: 'w-full', precision: 0 }}
                />
              </ProForm>
            </Card>
          ) : null}
          <ProTable<EnterpriseListItem>
          actionRef={actionRef}
          rowKey="_id"
          columns={columns}
          search={{ labelWidth: 'auto', defaultCollapsed: false }}
          options={{ reload: true, density: true, setting: true }}
          pagination={{ defaultPageSize: 10, showSizeChanger: true }}
          scroll={{ x: 1200 }}
          rowSelection={
            canPurge
              ? {
                  selectedRowKeys: selectedEnterprises.map((item) => item._id),
                  preserveSelectedRowKeys: true,
                  onChange: (keys: Key[], rows: EnterpriseListItem[]) => {
                    setSelectedEnterprises((prev) => {
                      const kept = prev.filter((item) => keys.includes(item._id));
                      const keptIds = new Set(kept.map((item) => item._id));
                      const added = rows.filter((row) => row?._id && !keptIds.has(row._id));
                      return [...kept, ...added];
                    });
                  },
                }
              : undefined
          }
          tableAlertRender={
            canPurge
              ? ({ selectedRowKeys: keys }) => `已选择 ${keys.length} 家企业`
              : false
          }
          tableAlertOptionRender={
            canPurge
              ? () => (
                  <Button
                    danger
                    icon={<Trash2 size={16} />}
                    disabled={!selectedEnterprises.length}
                    onClick={() => {
                      if (!selectedEnterprises.length) return;
                      if (selectedEnterprises.length > PLATFORM_ENTERPRISE_BATCH_PURGE_MAX) {
                        notify.warning(`一次最多删除 ${PLATFORM_ENTERPRISE_BATCH_PURGE_MAX} 家企业`);
                        return;
                      }
                      setBatchDeleteOpen(true);
                    }}
                  >
                    批量删除
                  </Button>
                )
              : undefined
          }
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
        </Flex>
      </PageContainer>

      <EnterpriseEditorDialog
        open={isEditorOpen}
        onOpenChange={setIsEditorOpen}
        enterprise={editingEnterprise}
        onSaved={async () => {
          await actionRef.current?.reload();
        }}
      />

      <PlatformEnterpriseDeleteModal
        mode="single"
        open={Boolean(deleteTarget)}
        enterprise={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={async () => {
          setDeleteTarget(null);
          setSelectedEnterprises((prev) =>
            prev.filter((item) => item._id !== deleteTarget?._id)
          );
          await actionRef.current?.reload();
        }}
      />

      <PlatformEnterpriseDeleteModal
        mode="batch"
        open={batchDeleteOpen}
        enterprises={selectedEnterprises}
        onClose={() => setBatchDeleteOpen(false)}
        onDeleted={async () => {
          setBatchDeleteOpen(false);
          setSelectedEnterprises([]);
          await actionRef.current?.reload();
        }}
      />

      <Modal
        title={reasonModal ? ACTION_LABEL[reasonModal.action] : '操作原因'}
        open={Boolean(reasonModal)}
        okText="确认"
        cancelText="取消"
        confirmLoading={Boolean(reasonModal && workingId.startsWith(`${reasonModal.enterprise._id}:`))}
        okButtonProps={{ disabled: reasonDraft.trim().length < 4 }}
        onCancel={() => {
          setReasonModal(null);
          setReasonDraft('');
        }}
        onOk={async () => {
          if (!reasonModal) return;
          await runStatusAction(reasonModal.enterprise, reasonModal.action, reasonDraft.trim());
          setReasonModal(null);
          setReasonDraft('');
        }}
      >
        <Typography.Paragraph type="secondary">
          {reasonModal
            ? `请填写对「${reasonModal.enterprise.name}」执行${ACTION_LABEL[reasonModal.action]}的原因（4-200 字）。`
            : null}
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
