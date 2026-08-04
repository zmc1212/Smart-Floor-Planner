import { parsePostgresId } from '@/db/postgres-dto';
import { AiCreationRepository } from '@/db/repositories/ai-creation-repository';
import { AiWorkflowRepository, type AiWorkflowRecord } from '@/db/repositories/ai-workflow-repository';
import { LeadRepository } from '@/db/repositories/lead-repository';
import { withTenantTransaction } from '@/db/transaction';
import {
  getNextWorkflowStage,
  type AiWorkflowSourceAssetRole,
  type AiWorkflowStageKey,
} from '@/lib/ai/workflow-stages';
import {
  assertEligibleWorkflowFloorPlan,
  buildWorkflowFloorPlanContext,
  isEligibleWorkflowFloorPlan,
} from '@/lib/ai/workflow-floorplan';
import {
  canRunStageFromState,
  getAiWorkflowStageAvailabilityFromDocs,
} from '@/lib/ai/workflow-stage-availability';
import { serializeAiGeneration, serializeAiWorkflow } from '@/lib/ai/workflow-utils';
import {
  buildPromptFromPreset,
  ensureDefaultAiStylePresets,
  getAiStylePresetByKey,
  getDefaultAiStylePresetByKey,
} from '@/lib/ai/presets';
import { assertEnterpriseAiActionAllowed } from '@/lib/ai/enterprise-policy';
import { getAiCreditPrice } from '@/lib/ai/credits';

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

export type PreparePostgresWorkflowStageInput = {
  enterpriseId: string | bigint;
  operatorId: string | bigint;
  workflowId: string | bigint;
  stageKey: AiWorkflowStageKey;
  presetKey?: string;
  styleReferenceImage?: string;
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

function stagePresetNumber(stageKey: AiWorkflowStageKey) {
  const map: Record<AiWorkflowStageKey, string> = {
    direction: '1',
    base_render: '6',
    soft_furnishing: '2',
    proposal_pack: '4',
    lighting: '10',
    tour_board: '3_image',
    premium_board: '5',
    perspective_upgrade: '7',
    cad_detail: '9',
  };
  return map[stageKey];
}

function buildPresetSnapshot(preset: NonNullable<Awaited<ReturnType<typeof getAiStylePresetByKey>>>) {
  return {
    key: preset.key,
    type: preset.type,
    name: preset.name,
    promptTemplate: preset.promptTemplate,
    negativePrompt: preset.negativePrompt,
    provider: preset.provider,
    image: preset.image,
    icon: preset.icon,
    previewClassName: preset.previewClassName,
    mockImageUrl: preset.mockImageUrl,
    workflowCategory: preset.workflowCategory,
    workflowStage: preset.workflowStage,
    sourceAssetRole: preset.sourceAssetRole,
    nextRecommendedStage: preset.nextRecommendedStage,
  };
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

/**
 * Creates a workflow-stage generation with immutable style and price snapshots.
 * Provider submission, media materialization, and asynchronous reconciliation
 * deliberately remain outside this database-only foundation.
 */
export async function preparePostgresAiWorkflowStage(input: PreparePostgresWorkflowStageInput) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const operatorId = parsePostgresId(input.operatorId, 'operatorId');
  const workflowId = parsePostgresId(input.workflowId, 'workflowId');
  await Promise.all([
    ensureDefaultAiStylePresets(operatorId.toString()),
    assertEnterpriseAiActionAllowed(enterpriseId.toString(), 'image.scenario'),
  ]);
  const requestedPresetKey = input.presetKey?.trim() || `scenario_${stagePresetNumber(input.stageKey)}`;
  const preset = await getAiStylePresetByKey('scenario', requestedPresetKey)
    || getDefaultAiStylePresetByKey('scenario', requestedPresetKey);
  if (!preset) throw Object.assign(new Error('当前阶段没有可用的 AI 预设'), { status: 400 });
  const price = await getAiCreditPrice('image.scenario');

  return withTenantTransaction(enterpriseId, async (transaction) => {
    const workflows = new AiWorkflowRepository(transaction);
    const workflow = await workflows.findById(workflowId);
    if (!workflow || workflow.status !== 'active') throw notFound('方案会话不存在或无权访问');

    const lead = await new LeadRepository(transaction).findById(workflow.leadId);
    if (!lead) throw notFound('客户线索不存在或无权访问');

    const creations = new AiCreationRepository(transaction);
    const generations = await creations.listGenerationsByWorkflowId(workflow.id);
    const activeGeneration = generations.find(
      (generation) => generation.stageKey === input.stageKey
        && ['created', 'pending', 'processing'].includes(generation.status)
    );
    if (activeGeneration) {
      throw Object.assign(new Error('该步骤已在生成中，请稍候查看结果'), {
        status: 409,
        code: 'ACTIVE_GENERATION_EXISTS',
        generationId: activeGeneration.id.toString(),
      });
    }

    const availability = canRunStageFromState({
      stageKey: input.stageKey,
      sourceAssetRole: preset.sourceAssetRole,
      workflow,
      generations: generations.map((generation) => ({
        _id: generation.id,
        stageKey: generation.stageKey as AiWorkflowStageKey | undefined,
        isSelectedBaseline: generation.isSelectedBaseline,
      })),
    });
    if (!availability.available) {
      throw Object.assign(new Error(availability.reason || '当前阶段暂不可执行'), { status: 400 });
    }

    const floorPlan = workflow.sourceFloorPlanId
      ? lead.floorPlanRecords.find((plan) => plan.id === workflow.sourceFloorPlanId) || null
      : null;
    if (workflow.sourceFloorPlanId && !floorPlan) {
      throw Object.assign(new Error('方案关联的正式户型不存在或无权访问'), { status: 400 });
    }
    if (floorPlan) assertEligibleWorkflowFloorPlan(floorPlan);

    const imageMode = preset.image.mode === 'edit' ? 'edit' : 'generation';
    const prompt = [
      buildPromptFromPreset(preset.promptTemplate, {}),
      floorPlan ? buildWorkflowFloorPlanContext(floorPlan.layoutData) : '',
    ].filter(Boolean).join(' ');
    const parentGenerationId = availability.parentGenerationId
      ? parsePostgresId(availability.parentGenerationId, 'parentGenerationId')
      : null;
    const nextRecommendedStage = preset.nextRecommendedStage || getNextWorkflowStage(input.stageKey);
    const presetSnapshot = buildPresetSnapshot(preset);
    presetSnapshot.image = { ...presetSnapshot.image, mode: imageMode };

    return creations.createGeneration({
      enterpriseId,
      operatorId,
      leadId: workflow.leadId,
      workflowId: workflow.id,
      floorPlanId: workflow.sourceFloorPlanId,
      parentGenerationId,
      type: 'scenario',
      channel: 'admin',
      actionKey: 'image.scenario',
      capability: imageMode === 'edit' ? 'image.edit' : 'image.generate',
      logicalModelKey: imageMode === 'edit' ? 'image.edit.standard' : 'image.generate.standard',
      stageKey: input.stageKey,
      sourceAssetRole: preset.sourceAssetRole || workflow.sourceAssetRole,
      nextRecommendedStage,
      input: {
        style: preset.key,
        presetSnapshot,
        customPrompt: prompt,
        styleReferenceImage: input.styleReferenceImage?.trim() || undefined,
      },
      output: { promptUsed: prompt },
      status: 'pending',
      billing: {
        cycle: 0,
        actionKey: 'image.scenario',
        price: price.credits,
        priceSnapshot: {
          actionKey: 'image.scenario',
          label: price.label,
          credits: price.credits,
          capturedAt: new Date().toISOString(),
        },
        status: 'unbilled',
      },
    });
  });
}
