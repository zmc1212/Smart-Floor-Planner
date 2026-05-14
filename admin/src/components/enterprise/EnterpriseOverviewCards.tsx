'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Bell, Smartphone, Sparkles, Workflow } from 'lucide-react';
import { EnterpriseListItem } from './types';
import { formatAiKeyStatus } from './enterprise-utils';

interface EnterpriseOverviewCardsProps {
  enterprise: EnterpriseListItem;
}

export default function EnterpriseOverviewCards({ enterprise }: EnterpriseOverviewCardsProps) {
  const aiStatus = formatAiKeyStatus(enterprise);
  const aiSummary = enterprise.aiUsageSnapshot?.summary?.today;
  const browserNotificationEnabled = enterprise.automationConfig?.browserNotificationEnabled !== false;
  const miniprogramNotificationEnabled = enterprise.automationConfig?.miniprogramNotificationEnabled !== false;
  const formatEnabled = (enabled: boolean) => (enabled ? '已开启' : '已关闭');

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card className="rounded-3xl border-muted shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
          <CardTitle className="text-base">AI 摘要</CardTitle>
          <Sparkles className="text-emerald-600" size={18} />
        </CardHeader>
        <CardContent className="space-y-3 p-6 pt-2 text-sm text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>Key 状态</span>
            <span className="inline-flex rounded-md bg-secondary px-2 py-1 text-secondary-foreground">
              {aiStatus}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>官方余额</span>
            <span className="font-semibold text-foreground">
              {Number(enterprise.aiUsageSnapshot?.balance || 0).toFixed(2)} {enterprise.aiUsageSnapshot?.currency || 'USD'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>今日请求</span>
            <span className="font-semibold text-foreground">{aiSummary?.requests || 0}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>最近同步</span>
            <span className="font-semibold text-foreground">
              {enterprise.aiUsageSnapshot?.lastSyncedAt
                ? new Date(enterprise.aiUsageSnapshot.lastSyncedAt).toLocaleString()
                : '未同步'}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-muted shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
          <CardTitle className="text-base">自动化配置</CardTitle>
          <Workflow className="text-amber-600" size={18} />
        </CardHeader>
        <CardContent className="space-y-3 p-6 pt-2 text-sm text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>跟进 SLA</span>
            <span className="font-semibold text-foreground">{enterprise.automationConfig?.followUpSlaHours || 24} 小时</span>
          </div>
          <div className="flex items-center justify-between">
            <span>测量 SLA</span>
            <span className="font-semibold text-foreground">{enterprise.automationConfig?.measureTaskSlaHours || 48} 小时</span>
          </div>
          <div className="flex items-center justify-between">
            <span>设计 SLA</span>
            <span className="font-semibold text-foreground">{enterprise.automationConfig?.designTaskSlaHours || 72} 小时</span>
          </div>
          <div className="flex items-center justify-between">
            <span>提醒间隔</span>
            <span className="font-semibold text-foreground">{enterprise.automationConfig?.reminderIntervalHours || 24} 小时</span>
          </div>
          <div className="flex items-center justify-between">
            <span>最多提醒次数</span>
            <span className="font-semibold text-foreground">{enterprise.automationConfig?.maxReminderTimes || 3}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2">
              <Bell size={14} />
              浏览器通知
            </span>
            <span className="font-semibold text-foreground">{formatEnabled(browserNotificationEnabled)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2">
              <Smartphone size={14} />
              微信小程序通知
            </span>
            <span className="font-semibold text-foreground">{formatEnabled(miniprogramNotificationEnabled)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
