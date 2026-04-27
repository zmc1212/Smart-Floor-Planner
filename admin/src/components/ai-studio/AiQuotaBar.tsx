'use client';

import React from 'react';
import { Zap, Crown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const TIER_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  free: { label: '免费版', color: 'text-zinc-500 bg-zinc-100', icon: '⚡' },
  basic: { label: '基础版', color: 'text-blue-600 bg-blue-50', icon: '🔷' },
  pro: { label: '专业版', color: 'text-purple-600 bg-purple-50', icon: '💎' },
  enterprise: { label: '企业版', color: 'text-amber-600 bg-amber-50', icon: '👑' },
};

interface AiQuotaBarProps {
  quota: {
    tier: string;
    usedCount: number;
    monthlyLimit: number;
    bonusCredits: number;
    remaining: number;
  } | null;
  loading?: boolean;
  onRecharge?: () => void;
}

export default function AiQuotaBar({ quota, loading, onRecharge }: AiQuotaBarProps) {
  if (loading) {
    return (
      <div className="animate-pulse flex items-center gap-3 p-4 bg-muted/30 rounded-2xl">
        <div className="w-8 h-8 rounded-lg bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-3 bg-muted rounded w-24" />
          <div className="h-2 bg-muted rounded w-32" />
        </div>
      </div>
    );
  }

  if (!quota) return null;

  const tierInfo = TIER_LABELS[quota.tier] || TIER_LABELS.free;
  const isUnlimited = quota.monthlyLimit === -1;
  const percentage = isUnlimited ? 100 : quota.monthlyLimit > 0 ? Math.round((quota.usedCount / quota.monthlyLimit) * 100) : 0;
  const isLow = !isUnlimited && quota.remaining <= 3;

  return (
    <div className={cn(
      "flex items-center gap-4 p-4 rounded-2xl border transition-all",
      isLow ? "bg-red-50/50 border-red-200" : "bg-muted/20 border-muted"
    )}>
      {/* Tier Badge */}
      <div className={cn("shrink-0 px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider", tierInfo.color)}>
        {tierInfo.icon} {tierInfo.label}
      </div>

      {/* Progress */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-bold text-foreground">
            {isUnlimited ? '无限次数' : `${quota.usedCount} / ${quota.monthlyLimit} 次`}
          </span>
          {quota.bonusCredits > 0 && (
            <span className="text-[10px] font-bold text-amber-600">
              +{quota.bonusCredits} 加油包
            </span>
          )}
        </div>
        {!isUnlimited && (
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                isLow ? "bg-red-500" : percentage > 70 ? "bg-amber-500" : "bg-primary"
              )}
              style={{ width: `${Math.min(percentage, 100)}%` }}
            />
          </div>
        )}
      </div>

      {/* Recharge Button */}
      <button
        onClick={onRecharge}
        className={cn(
          "shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all",
          isLow
            ? "bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-200"
            : "bg-primary text-primary-foreground hover:opacity-90"
        )}
      >
        {isLow ? <Zap size={14} /> : <Crown size={14} />}
        {isLow ? '立即充值' : '升级'}
        <ChevronRight size={12} />
      </button>
    </div>
  );
}
