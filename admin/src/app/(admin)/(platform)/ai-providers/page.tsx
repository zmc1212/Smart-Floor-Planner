'use client';

import { useMemo, useState } from 'react';
import { Cable, KeyRound, Plus, RefreshCw, Save, TestTube2, WalletCards, X } from 'lucide-react';
import { useFetch } from '@/hooks/useFetch';
import { notify } from '@/components/ui/operation-feedback';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

const CAPABILITIES = ['chat', 'vision', 'image.generate', 'image.edit'] as const;
const MODEL_KEYS = ['chat.general', 'vision.reference_analysis', 'image.generate.standard', 'image.edit.standard'] as const;

type Provider = {
  id: string;
  key: string;
  name: string;
  adapterType: 'grs' | 'pollinations' | 'openai_compatible';
  baseUrl: string;
  apiKeyMasked: string;
  capabilities: string[];
  modelMappings: Record<string, string>;
  priority: number;
  timeoutMs: number;
  enabled: boolean;
  costRules: Array<{ logicalModelKey: string; currency: string; estimatedMicros: number }>;
  discoveredModels: string[];
  lastTestOk?: boolean;
  lastUpstreamBalance?: number | null;
  lastUpstreamBalanceUnit?: string;
  lastUpstreamBalanceAt?: string | null;
  lastUpstreamBalanceMessage?: string;
};

type FormState = Omit<Provider, 'id' | 'apiKeyMasked' | 'discoveredModels' | 'lastTestOk' | 'costRules' | 'lastUpstreamBalance' | 'lastUpstreamBalanceUnit' | 'lastUpstreamBalanceAt' | 'lastUpstreamBalanceMessage'> & {
  id?: string;
  apiKey: string;
  costs: Record<string, { currency: string; estimatedMicros: string }>;
};

function defaultCosts() {
  return Object.fromEntries(MODEL_KEYS.map((key) => [key, { currency: 'CNY', estimatedMicros: '0' }]));
}

function emptyForm(): FormState {
  return {
    key: '', name: '', adapterType: 'grs', baseUrl: 'https://grsai.dakka.com.cn', apiKey: '',
    capabilities: [...CAPABILITIES], modelMappings: {
      'chat.general': 'gemini-3.1-pro', 'vision.reference_analysis': 'gemini-3.1-pro',
      'image.generate.standard': 'gpt-image-2', 'image.edit.standard': 'gpt-image-2',
    },
    priority: 100, timeoutMs: 90000, enabled: true, costs: defaultCosts(),
  };
}

function providerForm(provider: Provider): FormState {
  const costs = defaultCosts();
  provider.costRules.forEach((rule) => { costs[rule.logicalModelKey] = { currency: rule.currency, estimatedMicros: String(rule.estimatedMicros) }; });
  return { ...provider, id: provider.id, apiKey: '', costs };
}

export default function AiProvidersPage() {
  const { data, isLoading, mutate } = useFetch<Provider[]>('/api/admin/ai-providers');
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [workingId, setWorkingId] = useState('');
  const providers = data || [];
  const canSave = useMemo(() => Boolean(form?.key.trim() && form?.name.trim() && form?.baseUrl.trim() && (form.id || form.apiKey.trim())), [form]);

  const save = async () => {
    if (!form || !canSave) return;
    setSaving(true);
    try {
      const costRules = MODEL_KEYS.map((logicalModelKey) => ({ logicalModelKey, currency: form.costs[logicalModelKey]?.currency || 'CNY', estimatedMicros: Number(form.costs[logicalModelKey]?.estimatedMicros || 0) }));
      const response = await fetch(form.id ? `/api/admin/ai-providers/${form.id}` : '/api/admin/ai-providers', {
        method: form.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, costRules }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存失败');
      if (form.id && form.apiKey.trim()) {
        const keyResponse = await fetch(`/api/admin/ai-providers/${form.id}/key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: form.apiKey }) });
        const keyResult = await keyResponse.json();
        if (!keyResponse.ok || !keyResult.success) throw new Error(keyResult.error || '配置已保存，但密钥轮换失败');
      }
      await mutate(); setForm(null); notify.success('AI 供应商配置已保存');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存失败');
    } finally { setSaving(false); }
  };

  const runAction = async (provider: Provider, action: 'test' | 'models' | 'balance' | 'disable') => {
    setWorkingId(`${provider.id}:${action}`);
    try {
      const response = await fetch(action === 'disable' ? `/api/admin/ai-providers/${provider.id}` : `/api/admin/ai-providers/${provider.id}/${action}`, { method: action === 'disable' ? 'DELETE' : 'POST' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '操作失败');
      await mutate();
      notify.success(
        action === 'test'
          ? `连通成功，耗时 ${result.data.latencyMs}ms`
          : action === 'models'
            ? `已同步 ${result.data.models.length} 个模型`
            : action === 'balance'
              ? `上游余额：${result.data.balance} ${result.data.unit}`
              : '供应商已停用'
      );
    } catch (error) { notify.error(error instanceof Error ? error.message : '操作失败'); }
    finally { setWorkingId(''); }
  };

  return (
    <main className="mx-auto max-w-7xl space-y-7 px-6 py-10">
      <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div><div className="flex items-center gap-2"><Cable size={22} /><h1 className="text-2xl font-semibold">AI 供应商</h1></div><p className="mt-2 text-sm text-muted-foreground">统一管理平台凭证、逻辑模型路由、优先级与成本快照。</p></div>
        <Button onClick={() => setForm(emptyForm())}><Plus size={16} />新增供应商</Button>
      </header>

      {form ? <section className="space-y-6 border-b pb-8">
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{form.id ? '编辑供应商' : '新增供应商'}</h2><Button variant="ghost" size="icon" onClick={() => setForm(null)} title="关闭"><X size={18} /></Button></div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2"><Label>供应商标识</Label><Input value={form.key} disabled={Boolean(form.id)} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="grs-primary" /></div>
          <div className="space-y-2"><Label>名称</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="space-y-2"><Label>适配器</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.adapterType} onChange={(e) => setForm({ ...form, adapterType: e.target.value as FormState['adapterType'] })}><option value="grs">GRS</option><option value="pollinations">Pollinations</option><option value="openai_compatible">OpenAI Compatible</option></select></div>
          <div className="space-y-2"><Label>{form.id ? '轮换 API Key（留空不变）' : 'API Key'}</Label><Input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} /></div>
          <div className="space-y-2 md:col-span-2"><Label>Base URL</Label><Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} /></div>
          <div className="space-y-2"><Label>优先级（越小越优先）</Label><Input type="number" min="0" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} /></div>
          <div className="space-y-2"><Label>超时（毫秒）</Label><Input type="number" min="1000" value={form.timeoutMs} onChange={(e) => setForm({ ...form, timeoutMs: Number(e.target.value) })} /></div>
        </div>
        <div className="flex flex-wrap gap-4">{CAPABILITIES.map((capability) => <label key={capability} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.capabilities.includes(capability)} onChange={(e) => setForm({ ...form, capabilities: e.target.checked ? [...form.capabilities, capability] : form.capabilities.filter((item) => item !== capability) })} />{capability}</label>)}<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />启用</label></div>
        <p className="text-xs text-muted-foreground">逻辑模型和远程模型用于业务路由，必须保留；成本字段仅用于平台内部毛利核算，不会发送给 GRS，也不会改变企业 AI 点数，可暂时填 0。</p>
        <div className="overflow-x-auto border"><table className="w-full min-w-[780px] text-sm"><thead className="border-b bg-muted/30 text-left"><tr><th className="p-3">逻辑模型</th><th>远程模型</th><th>成本币种（可选）</th><th>预计上游成本（微单位，可选）</th></tr></thead><tbody>{MODEL_KEYS.map((key) => <tr key={key} className="border-b last:border-0"><td className="p-3 font-mono text-xs">{key}</td><td className="pr-3"><Input list={`models-${form.id || 'new'}`} value={form.modelMappings[key] || ''} onChange={(e) => setForm({ ...form, modelMappings: { ...form.modelMappings, [key]: e.target.value } })} /></td><td className="pr-3"><Input value={form.costs[key]?.currency || 'CNY'} onChange={(e) => setForm({ ...form, costs: { ...form.costs, [key]: { ...form.costs[key], currency: e.target.value } } })} /></td><td className="pr-3"><Input type="number" min="0" value={form.costs[key]?.estimatedMicros || '0'} onChange={(e) => setForm({ ...form, costs: { ...form.costs, [key]: { ...form.costs[key], estimatedMicros: e.target.value } } })} /></td></tr>)}</tbody></table><datalist id={`models-${form.id || 'new'}`}>{providers.find((item) => item.id === form.id)?.discoveredModels.map((model) => <option key={model} value={model} />)}</datalist></div>
        <Button onClick={save} disabled={!canSave || saving}><Save size={16} />{saving ? '保存中...' : '保存配置'}</Button>
      </section> : null}

      <section className="overflow-x-auto border"><table className="w-full min-w-[1120px] text-sm"><thead className="border-b bg-muted/30 text-left"><tr><th className="p-3">供应商</th><th>适配器</th><th>路由</th><th>凭证</th><th>能力</th><th>上游余额</th><th>连通状态</th><th className="pr-3 text-right">操作</th></tr></thead><tbody>{providers.map((provider) => <tr key={provider.id} className="border-b last:border-0"><td className="p-3"><div className="font-medium">{provider.name}</div><div className="font-mono text-xs text-muted-foreground">{provider.key}</div></td><td>{provider.adapterType}</td><td>优先级 {provider.priority}<div className="text-xs text-muted-foreground">{provider.timeoutMs}ms</div></td><td className="font-mono text-xs">{provider.apiKeyMasked || '未配置'}</td><td><div className="flex max-w-[260px] flex-wrap gap-1">{provider.capabilities.map((item) => <Badge key={item} variant="outline">{item}</Badge>)}</div></td><td><div>{typeof provider.lastUpstreamBalance === 'number' ? `${provider.lastUpstreamBalance} ${provider.lastUpstreamBalanceUnit || ''}` : '未查询'}</div>{provider.lastUpstreamBalanceAt ? <div className="text-xs text-muted-foreground">{new Date(provider.lastUpstreamBalanceAt).toLocaleString()}</div> : null}{provider.lastUpstreamBalanceMessage ? <div className="max-w-[220px] truncate text-xs text-destructive" title={provider.lastUpstreamBalanceMessage}>{provider.lastUpstreamBalanceMessage}</div> : null}</td><td><Badge variant={provider.lastTestOk ? 'secondary' : 'outline'}>{provider.lastTestOk === true ? '正常' : provider.lastTestOk === false ? '失败' : '未测试'}</Badge>{!provider.enabled ? <Badge variant="destructive" className="ml-1">已停用</Badge> : null}</td><td><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" title="编辑" onClick={() => setForm(providerForm(provider))}><KeyRound size={15} /></Button><Button size="icon" variant="ghost" title="连通测试" disabled={Boolean(workingId)} onClick={() => runAction(provider, 'test')}><TestTube2 size={15} /></Button><Button size="icon" variant="ghost" title="查询上游余额" disabled={Boolean(workingId) || provider.adapterType !== 'grs'} onClick={() => runAction(provider, 'balance')}><WalletCards size={15} /></Button><Button size="icon" variant="ghost" title="同步模型" disabled={Boolean(workingId)} onClick={() => runAction(provider, 'models')}><RefreshCw size={15} /></Button>{provider.enabled ? <Button size="sm" variant="ghost" disabled={Boolean(workingId)} onClick={() => runAction(provider, 'disable')}>停用</Button> : null}</div></td></tr>)}{!providers.length && !isLoading ? <tr><td colSpan={8} className="p-10 text-center text-muted-foreground">尚未配置供应商</td></tr> : null}</tbody></table></section>
    </main>
  );
}
