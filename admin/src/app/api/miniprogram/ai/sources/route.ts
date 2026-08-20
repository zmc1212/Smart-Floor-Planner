import { NextResponse } from 'next/server';
import { resolveMiniAiContext } from '@/lib/ai/mini-ai-auth';
import { FloorPlanRepository, AiCreationRepository, AiWorkflowRepository, LeadRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { parsePostgresId } from '@/db/postgres-dto';
import { getFloorPlanDisplay } from '@/lib/floor-plan-display';
import { adaptSurveyGraphToRooms, buildSurveyFloorPlanNavigator, isFormalSurveyLayout } from '@/lib/survey-graph';
import { MINI_AI_WHOLE_PLAN_RENDER_VERSION, serializePostgresMiniAiTask } from '@/lib/ai/postgres-mini-ai-tasks';
import { deriveMiniAiProjectState, type MiniAiProjectUiState } from '@/lib/ai/mini-ai-project-index';
import { getWorkflowStageDefinition } from '@/lib/ai/workflow-stages';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveMiniAiContext(request);
    if (!context) return NextResponse.json({ success: false, error: '仅企业员工可以选择 AI 户型来源' }, { status: 403 });
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
    const operatorId = parsePostgresId(context.operatorId, 'operatorId');
    const result = await withTenantTransaction(enterpriseId, async (transaction) => {
      const plans = (await new FloorPlanRepository(transaction).list({ formalOnly: true, limit: 80 })).rows;
      const leads = await new LeadRepository(transaction).list({ limit: 120 });
      const visibleLeads = leads.rows.filter((lead) => (
        ['enterprise_admin', 'admin', 'super_admin'].includes(context.role)
        || context.role === 'salesperson' && lead.promoterId === operatorId
        || context.role === 'designer' && lead.assignedTo === operatorId
      ));
      const accessible = plans.filter((plan) => ['enterprise_admin', 'admin', 'super_admin'].includes(context.role) || (context.role === 'measurer' || context.role === 'designer') && plan.staffId === operatorId || visibleLeads.some((lead) => lead.floorPlanRecords.some((item) => item.id === plan.id)));
      const leadByPlan = await new LeadRepository(transaction).findByFloorPlanIds(
        accessible.map((plan) => plan.id)
      );
      const activeAccessible = accessible.filter((plan) => !leadByPlan.get(plan.id)?.archivedAt);
      const generations = await new AiCreationRepository(transaction).listMiniProgramGenerationsByFloorPlanIds(
        activeAccessible.map((plan) => plan.id)
      );
      const leadIds = Array.from(new Set(
        activeAccessible
          .map((plan) => leadByPlan.get(plan.id))
          .filter((lead): lead is NonNullable<typeof lead> => Boolean(lead))
          .map((lead) => lead.id)
      ));
      const activeWorkflows = await new AiWorkflowRepository(transaction).listActiveForProjectIndex({
        leadIds,
        operatorId,
      });
      const generationCountByWorkflowId = new Map<bigint, number>();
      generations.forEach((generation) => {
        if (!generation.workflowId) return;
        generationCountByWorkflowId.set(
          generation.workflowId,
          (generationCountByWorkflowId.get(generation.workflowId) || 0) + 1,
        );
      });
      const activeWorkflowByPlan = new Map<bigint, typeof activeWorkflows[number]>();
      activeWorkflows.forEach((workflow) => {
        if (!workflow.sourceFloorPlanId) return;
        const current = activeWorkflowByPlan.get(workflow.sourceFloorPlanId);
        if (!current) {
          activeWorkflowByPlan.set(workflow.sourceFloorPlanId, workflow);
          return;
        }
        const currentCount = generationCountByWorkflowId.get(current.id) || 0;
        const nextCount = generationCountByWorkflowId.get(workflow.id) || 0;
        // listActiveForProjectIndex is newest-first; keep the newer row unless an
        // older sibling actually has more generations (avoids empty bootstrap
        // workflows shadowing Admin-created schemes on the Mini Program home).
        if (nextCount > currentCount) {
          activeWorkflowByPlan.set(workflow.sourceFloorPlanId, workflow);
        }
      });
      return activeAccessible.flatMap((plan) => {
        const formalLayout = isFormalSurveyLayout(plan.layoutData);
        const rooms = formalLayout
          ? adaptSurveyGraphToRooms(plan.layoutData).map((room) => ({ roomId: room.id, roomName: room.name, roomSize: `${(room.width / 10).toFixed(2)} m x ${(room.height / 10).toFixed(2)} m`, openingCount: room.openings.length }))
          : [];
        const matching = generations.filter((generation) => generation.floorPlanId === plan.id && asRecord(generation.input).mode === 'floor_plan_render' && asRecord(asRecord(generation.input).roomData).targetScope === 'whole_floor_plan' && asRecord(asRecord(generation.input).roomData).navigationRenderVersion === MINI_AI_WHOLE_PLAN_RENDER_VERSION);
        const current = matching.filter((generation) => generation.createdAt >= plan.updatedAt);
        const active = current.find((generation) => ['pending', 'created', 'processing'].includes(generation.status));
        const ready = current.find((generation) => generation.status === 'succeeded' && asRecord(generation.output).imageUrl);
        const lead = leadByPlan.get(plan.id);
        const leadArchived = Boolean(lead?.archivedAt);
        const display = getFloorPlanDisplay(plan, {
          lead,
          measurementSequence: lead?.floorPlanRecords.find(
            (record) => record.id === plan.id
          )?.measurementSequence,
        });
        const activeWorkflow = activeWorkflowByPlan.get(plan.id);
        const workflowGenerations = activeWorkflow
          ? generations.filter((generation) => generation.workflowId === activeWorkflow.id)
          : [];
        const projectState = deriveMiniAiProjectState({
          plan,
          activeWorkflow,
          generations: workflowGenerations,
        });
        const latestGeneration = projectState.latestGeneration
          ? serializePostgresMiniAiTask(projectState.latestGeneration, request)
          : undefined;
        const activeGeneration = projectState.activeGeneration
          ? serializePostgresMiniAiTask(projectState.activeGeneration, request)
          : undefined;
        const currentStageLabel = getWorkflowStageDefinition(activeWorkflow?.currentStageKey)?.name;
        const statusCopy = getProjectStatusCopy(
          projectState.uiState,
          activeGeneration?.progress,
          currentStageLabel,
          projectState.eligibility.reasonLabel
        );
        return [{
          leadId: lead?.id.toString() || '',
          leadArchived,
          leadName: lead?.name || '未关联客户',
          communityName: lead?.communityName || '',
          floorPlanId: plan.id.toString(),
          floorPlanName: plan.name || '正式户型',
          projectTitle: display.projectTitle,
          projectSubtitle: display.projectSubtitle,
          floorPlanStatus: plan.status,
          closedRoomCount: rooms.length,
          rooms,
          navigator: formalLayout ? buildSurveyFloorPlanNavigator(plan.layoutData) : undefined,
          navigationPreview: {
            state: active ? 'processing' : ready ? 'ready' : matching.some((generation) => generation.status === 'succeeded') ? 'stale' : 'missing',
            task: active ? serializePostgresMiniAiTask(active, request) : undefined,
            readyTask: ready ? serializePostgresMiniAiTask(ready, request) : undefined,
            imageUrl: ready ? serializePostgresMiniAiTask(ready, request).resultImageUrl : undefined,
          },
          eligibility: projectState.eligibility,
          projectGroup: projectState.groupKey,
          uiState: projectState.uiState,
          statusLabel: statusCopy.statusLabel,
          actionLabel: statusCopy.actionLabel,
          activeWorkflow: activeWorkflow ? {
            id: activeWorkflow.id.toString(),
            currentStageKey: activeWorkflow.currentStageKey,
            currentStageLabel,
            updatedAt: activeWorkflow.updatedAt,
          } : undefined,
          latestGeneration,
          updatedAt: plan.updatedAt,
        }];
      });
    });
    // Archived leads keep their floor-plan records for recovery, but they are
    // not active AI-design projects. Do not expose them to the Mini Program;
    // this also prevents the home page from issuing a workflow query that can
    // only fail with LEAD_ARCHIVED.
    const activeProjects = result.filter((plan) => !plan.leadArchived);
    const data = activeProjects
      .filter((plan) => plan.eligibility.eligible)
      .flatMap((plan) => plan.rooms.map((room) => ({ leadId: plan.leadId, leadName: plan.leadName, communityName: plan.communityName, floorPlanId: plan.floorPlanId, floorPlanName: plan.floorPlanName, projectTitle: plan.projectTitle, projectSubtitle: plan.projectSubtitle, floorPlanStatus: plan.floorPlanStatus, ...room, updatedAt: plan.updatedAt })));
    return NextResponse.json({ success: true, data, plans: activeProjects });
  } catch (error) {
    console.error('[Mini AI Sources]', error);
    return NextResponse.json({ success: false, error: '加载客户户型失败' }, { status: 500 });
  }
}

function getProjectStatusCopy(
  uiState: MiniAiProjectUiState,
  progress?: number,
  stageLabel?: string,
  reasonLabel?: string
) {
  if (uiState === 'generating') return { statusLabel: `生成中 · ${Number(progress || 0)}%`, actionLabel: '查看进度' };
  if (uiState === 'continue') return { statusLabel: `继续设计 · ${stageLabel || '当前方案'}`, actionLabel: '继续设计' };
  if (uiState === 'retry') return { statusLabel: '上次生成失败', actionLabel: '进入处理' };
  if (uiState === 'stale') return { statusLabel: '量房已更新', actionLabel: '重建基准' };
  if (uiState === 'ready') return { statusLabel: '正式量房已就绪', actionLabel: '开始设计' };
  return { statusLabel: reasonLabel || '量房信息待完善', actionLabel: '继续量房' };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
