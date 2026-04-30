'use client';

import React from 'react';
import { RefreshCw, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DailyUsageSummaryItem {
  date: string;
  requests: number;
  costUsd: number;
}

interface AiQuotaBarProps {
  quota: {
    tier?: string;
    usedCount?: number;
    monthlyLimit?: number;
    bonusCredits?: number;
    remaining?: number;
    balance?: number;
    currency?: string;
    keyStatus?: string;
    allowedModels?: string[];
    lastSyncedAt?: string | Date | null;
    syncError?: string;
    dailyUsageSummary?: {
      today?: {
        requests: number;
        costUsd: number;
      };
      recent7Days?: DailyUsageSummaryItem[];
    };
  } | null;
  loading?: boolean;
  onRecharge?: () => void;
}

function statusTone(status?: string) {
  switch (status) {
    case 'configured':
      return 'bg-emerald-100 text-emerald-700';
    case 'invalid':
      return 'bg-amber-100 text-amber-700';
    default:
      return 'bg-zinc-100 text-zinc-600';
  }
}

function statusLabel(status?: string) {
  switch (status) {
    case 'configured':
      return '已配置';
    case 'invalid':
      return 'Key 无效';
    default:
      return '未配置';
  }
}

export default function AiQuotaBar({ quota, loading, onRecharge }: AiQuotaBarProps) {
  if (loading) {
    return (
      <div className="animate-pulse rounded-2xl border bg-muted/20 p-4">
        <div className="h-5 w-32 rounded bg-muted" />
        <div className="mt-3 h-10 rounded bg-muted" />
      </div>
    );
  }

  if (!quota) return null;

  const balance = Number(quota.balance ?? quota.remaining ?? 0);
  const todayUsage = quota.dailyUsageSummary?.today?.requests ?? quota.usedCount ?? 0;
  const todayCost = quota.dailyUsageSummary?.today?.costUsd ?? 0;
  const isUnavailable = quota.keyStatus === 'invalid';

  return (
    <div
      className={cn(
        'rounded-2xl border p-4 transition-all',
        isUnavailable ? 'border-amber-200 bg-amber-50/60' : 'border-muted bg-muted/20'
      )}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
            <Wallet size={18} />
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold">Pollinations 企业额度</span>
              <span
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] font-bold uppercase',
                  statusTone(quota.keyStatus)
                )}
              >
                {statusLabel(quota.keyStatus)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span>
                官方余额 {balance.toFixed(2)} {quota.currency || 'USD'}
              </span>
              <span>今日请求 {todayUsage}</span>
              <span>今日费用 ${todayCost.toFixed(2)}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              允许模型：{quota.allowedModels?.length ? quota.allowedModels.join(', ') : '未限制 / 未配置'}
            </div>
            <div className="text-xs text-muted-foreground">
              最近同步：{quota.lastSyncedAt ? new Date(quota.lastSyncedAt).toLocaleString() : '未同步'}
            </div>
            {quota.syncError ? (
              <div className="text-xs text-red-600">同步异常：{quota.syncError}</div>
            ) : null}
          </div>
        </div>

        <button
          onClick={onRecharge}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <RefreshCw size={14} />
          查看说明
        </button>
      </div>
    </div>
  );
}
