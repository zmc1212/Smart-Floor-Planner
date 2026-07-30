import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { ensureAiCreditAccount, getAiCreditPrice, serializeAiCreditAccount } from '@/lib/ai/credits';
import { ensureDefaultAiCreationModelProfiles, serializeCreationModelProfile } from '@/lib/ai/creation-service';
import { listProviderRuntimes } from '@/lib/ai/provider-registry';
import { AiWorkflow } from '@/models/AiWorkflow';
import Lead from '@/models/Lead';
import { getEnterpriseAiPolicy } from '@/lib/ai/enterprise-policy';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { requireEnterprise: true }, async (context) => {
      const enterpriseId = String(context.enterpriseId);
      const [profiles, account, price, generateProviders, editProviders, workflows, policy] = await Promise.all([
        ensureDefaultAiCreationModelProfiles(),
        ensureAiCreditAccount(enterpriseId),
        getAiCreditPrice('image.free_create'),
        listProviderRuntimes('image.generate', 'image.generate.standard').catch(() => []),
        listProviderRuntimes('image.edit', 'image.edit.standard').catch(() => []),
        AiWorkflow.find({ status: 'active' }).sort({ updatedAt: -1 }).limit(50).lean(),
        getEnterpriseAiPolicy(enterpriseId),
      ]);
      const leadIds = [...new Set(workflows.map((item) => String(item.leadId)))];
      const leads = leadIds.length
        ? await Lead.find({ _id: { $in: leadIds } }).select('name communityName phone').lean()
        : [];
      const leadById = new Map(leads.map((lead) => [String(lead._id), lead]));
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
            .map(serializeCreationModelProfile),
          workflows: workflows.map((workflow) => {
            const lead = leadById.get(String(workflow.leadId));
            return {
              id: String(workflow._id),
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
