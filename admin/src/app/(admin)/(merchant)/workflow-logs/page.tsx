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
import { Alert, Button, Card, Flex, Statistic, Tag, Typography } from 'antd';
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
  | 'measurement_appointment';

type NotificationConfigForm = {
  version: 2;
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
  { kind: 'workflow_todo', label: '装修待办提醒', help: '跟进、逾期、量房提交、设计完成及提成待结算等通用任务。' },
  { kind: 'lead_assignment', label: '客户指派成功通知', help: '量房师、设计师派单，以及客户交接待确认。' },
  { kind: 'new_lead', label: '新增客户成功通知', help: '新线索创建后通知企业负责人。' },
  { kind: 'measurement_appointment', label: '上门量房提醒', help: '仅配置和授权；独立预约功能上线前不会触发发送。' },
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
  follow_up_created: '新跟进提醒',
  follow_up_overdue: '跟进超时',
  conflict_pending: '报备冲突',
  measure_assigned: '测量派单',
  measure_overdue: '测量超时',
  measure_submitted: '测量完成',
  design_assigned: '设计派单',
  design_overdue: '设计超时',
  design_completed: '设计完成',
  record_closed: '流程关闭',
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

function recipientName(log: WorkflowLog) {
  return log.recipientStaffId && typeof log.recipientStaffId !== 'string'
    ? log.recipientStaffId.displayName || log.recipientRole || '系统角色待办'
    : log.recipientRole || '系统角色待办';
}

function logMessage(log: WorkflowLog) {
  const reason = log.metadata?.reason;
  return log.errorMessage || log.message || (typeof reason === 'string' ? reason : '') || '-';
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
      notify.success(`提醒扫描已执行，处理 ${result.data?.processed || 0} 条记录`);
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
      width: 130,
      render: (_, log) => {
        const status = STATUS_META[log.status];
        return <Tag color={status.color}>{status.label}</Tag>;
      },
    },
    {
      title: '通知类型',
      dataIndex: 'notificationType',
      width: 170,
      hideInSearch: true,
      render: (_, log) => TYPE_LABELS[log.notificationType] || log.notificationType,
    },
    {
      title: '企业 / 报备',
      key: 'business',
      width: 220,
      hideInSearch: true,
      render: (_, log) => (
        <Flex vertical gap={2}>
          <Typography.Text strong ellipsis>{enterpriseName(log)}</Typography.Text>
          <Typography.Text type="secondary" className="text-xs" ellipsis>{contactPerson(log)}</Typography.Text>
        </Flex>
      ),
    },
    {
      title: '接收对象',
      key: 'recipient',
      width: 190,
      hideInSearch: true,
      render: (_, log) => (
        <Flex vertical gap={2}>
          <Typography.Text>{recipientName(log)}</Typography.Text>
          <Typography.Text type="secondary" className="text-xs">{log.recipientRole || '未指定角色'}</Typography.Text>
        </Flex>
      ),
    },
    {
      title: '通知内容',
      key: 'message',
      width: 360,
      hideInSearch: true,
      render: (_, log) => (
        <Typography.Text type={log.status === 'failed' ? 'danger' : 'secondary'} ellipsis={{ tooltip: logMessage(log) }}>
          {logMessage(log)}
        </Typography.Text>
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
        content="查看系统自动发送的站内提醒和小程序订阅消息结果。"
        extra={canRunScan ? [
          <Button
            key="scan"
            type="primary"
            icon={<PlayCircle size={16} />}
            loading={scanRunning}
            onClick={() => void runReminderScan()}
          >
            执行提醒扫描
          </Button>,
        ] : undefined}
      >
        <div className="flex flex-col gap-8">
          {canRunScan ? (
            <Card title="小程序订阅消息模板" className="admin-panel-card">
              <Flex vertical gap={16}>
                <Typography.Paragraph type="secondary" className="!mb-0">
                  四个模板用于小程序聚合授权，服务端会按通知类型选择模板并只发送其允许的关键词字段。
                </Typography.Paragraph>
                <Alert
                  type="info"
                  showIcon
                  message="保存后立即生效"
                  description="已登录小程序会在下一次授权时获取四个模板；此前已授权的用户需要按微信规则重新授权。上门量房提醒当前只参与授权，尚未启用业务触发。"
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
                          body: JSON.stringify(values),
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
              <Typography.Text type="secondary">按发送状态筛选日志，并通过失败内容追踪待处理问题。</Typography.Text>
            </div>
            <ProTable<WorkflowLog>
              className="admin-data-table admin-mobile-filter-stack"
              actionRef={actionRef}
              rowKey="_id"
              columns={columns}
              search={{ labelWidth: 'auto', defaultCollapsed: false, span: 12 }}
              options={{ reload: true, density: true, setting: true }}
              pagination={{ defaultPageSize: 20, showSizeChanger: true }}
              scroll={{ x: 1120 }}
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
