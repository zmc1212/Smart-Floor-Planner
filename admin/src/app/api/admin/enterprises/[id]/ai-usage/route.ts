import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { EnterpriseAiUsageSnapshot } from '@/models/EnterpriseAiUsageSnapshot';
import { summarizeDailyUsage } from '@/lib/ai/enterprise-ai';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();

    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const { searchParams } = new URL(request.url);
      const days = Math.max(1, Math.min(Number(searchParams.get('days') || '30'), 90));
      const { id } = await params;
      const snapshot = await EnterpriseAiUsageSnapshot.findOne({ enterpriseId: id }).lean();

      return NextResponse.json({
        success: true,
        data: {
          balance: snapshot?.balance ?? 0,
          currency: snapshot?.currency || 'USD',
          keyInfo: snapshot?.keyInfo || null,
          lastSyncedAt: snapshot?.lastSyncedAt || null,
          syncError: snapshot?.syncError || '',
          dailyUsage: (snapshot?.dailyUsage || [])
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, days * 8),
          summary: summarizeDailyUsage(snapshot?.dailyUsage || []),
        },
      });
    });
  } catch (error) {
    console.error('[Enterprise AI Usage GET]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '服务端错误' },
      { status: 500 }
    );
  }
}
