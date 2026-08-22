'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PageContainer,
  ProForm,
  ProFormText,
  ProTable,
  type ActionType,
  type ProColumns,
} from '@ant-design/pro-components';
import { Alert, Button, Card, Flex, Statistic, Switch, Tag, Typography } from 'antd';
import {
  AlertTriangle,
  CheckCircle2,
  CircleOff,
  PlayCircle,
  ShieldAlert,
} from 'lucide-react';
import { notify } from '@/components/admin/operation-feedback';
import { useCurrentUser } from '@/hooks/useCurrentUser';

type LogStatus = 'sent' | 'failed' | 'skipped';

type WorkflowLog = {
  _id: string;
  recordId?: {
    _id: string;
    enterpriseName?: string | null;
    contactPerson?: string | null;
  } | string;
  recipientStaffId?: {
    _id: string;
    displayName?: string | null;
    username?: string | null;
    phone?: string | null;
    role?: string | null;
  } | string | null;
  recipientRole?: string | null;
  channel?: string | null;
  notificationType: string;
  status: LogStatus;
  message?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
  sentAt?: string | null;
  createdAt?: string;
};

type NotificationStats = Record<LogStatus, number>;

type NotificationTemplateKind =
  | 'workflow_todo'
  | 'lead_assignment'
  | 'new_lead'
  | 'measurement_appointment'
  | 'design_published'
  | 'enterprise_join_result'
  | 'signing_commission'
  | 'lead_converted';

type NotificationConfigForm = {
  version: 2;
  subscriptionMessagesEnabled: boolean;
  templates: Record<NotificationTemplateKind, {
    title?: string;
    templateId: string;
    keywordKeys?: Record<string, string>;
  }>;
  miniprogramTemplateId?: string;
};

const TEMPLATE_FIELDS: Array<{
  kind: NotificationTemplateKind;
  label: string;
  help: string;
}> = [
  { kind: 'workflow_todo', label: '装修待办提醒', help: '待派单、量房完成后请发布方案，以及通用待办任务。' },
  { kind: 'lead_assignment', label: '客户指派成功通知', help: '新线索派单后通知设计师和测量员。' },
  { kind: 'new_lead', label: '新增客户成功通知', help: '新线索创建后通知企业负责人。' },
  { kind: 'measurement_appointment', label: '上门量房提醒', help: '预约创建、改期、取消或过期时通知设计师、测量员和客户。' },
  { kind: 'design_published', label: '设计案例发布提醒', help: '方案对客户可见后通知客户本人。' },
  { kind: 'enterprise_join_result', label: '入驻申请结果通知', help: '平台审核通过或驳回企业入驻申请后通知企业联系人。' },
  { kind: 'signing_commission', label: '推广奖励到账提醒', help: '推荐网络线索签单且提成快照成功后通知推荐人。' },
  { kind: 'lead_converted', label: '客户已成交提醒', help: '客户签单成功后通知企业负责人。' },
];

const STATUS_OPTIONS: Array<{ label: string; value: LogStatus }> = [
  { label: '已发送', value: 'sent' },
  { label: '发送失败', value: 'failed' },
  { label: '已跳过', value: 'skipped' },
];

const STATUS_META: Record<LogStatus, { label: string; color: string }> = {
  sent: { label: '已发送', color: 'green' },
  failed: { label: '发送失败', color: 'red' },
  skipped: { label: '已跳过', color: 'gold' },
};

const TYPE_LABELS: Record<string, string> = {
  lead_created: '新增客户',
  lead_assigned: '客户指派',
  lead_assignment_pending: '待派单',
  measurement_appointment_created: '预约创建',
  measurement_appointment_rescheduled: '预约改期',
  measurement_appointment_cancelled: '预约取消',
  measurement_appointment_expired: '预约过期',
  survey_completed: '量房完成',
  design_published: '方案发布',
  signing_commission: '推广奖励到账',
  lead_converted: '客户已成交',
  enterprise_join_result: '入驻审核结果',
  // Historical promotion-report rows may still appear in the ledger.
  follow_up_created: '（旧）新跟进提醒',
  follow_up_overdue: '（旧）跟进超时',
  conflict_pending: '（旧）报备冲突',
  measure_assigned: '（旧）测量派单',
  measure_overdue: '（旧）测量超时',
  measure_submitted: '（旧）测量完成',
  design_assigned: '（旧）设计派单',
  design_overdue: '（旧）设计超时',
  design_completed: '（旧）设计完成',
  record_closed: '（旧）流程关闭',
};

const TYPE_REASONS: Record<string, string> = {
  lead_created: '新线索创建，通知企业负责人',
  lead_assigned: '线索已派单，通知设计师或测量员',
  lead_assignment_pending: '暂无可用员工，催促负责人处理待派单',
  measurement_appointment_created: '上门量房预约已确认',
  measurement_appointment_rescheduled: '上门量房预约已改期',
  measurement_appointment_cancelled: '上门量房预约已取消',
  measurement_appointment_expired: '上门量房预约已过期',
  survey_completed: '正式量房完成，提醒设计师发布方案',
  design_published: '方案已对客户可见',
  signing_commission: '签单成功，通知推荐人提成入账',
  lead_converted: '签单成功，通知企业负责人',
  enterprise_join_result: '平台审核企业入驻申请结果',
  follow_up_created: '旧报备流程通知，已停发',
  follow_up_overdue: '旧报备流程通知，已停发',
  conflict_pending: '旧报备流程通知，已停发',
  measure_assigned: '旧报备流程通知，已停发',
  measure_overdue: '旧报备流程通知，已停发',
  measure_submitted: '旧报备流程通知，已停发',
  design_assigned: '旧报备流程通知，已停发',
  design_overdue: '旧报备流程通知，已停发',
  design_completed: '旧报备流程通知，已停发',
  record_closed: '旧报备流程通知，已停发',
};

const CHANNEL_LABELS: Record<string, string> = {
  station: '站内提醒',
  miniprogram_sub: '微信订阅消息',
};

const ROLE_LABELS: Record<string, string> = {
  salesperson: '业务员',
  measurer: '测量员',
  designer: '设计师',
  enterprise_admin: '企业负责人',
  admin: '平台管理员',
  super_admin: '超级管理员',
};

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '-';
}

function enterpriseName(log: WorkflowLog) {
  return log.recordId && typeof log.recordId !== 'string'
    ? log.recordId.enterpriseName || '未关联企业'
    : '未关联企业';
}

function contactPerson(log: WorkflowLog) {
  return log.recordId && typeof log.recordId !== 'string'
    ? log.recordId.contactPerson || '无联系人'
    : '无联系人';
}

function recipientStaff(log: WorkflowLog) {
  return log.recipientStaffId && typeof log.recipientStaffId !== 'string'
    ? log.recipientStaffId
    : null;
}

function recipientDisplayName(log: WorkflowLog) {
  const staff = recipientStaff(log);
  return staff?.displayName || staff?.username || log.recipientRole || '未指定接收人';
}

function recipientUsername(log: WorkflowLog) {
  return recipientStaff(log)?.username || '-';
}

function recipientPhone(log: WorkflowLog) {
  const phone = recipientStaff(log)?.phone;
  return phone && String(phone).trim() ? String(phone).trim() : '未登记电话';
}

function recipientRoleLabel(log: WorkflowLog) {
  const role = recipientStaff(log)?.role || log.recipientRole || '';
  return ROLE_LABELS[role] || role || '未指定角色';
}

function channelLabel(log: WorkflowLog) {
  return CHANNEL_LABELS[String(log.channel || '')] || log.channel || '未知通道';
}

function sendReason(log: WorkflowLog) {
  return TYPE_REASONS[log.notificationType]
    || TYPE_LABELS[log.notificationType]
    || log.notificationType
    || '系统通知';
}

function deliveryNote(log: WorkflowLog) {
  if (log.errorMessage) return log.errorMessage;
  if (log.status === 'sent' && log.channel === 'station') {
    return '已写入站内提醒；不等于微信已送达';
  }
  if (log.status === 'sent' && log.channel === 'miniprogram_sub') {
    return '微信接口已接受；需用户此前授权对应模板';
  }
  return log.message || '-';
}

export default function WorkflowLogsPage() {
  const actionRef = useRef<ActionType>(null);
  const { user: currentUser } = useCurrentUser();
  const [stats, setStats] = useState<NotificationStats>({
    sent: 0,
    failed: 0,
    skipped: 0,
  });
  const [scanRunning, setScanRunning] = useState(false);
  const [notificationConfig, setNotificationConfig] = useState<NotificationConfigForm | null>(null);
  const [notificationConfigSaving, setNotificationConfigSaving] = useState(false);
  const [subscriptionToggleSaving, setSubscriptionToggleSaving] = useState(false);

  const canRunScan = Boolean(
    currentUser && ['super_admin', 'admin'].includes(currentUser.role),
  );

  const fetchNotificationConfig = useCallback(async () => {
    if (!canRunScan) return;
    try {
      const response = await fetch('/api/platform/notification-config');
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '读取小程序通知配置失败');
      }
      setNotificationConfig(result.data);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '读取小程序通知配置失败');
    }
  }, [canRunScan]);

  useEffect(() => {
    void fetchNotificationConfig();
  }, [fetchNotificationConfig]);

  const toggleSubscriptionMessages = async (enabled: boolean) => {
    if (!notificationConfig) return;
    setSubscriptionToggleSaving(true);
    try {
      const response = await fetch('/api/platform/notification-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionMessagesEnabled: enabled }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '更新微信订阅消息开关失败');
      }
      setNotificationConfig(result.data);
      notify.success(enabled ? '已启用微信订阅消息下发' : '已关闭微信订阅消息下发');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '更新微信订阅消息开关失败');
    } finally {
      setSubscriptionToggleSaving(false);
    }
  };

  const runReminderScan = async () => {
    setScanRunning(true);
    try {
      const response = await fetch('/api/automation/reminders/run', {
        method: 'POST',
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '提醒扫描执行失败');
      }
      notify.success(`预约过期扫描已执行，过期 ${result.data?.expiredAppointments || 0} 条`);
      await actionRef.current?.reload();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '提醒扫描执行失败');
    } finally {
      setScanRunning(false);
    }
  };

  const columns: ProColumns<WorkflowLog>[] = [
    {
      title: '发送状态',
      dataIndex: 'status',
      valueType: 'select',
      valueEnum: Object.fromEntries(
        STATUS_OPTIONS.map((option) => [option.value, option.label]),
      ),
      width: 140,
      render: (_, log) => {
        const status = STATUS_META[log.status];
        return (
          <Flex vertical gap={4}>
            <Tag color={status.color}>{status.label}</Tag>
            <Typography.Text type="secondary" className="text-xs">{channelLabel(log)}</Typography.Text>
          </Flex>
        );
      },
    },
    {
      title: '通知类型',
      dataIndex: 'notificationType',
      width: 140,
      hideInSearch: true,
      render: (_, log) => TYPE_LABELS[log.notificationType] || log.notificationType,
    },
    {
      title: '接收人',
      key: 'recipient',
      width: 220,
      hideInSearch: true,
      render: (_, log) => (
        <Flex vertical gap={2}>
          <Typography.Text strong ellipsis>{recipientDisplayName(log)}</Typography.Text>
          <Typography.Text type="secondary" className="text-xs" ellipsis>
            用户名：{recipientUsername(log)}
          </Typography.Text>
          <Typography.Text type="secondary" className="text-xs" ellipsis>
            电话：{recipientPhone(log)}
          </Typography.Text>
          <Typography.Text type="secondary" className="text-xs">{recipientRoleLabel(log)}</Typography.Text>
        </Flex>
      ),
    },
    {
      title: '发送原因',
      key: 'reason',
      width: 260,
      hideInSearch: true,
      render: (_, log) => (
        <Typography.Text ellipsis={{ tooltip: sendReason(log) }}>
          {sendReason(log)}
        </Typography.Text>
      ),
    },
    {
      title: '结果说明',
      key: 'deliveryNote',
      width: 280,
      hideInSearch: true,
      render: (_, log) => (
        <Typography.Text
          type={log.status === 'failed' ? 'danger' : 'secondary'}
          ellipsis={{ tooltip: deliveryNote(log) }}
        >
          {deliveryNote(log)}
        </Typography.Text>
      ),
    },
    {
      title: '企业 / 报备',
      key: 'business',
      width: 200,
      hideInSearch: true,
      render: (_, log) => (
        <Flex vertical gap={2}>
          <Typography.Text strong ellipsis>{enterpriseName(log)}</Typography.Text>
          <Typography.Text type="secondary" className="text-xs" ellipsis>{contactPerson(log)}</Typography.Text>
        </Flex>
      ),
    },
    {
      title: '发送时间',
      dataIndex: 'createdAt',
      width: 185,
      hideInSearch: true,
      render: (_, log) => formatDate(log.sentAt || log.createdAt),
    },
  ];

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="通知记录"
        content="查看小程序订阅与站内提醒结果。现行仅保留推荐网络服务阶段通知；旧企业报备催办已停发。"
        extra={canRunScan ? [
          <Button
            key="scan"
            type="primary"
            icon={<PlayCircle size={16} />}
            loading={scanRunning}
            onClick={() => void runReminderScan()}
          >
            执行预约过期扫描
          </Button>,
        ] : undefined}
      >
        <div className="flex flex-col gap-8">
          {canRunScan ? (
            <Card title="小程序订阅消息模板" className="admin-panel-card">
              <Flex vertical gap={16}>
                <Flex align="flex-start" justify="space-between" gap={16} wrap="wrap">
                  <div>
                    <Typography.Text strong>启用微信订阅消息下发</Typography.Text>
                    <Typography.Paragraph type="secondary" className="!mb-0 !mt-1">
                      关闭后业务仍成功，仅跳过微信推送；小程序端已去掉授权引导。站内
                      <Typography.Text code>staff_notifications</Typography.Text>
                      与工作台徽标不受影响。
                    </Typography.Paragraph>
                  </div>
                  <Switch
                    checked={Boolean(notificationConfig?.subscriptionMessagesEnabled)}
                    loading={subscriptionToggleSaving || !notificationConfig}
                    disabled={!notificationConfig}
                    onChange={(checked) => void toggleSubscriptionMessages(checked)}
                  />
                </Flex>
                <Typography.Paragraph type="secondary" className="!mb-0">
                  八个模板用于服务端按通知类型选择并只发送其允许的关键词字段；模板 ID 可在此维护，是否实际下发由上方开关控制。
                </Typography.Paragraph>
                <Alert
                  type="info"
                  showIcon
                  message="保存后立即生效"
                  description="开关关闭时 sendSubscriptionMessage 直接跳过微信接口；模板 ID 变更会在下次启用下发时生效。此前已授权的用户仍受微信规则约束。"
                />
                {notificationConfig ? (
                  <ProForm<NotificationConfigForm>
                    key={TEMPLATE_FIELDS.map(({ kind }) => notificationConfig.templates[kind].templateId).join(':')}
                    layout="vertical"
                    initialValues={notificationConfig}
                    onFinish={async (values) => {
                      setNotificationConfigSaving(true);
                      try {
                        const response = await fetch('/api/platform/notification-config', {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            ...values,
                            subscriptionMessagesEnabled:
                              notificationConfig.subscriptionMessagesEnabled,
                          }),
                        });
                        const result = await response.json();
                        if (!response.ok || !result.success) throw new Error(result.error || '保存小程序通知配置失败');
                        setNotificationConfig(result.data);
                        notify.success('小程序订阅消息模板已保存');
                        return true;
                      } catch (error) {
                        notify.error(error instanceof Error ? error.message : '保存小程序通知配置失败');
                        return false;
                      } finally {
                        setNotificationConfigSaving(false);
                      }
                    }}
                    submitter={{
                      searchConfig: { submitText: '保存模板 ID' },
                      submitButtonProps: { loading: notificationConfigSaving },
                      render: (_, dom) => <Flex justify="end" gap={12}>{dom}</Flex>,
                    }}
                  >
                    <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
                      {TEMPLATE_FIELDS.map((field) => (
                        <ProFormText
                          key={field.kind}
                          name={['templates', field.kind, 'templateId']}
                          label={field.label}
                          tooltip={field.help}
                          extra={field.help}
                          rules={[
                            { required: true, message: `请填写${field.label}模板 ID` },
                            { pattern: /^[A-Za-z0-9_-]{10,128}$/, message: '模板 ID 格式不正确' },
                          ]}
                          fieldProps={{ autoComplete: 'off', className: 'w-full' }}
                        />
                      ))}
                    </div>
                  </ProForm>
                ) : null}
              </Flex>
            </Card>
          ) : null}
          <section aria-label="通知送达概览" className="flex flex-col gap-4">
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
              <div>
                <Typography.Title level={4} className="!mb-1">送达概览</Typography.Title>
                <Typography.Text type="secondary">统计会随当前筛选和分页请求同步更新。</Typography.Text>
              </div>
              <Tag color={stats.failed ? 'error' : 'success'}>{stats.failed ? `${stats.failed} 条待处理失败` : '当前无发送失败'}</Tag>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Card className="admin-panel-card admin-overview-stat">
                <Flex justify="space-between" align="start" gap={16}>
                  <Statistic title="已发送" value={stats.sent} />
                  <span className="admin-overview-stat-icon"><CheckCircle2 size={19} /></span>
                </Flex>
                <Typography.Text type="secondary">本次查询范围内成功送达的提醒</Typography.Text>
              </Card>
              <Card className="admin-panel-card admin-overview-stat">
                <Flex justify="space-between" align="start" gap={16}>
                  <Statistic title="已跳过" value={stats.skipped} />
                  <span className="admin-overview-stat-icon !bg-muted !text-muted-foreground"><CircleOff size={19} /></span>
                </Flex>
                <Typography.Text type="secondary">被去重或规则过滤的提醒</Typography.Text>
              </Card>
              <Card className="admin-panel-card admin-overview-stat">
                <Flex justify="space-between" align="start" gap={16}>
                  <Statistic title="发送失败" value={stats.failed} />
                  <span className="admin-overview-stat-icon !bg-destructive/10 !text-destructive"><AlertTriangle size={19} /></span>
                </Flex>
                <Typography.Text type="secondary">请结合失败原因检查配置或接收对象</Typography.Text>
              </Card>
              <Card className="admin-panel-card admin-overview-stat">
                <Flex justify="space-between" align="start" gap={16}>
                  <Statistic title="日志总数" value={stats.sent + stats.skipped + stats.failed} />
                  <span className="admin-overview-stat-icon !bg-muted !text-muted-foreground"><ShieldAlert size={19} /></span>
                </Flex>
                <Typography.Text type="secondary">当前状态统计的合计</Typography.Text>
              </Card>
            </div>
          </section>

          <section className="flex flex-col gap-4" aria-labelledby="workflow-log-table-title">
            <div>
              <Typography.Title id="workflow-log-table-title" level={4} className="!mb-1">通知明细</Typography.Title>
              <Typography.Text type="secondary">按发送状态筛选；接收人含用户名与电话，发送原因与结果说明可区分站内提醒和微信订阅。</Typography.Text>
            </div>
            <ProTable<WorkflowLog>
              className="admin-data-table admin-mobile-filter-stack"
              actionRef={actionRef}
              rowKey="_id"
              columns={columns}
              search={{ labelWidth: 'auto', defaultCollapsed: false, span: 12 }}
              options={{ reload: true, density: true, setting: true }}
              pagination={{ defaultPageSize: 20, showSizeChanger: true }}
              scroll={{ x: 1420 }}
              request={async (params) => {
                const query = new URLSearchParams({
                  page: String(params.current || 1),
                  limit: String(params.pageSize || 20),
                });
                if (params.status) query.set('status', String(params.status));
                const response = await fetch(`/api/workflow-notification-logs?${query}`);
                const result = await response.json();
                if (!response.ok || !result.success) {
                  throw new Error(result.error || '读取通知记录失败');
                }
                setStats({
                  sent: Number(result.stats?.sent || 0),
                  failed: Number(result.stats?.failed || 0),
                  skipped: Number(result.stats?.skipped || 0),
                });
                return {
                  data: result.data || [],
                  total: result.pagination?.total || 0,
                  success: true,
                };
              }}
              onRequestError={(error) => notify.error(error instanceof Error ? error.message : '读取通知记录失败')}
            />
          </section>
        </div>
      </PageContainer>
    </div>
  );
}
