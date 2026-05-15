'use client';

import { notify } from '@/components/ui/operation-feedback';

import { useState } from 'react';
import { Bell, Clock3, Loader2, Save, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EnterpriseListItem } from './types';

interface EnterpriseAutomationManagerProps {
  enterprise: EnterpriseListItem;
  onRefresh?: () => Promise<void> | void;
}

interface AutomationFormState {
  followUpSlaHours: string;
  measureTaskSlaHours: string;
  designTaskSlaHours: string;
  reminderIntervalHours: string;
  maxReminderTimes: string;
  browserNotificationEnabled: boolean;
  miniprogramNotificationEnabled: boolean;
}

function buildAutomationForm(enterprise: EnterpriseListItem): AutomationFormState {
  return {
    followUpSlaHours: String(enterprise.automationConfig?.followUpSlaHours ?? 24),
    measureTaskSlaHours: String(enterprise.automationConfig?.measureTaskSlaHours ?? 48),
    designTaskSlaHours: String(enterprise.automationConfig?.designTaskSlaHours ?? 72),
    reminderIntervalHours: String(enterprise.automationConfig?.reminderIntervalHours ?? 24),
    maxReminderTimes: String(enterprise.automationConfig?.maxReminderTimes ?? 3),
    browserNotificationEnabled: enterprise.automationConfig?.browserNotificationEnabled !== false,
    miniprogramNotificationEnabled: enterprise.automationConfig?.miniprogramNotificationEnabled !== false,
  };
}

function enabledLabel(enabled: boolean) {
  return enabled ? '已开启' : '已关闭';
}

export default function EnterpriseAutomationManager({
  enterprise,
  onRefresh,
}: EnterpriseAutomationManagerProps) {
  const [formData, setFormData] = useState<AutomationFormState>(() => buildAutomationForm(enterprise));
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateField = <Key extends keyof AutomationFormState>(
    key: Key,
    value: AutomationFormState[Key]
  ) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/admin/enterprises/${enterprise._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          automationConfig: {
            followUpSlaHours: formData.followUpSlaHours,
            measureTaskSlaHours: formData.measureTaskSlaHours,
            designTaskSlaHours: formData.designTaskSlaHours,
            reminderIntervalHours: formData.reminderIntervalHours,
            maxReminderTimes: formData.maxReminderTimes,
            browserNotificationEnabled: formData.browserNotificationEnabled,
            miniprogramNotificationEnabled: formData.miniprogramNotificationEnabled,
          },
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        notify.fromAlert(data.error || '保存自动化配置失败');
        return;
      }

      notify.fromAlert('自动化配置已保存');
      await onRefresh?.();
    } catch (error) {
      console.error('Failed to save enterprise automation config:', error);
      notify.fromAlert('保存自动化配置失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
      <Card className="rounded-3xl border-muted shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
          <CardTitle>通知渠道</CardTitle>
          <Bell className="text-amber-600" size={18} />
        </CardHeader>
        <CardContent className="space-y-4 p-6 pt-2">
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border bg-muted/20 p-4">
            <div className="flex items-center gap-3">
              <Bell size={18} className="text-amber-600" />
              <div>
                <div className="text-sm font-semibold text-foreground">浏览器通知</div>
                <div className="text-xs text-muted-foreground">只控制后台浏览器系统弹窗，不影响站内通知记录。</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-foreground">
                {enabledLabel(formData.browserNotificationEnabled)}
              </span>
              <input
                type="checkbox"
                checked={formData.browserNotificationEnabled}
                onChange={(event) => updateField('browserNotificationEnabled', event.target.checked)}
                className="h-5 w-5 accent-primary"
              />
            </div>
          </label>

          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border bg-muted/20 p-4">
            <div className="flex items-center gap-3">
              <Smartphone size={18} className="text-emerald-600" />
              <div>
                <div className="text-sm font-semibold text-foreground">微信小程序通知</div>
                <div className="text-xs text-muted-foreground">控制微信订阅消息发送；关闭后会记录跳过日志。</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-foreground">
                {enabledLabel(formData.miniprogramNotificationEnabled)}
              </span>
              <input
                type="checkbox"
                checked={formData.miniprogramNotificationEnabled}
                onChange={(event) => updateField('miniprogramNotificationEnabled', event.target.checked)}
                className="h-5 w-5 accent-primary"
              />
            </div>
          </label>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-muted shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
          <CardTitle>SLA 与催办规则</CardTitle>
          <Clock3 className="text-zinc-500" size={18} />
        </CardHeader>
        <CardContent className="grid gap-4 p-6 pt-2 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="automation-followup-sla">跟进 SLA（小时）</Label>
            <Input
              id="automation-followup-sla"
              type="number"
              min="1"
              value={formData.followUpSlaHours}
              onChange={(event) => updateField('followUpSlaHours', event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="automation-measure-sla">测量任务 SLA（小时）</Label>
            <Input
              id="automation-measure-sla"
              type="number"
              min="1"
              value={formData.measureTaskSlaHours}
              onChange={(event) => updateField('measureTaskSlaHours', event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="automation-design-sla">设计任务 SLA（小时）</Label>
            <Input
              id="automation-design-sla"
              type="number"
              min="1"
              value={formData.designTaskSlaHours}
              onChange={(event) => updateField('designTaskSlaHours', event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="automation-reminder-interval">超时提醒间隔（小时）</Label>
            <Input
              id="automation-reminder-interval"
              type="number"
              min="1"
              value={formData.reminderIntervalHours}
              onChange={(event) => updateField('reminderIntervalHours', event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="automation-max-reminders">最多提醒次数</Label>
            <Input
              id="automation-max-reminders"
              type="number"
              min="1"
              value={formData.maxReminderTimes}
              onChange={(event) => updateField('maxReminderTimes', event.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end lg:col-span-2">
        <Button onClick={handleSave} disabled={isSubmitting} className="min-w-36">
          {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
          保存配置
        </Button>
      </div>
    </div>
  );
}
