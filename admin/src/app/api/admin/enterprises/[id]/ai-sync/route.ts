import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { EnterpriseAiUsageSnapshot } from '@/models/EnterpriseAiUsageSnapshot';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const { id } = await params;
      const snapshot = await EnterpriseAiUsageSnapshot.findOne({ enterpriseId: id }).lean();
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
