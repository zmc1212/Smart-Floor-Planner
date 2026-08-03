import { AiCreationBatch, type IAiCreationBatch } from '@/models/AiCreationBatch';
import { AiCreationModelProfile, type IAiCreationModelProfile } from '@/models/AiCreationModelProfile';
import { AiCreationTask, type IAiCreationTask } from '@/models/AiCreationTask';
import { AiGeneration, type IAiGeneration } from '@/models/AiGeneration';
import { AiPromptSourceModel } from '@/models/AiPromptSourceModel';
import { MediaAsset } from '@/models/MediaAsset';
import { ensureAiCreditAccount, serializeAiCreditAccount, toSafeCreditAmount } from '@/lib/ai/credits';
import { executeGenerationImage, reconcileAiGeneration, releaseGenerationCredits } from '@/lib/ai/execution-service';
import { assertEnterpriseAiActionAllowed } from '@/lib/ai/enterprise-policy';
import { getImageModelPrice, listExecutableImageModelProfiles } from '@/lib/ai/image-model-catalog';
import {
  getGrsAspectRatiosForTier,
  resolveGrsImageParameters,
  type GrsResolutionTier,
} from '@/lib/ai/grs-image-models';
import { getMediaAssetImageUrl } from '@/lib/ai/media-assets';
import { getActivePromptLibraryRevision } from '@/lib/ai/prompt-library-import';
import { getActivePromptTemplate } from '@/lib/ai/prompt-library-query';

type ParameterSnapshot = {
  aspectRatio: string;
  resolutionTier: GrsResolutionTier;
  width?: number;
  height?: number;
  size?: string;
  quality?: string;
  templateId?: string;
};

type ModelProfileLike = Pick<
  IAiCreationModelProfile,
  | '_id'
  | 'key'
  | 'name'
  | 'description'
  | 'sourceModelSourceIds'
  | 'sourceType'
  | 'adapterType'
  | 'remoteModel'
  | 'family'
  | 'catalogVersion'
  | 'generateLogicalModelKey'
  | 'editLogicalModelKey'
  | 'supportsReferenceImages'
  | 'maxReferenceImages'
  | 'aspectRatios'
  | 'sizes'
  | 'qualities'
  | 'resolutionTiers'
  | 'supportsCustomSize'
  | 'defaultAspectRatio'
  | 'defaultSize'
  | 'defaultQuality'
  | 'defaultResolutionTier'
  | 'isDefault'
  | 'enabled'
  | 'weight'
>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseParamValues(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function optionValues(parameterSource: unknown) {
  const record = asRecord(parameterSource);
  const params = Array.isArray(record.modelParams) ? record.modelParams : [];
  const result = new Map<string, string[]>();
  for (const paramValue of params) {
    const param = asRecord(paramValue);
    if (param.isEnable === false) continue;
    const field = String(param.paramField || '').trim();
    if (!field) continue;
    const values = parseParamValues(param.paramValues)
      .map((option) => String(asRecord(option).value || '').trim())
      .filter(Boolean);
    result.set(field, values);
  }
  return result;
}

function ratioFromDimensions(value: string) {
  const match = value.match(/^(\d+)x(\d+)$/i);
  if (!match) return undefined;
  let width = Number(match[1]);
  let height = Number(match[2]);
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const divisor = gcd(width, height);
  width /= divisor;
  height /= divisor;
  return `${width}:${height}`;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export async function ensureDefaultAiCreationModelProfiles() {
  const revision = await getActivePromptLibraryRevision();
  const profiles = await listExecutableImageModelProfiles();
  if (!revision) return profiles;

  const sourceModels = await AiPromptSourceModel.find({ importRevision: revision._id, enabled: true });
  const profileByRemoteModel = new Map(profiles.map((profile) => [profile.remoteModel, profile]));
  const aliases = new Map([
    ['gpt-image-2', 'gpt-image-2'],
    ['nano banana 2', 'nano-banana-2'],
    ['nano-banana-2', 'nano-banana-2'],
    ['nano banana pro', 'nano-banana-pro'],
    ['nano-banana-pro', 'nano-banana-pro'],
  ]);
  for (const sourceModel of sourceModels) {
    const payload = asRecord(sourceModel.sourcePayload);
    const candidates = [sourceModel.modelCode, sourceModel.name, payload.modelName]
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean);
    const remoteModel = candidates.map((candidate) => aliases.get(candidate)).find(Boolean);
    const profile = remoteModel ? profileByRemoteModel.get(remoteModel) : undefined;
    if (profile && String(sourceModel.localModelProfileId || '') !== String(profile._id)) {
      sourceModel.localModelProfileId = profile._id;
      await sourceModel.save();
    }
  }
  return profiles;
}

export function serializeCreationModelProfile(profile: ModelProfileLike) {
  const aspectRatiosByResolutionTier = profile.remoteModel
    ? Object.fromEntries((profile.resolutionTiers || []).map((tier) => [
        tier,
        getGrsAspectRatiosForTier(profile.remoteModel || '', tier),
      ]))
    : {};
  return {
    id: String(profile._id),
    key: profile.key,
    name: profile.name,
    description: profile.description || '',
    sourceModelSourceIds: profile.sourceModelSourceIds || [],
    sourceType: profile.sourceType,
    adapterType: profile.adapterType,
    remoteModel: profile.remoteModel,
    family: profile.family,
    catalogVersion: profile.catalogVersion,
    supportsReferenceImages: Boolean(profile.supportsReferenceImages),
    maxReferenceImages: Number(profile.maxReferenceImages || 0),
    aspectRatios: profile.aspectRatios || [],
    aspectRatiosByResolutionTier,
    sizes: profile.sizes || [],
    qualities: profile.qualities || [],
    resolutionTiers: profile.resolutionTiers || [],
    supportsCustomSize: Boolean(profile.supportsCustomSize),
    defaults: {
      aspectRatio: profile.defaultAspectRatio,
      size: profile.defaultSize,
      quality: profile.defaultQuality,
      resolutionTier: profile.defaultResolutionTier,
    },
    isDefault: Boolean(profile.isDefault),
    enabled: Boolean(profile.enabled),
    weight: Number(profile.weight || 0),
  };
}

function intersect(preferred: string[], constraint: string[]) {
  if (!constraint.length) return preferred;
  const allowed = new Set(constraint);
  return preferred.filter((item) => allowed.has(item));
}

export function resolveCreationParameters(
  profile: ModelProfileLike,
  requested: Partial<ParameterSnapshot>,
  templateParameters?: unknown
): ParameterSnapshot {
  const templateOptions = optionValues(templateParameters);
  const templateRatios = unique([
    ...(templateOptions.get('aspectRatio') || []).filter((value) => value !== 'auto'),
    ...(templateOptions.get('size') || []).map(ratioFromDimensions).filter((value): value is string => Boolean(value)),
  ]);
  const templateSizes = unique([
    ...(templateOptions.get('size') || []).filter((value) => value !== 'auto'),
    ...(templateOptions.get('imageSize') || []),
  ]).map((value) => value.toUpperCase());
  const profileRatios = profile.aspectRatios || [];
  const legacyTiers = unique([
    ...(profile.sizes || []),
    ...(profile.qualities || []).map((value) => value.toUpperCase()),
  ]).filter((value) => ['1K', '2K', '4K', 'CUSTOM'].includes(value));
  const profileResolutionTiers = profile.resolutionTiers?.length
    ? profile.resolutionTiers
    : legacyTiers.length
      ? legacyTiers
      : ['1K'];
  const ratios = intersect(profileRatios, templateRatios);
  const resolutionTiers = intersect(profileResolutionTiers, templateSizes);
  const allowedRatios = ratios.length ? ratios : profileRatios;
  const allowedResolutionTiers = resolutionTiers.length ? resolutionTiers : profileResolutionTiers;
  const pick = (value: unknown, allowed: string[], fallback: string) => {
    const candidate = String(value || '');
    return allowed.includes(candidate) ? candidate : allowed.includes(fallback) ? fallback : allowed[0];
  };
  const aspectRatio = pick(requested.aspectRatio, allowedRatios, profile.defaultAspectRatio || '1:1');
  const resolutionTier = pick(
    requested.resolutionTier || requested.size || requested.quality?.toUpperCase(),
    allowedResolutionTiers,
    profile.defaultResolutionTier || profile.defaultSize || profile.defaultQuality?.toUpperCase() || '1K'
  ) as GrsResolutionTier;
  if (profile.remoteModel) {
    resolveGrsImageParameters({
      model: profile.remoteModel,
      aspectRatio,
      resolutionTier,
      width: requested.width,
      height: requested.height,
      legacySize: requested.size,
      legacyQuality: requested.quality,
    });
  }
  return {
    aspectRatio,
    resolutionTier,
    width: resolutionTier === 'CUSTOM' ? Number(requested.width) : undefined,
    height: resolutionTier === 'CUSTOM' ? Number(requested.height) : undefined,
    templateId: requested.templateId ? String(requested.templateId) : undefined,
  };
}

export function deriveCreationBatchStatus(statuses: IAiGeneration['status'][]): IAiCreationBatch['status'] {
  if (!statuses.length) return 'pending';
  const succeeded = statuses.filter((status) => status === 'succeeded').length;
  const failed = statuses.filter((status) => ['failed', 'cancelled'].includes(status)).length;
  if (succeeded === statuses.length) return 'succeeded';
  if (failed === statuses.length) return 'failed';
  if (succeeded > 0 && succeeded + failed === statuses.length) return 'partial';
  return 'processing';
}

export async function syncCreationBatchStatus(batch: IAiCreationBatch) {
  const generations = await AiGeneration.find({ _id: { $in: batch.generationIds } });
  batch.status = deriveCreationBatchStatus(generations.map((item) => item.status));
  await batch.save();
  return generations;
}

function serializeGeneration(generation: IAiGeneration) {
  return {
    id: String(generation._id),
    status: generation.status,
    imageUrl: generation.output?.imageUrl ? `/api/ai/generations/${String(generation._id)}/image` : undefined,
    error: generation.errorMessage,
    provider: generation.provider,
    model: generation.remoteModel,
    workflowId: generation.workflowId ? String(generation.workflowId) : undefined,
    createdAt: generation.createdAt,
    updatedAt: generation.updatedAt,
  };
}

export async function serializeCreationTask(task: IAiCreationTask) {
  const batches = await AiCreationBatch.find({ taskId: task._id }).sort({ sequence: -1 }).lean();
  const generationIds = batches.flatMap((batch) => batch.generationIds || []);
  const generations = generationIds.length
    ? await AiGeneration.find({ _id: { $in: generationIds } }).sort({ createdAt: -1 })
    : [];
  const generationById = new Map(generations.map((item) => [String(item._id), item]));
  return {
    id: String(task._id),
    title: task.title,
    prompt: task.prompt,
    referenceAssetIds: task.referenceAssetIds.map(String),
    modelProfileId: String(task.modelProfileId),
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    batches: batches.map((batch) => ({
      id: String(batch._id),
      sequence: batch.sequence,
      prompt: batch.prompt,
      negativePrompt: batch.negativePrompt,
      modelProfileId: String(batch.modelProfileId),
      modelProfileSnapshot: batch.modelProfileSnapshot,
      parameterSnapshot: batch.parameterSnapshot,
      requestedCount: batch.requestedCount,
      status: batch.status,
      creditsEstimate: batch.creditsEstimate,
      createdAt: batch.createdAt,
      generations: batch.generationIds.flatMap((id) => {
        const generation = generationById.get(String(id));
        return generation ? [serializeGeneration(generation)] : [];
      }),
    })),
  };
}

export async function reconcileCreationTasks(tasks: IAiCreationTask[]) {
  const taskIds = tasks.map((task) => task._id);
  const batches = await AiCreationBatch.find({ taskId: { $in: taskIds }, status: 'processing' }).limit(12);
  const generationIds = batches.flatMap((batch) => batch.generationIds);
  const pending = await AiGeneration.find({
    _id: { $in: generationIds },
    status: 'processing',
  }).limit(12);
  await Promise.allSettled(pending.map((generation) => reconcileAiGeneration(generation, { force: true })));
  await Promise.all(batches.map((batch) => syncCreationBatchStatus(batch)));
}

export async function createCreationBatch(input: {
  enterpriseId: string;
  operatorId: string;
  taskId: string;
  prompt: string;
  negativePrompt?: string;
  referenceAssetIds?: string[];
  modelProfileId: string;
  parameters?: Partial<ParameterSnapshot>;
  templateId?: string;
  count?: number;
}) {
  const task = await AiCreationTask.findOne({
    _id: input.taskId,
    enterpriseId: input.enterpriseId,
    deletedAt: { $exists: false },
  });
  if (!task) throw new Error('创作任务不存在');
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('请输入提示词');
  if (prompt.length > 12000) throw new Error('提示词不能超过 12000 个字符');
  const count = Math.min(4, Math.max(1, Math.trunc(Number(input.count) || 1)));
  const profile = await AiCreationModelProfile.findOne({
    _id: input.modelProfileId,
    sourceType: 'grs_catalog',
    enabled: true,
  });
  if (profile && (!profile.remoteModel || !profile.adapterType)) throw new Error('所选模型缺少可执行配置');
  if (!profile) throw new Error('所选模型不可用');
  const adapterType = profile.adapterType;
  const remoteModel = profile.remoteModel;
  if (!adapterType || !remoteModel) throw new Error('所选模型缺少可执行配置');
  const referenceIds = unique((input.referenceAssetIds || []).map(String));
  if (referenceIds.length > profile.maxReferenceImages || (referenceIds.length && !profile.supportsReferenceImages)) {
    throw new Error(`当前模型最多支持 ${profile.maxReferenceImages} 张参考图`);
  }
  const assets = referenceIds.length ? await MediaAsset.find({
    _id: { $in: referenceIds },
    enterpriseId: input.enterpriseId,
    deletedAt: { $exists: false },
  }) : [];
  if (assets.length !== referenceIds.length) throw new Error('参考图不存在或无权访问');
  const template = input.templateId
    ? await getActivePromptTemplate(input.templateId)
    : null;
  const templateParameters = template?.parameterTemplate
    ? asRecord(template.parameterTemplate.parameters)
    : undefined;
  const parameters = resolveCreationParameters(profile, {
    ...input.parameters,
    templateId: template?.id,
  }, templateParameters);
  await assertEnterpriseAiActionAllowed(input.enterpriseId, 'image.free_create');
  const price = await getImageModelPrice(profile.key, parameters.resolutionTier);
  const account = await ensureAiCreditAccount(input.enterpriseId);
  // MongoDB batch and generation billing fields remain numeric until this slice moves.
  const unitCredits = toSafeCreditAmount(price.credits);
  const requiredCredits = unitCredits * count;
  const availableCredits = Number(account.balance || 0) - Number(account.frozenBalance || 0);
  if (availableCredits < requiredCredits) throw new Error(`AI 点数不足，本次需要 ${requiredCredits} 点`);
  const sequence = await AiCreationBatch.countDocuments({ taskId: task._id }) + 1;
  const profileSnapshot = serializeCreationModelProfile(profile);
  const batch = await AiCreationBatch.create({
    enterpriseId: input.enterpriseId,
    operatorId: input.operatorId,
    taskId: task._id,
    sequence,
    prompt,
    negativePrompt: input.negativePrompt?.trim(),
    referenceAssetIds: assets.map((asset) => asset._id),
    modelProfileId: profile._id,
    modelProfileSnapshot: profileSnapshot,
    parameterSnapshot: parameters,
    requestedCount: count,
    generationIds: [],
    status: 'pending',
    creditsEstimate: requiredCredits,
  });
  const logicalModelKey = (assets.length
    ? profile.editLogicalModelKey
    : profile.generateLogicalModelKey) as 'image.generate.standard' | 'image.edit.standard' | undefined;
  if (!logicalModelKey) {
    batch.status = 'failed';
    await batch.save();
    throw new Error('当前模型不支持参考图编辑');
  }
  const generations = await AiGeneration.create(Array.from({ length: count }, () => ({
    enterpriseId: input.enterpriseId,
    operatorId: input.operatorId,
    type: 'free_create',
    creationTaskId: task._id,
    creationBatchId: batch._id,
    creationModelProfileId: profile._id,
    actionKey: 'image.free_create',
    capability: assets.length ? 'image.edit' : 'image.generate',
    logicalModelKey,
    status: 'pending',
    input: {
      style: 'free_create',
      customPrompt: prompt,
      outputAspectRatio: parameters.aspectRatio,
      outputSize: parameters.resolutionTier,
      creationParameterSnapshot: {
        ...parameters,
        modelProfileKey: profile.key,
        remoteModel: profile.remoteModel,
      },
    },
    output: {},
    billing: {
      cycle: 0,
      actionKey: 'image.free_create',
      price: unitCredits,
      priceSnapshot: {
        actionKey: 'image.free_create',
        label: price.label,
        credits: unitCredits,
        modelProfileKey: profile.key,
        remoteModel: profile.remoteModel,
        resolutionTier: parameters.resolutionTier,
        capturedAt: new Date(),
      },
      status: 'unbilled',
    },
  })));
  batch.generationIds = generations.map((generation) => generation._id);
  batch.status = 'processing';
  task.prompt = prompt;
  task.referenceAssetIds = assets.map((asset) => asset._id);
  task.modelProfileId = profile._id;
  task.lastBatchId = batch._id;
  await Promise.all([batch.save(), task.save()]);

  const imageUrls = assets.map((asset) => getMediaAssetImageUrl(String(asset._id)));
  await Promise.allSettled(generations.map(async (generation) => {
    try {
      await executeGenerationImage(generation, {
        logicalModelKey,
        prompt,
        negativePrompt: input.negativePrompt?.trim(),
        aspectRatio: parameters.aspectRatio,
        resolutionTier: parameters.resolutionTier,
        width: parameters.width,
        height: parameters.height,
        modelOverride: {
          adapterType,
          remoteModel,
          modelProfileKey: profile.key,
        },
        images: imageUrls.length ? imageUrls : undefined,
        user: input.operatorId,
      });
    } catch (error) {
      if (!['succeeded', 'failed', 'cancelled'].includes(generation.status)) {
        generation.status = 'failed';
        generation.errorMessage = error instanceof Error ? error.message : '生成任务提交失败';
        await releaseGenerationCredits(generation, generation.errorMessage).catch(() => undefined);
        await generation.save();
      }
    }
  }));
  await syncCreationBatchStatus(batch);
  return { task, batch, account: serializeAiCreditAccount(await ensureAiCreditAccount(input.enterpriseId)) };
}
