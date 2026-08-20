'use client';

import { Info, ShieldCheck } from 'lucide-react';
import { Button, Modal, Typography } from 'antd';

interface RechargeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTier?: string;
  onUpgrade?: (tier: string, amount: number) => Promise<void>;
  onRecharge?: (credits: number, amount: number) => Promise<void>;
}

export default function RechargeDialog({ open, onOpenChange }: RechargeDialogProps) {
  return (
    <Modal
      open={open}
      onCancel={() => onOpenChange(false)}
      footer={
        <Button type="primary" block onClick={() => onOpenChange(false)}>
          关闭
        </Button>
      }
      title={
        <span className="inline-flex items-center gap-2">
          <ShieldCheck size={20} />
          企业 AI 点数
        </span>
      }
    >
      <Typography.Paragraph type="secondary" className="!mb-4">
        后台与小程序的 AI 功能共用企业点数，不展示或折算任何供应商余额。
      </Typography.Paragraph>
      <div className="space-y-4 text-sm text-muted-foreground">
        <div className="border p-4">
          <div className="mb-2 font-semibold text-foreground">结算规则</div>
          <p>任务创建时冻结点数，正式结果保存后扣除；明确失败会释放，状态未知会继续冻结并等待系统对账。</p>
        </div>
        <div className="border p-4">
          <div className="mb-2 flex items-center gap-2 font-semibold text-foreground">
            <Info size={16} />
            需要更多点数
          </div>
          <p>请联系平台管理员在企业 AI 管理页人工发放或调整。本系统当前不提供企业自助充值与微信支付。</p>
        </div>
      </div>
    </Modal>
  );
}
