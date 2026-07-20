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
      const result = await getAiProviderAdapter(runtime.adapterType).testConnection(runtime);
      await AiProviderConfig.updateOne(
        { _id: id },
        { $set: { lastTestedAt: new Date(), lastTestOk: result.ok, lastTestMessage: result.message } }
      );
      return NextResponse.json({ success: result.ok, data: result, error: result.ok ? undefined : result.message }, { status: result.ok ? 200 : 502 });
    });
  } catch (error) {
    console.error('[AI Provider Test]', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '连通测试失败' }, { status: 500 });
  }
}
