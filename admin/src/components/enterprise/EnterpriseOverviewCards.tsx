'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Bell, Smartphone, Sparkles, Workflow } from 'lucide-react';
import { EnterpriseListItem } from './types';

interface EnterpriseOverviewCardsProps {
  enterprise: EnterpriseListItem;
}

export default function EnterpriseOverviewCards({ enterprise }: EnterpriseOverviewCardsProps) {
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
            <span>供应商模式</span>
            <span className="inline-flex rounded-md bg-secondary px-2 py-1 text-secondary-foreground">
              平台统一路由
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>计费单位</span>
            <span className="font-semibold text-foreground">AI 点数</span>
          </div>
          <div className="flex items-center justify-between">
            <span>点数范围</span>
            <span className="font-semibold text-foreground">后台与小程序共享</span>
          </div>
          <div className="flex items-center justify-between">
            <span>管理入口</span>
            <span className="font-semibold text-foreground">企业 AI 管理</span>
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
