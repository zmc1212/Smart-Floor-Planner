'use client';

import { useEffect, useState } from 'react';
import { Coins, Save } from 'lucide-react';
import { useFetch } from '@/hooks/useFetch';
import { notify } from '@/components/ui/operation-feedback';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type PriceItem = { _id: string; actionKey: string; label: string; credits: number; enabled: boolean };

export default function AiCreditPricesPage() {
  const { data, isLoading, mutate } = useFetch<PriceItem[]>('/api/admin/ai-credit-prices');
  const [items, setItems] = useState<PriceItem[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => setItems(data || []), [data]);

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/admin/ai-credit-prices', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items.map(({ actionKey, credits, enabled }) => ({ actionKey, credits, enabled })) }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存失败');
      await mutate(); notify.success('AI 点数价格已保存');
    } catch (error) { notify.error(error instanceof Error ? error.message : '保存失败'); }
    finally { setSaving(false); }
  };

  return <main className="mx-auto max-w-5xl px-6 py-10">
    <div className="mb-8 flex items-start justify-between gap-4 border-b pb-6"><div><div className="flex items-center gap-2"><Coins size={22} /><h1 className="text-2xl font-semibold">AI 点数价格</h1></div><p className="mt-2 text-sm text-muted-foreground">按稳定业务动作设置固定点数；上游供应商成本单独核算，不会动态改变企业价格。</p></div><Button onClick={save} disabled={saving || isLoading}><Save size={16} />{saving ? '保存中...' : '保存价格'}</Button></div>
    <section className="divide-y border bg-background">{items.map((item, index) => <div key={item.actionKey} className="grid gap-5 p-5 sm:grid-cols-[1fr_160px_120px] sm:items-center"><div><div className="font-semibold">{item.label}</div><div className="mt-1 font-mono text-xs text-muted-foreground">{item.actionKey}</div></div><div className="space-y-2"><Label>成功扣除点数</Label><Input type="number" min="1" max="100000" value={item.credits} onChange={(event) => setItems((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, credits: Number(event.target.value) } : entry))} /></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={item.enabled} onChange={(event) => setItems((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, enabled: event.target.checked } : entry))} />允许使用</label></div>)}{!items.length && !isLoading ? <div className="p-10 text-center text-sm text-muted-foreground">暂无价格配置</div> : null}</section>
  </main>;
}
