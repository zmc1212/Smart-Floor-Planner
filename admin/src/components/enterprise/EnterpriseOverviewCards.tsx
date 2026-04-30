'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Shield, Workflow } from 'lucide-react';
import { EnterpriseListItem } from './types';
import { formatAiKeyStatus, getWecomCompletionText, isEnterpriseWecomConfigured } from './enterprise-utils';

interface EnterpriseOverviewCardsProps {
  enterprise: EnterpriseListItem;
}

export default function EnterpriseOverviewCards({
  enterprise,
}: EnterpriseOverviewCardsProps) {
  const aiStatus = formatAiKeyStatus(enterprise);
  const aiSummary = enterprise.aiUsageSnapshot?.summary?.today;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <Card className="rounded-3xl border-muted shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
          <CardTitle className="text-base">AI 摘要</CardTitle>
          <Sparkles className="text-emerald-600" size={18} />
        </CardHeader>
        <CardContent className="space-y-3 p-6 pt-2 text-sm text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>Key 状态</span>
            <Badge variant="secondary">{aiStatus}</Badge>
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
          <CardTitle className="text-base">企业微信</CardTitle>
          <Shield className="text-blue-600" size={18} />
        </CardHeader>
        <CardContent className="space-y-3 p-6 pt-2 text-sm text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>应用配置</span>
            <Badge variant="secondary">{isEnterpriseWecomConfigured(enterprise) ? '已配置' : '未配置'}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span>Secret</span>
            <span className="font-semibold text-foreground">
              {enterprise.wecomSecretConfigured ? '已保存' : '未保存'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>员工接收 ID 完成度</span>
            <span className="font-semibold text-foreground">{getWecomCompletionText(enterprise)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>CorpID / AgentID</span>
            <span className="font-semibold text-foreground">
              {enterprise.wecomConfig?.corpId && enterprise.wecomConfig?.agentId ? '已配置' : '未补齐'}
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
            <span>企微催办</span>
            <Badge variant="secondary">
              {enterprise.automationConfig?.wecomReminderEnabled === false ? '关闭' : '开启'}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
