import { parsePostgresId } from '@/db/postgres-dto';
import { AiCreationRepository } from '@/db/repositories/ai-creation-repository';
import { AiWorkflowRepository, type AiWorkflowRecord } from '@/db/repositories/ai-workflow-repository';
import { CustomerProjectRepository } from '@/db/repositories/customer-project-repository';
import { LeadLifecycleRepository } from '@/db/repositories/lead-lifecycle-repository';
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
  resolveWorkflowImageMode,
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
import { resolvePostgresScenarioProviderImage } from '@/lib/ai/postgres-creation-runtime';
import { executePostgresWorkflowChat } from '@/lib/ai/postgres-workflow-chat';
import type { AiChatMessage } from '@/lib/ai/provider-types';
import { parseImageDataUri } from '@/lib/ai/postgres-media-assets';
import { leadArchivedError } from '@/lib/lead-lifecycle';
import {
  getPostgresAssetIdFromImageUrl,
  getPostgresMediaAssetImageUrl,
  storePostgresMediaBuffer,
} from '@/lib/ai/postgres-media-assets';

export type CreatePostgresWorkflowInput = {
  enterpriseId: string | bigint;
  operatorId: string | bigint;
  leadId: string | bigint;
  title?: string;
  workflowLabel?: string;
  sourceFloorPlanId?: string | bigint;
  sourceImage?: string;
  sourceAssetRole?: AiWorkflowSourceAssetRole;
  currentStageKey?: AiWorkflowStageKey;
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

export type CreatePostgresWorkflowManualGenerationInput = {
  enterpriseId: string | bigint;
  operatorId: string | bigint;
  workflowId: string | bigint;
  stageKey: AiWorkflowStageKey;
  imageUrl: string;
  parentGenerationId?: string | bigint;
  sourceAssetRole?: string;
  styleReferenceImage?: string;
  nextStageKey?: AiWorkflowStageKey;
};

export type ListPostgresWorkflowsInput = {
  enterpriseId: string | bigint;
  workflowId?: string | bigint;
  operatorId?: string | bigint;
  leadId?: string | bigint;
  query?: string;
  status?: 'active' | 'archived';
  page?: number;
  limit?: number;
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
    conversation: '6',
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseLightingPrompt(value: string, fallbackNegativePrompt?: string) {
  const jsonMatch = value.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { prompt?: string; negative_prompt?: string };
      if (parsed.prompt?.trim()) {
        return { prompt: parsed.prompt.trim(), negativePrompt: parsed.negative_prompt?.trim() || fallbackNegativePrompt };
      }
    } catch {
      // The deterministic fallback maintains the legacy behavior for non-JSON model replies.
    }
  }
  return {
    prompt: 'A professional interior design presentation board showing a night scene rendering of a high-end interior, lighting concept, color temperature analysis, and a structured lighting equipment list. High-end architectural portfolio layout, photorealistic, 8k.',
    negativePrompt: fallbackNegativePrompt || 'ugly, blurry, low quality',
  };
}

async function persistPostgresManualGenerationImage(input: {
  enterpriseId: bigint;
  imageUrl: string;
}) {
  const imageUrl = input.imageUrl.trim();
  const assetId = getPostgresAssetIdFromImageUrl(imageUrl);
  if (assetId) return getPostgresMediaAssetImageUrl(assetId);

  if (imageUrl.startsWith('data:image')) {
    const parsed = parseImageDataUri(imageUrl);
    return (await storePostgresMediaBuffer({
      enterpriseId: input.enterpriseId,
      ownerType: 'ai_generation_output',
      mimeType: parsed.mimeType,
      buffer: parsed.buffer,
    })).imageUrl;
  }

  if (!/^https?:\/\//i.test(imageUrl)) {
    throw Object.assign(new Error('Manual generation image must be a PostgreSQL asset URL, image data URI, or HTTP(S) URL'), {
      status: 400,
    });
  }

  const response = await fetch(imageUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw Object.assign(new Error(`Failed to persist manual generation image (${response.status})`), { status: 400 });
  }
  const mimeType = response.headers.get('content-type')?.split(';')[0] || 'image/png';
  if (!mimeType.startsWith('image/')) {
    throw Object.assign(new Error('Manual generation URL did not return an image'), { status: 400 });
  }
  return (await storePostgresMediaBuffer({
    enterpriseId: input.enterpriseId,
    ownerType: 'ai_generation_output',
    mimeType,
    buffer: Buffer.from(await response.arrayBuffer()),
    originalUrl: imageUrl,
  })).imageUrl;
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
    await new LeadLifecycleRepository(transaction).lockByIds([leadId]);
    const lead = await leads.findById(leadId);
    if (!lead) throw notFound('客户线索不存在或无权访问');
    if (lead.archivedAt) throw leadArchivedError();

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
      currentStageKey: input.currentStageKey || 'direction',
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
    const publications = await new CustomerProjectRepository(transaction).listActivePublications(
      enterpriseId,
      workflow.leadId
    );
    const publishedImages = publications.filter((item) => item.publication.workflowId === workflow.id);
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
        archivedAt: lead.archivedAt,
        isArchived: Boolean(lead.archivedAt),
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
      publishedScheme: publishedImages.length
        ? {
            title: publishedImages[0]?.publication.schemeTitle || workflow.title,
            publishedAt: publishedImages[0]?.publication.publishedAt,
            generationIds: publishedImages.map((item) => item.generation.id.toString()),
          }
        : null,
    };
  });
}

/**
 * Produces the legacy workbench list DTO entirely from tenant-scoped bigint
 * records. Historical ObjectId workflows intentionally remain on their
 * compatibility routes and are not mixed into this result.
 */
export async function listPostgresAiWorkflows(input: ListPostgresWorkflowsInput) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const requestedLeadId = input.leadId
    ? parsePostgresId(input.leadId, 'leadId')
    : undefined;
  const requestedWorkflowId = input.workflowId
    ? parsePostgresId(input.workflowId, 'workflowId')
    : undefined;
  const operatorId = input.operatorId
    ? parsePostgresId(input.operatorId, 'operatorId')
    : undefined;
  const page = Math.max(1, input.page ?? 1);
  const limit = Math.min(50, Math.max(1, input.limit ?? 20));

  return withTenantTransaction(enterpriseId, async (transaction) => {
    const leads = new LeadRepository(transaction);
    let leadIds: bigint[] | undefined;
    if (requestedLeadId) {
      const lead = await leads.findById(requestedLeadId);
      if (!lead) throw notFound('客户线索不存在或无权访问');
      if (lead.archivedAt) throw notFound('客户线索不存在或无权访问');
      leadIds = [lead.id];
    } else if (input.query?.trim()) {
      const matched = await leads.list({ query: input.query, limit: 100 });
      leadIds = matched.rows.map((lead) => lead.id);
    }

    const workflows = await new AiWorkflowRepository(transaction).list({
      id: requestedWorkflowId,
      leadIds,
      operatorId,
      status: input.status === 'archived' ? 'archived' : 'active',
      page,
      limit,
    });
    const workflowIds = workflows.rows.map((workflow) => workflow.id);
    const [workflowLeads, generations] = await Promise.all([
      leads.findByIds(
        Array.from(new Set(workflows.rows.map((workflow) => workflow.leadId))),
        { includeArchived: true },
      ),
      new AiCreationRepository(transaction).listGenerationsByWorkflowIds(workflowIds),
    ]);
    const leadById = new Map(workflowLeads.map((lead) => [lead.id, lead]));
    const generationsByWorkflow = new Map<bigint, typeof generations>();
    for (const generation of generations) {
      if (!generation.workflowId) continue;
      generationsByWorkflow.set(generation.workflowId, [
        ...(generationsByWorkflow.get(generation.workflowId) ?? []),
        generation,
      ]);
    }

    return {
      data: workflows.rows.map((workflow) => {
        const workflowGenerations = generationsByWorkflow.get(workflow.id) ?? [];
        const selectedGeneration = workflow.selectedGenerationId
          ? workflowGenerations.find((generation) => generation.id === workflow.selectedGenerationId)
          : workflowGenerations.find((generation) => generation.isSelectedBaseline);
        const lead = leadById.get(workflow.leadId);
        return {
          ...serializePostgresWorkflow(workflow),
          generationCount: workflowGenerations.length,
          latestGeneration: workflowGenerations[0]
            ? serializeAiGeneration({ ...workflowGenerations[0], _id: workflowGenerations[0].id })
            : undefined,
          selectedGeneration: selectedGeneration
            ? serializeAiGeneration({ ...selectedGeneration, _id: selectedGeneration.id })
            : undefined,
          lead: lead
            ? {
                id: lead.id.toString(),
                name: lead.name,
                phone: lead.phone,
                communityName: lead.communityName,
                status: lead.status,
                archivedAt: lead.archivedAt,
                isArchived: Boolean(lead.archivedAt),
              }
            : undefined,
          stageState: getAiWorkflowStageAvailabilityFromDocs(
            workflow,
            workflowGenerations.map((generation) => ({
              _id: generation.id,
              stageKey: generation.stageKey as AiWorkflowStageKey | undefined,
              isSelectedBaseline: generation.isSelectedBaseline,
            }))
          ),
        };
      }),
      pagination: {
        page: workflows.page,
        limit: workflows.limit,
        total: workflows.total,
        totalPages: Math.ceil(workflows.total / workflows.limit),
      },
    };
  });
}

/**
 * Returns only the persisted data-URI source image for a bigint workflow.
 * Route handlers stream it after the RLS-scoped database read; provider and
 * object-storage I/O remain outside the transaction.
 */
export async function getPostgresAiWorkflowSourceImage(input: {
  enterpriseId: string | bigint;
  workflowId: string | bigint;
}) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const workflowId = parsePostgresId(input.workflowId, 'workflowId');
  return withTenantTransaction(enterpriseId, async (transaction) => {
    const workflow = await new AiWorkflowRepository(transaction).findById(workflowId);
    if (!workflow) throw notFound('Workflow not found or access denied');
    if (!workflow.sourceImage?.startsWith('data:image')) {
      throw notFound('Workflow source image not found');
    }
    return workflow.sourceImage;
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
 * Persists the existing manual/mock workflow result as a bigint scenario
 * generation. It intentionally bypasses provider submission and credit billing.
 */
export async function createPostgresAiWorkflowManualGeneration(
  input: CreatePostgresWorkflowManualGenerationInput
) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const operatorId = parsePostgresId(input.operatorId, 'operatorId');
  const workflowId = parsePostgresId(input.workflowId, 'workflowId');
  const parentGenerationId = input.parentGenerationId
    ? parsePostgresId(input.parentGenerationId, 'parentGenerationId')
    : null;
  const outputImageUrl = await persistPostgresManualGenerationImage({
    enterpriseId,
    imageUrl: input.imageUrl,
  });
  const assetId = getPostgresAssetIdFromImageUrl(outputImageUrl);
  if (!assetId) throw new Error('Manual generation output asset was not persisted');

  return withTenantTransaction(enterpriseId, async (transaction) => {
    const workflows = new AiWorkflowRepository(transaction);
    const workflow = await workflows.findById(workflowId);
    if (!workflow) throw notFound('方案会话不存在或无权访问');
    await new LeadLifecycleRepository(transaction).lockByIds([workflow.leadId]);
    const lead = await new LeadRepository(transaction).findById(workflow.leadId);
    if (!lead) throw notFound('客户线索不存在或无权访问');
    if (lead.archivedAt) throw leadArchivedError();

    const creations = new AiCreationRepository(transaction);
    const asset = await creations.findMediaAssetForUpdate(assetId);
    if (!asset) throw notFound('手动上传图片不存在或无权访问');
    if (asset.ownerId) {
      throw Object.assign(new Error('Manual generation image is already owned by another record'), { status: 409 });
    }
    if (parentGenerationId) {
      const parent = await creations.findGeneration(parentGenerationId);
      if (!parent || parent.workflowId !== workflow.id) {
        throw notFound('上一步产物不存在或不属于当前方案会话');
      }
    }

    const generation = await creations.createGeneration({
      enterpriseId,
      operatorId,
      leadId: lead.id,
      workflowId: workflow.id,
      floorPlanId: workflow.sourceFloorPlanId,
      parentGenerationId,
      type: 'scenario',
      channel: 'admin',
      stageKey: input.stageKey,
      sourceAssetRole: input.sourceAssetRole || workflow.sourceAssetRole,
      status: 'succeeded',
      input: {
        style: 'mock',
        customPrompt: 'Manual uploaded image (AI generation skipped)',
        styleReferenceImage: input.styleReferenceImage?.trim() || undefined,
      },
      output: {
        imageUrl: outputImageUrl,
        promptUsed: 'Manual uploaded test image',
      },
      provider: 'manual_upload',
      billing: { price: 0, status: 'consumed' },
    });
    await creations.updateMediaAsset(asset.id, {
      ownerType: 'ai_generation_output',
      ownerId: generation.id,
    });
    if (input.nextStageKey) {
      await workflows.update(workflow.id, { currentStageKey: input.nextStageKey });
    }
    return generation;
  });
}

/** Creates a workflow-stage generation with immutable style, price, and lighting-analysis snapshots. */
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

  const prepared = await withTenantTransaction(enterpriseId, async (transaction) => {
    const workflows = new AiWorkflowRepository(transaction);
    const workflow = await workflows.findById(workflowId);
    if (!workflow || workflow.status !== 'active') throw notFound('方案会话不存在或无权访问');

    await new LeadLifecycleRepository(transaction).lockByIds([workflow.leadId]);
    const lead = await new LeadRepository(transaction).findById(workflow.leadId);
    if (!lead) throw notFound('客户线索不存在或无权访问');
    if (lead.archivedAt) throw leadArchivedError();

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

    const imageMode = resolveWorkflowImageMode(input.stageKey, preset.image.mode);
    const prompt = [
      buildPromptFromPreset(preset.promptTemplate, {}),
      floorPlan ? buildWorkflowFloorPlanContext(floorPlan.layoutData) : '',
    ].filter(Boolean).join(' ');
    const parentGenerationId = availability.parentGenerationId
      ? parsePostgresId(availability.parentGenerationId, 'parentGenerationId')
      : null;
    const parentGeneration = parentGenerationId
      ? generations.find((generation) => generation.id === parentGenerationId) || null
      : null;
    const lightingSource = input.stageKey === 'lighting'
      ? [
          input.styleReferenceImage?.trim(),
          typeof asRecord(parentGeneration?.output).imageUrl === 'string'
            ? String(asRecord(parentGeneration?.output).imageUrl)
            : undefined,
          typeof asRecord(parentGeneration?.input).styleReferenceImage === 'string'
            ? String(asRecord(parentGeneration?.input).styleReferenceImage)
            : undefined,
        ].find((value): value is string => Boolean(value))
      : undefined;
    if (input.stageKey === 'lighting' && !lightingSource) {
      throw Object.assign(new Error('“增强签单”阶段必须提供白天参考效果图以供分析与重绘。'), { status: 400 });
    }
    const nextRecommendedStage = preset.nextRecommendedStage || getNextWorkflowStage(input.stageKey);
    const presetSnapshot = buildPresetSnapshot(
      preset as NonNullable<Awaited<ReturnType<typeof getAiStylePresetByKey>>>
    );
    presetSnapshot.image = { ...presetSnapshot.image, mode: imageMode };

    const generation = await creations.createGeneration({
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
    return {
      generation,
      lighting: input.stageKey === 'lighting'
        ? {
            sourceImage: lightingSource!,
            floorPlanContext: floorPlan ? buildWorkflowFloorPlanContext(floorPlan.layoutData) : '',
            promptTemplate: preset.promptTemplate,
            promptTemplateSecondStage: preset.promptTemplateSecondStage,
            negativePrompt: preset.negativePrompt,
          }
        : null,
    };
  });

  if (!prepared.lighting) return prepared.generation;

  try {
    const providerImage = await resolvePostgresScenarioProviderImage(
      enterpriseId,
      prepared.lighting.sourceImage
    );
    if (!providerImage) throw new Error('“增强签单”阶段必须提供白天参考效果图以供分析与重绘。');
    const analysisMessages: AiChatMessage[] = [{
      role: 'user',
      content: [
        { type: 'text', text: buildPromptFromPreset(prepared.lighting.promptTemplate || '', {}) },
        { type: 'image_url', image_url: { url: providerImage } },
      ],
    }];
    const sceneAnalysis = await executePostgresWorkflowChat({
      enterpriseId,
      generationId: prepared.generation.id,
      logicalModelKey: 'vision.reference_analysis',
      messages: analysisMessages,
      temperature: 0.7,
      metadata: { workflowStage: 'lighting', step: 'reference_analysis' },
    });
    const compileResult = await executePostgresWorkflowChat({
      enterpriseId,
      generationId: prepared.generation.id,
      logicalModelKey: 'chat.general',
      messages: [
        { role: 'system', content: 'You are an expert compiler of visual design boards and interior design prompts.' },
        {
          role: 'user',
          content: `
Task: Compile a highly detailed, professional English image generation prompt for Stable Diffusion/Flux.

Inputs:
1. Space Design & Analysis:
${sceneAnalysis.content}

2. Generation Goal:
${prepared.lighting.promptTemplateSecondStage || '直接生成展板图片，把灯光设计分析，灯光清单，跟夜景效果图，罗列出来'}

Output MUST be a JSON object with keys "prompt" and "negative_prompt".
          `.trim(),
        },
      ],
      temperature: 0.7,
      metadata: { workflowStage: 'lighting', step: 'prompt_compilation' },
    });
    const compiled = parseLightingPrompt(compileResult.content, prepared.lighting.negativePrompt);
    const prompt = [compiled.prompt, prepared.lighting.floorPlanContext].filter(Boolean).join(' ');

    return withTenantTransaction(enterpriseId, async (transaction) => {
      const creations = new AiCreationRepository(transaction);
      const generation = await creations.findGenerationForUpdate(prepared.generation.id);
      if (!generation || generation.status !== 'pending') {
        throw new Error('场景生成任务已变更，无法写入灯光提示词。');
      }
      const updated = await creations.updateGeneration(generation.id, {
        input: {
          ...asRecord(generation.input),
          customPrompt: prompt,
          negativePrompt: compiled.negativePrompt,
          styleReferenceImage: prepared.lighting!.sourceImage,
          sceneAnalysis: sceneAnalysis.content,
        },
        output: { ...asRecord(generation.output), promptUsed: prompt },
      });
      if (!updated) throw new Error('场景生成任务不存在。');
      return updated;
    });
  } catch (error) {
    await withTenantTransaction(enterpriseId, async (transaction) => {
      const creations = new AiCreationRepository(transaction);
      const generation = await creations.findGenerationForUpdate(prepared.generation.id);
      if (generation?.status === 'pending') {
        await creations.updateGeneration(generation.id, {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : '灯光阶段的视觉分析或提示词编译失败',
        });
      }
    });
    throw error;
  }
}
