import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiWorkflowRepository, LeadRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';
import { ensureAiCreditAccount, getAiCreditPrice, serializeAiCreditAccount } from '@/lib/ai/credits';
import { listPostgresWorkbenchImageModels } from '@/lib/ai/image-model-catalog';
import { listProviderRuntimes } from '@/lib/ai/provider-registry';
import { getEnterpriseAiPolicy } from '@/lib/ai/enterprise-policy';
import { serializeWorkbenchProviderState } from '@/lib/ai/workbench-studio';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    return await withTenantRoute(request, { requireEnterprise: true }, async (context) => {
      const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterpriseId');
      const [models, account, price, generateProviders, editProviders, workflowRows, policy] = await Promise.all([
        listPostgresWorkbenchImageModels(),
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
          provider: serializeWorkbenchProviderState({
            actionEnabled: policy.enabledActionKeys.includes('image.free_create'),
            generateProviders,
            editProviders,
          }),
          models,
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
