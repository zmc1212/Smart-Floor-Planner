import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { reconcileDueAiGenerations } from '@/lib/ai/execution-service';

export async function POST(request: Request) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const body = await request.json().catch(() => ({}));
      const results = await reconcileDueAiGenerations(Number(body.limit || 20));
      return NextResponse.json({
        success: true,
        data: results.map((item) => ({ id: String(item._id), status: item.status, externalTask: item.externalTask })),
      });
    });
  } catch (error) {
    console.error('[AI Reconciliation]', error);
    return NextResponse.json({ success: false, error: 'AI 任务对账失败' }, { status: 500 });
  }
}
