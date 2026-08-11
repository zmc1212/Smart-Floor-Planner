import { NextResponse } from 'next/server';
import { resolveMiniAiContext } from '@/lib/ai/mini-ai-auth';
import { AiCreationRepository, FloorPlanRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withTenantTransaction } from '@/db/transaction';
import {
  normalizeMiniAiTargetIdentity,
  resolveMiniAiTargetContext,
  validateMiniAiTargetIdentity,
} from '@/lib/ai/mini-ai-target-context';
import type { MiniAiTargetScope } from '@/lib/ai/mini-ai-floorplan';
import { serializePostgresMiniAiTask } from '@/lib/ai/postgres-mini-ai-tasks';
import { listPostgresAiWorkflows } from '@/lib/ai/postgres-workflow-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveMiniAiContext(request);
    if (!context) return NextResponse.json({ success: false, error: '仅企业员工可以查看 AI 方案' }, { status: 403 });
    const url = new URL(request.url);
    const workflowId = url.searchParams.get('workflowId') || undefined;
    const leadId = url.searchParams.get('leadId') || undefined;
    const floorPlanId = url.searchParams.get('floorPlanId') || undefined;
    const targetInput = {
      floorPlanId,
      targetScope: (url.searchParams.get('targetScope') || undefined) as MiniAiTargetScope | undefined,
      roomId: url.searchParams.get('roomId') || undefined,
    };
    const targetError = validateMiniAiTargetIdentity(targetInput);
    if (targetError) {
      return NextResponse.json({ success: false, error: targetError }, { status: 400 });
    }
    if (!workflowId && !leadId && !floorPlanId) {
      return NextResponse.json({ success: true, data: [] });
    }

    const result = await listPostgresAiWorkflows({
      enterpriseId: context.enterpriseId,
      workflowId,
      operatorId: context.operatorId,
      leadId,
      query: url.searchParams.get('query') || undefined,
      page: Number(url.searchParams.get('page') || 1),
      limit: 20,
    });
    const filtered = result.data.filter((workflow) => (
      !floorPlanId || workflow.sourceFloorPlanId === floorPlanId
    ));
    const target = normalizeMiniAiTargetIdentity(targetInput);
    const workflowIds = filtered.map((workflow) => parsePostgresId(workflow.id, 'workflowId'));
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
    const { generations, plan } = await withTenantTransaction(enterpriseId, async (transaction) => ({
      generations: await new AiCreationRepository(transaction).listGenerationsByWorkflowIds(workflowIds),
      plan: target.floorPlanId
        ? await new FloorPlanRepository(transaction).findById(
            parsePostgresId(target.floorPlanId, 'floorPlanId')
          )
        : null,
    }));
    const generationsByWorkflow = new Map<string, typeof generations>();
    generations.forEach((generation) => {
      if (!generation.workflowId) return;
      const key = generation.workflowId.toString();
      generationsByWorkflow.set(key, [
        ...(generationsByWorkflow.get(key) || []),
        generation,
      ]);
    });
    const data = filtered.map((workflow) => {
      const workflowGenerations = generationsByWorkflow.get(workflow.id) || [];
      const successful = workflowGenerations.filter((generation) => generation.status === 'succeeded');
      const selected = workflow.selectedGenerationId
        ? successful.find((generation) => generation.id.toString() === workflow.selectedGenerationId)
        : successful.find((generation) => generation.isSelectedBaseline);
      const latest = successful[0];
      const resolvedTargetContext = target.floorPlanId
        ? resolveMiniAiTargetContext({
            generations: workflowGenerations,
            target,
            operatorId: context.operatorId,
            selectedGenerationId: workflow.selectedGenerationId,
            planUpdatedAt: plan?.updatedAt,
          })
        : undefined;
      return {
          id: workflow.id,
          title: workflow.title,
          status: workflow.status,
          isPrimary: Boolean(workflow.isPrimary),
          currentStageKey: workflow.currentStageKey,
          currentStageLabel: workflow.currentStageLabel,
          recommendedMiniMode: workflow.currentStageKey === 'soft_furnishing'
            ? 'soft_furnishing'
            : workflow.currentStageKey === 'base_render'
              ? 'style_transform'
              : undefined,
          recommendedLabel: workflow.currentStageKey === 'soft_furnishing'
            ? '继续软装深化'
            : workflow.currentStageKey === 'base_render'
              ? '继续完善方案'
              : '请到后台继续深化',
          lead: workflow.lead,
          sourceFloorPlanId: workflow.sourceFloorPlanId,
          selectedTask: selected ? serializePostgresMiniAiTask(selected, request) : undefined,
          latestTask: latest ? serializePostgresMiniAiTask(latest, request) : undefined,
          targetContext: resolvedTargetContext ? {
            status: resolvedTargetContext.status,
            targetScope: target.targetScope,
            roomId: target.roomId,
            stageKey: resolvedTargetContext.stageKey,
            recommendedMiniMode: resolvedTargetContext.recommendedMiniMode,
            busyByOther: resolvedTargetContext.busyByOther,
            sourceTask: resolvedTargetContext.sourceTask
              ? {
                  ...serializePostgresMiniAiTask(resolvedTargetContext.sourceTask, request),
                  ownedByCurrentOperator: resolvedTargetContext.sourceTask.operatorId.toString()
                    === context.operatorId,
                }
              : undefined,
            activeTask: resolvedTargetContext.activeTask
              ? {
                  ...serializePostgresMiniAiTask(resolvedTargetContext.activeTask, request),
                  ownedByCurrentOperator: true,
                }
              : undefined,
          } : undefined,
          updatedAt: workflow.updatedAt,
      };
    });
    return NextResponse.json({ success: true, data, pagination: result.pagination });
  } catch (error) {
    console.error('[Mini AI Workflows]', error);
    return NextResponse.json({ success: false, error: '读取客户 AI 方案失败' }, { status: 500 });
  }
}
