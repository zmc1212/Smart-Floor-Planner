'use client';

import { Info, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface RechargeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTier?: string;
  onUpgrade?: (tier: string, amount: number) => Promise<void>;
  onRecharge?: (credits: number, amount: number) => Promise<void>;
}

export default function RechargeDialog({ open, onOpenChange }: RechargeDialogProps) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldCheck size={20} />企业 AI 点数</DialogTitle><DialogDescription>后台与小程序的 AI 功能共用企业点数，不展示或折算任何供应商余额。</DialogDescription></DialogHeader><div className="space-y-4 text-sm text-muted-foreground"><div className="border p-4"><div className="mb-2 font-semibold text-foreground">结算规则</div><p>任务创建时冻结点数，正式结果保存后扣除；明确失败会释放，状态未知会继续冻结并等待系统对账。</p></div><div className="border p-4"><div className="mb-2 flex items-center gap-2 font-semibold text-foreground"><Info size={16} />需要更多点数</div><p>请联系平台管理员在企业 AI 管理页人工发放或调整。本系统当前不提供企业自助充值与微信支付。</p></div><Button className="w-full" onClick={() => onOpenChange(false)}>关闭</Button></div></DialogContent></Dialog>;
}
