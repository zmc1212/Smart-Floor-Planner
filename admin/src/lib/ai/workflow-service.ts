import mongoose from 'mongoose';
import { AiGeneration } from '@/models/AiGeneration';
import { AiWorkflow, IAiWorkflow } from '@/models/AiWorkflow';
import Lead from '@/models/Lead';
import { FloorPlan } from '@/models/FloorPlan';
import type { TenantContext } from '@/lib/auth';
import {
  buildPromptFromPreset,
  ensureDefaultAiStylePresets,
  getAiStylePresetByKey,
  getDefaultAiStylePresetByKey,
} from '@/lib/ai/presets';
import type { AiPresetType, DefaultAiStylePreset } from '@/lib/ai/preset-definitions';
import {
  getMediaAssetImageUrl,
  persistImageReference,
  resolveAiProviderImageInput,
  storeMediaBuffer,
  updateMediaAssetOwner,
} from '@/lib/ai/media-assets';
import { ensureGenerationCreditHold, executeAiChat, executeGenerationImage, releaseGenerationCredits } from '@/lib/ai/execution-service';
import {
  getNextWorkflowStage,
  getWorkflowStageDefinition,
  type AiWorkflowSourceAssetRole,
  type AiWorkflowStageKey,
} from '@/lib/ai/workflow-stages';
import {
  canRunStageFromState,
  getAiWorkflowStageAvailabilityFromDocs,
} from '@/lib/ai/workflow-stage-availability';
import { serializeAiGeneration, serializeAiWorkflow } from '@/lib/ai/workflow-utils';
import { syncSuccessfulGenerationToWorkflow } from '@/lib/ai/workflow-baseline';
import { renderMiniAiFloorPlanControlPng } from '@/lib/ai/mini-ai-floorplan';
import {
  assertEligibleWorkflowFloorPlan,
  buildWorkflowFloorPlanContext,
  isEligibleWorkflowFloorPlan,
  resolveWorkflowImageMode,
} from '@/lib/ai/workflow-floorplan';

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

export { getAiWorkflowStageAvailabilityFromDocs } from '@/lib/ai/workflow-stage-availability';

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
  enterpriseId: string;
}) {
  const { preset, stageKey, style, styleReferenceImage, parentGeneration, enterpriseId } = input;
  const negativePrompt = preset?.negativePrompt;

  if (stageKey === 'lighting') {
    let publicImageUrl =
      styleReferenceImage ||
      parentGeneration?.output?.imageUrl ||
      parentGeneration?.input?.styleReferenceImage;

    if (!publicImageUrl) {
      throw new Error('“增强签单”阶段必须提供白天参考效果图以供分析与重绘。');
    }

    publicImageUrl = await resolveAiProviderImageInput(publicImageUrl, enterpriseId);

    const sceneAnalysis = await executeAiChat({
      enterpriseId,
      logicalModelKey: 'vision.reference_analysis',
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
    const sceneAnalysisText = sceneAnalysis.content;

    const compileResult = await executeAiChat({
      enterpriseId,
      logicalModelKey: 'chat.general',
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
    const compileResponse = compileResult.content;

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

    const floorPlan = await FloorPlan.findOne({ _id: sourceFloorPlanId, enterpriseId })
      .select('status layoutData')
      .lean();
    if (!floorPlan) {
      throw new Error('所选户型图不存在或无权访问');
    }
    assertEligibleWorkflowFloorPlan(floorPlan);
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
        ? (lead.floorPlanIds as Array<{ _id: unknown; name?: string; layoutData?: unknown; createdAt?: Date; status?: string }>)
            .filter(isEligibleWorkflowFloorPlan)
            .map((plan) => ({
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
  const activeGeneration = generations.find(
    (generation) =>
      generation.stageKey === input.stageKey &&
      ['created', 'pending', 'processing'].includes(generation.status)
  );
  if (activeGeneration) {
    throw Object.assign(new Error('该步骤已在生成中，请稍候查看结果'), {
      status: 409,
      code: 'ACTIVE_GENERATION_EXISTS',
      generationId: String(activeGeneration._id),
    });
  }
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

  const parentGenerationId = resolveParentGenerationIdFromGenerations(input.stageKey, workflow, generations);
  const resolvedParentGenerationId = parentGenerationId ? String(parentGenerationId) : undefined;
  const parentGeneration = resolvedParentGenerationId ? await AiGeneration.findById(resolvedParentGenerationId) : null;
  const presetType = resolvePresetType('scenario');
  const nextRecommendedStage = preset.nextRecommendedStage || getNextWorkflowStage(input.stageKey);
  const workflowFloorPlan = workflow.sourceFloorPlanId
    ? await FloorPlan.findOne({ _id: workflow.sourceFloorPlanId, enterpriseId })
        .select('status layoutData')
        .lean()
    : null;
  if (workflow.sourceFloorPlanId && !workflowFloorPlan) {
    throw new Error('方案关联的正式户型不存在或无权访问');
  }
  if (workflowFloorPlan) assertEligibleWorkflowFloorPlan(workflowFloorPlan);

  const promptData = await buildPromptForGeneration({
    preset,
    stageKey: input.stageKey,
    style: preset.key,
    styleReferenceImage: input.styleReferenceImage,
    parentGeneration,
    enterpriseId,
  });
  const floorPlanContext = workflowFloorPlan
    ? buildWorkflowFloorPlanContext(workflowFloorPlan.layoutData)
    : '';
  if (floorPlanContext) promptData.prompt = `${promptData.prompt} ${floorPlanContext}`;

  const imageMode = resolveWorkflowImageMode(input.stageKey, preset.image.mode);
  const logicalModelKey = imageMode === 'edit' ? 'image.edit.standard' : 'image.generate.standard';
  const generationId = new mongoose.Types.ObjectId();
  const usesFloorPlanControl = Boolean(workflowFloorPlan) &&
    ['direction', 'base_render', 'perspective_upgrade'].includes(input.stageKey);
  const controlAsset = usesFloorPlanControl && workflowFloorPlan
    ? await storeMediaBuffer({
        enterpriseId,
        ownerType: 'ai_generation_input',
        ownerId: generationId,
        mimeType: 'image/png',
        buffer: await renderMiniAiFloorPlanControlPng(workflowFloorPlan.layoutData),
      })
    : null;
  const controlImage = controlAsset ? getMediaAssetImageUrl(String(controlAsset.asset._id)) : undefined;
  const presetSnapshot = buildPresetSnapshot(preset);
  presetSnapshot.image = { ...presetSnapshot.image, mode: imageMode };

  const generation = new AiGeneration({
    _id: generationId,
    enterpriseId,
    operatorId: context.userId,
    leadId: workflow.leadId,
    workflowId: workflow._id,
    floorPlanId: workflow.sourceFloorPlanId,
    parentGenerationId: resolvedParentGenerationId,
    type: 'scenario',
    channel: 'admin',
    actionKey: 'image.scenario',
    capability: imageMode === 'edit' ? 'image.edit' : 'image.generate',
    logicalModelKey,
    stageKey: input.stageKey,
    sourceAssetRole: controlImage ? 'floor_plan' : preset.sourceAssetRole,
    nextRecommendedStage,
    input: {
      style: preset.key,
      presetSnapshot,
      customPrompt: promptData.prompt,
      styleReferenceImage: promptData.styleReferenceImage,
      controlImage,
      sceneAnalysis: promptData.sceneAnalysis,
    },
    output: {
      promptUsed: promptData.prompt,
    },
    status: 'pending',
  });
  await generation.save();
  await ensureGenerationCreditHold(generation);

  try {
    generation.status = 'processing';
    await generation.save();

    const resolvedImage = controlImage || await resolveSourceImage({
      explicitImage: input.styleReferenceImage,
      generation,
      workflow,
    });

    if (!resolvedImage && imageMode === 'edit') {
      throw new Error('当前步骤缺少来源图片，请先创建方案会话或选择上一步产物');
    }

    const completed = await executeGenerationImage(generation, {
      logicalModelKey,
      prompt: promptData.prompt,
      negativePrompt: promptData.negativePrompt,
      images: imageMode === 'edit' && resolvedImage ? [resolvedImage] : undefined,
      size: preset.image.size || '1024x1024',
      quality: preset.image.quality || 'medium',
      user: String(context.userId),
    });
    if (completed.status !== 'succeeded') {
      return { workflow: serializeAiWorkflow(workflow), generation: serializeAiGeneration(completed), presetType };
    }

    await syncSuccessfulGenerationToWorkflow(generation);

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

    return {
      workflow: serializeAiWorkflow(workflow),
      generation: serializeAiGeneration(generation),
      presetType,
    };
  } catch (error) {
    if (generation.status !== 'processing') generation.status = 'failed';
    generation.errorMessage =
      parseUpstreamStatus(error) === 402
        ? '当前企业 AI 点数不足，请联系平台管理员调整。'
        : error instanceof Error
          ? error.message
          : '生成失败';
    if (generation.status === 'failed') await releaseGenerationCredits(generation, generation.errorMessage || '生成失败').catch(() => undefined);
    await generation.save();
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
