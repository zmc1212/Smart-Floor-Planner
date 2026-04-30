'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EnterpriseListItem } from './types';
import { getWecomCompletionText, isEnterpriseWecomConfigured } from './enterprise-utils';

interface EnterpriseWecomManagerProps {
  enterprise: EnterpriseListItem;
  onSaved?: () => Promise<void> | void;
}

export default function EnterpriseWecomManager({
  enterprise,
  onSaved,
}: EnterpriseWecomManagerProps) {
  const [corpId, setCorpId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [secret, setSecret] = useState('');
  const [wecomReminderEnabled, setWecomReminderEnabled] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setCorpId(enterprise.wecomConfig?.corpId || '');
    setAgentId(enterprise.wecomConfig?.agentId || '');
    setSecret('');
    setWecomReminderEnabled(enterprise.automationConfig?.wecomReminderEnabled !== false);
  }, [enterprise]);

  const handleSave = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/enterprises/${enterprise._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wecomConfig: {
            corpId,
            agentId,
            secret,
          },
          automationConfig: {
            followUpSlaHours: enterprise.automationConfig?.followUpSlaHours || 24,
            measureTaskSlaHours: enterprise.automationConfig?.measureTaskSlaHours || 48,
            designTaskSlaHours: enterprise.automationConfig?.designTaskSlaHours || 72,
            reminderIntervalHours: enterprise.automationConfig?.reminderIntervalHours || 24,
            maxReminderTimes: enterprise.automationConfig?.maxReminderTimes || 3,
            wecomReminderEnabled,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || '企业微信配置保存失败');
        return;
      }
      alert('企业微信配置已更新');
      await onSaved?.();
    } catch (error) {
      console.error('Failed to save enterprise wecom config:', error);
      alert('企业微信配置保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="rounded-3xl border-muted shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
          <CardTitle className="text-base">企业微信应用配置</CardTitle>
          <Badge variant="secondary">{isEnterpriseWecomConfigured(enterprise) ? '已配置' : '未配置'}</Badge>
        </CardHeader>
        <CardContent className="space-y-4 p-6 pt-2">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="wecom-page-corp-id">CorpID</Label>
              <Input
                id="wecom-page-corp-id"
                value={corpId}
                onChange={(e) => setCorpId(e.target.value)}
                placeholder="wwxxxxxxxxxxxxxxxx"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wecom-page-agent-id">AgentID</Label>
              <Input
                id="wecom-page-agent-id"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                placeholder="1000002"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="wecom-page-secret">Secret</Label>
            <Input
              id="wecom-page-secret"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={enterprise.wecomSecretConfigured ? '留空表示保留当前 Secret' : '企业微信应用 Secret'}
            />
            <p className="text-xs text-muted-foreground">
              {enterprise.wecomSecretConfigured
                ? '当前企业已保存 Secret；本次不填写则保持不变。'
                : '首次配置需要同时填写 CorpID、AgentID 与 Secret。'}
            </p>
          </div>
          <label className="flex items-center gap-3 rounded-xl border px-4 py-3 text-sm">
            <input
              type="checkbox"
              checked={wecomReminderEnabled}
              onChange={(e) => setWecomReminderEnabled(e.target.checked)}
            />
            启用企业微信催办
          </label>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={loading}>
              {loading ? '保存中...' : '保存企业微信配置'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-muted shadow-sm">
        <CardHeader className="p-6 pb-2">
          <CardTitle className="text-base">配置完成度</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-6 pt-2 text-sm text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>企业应用配置</span>
            <span className="font-semibold text-foreground">
              {isEnterpriseWecomConfigured(enterprise) ? '已补齐' : '未补齐'}
            </span>
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
          <div className="rounded-2xl border border-dashed px-4 py-3 text-xs">
            地推员、测量员、设计师、企业负责人都需要在员工管理页补齐企业微信接收 ID，催办消息才会真正送达。
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
