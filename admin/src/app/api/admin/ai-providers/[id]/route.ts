import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiProviderConfigRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';
import { serializeProviderConfig, validateProviderPayload } from '@/lib/ai/provider-admin';
import type { AiProviderAdapterType } from '@/lib/ai/provider-types';

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
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async (context) => {
      const { id } = await params;
      const provider = await withPlatformTransaction((transaction) =>
        new AiProviderConfigRepository(transaction).update(parsePostgresId(id), {
          enabled: false,
          updatedBy: parsePostgresId(context.userId, 'userId'),
        })
      );
      if (!provider) return NextResponse.json({ success: false, error: 'Provider not found' }, { status: 404 });
      return NextResponse.json({ success: true, data: serializeProviderConfig(provider) });
    });
  } catch (error) {
    console.error('[AI Provider DELETE]', error);
    return NextResponse.json({ success: false, error: 'Disable failed' }, { status: 500 });
  }
}
