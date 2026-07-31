'use client';

import { useEffect, useState } from 'react';
import { Coins, Save } from 'lucide-react';
import { useFetch } from '@/hooks/useFetch';
import { notify } from '@/components/ui/operation-feedback';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type PriceItem = { _id: string; actionKey: string; label: string; credits: number; enabled: boolean };
type ModelPriceItem = {
  id?: string;
  actionKey: string;
  modelProfileKey: string;
  resolutionTier: '1K' | '2K' | '4K' | 'CUSTOM';
  label: string;
  credits: number;
  enabled: boolean;
};

export default function AiCreditPricesPage() {
  const { data, isLoading, mutate } = useFetch<PriceItem[]>('/api/admin/ai-credit-prices');
  const {
    data: modelPriceData,
    isLoading: modelPricesLoading,
    mutate: mutateModelPrices,
  } = useFetch<ModelPriceItem[]>('/api/admin/ai-image-model-prices');
  const [items, setItems] = useState<PriceItem[]>([]);
  const [modelPrices, setModelPrices] = useState<ModelPriceItem[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => setItems(data || []), [data]);
  useEffect(() => setModelPrices(modelPriceData || []), [modelPriceData]);

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/admin/ai-credit-prices', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items.map(({ actionKey, credits, enabled }) => ({ actionKey, credits, enabled })) }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存失败');
      const modelResponse = await fetch('/api/admin/ai-image-model-prices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: modelPrices.map(({ modelProfileKey, resolutionTier, credits, enabled }) => ({
            modelProfileKey,
            resolutionTier,
            credits,
            enabled,
          })),
        }),
      });
      const modelResult = await modelResponse.json();
      if (!modelResponse.ok || !modelResult.success) throw new Error(modelResult.error || '模型点数价格保存失败');
      await Promise.all([mutate(), mutateModelPrices()]);
      notify.success('AI 点数价格已保存');
    } catch (error) { notify.error(error instanceof Error ? error.message : '保存失败'); }
    finally { setSaving(false); }
  };

  return <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">
    <div className="flex items-start justify-between gap-4 border-b pb-6"><div><div className="flex items-center gap-2"><Coins size={22} /><h1 className="text-2xl font-semibold">AI 点数价格</h1></div><p className="mt-2 text-sm text-muted-foreground">场景动作使用固定点数；自由创作按 GRSAI 模型与分辨率独立定价。供应商内部成本单独核算。</p></div><Button onClick={save} disabled={saving || isLoading || modelPricesLoading}><Save size={16} />{saving ? '保存中...' : '保存价格'}</Button></div>
    <section className="space-y-3"><div><h2 className="text-lg font-semibold">场景动作价格</h2><p className="mt-1 text-sm text-muted-foreground">客户方案工作流和小程序继续使用平台场景默认模型，并按这些业务动作扣点。</p></div><div className="divide-y border bg-background">{items.map((item, index) => <div key={item.actionKey} className="grid gap-5 p-5 sm:grid-cols-[1fr_160px_120px] sm:items-center"><div><div className="font-semibold">{item.label}</div><div className="mt-1 font-mono text-xs text-muted-foreground">{item.actionKey}</div></div><div className="space-y-2"><Label>成功扣除点数</Label><Input type="number" min="1" max="100000" value={item.credits} onChange={(event) => setItems((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, credits: Number(event.target.value) } : entry))} /></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={item.enabled} onChange={(event) => setItems((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, enabled: event.target.checked } : entry))} />允许使用</label></div>)}{!items.length && !isLoading ? <div className="p-10 text-center text-sm text-muted-foreground">暂无价格配置</div> : null}</div></section>
    <section className="space-y-3"><div><h2 className="text-lg font-semibold">自由创作模型价格</h2><p className="mt-1 text-sm text-muted-foreground">只有模型已启用且至少一个分辨率价格已启用时，模型才会显示在自由创作台。VIP 自定义尺寸统一使用 CUSTOM 价格。</p></div><div className="overflow-x-auto border bg-background"><table className="w-full min-w-[820px] text-sm"><thead className="border-b bg-muted/30 text-left"><tr><th className="p-3">模型档位</th><th>模型档案</th><th>分辨率</th><th>成功扣除点数</th><th>允许使用</th></tr></thead><tbody>{modelPrices.map((item, index) => <tr key={`${item.modelProfileKey}:${item.resolutionTier}`} className="border-b last:border-0"><td className="p-3 font-medium">{item.label}</td><td className="font-mono text-xs text-muted-foreground">{item.modelProfileKey}</td><td><span className="inline-flex min-w-16 items-center justify-center rounded-md border px-2 py-1 font-mono text-xs">{item.resolutionTier}</span></td><td className="w-48 pr-5"><Input aria-label={`${item.label} 点数`} type="number" min="1" max="100000" value={item.credits} onChange={(event) => setModelPrices((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, credits: Number(event.target.value) } : entry))} /></td><td><input aria-label={`启用 ${item.label}`} type="checkbox" checked={item.enabled} onChange={(event) => setModelPrices((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, enabled: event.target.checked } : entry))} /></td></tr>)}{!modelPrices.length && !modelPricesLoading ? <tr><td colSpan={5} className="p-10 text-center text-muted-foreground">暂无模型价格配置</td></tr> : null}</tbody></table></div></section>
  </main>;
}
