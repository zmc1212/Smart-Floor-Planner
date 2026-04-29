'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Loader2, Save, Settings2, Sparkles } from 'lucide-react';
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
  tensor: {
    modelKey: string;
    modelId: string;
    width: number;
    height: number;
    steps: number;
    cfgScale: number;
    sampler: string;
    scheduler?: string;
    guidance?: number;
    clipSkip?: number;
    denoisingStrength?: number;
    vae?: string;
    controlnet?: {
      enabled: boolean;
      preprocessor: string;
      model: string;
      weight: number;
      guidanceStart?: number;
      guidanceEnd?: number;
    };
  };
}

const PRESET_TABS: Array<{ type: AiPresetType; label: string; hint: string }> = [
  { type: 'floor_plan_style', label: 'AI 室内平面', hint: '3D / 彩平 / CAD / 手绘' },
  { type: 'furnishing_style', label: 'AI 软装设计', hint: '现代 / 北欧 / 奶油 / 轻奢 / 新中式' },
];

function toNumber(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatPresetForTensorImport(preset: AiPreset) {
  const lines = [
    `Prompt: ${preset.promptTemplate}`,
    `Negative prompt: ${preset.negativePrompt || 'EasyNegative'}`,
    `Size: ${preset.tensor.width}x${preset.tensor.height}`,
    'Seed: -1',
    `Model: ${preset.tensor.modelKey}`,
    `Steps: ${preset.tensor.steps}`,
    `CFG scale: ${preset.tensor.cfgScale}`,
    `Sampler: ${preset.tensor.sampler}`,
  ];

  if (preset.tensor.scheduler) lines.push(`Schedule: ${preset.tensor.scheduler}`);
  if (typeof preset.tensor.guidance === 'number') lines.push(`Guidance: ${preset.tensor.guidance}`);
  if (preset.tensor.vae) lines.push(`VAE: ${preset.tensor.vae}`);
  if (typeof preset.tensor.denoisingStrength === 'number') {
    lines.push(`Denoising strength: ${preset.tensor.denoisingStrength}`);
  }
  if (typeof preset.tensor.clipSkip === 'number') lines.push(`Clip skip: ${preset.tensor.clipSkip}`);
  if (preset.tensor.controlnet?.enabled) {
    lines.push(`ControlNet: ${preset.tensor.controlnet.preprocessor}`);
    lines.push(`ControlNet model: ${preset.tensor.controlnet.model}`);
    lines.push(`ControlNet weight: ${preset.tensor.controlnet.weight}`);
  }

  return lines.join(',\n');
}

function parseTensorImportText(rawText: string) {
  const normalized = rawText
    .replace(/\r\n/g, '\n')
    .split(',\n')
    .map((item) => item.trim())
    .filter(Boolean);

  const result: Record<string, string> = {};
  for (const line of normalized) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    if (value) result[key] = value;
  }

  return result;
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
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [importText, setImportText] = useState('');

  useEffect(() => {
    if (editingPreset) {
      setForm(JSON.parse(JSON.stringify(editingPreset)) as AiPreset);
      setImportText('');
    } else {
      setForm(null);
      setImportText('');
    }
  }, [editingPreset]);

  const sortedPresets = useMemo(
    () => [...presets].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [presets]
  );

  const updateField = (field: keyof AiPreset, value: string | boolean | number) => {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const updateTensorField = (field: keyof AiPreset['tensor'], value: string | number) => {
    setForm((prev) => (prev ? { ...prev, tensor: { ...prev.tensor, [field]: value } } : prev));
  };

  const updateControlnetField = (
    field: keyof NonNullable<AiPreset['tensor']['controlnet']>,
    value: string | number | boolean
  ) => {
    setForm((prev) =>
      prev
        ? {
            ...prev,
            tensor: {
              ...prev.tensor,
              controlnet: {
                enabled: prev.tensor.controlnet?.enabled ?? true,
                preprocessor: prev.tensor.controlnet?.preprocessor || 'canny',
                model: prev.tensor.controlnet?.model || 'control_v11p_sd15_canny',
                weight: prev.tensor.controlnet?.weight ?? 1,
                guidanceStart: prev.tensor.controlnet?.guidanceStart ?? 0,
                guidanceEnd: prev.tensor.controlnet?.guidanceEnd ?? 1,
                ...prev.tensor.controlnet,
                [field]: value,
              },
            },
          }
        : prev
    );
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
          tensor: form.tensor,
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

  const handleCopyPreset = async (preset: AiPreset) => {
    try {
      await navigator.clipboard.writeText(formatPresetForTensorImport(preset));
      setCopiedKey(preset.key);
      window.setTimeout(() => setCopiedKey((current) => (current === preset.key ? null : current)), 1800);
    } catch (error) {
      console.error(error);
      alert('复制失败，请检查浏览器剪贴板权限');
    }
  };

  const handleImportPresetText = () => {
    if (!form || !importText.trim()) return;

    const parsed = parseTensorImportText(importText);
    const size = parsed['size']?.match(/^(\d+)\s*x\s*(\d+)$/i);

    setForm((prev) => {
      if (!prev) return prev;

      return {
        ...prev,
        promptTemplate: parsed['prompt'] || prev.promptTemplate,
        negativePrompt: parsed['negative prompt'] || prev.negativePrompt,
        tensor: {
          ...prev.tensor,
          modelKey: parsed['model'] || prev.tensor.modelKey,
          width: size ? toNumber(size[1], prev.tensor.width) : prev.tensor.width,
          height: size ? toNumber(size[2], prev.tensor.height) : prev.tensor.height,
          steps: parsed['steps'] ? toNumber(parsed['steps'], prev.tensor.steps) : prev.tensor.steps,
          cfgScale: parsed['cfg scale'] ? toNumber(parsed['cfg scale'], prev.tensor.cfgScale) : prev.tensor.cfgScale,
          sampler: parsed['sampler'] || parsed['ksampler'] || prev.tensor.sampler,
          scheduler: parsed['schedule'] || prev.tensor.scheduler,
          guidance: parsed['guidance'] ? toNumber(parsed['guidance'], prev.tensor.guidance ?? 0) : prev.tensor.guidance,
          vae: parsed['vae'] || prev.tensor.vae,
          denoisingStrength: parsed['denoising strength']
            ? toNumber(parsed['denoising strength'], prev.tensor.denoisingStrength ?? 0)
            : prev.tensor.denoisingStrength,
          clipSkip: parsed['clip skip'] ? toNumber(parsed['clip skip'], prev.tensor.clipSkip ?? 0) : prev.tensor.clipSkip,
        },
      };
    });
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
          <p className="text-sm text-muted-foreground">只有 admin / super_admin 可以配置 Tensor 风格预设。</p>
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
            分别维护 AI 室内平面的图纸表现风格，以及 AI 软装设计的装修风格。
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
                  Model: <span className="font-mono text-foreground">{preset.tensor.modelKey}</span>
                </div>
                <div>
                  Mock 图: <span className="font-mono text-foreground">{preset.mockImageUrl || '未配置'}</span>
                </div>
                <div>
                  Render:{' '}
                  <span className="font-mono text-foreground">
                    {preset.tensor.width}x{preset.tensor.height} / {preset.tensor.steps} steps / CFG{' '}
                    {preset.tensor.cfgScale}
                  </span>
                </div>
                <div>
                  ControlNet:{' '}
                  <span className="font-mono text-foreground">
                    {preset.tensor.controlnet?.enabled
                      ? `${preset.tensor.controlnet.preprocessor} / ${preset.tensor.controlnet.model}`
                      : 'disabled'}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <Button size="sm" variant="outline" className="rounded-xl" onClick={() => handleCopyPreset(preset)}>
                  {copiedKey === preset.key ? <Check className="mr-2" size={14} /> : <Copy className="mr-2" size={14} />}
                  {copiedKey === preset.key ? '已复制到剪贴板' : '复制 Tensor 导入参数'}
                </Button>
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
              <DialogDescription>修改后会影响对应菜单的 Tensor 参数和 MOCK 模式图片。</DialogDescription>
            </DialogHeader>

            {form && (
              <div className="grid grid-cols-1 gap-6 p-8 lg:grid-cols-2">
                <div className="space-y-4">
                  <label className="block text-sm font-medium">
                    从 Tensor 参数导入
                    <textarea
                      className="mt-2 min-h-32 w-full rounded-xl border px-3 py-2 font-mono text-xs"
                      placeholder="把 Tensor.Art 参数整段粘贴到这里，然后点击导入参数到表单"
                      value={importText}
                      onChange={(e) => setImportText(e.target.value)}
                    />
                  </label>
                  <Button type="button" variant="outline" className="rounded-xl" onClick={handleImportPresetText}>
                    导入参数到表单
                  </Button>

                  <label className="block text-sm font-medium">
                    名称
                    <input className="mt-2 w-full rounded-xl border px-3 py-2" value={form.name} onChange={(e) => updateField('name', e.target.value)} />
                  </label>
                  <label className="block text-sm font-medium">
                    描述
                    <input className="mt-2 w-full rounded-xl border px-3 py-2" value={form.description} onChange={(e) => updateField('description', e.target.value)} />
                  </label>
                  <label className="block text-sm font-medium">
                    图标简写
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
                  <div className="grid grid-cols-2 gap-4">
                    <label className="block text-sm font-medium">
                      模型 Key
                      <input className="mt-2 w-full rounded-xl border px-3 py-2 font-mono text-xs" value={form.tensor.modelKey} onChange={(e) => updateTensorField('modelKey', e.target.value)} />
                    </label>
                    <label className="block text-sm font-medium">
                      模型 ID
                      <input className="mt-2 w-full rounded-xl border px-3 py-2 font-mono text-xs" value={form.tensor.modelId} onChange={(e) => updateTensorField('modelId', e.target.value)} />
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <label className="block text-sm font-medium">
                      宽度
                      <input className="mt-2 w-full rounded-xl border px-3 py-2" type="number" value={form.tensor.width} onChange={(e) => updateTensorField('width', toNumber(e.target.value, 640))} />
                    </label>
                    <label className="block text-sm font-medium">
                      高度
                      <input className="mt-2 w-full rounded-xl border px-3 py-2" type="number" value={form.tensor.height} onChange={(e) => updateTensorField('height', toNumber(e.target.value, 640))} />
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <label className="block text-sm font-medium">
                      Steps
                      <input className="mt-2 w-full rounded-xl border px-3 py-2" type="number" value={form.tensor.steps} onChange={(e) => updateTensorField('steps', toNumber(e.target.value, 20))} />
                    </label>
                    <label className="block text-sm font-medium">
                      CFG Scale
                      <input className="mt-2 w-full rounded-xl border px-3 py-2" type="number" step="0.1" value={form.tensor.cfgScale} onChange={(e) => updateTensorField('cfgScale', toNumber(e.target.value, 7))} />
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <label className="block text-sm font-medium">
                      Sampler
                      <input className="mt-2 w-full rounded-xl border px-3 py-2" value={form.tensor.sampler} onChange={(e) => updateTensorField('sampler', e.target.value)} />
                    </label>
                    <label className="block text-sm font-medium">
                      VAE
                      <input className="mt-2 w-full rounded-xl border px-3 py-2 font-mono text-xs" value={form.tensor.vae || ''} onChange={(e) => updateTensorField('vae', e.target.value)} />
                    </label>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <label className="block text-sm font-medium">
                      Guidance
                      <input className="mt-2 w-full rounded-xl border px-3 py-2" type="number" step="0.1" value={form.tensor.guidance ?? ''} onChange={(e) => updateTensorField('guidance', toNumber(e.target.value, 0))} />
                    </label>
                    <label className="block text-sm font-medium">
                      Clip Skip
                      <input className="mt-2 w-full rounded-xl border px-3 py-2" type="number" value={form.tensor.clipSkip ?? ''} onChange={(e) => updateTensorField('clipSkip', toNumber(e.target.value, 0))} />
                    </label>
                    <label className="block text-sm font-medium">
                      Denoising
                      <input className="mt-2 w-full rounded-xl border px-3 py-2" type="number" step="0.1" value={form.tensor.denoisingStrength ?? ''} onChange={(e) => updateTensorField('denoisingStrength', toNumber(e.target.value, 0))} />
                    </label>
                  </div>

                  <div className="space-y-4 rounded-2xl border p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">ControlNet</h3>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={form.tensor.controlnet?.enabled ?? false} onChange={(e) => updateControlnetField('enabled', e.target.checked)} />
                        启用
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <label className="block text-sm font-medium">
                        预处理器
                        <input className="mt-2 w-full rounded-xl border px-3 py-2" value={form.tensor.controlnet?.preprocessor || ''} onChange={(e) => updateControlnetField('preprocessor', e.target.value)} />
                      </label>
                      <label className="block text-sm font-medium">
                        模型
                        <input className="mt-2 w-full rounded-xl border px-3 py-2 font-mono text-xs" value={form.tensor.controlnet?.model || ''} onChange={(e) => updateControlnetField('model', e.target.value)} />
                      </label>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <label className="block text-sm font-medium">
                        权重
                        <input className="mt-2 w-full rounded-xl border px-3 py-2" type="number" step="0.1" value={form.tensor.controlnet?.weight ?? ''} onChange={(e) => updateControlnetField('weight', toNumber(e.target.value, 1))} />
                      </label>
                      <label className="block text-sm font-medium">
                        Start
                        <input className="mt-2 w-full rounded-xl border px-3 py-2" type="number" step="0.1" value={form.tensor.controlnet?.guidanceStart ?? ''} onChange={(e) => updateControlnetField('guidanceStart', toNumber(e.target.value, 0))} />
                      </label>
                      <label className="block text-sm font-medium">
                        End
                        <input className="mt-2 w-full rounded-xl border px-3 py-2" type="number" step="0.1" value={form.tensor.controlnet?.guidanceEnd ?? ''} onChange={(e) => updateControlnetField('guidanceEnd', toNumber(e.target.value, 1))} />
                      </label>
                    </div>
                  </div>

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
              {form && (
                <Button variant="outline" onClick={() => handleCopyPreset(form)}>
                  {copiedKey === form.key ? <Check className="mr-2" size={16} /> : <Copy className="mr-2" size={16} />}
                  {copiedKey === form.key ? '已复制' : '复制 Tensor 导入参数'}
                </Button>
              )}
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
