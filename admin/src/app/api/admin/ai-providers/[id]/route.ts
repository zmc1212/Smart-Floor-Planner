import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiProviderConfigRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';
import { serializeProviderConfig, validateProviderPayload } from '@/lib/ai/provider-admin';
import { isPlatformLlmOverrideProvider, type AiProviderAdapterType } from '@/lib/ai/provider-types';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async (context) => {
      const { id } = await params;
      const providerId = parsePostgresId(id);
      const body = await request.json();
      const existing = await withPlatformTransaction((transaction) =>
        new AiProviderConfigRepository(transaction).findById(providerId)
      );
      if (!existing) return NextResponse.json({ success: false, error: 'Provider not found' }, { status: 404 });
      if (isPlatformLlmOverrideProvider(existing.key)) {
        return NextResponse.json({ success: false, error: 'Provider not found' }, { status: 404 });
      }
      const update = validateProviderPayload(
        body,
        true,
        existing.adapterType as AiProviderAdapterType
      );
      const provider = await withPlatformTransaction((transaction) =>
        new AiProviderConfigRepository(transaction).update(providerId, {
          ...update,
          updatedBy: parsePostgresId(context.userId, 'userId'),
        })
      );
      if (!provider) return NextResponse.json({ success: false, error: 'Provider not found' }, { status: 404 });
      return NextResponse.json({ success: true, data: serializeProviderConfig(provider) });
    });
  } catch (error) {
    console.error('[AI Provider PATCH]', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Save failed' }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const { id } = await params;
      const providerId = parsePostgresId(id, 'provider id');
      const provider = await withPlatformTransaction(async (transaction) => {
        const repository = new AiProviderConfigRepository(transaction);
        const existing = await repository.findById(providerId);
        if (!existing || isPlatformLlmOverrideProvider(existing.key)) return null;
        return repository.delete(providerId);
      });
      if (!provider) return NextResponse.json({ success: false, error: 'Provider not found' }, { status: 404 });
      return NextResponse.json({ success: true, data: { id: String(provider.id) } });
    });
  } catch (error) {
    console.error('[AI Provider DELETE]', error);
    const details = error as { code?: string; cause?: { code?: string } };
    const code = details.code ?? details.cause?.code;
    if (code === '23503') {
      return NextResponse.json(
        { success: false, error: '该供应商已有运行审计记录，无法删除。请先停用供应商。' },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Delete failed' }, { status: 400 });
  }
}
