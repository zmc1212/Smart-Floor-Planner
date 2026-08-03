import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiWorkflowRepository, LeadRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';
import { isEligibleWorkflowFloorPlan } from '@/lib/ai/workflow-floorplan';

export async function GET(req: Request) {
  try {
    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      const url = new URL(req.url);
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
      const search = url.searchParams.get('search')?.trim();
      const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterpriseId');
      const { rows: leads, summaries } = await withTenantTransaction(enterpriseId, async (transaction) => {
        const leadRepository = new LeadRepository(transaction);
        const result = await leadRepository.list({
          query: search,
          limit,
          orderBy: 'updatedAt',
        });
        const summaries = await new AiWorkflowRepository(transaction)
          .summarizeActiveByLeadIds(result.rows.map((lead) => lead.id));
        return { rows: result.rows, summaries };
      });
      const workflowMap = new Map(
        summaries.map((summary) => [summary.leadId, summary])
      );

      return NextResponse.json({
        success: true,
        data: leads.map((lead) => {
          const workflowMeta = workflowMap.get(lead.id);
          return {
            id: lead.id.toString(),
            name: lead.name,
            phone: lead.phone,
            status: lead.status,
            stylePreference: lead.stylePreference,
            communityName: lead.communityName,
            floorPlans: lead.floorPlanRecords
              .filter(isEligibleWorkflowFloorPlan)
              .map((plan) => ({
                id: plan.id.toString(),
                name: plan.name,
                layoutData: plan.layoutData,
                createdAt: plan.createdAt,
                status: plan.status,
              })),
            workflowCount: workflowMeta?.count || 0,
            latestWorkflowId: workflowMeta?.latestWorkflowId.toString(),
            latestWorkflowTitle: workflowMeta?.latestWorkflowTitle,
            latestWorkflowUpdatedAt: workflowMeta?.latestUpdatedAt,
            followUpCount: lead.followUpRecords.length,
          };
        }),
      });
    });
  } catch (error) {
    console.error('[AI Workflow Leads GET]', error);
    return NextResponse.json({ success: false, error: 'Failed to load workflow leads' }, { status: 500 });
  }
}
