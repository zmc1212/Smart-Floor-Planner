import { NextResponse } from 'next/server';
import {
  AiProviderConfigRepository,
  type NewAiProviderConfig,
} from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withPlatformTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';
import { encryptedKeyFields, serializeProviderConfig, validateProviderPayload } from '@/lib/ai/provider-admin';
import { ensureEnvironmentAiProviders } from '@/lib/ai/provider-registry';

export async function GET(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      await ensureEnvironmentAiProviders();
      const providers = await withPlatformTransaction((transaction) =>
        new AiProviderConfigRepository(transaction).list()
      );
      return NextResponse.json({ success: true, data: providers.map(serializeProviderConfig) });
    });
  } catch (error) {
    console.error('[AI Providers GET]', error);
    return NextResponse.json({ success: false, error: '读取 AI 供应商失败' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async (context) => {
      const body = await request.json();
      const provider = await withPlatformTransaction((transaction) =>
        new AiProviderConfigRepository(transaction).create({
          ...validateProviderPayload(body),
          ...encryptedKeyFields(body.apiKey, body.adapterType),
          createdBy: parsePostgresId(context.userId, 'userId'),
          updatedBy: parsePostgresId(context.userId, 'userId'),
        } as unknown as NewAiProviderConfig)
      );
      return NextResponse.json({ success: true, data: serializeProviderConfig(provider) }, { status: 201 });
    });
  } catch (error) {
    console.error('[AI Providers POST]', error);
    const duplicate = String((error as { code?: unknown })?.code) === '23505';
    return NextResponse.json(
      { success: false, error: duplicate ? '供应商标识已存在' : error instanceof Error ? error.message : '创建失败' },
      { status: duplicate ? 409 : 400 }
    );
  }
}
