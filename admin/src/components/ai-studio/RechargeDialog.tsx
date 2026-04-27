'use client';

import React, { useState } from 'react';
import { Crown, Zap, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from '@/lib/utils';

const PLANS = [
  {
    id: 'free',
    name: '免费版',
    price: 0,
    priceLabel: '¥0',
    period: '永久',
    credits: 5,
    features: ['基础平面风格转换', '彩色/CAD 风格', '标准分辨率'],
    disabled: ['3D/手绘风格', '高清导出', 'API 集成'],
    popular: false,
  },
  {
    id: 'basic',
    name: '基础版',
    price: 99,
    priceLabel: '¥99',
    period: '/月',
    credits: 50,
    features: ['全部平面风格转换', '彩色/CAD/3D/手绘', '标准分辨率', '生成历史'],
    disabled: ['高清导出', 'API 集成'],
    popular: false,
  },
  {
    id: 'pro',
    name: '专业版',
    price: 299,
    priceLabel: '¥299',
    period: '/月',
    credits: 200,
    features: ['全部平面 + 软装风格', '高清 2K 导出', '批量生成', '优先队列', '生成历史'],
    disabled: ['API 集成'],
    popular: true,
  },
  {
    id: 'enterprise',
    name: '企业版',
    price: 999,
    priceLabel: '¥999',
    period: '/月',
    credits: -1,
    features: ['不限次数', '全功能解锁', '4K 超清导出', 'API 集成', '专属客服', '品牌定制'],
    disabled: [],
    popular: false,
  },
];

const BOOST_PACKS = [
  { credits: 10, price: 29, label: '10 次加油包' },
  { credits: 30, price: 69, label: '30 次加油包' },
  { credits: 100, price: 199, label: '100 次加油包' },
];

interface RechargeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTier?: string;
  onUpgrade: (tier: string, amount: number) => Promise<void>;
  onRecharge: (credits: number, amount: number) => Promise<void>;
}

export default function RechargeDialog({ open, onOpenChange, currentTier = 'free', onUpgrade, onRecharge }: RechargeDialogProps) {
  const [tab, setTab] = useState<'plans' | 'boost'>('plans');
  const [loading, setLoading] = useState(false);

  const handleUpgrade = async (planId: string, price: number) => {
    if (planId === currentTier) return;
    setLoading(true);
    try {
      await onUpgrade(planId, price);
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  const handleBoost = async (credits: number, price: number) => {
    setLoading(true);
    try {
      await onRecharge(credits, price);
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden rounded-[32px] border-none shadow-2xl">
        <DialogHeader className="p-8 pb-4 bg-gradient-to-b from-purple-50/80 to-transparent border-b">
          <DialogTitle className="text-2xl font-bold flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-600 rounded-2xl flex items-center justify-center">
              <Crown className="text-white" size={20} />
            </div>
            AI 会员中心
          </DialogTitle>
          <DialogDescription>
            升级会员解锁更多 AI 生成次数和高级功能
          </DialogDescription>
        </DialogHeader>

        {/* Tab Switcher */}
        <div className="px-8 pt-4">
          <div className="flex gap-2 bg-muted/30 p-1 rounded-xl w-fit">
            <button
              onClick={() => setTab('plans')}
              className={cn(
                "px-6 py-2 rounded-lg text-sm font-bold transition-all",
                tab === 'plans' ? "bg-white shadow-sm text-foreground" : "text-muted-foreground"
              )}
            >
              会员套餐
            </button>
            <button
              onClick={() => setTab('boost')}
              className={cn(
                "px-6 py-2 rounded-lg text-sm font-bold transition-all",
                tab === 'boost' ? "bg-white shadow-sm text-foreground" : "text-muted-foreground"
              )}
            >
              加油包
            </button>
          </div>
        </div>

        <div className="p-8 pt-6 max-h-[60vh] overflow-y-auto">
          {tab === 'plans' ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {PLANS.map((plan) => {
                const isCurrent = plan.id === currentTier;
                return (
                  <div
                    key={plan.id}
                    className={cn(
                      "relative flex flex-col p-6 rounded-2xl border-2 transition-all",
                      plan.popular ? "border-purple-500 shadow-lg shadow-purple-100" : "border-muted",
                      isCurrent && "bg-muted/30"
                    )}
                  >
                    {plan.popular && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-purple-600 text-white text-[10px] font-black px-4 py-1 rounded-full uppercase tracking-wider">
                        推荐
                      </div>
                    )}
                    <h3 className="text-lg font-bold mb-1">{plan.name}</h3>
                    <div className="flex items-baseline gap-1 mb-4">
                      <span className="text-3xl font-black">{plan.priceLabel}</span>
                      <span className="text-xs text-muted-foreground">{plan.period}</span>
                    </div>
                    <div className="text-sm font-bold text-primary mb-4">
                      {plan.credits === -1 ? '不限次数' : `${plan.credits} 次/月`}
                    </div>
                    <div className="space-y-2 flex-1 mb-6">
                      {plan.features.map((f) => (
                        <div key={f} className="flex items-center gap-2 text-xs">
                          <Check size={14} className="text-green-500 shrink-0" />
                          <span>{f}</span>
                        </div>
                      ))}
                      {plan.disabled.map((f) => (
                        <div key={f} className="flex items-center gap-2 text-xs text-muted-foreground/50">
                          <X size={14} className="shrink-0" />
                          <span className="line-through">{f}</span>
                        </div>
                      ))}
                    </div>
                    <Button
                      disabled={isCurrent || loading}
                      onClick={() => handleUpgrade(plan.id, plan.price)}
                      variant={isCurrent ? "outline" : plan.popular ? "default" : "outline"}
                      className={cn(
                        "w-full rounded-xl h-10 font-bold",
                        plan.popular && !isCurrent && "bg-purple-600 hover:bg-purple-700 text-white"
                      )}
                    >
                      {isCurrent ? '当前方案' : plan.price === 0 ? '降级' : '立即升级'}
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-6">
              {BOOST_PACKS.map((pack) => (
                <div
                  key={pack.credits}
                  className="flex flex-col items-center p-8 rounded-2xl border-2 border-muted hover:border-primary hover:shadow-lg transition-all"
                >
                  <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mb-4">
                    <Zap className="text-amber-500" size={28} />
                  </div>
                  <h3 className="text-lg font-bold mb-1">{pack.label}</h3>
                  <p className="text-xs text-muted-foreground mb-4">不限月份，永不过期</p>
                  <div className="text-2xl font-black mb-6">¥{pack.price}</div>
                  <Button
                    disabled={loading}
                    onClick={() => handleBoost(pack.credits, pack.price)}
                    variant="outline"
                    className="w-full rounded-xl h-10 font-bold hover:bg-primary hover:text-primary-foreground"
                  >
                    立即购买
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-8 pb-6 text-center text-[11px] text-muted-foreground">
          支付完成后配额即时生效 · 如需发票请联系客服 · 会员权益以实际方案为准
        </div>
      </DialogContent>
    </Dialog>
  );
}
