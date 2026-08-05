import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import {
  EnterpriseAiUsageSnapshotRepository,
  EnterpriseRepository,
} from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';
import { serializeEnterpriseAiUsageSnapshot } from '@/lib/ai/enterprise-ai-usage';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const { id } = await params;
      const enterpriseId = parsePostgresId(id, 'enterpriseId');
      const { enterprise, snapshot } = await withPlatformTransaction(async (transaction) => ({
        enterprise: await new EnterpriseRepository(transaction).findById(enterpriseId),
        snapshot: await new EnterpriseAiUsageSnapshotRepository(transaction).findByEnterpriseId(enterpriseId),
      }));
      if (!enterprise) return NextResponse.json({ success: false, error: 'Enterprise not found' }, { status: 404 });
      return NextResponse.json({
        success: true,
        deprecated: true,
        data: { aiConfig: null, snapshot: serializeEnterpriseAiUsageSnapshot(snapshot) },
      });
    });
  } catch (error) {
    console.error('[Legacy Enterprise AI Key GET]', error);
    return NextResponse.json({ success: false, error: '读取旧 AI 配置失败' }, { status: 500 });
  }
}

export async function POST() {
  return NextResponse.json({ success: false, error: '企业 Pollinations 子 Key 管理已弃用，供应商凭证改由平台统一维护。' }, { status: 410 });
}
export async function PATCH() {
  return NextResponse.json({ success: false, error: '企业 Pollinations 子 Key 管理已弃用，供应商凭证改由平台统一维护。' }, { status: 410 });
}
