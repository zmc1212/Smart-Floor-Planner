'use client';

import { Info, Wallet } from 'lucide-react';

interface AiQuotaBarProps {
  quota: { remaining?: number; balance?: number; frozenBalance?: number; availableBalance?: number; credits?: { balance?: number; frozenBalance?: number; availableBalance?: number } } | null;
  loading?: boolean;
  onRecharge?: () => void;
}

export default function AiQuotaBar({ quota, loading, onRecharge }: AiQuotaBarProps) {
  if (loading) return <div className="animate-pulse border bg-muted/20 p-4"><div className="h-5 w-32 bg-muted" /><div className="mt-3 h-8 bg-muted" /></div>;
  if (!quota) return null;
  const balance = Number(quota.credits?.balance ?? quota.balance ?? 0);
  const frozen = Number(quota.credits?.frozenBalance ?? quota.frozenBalance ?? 0);
  const available = Number(quota.credits?.availableBalance ?? quota.availableBalance ?? quota.remaining ?? Math.max(0, balance - frozen));
  return <div className="border bg-muted/20 p-4"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center bg-emerald-100 text-emerald-700"><Wallet size={18} /></div><div><div className="text-sm font-bold">企业 AI 点数</div><div className="mt-1 flex flex-wrap gap-4 text-sm text-muted-foreground"><span>可用 {available}</span><span>账户 {balance}</span><span>冻结 {frozen}</span></div></div></div>{onRecharge ? <button onClick={onRecharge} className="inline-flex items-center justify-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"><Info size={14} />点数说明</button> : null}</div></div>;
}
