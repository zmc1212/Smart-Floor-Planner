import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiWorkflowRepository, LeadRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { isEligibleWorkflowFloorPlan } from '@/lib/ai/workflow-floorplan';
import { isMiniStudioContext, requireMiniStudioContext } from '@/lib/ai/mini-ai-studio';
import { resolveLeadServiceStage } from '@/lib/lead-service-stage';
import { createPaginationMetadata, getPaginationParams } from '@/lib/pagination';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await requireMiniStudioContext(request);
    if (!isMiniStudioContext(context)) return context;
    const url = new URL(request.url);
    const { page, limit } = getPaginationParams(url);
    const search = url.searchParams.get('search')?.trim();
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
    const operatorId = parsePostgresId(context.operatorId, 'operatorId');
    const listed = await withTenantTransaction(enterpriseId, async (transaction) => {
      const leadRepository = new LeadRepository(transaction);
      const result = await leadRepository.list({
        query: search,
        page,
        limit,
        orderBy: 'updatedAt',
        ...(context.role === 'designer' ? { staffId: operatorId } : {}),
      });
      const visibleLeads = result.rows;
      const summaries = await new AiWorkflowRepository(transaction)
        .summarizeActiveByLeadIds(visibleLeads.map((lead) => lead.id));
      const workflowMap = new Map(summaries.map((summary) => [summary.leadId, summary]));
      return {
        total: result.total,
        items: visibleLeads.map((lead) => {
        const workflowMeta = workflowMap.get(lead.id);
        // A lead's primary floor plan is the authoritative current plan, but
        // older records may not have a matching lead_floor_plans row. Include
        // it as a fallback so one completed formal plan cannot be hidden by
        // other draft measurement records.
        const candidateFloorPlans = [
          ...lead.floorPlanRecords,
          ...(lead.primaryFloorPlanRecord ? [lead.primaryFloorPlanRecord] : []),
        ];
        const floorPlans = Array.from(
          new Map(candidateFloorPlans.map((plan) => [plan.id.toString(), plan])).values(),
        )
          .filter(isEligibleWorkflowFloorPlan)
          .map((plan) => ({
            id: plan.id.toString(),
            name: plan.name,
            createdAt: plan.createdAt,
            status: plan.status,
          }));
        const serviceStage = resolveLeadServiceStage({
          leadStatus: lead.status,
          assignmentStatus: lead.assignmentStatus,
          measurerId: lead.measurerId,
          appointment: lead.appointment,
          hasFormalFloorPlan: floorPlans.length > 0,
        });
        return {
          id: lead.id.toString(),
          name: lead.name,
          phone: lead.phone,
          status: lead.status,
          assignmentStatus: lead.assignmentStatus,
          assignedTo: lead.assignedTo ? lead.assignedTo.toString() : '',
          serviceStage: serviceStage.key,
          stylePreference: lead.stylePreference,
          communityName: lead.communityName,
          floorPlans,
          workflowCount: workflowMeta?.count || 0,
          latestWorkflowId: workflowMeta?.latestWorkflowId.toString(),
          latestWorkflowTitle: workflowMeta?.latestWorkflowTitle,
          latestWorkflowUpdatedAt: workflowMeta?.latestUpdatedAt,
          followUpCount: lead.followUpRecords.length,
        };
      }),
      };
    });
    return NextResponse.json({
      success: true,
      data: listed.items,
      pagination: createPaginationMetadata(listed.total, page, limit),
    });
  } catch (error) {
    console.error('[Mini AI Studio Leads GET]', error);
    return NextResponse.json({ success: false, error: '读取可设计客户失败' }, { status: 500 });
  }
}
