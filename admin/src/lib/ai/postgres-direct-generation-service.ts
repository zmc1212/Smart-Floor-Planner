import { AiCreationRepository, AiWorkflowRepository, LeadRepository } from '@/db/repositories';
import { parseOptionalPostgresId, parsePostgresId } from '@/db/postgres-dto';
import { withTenantTransaction } from '@/db/transaction';
import { getAiCreditPrice } from '@/lib/ai/credits';
import { assertEnterpriseAiActionAllowed } from '@/lib/ai/enterprise-policy';
import { parseImageDataUri } from '@/lib/ai/media-assets';
import {
  getPostgresAssetIdFromImageUrl,
  storePostgresMediaBuffer,
} from '@/lib/ai/postgres-media-assets';
import {
  resolvePostgresScenarioProviderImage,
  submitPostgresCreationGeneration,
} from '@/lib/ai/postgres-creation-runtime';
import {
  holdPostgresCreationGenerationCredits,
  releasePostgresCreationGenerationCredits,
} from '@/lib/ai/postgres-creation-service';
import {
  buildPromptFromPreset,
  getAiStylePresetByKey,
  getDefaultAiStylePresetByKey,
} from '@/lib/ai/presets';
import type { AiPresetType, DefaultAiStylePreset } from '@/lib/ai/preset-definitions';
import { actionKeyForGenerationType } from '@/lib/ai/provider-types';
import { buildSoftFurnishingPromptFromPreset, type FurnitureSelection } from '@/lib/ai/soft-furnishing';
import type { AiWorkflowSourceAssetRole, AiWorkflowStageKey } from '@/lib/ai/workflow-stages';
import { getNextWorkflowStage } from '@/lib/ai/workflow-stages';
import { executePostgresWorkflowChat } from '@/lib/ai/postgres-workflow-chat';

type DirectGenerationType = 'floor_plan_style' | 'furnishing_render' | 'soft_furnishing_render';

export type PostgresDirectGenerationInput = {
  type: DirectGenerationType;
  style: string;
  roomType?: string;
  roomName?: string;
  width?: number;
  height?: number;
  floorPlanId?: string;
  mode?: string;
  roomData?: unknown;
  furnitureItems?: FurnitureSelection[];
  workflowId?: string;
  stageKey?: AiWorkflowStageKey;
  parentGenerationId?: string;
  sourceAssetRole?: AiWorkflowSourceAssetRole;
  styleReferenceImage?: string;
};

function resolvePresetType(type: DirectGenerationType): AiPresetType {
  return type === 'furnishing_render' || type === 'soft_furnishing_render'
    ? 'furnishing_style'
    : 'floor_plan_style';
}

function buildPresetSnapshot(preset: DefaultAiStylePreset) {
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

async function persistPostgresImageReference(input: {
  enterpriseId: bigint;
  image?: string;
}) {
  const image = input.image?.trim();
  if (!image) return undefined;
  if (getPostgresAssetIdFromImageUrl(image)) return image;

  if (image.startsWith('data:image')) {
    const parsed = parseImageDataUri(image);
    const stored = await storePostgresMediaBuffer({
      enterpriseId: input.enterpriseId,
      ownerType: 'ai_generation_input',
      mimeType: parsed.mimeType,
      buffer: parsed.buffer,
      storageProviderKey: 'local',
    });
    return stored.imageUrl;
  }

  if (!/^https?:\/\//i.test(image)) {
    throw new Error('图片来源必须是数据 URI、HTTP(S) 地址或 PostgreSQL 媒体地址');
  }
  const response = await fetch(image, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to persist image asset (${response.status})`);
  const mimeType = response.headers.get('content-type')?.split(';')[0] || 'image/png';
  if (!mimeType.startsWith('image/')) throw new Error('Remote asset is not an image');
  const stored = await storePostgresMediaBuffer({
    enterpriseId: input.enterpriseId,
    ownerType: 'ai_generation_input',
    mimeType,
    buffer: Buffer.from(await response.arrayBuffer()),
    originalUrl: image,
    storageProviderKey: 'local',
  });
  return stored.imageUrl;
}

function assertDirectGenerationType(type: string): asserts type is DirectGenerationType {
  if (!['floor_plan_style', 'furnishing_render', 'soft_furnishing_render'].includes(type)) {
    throw new Error('Unsupported direct generation type');
  }
}

export async function preparePostgresDirectGeneration(input: {
  enterpriseId: string;
  operatorId: string;
  generation: PostgresDirectGenerationInput;
}) {
  assertDirectGenerationType(input.generation.type);
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const operatorId = parsePostgresId(input.operatorId, 'operatorId');
  const presetType = resolvePresetType(input.generation.type);
  const preset =
    (await getAiStylePresetByKey(presetType, input.generation.style))
    || getDefaultAiStylePresetByKey(presetType, input.generation.style)
    || getDefaultAiStylePresetByKey('floor_plan_style', 'colorful');
  if (!preset) throw new Error('AI 风格预设不存在');

  const actionKey = actionKeyForGenerationType(input.generation.type);
  await assertEnterpriseAiActionAllowed(enterpriseId.toString(), actionKey);
  const price = await getAiCreditPrice(actionKey);
  const resolvedStageKey = input.generation.stageKey || preset.workflowStage;
  const resolvedSourceAssetRole = input.generation.sourceAssetRole || preset.sourceAssetRole;
  const nextRecommendedStage = preset.nextRecommendedStage || getNextWorkflowStage(resolvedStageKey);
  const styleReferenceImage = await persistPostgresImageReference({
    enterpriseId,
    image: input.generation.styleReferenceImage,
  });
  const workflowId = parseOptionalPostgresId(input.generation.workflowId, 'workflowId');
  const parentGenerationId = parseOptionalPostgresId(input.generation.parentGenerationId, 'parentGenerationId');
  const floorPlanId = parseOptionalPostgresId(input.generation.floorPlanId, 'floorPlanId');
  const initialPrompt = input.generation.type === 'soft_furnishing_render'
    ? buildSoftFurnishingPromptFromPreset({
        promptTemplate: preset.promptTemplate,
        furnitureItems: Array.isArray(input.generation.furnitureItems) ? input.generation.furnitureItems : [],
        roomType: input.generation.roomType,
      })
    : buildPromptFromPreset(preset.promptTemplate, input.generation);

  let parentImageUrl: string | undefined;
  const generation = await withTenantTransaction(enterpriseId, async (transaction) => {
    const creations = new AiCreationRepository(transaction);
    let workflow = null;
    if (workflowId) {
      workflow = await new AiWorkflowRepository(transaction).findById(workflowId);
      if (!workflow) throw new Error('方案会话不存在或无权限访问');
      const lead = await new LeadRepository(transaction).findById(workflow.leadId);
      if (!lead) throw new Error('Associated lead not found or inaccessible');
    }
    if (parentGenerationId) {
      const parent = await creations.findGeneration(parentGenerationId);
      if (!parent) throw new Error('上一产物不存在或无权限访问');
      const output = parent.output && typeof parent.output === 'object' ? parent.output : {};
      parentImageUrl = typeof output.imageUrl === 'string' ? output.imageUrl : undefined;
    }

    const created = await creations.createGeneration({
      enterpriseId,
      operatorId,
      leadId: workflow?.leadId,
      workflowId: workflow?.id,
      parentGenerationId,
      floorPlanId,
      type: input.generation.type,
      channel: 'admin',
      actionKey,
      capability: preset.image.mode === 'generation' ? 'image.generate' : 'image.edit',
      logicalModelKey: preset.image.mode === 'generation' ? 'image.generate.standard' : 'image.edit.standard',
      stageKey: resolvedStageKey,
      sourceAssetRole: resolvedSourceAssetRole,
      nextRecommendedStage,
      status: 'pending',
      input: {
        style: input.generation.style,
        roomType: input.generation.roomType,
        roomName: input.generation.roomName,
        width: input.generation.width,
        height: input.generation.height,
        mode: input.generation.mode,
        roomData: input.generation.roomData,
        furnitureItems: input.generation.furnitureItems,
        presetSnapshot: buildPresetSnapshot(preset),
        styleReferenceImage,
        customPrompt: initialPrompt,
        negativePrompt: preset.negativePrompt,
      },
      output: { promptUsed: initialPrompt },
      billing: {
        cycle: 0,
        actionKey,
        price: price.credits,
        priceSnapshot: {
          actionKey,
          label: price.label,
          credits: price.credits,
          capturedAt: new Date().toISOString(),
        },
        status: 'unbilled',
      },
    });
    const styleReferenceAssetId = getPostgresAssetIdFromImageUrl(styleReferenceImage);
    if (styleReferenceAssetId) await creations.updateMediaAsset(styleReferenceAssetId, { ownerId: created.id });
    return created;
  });

  try {
    await holdPostgresCreationGenerationCredits({
      enterpriseId: enterpriseId.toString(),
      generationId: generation.id.toString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 点数不足';
    await withTenantTransaction(enterpriseId, (transaction) =>
      new AiCreationRepository(transaction).updateGeneration(generation.id, {
        status: 'failed',
        errorCode: 'DIRECT_GENERATION_CREDIT_HOLD_ERROR',
        errorMessage: message,
      })
    ).catch(() => undefined);
    throw error;
  }

  let prompt = initialPrompt;
  let negativePrompt = preset.negativePrompt;
  let sceneAnalysis: string | undefined;
  try {
    if (resolvedStageKey === 'lighting') {
      const referenceImage = styleReferenceImage || parentImageUrl;
      if (!referenceImage) {
        const error = new Error('增强签单阶段必须提供白天参考效果图，以供分析与重绘。');
        Object.assign(error, { status: 400 });
        throw error;
      }
      const providerImage = await resolvePostgresScenarioProviderImage(enterpriseId, referenceImage);
      if (!providerImage) throw new Error('增强签单阶段无法读取参考效果图');
      const analysis = await executePostgresWorkflowChat({
        enterpriseId,
        generationId: generation.id,
        logicalModelKey: 'vision.reference_analysis',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: initialPrompt },
            { type: 'image_url', image_url: { url: providerImage } },
          ],
        }],
        temperature: 0.7,
        metadata: { generationType: input.generation.type, stageKey: 'lighting', phase: 'analysis' },
      });
      sceneAnalysis = analysis.content;
      const compile = await executePostgresWorkflowChat({
        enterpriseId,
        generationId: generation.id,
        logicalModelKey: 'chat.general',
        messages: [
          { role: 'system', content: 'You are an expert compiler of visual design boards and interior design prompts.' },
          {
            role: 'user',
            content: `Compile a detailed English image-generation prompt as JSON with keys "prompt" and "negative_prompt".\n\nSpace analysis:\n${sceneAnalysis}\n\nGeneration goal:\n${preset.promptTemplateSecondStage || 'Create a professional interior design presentation board with lighting analysis and a night-scene render.'}`,
          },
        ],
        temperature: 0.7,
        metadata: { generationType: input.generation.type, stageKey: 'lighting', phase: 'compile' },
      });
      const match = compile.content.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          const compiled = JSON.parse(match[0]) as { prompt?: unknown; negative_prompt?: unknown };
          if (typeof compiled.prompt === 'string' && compiled.prompt.trim()) prompt = compiled.prompt.trim();
          if (typeof compiled.negative_prompt === 'string' && compiled.negative_prompt.trim()) {
            negativePrompt = compiled.negative_prompt.trim();
          }
        } catch {
          // Retain the deterministic preset prompt when a provider returns non-JSON text.
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 提示词生成失败';
    await releasePostgresCreationGenerationCredits({
      enterpriseId: enterpriseId.toString(),
      generationId: generation.id.toString(),
      errorCode: 'DIRECT_PROMPT_ERROR',
      errorMessage: message,
    }).catch(() => undefined);
    throw error;
  }

  const prepared = await withTenantTransaction(enterpriseId, async (transaction) => {
    const repository = new AiCreationRepository(transaction);
    const current = await repository.findGenerationForUpdate(generation.id);
    if (!current) return null;
    const currentInput = current.input && typeof current.input === 'object' ? current.input : {};
    const currentOutput = current.output && typeof current.output === 'object' ? current.output : {};
    return repository.updateGeneration(generation.id, {
      status: 'pending',
      input: { ...currentInput, customPrompt: prompt, negativePrompt, ...(sceneAnalysis ? { sceneAnalysis } : {}) },
      output: { ...currentOutput, promptUsed: prompt },
    });
  });
  if (!prepared) throw new Error('创作生成任务不存在');
  return {
    generation: prepared,
    prompt,
    negativePrompt,
    presetType,
    workflowId: workflowId?.toString(),
    leadId: prepared.leadId?.toString(),
    stageKey: resolvedStageKey,
    nextRecommendedStage,
  };
}

export async function renderPostgresDirectGeneration(input: {
  enterpriseId: string;
  generationId: string;
  image?: string;
  prompt?: string;
  negativePrompt?: string;
}) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const generationId = parsePostgresId(input.generationId, 'generationId');
  const current = await withTenantTransaction(enterpriseId, async (transaction) => {
    const repository = new AiCreationRepository(transaction);
    const generation = await repository.findGeneration(generationId);
    if (!generation || generation.deletedAt || !['floor_plan_style', 'furnishing_render', 'soft_furnishing_render'].includes(generation.type)) {
      throw new Error('Generation record not found');
    }
    if (!['pending', 'failed'].includes(generation.status)) {
      throw new Error('Generation is already in progress or completed');
    }
    const parentGeneration = generation.parentGenerationId
      ? await repository.findGeneration(generation.parentGenerationId)
      : null;
    const workflow = generation.workflowId
      ? await new AiWorkflowRepository(transaction).findById(generation.workflowId)
      : null;
    const selectedGeneration = workflow?.selectedGenerationId
      ? await repository.findGeneration(workflow.selectedGenerationId)
      : null;
    const outputImage = (value: unknown) => value && typeof value === 'object'
      ? (value as Record<string, unknown>).imageUrl
      : undefined;
    return {
      generation,
      fallbackSourceImage: [
        outputImage(parentGeneration?.output),
        outputImage(selectedGeneration?.output),
        workflow?.sourceImage,
        generation.input && typeof generation.input === 'object'
          ? (generation.input as Record<string, unknown>).styleReferenceImage
          : undefined,
      ].find((value): value is string => typeof value === 'string' && value.length > 0),
    };
  });

  const sourceImage = input.image || current.fallbackSourceImage;
  if (!sourceImage) throw new Error('当前步骤缺少来源图片，请先选择上一阶段产物');
  const persistedImage = await persistPostgresImageReference({ enterpriseId, image: sourceImage });
  if (!persistedImage) throw new Error('当前步骤缺少来源图片，请先选择上一阶段产物');

  await withTenantTransaction(enterpriseId, async (transaction) => {
    const repository = new AiCreationRepository(transaction);
    const generation = await repository.findGenerationForUpdate(generationId);
    if (!generation || generation.deletedAt || !['pending', 'failed'].includes(generation.status)) {
      throw new Error('Generation is already in progress or completed');
    }
    const existingInput = generation.input && typeof generation.input === 'object' ? generation.input : {};
    const existingOutput = generation.output && typeof generation.output === 'object' ? generation.output : {};
    const existingBilling = generation.billing && typeof generation.billing === 'object' ? generation.billing : {};
    const retrying = generation.status === 'failed';
    const billingCycle = Math.max(0, Number(existingBilling.cycle || generation.retryCount || 0));
    await repository.updateGeneration(generationId, {
      status: 'pending',
      input: {
        ...existingInput,
        sourceImage: persistedImage,
        customPrompt: input.prompt || existingInput.customPrompt,
        negativePrompt: input.negativePrompt || existingInput.negativePrompt,
      },
      output: { ...existingOutput, promptUsed: input.prompt || existingOutput.promptUsed || existingInput.customPrompt },
      errorCode: null,
      errorMessage: null,
      ...(retrying ? {
        currentAttemptId: null,
        externalTask: {},
        providerState: {},
        retryCount: generation.retryCount + 1,
        billing: {
          ...existingBilling,
          cycle: billingCycle + 1,
          status: 'unbilled',
        },
      } : {}),
    });
    const assetId = getPostgresAssetIdFromImageUrl(persistedImage);
    if (assetId) await repository.updateMediaAsset(assetId, { ownerId: generationId });
  });

  await submitPostgresCreationGeneration({
    enterpriseId: enterpriseId.toString(),
    generationId: generationId.toString(),
  });
  const completed = await withTenantTransaction(enterpriseId, (transaction) =>
    new AiCreationRepository(transaction).findGeneration(generationId)
  );
  if (!completed) throw new Error('Generation record not found');
  return completed;
}

export function getPostgresDirectGenerationImageUrl(generation: { id: bigint; output: unknown }) {
  const output = generation.output && typeof generation.output === 'object' ? generation.output as Record<string, unknown> : {};
  return typeof output.imageUrl === 'string' && output.imageUrl
    ? `/api/ai/generations/${generation.id.toString()}/image`
    : undefined;
}
