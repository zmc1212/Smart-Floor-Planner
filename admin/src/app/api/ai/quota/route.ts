import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { AiQuota, TIER_LIMITS } from '@/models/AiQuota';
import { getTenantContext } from '@/lib/auth';

/**
 * GET — 查询当前企业 AI 配额
 * POST — 充值/升级
 */
export async function GET(req: Request) {
  try {
    await dbConnect();
    const ctx = await getTenantContext(req);
    if (!ctx || !ctx.enterpriseId) {
      return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
    }

    let quota = await AiQuota.findOne({ enterpriseId: ctx.enterpriseId });
    if (!quota) {
      quota = await AiQuota.create({
        enterpriseId: ctx.enterpriseId,
        tier: 'free',
        monthlyLimit: TIER_LIMITS.free,
      });
    }

    // 检查并重置月度配额
    (quota as any).checkAndResetPeriod();
    await quota.save();

    const remaining = quota.monthlyLimit === -1
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
      }
    });
  } catch (error) {
    console.error('[AI Quota GET]', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}

/**
 * POST — 充值加油包 或 升级等级
 * body: { action: 'recharge' | 'upgrade', credits?: number, tier?: string, amount: number, method: string }
 */
export async function POST(req: Request) {
  try {
    await dbConnect();
    const ctx = await getTenantContext(req);
    if (!ctx || !ctx.enterpriseId) {
      return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
    }

    // 仅企业管理员可操作
    if (ctx.role !== 'enterprise_admin' && ctx.role !== 'super_admin' && ctx.role !== 'admin') {
      return NextResponse.json({ success: false, error: '权限不足' }, { status: 403 });
    }

    const body = await req.json();
    const { action, credits, tier, amount, method } = body;

    let quota = await AiQuota.findOne({ enterpriseId: ctx.enterpriseId });
    if (!quota) {
      quota = await AiQuota.create({
        enterpriseId: ctx.enterpriseId,
        tier: 'free',
        monthlyLimit: TIER_LIMITS.free,
      });
    }

    if (action === 'recharge' && credits && credits > 0) {
      // 购买加油包
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
      // 升级等级
      quota.tier = tier as 'free' | 'basic' | 'pro' | 'enterprise';
      quota.monthlyLimit = TIER_LIMITS[tier];
      quota.usedCount = 0; // 升级后重置本月已用
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

    const remaining = quota.monthlyLimit === -1
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
      }
    });
  } catch (error) {
    console.error('[AI Quota POST]', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
