import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { Enterprise } from '@/models/Enterprise';
import { EnterpriseAiUsageSnapshot } from '@/models/EnterpriseAiUsageSnapshot';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const { id } = await params;
      const [enterprise, snapshot] = await Promise.all([
        Enterprise.findById(id).select('aiConfig.provider aiConfig.keyMode aiConfig.pollinationsKeyRef aiConfig.pollinationsKeyName aiConfig.pollinationsMaskedKey aiConfig.allowedCapabilities aiConfig.allowedModels aiConfig.pollenBudget aiConfig.lastSyncedAt').lean(),
        EnterpriseAiUsageSnapshot.findOne({ enterpriseId: id }).lean(),
      ]);
      if (!enterprise) return NextResponse.json({ success: false, error: 'Enterprise not found' }, { status: 404 });
      return NextResponse.json({ success: true, deprecated: true, data: { aiConfig: enterprise.aiConfig || null, snapshot } });
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
