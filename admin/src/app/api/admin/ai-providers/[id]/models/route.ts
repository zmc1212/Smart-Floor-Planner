import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiProviderConfigRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';
import { getAiProviderAdapter, getProviderRuntimeById } from '@/lib/ai/provider-registry';
import { httpErrorStatus } from '@/lib/http-error';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const { id } = await params;
      const providerId = parsePostgresId(id);
      const runtime = await getProviderRuntimeById(id);
      const models = await getAiProviderAdapter(runtime.adapterType).listModels(runtime);
      await withPlatformTransaction(async (transaction) => {
        const repository = new AiProviderConfigRepository(transaction);
        const current = await repository.findById(providerId);
        if (current) {
          await repository.update(providerId, {
            operationalState: {
              ...(current.operationalState ?? {}),
              discoveredModels: models,
              lastModelSyncAt: new Date(),
            },
          });
        }
      });
      return NextResponse.json({ success: true, data: { models } });
    });
  } catch (error) {
    console.error('[AI Provider Models]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Model sync failed' },
      { status: httpErrorStatus(error, 502) }
    );
  }
}
