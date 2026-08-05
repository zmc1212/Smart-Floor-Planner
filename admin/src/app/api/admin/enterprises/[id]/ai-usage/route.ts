import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { EnterpriseAiUsageSnapshotRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';
import {
  serializeEnterpriseAiUsageSnapshot,
  summarizeEnterpriseAiDailyUsage,
} from '@/lib/ai/enterprise-ai-usage';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const { searchParams } = new URL(request.url);
      const days = Math.max(1, Math.min(Number(searchParams.get('days') || '30'), 90));
      const { id } = await params;
      const enterpriseId = parsePostgresId(id, 'enterpriseId');
      const snapshot = serializeEnterpriseAiUsageSnapshot(
        await withPlatformTransaction((transaction) =>
          new EnterpriseAiUsageSnapshotRepository(transaction).findByEnterpriseId(enterpriseId)
        )
      );

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
          summary: summarizeEnterpriseAiDailyUsage(snapshot?.dailyUsage || []),
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
