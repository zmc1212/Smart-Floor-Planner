'use client';

import { useEffect, useMemo, useState } from 'react';
import { Coins, RefreshCw, RotateCcw } from 'lucide-react';
import { useFetch } from '@/hooks/useFetch';
import { notify } from '@/components/ui/operation-feedback';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type CreditsData = {
  account: { balance: number; frozenBalance: number; availableBalance: number };
  policy: { enabledActionKeys: string[]; logicalModelTier: 'standard' };
  ledger: Array<{ id: string; type: string; amount: number; balanceAfter?: number; frozenAfter?: number; note?: string; operator: string; createdAt: string }>;
  tasks: Array<{ id: string; mode: string; actionKey?: string; channel?: string; status: string; externalStatus?: string; credits: number; provider?: string; model?: string; error?: string; operator: string; createdAt: string }>;
};

const TYPE_LABELS: Record<string, string> = { grant: '发放', adjust: '人工调整', hold: '任务冻结', consume: '成功扣费', release: '失败释放' };
const MODE_LABELS: Record<string, string> = { reference_recreate: '复刻参考图', style_transform: '空间换风格', floor_plan_style: '户型风格', furnishing_render: '空间效果图', soft_furnishing_render: '软装效果图', scenario: '场景方案', advice: '设计建议' };
const ACTIONS = [
  ['image.reference_recreate', '复刻参考图'], ['image.style_transform', '空间换风格'],
  ['image.floor_plan_style', '户型风格'], ['image.furnishing_render', '空间效果图'],
  ['image.soft_furnishing_render', '软装效果图'], ['image.scenario', '场景方案'],
  ['text.design_advice', '设计建议'],
] as const;
const formatDate = (value: string) => value ? new Date(value).toLocaleString('zh-CN') : '-';

export default function EnterpriseAiCreditsManager({ enterpriseId }: { enterpriseId: string }) {
  const { data, isLoading, mutate } = useFetch<CreditsData>(enterpriseId ? `/api/admin/enterprises/${enterpriseId}/ai-credits` : null);
  const [action, setAction] = useState<'grant' | 'adjust'>('grant');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [retryingId, setRetryingId] = useState('');
  const [policyActions, setPolicyActions] = useState<string[]>([]);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const account = data?.account || { balance: 0, frozenBalance: 0, availableBalance: 0 };
  const canSubmit = useMemo(() => Number.isInteger(Number(amount)) && Number(amount) !== 0 && Boolean(note.trim()) && (action === 'adjust' || Number(amount) > 0), [action, amount, note]);
  useEffect(() => { if (data?.policy.enabledActionKeys) setPolicyActions(data.policy.enabledActionKeys); }, [data?.policy.enabledActionKeys]);

  const savePolicy = async () => {
    if (!policyActions.length) return notify.error('至少保留一个企业 AI 功能');
    setSavingPolicy(true);
    try {
      const response = await fetch(`/api/admin/enterprises/${enterpriseId}/ai-credits`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabledActionKeys: policyActions, logicalModelTier: 'standard' }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存企业 AI 策略失败');
      await mutate(); notify.success('企业 AI 功能策略已保存');
    } catch (error) { notify.error(error instanceof Error ? error.message : '保存企业 AI 策略失败'); }
    finally { setSavingPolicy(false); }
  };

  const submitAdjustment = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/admin/enterprises/${enterpriseId}/ai-credits`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, amount: Number(amount), note: note.trim() }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '调整 AI 点数失败');
      setAmount(''); setNote(''); await mutate(); notify.success(action === 'grant' ? 'AI 点数已发放' : 'AI 点数已调整');
    } catch (error) { notify.error(error instanceof Error ? error.message : '调整 AI 点数失败'); }
    finally { setSubmitting(false); }
  };

  const retryTask = async (id: string) => {
    setRetryingId(id);
    try {
      const response = await fetch(`/api/admin/ai-generations/${id}/retry`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '任务重试失败');
      await mutate(); notify.success('AI 任务已进入新计费周期');
    } catch (error) { notify.error(error instanceof Error ? error.message : '任务重试失败'); }
    finally { setRetryingId(''); }
  };

  return <section className="space-y-5 border bg-background p-6">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex items-center gap-2 text-lg font-semibold"><Coins size={20} className="text-emerald-600" />企业 AI 点数</div><p className="mt-1 text-sm text-muted-foreground">后台与小程序共用余额；创建任务冻结，正式结果持久化后扣除，明确失败后释放。</p></div><Button variant="outline" size="sm" onClick={() => mutate()} disabled={isLoading}><RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />刷新</Button></div>
    <div className="grid gap-3 sm:grid-cols-3"><div className="border bg-emerald-50/60 p-4"><div className="text-xs text-muted-foreground">可用点数</div><div className="mt-1 text-2xl font-bold text-emerald-700">{account.availableBalance}</div></div><div className="border p-4"><div className="text-xs text-muted-foreground">账户点数</div><div className="mt-1 text-2xl font-bold">{account.balance}</div></div><div className="border p-4"><div className="text-xs text-muted-foreground">冻结点数</div><div className="mt-1 text-2xl font-bold">{account.frozenBalance}</div></div></div>
    <div className="space-y-3 border p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-semibold">允许的 AI 功能</div><div className="mt-1 text-xs text-muted-foreground">逻辑模型档位：standard</div></div><Button size="sm" variant="outline" onClick={savePolicy} disabled={savingPolicy}>{savingPolicy ? '保存中...' : '保存策略'}</Button></div><div className="flex flex-wrap gap-x-5 gap-y-3">{ACTIONS.map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={policyActions.includes(key)} onChange={(event) => setPolicyActions((current) => event.target.checked ? [...current, key] : current.filter((item) => item !== key))} />{label}</label>)}</div></div>
    <div className="grid gap-4 border bg-muted/15 p-4 lg:grid-cols-[150px_140px_1fr_auto] lg:items-end"><div className="space-y-2"><Label>操作类型</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={action} onChange={(e) => setAction(e.target.value as 'grant' | 'adjust')}><option value="grant">发放点数</option><option value="adjust">人工调整</option></select></div><div className="space-y-2"><Label>点数</Label><Input type="number" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} /></div><div className="space-y-2"><Label>调整原因</Label><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="用于运营审计，不可为空" /></div><Button onClick={submitAdjustment} disabled={!canSubmit || submitting}>{submitting ? '提交中...' : '确认调整'}</Button></div>
    <Tabs defaultValue="ledger"><TabsList><TabsTrigger value="ledger">点数流水</TabsTrigger><TabsTrigger value="tasks">AI 任务</TabsTrigger></TabsList>
      <TabsContent value="ledger" className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="py-3">时间</th><th>类型</th><th>数量</th><th>余额 / 冻结</th><th>操作人</th><th>原因</th></tr></thead><tbody>{(data?.ledger || []).map((item) => <tr key={item.id} className="border-b last:border-0"><td className="py-3 text-muted-foreground">{formatDate(item.createdAt)}</td><td><Badge variant="outline">{TYPE_LABELS[item.type] || item.type}</Badge></td><td className={item.amount < 0 ? 'text-red-600' : 'text-emerald-700'}>{item.amount > 0 ? '+' : ''}{item.amount}</td><td>{item.balanceAfter ?? '-'} / {item.frozenAfter ?? '-'}</td><td>{item.operator}</td><td>{item.note || '-'}</td></tr>)}{!data?.ledger?.length ? <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">暂无流水</td></tr> : null}</tbody></table></TabsContent>
      <TabsContent value="tasks" className="overflow-x-auto"><table className="w-full min-w-[920px] text-sm"><thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="py-3">时间</th><th>业务动作</th><th>客户端</th><th>状态</th><th>点数</th><th>实际路由</th><th>操作人</th><th className="text-right">操作</th></tr></thead><tbody>{(data?.tasks || []).map((task) => <tr key={task.id} className="border-b last:border-0"><td className="py-3 text-muted-foreground">{formatDate(task.createdAt)}</td><td><div>{MODE_LABELS[task.mode] || task.mode}</div><div className="font-mono text-xs text-muted-foreground">{task.actionKey || '-'}</div></td><td>{task.channel || 'admin'}</td><td><Badge variant={task.status === 'failed' ? 'destructive' : 'secondary'}>{task.status}</Badge>{task.externalStatus === 'unknown' ? <Badge variant="outline" className="ml-1">待对账</Badge> : null}</td><td>{task.credits}</td><td>{task.provider || '-'} / {task.model || '-'}</td><td>{task.operator}</td><td className="text-right">{task.status === 'failed' && task.channel === 'miniprogram' ? <Button size="sm" variant="outline" onClick={() => retryTask(task.id)} disabled={retryingId === task.id} title={task.error || '重试任务'}><RotateCcw size={14} />重试</Button> : null}</td></tr>)}{!data?.tasks?.length ? <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">暂无 AI 任务</td></tr> : null}</tbody></table></TabsContent>
    </Tabs>
  </section>;
}
