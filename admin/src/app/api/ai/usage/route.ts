import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { EnterpriseAiUsageSnapshotRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';
import {
  serializeEnterpriseAiUsageSnapshot,
  summarizeEnterpriseAiDailyUsage,
} from '@/lib/ai/enterprise-ai-usage';

export async function GET(req: Request) {
  try {
    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      const { searchParams } = new URL(req.url);
      const days = Math.max(1, Math.min(Number(searchParams.get('days') || '30'), 90));
      const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
      const snapshot = serializeEnterpriseAiUsageSnapshot(
        await withTenantTransaction(enterpriseId, (transaction) =>
          new EnterpriseAiUsageSnapshotRepository(transaction).findByEnterpriseId(enterpriseId)
        )
      );

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
          summary: summarizeEnterpriseAiDailyUsage(snapshot?.dailyUsage || []),
        },
      });
    });
  } catch (error) {
    console.error('[AI Usage GET]', error);
    return NextResponse.json({ success: false, error: '服务端错误' }, { status: 500 });
  }
}
