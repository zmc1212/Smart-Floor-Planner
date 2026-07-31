import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { AiProviderConfig } from '@/models/AiProviderConfig';
import { encryptedKeyFields, serializeProviderConfig } from '@/lib/ai/provider-admin';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async (context) => {
      const { id } = await params;
      const body = await request.json();
      const existing = await AiProviderConfig.findById(id).select('adapterType');
      if (!existing) return NextResponse.json({ success: false, error: '供应商不存在' }, { status: 404 });
      const provider = await AiProviderConfig.findByIdAndUpdate(
        id,
        {
          $set: { ...encryptedKeyFields(body.apiKey, existing.adapterType), updatedBy: context.userId },
          $unset: {
            lastUpstreamBalance: 1,
            lastUpstreamBalanceUnit: 1,
            lastUpstreamBalanceAt: 1,
            lastUpstreamBalanceMessage: 1,
          },
        },
        { returnDocument: 'after', runValidators: true }
      );
      if (!provider) return NextResponse.json({ success: false, error: '供应商不存在' }, { status: 404 });
      return NextResponse.json({ success: true, data: serializeProviderConfig(provider) });
    });
  } catch (error) {
    console.error('[AI Provider Key Rotate]', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '密钥轮换失败' }, { status: 400 });
  }
}
