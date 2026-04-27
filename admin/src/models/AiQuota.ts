import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * AI 配额管理 — 绑定到企业的 AI 会员等级与使用额度
 * 
 * 等级体系:
 *   free       — 5 次/月 (免费)
 *   basic      — 50 次/月 (¥99)
 *   pro        — 200 次/月 (¥299)
 *   enterprise — 无限 (¥999)
 */
export interface IAiQuota extends Document {
  enterpriseId: mongoose.Types.ObjectId;
  tier: 'free' | 'basic' | 'pro' | 'enterprise';
  /** 当月已使用次数 */
  usedCount: number;
  /** 当月配额上限 (-1 = 无限) */
  monthlyLimit: number;
  /** 额外购买的加油包次数 (不随月份重置) */
  bonusCredits: number;
  /** 配额重置日期 (每月1号) */
  periodStart: Date;
  /** 充值记录 */
  rechargeHistory: {
    amount: number;
    credits: number;
    tier?: string;
    method: string;
    orderId?: string;
    createdAt: Date;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

const TIER_LIMITS: Record<string, number> = {
  free: 5,
  basic: 50,
  pro: 200,
  enterprise: -1, // unlimited
};

const AiQuotaSchema: Schema<IAiQuota> = new Schema(
  {
    enterpriseId: {
      type: Schema.Types.ObjectId,
      ref: 'Enterprise',
      required: true,
      unique: true,
    },
    tier: {
      type: String,
      enum: ['free', 'basic', 'pro', 'enterprise'],
      default: 'free',
    },
    usedCount: { type: Number, default: 0 },
    monthlyLimit: { type: Number, default: TIER_LIMITS.free },
    bonusCredits: { type: Number, default: 0 },
    periodStart: { type: Date, default: () => new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
    rechargeHistory: [{
      amount: { type: Number, required: true },
      credits: { type: Number, required: true },
      tier: { type: String },
      method: { type: String, required: true },
      orderId: { type: String },
      createdAt: { type: Date, default: Date.now },
    }],
  },
  { timestamps: true }
);

AiQuotaSchema.index({ enterpriseId: 1 });

/** 
 * 检查是否需要重置月度配额 (每月1号自动重置)
 */
AiQuotaSchema.methods.checkAndResetPeriod = function () {
  const now = new Date();
  const currentPeriodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  if (this.periodStart < currentPeriodStart) {
    this.usedCount = 0;
    this.periodStart = currentPeriodStart;
  }
};

/**
 * 检查是否还有可用配额
 */
AiQuotaSchema.methods.hasQuota = function (): boolean {
  this.checkAndResetPeriod();
  if (this.monthlyLimit === -1) return true; // unlimited
  return (this.usedCount < this.monthlyLimit) || (this.bonusCredits > 0);
};

/**
 * 消费一次配额
 */
AiQuotaSchema.methods.consume = function (): boolean {
  this.checkAndResetPeriod();
  if (this.monthlyLimit === -1) {
    this.usedCount += 1;
    return true;
  }
  if (this.usedCount < this.monthlyLimit) {
    this.usedCount += 1;
    return true;
  }
  if (this.bonusCredits > 0) {
    this.bonusCredits -= 1;
    return true;
  }
  return false;
};

export { TIER_LIMITS };

export const AiQuota: Model<IAiQuota> =
  mongoose.models.AiQuota || mongoose.model<IAiQuota>('AiQuota', AiQuotaSchema);
