import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiWorkflowRepository, LeadRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { isEligibleWorkflowFloorPlan } from '@/lib/ai/workflow-floorplan';
import { isMiniStudioContext, requireMiniStudioContext } from '@/lib/ai/mini-ai-studio';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await requireMiniStudioContext(request);
    if (!isMiniStudioContext(context)) return context;
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
    const search = url.searchParams.get('search')?.trim();
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
    const operatorId = parsePostgresId(context.operatorId, 'operatorId');
    const data = await withTenantTransaction(enterpriseId, async (transaction) => {
      const leadRepository = new LeadRepository(transaction);
      const result = await leadRepository.list({ query: search, limit, orderBy: 'updatedAt' });
      const visibleLeads = result.rows.filter((lead) => (
        context.role === 'enterprise_admin'
        || (context.role === 'designer' && lead.assignedTo === operatorId)
      )).filter((lead) => !lead.archivedAt);
      const summaries = await new AiWorkflowRepository(transaction)
        .summarizeActiveByLeadIds(visibleLeads.map((lead) => lead.id));
      const workflowMap = new Map(summaries.map((summary) => [summary.leadId, summary]));
      return visibleLeads.map((lead) => {
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
              createdAt: plan.createdAt,
              status: plan.status,
            })),
          workflowCount: workflowMeta?.count || 0,
          latestWorkflowId: workflowMeta?.latestWorkflowId.toString(),
          latestWorkflowTitle: workflowMeta?.latestWorkflowTitle,
          latestWorkflowUpdatedAt: workflowMeta?.latestUpdatedAt,
          followUpCount: lead.followUpRecords.length,
        };
      });
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[Mini AI Studio Leads GET]', error);
    return NextResponse.json({ success: false, error: '读取可设计客户失败' }, { status: 500 });
  }
}
