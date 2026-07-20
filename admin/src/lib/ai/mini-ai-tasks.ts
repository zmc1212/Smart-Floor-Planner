import mongoose from 'mongoose';
import { AiGeneration, type IAiGeneration } from '@/models/AiGeneration';
import { MediaAsset } from '@/models/MediaAsset';
import { FloorPlan } from '@/models/FloorPlan';
import { AiWorkflow } from '@/models/AiWorkflow';
import Lead from '@/models/Lead';
import { adaptSurveyGraphToRooms, isFormalSurveyLayout } from '@/lib/survey-graph';
import {
  getAssetIdFromImageUrl,
  getMediaAssetImageUrl,
  readMediaAssetBuffer,
  resolveAiProviderImageInput,
  storeMediaBuffer,
} from '@/lib/ai/media-assets';
import { ensureDefaultAiStylePresets, getAiStylePresetByKey } from '@/lib/ai/presets';
import { buildMiniAiRenderPrompt, type MiniAiRenderMode } from '@/lib/ai/mini-ai-provider';
import { ensureGenerationCreditHold, executeGenerationImage, releaseGenerationCredits } from '@/lib/ai/execution-service';
import { getAiCreditPrice } from '@/lib/ai/credits';
import { getMiniAiPublicRequestUrl, getSignedMiniAiAssetUrl } from '@/lib/ai/mini-ai-assets';
import type { MiniAiContext } from '@/lib/ai/mini-ai-auth';
import type { AiActionKey, AiLogicalModelKey } from '@/lib/ai/provider-types';
import type { AiWorkflowStageKey } from '@/lib/ai/workflow-stages';
import { syncSuccessfulGenerationToWorkflow } from '@/lib/ai/workflow-baseline';

export interface CreateMiniAiTaskInput {
  mode: MiniAiRenderMode;
  spaceAssetId?: string;
  referenceAssetId?: string;
  styleKey?: string;
  floorPlanId?: string;
  leadId?: string;
  roomId?: string;
  workflowId?: string;
  createNewWorkflow?: boolean;
}

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
  return MediaAsset.findOne({ _id: assetId, enterpriseId, ownerType: { $in: ['manual_upload', 'ai_generation_input', 'ai_generation_output'] } });
}

async function cloneGenerationOutputAsInput(asset: Awaited<ReturnType<typeof findOwnedAsset>>, enterpriseId: mongoose.Types.ObjectId) {
  if (!asset || asset.ownerType !== 'ai_generation_output') return asset;
  const buffer = await readMediaAssetBuffer(asset);
  const cloned = await storeMediaBuffer({
    enterpriseId,
    ownerType: 'ai_generation_input',
    mimeType: asset.mimeType,
    buffer,
    originalUrl: getMediaAssetImageUrl(String(asset._id)),
  });
  return cloned.asset;
}

async function deriveRoomSummary(input: CreateMiniAiTaskInput, enterpriseId: mongoose.Types.ObjectId) {
  if (!input.floorPlanId || !mongoose.Types.ObjectId.isValid(input.floorPlanId)) return '';
  const plan = await FloorPlan.findOne({ _id: input.floorPlanId, enterpriseId }).select('layoutData').lean();
  if (!plan || !isFormalSurveyLayout(plan.layoutData)) return '';
  const rooms = adaptSurveyGraphToRooms(plan.layoutData);
  const room = rooms.find((item) => item.id === input.roomId) || rooms[0];
  if (!room) return '';
  return `Measured room context: ${room.name}, approximately ${(room.width / 10).toFixed(2)}m by ${(room.height / 10).toFixed(2)}m, with ${room.openings.length} measured openings.`;
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
    const owner = await Lead.findOne({ enterpriseId: context.enterpriseId, floorPlanIds: input.floorPlanId }).select('_id').lean();
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
  const config = MODE_CONFIG[input.mode];
  const [rawSpaceAsset, rawReferenceAsset, price, roomSummary] = await Promise.all([
    input.spaceAssetId ? findOwnedAsset(input.spaceAssetId, context.enterpriseId) : Promise.resolve(null),
    input.referenceAssetId ? findOwnedAsset(input.referenceAssetId, context.enterpriseId) : Promise.resolve(null),
    getAiCreditPrice(config.actionKey),
    deriveRoomSummary(input, context.enterpriseId),
  ]);
  if (input.mode !== 'floor_plan_render' && !rawSpaceAsset) throw new Error('空间图片不存在或无权访问');
  if (input.mode === 'floor_plan_render' && !roomSummary) throw new Error('请选择包含正式闭合房间的户型');
  if (input.mode === 'reference_recreate' && !rawReferenceAsset) throw new Error('请上传有效的参考图片');
  if (input.mode !== 'reference_recreate' && !input.styleKey) throw new Error('请选择目标风格');

  const [spaceAsset, referenceAsset] = await Promise.all([
    cloneGenerationOutputAsInput(rawSpaceAsset, context.enterpriseId),
    cloneGenerationOutputAsInput(rawReferenceAsset, context.enterpriseId),
  ]);

  const spaceImage = spaceAsset ? getMediaAssetImageUrl(String(spaceAsset._id)) : undefined;
  const workflow = await resolveWorkflow(input, context, spaceImage);

  if (workflow) {
    const existingTask = await AiGeneration.findOne({
      workflowId: workflow._id,
      stageKey: config.stageKey,
      status: { $in: ['created', 'pending', 'processing'] },
      deletedAt: { $exists: false },
    }).sort({ createdAt: -1 });
    if (existingTask) {
      throw Object.assign(new Error('该方案的当前阶段正在生成，请勿重复提交'), {
        status: 409,
        code: 'ACTIVE_GENERATION_EXISTS',
        existingTaskId: String(existingTask._id),
      });
    }
  }

  const generation = await AiGeneration.create({
    enterpriseId: context.enterpriseId,
    operatorId: context.operatorId,
    floorPlanId: input.floorPlanId || undefined,
    leadId: workflow?.leadId || input.leadId || undefined,
    workflowId: workflow?._id,
    type: config.type,
    channel: 'miniprogram',
    stageKey: config.stageKey,
    sourceAssetRole: input.mode === 'floor_plan_render' ? 'floor_plan' : 'rough_sketch',
    nextRecommendedStage: config.nextStageKey,
    status: 'created',
    actionKey: config.actionKey,
    capability: config.logicalModelKey === 'image.generate.standard' ? 'image.generate' : 'image.edit',
    logicalModelKey: config.logicalModelKey,
    retryCount: 0,
    input: {
      style: input.styleKey || 'reference', mode: input.mode,
      roomData: roomSummary ? { summary: roomSummary, roomId: input.roomId } : undefined,
      spaceImage,
      referenceImage: referenceAsset ? getMediaAssetImageUrl(String(referenceAsset._id)) : undefined,
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
    if (mode !== 'floor_plan_render' && !generation.input.spaceImage) throw new Error('任务缺少空间图片');

    const referenceImageUrl = generation.input.referenceImage
      ? await resolveAiProviderImageInput(generation.input.referenceImage, context.enterpriseId)
      : undefined;
    const promptResult = await buildMiniAiRenderPrompt({
      enterpriseId: String(context.enterpriseId), generationId: String(generation._id),
      mode, referenceImageUrl,
      styleName: stylePreset?.name, stylePrompt: stylePreset?.promptTemplate,
      roomSummary: generation.input.roomData && typeof generation.input.roomData === 'object' && 'summary' in generation.input.roomData
        ? String((generation.input.roomData as { summary?: string }).summary || '') : '',
    });
    generation.output.promptUsed = promptResult.prompt;
    generation.input.referenceAnalysis = promptResult.referenceAnalysis;
    await generation.save();
    const completed = await executeGenerationImage(generation, {
      logicalModelKey: config.logicalModelKey as 'image.generate.standard' | 'image.edit.standard', prompt: promptResult.prompt,
      negativePrompt: stylePreset?.negativePrompt || 'changed architecture, changed window position, changed door position, warped walls, distorted perspective, duplicate furniture, floating objects, text, watermark, low quality',
      images: generation.input.spaceImage ? [generation.input.spaceImage] : undefined,
      size: '1024x1024', quality: 'high', user: String(context.operatorId),
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
  generation.billing = { cycle, actionKey: generation.billing?.actionKey, price: generation.billing?.price, priceSnapshot: generation.billing?.priceSnapshot, status: 'unbilled' };
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
  const roomData = generation.input?.roomData as { roomId?: string } | undefined;
  return {
    id: String(generation._id), mode: generation.input?.mode || generation.type, status: generation.status,
    progress: generation.status === 'succeeded' || generation.status === 'failed' ? 100 : generation.status === 'processing' ? 65 : 10,
    styleKey: generation.input?.style,
    spaceAssetId: getAssetIdFromImageUrl(generation.input?.spaceImage), referenceAssetId: getAssetIdFromImageUrl(generation.input?.referenceImage),
    spaceImageUrl: assetUrlFromImage(generation.input?.spaceImage, request, enterpriseId), referenceImageUrl: assetUrlFromImage(generation.input?.referenceImage, request, enterpriseId), resultImageUrl: assetUrlFromImage(generation.output?.imageUrl, request, enterpriseId),
    resultAssetId: getAssetIdFromImageUrl(generation.output?.imageUrl),
    errorCode: generation.errorCode, error: generation.errorMessage, retryCount: Number(generation.retryCount || 0),
    credits: Number(generation.billing?.price || 0), billingStatus: generation.billing?.status,
    provider: generation.provider, model: generation.remoteModel, externalStatus: generation.externalTask?.status,
    workflowId: generation.workflowId ? String(generation.workflowId) : undefined,
    workflowTitle: context?.workflowTitle,
    leadName: context?.leadName,
    syncedToWorkflow: Boolean(generation.workflowId),
    isSelectedBaseline: Boolean(generation.isSelectedBaseline),
    stageKey: generation.stageKey, nextStageKey: generation.nextRecommendedStage,
    floorPlanId: generation.floorPlanId ? String(generation.floorPlanId) : undefined,
    leadId: generation.leadId ? String(generation.leadId) : undefined,
    roomId: roomData?.roomId,
    createdAt: generation.createdAt, updatedAt: generation.updatedAt,
  };
}
