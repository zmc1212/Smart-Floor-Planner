import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { ensureAiCreditAccount, serializeAiCreditAccount } from '@/lib/ai/credits';

function quotaResponse(account: { balance?: number | bigint; frozenBalance?: number | bigint; version?: number }) {
  const credits = serializeAiCreditAccount(account);
  return {
    credits,
    // One-version compatibility fields for older admin clients.
    tier: 'ai_credits',
    usedCount: 0,
    monthlyLimit: -1,
    bonusCredits: 0,
    remaining: credits.availableBalance,
    balance: credits.balance,
    frozenBalance: credits.frozenBalance,
    availableBalance: credits.availableBalance,
    periodStart: null,
    rechargeHistory: [],
    currency: 'AI_CREDITS',
    dailyUsageSummary: null,
    keyStatus: 'managed_by_platform',
    allowedModels: [],
    lastSyncedAt: null,
    syncError: '',
    keyInfo: null,
  };
}

export async function GET(request: Request) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { requireEnterprise: true }, async (context) => {
      const account = await ensureAiCreditAccount(String(context.enterpriseId));
      return NextResponse.json({ success: true, data: quotaResponse(account) });
    });
  } catch (error) {
    console.error('[AI Quota GET]', error);
    return NextResponse.json({ success: false, error: '读取 AI 点数失败' }, { status: 500 });
  }
}

export async function POST() {
  return NextResponse.json(
    { success: false, error: '企业自助充值与供应商余额同步已弃用，请由平台管理员调整 AI 点数。' },
    { status: 410 }
  );
}
