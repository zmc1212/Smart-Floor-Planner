'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ModalForm,
  PageContainer,
  ProDescriptions,
  ProForm,
  ProFormDateTimePicker,
  ProFormDigit,
  ProFormSelect,
  ProFormSwitch,
  ProFormTextArea,
  ProTable,
  type ActionType,
  type ProColumns,
  type ProFormInstance,
} from '@ant-design/pro-components';
import { Alert, Button, Card, Drawer, Flex, Input, Modal, Space, Tag, Typography } from 'antd';
import { Check, Eye, RefreshCw, Undo2, UserPlus, Users, X } from 'lucide-react';
import { notify } from '@/components/ui/operation-feedback';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { useCurrentUser } from '@/hooks/useCurrentUser';

const stageLabels: Record<string, string> = {
  reported: '已报备',
  contacted: '已联系',
  measuring: '量房中',
  designing: '设计中',
  quoted: '已报价',
  paid: '已成交',
  closed_lost: '已失单',
};

const ownershipLabels: Record<string, string> = {
  unassigned: '待分配',
  auto_locked: '系统锁定',
  manually_locked: '人工锁定',
  conflict_pending: '冲突待核',
};

const roleLabels: Record<string, string> = {
  none: '无',
  salesperson: '渠道地推',
  measurer: '量房员',
  designer: '设计师',
  enterprise_admin: '企业负责人',
  admin: '平台管理员',
  super_admin: '平台负责人',
};

const viewOptions = [
  { label: '全部报备', value: 'all' },
  { label: '待跟进', value: 'followup' },
  { label: '待分配量房', value: 'assignMeasure' },
  { label: '待分配设计', value: 'assignDesign' },
  { label: '已超时', value: 'overdue' },
  { label: '线索池', value: 'pool' },
  { label: '待审批认领', value: 'pendingClaims' },
];

type AdminUserOption = { _id: string; role?: string; displayName?: string; username?: string };

type PromotionRecord = {
  _id: string;
  enterpriseName?: string;
  creditCode?: string;
  contactPerson?: string;
  phone?: string;
  businessStage?: string;
  ownershipStatus?: string;
  pendingActionRole?: string;
  poolStatus?: string;
  nextFollowUpAt?: string;
  protectionExpiresAt?: string;
  lastActivityAt?: string;
  promoterId?: { _id?: string; displayName?: string; username?: string; role?: string } | string;
  claimRequest?: {
    status?: string;
    requestedAt?: string;
    reviewedAt?: string;
    rejectReason?: string;
    requestedBy?: { _id?: string; displayName?: string; username?: string; role?: string } | string;
    reviewedBy?: { _id?: string; displayName?: string; username?: string; role?: string } | string;
  };
  followUpRecords?: Array<{
    content?: string;
    type?: string;
    operator?: string;
    createdAt?: string;
    metadata?: Record<string, unknown>;
  }>;
  measureTask?: { status?: string; dueAt?: string; assignedTo?: { _id?: string; displayName?: string; username?: string } };
  designTask?: { status?: string; dueAt?: string; assignedTo?: { _id?: string; displayName?: string; username?: string } };
};

type PromotionConfig = {
  protectionPeriodDays: number;
  protectionExtendDays: number;
  maxProtectionExtends: number;
  poolClaimRequiresApproval: boolean;
};

type ConfigForm = PromotionConfig;
type FollowUpForm = { followUpNote?: string; nextFollowUpAt?: string };
type AssignmentForm = { promoterId: string };

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value?: string | null) {
  const date = parseDate(value);
  return date ? date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
}

function getPrimaryDueAt(record: PromotionRecord) {
  return record.nextFollowUpAt || record.measureTask?.dueAt || record.designTask?.dueAt || null;
}

function getDisplayName(value?: string | { displayName?: string; username?: string } | null) {
  if (!value) return '';
  return typeof value === 'string' ? value : value.displayName || value.username || '';
}

function getTimelineTypeLabel(type?: string) {
  const labels: Record<string, string> = {
    report_created: '创建报备', note: '备注', follow_up: '跟进记录', ownership_assigned: '指派地推',
    pool_released: '释放公海', pool_auto_released: '系统释放', pool_claimed: '认领成功',
    pool_claim_requested: '申请认领', pool_claim_approved: '认领通过', pool_claim_rejected: '认领驳回', pool_assigned: '公海分配',
  };
  return type ? labels[type] || type : '操作记录';
}

function isOverdue(record: PromotionRecord) {
  const dueAt = parseDate(getPrimaryDueAt(record));
  return Boolean(dueAt && dueAt.getTime() < Date.now());
}

function matchesView(record: PromotionRecord, view: string) {
  if (view === 'all') return true;
  if (view === 'followup') return record.pendingActionRole === 'salesperson';
  if (view === 'assignMeasure') return record.businessStage === 'measuring' && record.measureTask?.status === 'unassigned';
  if (view === 'assignDesign') return record.measureTask?.status === 'submitted' && record.designTask?.status === 'unassigned';
  if (view === 'overdue') return isOverdue(record);
  if (view === 'pool') return record.poolStatus === 'in_pool';
  if (view === 'pendingClaims') return record.poolStatus === 'claimed' && record.claimRequest?.status === 'pending';
  return true;
}

function emptyMessage(view: string) {
  if (view === 'pool') return '线索池暂无可分配或认领的线索。';
  if (view === 'pendingClaims') return '当前没有待审批的认领申请。';
  return '暂无匹配的企业报备。';
}

export default function PromotionRecordsPage() {
  const actionRef = useRef<ActionType>(null);
  const configFormRef = useRef<ProFormInstance<ConfigForm>>(null);
  const followUpFormRef = useRef<ProFormInstance<FollowUpForm>>(null);
  const confirmAction = useConfirmDialog();
  const { user } = useCurrentUser();
  const [staff, setStaff] = useState<AdminUserOption[]>([]);
  const [selected, setSelected] = useState<PromotionRecord | null>(null);
  const [assigningPoolRecord, setAssigningPoolRecord] = useState<PromotionRecord | null>(null);
  const [rejectingRecord, setRejectingRecord] = useState<PromotionRecord | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [promotionConfig, setPromotionConfig] = useState<PromotionConfig | null>(null);
  const [configSaving, setConfigSaving] = useState(false);
  const [workingAction, setWorkingAction] = useState('');

  const canManage = Boolean(user && ['enterprise_admin', 'admin', 'super_admin'].includes(user.role));
  const canAssignPromoter = Boolean(user && ['admin', 'super_admin'].includes(user.role));
  const canClaimPool = user?.role === 'salesperson';
  const salespeople = useMemo(() => staff.filter((item) => item.role === 'salesperson'), [staff]);
  const salespersonOptions = useMemo(() => salespeople.map((item) => ({ label: item.displayName || item.username || item._id, value: item._id })), [salespeople]);

  const reloadRecords = useCallback(async () => {
    await actionRef.current?.reload();
  }, []);

  const fetchPromotionConfig = useCallback(async () => {
    if (!canAssignPromoter) return;
    try {
      const response = await fetch('/api/platform/promotion-config');
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '读取保护期规则失败');
      setPromotionConfig(result.data);
      configFormRef.current?.setFieldsValue(result.data);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '读取保护期规则失败');
    }
  }, [canAssignPromoter]);

  useEffect(() => { void fetchPromotionConfig(); }, [fetchPromotionConfig]);

  const requestRecords = useCallback(async (params: Record<string, unknown>) => {
    const view = String(params.view || 'all');
    const businessStage = String(params.businessStage || '');
    const isPool = view === 'pool' || view === 'pendingClaims';
    const endpoint = isPool
      ? `/api/promotion-records/pool?poolStatus=${view === 'pendingClaims' ? 'claimed' : 'in_pool'}`
      : `/api/promotion-records${businessStage ? `?businessStage=${encodeURIComponent(businessStage)}` : ''}`;
    const [recordsResponse, staffResponse, adminsResponse] = await Promise.all([
      fetch(endpoint), fetch('/api/staff'), fetch('/api/admin-users'),
    ]);
    const recordsResult = await recordsResponse.json();
    if (!recordsResponse.ok || !recordsResult.success) throw new Error(recordsResult.error || '读取企业报备失败');
    const mergedStaff = new Map<string, AdminUserOption>();
    for (const response of [staffResponse, adminsResponse]) {
      if (!response.ok) continue;
      const result = await response.json() as { success?: boolean; data?: AdminUserOption[] };
      if (!result.success) continue;
      for (const item of result.data || []) {
        if (response === staffResponse || item.role === 'salesperson') mergedStaff.set(String(item._id), item);
      }
    }
    setStaff(Array.from(mergedStaff.values()));
    const records = (recordsResult.data || []) as PromotionRecord[];
    return { data: records.filter((record) => matchesView(record, view)), total: records.filter((record) => matchesView(record, view)).length, success: true };
  }, []);

  const requestPoolAction = useCallback(async (payload: Record<string, unknown>, successMessage: string, selectedId?: string) => {
    setWorkingAction(String(payload.recordId));
    try {
      const response = await fetch('/api/promotion-records/pool', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '操作失败');
      if (selectedId && selectedId === result.data?._id) setSelected(result.data);
      notify.success(successMessage);
      await reloadRecords();
      return result.data as PromotionRecord;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '操作失败');
      return null;
    } finally {
      setWorkingAction('');
    }
  }, [reloadRecords]);

  const handleClaim = async (recordId: string) => {
    const approvalRequired = promotionConfig?.poolClaimRequiresApproval;
    const confirmed = await confirmAction({
      title: approvalRequired ? '提交认领申请' : '认领客户线索',
      description: approvalRequired ? '审批通过后会进入你的保护期。' : `认领后将获得 ${promotionConfig?.protectionPeriodDays ?? 30} 天保护期。`,
      confirmText: approvalRequired ? '提交申请' : '认领',
    });
    if (!confirmed) return;
    await requestPoolAction({ recordId }, approvalRequired ? '已提交认领申请' : '认领成功');
  };

  const handleReleaseToPool = async (recordId: string) => {
    const confirmed = await confirmAction({ title: '释放到公海池', description: '释放后渠道地推可以重新认领该线索。', confirmText: '释放', destructive: true });
    if (confirmed) await requestPoolAction({ action: 'release', recordId }, '已释放到公海池', selected?._id);
  };

  const handleApproveClaim = async (recordId: string) => {
    await requestPoolAction({ action: 'approve_claim', recordId }, '认领审批已通过', selected?._id);
  };

  const updateRecord = async (payload: Record<string, unknown>, options?: { closeOnSuccess?: boolean; successMessage?: string }) => {
    if (!selected) return false;
    setWorkingAction(selected._id);
    try {
      const response = await fetch(`/api/promotion-records/${selected._id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '更新失败');
      setSelected(options?.closeOnSuccess ? null : result.data);
      followUpFormRef.current?.resetFields();
      notify.success(options?.successMessage || '操作成功');
      await reloadRecords();
      return true;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '更新失败');
      return false;
    } finally {
      setWorkingAction('');
    }
  };

  const openDetail = async (record: PromotionRecord) => {
    setSelected(record);
    followUpFormRef.current?.setFieldsValue({ nextFollowUpAt: record.nextFollowUpAt });
    try {
      const response = await fetch(`/api/promotion-records/${record._id}`);
      const result = await response.json();
      if (response.ok && result.success) {
        setSelected(result.data);
        followUpFormRef.current?.setFieldsValue({ nextFollowUpAt: result.data.nextFollowUpAt });
      }
    } catch {
      notify.error('读取报备详情失败');
    }
  };

  const columns: ProColumns<PromotionRecord>[] = [
    {
      title: '视图', dataIndex: 'view', valueType: 'select', hideInTable: true,
      fieldProps: { options: viewOptions.filter((item) => item.value !== 'pendingClaims' || canAssignPromoter) },
      initialValue: 'all',
    },
    { title: '业务阶段', dataIndex: 'businessStage', valueType: 'select', hideInTable: true, fieldProps: { options: Object.entries(stageLabels).map(([value, label]) => ({ label, value })) } },
    {
      title: '企业', dataIndex: 'enterpriseName', width: 230, hideInSearch: true,
      render: (_, record) => <Flex vertical gap={2}><Typography.Text strong>{record.enterpriseName || '-'}</Typography.Text><Typography.Text type="secondary" className="text-xs">{record.creditCode || '未填信用代码'}</Typography.Text></Flex>,
    },
    {
      title: '联系人', key: 'contact', width: 180, hideInSearch: true,
      render: (_, record) => <Flex vertical gap={2}><Typography.Text>{record.contactPerson || '-'}</Typography.Text><Typography.Text type="secondary" className="text-xs">{record.phone || '-'}</Typography.Text></Flex>,
    },
    {
      title: '归属地推', key: 'promoter', width: 210, hideInSearch: true,
      render: (_, record) => <Flex vertical gap={4}><Typography.Text>{record.poolStatus === 'claimed' && record.claimRequest?.status === 'pending' ? `待审批：${getDisplayName(record.claimRequest.requestedBy) || '未识别申请人'}` : getDisplayName(record.promoterId) || '当前无归属'}</Typography.Text><Space size={4}><Tag>{ownershipLabels[record.ownershipStatus || ''] || record.ownershipStatus || '无'}</Tag>{record.poolStatus === 'claimed' ? <Tag color="warning">待审批认领</Tag> : null}</Space></Flex>,
    },
    {
      title: '当前进度', key: 'progress', width: 165, hideInSearch: true,
      render: (_, record) => <Flex vertical gap={4}><Tag color="processing">{stageLabels[record.businessStage || ''] || record.businessStage || '-'}</Tag><Typography.Text type="secondary" className="text-xs">待办：{roleLabels[record.pendingActionRole || ''] || record.pendingActionRole || '无'}</Typography.Text></Flex>,
    },
    {
      title: '最近时点', key: 'dueAt', width: 160, hideInSearch: true,
      render: (_, record) => <Flex vertical gap={4}><Typography.Text>{formatDate(getPrimaryDueAt(record))}</Typography.Text>{isOverdue(record) ? <Tag color="error">待处理</Tag> : null}</Flex>,
    },
    {
      title: '操作', key: 'actions', valueType: 'option', fixed: 'right', width: 260, hideInSearch: true,
      render: (_, record) => {
        const loading = workingAction === record._id;
        const detailAction = <Button key="detail" size="small" icon={<Eye size={14} />} onClick={() => openDetail(record)}>详情</Button>;
        if (record.poolStatus === 'in_pool') {
          return <Space size={8}>
            {canAssignPromoter ? <Button key="assign" size="small" icon={<UserPlus size={14} />} loading={loading} onClick={() => setAssigningPoolRecord(record)}>分配地推</Button> : null}
            {!canAssignPromoter && canClaimPool ? <Button key="claim" size="small" icon={<Users size={14} />} loading={loading} onClick={() => handleClaim(record._id)}>认领</Button> : null}
            {detailAction}
          </Space>;
        }
        if (record.poolStatus === 'claimed') return <Space size={8}>
          {detailAction}
          {canAssignPromoter ? <Button key="approve" size="small" icon={<Check size={14} />} loading={loading} onClick={() => handleApproveClaim(record._id)}>通过认领</Button> : null}
          {canAssignPromoter ? <Button key="reject" size="small" danger icon={<X size={14} />} loading={loading} onClick={() => { setRejectingRecord(record); setRejectReason(''); }}>驳回</Button> : null}
        </Space>;
        return <Space size={8}>
          {detailAction}
          {canAssignPromoter && !['paid', 'closed_lost'].includes(record.businessStage || '') ? <Button key="release" size="small" danger icon={<Undo2 size={14} />} loading={loading} onClick={() => handleReleaseToPool(record._id)}>释放公海</Button> : null}
        </Space>;
      },
    },
  ];

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="企业报备管理"
        content="统一处理渠道报备、协作待办、超时任务与公海池分配。"
        extra={[<Button key="refresh" icon={<RefreshCw size={16} />} onClick={() => reloadRecords()}>刷新</Button>]}
      >
        <Flex vertical gap={24} className="admin-config-stack">
          {canAssignPromoter ? (
            <Card title="渠道地推保护期规则" className="admin-panel-card">
              <Flex vertical gap={16}>
                <Typography.Paragraph type="secondary" className="!mb-0">
                  规则影响新报备、地推认领、公海池重新分配，以及跟进后的保护期顺延。
                </Typography.Paragraph>
                {promotionConfig ? <Alert type="info" showIcon message={`当前生效：保护期 ${promotionConfig.protectionPeriodDays} 天，单次延长 ${promotionConfig.protectionExtendDays} 天，最多延长 ${promotionConfig.maxProtectionExtends} 次。`} /> : null}
                <ProForm<ConfigForm>
                  formRef={configFormRef}
                  layout="vertical"
                  onFinish={async (values) => {
                    setConfigSaving(true);
                    try {
                      const response = await fetch('/api/platform/promotion-config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
                      const result = await response.json();
                      if (!response.ok || !result.success) throw new Error(result.error || '保护期规则保存失败');
                      setPromotionConfig(result.data);
                      configFormRef.current?.setFieldsValue(result.data);
                      notify.success('保护期规则已保存');
                      return true;
                    } catch (error) {
                      notify.error(error instanceof Error ? error.message : '保护期规则保存失败');
                      return false;
                    } finally { setConfigSaving(false); }
                  }}
                  submitter={{ searchConfig: { submitText: '保存规则' }, submitButtonProps: { loading: configSaving }, render: (_, dom) => <Flex justify="end" gap={12} style={{ marginTop: 24 }}>{dom}</Flex> }}
                >
                  <Flex vertical gap={16}>
                    <ProFormDigit name="protectionPeriodDays" label="保护期天数" min={1} rules={[{ required: true }]} formItemProps={{ style: { width: '100%' } }} fieldProps={{ className: 'w-full' }} />
                    <ProFormDigit name="protectionExtendDays" label="单次延长天数" min={1} rules={[{ required: true }]} formItemProps={{ style: { width: '100%' } }} fieldProps={{ className: 'w-full' }} />
                    <ProFormDigit name="maxProtectionExtends" label="最大延长次数" min={0} rules={[{ required: true }]} formItemProps={{ style: { width: '100%' } }} fieldProps={{ className: 'w-full' }} />
                    <ProFormSwitch name="poolClaimRequiresApproval" label="认领后需管理员审批" extra="开启后，地推认领会先进入待审批状态。" />
                  </Flex>
                </ProForm>
              </Flex>
            </Card>
          ) : null}

          <ProTable<PromotionRecord>
            actionRef={actionRef}
            rowKey="_id"
            columns={columns}
            request={requestRecords}
            search={{ labelWidth: 'auto', defaultCollapsed: false, span: 12 }}
            options={{ reload: true, density: true, setting: true }}
            pagination={{ defaultPageSize: 10, showSizeChanger: true }}
            scroll={{ x: 1180 }}
            locale={{ emptyText: emptyMessage('all') }}
          />
        </Flex>
      </PageContainer>

      <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} width={720} title={selected?.enterpriseName || '报备详情'} destroyOnHidden>
        {selected ? (
          <Flex vertical gap={24}>
            <ProDescriptions<PromotionRecord>
              column={2}
              dataSource={selected}
              columns={[
                { title: '联系人', dataIndex: 'contactPerson' }, { title: '电话', dataIndex: 'phone' },
                { title: '信用代码', dataIndex: 'creditCode' }, { title: '归属地推', render: () => getDisplayName(selected.promoterId) || '当前无归属' },
                { title: '业务阶段', render: () => <Tag color="processing">{stageLabels[selected.businessStage || ''] || selected.businessStage || '-'}</Tag> },
                { title: '待办角色', render: () => roleLabels[selected.pendingActionRole || ''] || selected.pendingActionRole || '无' },
                { title: '公海状态', render: () => ({ protected: '保护中', in_pool: '公海中', claimed: '待审批认领' }[selected.poolStatus || ''] || '-') },
                { title: '下次跟进', render: () => formatDate(selected.nextFollowUpAt) },
              ]}
            />

            {selected.poolStatus === 'claimed' && selected.claimRequest?.status === 'pending' && canAssignPromoter ? (
              <Alert type="warning" showIcon message="待审批认领申请" description={<Flex justify="space-between" align="center" wrap="wrap" gap={12}><span>申请人：{getDisplayName(selected.claimRequest.requestedBy) || '未识别申请人'}，申请时间：{formatDate(selected.claimRequest.requestedAt)}</span><Space><Button type="primary" loading={workingAction === selected._id} onClick={() => handleApproveClaim(selected._id)}>通过认领</Button><Button danger loading={workingAction === selected._id} onClick={() => { setRejectingRecord(selected); setRejectReason(''); }}>驳回申请</Button></Space></Flex>} />
            ) : null}

            <Card title="推进业务进度" className="admin-panel-card">
              <ProForm<FollowUpForm>
                formRef={followUpFormRef}
                layout="vertical"
                onFinish={async (values) => updateRecord(values)}
                submitter={{ searchConfig: { submitText: '保存并录入日志' }, submitButtonProps: { disabled: workingAction === selected._id, loading: workingAction === selected._id }, render: (_, dom) => <Flex justify="end" gap={12} style={{ marginTop: 24 }}><Button onClick={() => { const values = followUpFormRef.current?.getFieldsValue(); void updateRecord({ ...values, followUpCompleted: true }); }}>标记为已完成跟进</Button>{dom}</Flex> }}
              >
                <ProFormTextArea name="followUpNote" label="跟进记录" fieldProps={{ rows: 4, placeholder: '记录本次沟通进展、企业意向等信息...' }} />
                <ProFormDateTimePicker name="nextFollowUpAt" label="计划下次跟进" fieldProps={{ className: 'w-full' }} />
              </ProForm>
            </Card>

            <Card title="操作时间线" className="admin-panel-card">
              <Flex vertical gap={12}>
                {(selected.followUpRecords || []).slice().sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()).map((item, index) => (
                  <Card key={`${item.createdAt || 'timeline'}-${index}`} size="small"><Flex vertical gap={8}><Flex justify="space-between" wrap="wrap"><Space><Tag>{getTimelineTypeLabel(item.type)}</Tag><Typography.Text strong>{item.operator || 'System'}</Typography.Text></Space><Typography.Text type="secondary">{formatDate(item.createdAt)}</Typography.Text></Flex><Typography.Text>{item.content || '-'}</Typography.Text>{item.type === 'pool_claim_rejected' && typeof item.metadata?.rejectReason === 'string' && item.metadata.rejectReason ? <Typography.Text type="warning">驳回原因：{item.metadata.rejectReason}</Typography.Text> : null}</Flex></Card>
                ))}
                {!selected.followUpRecords?.length ? <Typography.Text type="secondary">当前还没有操作记录。</Typography.Text> : null}
              </Flex>
            </Card>

            {selected.ownershipStatus !== 'conflict_pending' && canAssignPromoter ? (
              <Card title="指派或调整渠道地推" className="admin-panel-card">
                <ProForm<AssignmentForm>
                  initialValues={{ promoterId: typeof selected.promoterId === 'string' ? selected.promoterId : selected.promoterId?._id }}
                  onFinish={async (values) => updateRecord({ ownershipStatus: 'manually_locked', promoterId: values.promoterId, resolution: 'manual_assign' }, { closeOnSuccess: true, successMessage: '地推指派成功' })}
                  submitter={{ searchConfig: { submitText: '确认指派' }, render: (_, dom) => <Flex justify="end" gap={12} style={{ marginTop: 24 }}>{!['paid', 'closed_lost'].includes(selected.businessStage || '') ? <Button danger onClick={() => handleReleaseToPool(selected._id)}>释放到公海池</Button> : null}{dom}</Flex> }}
                ><ProFormSelect name="promoterId" label="渠道地推" options={salespersonOptions} rules={[{ required: true, message: '请选择渠道地推' }]} /></ProForm>
              </Card>
            ) : null}

            {selected.ownershipStatus === 'conflict_pending' && canManage ? (
              <Card title="冲突单归属处理" className="admin-panel-card">
                <ProForm<AssignmentForm>
                  onFinish={async (values) => updateRecord({ ownershipStatus: 'manually_locked', promoterId: values.promoterId }, { successMessage: '归属已确认' })}
                  submitter={{ searchConfig: { submitText: '确认归属' }, render: (_, dom) => <Flex justify="end" gap={12} style={{ marginTop: 24 }}>{dom}</Flex> }}
                >
                  <ProFormSelect name="promoterId" label="最终归属地推员" options={salespersonOptions} rules={[{ required: true, message: '请选择最终归属地推员' }]} />
                </ProForm>
              </Card>
            ) : null}
          </Flex>
        ) : null}
      </Drawer>

      <ModalForm<AssignmentForm>
        title="分配渠道地推"
        open={Boolean(assigningPoolRecord)}
        modalProps={{ destroyOnHidden: true, onCancel: () => setAssigningPoolRecord(null) }}
        onOpenChange={(open) => !open && setAssigningPoolRecord(null)}
        onFinish={async (values) => {
          if (!assigningPoolRecord) return false;
          const result = await requestPoolAction({ action: 'assign', recordId: assigningPoolRecord._id, promoterId: values.promoterId }, '分配成功');
          if (result) setAssigningPoolRecord(null);
          return Boolean(result);
        }}
        submitter={{ searchConfig: { submitText: '确认分配' }, render: (_, dom) => <Flex justify="end" gap={12} style={{ marginTop: 24 }}>{dom}</Flex> }}
      >
        <Typography.Paragraph type="secondary">将 {assigningPoolRecord?.enterpriseName || '该客户'} 从线索池分配给渠道地推，分配后会重新进入 {promotionConfig?.protectionPeriodDays ?? 30} 天保护期。</Typography.Paragraph>
        <ProFormSelect name="promoterId" label="渠道地推" options={salespersonOptions} rules={[{ required: true, message: '请选择渠道地推' }]} />
      </ModalForm>

      <Modal title="驳回认领申请" open={Boolean(rejectingRecord)} okText="确认驳回" okButtonProps={{ danger: true, loading: workingAction === rejectingRecord?._id }} onCancel={() => setRejectingRecord(null)} onOk={async () => { if (!rejectingRecord) return; const result = await requestPoolAction({ action: 'reject_claim', recordId: rejectingRecord._id, reason: rejectReason }, '认领申请已驳回', selected?._id); if (result) setRejectingRecord(null); }}>
        <Typography.Paragraph type="secondary">可选填写驳回原因，系统会写入该报备的操作时间线。</Typography.Paragraph>
        <Input.TextArea aria-label="驳回原因" rows={4} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="请输入驳回原因（可选）" />
      </Modal>
    </div>
  );
}
