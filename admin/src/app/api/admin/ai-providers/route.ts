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

export async function DELETE(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const body = await request.json();
      if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 100) {
        return NextResponse.json(
          { success: false, error: '请选择 1-100 个供应商进行删除。' },
          { status: 400 },
        );
      }

      const ids: bigint[] = [...new Set<bigint>(
        body.ids.map((id: unknown) => parsePostgresId(String(id), 'provider id'))
      )];
      const result = await withPlatformTransaction(async (transaction) => {
        const repository = new AiProviderConfigRepository(transaction);
        const blockedIdSet = await repository.findAttemptReferencedIds(ids);
        const deletableIds = ids.filter((id) => !blockedIdSet.has(id));
        const deleted = await repository.deleteMany(deletableIds);
        const deletedIdSet = new Set(deleted.map((provider) => provider.id));
        return {
          deletedIds: deleted.map((provider) => provider.id.toString()),
          blockedIds: ids
            .filter((id) => blockedIdSet.has(id))
            .map((id) => id.toString()),
          missingIds: deletableIds
            .filter((id) => !deletedIdSet.has(id))
            .map((id) => id.toString()),
        };
      });

      return NextResponse.json({ success: true, data: result });
    });
  } catch (error) {
    console.error('[AI Providers DELETE]', error);
    const details = error as { code?: string; cause?: { code?: string } };
    const code = details.code ?? details.cause?.code;
    if (code === '23503') {
      return NextResponse.json(
        { success: false, error: '删除期间检测到新的运行审计记录，未删除任何供应商。请刷新后重试。' },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '批量删除失败' },
      { status: 400 },
    );
  }
}
