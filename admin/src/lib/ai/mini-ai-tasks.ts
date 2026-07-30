import mongoose from 'mongoose';
import { AiGeneration, type IAiGeneration } from '@/models/AiGeneration';
import { MediaAsset } from '@/models/MediaAsset';
import { FloorPlan } from '@/models/FloorPlan';
import { AiWorkflow } from '@/models/AiWorkflow';
import Lead from '@/models/Lead';
import {
  ensureMediaAssetDimensions,
  getAssetIdFromImageUrl,
  getMediaAssetImageUrl,
  persistImageReference,
  readMediaAssetBuffer,
  resolveAiProviderImageInput,
  storeMediaBuffer,
} from '@/lib/ai/media-assets';
import { ensureDefaultAiStylePresets, getAiStylePresetByKey } from '@/lib/ai/presets';
import {
  buildMiniAiRenderPrompt,
  selectMiniAiOutputSpec,
  selectReferenceRecreateImageInputs,
  type MiniAiRenderMode,
} from '@/lib/ai/mini-ai-provider';
import { ensureGenerationCreditHold, executeGenerationImage, releaseGenerationCredits } from '@/lib/ai/execution-service';
import { getAiCreditPrice } from '@/lib/ai/credits';
import { getMiniAiPublicRequestUrl, getSignedMiniAiAssetUrl } from '@/lib/ai/mini-ai-assets';
import type { MiniAiContext } from '@/lib/ai/mini-ai-auth';
import type { AiActionKey, AiLogicalModelKey } from '@/lib/ai/provider-types';
import type { AiWorkflowStageKey } from '@/lib/ai/workflow-stages';
import { syncSuccessfulGenerationToWorkflow } from '@/lib/ai/workflow-baseline';
import { findAccessibleMiniAiFloorPlan } from '@/lib/ai/mini-ai-floorplan-access';
import {
  renderMiniAiFloorPlanControlPng,
  resolveMiniAiFloorPlanTarget,
  type MiniAiTargetScope,
} from '@/lib/ai/mini-ai-floorplan';
import {
  buildMiniAiTargetGenerationFilter,
  generationMatchesMiniAiTarget,
  isMiniAiGenerationCurrent,
} from '@/lib/ai/mini-ai-target-context';

export interface CreateMiniAiTaskInput {
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
}

export const MINI_AI_WHOLE_PLAN_RENDER_VERSION = 'cutaway-v1';

const MODE_CONFIG: Record<MiniAiRenderMode, {
  type: IAiGeneration['type'];
  actionKey: AiActionKey;
  logicalModelKey: AiLogicalModelKey;
  stageKey: AiWorkflowStageKey;
  nextStageKey?: AiWorkflowStageKey;
}> = {
  reference_recreate: {
    type: 'reference_recreate', actionKey: 'image.reference_recreate',
    logicalModelKey: 'image.edit.standard', stageKey: 'base_render', nextStageKey: 'soft_furnishing',
  },
  style_transform: {
    type: 'style_transform', actionKey: 'image.style_transform',
    logicalModelKey: 'image.edit.standard', stageKey: 'base_render', nextStageKey: 'soft_furnishing',
  },
  floor_plan_render: {
    type: 'floor_plan_style', actionKey: 'image.floor_plan_style',
    logicalModelKey: 'image.generate.standard', stageKey: 'perspective_upgrade', nextStageKey: 'base_render',
  },
  soft_furnishing: {
    type: 'soft_furnishing_render', actionKey: 'image.soft_furnishing_render',
    logicalModelKey: 'image.edit.standard', stageKey: 'soft_furnishing', nextStageKey: 'proposal_pack',
  },
};

function taskErrorCode(error: unknown) {
  const explicit = (error as { code?: string })?.code;
  if (explicit) return explicit;
  return (error as { status?: number })?.status === 402 ? 'INSUFFICIENT_CREDITS' : 'PROVIDER_ERROR';
}

async function findOwnedAsset(assetId: string, enterpriseId: mongoose.Types.ObjectId) {
  if (!mongoose.Types.ObjectId.isValid(assetId)) return null;
  return MediaAsset.findOne({
    _id: assetId,
    enterpriseId,
    ownerType: { $in: ['manual_upload', 'ai_generation_input', 'ai_generation_output'] },
    deletedAt: { $exists: false },
  });
}

async function cloneGenerationOutputAsInput(
  asset: Awaited<ReturnType<typeof findOwnedAsset>>,
  enterpriseId: mongoose.Types.ObjectId,
  ownerId: mongoose.Types.ObjectId
) {
  if (!asset || asset.ownerType !== 'ai_generation_output') return asset;
  const buffer = await readMediaAssetBuffer(asset);
  const cloned = await storeMediaBuffer({
    enterpriseId,
    ownerType: 'ai_generation_input',
    ownerId,
    mimeType: asset.mimeType,
    buffer,
    originalUrl: getMediaAssetImageUrl(String(asset._id)),
  });
  return cloned.asset;
}

async function findSourceResultTask(taskId: string | undefined, context: MiniAiContext) {
  if (!taskId) return null;
  if (!mongoose.Types.ObjectId.isValid(taskId)) throw new Error('来源成果不存在');
  return AiGeneration.findOne({
    _id: taskId,
    enterpriseId: context.enterpriseId,
    status: 'succeeded',
    deletedAt: { $exists: false },
  });
}

type MiniAiSourceMaterializationDeps = {
  findAsset: typeof findOwnedAsset;
  readAssetBuffer: typeof readMediaAssetBuffer;
  storeBuffer: typeof storeMediaBuffer;
  persistReference: typeof persistImageReference;
};

export async function materializeSourceResultAsInput(input: {
  sourceTask: IAiGeneration;
  enterpriseId: mongoose.Types.ObjectId;
  ownerId: mongoose.Types.ObjectId;
  deps?: MiniAiSourceMaterializationDeps;
}) {
  const deps = input.deps || {
    findAsset: findOwnedAsset,
    readAssetBuffer: readMediaAssetBuffer,
    storeBuffer: storeMediaBuffer,
    persistReference: persistImageReference,
  };
  const outputImage = input.sourceTask.output?.imageUrl;
  if (!outputImage) throw new Error('来源成果没有可复用的结果图片');
  const outputAssetId = getAssetIdFromImageUrl(outputImage);
  if (outputAssetId) {
    const outputAsset = await deps.findAsset(outputAssetId, input.enterpriseId);
    if (!outputAsset) throw new Error('来源成果图片已不可用');
    const buffer = await deps.readAssetBuffer(outputAsset);
    const cloned = await deps.storeBuffer({
      enterpriseId: input.enterpriseId,
      ownerType: 'ai_generation_input',
      ownerId: input.ownerId,
      mimeType: outputAsset.mimeType,
      buffer,
      originalUrl: getMediaAssetImageUrl(String(outputAsset._id)),
    });
    return cloned.asset;
  }
  const persistedImage = await deps.persistReference({
    enterpriseId: input.enterpriseId,
    ownerType: 'ai_generation_input',
    ownerId: input.ownerId,
    image: outputImage,
  });
  const persistedAssetId = getAssetIdFromImageUrl(persistedImage);
  if (!persistedAssetId) throw new Error('来源成果图片固化失败');
  const persistedAsset = await deps.findAsset(persistedAssetId, input.enterpriseId);
  if (!persistedAsset) throw new Error('来源成果图片固化失败');
  return persistedAsset;
}

export function validateMiniAiSourceResultTask(input: {
  sourceTask: IAiGeneration;
  target: { floorPlanId?: string; targetScope?: MiniAiTargetScope; roomId?: string };
  planUpdatedAt?: Date | string;
  workflowId?: string;
}) {
  if (!generationMatchesMiniAiTarget(input.sourceTask, input.target)) {
    return '来源成果与当前设计房间不一致';
  }
  if (!isMiniAiGenerationCurrent(input.sourceTask, input.planUpdatedAt)) {
    return '来源成果早于户型最新版本，请先重新生成当前空间';
  }
  if (!input.sourceTask.workflowId) return '来源成果不属于可续接的客户方案';
  if (input.workflowId && String(input.sourceTask.workflowId) !== input.workflowId) {
    return '来源成果不属于当前客户方案';
  }
  return '';
}

async function deriveFloorPlanTarget(input: CreateMiniAiTaskInput, context: MiniAiContext) {
  if (!input.floorPlanId) return null;
  const plan = await findAccessibleMiniAiFloorPlan(input.floorPlanId, context);
  if (!plan) {
    throw Object.assign(new Error('当前角色无权使用所选正式户型'), { status: 403 });
  }
  return {
    plan,
    target: resolveMiniAiFloorPlanTarget(plan.layoutData, input.targetScope, input.roomId),
  };
}

async function findAccessibleLead(
  leadId: string | mongoose.Types.ObjectId,
  context: MiniAiContext,
  floorPlanId?: string | mongoose.Types.ObjectId
) {
  const baseFilter: Record<string, unknown> = {
    _id: leadId,
    enterpriseId: context.enterpriseId,
  };
  if (context.role === 'salesperson') baseFilter.promoterId = context.operatorId;
  if (context.role === 'designer') {
    const assignedPlanIds = await FloorPlan.find({
      enterpriseId: context.enterpriseId,
      staffId: context.operatorId,
      ...(floorPlanId ? { _id: floorPlanId } : {}),
    }).distinct('_id');
    baseFilter.$or = [
      { assignedTo: context.operatorId },
      { floorPlanIds: { $in: assignedPlanIds } },
      { primaryFloorPlanId: { $in: assignedPlanIds } },
    ];
  }
  if (context.role === 'measurer') {
    const assignedPlanIds = await FloorPlan.find({
      enterpriseId: context.enterpriseId,
      staffId: context.operatorId,
      ...(floorPlanId ? { _id: floorPlanId } : {}),
    }).distinct('_id');
    baseFilter.$or = [
      { floorPlanIds: { $in: assignedPlanIds } },
      { primaryFloorPlanId: { $in: assignedPlanIds } },
    ];
  }
  return Lead.findOne(baseFilter).select('name').lean();
}

async function resolveWorkflow(input: CreateMiniAiTaskInput, context: MiniAiContext, sourceImage?: string) {
  if (input.workflowId && mongoose.Types.ObjectId.isValid(input.workflowId)) {
    const existing = await AiWorkflow.findOne({ _id: input.workflowId, enterpriseId: context.enterpriseId, status: 'active' });
    if (existing) {
      const accessibleLead = await findAccessibleLead(
        existing.leadId,
        context,
        existing.sourceFloorPlanId || input.floorPlanId
      );
      if (accessibleLead) return existing;
      throw Object.assign(new Error('当前角色无权续接该客户方案'), { status: 403 });
    }
  }

  let leadId = input.leadId;
  if ((!leadId || !mongoose.Types.ObjectId.isValid(leadId)) && input.floorPlanId && mongoose.Types.ObjectId.isValid(input.floorPlanId)) {
    const owner = await Lead.findOne({
      enterpriseId: context.enterpriseId,
      $or: [
        { floorPlanIds: input.floorPlanId },
        { primaryFloorPlanId: input.floorPlanId },
      ],
    }).select('_id').lean();
    leadId = owner ? String(owner._id) : undefined;
  }
  if (!leadId || !mongoose.Types.ObjectId.isValid(leadId)) return null;

  const lead = await findAccessibleLead(leadId, context, input.floorPlanId);
  if (!lead) return null;
  const matchingWorkflowQuery: Record<string, unknown> = {
    enterpriseId: context.enterpriseId,
    leadId: lead._id,
    status: 'active',
  };
  if (input.floorPlanId && mongoose.Types.ObjectId.isValid(input.floorPlanId)) {
    matchingWorkflowQuery.sourceFloorPlanId = input.floorPlanId;
  }
  if (!input.createNewWorkflow) {
    const matchingWorkflows = await AiWorkflow.find(matchingWorkflowQuery)
      .sort({ isPrimary: -1, updatedAt: -1 })
      .limit(2);
    if (matchingWorkflows.length === 1) return matchingWorkflows[0];
    if (matchingWorkflows.length > 1) {
      throw Object.assign(new Error('当前客户有多个可续接方案，请先选择具体方案'), {
        status: 409,
        code: 'WORKFLOW_SELECTION_REQUIRED',
      });
    }
  }
  const count = await AiWorkflow.countDocuments({ enterpriseId: context.enterpriseId, leadId: lead._id });
  return AiWorkflow.create({
    enterpriseId: context.enterpriseId,
    leadId: lead._id,
    operatorId: context.operatorId,
    title: `${lead.name || '客户'} · 小程序快速方案${count ? ` ${count + 1}` : ''}`,
    workflowLabel: '小程序快速方案',
    isPrimary: count === 0,
    status: 'active',
    sourceImage,
    sourceFloorPlanId: input.floorPlanId || undefined,
    sourceAssetRole: input.mode === 'floor_plan_render' ? 'floor_plan' : 'rough_sketch',
    currentStageKey: MODE_CONFIG[input.mode].stageKey,
  });
}

export async function syncMiniAiWorkflow(generation: IAiGeneration, context: MiniAiContext) {
  if (generation.status !== 'succeeded' || !generation.workflowId) return generation;
  const mode = (generation.input.mode || generation.type) as MiniAiRenderMode;
  const config = MODE_CONFIG[mode];
  if (!config) return generation;
  if (String(generation.enterpriseId) !== String(context.enterpriseId)) return generation;
  await syncSuccessfulGenerationToWorkflow(generation);
  return generation;
}

export async function createMiniAiTask(input: CreateMiniAiTaskInput, context: MiniAiContext) {
  if (!MODE_CONFIG[input.mode]) throw new Error('不支持的 AI 生成模式');
  if (!input.floorPlanId && (input.roomId || input.targetScope)) {
    throw new Error('设计范围必须关联正式户型');
  }
  if (input.spaceAssetId && input.sourceResultTaskId) {
    throw new Error('空间图片和方案成果不能同时作为输入');
  }
  if (input.sourceResultTaskId && !['style_transform', 'soft_furnishing'].includes(input.mode)) {
    throw new Error('当前生成模式不能使用方案成果作为空间输入');
  }
  if (input.sourceResultTaskId && input.createNewWorkflow) {
    throw new Error('续接方案成果时不能同时新建备选方案');
  }
  if (input.sourceResultTaskId && !input.floorPlanId) {
    throw new Error('续接方案成果必须关联正式户型和设计范围');
  }
  const config = MODE_CONFIG[input.mode];
  const [rawSpaceAsset, rawReferenceAsset, price, floorPlanTarget, sourceResultTask] = await Promise.all([
    input.spaceAssetId ? findOwnedAsset(input.spaceAssetId, context.enterpriseId) : Promise.resolve(null),
    input.referenceAssetId ? findOwnedAsset(input.referenceAssetId, context.enterpriseId) : Promise.resolve(null),
    getAiCreditPrice(config.actionKey),
    deriveFloorPlanTarget(input, context),
    findSourceResultTask(input.sourceResultTaskId, context),
  ]);
  const usesReferenceFloorPlanControl = input.mode === 'reference_recreate' && Boolean(floorPlanTarget);
  if (input.sourceResultTaskId && !sourceResultTask) throw new Error('来源成果不存在或尚未生成成功');
  if (input.mode !== 'floor_plan_render' && !usesReferenceFloorPlanControl && !rawSpaceAsset && !sourceResultTask) {
    throw new Error('空间图片不存在或无权访问');
  }
  if (input.mode === 'floor_plan_render' && !floorPlanTarget) throw new Error('请选择包含正式闭合房间的户型');
  if (input.mode === 'reference_recreate' && !rawReferenceAsset) throw new Error('请上传有效的参考图片');
  if (input.mode !== 'reference_recreate' && !input.styleKey) throw new Error('请选择目标风格');

  const target = floorPlanTarget?.target;
  const targetIdentity = target && input.floorPlanId ? {
    floorPlanId: input.floorPlanId,
    targetScope: target.targetScope,
    roomId: target.roomId,
  } : {};
  if (sourceResultTask) {
    const sourceError = validateMiniAiSourceResultTask({
      sourceTask: sourceResultTask,
      target: targetIdentity,
      planUpdatedAt: floorPlanTarget?.plan.updatedAt,
      workflowId: input.workflowId,
    });
    if (sourceError) throw new Error(sourceError);
  }

  const workflowSourceImage = sourceResultTask?.output?.imageUrl
    || (rawSpaceAsset ? getMediaAssetImageUrl(String(rawSpaceAsset._id)) : undefined);
  const workflow = await resolveWorkflow({
    ...input,
    ...(sourceResultTask ? { workflowId: String(sourceResultTask.workflowId) } : {}),
  }, context, workflowSourceImage);
  if (sourceResultTask && String(sourceResultTask.workflowId || '') !== String(workflow?._id || '')) {
    throw new Error('来源成果不属于当前客户方案');
  }

  if (workflow) {
    const existingTask = await AiGeneration.findOne({
      workflowId: workflow._id,
      stageKey: config.stageKey,
      ...buildMiniAiTargetGenerationFilter(targetIdentity),
      status: { $in: ['created', 'pending', 'processing'] },
      deletedAt: { $exists: false },
    }).sort({ createdAt: -1 });
    if (existingTask) {
      throw Object.assign(new Error('该方案的当前阶段正在生成，请勿重复提交'), {
        status: 409,
        code: 'ACTIVE_GENERATION_EXISTS',
        ...(String(existingTask.operatorId) === String(context.operatorId)
          ? { existingTaskId: String(existingTask._id) }
          : {}),
      });
    }
  }

  const generationId = new mongoose.Types.ObjectId();
  const [spaceAsset, referenceAsset] = await Promise.all([
    sourceResultTask
      ? materializeSourceResultAsInput({ sourceTask: sourceResultTask, enterpriseId: context.enterpriseId, ownerId: generationId })
      : cloneGenerationOutputAsInput(rawSpaceAsset, context.enterpriseId, generationId),
    cloneGenerationOutputAsInput(rawReferenceAsset, context.enterpriseId, generationId),
  ]);
  const [spaceDimensions, referenceDimensions] = await Promise.all([
    ensureMediaAssetDimensions(spaceAsset),
    ensureMediaAssetDimensions(referenceAsset),
  ]);
  const spaceImage = spaceAsset ? getMediaAssetImageUrl(String(spaceAsset._id)) : undefined;

  const outputSpec = selectMiniAiOutputSpec({
    mode: input.mode,
    targetScope: target?.targetScope,
    spaceDimensions,
    referenceDimensions,
  });
  const usesWholePlanControl = input.mode === 'floor_plan_render' && target?.targetScope === 'whole_floor_plan';
  const usesFloorPlanControl = usesWholePlanControl || usesReferenceFloorPlanControl;
  const logicalModelKey: AiLogicalModelKey = usesFloorPlanControl
    ? 'image.edit.standard'
    : config.logicalModelKey;
  const controlAsset = usesFloorPlanControl && floorPlanTarget
    ? await storeMediaBuffer({
        enterpriseId: context.enterpriseId,
        ownerType: 'ai_generation_input',
        ownerId: generationId,
        mimeType: 'image/png',
        buffer: await renderMiniAiFloorPlanControlPng(
          floorPlanTarget.plan.layoutData,
          1024,
          target?.targetScope === 'single_room' ? target.roomId : undefined
        ),
      })
    : null;
  const controlImage = controlAsset ? getMediaAssetImageUrl(String(controlAsset.asset._id)) : undefined;

  const generation = await AiGeneration.create({
    _id: generationId,
    enterpriseId: context.enterpriseId,
    operatorId: context.operatorId,
    floorPlanId: input.floorPlanId || undefined,
    leadId: workflow?.leadId || input.leadId || undefined,
    workflowId: workflow?._id,
    parentGenerationId: sourceResultTask?._id,
    type: config.type,
    channel: 'miniprogram',
    stageKey: config.stageKey,
    sourceAssetRole: usesFloorPlanControl ? 'floor_plan' : 'rough_sketch',
    nextRecommendedStage: config.nextStageKey,
    status: 'created',
    actionKey: config.actionKey,
    capability: logicalModelKey === 'image.generate.standard' ? 'image.generate' : 'image.edit',
    logicalModelKey,
    retryCount: 0,
    input: {
      style: input.styleKey || 'reference', mode: input.mode,
      roomData: target ? {
        summary: target.summary,
        roomId: target.roomId,
        targetScope: target.targetScope,
        targetLabel: target.targetLabel,
        roomCount: target.roomCount,
        ...(input.mode === 'floor_plan_render' && target.targetScope === 'whole_floor_plan'
          ? { navigationRenderVersion: MINI_AI_WHOLE_PLAN_RENDER_VERSION }
          : {}),
      } : undefined,
      spaceImage,
      referenceImage: referenceAsset ? getMediaAssetImageUrl(String(referenceAsset._id)) : undefined,
      controlImage,
      outputAspectRatio: outputSpec.aspectRatio,
      outputSize: outputSpec.size,
    },
    billing: { cycle: 0, actionKey: config.actionKey, price: price.credits, status: 'unbilled' },
  });

  await Promise.all([
    spaceAsset ? MediaAsset.updateOne({ _id: spaceAsset._id, ownerType: { $ne: 'ai_generation_output' } }, { $set: { ownerType: 'ai_generation_input', ownerId: generation._id } }) : Promise.resolve(),
    referenceAsset ? MediaAsset.updateOne({ _id: referenceAsset._id, ownerType: { $ne: 'ai_generation_output' } }, { $set: { ownerType: 'ai_generation_input', ownerId: generation._id } }) : Promise.resolve(),
  ]);
  try {
    await ensureGenerationCreditHold(generation);
  } catch (error) {
    generation.status = 'failed';
    generation.errorCode = taskErrorCode(error);
    generation.errorMessage = error instanceof Error ? error.message : 'AI 点数不足';
    await generation.save();
    throw error;
  }
  return generation;
}

export async function executeMiniAiTask(generation: IAiGeneration, context: MiniAiContext) {
  if (!['held', 'consumed'].includes(generation.billing?.status || '')) throw new Error('当前任务尚未冻结 AI 点数');
  try {
    await ensureDefaultAiStylePresets(String(context.operatorId));
    const mode = (generation.input.mode || generation.type) as MiniAiRenderMode;
    const config = MODE_CONFIG[mode];
    if (!config) throw new Error('任务模式已失效');
    const stylePreset = mode !== 'reference_recreate'
      ? await getAiStylePresetByKey('furnishing_style', generation.input.style)
      : null;
    if (mode !== 'reference_recreate' && !stylePreset) throw new Error('目标风格已停用或不存在');
    const roomData = generation.input.roomData && typeof generation.input.roomData === 'object'
      ? generation.input.roomData as {
          summary?: string;
          targetScope?: MiniAiTargetScope;
          navigationRenderVersion?: string;
        }
      : undefined;
    const targetScope = roomData?.targetScope || (mode === 'floor_plan_render' ? 'single_room' : undefined);
    const usesWholePlanControl = mode === 'floor_plan_render' && targetScope === 'whole_floor_plan';
    const usesReferenceFloorPlanControl = mode === 'reference_recreate' && Boolean(generation.input.controlImage);
    if (mode !== 'floor_plan_render' && !usesReferenceFloorPlanControl && !generation.input.spaceImage) {
      throw new Error('任务缺少空间图片');
    }
    if (usesWholePlanControl && !generation.input.controlImage) {
      throw new Error('完整户型任务缺少量房控制图');
    }
    if (usesWholePlanControl && roomData
      && roomData.navigationRenderVersion !== MINI_AI_WHOLE_PLAN_RENDER_VERSION) {
      roomData.navigationRenderVersion = MINI_AI_WHOLE_PLAN_RENDER_VERSION;
      generation.markModified('input.roomData');
    }

    const referenceImageUrl = generation.input.referenceImage
      ? await resolveAiProviderImageInput(generation.input.referenceImage, context.enterpriseId)
      : undefined;
    const controlImageUrl = generation.input.controlImage
      ? await resolveAiProviderImageInput(generation.input.controlImage, context.enterpriseId)
      : undefined;
    const promptResult = await buildMiniAiRenderPrompt({
      enterpriseId: String(context.enterpriseId), generationId: String(generation._id),
      mode, referenceImageUrl,
      styleName: stylePreset?.name,
      stylePrompt: usesWholePlanControl
        ? stylePreset?.promptTemplate
        : stylePreset?.description,
      roomSummary: mode === 'floor_plan_render' || usesReferenceFloorPlanControl || targetScope === 'single_room'
        ? roomData?.summary || ''
        : '',
      targetScope,
      usesFloorPlanControl: usesReferenceFloorPlanControl,
    });
    generation.output.promptUsed = promptResult.prompt;
    generation.input.referenceAnalysis = promptResult.referenceAnalysis;
    await generation.save();
    const logicalModelKey = (generation.logicalModelKey || config.logicalModelKey) as 'image.generate.standard' | 'image.edit.standard';
    const sourceImages = mode === 'reference_recreate'
      ? selectReferenceRecreateImageInputs({
          controlImage: usesReferenceFloorPlanControl ? generation.input.controlImage : undefined,
          referenceImage: generation.input.referenceImage,
          spaceImage: generation.input.spaceImage,
        })
      : controlImageUrl
        ? [controlImageUrl]
        : generation.input.spaceImage
          ? [generation.input.spaceImage]
          : undefined;
    const completed = await executeGenerationImage(generation, {
      logicalModelKey, prompt: promptResult.prompt,
      negativePrompt: usesWholePlanControl
        ? stylePreset?.negativePrompt
        : mode === 'reference_recreate'
          ? 'changed wall geometry, moved door, moved window, invented opening, missing opening, changed crop, changed framing, changed camera position, changed focal length, top-down floor plan, diagram, warped walls, text, watermark, low quality'
          : 'changed architecture, changed window position, changed door position, warped walls, distorted perspective, duplicate furniture, floating objects, top-down floor plan, text, watermark, low quality',
      images: sourceImages,
      size: generation.input.outputSize || '1024x1024',
      aspectRatio: generation.input.outputAspectRatio || '1:1',
      quality: 'high', user: String(context.operatorId),
    });
    return syncMiniAiWorkflow(completed, context);
  } catch (error) {
    if (generation.status === 'processing' && generation.externalTask?.status === 'unknown') return generation;
    generation.status = 'failed'; generation.errorCode = taskErrorCode(error);
    generation.errorMessage = error instanceof Error ? error.message : 'AI 生成失败';
    await releaseGenerationCredits(generation, generation.errorMessage).catch((releaseError) => console.error('[Mini AI] release failed', releaseError));
    await generation.save();
    throw error;
  }
}

export async function retryMiniAiTask(generation: IAiGeneration, context: MiniAiContext) {
  if (generation.channel !== 'miniprogram' || generation.status !== 'failed') throw new Error('只有失败的小程序 AI 任务可以重试');
  if (generation.deletedAt) throw new Error('已删除的任务不能重试');
  if (generation.billing?.status === 'held') await releaseGenerationCredits(generation, '重试前释放上一轮冻结点数');
  const cycle = Number(generation.billing?.cycle ?? generation.retryCount ?? 0) + 1;
  generation.retryCount = cycle; generation.status = 'created'; generation.errorCode = undefined; generation.errorMessage = undefined;
  generation.currentAttemptId = undefined; generation.externalTask = undefined;
  generation.billing = { cycle, status: 'unbilled' };
  await generation.save();
  await ensureGenerationCreditHold(generation);
  return executeMiniAiTask(generation, context);
}

function assetUrlFromImage(image: string | undefined, request: Request, enterpriseId: string) {
  if (!image) return undefined;
  const assetId = getAssetIdFromImageUrl(image);
  if (assetId) return getSignedMiniAiAssetUrl({ request, assetId, enterpriseId });
  return new URL(image, getMiniAiPublicRequestUrl(request)).toString();
}

export function serializeMiniAiTask(
  generation: IAiGeneration,
  request: Request,
  context?: { workflowTitle?: string; leadName?: string }
) {
  const enterpriseId = String(generation.enterpriseId);
  const roomData = generation.input?.roomData as {
    roomId?: string;
    summary?: string;
    targetScope?: MiniAiTargetScope;
    targetLabel?: string;
  } | undefined;
  const targetScope = roomData?.targetScope;
  const hasExactTargetContext = Boolean(
    generation.floorPlanId
      && (targetScope === 'whole_floor_plan'
        || (targetScope === 'single_room' && roomData?.roomId))
  );
  const targetLabel = roomData?.targetLabel
    || (targetScope === 'whole_floor_plan'
      ? '完整户型'
      : targetScope === 'single_room' && roomData?.roomId ? '单房间' : roomData?.summary ? '旧任务' : undefined);
  return {
    id: String(generation._id), mode: generation.input?.mode || generation.type, status: generation.status,
    progress: generation.status === 'succeeded' || generation.status === 'failed' ? 100 : generation.status === 'processing' ? 65 : 10,
    styleKey: generation.input?.style,
    spaceAssetId: getAssetIdFromImageUrl(generation.input?.spaceImage), referenceAssetId: getAssetIdFromImageUrl(generation.input?.referenceImage),
    spaceImageUrl: assetUrlFromImage(generation.input?.spaceImage, request, enterpriseId), referenceImageUrl: assetUrlFromImage(generation.input?.referenceImage, request, enterpriseId), controlImageUrl: assetUrlFromImage(generation.input?.controlImage, request, enterpriseId), resultImageUrl: assetUrlFromImage(generation.output?.imageUrl, request, enterpriseId),
    resultAssetId: getAssetIdFromImageUrl(generation.output?.imageUrl),
    errorCode: generation.errorCode, error: generation.errorMessage, retryCount: Number(generation.retryCount || 0),
    credits: Number(generation.billing?.price || 0), billingStatus: generation.billing?.status,
    provider: generation.provider, model: generation.remoteModel, externalStatus: generation.externalTask?.status,
    outputAspectRatio: generation.input?.outputAspectRatio,
    outputSize: generation.input?.outputSize,
    workflowId: generation.workflowId ? String(generation.workflowId) : undefined,
    workflowTitle: context?.workflowTitle,
    leadName: context?.leadName,
    syncedToWorkflow: Boolean(generation.workflowId),
    isSelectedBaseline: Boolean(generation.isSelectedBaseline),
    stageKey: generation.stageKey, nextStageKey: generation.nextRecommendedStage,
    floorPlanId: generation.floorPlanId ? String(generation.floorPlanId) : undefined,
    leadId: generation.leadId ? String(generation.leadId) : undefined,
    roomId: roomData?.roomId,
    targetScope,
    targetLabel,
    hasExactTargetContext,
    createdAt: generation.createdAt, updatedAt: generation.updatedAt,
  };
}
