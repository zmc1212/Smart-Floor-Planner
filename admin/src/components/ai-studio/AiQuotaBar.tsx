'use client';

import { Info, Wallet } from 'lucide-react';
import { Button } from 'antd';

interface AiQuotaBarProps {
  quota: { remaining?: number; balance?: number; frozenBalance?: number; availableBalance?: number; credits?: { balance?: number; frozenBalance?: number; availableBalance?: number } } | null;
  loading?: boolean;
  onRecharge?: () => void;
}

export default function AiQuotaBar({ quota, loading, onRecharge }: AiQuotaBarProps) {
  if (loading) {
    return <div className="animate-pulse rounded-lg border bg-card p-4"><div className="h-4 w-32 rounded bg-muted" /><div className="mt-3 h-7 rounded bg-muted" /></div>;
  }
  if (!quota) return null;

  const balance = Number(quota.credits?.balance ?? quota.balance ?? 0);
  const frozen = Number(quota.credits?.frozenBalance ?? quota.frozenBalance ?? 0);
  const available = Number(quota.credits?.availableBalance ?? quota.availableBalance ?? quota.remaining ?? Math.max(0, balance - frozen));

  return (
    <section className="flex flex-col gap-4 rounded-lg border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Wallet size={17} /></div>
        <div className="min-w-0">
          <div className="text-sm font-semibold">企业 AI 点数</div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>可用 {available}</span><span>账户 {balance}</span><span>冻结 {frozen}</span></div>
        </div>
      </div>
      {onRecharge ? (
        <Button type="text" size="small" className="self-start text-muted-foreground sm:self-auto" onClick={onRecharge} icon={<Info size={14} />}>
          点数说明
        </Button>
      ) : null}
    </section>
  );
}
