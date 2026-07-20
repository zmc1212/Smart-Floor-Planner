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
      const models = await getAiProviderAdapter(runtime.adapterType).listModels(runtime);
      await AiProviderConfig.updateOne(
        { _id: id },
        { $set: { discoveredModels: models, lastModelSyncAt: new Date() } }
      );
      return NextResponse.json({ success: true, data: { models } });
    });
  } catch (error) {
    console.error('[AI Provider Models]', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '模型同步失败' }, { status: 502 });
  }
}
