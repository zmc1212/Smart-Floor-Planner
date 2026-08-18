'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BanknoteArrowDown, CheckCircle2, CircleDollarSign, Save, UsersRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { notify } from '@/components/ui/operation-feedback';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type CommissionRole = 'referrer' | 'designer' | 'measurer';
type CommissionStatus = 'payable' | 'paid' | 'voided';
type Rule = { id: string; role: CommissionRole; calculationType: 'fixed' | 'percentage'; value: string; status: 'active' | 'disabled'; version: number };
type Commission = {
  id: string; role: CommissionRole; ruleType: 'fixed' | 'percentage'; ruleValue: string; payableAmount: string; status: CommissionStatus;
  lead: { id: string; name: string; phone: string; communityName: string | null; contractAmount: string | null } | null;
  referrer: { nickname: string | null; phone: string | null } | null;
  designer: { displayName: string; phone: string | null } | null;
  measurer: { displayName: string; phone: string | null } | null;
  appointment: { address: string; timeRange: string; status: string } | null;
};

const roleMeta: Record<CommissionRole, { label: string; tone: string }> = {
  referrer: { label: '推荐人', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-100' },
  designer: { label: '设计师', tone: 'bg-sky-50 text-sky-700 ring-sky-100' },
  measurer: { label: '测量员', tone: 'bg-amber-50 text-amber-700 ring-amber-100' },
};

const statusMeta: Record<CommissionStatus, { label: string; tone: string }> = {
  payable: { label: '待支付', tone: 'bg-amber-50 text-amber-700 ring-amber-100' },
  paid: { label: '已支付', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-100' },
  voided: { label: '已作废', tone: 'bg-muted text-muted-foreground ring-border' },
};

function amount(value: string | number) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function person(name?: string | null, phone?: string | null) {
  return <div className="min-w-28"><p className="font-medium text-foreground">{name || '未分配'}</p><p className="text-xs text-muted-foreground">{phone || '—'}</p></div>;
}

function appointmentTime(value: string | null) {
  const match = value?.match(/^[[(]([^,]+),([^\])]+)[\])]/);
  if (!match) return '未预约';
  const start = new Date(match[1].replaceAll('"', ''));
  return Number.isNaN(start.getTime()) ? '已预约' : start.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function LeadCommissionsPage() {
  const confirm = useConfirmDialog();
  const [rules, setRules] = useState<Rule[]>([]);
  const [records, setRecords] = useState<Commission[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingRole, setSavingRole] = useState<CommissionRole | null>(null);
  const [paying, setPaying] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [filters, setFilters] = useState({ status: 'all', role: 'all', fromDate: '', toDate: '' });
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const loadRules = useCallback(async () => {
    const response = await fetch('/api/commission-rules');
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || '读取三方提成规则失败');
    setRules(result.data || []);
  }, []);

  const loadRecords = useCallback(async () => {
    const query = new URLSearchParams();
    if (filters.status !== 'all') query.set('status', filters.status);
    if (filters.role !== 'all') query.set('role', filters.role);
    if (filters.fromDate) query.set('fromDate', filters.fromDate);
    if (filters.toDate) query.set('toDate', filters.toDate);
    const response = await fetch(`/api/lead-commissions?${query}`);
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || '读取签单提成台账失败');
    setRecords(result.data || []);
    setSelected([]);
  }, [filters]);

  useEffect(() => {
    setLoading(true);
    void Promise.all([loadRules(), loadRecords()])
      .catch((error) => notify.error(error instanceof Error ? error.message : '读取三方提成失败'))
      .finally(() => setLoading(false));
  }, [loadRecords, loadRules]);

  const updateRule = (role: CommissionRole, patch: Partial<Rule>) => {
    setRules((current) => current.map((rule) => rule.role === role ? { ...rule, ...patch } : rule));
  };

  const saveRule = async (role: CommissionRole) => {
    setSavingRole(role);
    try {
      const response = await fetch('/api/commission-rules', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存提成规则失败');
      setRules(result.data || []);
      notify.success(`${roleMeta[role].label}提成规则已保存`);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存提成规则失败');
      void loadRules().catch(() => undefined);
    } finally {
      setSavingRole(null);
    }
  };

  const payableSelected = records.filter((record) => selected.includes(record.id) && record.status === 'payable');
  const markPaid = async () => {
    if (!payableSelected.length) return;
    const accepted = await confirm({ title: '确认标记已支付', description: `确认已在线下完成 ${payableSelected.length} 条提成的支付吗？该操作会保留付款审计。`, confirmText: '标记已支付' });
    if (!accepted) return;
    setPaying(true);
    try {
      const response = await fetch('/api/lead-commissions/mark-paid', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commissionIds: payableSelected.map((record) => record.id) }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '标记支付失败');
      notify.success('所选提成已标记为已支付');
      await loadRecords();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '标记支付失败');
    } finally {
      setPaying(false);
    }
  };

  const totals = useMemo(() => records.reduce<Record<CommissionStatus, number>>((result, record) => {
    result[record.status] += Number(record.payableAmount || 0); return result;
  }, { payable: 0, paid: 0, voided: 0 }), [records]);
  const totalPages = Math.max(1, Math.ceil(records.length / pageSize));
  const visibleRows = records.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  return (
    <main className="admin-page-frame mx-auto max-w-[1520px] space-y-6 px-4 py-6 lg:px-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">三方提成</h1>
        <p className="text-sm text-muted-foreground">配置推荐人、设计师、测量员的提成规则，查看签单提成明细与支付状态。</p>
      </header>

      <section className="grid gap-5 xl:grid-cols-3" aria-label="三方提成规则">
        {(['referrer', 'designer', 'measurer'] as CommissionRole[]).map((role) => {
          const rule = rules.find((item) => item.role === role);
          return <Card key={role} className="overflow-hidden border-border shadow-sm">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle className="text-lg">{roleMeta[role].label}提成</CardTitle>
              <Badge className={rule?.status === 'active' ? 'border-0 bg-emerald-50 text-emerald-700' : 'border-0 bg-muted text-muted-foreground'}>{rule?.status === 'active' ? '生效中' : '已停用'}</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><p className="text-sm text-muted-foreground">提成方式</p><div className="grid grid-cols-2 rounded-lg border border-input p-1">
                {(['fixed', 'percentage'] as const).map((type) => <Button key={type} type="button" size="sm" variant={rule?.calculationType === type ? 'default' : 'ghost'} className="h-8" disabled={!rule} onClick={() => updateRule(role, { calculationType: type })}>{type === 'fixed' ? '固定金额' : '百分比'}</Button>)}
              </div></div>
              <label className="block space-y-2"><span className="text-sm text-muted-foreground">规则值</span><div className="flex"><span className="inline-flex h-8 items-center rounded-l-lg border border-r-0 border-input bg-muted px-3 text-sm text-muted-foreground">{rule?.calculationType === 'fixed' ? '¥' : ''}</span><Input value={rule?.value || ''} inputMode="decimal" disabled={!rule} onChange={(event) => updateRule(role, { value: event.target.value })} className="rounded-none" /><span className="inline-flex h-8 items-center rounded-r-lg border border-l-0 border-input bg-muted px-3 text-sm text-muted-foreground">{rule?.calculationType === 'fixed' ? '元/单' : '%'}</span></div></label>
              <Button type="button" variant="outline" size="sm" className="w-full text-primary hover:text-primary" disabled={!rule || savingRole !== null} onClick={() => void saveRule(role)}><Save />保存规则</Button>
            </CardContent>
            <CardFooter className="border-t bg-muted/20 px-6 py-3"><button type="button" onClick={() => updateRule(role, { status: rule?.status === 'active' ? 'disabled' : 'active' })} className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{rule?.status === 'active' ? '停用此规则后需保存' : '启用此规则后需保存'}</button></CardFooter>
          </Card>;
        })}
      </section>

      <Card className="border-border shadow-sm">
        <CardHeader className="gap-4 border-b pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div><CardTitle className="text-xl">签单提成台账</CardTitle><p className="mt-1 text-sm text-muted-foreground">每条记录保留签单时的规则、受益人和金额快照。</p></div>
          <Button type="button" disabled={!payableSelected.length || paying} onClick={() => void markPaid()}><CheckCircle2 />标记已支付{payableSelected.length ? ` (${payableSelected.length})` : ''}</Button>
        </CardHeader>
        <CardContent className="space-y-5 pt-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Select value={filters.status} onValueChange={(value) => { setPage(1); setFilters((current) => ({ ...current, status: value })); }}><SelectTrigger className="w-full"><SelectValue placeholder="全部状态" /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="payable">待支付</SelectItem><SelectItem value="paid">已支付</SelectItem><SelectItem value="voided">已作废</SelectItem></SelectContent></Select>
            <Select value={filters.role} onValueChange={(value) => { setPage(1); setFilters((current) => ({ ...current, role: value })); }}><SelectTrigger className="w-full"><SelectValue placeholder="全部角色" /></SelectTrigger><SelectContent><SelectItem value="all">全部角色</SelectItem>{(['referrer', 'designer', 'measurer'] as CommissionRole[]).map((role) => <SelectItem key={role} value={role}>{roleMeta[role].label}</SelectItem>)}</SelectContent></Select>
            <Input type="date" aria-label="开始日期" value={filters.fromDate} onChange={(event) => { setPage(1); setFilters((current) => ({ ...current, fromDate: event.target.value })); }} />
            <Input type="date" aria-label="结束日期" value={filters.toDate} onChange={(event) => { setPage(1); setFilters((current) => ({ ...current, toDate: event.target.value })); }} />
          </div>
          <Table><TableHeader><TableRow><TableHead className="w-10"><input aria-label="选择全部待支付记录" type="checkbox" checked={visibleRows.filter((record) => record.status === 'payable').length > 0 && visibleRows.filter((record) => record.status === 'payable').every((record) => selected.includes(record.id))} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, ...visibleRows.filter((record) => record.status === 'payable').map((record) => record.id)])] : current.filter((id) => !visibleRows.some((record) => record.id === id)))} /></TableHead><TableHead>客户</TableHead><TableHead>推荐人</TableHead><TableHead>设计师</TableHead><TableHead>测量员</TableHead><TableHead>上门预约</TableHead><TableHead>提成角色</TableHead><TableHead>规则</TableHead><TableHead>应付金额</TableHead><TableHead>状态</TableHead></TableRow></TableHeader>
            <TableBody>{loading ? <TableRow><TableCell colSpan={10} className="py-12 text-center text-muted-foreground">正在读取台账…</TableCell></TableRow> : visibleRows.length ? visibleRows.map((record) => <TableRow key={record.id} data-state={selected.includes(record.id) ? 'selected' : undefined}><TableCell><input aria-label={`选择${record.id}`} type="checkbox" disabled={record.status !== 'payable'} checked={selected.includes(record.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, record.id] : current.filter((id) => id !== record.id))} /></TableCell><TableCell>{person(record.lead?.name, record.lead?.phone)}</TableCell><TableCell>{person(record.referrer?.nickname, record.referrer?.phone)}</TableCell><TableCell>{person(record.designer?.displayName, record.designer?.phone)}</TableCell><TableCell>{person(record.measurer?.displayName, record.measurer?.phone)}</TableCell><TableCell><div className="min-w-28 text-sm"><p>{appointmentTime(record.appointment?.timeRange || null)}</p><p className="text-xs text-muted-foreground">{record.appointment?.address || '未预约'}</p></div></TableCell><TableCell><Badge className={`border-0 ${roleMeta[record.role].tone}`}>{roleMeta[record.role].label}</Badge></TableCell><TableCell><p>{record.ruleType === 'fixed' ? '固定金额' : '百分比'}</p><p className="text-xs text-muted-foreground">{record.ruleType === 'fixed' ? `${record.ruleValue} 元/单` : `${record.ruleValue}%`}</p></TableCell><TableCell className="font-semibold">{amount(record.payableAmount)}</TableCell><TableCell><Badge className={`border-0 ${statusMeta[record.status].tone}`}>{statusMeta[record.status].label}</Badge></TableCell></TableRow>) : <TableRow><TableCell colSpan={10} className="py-12 text-center text-muted-foreground">暂无符合条件的签单提成记录</TableCell></TableRow>}</TableBody></Table>
          <div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">共 {records.length} 条记录</p>{totalPages > 1 && <div className="flex items-center gap-2"><Button size="icon-sm" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>‹</Button><span className="text-sm text-muted-foreground">{page} / {totalPages}</span><Button size="icon-sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>›</Button></div>}</div>
        </CardContent>
      </Card>

      <section className="grid gap-4 md:grid-cols-3" aria-label="提成金额汇总">
        {[{ key: 'payable', label: '待支付金额', icon: BanknoteArrowDown, tone: 'text-amber-600 bg-amber-50' }, { key: 'paid', label: '已支付金额', icon: CircleDollarSign, tone: 'text-emerald-600 bg-emerald-50' }, { key: 'voided', label: '已作废金额', icon: UsersRound, tone: 'text-muted-foreground bg-muted' }].map(({ key, label, icon: Icon, tone }) => <Card key={key} className="border-border shadow-sm"><CardContent className="flex items-center gap-4 p-5"><span className={`flex size-11 items-center justify-center rounded-xl ${tone}`}><Icon className="size-5" /></span><div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold text-foreground">{amount(totals[key as CommissionStatus])}</p></div></CardContent></Card>)}
      </section>
    </main>
  );
}
