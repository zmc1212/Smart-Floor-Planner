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
      const result = await getAiProviderAdapter(runtime.adapterType).testConnection(runtime);
      await withPlatformTransaction(async (transaction) => {
        const repository = new AiProviderConfigRepository(transaction);
        const current = await repository.findById(providerId);
        if (current) {
          await repository.update(providerId, {
            operationalState: {
              ...(current.operationalState ?? {}),
              lastTestedAt: new Date(),
              lastTestOk: result.ok,
              lastTestMessage: result.message,
            },
          });
        }
      });
      return NextResponse.json({ success: result.ok, data: result, error: result.ok ? undefined : result.message }, { status: result.ok ? 200 : 502 });
    });
  } catch (error) {
    console.error('[AI Provider Test]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Connection test failed' },
      { status: httpErrorStatus(error, 502) }
    );
  }
}
