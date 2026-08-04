import { parsePostgresId } from '@/db/postgres-dto';
import { AiCreationRepository } from '@/db/repositories/ai-creation-repository';
import { AiWorkflowRepository, type AiWorkflowRecord } from '@/db/repositories/ai-workflow-repository';
import { LeadRepository } from '@/db/repositories/lead-repository';
import { withTenantTransaction } from '@/db/transaction';
import type { AiWorkflowSourceAssetRole, AiWorkflowStageKey } from '@/lib/ai/workflow-stages';
import { assertEligibleWorkflowFloorPlan, isEligibleWorkflowFloorPlan } from '@/lib/ai/workflow-floorplan';
import { getAiWorkflowStageAvailabilityFromDocs } from '@/lib/ai/workflow-stage-availability';
import { serializeAiGeneration, serializeAiWorkflow } from '@/lib/ai/workflow-utils';

export type CreatePostgresWorkflowInput = {
  enterpriseId: string | bigint;
  operatorId: string | bigint;
  leadId: string | bigint;
  title?: string;
  workflowLabel?: string;
  sourceFloorPlanId?: string | bigint;
  sourceImage?: string;
  sourceAssetRole?: AiWorkflowSourceAssetRole;
};

export type UpdatePostgresWorkflowStateInput = {
  enterpriseId: string | bigint;
  workflowId: string | bigint;
  action: 'rename' | 'set-stage' | 'select-generation';
  title?: string;
  stageKey?: AiWorkflowStageKey;
  generationId?: string | bigint;
};

function notFound(message: string) {
  return Object.assign(new Error(message), { status: 404 });
}

function buildDefaultWorkflowTitle(leadName: string, workflowCount: number, workflowLabel?: string) {
  if (workflowLabel?.trim()) return `${leadName} · ${workflowLabel.trim()}`;
  return workflowCount === 0 ? `${leadName} · 首轮方案` : `${leadName} · 方案 ${workflowCount + 1}`;
}

function serializePostgresWorkflow(workflow: AiWorkflowRecord) {
  return serializeAiWorkflow({ ...workflow, _id: workflow.id });
}

/**
 * This service only owns PostgreSQL persistence and read models. Provider
 * execution and source-image media storage remain on the existing runtime.
 */
export async function createPostgresAiWorkflow(input: CreatePostgresWorkflowInput) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const operatorId = parsePostgresId(input.operatorId, 'operatorId');
  const leadId = parsePostgresId(input.leadId, 'leadId');
  const sourceFloorPlanId = input.sourceFloorPlanId
    ? parsePostgresId(input.sourceFloorPlanId, 'sourceFloorPlanId')
    : null;
  const sourceImage = input.sourceImage?.trim();
  const workflowLabel = input.workflowLabel?.trim();

  if (!sourceFloorPlanId && (!sourceImage || !sourceImage.startsWith('data:image'))) {
    throw Object.assign(new Error('请先选择客户素材或上传参考图'), { status: 400 });
  }

  return withTenantTransaction(enterpriseId, async (transaction) => {
    const leads = new LeadRepository(transaction);
    const lead = await leads.findById(leadId);
    if (!lead) throw notFound('客户线索不存在或无权访问');

    let sourceAssetRole: AiWorkflowSourceAssetRole = input.sourceAssetRole || 'rough_sketch';
    if (sourceFloorPlanId) {
      const floorPlan = lead.floorPlanRecords.find((plan) => plan.id === sourceFloorPlanId);
      if (!floorPlan) {
        throw Object.assign(new Error('所选户型图不属于当前客户线索'), { status: 400 });
      }
      assertEligibleWorkflowFloorPlan(floorPlan);
      sourceAssetRole = input.sourceAssetRole || 'floor_plan';
    }

    const workflows = new AiWorkflowRepository(transaction);
    const existing = await workflows.list({ leadId, limit: 1 });
    const workflow = await workflows.create({
      enterpriseId,
      leadId,
      operatorId,
      title: input.title?.trim() || buildDefaultWorkflowTitle(lead.name || '客户方案', existing.total, workflowLabel),
      workflowLabel,
      isPrimary: existing.total === 0,
      sourceImage,
      sourceFloorPlanId,
      sourceAssetRole,
      currentStageKey: 'direction',
    });
    return workflow;
  });
}

export async function getPostgresAiWorkflowContext(input: {
  enterpriseId: string | bigint;
  workflowId: string | bigint;
}) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const workflowId = parsePostgresId(input.workflowId, 'workflowId');
  return withTenantTransaction(enterpriseId, async (transaction) => {
    const workflow = await new AiWorkflowRepository(transaction).findById(workflowId);
    if (!workflow) throw notFound('方案会话不存在或无权访问');

    const lead = await new LeadRepository(transaction).findById(workflow.leadId);
    if (!lead) throw notFound('客户线索不存在或无权访问');

    const generations = await new AiCreationRepository(transaction).listGenerationsByWorkflowId(workflow.id);
    const availability = getAiWorkflowStageAvailabilityFromDocs(
      workflow,
      generations.map((generation) => ({
        _id: generation.id,
        stageKey: (generation.stageKey || undefined) as AiWorkflowStageKey | undefined,
        isSelectedBaseline: generation.isSelectedBaseline,
      }))
    );
    const latestGeneration = generations[0];

    return {
      workflow: {
        ...serializePostgresWorkflow(workflow),
        generationCount: generations.length,
        latestGeneration: latestGeneration
          ? serializeAiGeneration({ ...latestGeneration, _id: latestGeneration.id })
          : undefined,
        stageState: availability,
      },
      lead: {
        id: String(lead.id),
        name: lead.name,
        phone: lead.phone,
        status: lead.status,
        stylePreference: lead.stylePreference,
        communityName: lead.communityName,
        floorPlans: lead.floorPlanRecords
          .filter(isEligibleWorkflowFloorPlan)
          .map((plan) => ({
            id: String(plan.id),
            name: plan.name,
            createdAt: plan.createdAt,
            status: plan.status,
          })),
        followUpCount: Array.isArray(lead.followUpRecords) ? lead.followUpRecords.length : 0,
      },
      generations: generations.map((generation) => serializeAiGeneration({ ...generation, _id: generation.id })),
    };
  });
}

/**
 * Keeps the user-directed workflow state mutations on bigint records before
 * provider-stage execution is moved from the legacy runtime.
 */
export async function updatePostgresAiWorkflowState(input: UpdatePostgresWorkflowStateInput) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const workflowId = parsePostgresId(input.workflowId, 'workflowId');
  return withTenantTransaction(enterpriseId, async (transaction) => {
    const workflows = new AiWorkflowRepository(transaction);
    if (input.action === 'select-generation') {
      if (!input.generationId) {
        throw Object.assign(new Error('缺少生成记录 ID'), { status: 400 });
      }
      const selected = await workflows.selectSucceededGenerationBaseline(
        workflowId,
        parsePostgresId(input.generationId, 'generationId')
      );
      if (!selected) throw notFound('生成记录不存在、未成功或不属于当前方案会话');
      return selected;
    }

    const values = input.action === 'rename'
      ? { title: input.title?.trim() }
      : { currentStageKey: input.stageKey };
    if (!Object.values(values)[0]) {
      throw Object.assign(new Error(input.action === 'rename' ? '缺少方案名称' : '缺少阶段标识'), {
        status: 400,
      });
    }
    const workflow = await workflows.updateActive(workflowId, values);
    if (!workflow) throw notFound('方案会话不存在或无权访问');
    return { workflow };
  });
}
