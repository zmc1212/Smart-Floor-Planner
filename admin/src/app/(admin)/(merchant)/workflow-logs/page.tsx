'use client';

import { useRef, useState } from 'react';
import {
  PageContainer,
  ProTable,
  type ActionType,
  type ProColumns,
} from '@ant-design/pro-components';
import { Button, Card, Flex, Statistic, Tag, Typography } from 'antd';
import {
  AlertTriangle,
  CheckCircle2,
  CircleOff,
  PlayCircle,
  ShieldAlert,
} from 'lucide-react';
import { notify } from '@/components/ui/operation-feedback';
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

  const canRunScan = Boolean(
    currentUser && ['super_admin', 'admin'].includes(currentUser.role),
  );

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
        <Flex vertical gap={24}>
          <Flex gap={16} wrap="wrap">
            <Card className="admin-panel-card min-w-52 flex-1" size="small">
              <Flex justify="space-between" align="start">
                <Statistic title="已发送" value={stats.sent} />
                <CheckCircle2 size={20} className="text-primary" />
              </Flex>
              <Typography.Text type="secondary">本次查询范围内成功送达的提醒</Typography.Text>
            </Card>
            <Card className="admin-panel-card min-w-52 flex-1" size="small">
              <Flex justify="space-between" align="start">
                <Statistic title="已跳过" value={stats.skipped} />
                <CircleOff size={20} className="text-amber-500" />
              </Flex>
              <Typography.Text type="secondary">被去重或规则过滤的提醒</Typography.Text>
            </Card>
            <Card className="admin-panel-card min-w-52 flex-1" size="small">
              <Flex justify="space-between" align="start">
                <Statistic title="发送失败" value={stats.failed} valueStyle={{ color: '#cf1322' }} />
                <AlertTriangle size={20} className="text-destructive" />
              </Flex>
              <Typography.Text type="secondary">请结合失败原因检查配置或接收对象</Typography.Text>
            </Card>
            <Card className="admin-panel-card min-w-52 flex-1" size="small">
              <Flex justify="space-between" align="start">
                <Statistic title="日志总数" value={stats.sent + stats.skipped + stats.failed} />
                <ShieldAlert size={20} className="text-muted-foreground" />
              </Flex>
              <Typography.Text type="secondary">当前状态统计的合计</Typography.Text>
            </Card>
          </Flex>

          <ProTable<WorkflowLog>
            className="admin-mobile-filter-stack"
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
        </Flex>
      </PageContainer>
    </div>
  );
}
