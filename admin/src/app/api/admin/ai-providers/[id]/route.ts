import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { AiProviderConfig } from '@/models/AiProviderConfig';
import { serializeProviderConfig, validateProviderPayload } from '@/lib/ai/provider-admin';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async (context) => {
      const { id } = await params;
      const update = validateProviderPayload(await request.json(), true);
      const provider = await AiProviderConfig.findByIdAndUpdate(
        id,
        { $set: { ...update, updatedBy: context.userId } },
        { returnDocument: 'after', runValidators: true }
      );
      if (!provider) return NextResponse.json({ success: false, error: '供应商不存在' }, { status: 404 });
      return NextResponse.json({ success: true, data: serializeProviderConfig(provider) });
    });
  } catch (error) {
    console.error('[AI Provider PATCH]', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '保存失败' }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async (context) => {
      const { id } = await params;
      const provider = await AiProviderConfig.findByIdAndUpdate(
        id,
        { $set: { enabled: false, updatedBy: context.userId } },
        { returnDocument: 'after' }
      );
      if (!provider) return NextResponse.json({ success: false, error: '供应商不存在' }, { status: 404 });
      return NextResponse.json({ success: true, data: serializeProviderConfig(provider) });
    });
  } catch (error) {
    console.error('[AI Provider DELETE]', error);
    return NextResponse.json({ success: false, error: '停用供应商失败' }, { status: 500 });
  }
}
