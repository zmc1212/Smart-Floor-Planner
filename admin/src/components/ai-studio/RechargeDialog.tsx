'use client';

import React from 'react';
import { Info, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface RechargeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTier?: string;
  onUpgrade?: (tier: string, amount: number) => Promise<void>;
  onRecharge?: (credits: number, amount: number) => Promise<void>;
}

export default function RechargeDialog({ open, onOpenChange }: RechargeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl rounded-[28px] border-none p-0 shadow-2xl">
        <DialogHeader className="border-b bg-muted/20 p-8 pb-6">
          <DialogTitle className="flex items-center gap-3 text-2xl font-bold">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
              <ShieldCheck size={20} />
            </div>
            Pollinations 企业额度说明
          </DialogTitle>
          <DialogDescription>
            这里展示的是企业专属 Pollinations 子 Key 的官方余额与每日用量，不再使用本地点数包或会员档位。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 p-8 text-sm text-muted-foreground">
          <div className="rounded-2xl border bg-white p-4">
            <div className="mb-2 font-semibold text-foreground">当前规则</div>
            <div>1. 每个企业绑定独立的 Pollinations 子 Key。</div>
            <div>2. 企业管理员只能查看本企业余额、每日用量和模型范围。</div>
            <div>3. 充值、预算调整、模型限制和 Key 轮换由平台管理员统一处理。</div>
          </div>

          <div className="rounded-2xl border bg-white p-4">
            <div className="mb-2 flex items-center gap-2 font-semibold text-foreground">
              <Info size={16} />
              需要更多额度时
            </div>
            <div>请联系平台总管理员为当前企业充值 Pollinations 余额或调整预算。</div>
            <div className="mt-1">如果页面上余额或用量看起来不是最新的，可以先触发“同步”或请管理员刷新企业 AI 账户。</div>
          </div>

          <Button className="w-full rounded-xl" onClick={() => onOpenChange(false)}>
            我知道了
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
