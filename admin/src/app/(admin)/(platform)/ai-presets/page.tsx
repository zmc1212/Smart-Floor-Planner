'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Save, Settings2, Sparkles } from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFetch } from '@/hooks/useFetch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type AiPresetType = 'floor_plan_style' | 'furnishing_style';
type ImageQuality = 'standard' | 'hd' | 'low' | 'medium' | 'high';
type ImageMode = 'generation' | 'edit';

interface AiPreset {
  _id: string;
  key: string;
  type: AiPresetType;
  name: string;
  description: string;
  icon: string;
  previewClassName: string;
  mockImageUrl?: string;
  promptTemplate: string;
  negativePrompt: string;
  enabled: boolean;
  sortOrder: number;
  image: {
    model: string;
    size: string;
    quality: ImageQuality;
    mode: ImageMode;
  };
}

const PRESET_TABS: Array<{ type: AiPresetType; label: string; hint: string }> = [
  { type: 'floor_plan_style', label: 'AI 室内平面', hint: '3D / 彩平 / CAD / 手绘' },
  { type: 'furnishing_style', label: 'AI 风格设计', hint: '现代 / 北欧 / 奶油 / 轻奢 / 新中式' },
];

const QUALITY_OPTIONS: ImageQuality[] = ['low', 'medium', 'high', 'standard', 'hd'];
const MODE_OPTIONS: ImageMode[] = ['edit', 'generation'];

function toNumber(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function AiPresetsPage() {
  const { user, isLoading: loadingUser } = useCurrentUser();
  const canManage = user?.role === 'super_admin' || user?.role === 'admin';
  const [activeType, setActiveType] = useState<AiPresetType>('floor_plan_style');
  const { data, isLoading, mutate } = useFetch<AiPreset[]>(
    `/api/ai/presets?type=${activeType}&includeDisabled=true`
  );
  const presets = useMemo(() => data || [], [data]);

  const [editingPreset, setEditingPreset] = useState<AiPreset | null>(null);
  const [form, setForm] = useState<AiPreset | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(editingPreset ? JSON.parse(JSON.stringify(editingPreset)) as AiPreset : null);
  }, [editingPreset]);

  const sortedPresets = useMemo(
    () => [...presets].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [presets]
  );

  const updateField = (field: keyof AiPreset, value: string | boolean | number) => {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const updateImageField = (field: keyof AiPreset['image'], value: string) => {
    setForm((prev) => (prev ? { ...prev, image: { ...prev.image, [field]: value } } : prev));
  };

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/ai/presets/${form._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          icon: form.icon,
          previewClassName: form.previewClassName,
          mockImageUrl: form.mockImageUrl,
          promptTemplate: form.promptTemplate,
          negativePrompt: form.negativePrompt,
          enabled: form.enabled,
          sortOrder: form.sortOrder,
          image: form.image,
        }),
      });
      const result = await res.json();
      if (!result.success) {
        alert(result.error || '保存失败');
        return;
      }

      await mutate();
      setEditingPreset(null);
    } catch (error) {
      console.error(error);
      alert('保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loadingUser || (isLoading && presets.length === 0)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="rounded-2xl border bg-white p-10 shadow-sm">
          <h1 className="mb-2 text-2xl font-bold">AI 预设配置</h1>
          <p className="text-sm text-muted-foreground">只有 admin / super_admin 可以配置 AI 风格预设。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-[#171717]">
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-8">
          <div className="mb-2 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
              <Settings2 size={20} />
            </div>
            <h1 className="text-[28px] font-bold tracking-tight">AI 预设配置</h1>
            <Badge variant="secondary" className="border-none bg-violet-50 text-violet-700">
              Admin Only
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            统一维护 Pollinations 风格预设，包括 prompt 模板、负向提示词和图片生成配置。
          </p>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2">
          {PRESET_TABS.map((tab) => (
            <button
              key={tab.type}
              type="button"
              onClick={() => setActiveType(tab.type)}
              className={cn(
                'rounded-2xl border p-4 text-left transition-all',
                activeType === tab.type ? 'border-violet-500 bg-violet-50 shadow-sm' : 'hover:border-zinc-300'
              )}
            >
              <div className="font-bold">{tab.label}</div>
              <div className="mt-1 text-sm text-muted-foreground">{tab.hint}</div>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {sortedPresets.map((preset) => (
            <div key={preset._id} className="rounded-2xl border bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div
                    className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${preset.previewClassName} text-sm font-bold text-white`}
                  >
                    {preset.icon || 'AI'}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold">{preset.name}</h2>
                      {!preset.enabled && <Badge variant="outline">已停用</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">{preset.description}</p>
                  </div>
                </div>
                <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setEditingPreset(preset)}>
                  编辑
                </Button>
              </div>

              <div className="space-y-2 text-sm text-muted-foreground">
                <div>
                  Key: <span className="font-mono text-foreground">{preset.key}</span>
                </div>
                <div>
                  Type: <span className="font-mono text-foreground">{preset.type}</span>
                </div>
                <div>
                  Model: <span className="font-mono text-foreground">{preset.image.model}</span>
                </div>
                <div>
                  Output: <span className="font-mono text-foreground">{preset.image.size} / {preset.image.quality}</span>
                </div>
                <div>
                  Mode: <span className="font-mono text-foreground">{preset.image.mode}</span>
                </div>
                <div>
                  Mock 图: <span className="font-mono text-foreground">{preset.mockImageUrl || '未配置'}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <Dialog open={!!editingPreset} onOpenChange={(open) => !open && setEditingPreset(null)}>
          <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto rounded-3xl border-none p-0 shadow-2xl">
            <DialogHeader className="border-b bg-muted/20 p-8 pb-4">
              <DialogTitle className="flex items-center gap-2 text-2xl font-bold">
                <Sparkles size={20} />
                编辑 AI 预设
              </DialogTitle>
              <DialogDescription>修改后会影响对应菜单的 Pollinations 参数和 MOCK 模式图片。</DialogDescription>
            </DialogHeader>

            {form && (
              <div className="grid grid-cols-1 gap-6 p-8 lg:grid-cols-2">
                <div className="space-y-4">
                  <label className="block text-sm font-medium">
                    名称
                    <input className="mt-2 w-full rounded-xl border px-3 py-2" value={form.name} onChange={(e) => updateField('name', e.target.value)} />
                  </label>
                  <label className="block text-sm font-medium">
                    描述
                    <input className="mt-2 w-full rounded-xl border px-3 py-2" value={form.description} onChange={(e) => updateField('description', e.target.value)} />
                  </label>
                  <label className="block text-sm font-medium">
                    图标简称
                    <input className="mt-2 w-full rounded-xl border px-3 py-2" value={form.icon} onChange={(e) => updateField('icon', e.target.value)} />
                  </label>
                  <label className="block text-sm font-medium">
                    渐变 class
                    <input className="mt-2 w-full rounded-xl border px-3 py-2 font-mono text-xs" value={form.previewClassName} onChange={(e) => updateField('previewClassName', e.target.value)} />
                  </label>
                  <label className="block text-sm font-medium">
                    Mock 图地址
                    <input
                      className="mt-2 w-full rounded-xl border px-3 py-2 font-mono text-xs"
                      placeholder="/modern.png"
                      value={form.mockImageUrl || ''}
                      onChange={(e) => updateField('mockImageUrl', e.target.value)}
                    />
                  </label>
                  <label className="block text-sm font-medium">
                    Prompt 模板
                    <textarea className="mt-2 min-h-40 w-full rounded-xl border px-3 py-2" value={form.promptTemplate} onChange={(e) => updateField('promptTemplate', e.target.value)} />
                  </label>
                  <label className="block text-sm font-medium">
                    Negative Prompt
                    <textarea className="mt-2 min-h-28 w-full rounded-xl border px-3 py-2" value={form.negativePrompt} onChange={(e) => updateField('negativePrompt', e.target.value)} />
                  </label>
                </div>

                <div className="space-y-4">
                  <label className="block text-sm font-medium">
                    Model
                    <input className="mt-2 w-full rounded-xl border px-3 py-2 font-mono text-xs" value={form.image.model} onChange={(e) => updateImageField('model', e.target.value)} />
                  </label>
                  <label className="block text-sm font-medium">
                    Size
                    <input className="mt-2 w-full rounded-xl border px-3 py-2 font-mono text-xs" value={form.image.size} onChange={(e) => updateImageField('size', e.target.value)} />
                  </label>
                  <label className="block text-sm font-medium">
                    Quality
                    <select className="mt-2 w-full rounded-xl border px-3 py-2" value={form.image.quality} onChange={(e) => updateImageField('quality', e.target.value)}>
                      {QUALITY_OPTIONS.map((quality) => (
                        <option key={quality} value={quality}>
                          {quality}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm font-medium">
                    Mode
                    <select className="mt-2 w-full rounded-xl border px-3 py-2" value={form.image.mode} onChange={(e) => updateImageField('mode', e.target.value)}>
                      {MODE_OPTIONS.map((mode) => (
                        <option key={mode} value={mode}>
                          {mode}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="grid grid-cols-2 gap-4">
                    <label className="block text-sm font-medium">
                      排序
                      <input className="mt-2 w-full rounded-xl border px-3 py-2" type="number" value={form.sortOrder} onChange={(e) => updateField('sortOrder', toNumber(e.target.value, 0))} />
                    </label>
                    <label className="flex items-center gap-2 pt-8 text-sm font-medium">
                      <input type="checkbox" checked={form.enabled} onChange={(e) => updateField('enabled', e.target.checked)} />
                      启用预设
                    </label>
                  </div>
                </div>
              </div>
            )}

            <DialogFooter className="border-t bg-muted/10 p-8 pt-4">
              <Button variant="ghost" onClick={() => setEditingPreset(null)}>
                取消
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="mr-2 animate-spin" size={16} /> : <Save className="mr-2" size={16} />}
                保存预设
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
