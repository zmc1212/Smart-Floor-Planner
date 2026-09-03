import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiProviderConfigRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';
import { encryptedKeyFields, serializeProviderConfig } from '@/lib/ai/provider-admin';
import { isPlatformLlmOverrideProvider, type AiProviderAdapterType } from '@/lib/ai/provider-types';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
      const provider = await withPlatformTransaction((transaction) =>
        new AiProviderConfigRepository(transaction).update(providerId, {
          ...encryptedKeyFields(
            body.apiKey,
            existing.adapterType as AiProviderAdapterType
          ),
          operationalState: {},
          updatedBy: parsePostgresId(context.userId, 'userId'),
        })
      );
      if (!provider) return NextResponse.json({ success: false, error: 'Provider not found' }, { status: 404 });
      return NextResponse.json({ success: true, data: serializeProviderConfig(provider) });
    });
  } catch (error) {
    console.error('[AI Provider Key Rotate]', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Key rotation failed' }, { status: 400 });
  }
}
