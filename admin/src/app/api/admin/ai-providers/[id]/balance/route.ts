import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { AiProviderConfig } from '@/models/AiProviderConfig';
import { getAiProviderAdapter, getProviderRuntimeById } from '@/lib/ai/provider-registry';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const { id } = await params;
      const runtime = await getProviderRuntimeById(id);
      const adapter = getAiProviderAdapter(runtime.adapterType);
      if (!adapter.getBalance) {
        return NextResponse.json(
          { success: false, error: `${runtime.name} 适配器不支持余额查询` },
          { status: 422 }
        );
      }

      try {
        const result = await adapter.getBalance(runtime);
        const checkedAt = new Date();
        await AiProviderConfig.updateOne(
          { _id: id },
          {
            $set: {
              lastUpstreamBalance: result.balance,
              lastUpstreamBalanceUnit: result.unit,
              lastUpstreamBalanceAt: checkedAt,
              lastUpstreamBalanceMessage: '',
            },
          }
        );
        return NextResponse.json({ success: true, data: { ...result, checkedAt } });
      } catch (error) {
        const message = error instanceof Error ? error.message : '上游余额查询失败';
        await AiProviderConfig.updateOne(
          { _id: id },
          { $set: { lastUpstreamBalanceAt: new Date(), lastUpstreamBalanceMessage: message } }
        );
        return NextResponse.json({ success: false, error: message }, { status: 502 });
      }
    });
  } catch (error) {
    console.error('[AI Provider Balance]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '上游余额查询失败' },
      { status: 500 }
    );
  }
}
