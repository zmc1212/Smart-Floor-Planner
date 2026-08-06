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
      const adapter = getAiProviderAdapter(runtime.adapterType);
      if (!adapter.getBalance) {
        return NextResponse.json(
          { success: false, error: `${runtime.name} adapter does not support balance checks` },
          { status: 422 }
        );
      }

      const checkedAt = new Date();
      try {
        const result = await adapter.getBalance(runtime);
        await withPlatformTransaction(async (transaction) => {
          const repository = new AiProviderConfigRepository(transaction);
          const current = await repository.findById(providerId);
          if (current) {
            await repository.update(providerId, {
              operationalState: {
                ...(current.operationalState ?? {}),
                lastUpstreamBalance: result.balance,
                lastUpstreamBalanceUnit: result.unit,
                lastUpstreamBalanceAt: checkedAt,
                lastUpstreamBalanceMessage: '',
              },
            });
          }
        });
        return NextResponse.json({ success: true, data: { ...result, checkedAt } });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Upstream balance check failed';
        await withPlatformTransaction(async (transaction) => {
          const repository = new AiProviderConfigRepository(transaction);
          const current = await repository.findById(providerId);
          if (current) {
            await repository.update(providerId, {
              operationalState: {
                ...(current.operationalState ?? {}),
                lastUpstreamBalanceAt: checkedAt,
                lastUpstreamBalanceMessage: message,
              },
            });
          }
        });
        return NextResponse.json({ success: false, error: message }, { status: 502 });
      }
    });
  } catch (error) {
    console.error('[AI Provider Balance]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Upstream balance check failed' },
      { status: httpErrorStatus(error, 500) }
    );
  }
}
