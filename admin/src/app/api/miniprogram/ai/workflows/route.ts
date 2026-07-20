import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { resolveMiniAiContext } from '@/lib/ai/mini-ai-auth';
import { AiWorkflow } from '@/models/AiWorkflow';
import { AiGeneration } from '@/models/AiGeneration';
import Lead from '@/models/Lead';
import { FloorPlan } from '@/models/FloorPlan';
import { serializeMiniAiTask } from '@/lib/ai/mini-ai-tasks';
import { getWorkflowStageDefinition } from '@/lib/ai/workflow-stages';

export const dynamic = 'force-dynamic';

function miniModeForStage(stageKey?: string) {
  if (stageKey === 'soft_furnishing') return 'soft_furnishing';
  if (stageKey === 'base_render') return 'style_transform';
  return undefined;
}

export async function GET(request: Request) {
  try {
    await dbConnect();
    const context = await resolveMiniAiContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: '仅企业员工可以查看 AI 方案' }, { status: 403 });
    }

    const url = new URL(request.url);
    const workflowId = url.searchParams.get('workflowId');
    const leadId = url.searchParams.get('leadId');
    const floorPlanId = url.searchParams.get('floorPlanId');
    if (!workflowId && !leadId && !floorPlanId) {
      return NextResponse.json({ success: true, data: [] });
    }

    const leadFilter: Record<string, unknown> = { enterpriseId: context.enterpriseId };
    if (leadId) leadFilter._id = leadId;
    const leadConditions: Record<string, unknown>[] = [];
    if (floorPlanId) {
      leadConditions.push({ $or: [{ floorPlanIds: floorPlanId }, { primaryFloorPlanId: floorPlanId }] });
    }
    if (context.role === 'salesperson') leadFilter.promoterId = context.operatorId;
    if (context.role === 'designer' || context.role === 'measurer') {
      const assignedPlans = await FloorPlan.find({
        enterpriseId: context.enterpriseId,
        staffId: context.operatorId,
      }).select('_id').lean();
      const assignedPlanIds = assignedPlans.map((plan) => plan._id);
      if (floorPlanId && !assignedPlanIds.some((id) => String(id) === floorPlanId)) {
        if (context.role === 'measurer') return NextResponse.json({ success: true, data: [] });
      }
      const assignedPlanCondition = {
        $or: [
          { floorPlanIds: { $in: assignedPlanIds } },
          { primaryFloorPlanId: { $in: assignedPlanIds } },
        ],
      };
      leadConditions.push(context.role === 'designer'
        ? { $or: [{ assignedTo: context.operatorId }, assignedPlanCondition] }
        : assignedPlanCondition);
    }
    if (leadConditions.length) leadFilter.$and = leadConditions;

    const leads = await Lead.find(leadFilter).select('name communityName floorPlanIds primaryFloorPlanId').lean();
    const accessibleLeadIds = leads.map((lead) => lead._id);
    if (!accessibleLeadIds.length) return NextResponse.json({ success: true, data: [] });

    const workflowFilter: Record<string, unknown> = {
      enterpriseId: context.enterpriseId,
      leadId: { $in: accessibleLeadIds },
      status: 'active',
    };
    if (workflowId) workflowFilter._id = workflowId;
    if (floorPlanId) workflowFilter.sourceFloorPlanId = floorPlanId;

    const workflows = await AiWorkflow.find(workflowFilter).sort({ isPrimary: -1, updatedAt: -1 }).limit(20).lean();
    const workflowIds = workflows.map((workflow) => workflow._id);
    const generations = workflowIds.length
      ? await AiGeneration.find({ workflowId: { $in: workflowIds }, status: 'succeeded' }).sort({ createdAt: -1 })
      : [];
    const leadById = new Map(leads.map((lead) => [String(lead._id), lead]));

    const data = workflows.map((workflow) => {
      const workflowGenerations = generations.filter((generation) => String(generation.workflowId) === String(workflow._id));
      const selected = workflow.selectedGenerationId
        ? workflowGenerations.find((generation) => String(generation._id) === String(workflow.selectedGenerationId))
        : workflowGenerations.find((generation) => generation.isSelectedBaseline);
      const latest = workflowGenerations[0];
      const lead = leadById.get(String(workflow.leadId));
      const recommendedMiniMode = miniModeForStage(workflow.currentStageKey);
      return {
        id: String(workflow._id),
        title: workflow.title,
        isPrimary: Boolean(workflow.isPrimary),
        currentStageKey: workflow.currentStageKey,
        currentStageLabel: getWorkflowStageDefinition(workflow.currentStageKey)?.name,
        recommendedMiniMode,
        recommendedLabel: recommendedMiniMode
          ? recommendedMiniMode === 'soft_furnishing' ? '继续软装深化' : '继续完善方案'
          : '请到后台继续深化',
        lead: lead ? { id: String(lead._id), name: lead.name, communityName: lead.communityName || '' } : undefined,
        selectedTask: selected ? serializeMiniAiTask(selected, request) : undefined,
        latestTask: latest ? serializeMiniAiTask(latest, request) : undefined,
        updatedAt: workflow.updatedAt,
      };
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[Mini AI Workflows]', error);
    return NextResponse.json({ success: false, error: '读取客户 AI 方案失败' }, { status: 500 });
  }
}
