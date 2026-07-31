import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { AiProviderConfig } from '@/models/AiProviderConfig';
import { encryptedKeyFields, serializeProviderConfig, validateProviderPayload } from '@/lib/ai/provider-admin';
import { ensureEnvironmentAiProviders } from '@/lib/ai/provider-registry';

export async function GET(request: Request) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      await ensureEnvironmentAiProviders();
      const providers = await AiProviderConfig.find().sort({ priority: 1, createdAt: 1 });
      return NextResponse.json({ success: true, data: providers.map(serializeProviderConfig) });
    });
  } catch (error) {
    console.error('[AI Providers GET]', error);
    return NextResponse.json({ success: false, error: '读取 AI 供应商失败' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async (context) => {
      const body = await request.json();
      const provider = await AiProviderConfig.create({
        ...validateProviderPayload(body),
        ...encryptedKeyFields(body.apiKey, body.adapterType),
        createdBy: context.userId,
        updatedBy: context.userId,
      });
      return NextResponse.json({ success: true, data: serializeProviderConfig(provider) }, { status: 201 });
    });
  } catch (error) {
    console.error('[AI Providers POST]', error);
    const duplicate = (error as { code?: number })?.code === 11000;
    return NextResponse.json(
      { success: false, error: duplicate ? '供应商标识已存在' : error instanceof Error ? error.message : '创建失败' },
      { status: duplicate ? 409 : 400 }
    );
  }
}
