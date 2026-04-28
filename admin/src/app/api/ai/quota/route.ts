import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { AiQuota, TIER_LIMITS } from '@/models/AiQuota';
import { withTenantRoute } from '@/lib/tenant-route';

interface QuotaActionBody {
  action?: 'recharge' | 'upgrade';
  credits?: number;
  tier?: keyof typeof TIER_LIMITS;
  amount?: number;
  method?: string;
}

export async function GET(req: Request) {
  try {
    await dbConnect();

    return await withTenantRoute(
      req,
      { requireEnterprise: true },
      async (context) => {
        let quota = await AiQuota.findOne({ enterpriseId: context.enterpriseId });
        if (!quota) {
          quota = await AiQuota.create({
            enterpriseId: context.enterpriseId,
            tier: 'free',
            monthlyLimit: TIER_LIMITS.free,
          });
        }

        (quota as any).checkAndResetPeriod();
        await quota.save();

        const remaining =
          quota.monthlyLimit === -1
            ? -1
            : Math.max(0, quota.monthlyLimit - quota.usedCount) + quota.bonusCredits;

        return NextResponse.json({
          success: true,
          data: {
            tier: quota.tier,
            usedCount: quota.usedCount,
            monthlyLimit: quota.monthlyLimit,
            bonusCredits: quota.bonusCredits,
            remaining,
            periodStart: quota.periodStart,
            rechargeHistory: quota.rechargeHistory?.slice(-10) || [],
          },
        });
      }
    );
  } catch (error) {
    console.error('[AI Quota GET]', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await dbConnect();

    return await withTenantRoute(
      req,
      { roles: ['enterprise_admin', 'super_admin', 'admin'], requireEnterprise: true },
      async (context) => {
        const body = (await req.json()) as QuotaActionBody;
        const { action, credits, tier, amount, method } = body;

        let quota = await AiQuota.findOne({ enterpriseId: context.enterpriseId });
        if (!quota) {
          quota = await AiQuota.create({
            enterpriseId: context.enterpriseId,
            tier: 'free',
            monthlyLimit: TIER_LIMITS.free,
          });
        }

        if (action === 'recharge' && credits && credits > 0) {
          quota.bonusCredits += credits;
          quota.rechargeHistory.push({
            amount: amount || 0,
            credits,
            method: method || 'manual',
            orderId: `ORD-${Date.now()}`,
            createdAt: new Date(),
          });
          await quota.save();
        } else if (action === 'upgrade' && tier && TIER_LIMITS[tier] !== undefined) {
          quota.tier = tier as 'free' | 'basic' | 'pro' | 'enterprise';
          quota.monthlyLimit = TIER_LIMITS[tier];
          quota.usedCount = 0;
          quota.periodStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
          quota.rechargeHistory.push({
            amount: amount || 0,
            credits: 0,
            tier,
            method: method || 'manual',
            orderId: `ORD-${Date.now()}`,
            createdAt: new Date(),
          });
          await quota.save();
        } else {
          return NextResponse.json({ success: false, error: '无效操作' }, { status: 400 });
        }

        const remaining =
          quota.monthlyLimit === -1
            ? -1
            : Math.max(0, quota.monthlyLimit - quota.usedCount) + quota.bonusCredits;

        return NextResponse.json({
          success: true,
          data: {
            tier: quota.tier,
            usedCount: quota.usedCount,
            monthlyLimit: quota.monthlyLimit,
            bonusCredits: quota.bonusCredits,
            remaining,
          },
        });
      }
    );
  } catch (error) {
    console.error('[AI Quota POST]', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
