import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { EnterpriseAiUsageSnapshotRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';
import { serializeEnterpriseAiUsageSnapshot } from '@/lib/ai/enterprise-ai-usage';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const { id } = await params;
      const enterpriseId = parsePostgresId(id, 'enterpriseId');
      const snapshot = serializeEnterpriseAiUsageSnapshot(
        await withPlatformTransaction((transaction) =>
          new EnterpriseAiUsageSnapshotRepository(transaction).findByEnterpriseId(enterpriseId)
        )
      );
      return NextResponse.json({ success: true, deprecated: true, data: snapshot });
    });
  } catch (error) {
    console.error('[Legacy Enterprise AI Sync GET]', error);
    return NextResponse.json({ success: false, error: '读取旧供应商快照失败' }, { status: 500 });
  }
}

export async function POST() {
  return NextResponse.json({ success: false, error: '该 Pollinations 同步接口已弃用，请使用平台 AI 供应商与统一点数接口。' }, { status: 410 });
}
