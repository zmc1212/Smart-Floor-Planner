'use client';

import type { ReactNode } from 'react';
import { Card, Flex, Tag, Typography } from 'antd';
import { Bell, Smartphone, Sparkles, Workflow } from 'lucide-react';
import { EnterpriseListItem } from './types';

interface EnterpriseOverviewCardsProps {
  enterprise: EnterpriseListItem;
}

function SummaryRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <Flex justify="space-between" align="center" gap={16}>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Typography.Text strong>{value}</Typography.Text>
    </Flex>
  );
}

export default function EnterpriseOverviewCards({ enterprise }: EnterpriseOverviewCardsProps) {
  const browserNotificationEnabled = enterprise.automationConfig?.browserNotificationEnabled !== false;
  const miniprogramNotificationEnabled = enterprise.automationConfig?.miniprogramNotificationEnabled !== false;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card title="AI 摘要" extra={<Sparkles className="text-primary" size={18} />} className="admin-panel-card">
        <Flex vertical gap={16}>
          <SummaryRow label="供应商模式" value={<Tag color="green">平台统一路由</Tag>} />
          <SummaryRow label="计费单位" value="AI 点数" />
          <SummaryRow label="点数范围" value="后台与小程序共享" />
          <SummaryRow label="管理入口" value="企业 AI 管理" />
        </Flex>
      </Card>

      <Card title="自动化配置" extra={<Workflow className="text-amber-600" size={18} />} className="admin-panel-card">
        <Flex vertical gap={16}>
          <SummaryRow label="跟进 SLA" value={`${enterprise.automationConfig?.followUpSlaHours || 24} 小时`} />
          <SummaryRow label="测量 SLA" value={`${enterprise.automationConfig?.measureTaskSlaHours || 48} 小时`} />
          <SummaryRow label="设计 SLA" value={`${enterprise.automationConfig?.designTaskSlaHours || 72} 小时`} />
          <SummaryRow label="提醒间隔" value={`${enterprise.automationConfig?.reminderIntervalHours || 24} 小时`} />
          <SummaryRow label="最多提醒次数" value={enterprise.automationConfig?.maxReminderTimes || 3} />
          <SummaryRow label={<span className="inline-flex items-center gap-2"><Bell size={14} />浏览器通知</span>} value={<Tag color={browserNotificationEnabled ? 'success' : 'default'}>{browserNotificationEnabled ? '已开启' : '已关闭'}</Tag>} />
          <SummaryRow label={<span className="inline-flex items-center gap-2"><Smartphone size={14} />微信小程序通知</span>} value={<Tag color={miniprogramNotificationEnabled ? 'success' : 'default'}>{miniprogramNotificationEnabled ? '已开启' : '已关闭'}</Tag>} />
        </Flex>
      </Card>
    </div>
  );
}
