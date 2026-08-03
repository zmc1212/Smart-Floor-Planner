import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiWorkflowRepository, LeadRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';
import { ensureAiCreditAccount, getAiCreditPrice, serializeAiCreditAccount } from '@/lib/ai/credits';
import {
  listPostgresExecutableImageModelProfiles,
  listPostgresImageModelPrices,
  serializePostgresCatalogProfile,
  serializeImageModelPrice,
} from '@/lib/ai/image-model-catalog';
import { listProviderRuntimes } from '@/lib/ai/provider-registry';
import { getEnterpriseAiPolicy } from '@/lib/ai/enterprise-policy';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    return await withTenantRoute(request, { requireEnterprise: true }, async (context) => {
      const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterpriseId');
      const profilesPromise = listPostgresExecutableImageModelProfiles();
      const modelPricesPromise = profilesPromise.then(() => listPostgresImageModelPrices());
      const [profiles, modelPrices, account, price, generateProviders, editProviders, workflowRows, policy] = await Promise.all([
        profilesPromise,
        modelPricesPromise,
        ensureAiCreditAccount(enterpriseId.toString()),
        getAiCreditPrice('image.free_create'),
        listProviderRuntimes('image.generate', 'image.generate.standard').catch(() => []),
        listProviderRuntimes('image.edit', 'image.edit.standard').catch(() => []),
        withTenantTransaction(enterpriseId, async (transaction) => {
          const workflows = await new AiWorkflowRepository(transaction).list({ status: 'active', limit: 50 });
          const leads = await new LeadRepository(transaction).findByIds(workflows.rows.map((workflow) => workflow.leadId));
          return { workflows: workflows.rows, leads };
        }),
        getEnterpriseAiPolicy(enterpriseId.toString()),
      ]);
      const leadById = new Map(workflowRows.leads.map((lead) => [lead.id, lead]));
      return NextResponse.json({
        success: true,
        data: {
          account: serializeAiCreditAccount(account),
          price: { actionKey: price.actionKey, label: price.label, credits: price.credits },
          provider: {
            actionEnabled: policy.enabledActionKeys.includes('image.free_create'),
            supportsGenerate: generateProviders.length > 0,
            supportsEdit: editProviders.length > 0,
          },
          models: profiles
            .filter((profile) => profile.enabled)
            .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))
            .map((profile) => {
              const enabledPrices = modelPrices
                .filter((item) => item.enabled && item.modelProfileKey === profile.key);
              const serialized = serializePostgresCatalogProfile(profile);
              const defaultResolutionTier = enabledPrices.some(
                (item) => item.resolutionTier === serialized.defaults.resolutionTier
              )
                ? serialized.defaults.resolutionTier
                : enabledPrices[0]?.resolutionTier || serialized.defaults.resolutionTier;
              return {
                ...serialized,
                resolutionTiers: enabledPrices.map((item) => item.resolutionTier),
                defaults: { ...serialized.defaults, resolutionTier: defaultResolutionTier },
                prices: enabledPrices.map(serializeImageModelPrice),
              };
            }),
          workflows: workflowRows.workflows.map((workflow) => {
            const lead = leadById.get(workflow.leadId);
            return {
              id: workflow.id.toString(),
              title: workflow.title,
              leadName: lead?.name || '',
              communityName: lead?.communityName || '',
            };
          }),
        },
      });
    });
  } catch (error) {
    console.error('[AI Creation Bootstrap]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '加载创作台失败' },
      { status: 500 }
    );
  }
}
