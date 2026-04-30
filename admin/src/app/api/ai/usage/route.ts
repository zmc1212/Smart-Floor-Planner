import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { EnterpriseAiUsageSnapshot } from '@/models/EnterpriseAiUsageSnapshot';
import { summarizeDailyUsage } from '@/lib/ai/enterprise-ai';

export async function GET(req: Request) {
  try {
    await dbConnect();

    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      const { searchParams } = new URL(req.url);
      const days = Math.max(1, Math.min(Number(searchParams.get('days') || '30'), 90));
      const snapshot = await EnterpriseAiUsageSnapshot.findOne({ enterpriseId: context.enterpriseId }).lean();

      const items = (snapshot?.dailyUsage || [])
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, days * 8);

      return NextResponse.json({
        success: true,
        data: {
          balance: snapshot?.balance ?? 0,
          currency: snapshot?.currency || 'USD',
          keyInfo: snapshot?.keyInfo || null,
          lastSyncedAt: snapshot?.lastSyncedAt || null,
          dailyUsage: items,
          summary: summarizeDailyUsage(snapshot?.dailyUsage || []),
        },
      });
    });
  } catch (error) {
    console.error('[AI Usage GET]', error);
    return NextResponse.json({ success: false, error: '服务端错误' }, { status: 500 });
  }
}
