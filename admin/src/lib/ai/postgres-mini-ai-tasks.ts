import { AiCreationRepository, AiWorkflowRepository, FloorPlanRepository, LeadLifecycleRepository, LeadRepository, type AiGenerationRecord } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import type { PostgresTransaction } from '@/db/transaction';
import { withTenantTransaction } from '@/db/transaction';
import { getAiCreditPrice } from '@/lib/ai/credits';
import {
  getPostgresMediaAssetImageUrl,
  getPostgresAssetIdFromImageUrl,
  readPostgresMediaAssetBuffer,
  storePostgresMediaBuffer,
} from '@/lib/ai/postgres-media-assets';
import { submitPostgresCreationGeneration } from '@/lib/ai/postgres-creation-runtime';
import {
  holdPostgresCreationGenerationCredits,
  releasePostgresCreationGenerationCredits,
} from '@/lib/ai/postgres-creation-service';
import { createPostgresAiWorkflow } from '@/lib/ai/postgres-workflow-service';
import { resolveMiniAiFloorPlanTarget, renderMiniAiFloorPlanControlPng, type MiniAiTargetScope } from '@/lib/ai/mini-ai-floorplan';
import type { MiniAiContext } from '@/lib/ai/mini-ai-auth';
import { getSignedMiniAiAssetUrl, getSignedMiniAiTaskResultUrl } from '@/lib/ai/mini-ai-assets';
import type { MiniAiRenderMode } from '@/lib/ai/mini-ai-types';
import { assertEligibleWorkflowFloorPlan } from '@/lib/ai/workflow-floorplan';
import { leadArchivedError } from '@/lib/lead-lifecycle';
import { getMiniAiRecipeRuntime } from '@/lib/ai/mini-ai-recipes';

export type CreateMiniAiTaskInput = {
  mode: MiniAiRenderMode;
  spaceAssetId?: string;
  referenceAssetId?: string;
  styleKey?: string;
  floorPlanId?: string;
  leadId?: string;
  roomId?: string;
  targetScope?: MiniAiTargetScope;
  workflowId?: string;
  createNewWorkflow?: boolean;
  sourceResultTaskId?: string;
  recipeId?: string;
};

export const MINI_AI_WHOLE_PLAN_RENDER_VERSION = 'cutaway-v1';

const MODE_CONFIG: Record<MiniAiRenderMode, { type: string; actionKey: string; logicalModelKey: 'image.generate.standard' | 'image.edit.standard'; stageKey: string; nextStageKey: string }> = {
  reference_recreate: { type: 'reference_recreate', actionKey: 'image.reference_recreate', logicalModelKey: 'image.edit.standard', stageKey: 'base_render', nextStageKey: 'soft_furnishing' },
  style_transform: { type: 'style_transform', actionKey: 'image.style_transform', logicalModelKey: 'image.edit.standard', stageKey: 'base_render', nextStageKey: 'soft_furnishing' },
  floor_plan_render: { type: 'floor_plan_style', actionKey: 'image.floor_plan_style', logicalModelKey: 'image.generate.standard', stageKey: 'perspective_upgrade', nextStageKey: 'base_render' },
  soft_furnishing: { type: 'soft_furnishing_render', actionKey: 'image.soft_furnishing_render', logicalModelKey: 'image.edit.standard', stageKey: 'soft_furnishing', nextStageKey: 'proposal_pack' },
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function errorCode(error: unknown) {
  return (error as { status?: number })?.status === 402 ? 'INSUFFICIENT_CREDITS' : 'PROVIDER_ERROR';
}

async function assertMiniAiGenerationLeadActive(
  transaction: PostgresTransaction,
  generation: Pick<AiGenerationRecord, 'leadId' | 'floorPlanId'>,
) {
  let leadId = generation.leadId;
  if (!leadId && generation.floorPlanId) {
    leadId = (await new LeadRepository(transaction).findByFloorPlanId(generation.floorPlanId))?.id ?? null;
  }
  if (!leadId) return;
  await new LeadLifecycleRepository(transaction).lockByIds([leadId]);
  const lead = await new LeadRepository(transaction).findById(leadId);
  if (lead?.archivedAt) throw leadArchivedError();
}

async function findAsset(enterpriseId: bigint, id?: string) {
  if (!id || !/^[1-9]\d*$/.test(id)) return null;
  return withTenantTransaction(enterpriseId, (transaction) => new AiCreationRepository(transaction).findMediaAsset(BigInt(id)));
}

async function cloneAsset(enterpriseId: bigint, asset: Awaited<ReturnType<typeof findAsset>>) {
  if (!asset) return null;
  if (asset.ownerType !== 'ai_generation_output') return asset;
  const buffer = await readPostgresMediaAssetBuffer(asset);
  return (await storePostgresMediaBuffer({
    enterpriseId,
    ownerType: 'ai_generation_input',
    mimeType: asset.mimeType,
    buffer,
    originalUrl: getPostgresMediaAssetImageUrl(asset.id),
  })).asset;
}

async function accessibleFloorPlan(enterpriseId: bigint, context: MiniAiContext, id: string) {
  if (!/^[1-9]\d*$/.test(id)) return null;
  return withTenantTransaction(enterpriseId, async (transaction) => {
    const plan = await new FloorPlanRepository(transaction).findById(BigInt(id));
    if (!plan) return null;
    const lead = await new LeadRepository(transaction).findByFloorPlanId(plan.id);
    if (lead?.archivedAt) throw leadArchivedError();
    if (['enterprise_admin', 'admin', 'super_admin'].includes(context.role)) return plan;
    if ((context.role === 'designer' || context.role === 'measurer') && plan.staffId === BigInt(context.operatorId)) return plan;
    if (!lead) return null;
    if (context.role === 'salesperson' && lead.promoterId !== BigInt(context.operatorId)) return null;
    if (context.role === 'designer' && lead.assignedTo !== BigInt(context.operatorId)) return null;
    return plan;
  });
}

async function accessibleLead(enterpriseId: bigint, context: MiniAiContext, id?: string) {
  if (!id || !/^[1-9]\d*$/.test(id)) return null;
  const operatorId = BigInt(context.operatorId);
  return withTenantTransaction(enterpriseId, async (transaction) => {
    const lead = await new LeadRepository(transaction).findById(BigInt(id));
    if (!lead) return null;
    if (lead.archivedAt) throw leadArchivedError();
    if (['enterprise_admin', 'admin', 'super_admin'].includes(context.role)) return lead;
    if (context.role === 'salesperson') return lead.promoterId === operatorId ? lead : null;
    if (context.role === 'designer') {
      return lead.assignedTo === operatorId || lead.floorPlanRecords.some((plan) => plan.staffId === operatorId)
        ? lead
        : null;
    }
    if (context.role === 'measurer') return lead.floorPlanRecords.some((plan) => plan.staffId === operatorId) ? lead : null;
    return null;
  });
}

function buildPrompt(input: { mode: MiniAiRenderMode; style?: string; summary?: string; recipePrompt?: string }) {
  const style = input.style || 'modern';
  const structuralBoundary = input.mode === 'soft_furnishing'
    ? `Refine this room with ${style} soft furnishings while preserving all architecture and camera composition.`
    : input.mode === 'reference_recreate'
      ? `Recreate the reference interior in a ${style} visual language while preserving geometry, camera, crop, and openings.`
      : input.mode === 'floor_plan_render'
        ? `Create a premium ${style} interior visualization from the measured floor plan. Preserve every wall, opening, room, and adjacency.`
        : `Apply ${style} interior design to the supplied room image while preserving all structural boundaries.`;
  const recipe = input.recipePrompt?.trim()
    ? `Design recipe: ${input.recipePrompt.trim()}`
    : '';
  return `${structuralBoundary} ${recipe} Photorealistic, coherent scale, natural lighting, high material fidelity, no text or labels. ${input.summary || ''}`.trim();
}

export async function createPostgresMiniAiTask(input: CreateMiniAiTaskInput, context: MiniAiContext) {
  const config = MODE_CONFIG[input.mode];
  if (!config) throw new Error('不支持的 AI 生成模式');
  const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
  const operatorId = parsePostgresId(context.operatorId, 'operatorId');
  if (!input.floorPlanId && (input.roomId || input.targetScope)) throw new Error('设计范围必须关联正式户型');
  if (input.mode === 'floor_plan_render' && !input.floorPlanId) throw new Error('户型生成必须选择正式户型');
  const [space, reference, price, plan, sourceTask, recipe] = await Promise.all([
    findAsset(enterpriseId, input.spaceAssetId),
    findAsset(enterpriseId, input.referenceAssetId),
    getAiCreditPrice(config.actionKey as never),
    input.floorPlanId ? accessibleFloorPlan(enterpriseId, context, input.floorPlanId) : Promise.resolve(null),
    input.sourceResultTaskId ? getPostgresMiniAiTask(input.sourceResultTaskId, context) : Promise.resolve(null),
    input.recipeId ? getMiniAiRecipeRuntime(input.recipeId) : Promise.resolve(null),
  ]);
  if (input.recipeId && !recipe) throw Object.assign(new Error('装修配方不存在或已下架'), { status: 404, code: 'RECIPE_UNAVAILABLE' });
  const requestedRecipeInput = input.mode === 'floor_plan_render' ? 'floor_plan' : 'photo';
  if (recipe && !recipe.inputTypes.includes(requestedRecipeInput)) {
    throw Object.assign(new Error('当前装修配方不支持所选输入方式'), { status: 400, code: 'RECIPE_INPUT_UNSUPPORTED' });
  }
  if (input.spaceAssetId && !space) throw new Error('空间图片不存在或无权访问');
  if (input.referenceAssetId && !reference) throw new Error('参考图片不存在或无权访问');
  if (input.mode === 'reference_recreate' && !reference) throw new Error('请上传有效的参考图片');
  if (input.sourceResultTaskId && (!sourceTask || sourceTask.status !== 'succeeded')) throw new Error('来源成果不存在或尚未生成成功');
  if (input.mode !== 'floor_plan_render' && !space && !sourceTask) throw new Error('空间图片不存在或无权访问');
  if (input.floorPlanId && !plan) throw Object.assign(new Error('当前角色无权使用所选正式户型'), { status: 403 });
  if (plan) assertEligibleWorkflowFloorPlan(plan);
  const target = plan ? resolveMiniAiFloorPlanTarget(plan.layoutData, input.targetScope, input.roomId) : null;
  if (input.floorPlanId && !target) throw new Error('正式户型缺少可用房间数据');
  const requestedLead = await accessibleLead(enterpriseId, context, input.leadId);
  if (input.leadId && !requestedLead) throw Object.assign(new Error('当前角色无权使用所选客户'), { status: 403 });
  const planLead = plan
    ? await withTenantTransaction(enterpriseId, (transaction) => new LeadRepository(transaction).findByFloorPlanId(plan.id))
    : null;
  if (planLead?.archivedAt) throw leadArchivedError();
  const leadId = requestedLead?.id || planLead?.id;
  let workflowId: bigint | undefined;
  if (input.workflowId && /^[1-9]\d*$/.test(input.workflowId)) {
    const workflow = await withTenantTransaction(enterpriseId, (transaction) => new AiWorkflowRepository(transaction).findById(BigInt(String(input.workflowId))));
    if (!workflow || workflow.operatorId !== operatorId || workflow.status !== 'active') {
      throw Object.assign(new Error('当前角色无权续接该客户方案'), { status: 403 });
    }
    if ((leadId && workflow.leadId !== leadId) || (plan && workflow.sourceFloorPlanId !== plan.id)) {
      throw Object.assign(new Error('所选客户方案与当前客户户型不匹配'), { status: 409 });
    }
    workflowId = workflow.id;
  }
  else if (sourceTask?.workflowId) workflowId = sourceTask.workflowId;
  else if (leadId) {
    const matchingWorkflows = await withTenantTransaction(enterpriseId, (transaction) => (
      new AiWorkflowRepository(transaction).list({ leadId, operatorId, status: 'active', limit: 20 })
    ));
    const exactMatches = matchingWorkflows.rows.filter((workflow) => (
      !plan || workflow.sourceFloorPlanId === plan.id
    ));
    if (!input.createNewWorkflow && exactMatches.length > 1) {
      throw Object.assign(new Error('当前客户有多个可继续的设计方案，请先选择一个'), {
        status: 409,
        code: 'WORKFLOW_CONFLICT',
        workflows: exactMatches.map((workflow) => ({
          id: workflow.id.toString(),
          title: workflow.title,
          currentStageKey: workflow.currentStageKey,
          updatedAt: workflow.updatedAt,
        })),
      });
    }
    if (!input.createNewWorkflow && exactMatches.length === 1) {
      workflowId = exactMatches[0].id;
    } else {
      const workflow = await createPostgresAiWorkflow({ enterpriseId, operatorId, leadId, sourceFloorPlanId: plan?.id, sourceAssetRole: input.mode === 'floor_plan_render' ? 'floor_plan' : 'rough_sketch' });
      workflowId = workflow.id;
    }
  }
  const sourceImageUrl = sourceTask && typeof asRecord(sourceTask.output).imageUrl === 'string'
    ? String(asRecord(sourceTask.output).imageUrl)
    : undefined;
  const sourceAsset = await findAsset(enterpriseId, getPostgresAssetIdFromImageUrl(sourceImageUrl)?.toString());
  if (sourceTask && !sourceAsset) throw new Error('来源成果图片不可用');
  const spaceAsset = await cloneAsset(enterpriseId, sourceAsset || space);
  const referenceAsset = await cloneAsset(enterpriseId, reference);
  const controlAsset = plan ? (await storePostgresMediaBuffer({ enterpriseId, ownerType: 'ai_generation_input', mimeType: 'image/png', buffer: await renderMiniAiFloorPlanControlPng(plan.layoutData, 1024, target?.targetScope === 'single_room' ? target.roomId : undefined) })).asset : null;
  const roomData = target ? { summary: target.summary, roomId: target.roomId, targetScope: target.targetScope, targetLabel: target.targetLabel, roomCount: target.roomCount, ...(target.targetScope === 'whole_floor_plan' ? { navigationRenderVersion: MINI_AI_WHOLE_PLAN_RENDER_VERSION } : {}) } : undefined;
  const generation = await withTenantTransaction(enterpriseId, async (transaction) => {
    if (leadId) await assertMiniAiGenerationLeadActive(transaction, { leadId, floorPlanId: plan?.id ?? null });
    return new AiCreationRepository(transaction).createGeneration({
      enterpriseId, operatorId, floorPlanId: plan?.id, leadId: leadId ?? null, workflowId: workflowId ?? null, parentGenerationId: sourceTask?.id ?? null, type: 'miniprogram', channel: 'miniprogram', stageKey: config.stageKey, sourceAssetRole: plan ? 'floor_plan' : 'rough_sketch', nextRecommendedStage: config.nextStageKey, status: 'pending', actionKey: config.actionKey, capability: config.logicalModelKey === 'image.edit.standard' ? 'image.edit' : 'image.generate', logicalModelKey: plan && input.mode === 'floor_plan_render' ? 'image.edit.standard' : config.logicalModelKey, input: { mode: input.mode, style: input.styleKey || 'modern', recipeId: recipe?.id, recipeName: recipe?.name, recipeCategoryId: recipe?.categorySourceId, customPrompt: buildPrompt({ mode: input.mode, style: input.styleKey, summary: roomData?.summary, recipePrompt: recipe?.promptContent }), roomData, spaceImage: spaceAsset ? getPostgresMediaAssetImageUrl(spaceAsset.id) : undefined, referenceImage: referenceAsset ? getPostgresMediaAssetImageUrl(referenceAsset.id) : undefined, controlImage: controlAsset ? getPostgresMediaAssetImageUrl(controlAsset.id) : undefined, outputAspectRatio: input.mode === 'floor_plan_render' ? '1:1' : '16:9', outputSize: input.mode === 'floor_plan_render' ? '1024x1024' : '1280x720' }, output: {}, billing: { cycle: 0, actionKey: config.actionKey, price: price.credits, status: 'unbilled' } });
  });
  await withTenantTransaction(enterpriseId, async (transaction) => {
    const repo = new AiCreationRepository(transaction);
    await Promise.all([spaceAsset, referenceAsset, controlAsset].filter(Boolean).map((asset) => repo.updateMediaAsset(asset!.id, { ownerId: generation.id })));
  });
  try {
    await holdPostgresCreationGenerationCredits({ enterpriseId: enterpriseId.toString(), generationId: generation.id.toString() });
  } catch (error) {
    await withTenantTransaction(enterpriseId, (transaction) => new AiCreationRepository(transaction).updateGeneration(generation.id, { status: 'failed', errorCode: errorCode(error), errorMessage: error instanceof Error ? error.message : String(error) }));
    throw error;
  }
  return getPostgresMiniAiTask(generation.id.toString(), context);
}

export async function getPostgresMiniAiTask(id: string, context: MiniAiContext) {
  return findPostgresMiniAiTask(id, {
    enterpriseId: context.enterpriseId,
    operatorId: context.operatorId,
  });
}

async function findPostgresMiniAiTask(inputId: string, input: {
  enterpriseId: string;
  operatorId?: string;
}) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const generationId = parsePostgresId(inputId, 'generationId');
  const operatorId = input.operatorId ? parsePostgresId(input.operatorId, 'operatorId') : undefined;
  return withTenantTransaction(enterpriseId, async (transaction) => {
    const generation = await new AiCreationRepository(transaction).findGeneration(generationId);
    if (!generation || generation.deletedAt || generation.channel !== 'miniprogram') return null;
    if (operatorId && generation.operatorId !== operatorId) return null;
    return generation;
  });
}

export function getPostgresMiniAiTaskForTenant(id: string, enterpriseId: string) {
  return findPostgresMiniAiTask(id, { enterpriseId });
}

export async function executePostgresMiniAiTask(id: string, context: MiniAiContext) {
  const generation = await getPostgresMiniAiTask(id, context);
  if (!generation) throw Object.assign(new Error('任务不存在'), { status: 404 });
  await withTenantTransaction(parsePostgresId(context.enterpriseId, 'enterpriseId'), (transaction) =>
    assertMiniAiGenerationLeadActive(transaction, generation)
  );
  if (generation.status === 'pending' || generation.status === 'created') await submitPostgresCreationGeneration({ enterpriseId: context.enterpriseId, generationId: generation.id.toString() });
  return getPostgresMiniAiTask(id, context);
}

export async function retryPostgresMiniAiTask(id: string, context: MiniAiContext) {
  const generation = await getPostgresMiniAiTask(id, context);
  if (!generation || generation.status !== 'failed') throw Object.assign(new Error('只有失败的小程序 AI 任务可以重试'), { status: 400 });
  const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
  if (String(asRecord(generation.billing).status) === 'held') await releasePostgresCreationGenerationCredits({ enterpriseId: context.enterpriseId, generationId: id, errorMessage: '重试前释放冻结积分' });
  await withTenantTransaction(enterpriseId, async (transaction) => {
    await assertMiniAiGenerationLeadActive(transaction, generation);
    return new AiCreationRepository(transaction).updateGeneration(generation.id, { status: 'pending', errorCode: null, errorMessage: null, currentAttemptId: null, externalTask: {}, retryCount: generation.retryCount + 1, billing: { ...asRecord(generation.billing), cycle: generation.retryCount + 1, status: 'unbilled' } });
  });
  return executePostgresMiniAiTask(id, context);
}

/** Prepares a failed tenant task for an administrator-triggered retry. */
export async function preparePostgresMiniAiTaskRetry(id: string, enterpriseId: string) {
  const generation = await findPostgresMiniAiTask(id, { enterpriseId });
  if (!generation || generation.status !== 'failed') {
    throw Object.assign(new Error('Only failed Mini Program AI tasks can be retried'), { status: 400 });
  }
  const parsedEnterpriseId = parsePostgresId(enterpriseId, 'enterpriseId');
  if (String(asRecord(generation.billing).status) === 'held') {
    await releasePostgresCreationGenerationCredits({
      enterpriseId,
      generationId: id,
      errorMessage: 'Release frozen credits before administrator retry',
    });
  }
  await withTenantTransaction(parsedEnterpriseId, async (transaction) => {
    await assertMiniAiGenerationLeadActive(transaction, generation);
    return new AiCreationRepository(transaction).updateGeneration(generation.id, {
      status: 'pending',
      errorCode: null,
      errorMessage: null,
      currentAttemptId: null,
      externalTask: {},
      retryCount: generation.retryCount + 1,
      billing: {
        ...asRecord(generation.billing),
        cycle: generation.retryCount + 1,
        status: 'unbilled',
      },
    });
  });
  return generation;
}

/** Allows a platform administrator in the tenant context to retry a staff-owned task. */
export async function retryPostgresMiniAiTaskForAdmin(id: string, enterpriseId: string) {
  const generation = await preparePostgresMiniAiTaskRetry(id, enterpriseId);
  await submitPostgresCreationGeneration({ enterpriseId, generationId: generation.id.toString() });
  return withTenantTransaction(parsePostgresId(enterpriseId, 'enterpriseId'), (transaction) =>
    new AiCreationRepository(transaction).findGeneration(generation.id)
  );
}

export function serializePostgresMiniAiTask(generation: NonNullable<Awaited<ReturnType<typeof getPostgresMiniAiTask>>>, request: Request) {
  const input = asRecord(generation.input);
  const roomData = asRecord(input.roomData);
  const enterpriseId = generation.enterpriseId.toString();
  const imageUrl = (key: string) => {
    const value = typeof input[key] === 'string' ? input[key] as string : undefined;
    const assetId = getPostgresAssetIdFromImageUrl(value);
    if (!assetId) return undefined;
    return getSignedMiniAiAssetUrl({ request, assetId: assetId.toString(), enterpriseId });
  };
  const output = asRecord(generation.output);
  const outputImageUrl = typeof output.imageUrl === 'string' ? output.imageUrl : undefined;
  const resultAssetId = getPostgresAssetIdFromImageUrl(outputImageUrl);
  const resultImageUrl = resultAssetId
    ? getSignedMiniAiAssetUrl({ request, assetId: resultAssetId.toString(), enterpriseId })
    : /^https?:\/\//i.test(String(outputImageUrl || '').trim())
      ? getSignedMiniAiTaskResultUrl({ request, taskId: generation.id.toString(), enterpriseId })
      : undefined;
  return { id: generation.id.toString(), mode: input.mode || generation.type, status: generation.status, progress: generation.status === 'succeeded' || generation.status === 'failed' ? 100 : generation.status === 'processing' ? 65 : 10, styleKey: input.style, recipeId: input.recipeId ? String(input.recipeId) : undefined, recipeName: typeof input.recipeName === 'string' ? input.recipeName : undefined, recipeCategoryId: typeof input.recipeCategoryId === 'string' ? input.recipeCategoryId : undefined, spaceAssetId: getPostgresAssetIdFromImageUrl(typeof input.spaceImage === 'string' ? input.spaceImage : undefined)?.toString(), referenceAssetId: getPostgresAssetIdFromImageUrl(typeof input.referenceImage === 'string' ? input.referenceImage : undefined)?.toString(), spaceImageUrl: imageUrl('spaceImage'), referenceImageUrl: imageUrl('referenceImage'), controlImageUrl: imageUrl('controlImage'), resultImageUrl, resultAssetId: resultAssetId?.toString(), errorCode: generation.errorCode, error: generation.errorMessage, retryCount: generation.retryCount, credits: Number(asRecord(generation.billing).price || 0), billingStatus: asRecord(generation.billing).status, provider: generation.provider, model: undefined, workflowId: generation.workflowId?.toString(), floorPlanId: generation.floorPlanId?.toString(), leadId: generation.leadId?.toString(), roomId: typeof roomData.roomId === 'string' ? roomData.roomId : undefined, targetScope: roomData.targetScope, targetLabel: roomData.targetLabel, outputAspectRatio: input.outputAspectRatio, outputSize: input.outputSize, syncedToWorkflow: Boolean(generation.workflowId), isSelectedBaseline: generation.isSelectedBaseline, stageKey: generation.stageKey, nextStageKey: generation.nextRecommendedStage, createdAt: generation.createdAt, updatedAt: generation.updatedAt };
}

export async function listPostgresMiniAiTasks(context: MiniAiContext, page = 1, limit = 12) {
  const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
  const operatorId = parsePostgresId(context.operatorId, 'operatorId');
  return withTenantTransaction(enterpriseId, (transaction) => new AiCreationRepository(transaction).listMiniProgramGenerations({ operatorId, page, limit }));
}

export async function listPostgresMiniAiWholePlanRenderHeroTasks(context: MiniAiContext, floorPlanId: string) {
  const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
  const operatorId = parsePostgresId(context.operatorId, 'operatorId');
  const parsedFloorPlanId = parsePostgresId(floorPlanId, 'floorPlanId');
  return withTenantTransaction(enterpriseId, (transaction) => (
    new AiCreationRepository(transaction).listMiniProgramWholePlanRenderHeroGenerations({
      operatorId,
      floorPlanId: parsedFloorPlanId,
      limit: 5,
    })
  ));
}

export async function deletePostgresMiniAiTask(id: string, context: MiniAiContext) {
  const generation = await getPostgresMiniAiTask(id, context);
  if (!generation) return false;
  if (generation.status === 'processing' || String(asRecord(generation.billing).status) === 'held') throw Object.assign(new Error('生成中的任务不能删除'), { status: 409 });
  const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
  await withTenantTransaction(enterpriseId, (transaction) => new AiCreationRepository(transaction).updateGeneration(generation.id, { deletedAt: new Date() }));
  return true;
}
