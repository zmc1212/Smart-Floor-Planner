'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  DEFAULT_ENTERPRISE_FORM,
  EnterpriseFormState,
  EnterpriseListItem,
} from './types';

interface EnterpriseEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enterprise?: EnterpriseListItem | null;
  onSaved?: () => Promise<void> | void;
}

async function toBase64(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
}

export default function EnterpriseEditorDialog({
  open,
  onOpenChange,
  enterprise,
  onSaved,
}: EnterpriseEditorDialogProps) {
  const [formData, setFormData] = useState<EnterpriseFormState>(DEFAULT_ENTERPRISE_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!enterprise) {
      setFormData(DEFAULT_ENTERPRISE_FORM);
      return;
    }

    setFormData({
      name: enterprise.name || '',
      code: enterprise.code || '',
      contactPerson: {
        name: enterprise.contactPerson?.name || '',
        phone: enterprise.contactPerson?.phone || '',
        email: enterprise.contactPerson?.email || '',
      },
      logo: enterprise.logo || '',
      branding: {
        primaryColor: enterprise.branding?.primaryColor || '#171717',
        accentColor: enterprise.branding?.accentColor || '#0070f3',
      },
      groundPromotionFixedCommission: String(enterprise.groundPromotionFixedCommission ?? 0),
      automationConfig: {
        followUpSlaHours: String(enterprise.automationConfig?.followUpSlaHours ?? 24),
        measureTaskSlaHours: String(enterprise.automationConfig?.measureTaskSlaHours ?? 48),
        designTaskSlaHours: String(enterprise.automationConfig?.designTaskSlaHours ?? 72),
        reminderIntervalHours: String(enterprise.automationConfig?.reminderIntervalHours ?? 24),
        maxReminderTimes: String(enterprise.automationConfig?.maxReminderTimes ?? 3),
        wecomReminderEnabled: enterprise.automationConfig?.wecomReminderEnabled !== false,
      },
    });
  }, [enterprise, open]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      alert('图片大小不能超过 1MB');
      return;
    }

    try {
      const base64 = await toBase64(file);
      setFormData((prev) => ({ ...prev, logo: base64 }));
    } catch (error) {
      console.error('Failed to convert image to base64:', error);
      alert('图片上传失败');
    }
  };

  const removeLogo = () => {
    setFormData((prev) => ({ ...prev, logo: '' }));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const url = enterprise ? `/api/admin/enterprises/${enterprise._id}` : '/api/admin/enterprises';
      const method = enterprise ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        alert(data.error || '保存失败');
        return;
      }

      alert(enterprise ? '企业更新成功' : '企业创建成功');
      onOpenChange(false);
      await onSaved?.();
    } catch (error) {
      console.error('Failed to save enterprise:', error);
      alert('保存失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl overflow-hidden rounded-3xl p-0 shadow-2xl">
        <form onSubmit={handleSave}>
          <DialogHeader className="border-b p-8 pb-6">
            <DialogTitle className="text-2xl font-bold">
              {enterprise ? '编辑企业基础信息' : '手动添加企业'}
            </DialogTitle>
            <DialogDescription>
              这里只维护基础资料、品牌信息、联系人与自动化参数；AI 与企业微信配置已迁移到独立页面。
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[72vh] space-y-6 overflow-y-auto p-8">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="ent-name">企业名称</Label>
                <Input
                  id="ent-name"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="例如：向总智能测绘科技有限公司"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ent-code">统一社会信用代码</Label>
                <Input
                  id="ent-code"
                  required
                  value={formData.code}
                  onChange={(e) => setFormData((prev) => ({ ...prev, code: e.target.value }))}
                  placeholder="18 位统一社会信用代码"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ent-commission">地推固定提成（元/单）</Label>
                <Input
                  id="ent-commission"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.groundPromotionFixedCommission}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, groundPromotionFixedCommission: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="space-y-4 border-t pt-4">
              <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                协作自动化配置
              </h4>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="followup-sla">跟进 SLA（小时）</Label>
                  <Input
                    id="followup-sla"
                    type="number"
                    min="1"
                    value={formData.automationConfig.followUpSlaHours}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        automationConfig: { ...prev.automationConfig, followUpSlaHours: e.target.value },
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="measure-sla">测量任务 SLA（小时）</Label>
                  <Input
                    id="measure-sla"
                    type="number"
                    min="1"
                    value={formData.automationConfig.measureTaskSlaHours}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        automationConfig: { ...prev.automationConfig, measureTaskSlaHours: e.target.value },
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="design-sla">设计任务 SLA（小时）</Label>
                  <Input
                    id="design-sla"
                    type="number"
                    min="1"
                    value={formData.automationConfig.designTaskSlaHours}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        automationConfig: { ...prev.automationConfig, designTaskSlaHours: e.target.value },
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="remind-interval">超时提醒间隔（小时）</Label>
                  <Input
                    id="remind-interval"
                    type="number"
                    min="1"
                    value={formData.automationConfig.reminderIntervalHours}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        automationConfig: { ...prev.automationConfig, reminderIntervalHours: e.target.value },
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max-reminders">最多提醒次数</Label>
                  <Input
                    id="max-reminders"
                    type="number"
                    min="1"
                    value={formData.automationConfig.maxReminderTimes}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        automationConfig: { ...prev.automationConfig, maxReminderTimes: e.target.value },
                      }))
                    }
                  />
                </div>
                <label className="flex items-center gap-3 rounded-xl border px-4 py-3 text-sm">
                  <input
                    type="checkbox"
                    checked={formData.automationConfig.wecomReminderEnabled}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        automationConfig: {
                          ...prev.automationConfig,
                          wecomReminderEnabled: e.target.checked,
                        },
                      }))
                    }
                  />
                  启用企业微信催办
                </label>
              </div>
            </div>

            <div className="space-y-4 border-t pt-4">
              <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                品牌定制
              </h4>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="ent-logo">企业 Logo</Label>
                  <div className="flex items-start gap-4">
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className={cn(
                        'flex h-24 w-24 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed bg-muted/20 transition-colors',
                        formData.logo ? 'border-primary/20' : 'hover:border-primary/50 hover:bg-muted/30'
                      )}
                    >
                      {formData.logo ? (
                        <div className="relative h-full w-full group">
                          <img src={formData.logo} alt="Logo Preview" className="h-full w-full object-contain" />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                            <Upload size={20} className="text-white" />
                          </div>
                        </div>
                      ) : (
                        <>
                          <ImageIcon size={24} className="mb-1 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground">点击上传</span>
                        </>
                      )}
                    </div>
                    <div className="flex-1 space-y-2">
                      <p className="text-[11px] text-muted-foreground">
                        支持 PNG、JPG。建议正方形 Logo，图片会以 Base64 存储，大小限制 1MB。
                      </p>
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                          选择图片
                        </Button>
                        {formData.logo && (
                          <Button type="button" variant="ghost" size="sm" onClick={removeLogo} className="text-destructive">
                            移除
                          </Button>
                        )}
                      </div>
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        accept="image/*"
                        className="hidden"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="primary-color">主色</Label>
                    <div className="flex gap-2">
                      <div className="h-10 w-10 shrink-0 rounded-lg border" style={{ backgroundColor: formData.branding.primaryColor }} />
                      <Input
                        id="primary-color"
                        value={formData.branding.primaryColor}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            branding: { ...prev.branding, primaryColor: e.target.value },
                          }))
                        }
                        placeholder="#171717"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="accent-color">强调色</Label>
                    <div className="flex gap-2">
                      <div className="h-10 w-10 shrink-0 rounded-lg border" style={{ backgroundColor: formData.branding.accentColor }} />
                      <Input
                        id="accent-color"
                        value={formData.branding.accentColor}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            branding: { ...prev.branding, accentColor: e.target.value },
                          }))
                        }
                        placeholder="#0070f3"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4 border-t pt-4">
              <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                联系人资料
              </h4>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="contact-name">姓名</Label>
                  <Input
                    id="contact-name"
                    required
                    value={formData.contactPerson.name}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        contactPerson: { ...prev.contactPerson, name: e.target.value },
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contact-phone">电话</Label>
                  <Input
                    id="contact-phone"
                    required
                    value={formData.contactPerson.phone}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        contactPerson: { ...prev.contactPerson, phone: e.target.value },
                      }))
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact-email">邮箱（可选）</Label>
                <Input
                  id="contact-email"
                  type="email"
                  value={formData.contactPerson.email}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      contactPerson: { ...prev.contactPerson, email: e.target.value },
                    }))
                  }
                />
              </div>
            </div>
          </div>

          <DialogFooter className="bg-muted/30 p-8 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting} className="flex-1">
              {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : '确认保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
