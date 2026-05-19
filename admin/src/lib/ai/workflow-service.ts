import { AiGeneration } from '@/models/AiGeneration';
import { AiWorkflow, IAiWorkflow } from '@/models/AiWorkflow';
import { EnterpriseAiUsageSnapshot } from '@/models/EnterpriseAiUsageSnapshot';
import Lead from '@/models/Lead';
import type { TenantContext } from '@/lib/auth';
import {
  deriveEnterpriseKeyStatus,
  getEnterprisePollinationsRuntimeConfig,
  markEnterpriseAiSyncError,
  syncEnterprisePollinationsSnapshot,
} from '@/lib/ai/enterprise-ai';
import {
  buildPromptFromPreset,
  ensureDefaultAiStylePresets,
  getAiStylePresetByKey,
  getDefaultAiStylePresetByKey,
} from '@/lib/ai/presets';
import type { AiPresetType, DefaultAiStylePreset } from '@/lib/ai/preset-definitions';
import { editImage, generateChatCompletion, generateImage } from '@/lib/ai/pollinations';
import {
  ensureModelAccessibleImageUrl,
  persistImageReference,
  updateMediaAssetOwner,
} from '@/lib/ai/media-assets';
import {
  ADVANCED_WORKFLOW_TOOLS,
  MAIN_WORKFLOW_STAGES,
  getNextWorkflowStage,
  getWorkflowStageDefinition,
  type AiWorkflowSourceAssetRole,
  type AiWorkflowStageKey,
} from '@/lib/ai/workflow-stages';
import { serializeAiGeneration, serializeAiWorkflow } from '@/lib/ai/workflow-utils';

type WorkflowGenerationDoc = Awaited<ReturnType<typeof AiGeneration.findOne>>;

interface CreateWorkflowInput {
  leadId: string;
  title?: string;
  workflowLabel?: string;
  sourceImage?: string;
  sourceFloorPlanId?: string;
  sourceAssetRole?: AiWorkflowSourceAssetRole;
}

interface RunWorkflowStageInput {
  workflowId: string;
  stageKey: AiWorkflowStageKey;
  presetKey?: string;
  styleReferenceImage?: string;
  confirmed?: boolean;
}

interface SelectBaselineInput {
  workflowId: string;
  generationId: string;
  confirmed?: boolean;
}

function requireEnterprise(context: TenantContext) {
  if (!context.enterpriseId) {
    throw new Error('需要先选择企业上下文');
  }
  return context.enterpriseId;
}

function resolvePresetType(type?: string): AiPresetType {
  if (type === 'scenario') return 'scenario';
  return type === 'furnishing_render' || type === 'soft_furnishing_render'
    ? 'furnishing_style'
    : 'floor_plan_style';
}

function buildPresetSnapshot(preset: DefaultAiStylePreset | NonNullable<Awaited<ReturnType<typeof getAiStylePresetByKey>>>) {
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

function buildDefaultWorkflowTitle(leadName: string, workflowCount: number, workflowLabel?: string) {
  if (workflowLabel?.trim()) {
    return `${leadName} · ${workflowLabel.trim()}`;
  }

  return workflowCount === 0 ? `${leadName} · 首轮方案` : `${leadName} · 方案 ${workflowCount + 1}`;
}

function parseUpstreamStatus(error: unknown) {
  const maybe = error as Error & { status?: number };
  return maybe?.status || 500;
}

async function findWorkflowForEnterprise(workflowId: string, enterpriseId: string) {
  return AiWorkflow.findOne({ _id: workflowId, enterpriseId });
}

async function getWorkflowGenerations(workflowId: string) {
  return AiGeneration.find({ workflowId }).sort({ createdAt: -1 });
}

function getLatestGenerationForStage(
  generations: Array<{ stageKey?: AiWorkflowStageKey; id?: string; _id?: unknown }>,
  stageKey: AiWorkflowStageKey
) {
  return generations.find((generation) => generation.stageKey === stageKey);
}

function resolveParentGenerationIdFromGenerations(
  stageKey: AiWorkflowStageKey | undefined,
  workflow: Pick<IAiWorkflow, 'selectedGenerationId'>,
  generations: Array<{ stageKey?: AiWorkflowStageKey; isSelectedBaseline?: boolean; _id?: unknown }>
) {
  if (!stageKey) return undefined;
  if (stageKey === 'direction' || stageKey === 'premium_board' || stageKey === 'perspective_upgrade') {
    return undefined;
  }

  const selectedBaseline =
    generations.find((generation) => generation.isSelectedBaseline) ||
    (workflow.selectedGenerationId
      ? generations.find((generation) => String(generation._id) === String(workflow.selectedGenerationId))
      : undefined);

  if (stageKey === 'base_render') {
    return getLatestGenerationForStage(generations, 'direction')?._id;
  }

  if (stageKey === 'soft_furnishing') {
    return selectedBaseline?._id || getLatestGenerationForStage(generations, 'base_render')?._id;
  }

  return (
    selectedBaseline?._id ||
    getLatestGenerationForStage(generations, 'soft_furnishing')?._id ||
    getLatestGenerationForStage(generations, 'base_render')?._id
  );
}

function canRunStageFromState(input: {
  stageKey?: AiWorkflowStageKey;
  sourceAssetRole?: AiWorkflowSourceAssetRole;
  workflow: Pick<IAiWorkflow, 'sourceImage' | 'sourceFloorPlanId' | 'selectedGenerationId'>;
  generations: Array<{ stageKey?: AiWorkflowStageKey; isSelectedBaseline?: boolean; _id?: unknown }>;
}) {
  const { stageKey, sourceAssetRole, workflow, generations } = input;

  if (!stageKey) {
    return { available: false, reason: '缺少阶段标识' };
  }

  if (stageKey === 'direction' || stageKey === 'base_render') {
    return workflow.sourceImage || workflow.sourceFloorPlanId
      ? { available: true }
      : { available: false, reason: '需要先提供起点素材或户型图' };
  }

  if (stageKey === 'premium_board') {
    return (workflow.sourceImage || workflow.sourceFloorPlanId) && sourceAssetRole === 'concept_element'
      ? { available: true }
      : { available: false, reason: '高端提案工具需要概念元素图作为起点素材' };
  }

  if (stageKey === 'perspective_upgrade') {
    return workflow.sourceImage || workflow.sourceFloorPlanId
      ? { available: true }
      : { available: false, reason: '彩平转透视需要先提供户型图或彩平素材' };
  }

  const parentGenerationId = resolveParentGenerationIdFromGenerations(stageKey, workflow, generations);
  return parentGenerationId
    ? { available: true, parentGenerationId: String(parentGenerationId) }
    : { available: false, reason: '当前步骤缺少上一阶段产物，请先完成前一阶段或设为当前定稿' };
}

async function resolveSourceImage({
  explicitImage,
  generation,
  workflow,
}: {
  explicitImage?: string;
  generation: {
    parentGenerationId?: unknown;
  };
  workflow: Pick<IAiWorkflow, 'selectedGenerationId' | 'sourceImage'> | null;
}) {
  if (explicitImage) {
    return explicitImage;
  }

  if (generation.parentGenerationId) {
    const parentGeneration = await AiGeneration.findById(String(generation.parentGenerationId));

    if (parentGeneration?.output?.imageUrl) {
      return parentGeneration.output.imageUrl;
    }
  }

  if (workflow?.selectedGenerationId) {
    const selectedGeneration = await AiGeneration.findById(String(workflow.selectedGenerationId));

    if (selectedGeneration?.output?.imageUrl) {
      return selectedGeneration.output.imageUrl;
    }
  }

  if (workflow?.sourceImage) {
    return workflow.sourceImage;
  }

  return undefined;
}

async function buildPromptForGeneration(input: {
  preset: NonNullable<Awaited<ReturnType<typeof getAiStylePresetByKey>>> | DefaultAiStylePreset | undefined;
  stageKey?: AiWorkflowStageKey;
  style: string;
  styleReferenceImage?: string;
  parentGeneration: WorkflowGenerationDoc;
  runtimeApiKey: string;
  enterpriseId: string;
}) {
  const { preset, stageKey, style, styleReferenceImage, parentGeneration, runtimeApiKey, enterpriseId } = input;
  const negativePrompt = preset?.negativePrompt;

  if (stageKey === 'lighting') {
    let publicImageUrl =
      styleReferenceImage ||
      parentGeneration?.output?.imageUrl ||
      parentGeneration?.input?.styleReferenceImage;

    if (!publicImageUrl) {
      throw new Error('“增强签单”阶段必须提供白天参考效果图以供分析与重绘。');
    }

    publicImageUrl = await ensureModelAccessibleImageUrl(publicImageUrl, enterpriseId, runtimeApiKey);

    const sceneAnalysisText = await generateChatCompletion({
      apiKey: runtimeApiKey,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: buildPromptFromPreset(preset?.promptTemplate || '', {}) },
            { type: 'image_url', image_url: { url: publicImageUrl } },
          ],
        },
      ],
      temperature: 0.7,
    });

    const compileResponse = await generateChatCompletion({
      apiKey: runtimeApiKey,
      messages: [
        { role: 'system', content: 'You are an expert compiler of visual design boards and interior design prompts.' },
        {
          role: 'user',
          content: `
Task: Compile a highly detailed, professional English image generation prompt for Stable Diffusion/Flux.

Inputs:
1. Space Design & Analysis:
${sceneAnalysisText}

2. Generation Goal:
${preset?.promptTemplateSecondStage || '直接生成展板图片，把灯光设计分析，灯光清单，跟夜景效果图，罗列出来'}

Output MUST be a JSON object with keys "prompt" and "negative_prompt".
          `.trim(),
        },
      ],
      temperature: 0.7,
    });

    const jsonMatch = compileResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as { prompt?: string; negative_prompt?: string };
        if (parsed.prompt) {
          return {
            prompt: parsed.prompt,
            negativePrompt: parsed.negative_prompt || negativePrompt,
            styleReferenceImage: publicImageUrl,
            sceneAnalysis: sceneAnalysisText,
          };
        }
      } catch {
        // Fall through to deterministic fallback.
      }
    }

    return {
      prompt: `A professional interior design presentation board showing a night scene rendering of a ${style} interior, lighting concept, color temperature analysis, and a structured lighting equipment list. High-end architectural portfolio layout, photorealistic, 8k.`,
      negativePrompt: negativePrompt || 'ugly, blurry, low quality',
      styleReferenceImage: publicImageUrl,
      sceneAnalysis: sceneAnalysisText,
    };
  }

  return {
    prompt: buildPromptFromPreset(preset?.promptTemplate || '', {}),
    negativePrompt,
    styleReferenceImage,
  };
}

function buildLeadFollowUp(stageKey?: string) {
  if (stageKey === 'direction') return '已生成风格方案';
  if (stageKey === 'base_render') return '已生成基准效果图';
  if (stageKey === 'proposal_pack') return '已生成提案板';
  return null;
}

export async function createAiWorkflow(input: CreateWorkflowInput, context: TenantContext) {
  const enterpriseId = requireEnterprise(context);
  const leadId = input.leadId?.trim();
  const sourceImage = input.sourceImage?.trim();
  const sourceFloorPlanId = input.sourceFloorPlanId?.trim();

  if (!leadId) {
    throw new Error('缺少客户线索 ID');
  }

  const lead = await Lead.findOne({ _id: leadId, enterpriseId });
  if (!lead) {
    throw new Error('客户线索不存在或无权访问');
  }

  if (sourceFloorPlanId) {
    const hasFloorPlan = Array.isArray(lead.floorPlanIds)
      ? lead.floorPlanIds.some((item: unknown) => String(item) === sourceFloorPlanId)
      : false;

    if (!hasFloorPlan) {
      throw new Error('所选户型图不属于当前客户线索');
    }
  }

  if (!sourceFloorPlanId && (!sourceImage || !sourceImage.startsWith('data:image'))) {
    throw new Error('请先选择客户素材或上传参考图');
  }

  const workflowCount = await AiWorkflow.countDocuments({ leadId: lead._id, enterpriseId });
  const workflowLabel = input.workflowLabel?.trim();
  const title =
    input.title?.trim() || buildDefaultWorkflowTitle(lead.name || '客户方案', workflowCount, workflowLabel);

  const persistedSourceImage = sourceImage
    ? await persistImageReference({
        enterpriseId,
        ownerType: 'ai_workflow_source',
        image: sourceImage,
      })
    : undefined;

  const workflow = await AiWorkflow.create({
    enterpriseId,
    leadId: lead._id,
    operatorId: context.userId,
    title,
    workflowLabel,
    isPrimary: workflowCount === 0,
    sourceImage: persistedSourceImage,
    sourceFloorPlanId: sourceFloorPlanId || undefined,
    sourceAssetRole: input.sourceAssetRole || (sourceFloorPlanId ? 'floor_plan' : 'rough_sketch'),
    currentStageKey: 'direction',
  });
  await updateMediaAssetOwner(persistedSourceImage, workflow._id);

  await Lead.updateOne(
    { _id: lead._id },
    {
      $push: {
        followUpRecords: {
          content: `已发起 AI 设计方案：${title}`,
          operator: context.username || 'System',
          createdAt: new Date(),
        },
      },
    }
  ).catch(() => undefined);

  return workflow;
}

export async function getAiWorkflowContext(workflowId: string, context: TenantContext) {
  const enterpriseId = requireEnterprise(context);
  const workflow = await findWorkflowForEnterprise(workflowId, enterpriseId);

  if (!workflow) {
    throw new Error('方案会话不存在或无权访问');
  }

  const lead = await Lead.findOne({ _id: workflow.leadId, enterpriseId })
    .populate({ path: 'floorPlanIds', select: 'name layoutData createdAt status', strictPopulate: false })
    .lean();

  if (!lead) {
    throw new Error('客户线索不存在或无权访问');
  }

  const generations = await getWorkflowGenerations(workflowId);
  const availability = getAiWorkflowStageAvailabilityFromDocs(workflow, generations);
  const latestGeneration = generations[0];

  return {
    workflow: {
      ...serializeAiWorkflow(workflow),
      generationCount: generations.length,
      latestGeneration: latestGeneration ? serializeAiGeneration(latestGeneration) : undefined,
      stageState: availability,
    },
    lead: {
      id: String(lead._id),
      name: lead.name,
      phone: lead.phone,
      status: lead.status,
      stylePreference: lead.stylePreference,
      communityName: lead.communityName,
      floorPlans: Array.isArray(lead.floorPlanIds)
        ? (lead.floorPlanIds as Array<{ _id: unknown; name?: string; createdAt?: Date; status?: string }>).map((plan) => ({
            id: String(plan._id),
            name: plan.name,
            createdAt: plan.createdAt,
            status: plan.status,
          }))
        : [],
      followUpCount: Array.isArray(lead.followUpRecords) ? lead.followUpRecords.length : 0,
    },
    generations: generations.map(serializeAiGeneration),
  };
}

export function getAiWorkflowStageAvailabilityFromDocs(
  workflow: Pick<IAiWorkflow, 'currentStageKey' | 'sourceImage' | 'sourceFloorPlanId' | 'selectedGenerationId'>,
  generations: Array<{ stageKey?: AiWorkflowStageKey; isSelectedBaseline?: boolean; _id?: unknown }>
) {
  const stages = [...MAIN_WORKFLOW_STAGES, ...ADVANCED_WORKFLOW_TOOLS];
  const completedStages = Array.from(
    new Set(generations.filter((generation) => generation.stageKey).map((generation) => generation.stageKey as string))
  );

  const stageStates = stages.map((stage) => {
    const result = canRunStageFromState({
      stageKey: stage.key,
      sourceAssetRole: stage.key === 'premium_board' ? 'concept_element' : undefined,
      workflow,
      generations,
    });

    return {
      key: stage.key,
      name: stage.name,
      available: result.available,
      reason: result.reason,
      parentGenerationId: result.parentGenerationId,
    };
  });

  const recommendedStage =
    stageStates.find((stage) => stage.key === workflow.currentStageKey && stage.available) ||
    stageStates.find((stage) => stage.available && !completedStages.includes(stage.key));

  return {
    completedStages,
    availableStages: stageStates.filter((stage) => stage.available).map((stage) => stage.key),
    blockedStages: stageStates.filter((stage) => !stage.available),
    recommendedNextAction: recommendedStage
      ? {
          stageKey: recommendedStage.key,
          stageLabel: recommendedStage.name,
          reason:
            recommendedStage.key === workflow.currentStageKey
              ? '这是当前方案会话推荐推进的阶段'
              : '这是当前素材条件下可执行的下一步',
        }
      : undefined,
  };
}

export async function recommendNextWorkflowAction(workflowId: string, context: TenantContext) {
  const workflowContext = await getAiWorkflowContext(workflowId, context);
  return workflowContext.workflow.stageState.recommendedNextAction || {
    stageKey: undefined,
    stageLabel: undefined,
    reason: '当前方案会话暂无可直接执行的下一步，请先补充来源素材或选择定稿产物。',
  };
}

export async function selectAiGenerationBaseline(input: SelectBaselineInput, context: TenantContext) {
  if (!input.confirmed) {
    return {
      requiresConfirmation: true,
      message: '设为当前定稿会影响后续软装、提案和灯光步骤的来源图，请确认后再执行。',
    };
  }

  const enterpriseId = requireEnterprise(context);
  const workflow = await findWorkflowForEnterprise(input.workflowId, enterpriseId);
  if (!workflow) {
    throw new Error('方案会话不存在或无权访问');
  }

  const generation = await AiGeneration.findOne({
    _id: input.generationId,
    workflowId: workflow._id,
    enterpriseId,
  });

  if (!generation) {
    throw new Error('产物不存在或不属于当前方案会话');
  }

  await AiGeneration.updateMany(
    { workflowId: workflow._id, isSelectedBaseline: true },
    { $set: { isSelectedBaseline: false } }
  );

  generation.isSelectedBaseline = true;
  await generation.save();

  workflow.selectedGenerationId = generation._id;
  workflow.lastGenerationId = generation._id;
  if (generation.nextRecommendedStage) {
    workflow.currentStageKey = generation.nextRecommendedStage;
  }
  await workflow.save();

  return {
    workflow: serializeAiWorkflow(workflow),
    generation: serializeAiGeneration(generation),
  };
}

export async function runAiWorkflowStage(input: RunWorkflowStageInput, context: TenantContext) {
  if (!input.confirmed) {
    const stage = getWorkflowStageDefinition(input.stageKey);
    return {
      requiresConfirmation: true,
      message: `执行“${stage?.name || input.stageKey}”会消耗企业 AI 额度并生成新产物，请确认后再执行。`,
    };
  }

  const enterpriseId = requireEnterprise(context);
  await ensureDefaultAiStylePresets(context.userId);

  const workflow = await findWorkflowForEnterprise(input.workflowId, enterpriseId);
  if (!workflow) {
    throw new Error('方案会话不存在或无权访问');
  }

  const lead = await Lead.findOne({ _id: workflow.leadId, enterpriseId }).select('_id').lean();
  if (!lead) {
    throw new Error('客户线索不存在或无权访问');
  }

  const generations = await getWorkflowGenerations(input.workflowId);
  const preset =
    (input.presetKey
      ? await getAiStylePresetByKey('scenario', input.presetKey)
      : await getAiStylePresetByKey('scenario', `scenario_${stagePresetNumber(input.stageKey)}`)) ||
    getDefaultAiStylePresetByKey('scenario', input.presetKey || `scenario_${stagePresetNumber(input.stageKey)}`);

  if (!preset) {
    throw new Error('当前阶段没有可用的 AI 预设');
  }

  const availability = canRunStageFromState({
    stageKey: input.stageKey,
    sourceAssetRole: preset.sourceAssetRole,
    workflow,
    generations,
  });

  if (!availability.available) {
    throw new Error(availability.reason || '当前阶段暂不可执行');
  }

  const runtimeConfig = await getEnterprisePollinationsRuntimeConfig(enterpriseId);
  const latestSnapshot = await EnterpriseAiUsageSnapshot.findOne({ enterpriseId })
    .select('balance lastSyncedAt keyInfo syncError')
    .lean();
  const keyStatus = deriveEnterpriseKeyStatus({
    aiConfig: { pollinationsKeyRef: runtimeConfig.keyId },
    keyInfo: latestSnapshot?.keyInfo
      ? { id: latestSnapshot.keyInfo.keyId, valid: latestSnapshot.keyInfo.valid }
      : null,
  });

  if ((latestSnapshot?.balance ?? 0) <= 0 && process.env.MOCK_AI !== 'true') {
    const error = new Error('当前企业 Pollinations 余额不足，请联系平台管理员充值。');
    (error as Error & { status?: number }).status = 402;
    throw error;
  }

  const parentGenerationId = resolveParentGenerationIdFromGenerations(input.stageKey, workflow, generations);
  const resolvedParentGenerationId = parentGenerationId ? String(parentGenerationId) : undefined;
  const parentGeneration = resolvedParentGenerationId ? await AiGeneration.findById(resolvedParentGenerationId) : null;
  const presetType = resolvePresetType('scenario');
  const nextRecommendedStage = preset.nextRecommendedStage || getNextWorkflowStage(input.stageKey);
  const promptData = await buildPromptForGeneration({
    preset,
    stageKey: input.stageKey,
    style: preset.key,
    styleReferenceImage: input.styleReferenceImage,
    parentGeneration,
    runtimeApiKey: runtimeConfig.apiKey,
    enterpriseId,
  });

  const generation = new AiGeneration({
    enterpriseId,
    operatorId: context.userId,
    leadId: workflow.leadId,
    workflowId: workflow._id,
    parentGenerationId: resolvedParentGenerationId,
    type: 'scenario',
    stageKey: input.stageKey,
    sourceAssetRole: preset.sourceAssetRole,
    nextRecommendedStage,
    input: {
      style: preset.key,
      presetSnapshot: buildPresetSnapshot(preset),
      customPrompt: promptData.prompt,
      styleReferenceImage: promptData.styleReferenceImage,
      sceneAnalysis: promptData.sceneAnalysis,
    },
    output: {
      promptUsed: promptData.prompt,
    },
    status: 'pending',
    apiKeyId: runtimeConfig.keyId,
    apiKeyName: runtimeConfig.keyName,
    quotaSnapshot: {
      balance: latestSnapshot?.balance ?? 0,
      keyStatus,
      allowedModels: latestSnapshot?.keyInfo?.allowedModels || runtimeConfig.allowedModels,
      lastSyncedAt: latestSnapshot?.lastSyncedAt || undefined,
    },
  });
  await generation.save();

  try {
    generation.status = 'processing';
    await generation.save();

    const resolvedImage = await resolveSourceImage({
      explicitImage: input.styleReferenceImage,
      generation,
      workflow,
    });

    if (!resolvedImage) {
      throw new Error('当前步骤缺少来源图片，请先创建方案会话或选择上一步产物');
    }

    if (process.env.MOCK_AI === 'true') {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      generation.status = 'succeeded';
      generation.output.imageUrl = preset.mockImageUrl || '/colorful.png';
      generation.durationMs = 1000;
      await generation.save();
    } else {
      const referenceImageUrl = await ensureModelAccessibleImageUrl(
        resolvedImage,
        enterpriseId,
        runtimeConfig.apiKey
      );
      const startedAt = Date.now();
      const requestPayload = {
        prompt: promptData.prompt,
        negativePrompt: promptData.negativePrompt,
        referenceImageUrl,
        model: preset.image.model || 'flux',
        size: preset.image.size || '1024x1024',
        quality: preset.image.quality || 'medium',
        user: String(context.userId),
        apiKey: runtimeConfig.apiKey,
      };
      const imageUrl =
        preset.image.mode === 'generation'
          ? await generateImage(requestPayload)
          : await editImage(requestPayload);

      const persistedImageUrl = await persistImageReference({
        enterpriseId,
        ownerType: 'ai_generation_output',
        ownerId: generation._id,
        image: imageUrl,
      });

      generation.status = 'succeeded';
      generation.output.imageUrl = persistedImageUrl;
      generation.durationMs = Date.now() - startedAt;
      generation.remoteModel = requestPayload.model;
      await generation.save();
    }

    workflow.lastGenerationId = generation._id;
    if (generation.stageKey === 'base_render' || generation.stageKey === 'soft_furnishing') {
      await AiGeneration.updateMany(
        { workflowId: workflow._id, isSelectedBaseline: true },
        { $set: { isSelectedBaseline: false } }
      );
      generation.isSelectedBaseline = true;
      await generation.save();
      workflow.selectedGenerationId = generation._id;
    }

    workflow.currentStageKey =
      generation.nextRecommendedStage || getNextWorkflowStage(generation.stageKey) || workflow.currentStageKey;
    await workflow.save();

    const followUpContent = buildLeadFollowUp(generation.stageKey);
    if (followUpContent) {
      await Lead.updateOne(
        { _id: workflow.leadId },
        {
          $push: {
            followUpRecords: {
              content: followUpContent,
              operator: context.username || 'System',
              createdAt: new Date(),
            },
          },
        }
      ).catch(() => undefined);
    }

    await syncEnterprisePollinationsSnapshot(enterpriseId).catch((error) =>
      markEnterpriseAiSyncError(enterpriseId, error)
    );

    return {
      workflow: serializeAiWorkflow(workflow),
      generation: serializeAiGeneration(generation),
      presetType,
    };
  } catch (error) {
    generation.status = 'failed';
    generation.errorMessage =
      parseUpstreamStatus(error) === 402
        ? '当前企业 Pollinations 余额不足，请联系平台管理员充值。'
        : error instanceof Error
          ? error.message
          : '生成失败';
    await generation.save();
    await markEnterpriseAiSyncError(enterpriseId, error).catch(() => undefined);
    throw error;
  }
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
