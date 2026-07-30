import mongoose from 'mongoose';
import { AiCreationBatch, type IAiCreationBatch } from '@/models/AiCreationBatch';
import { AiCreationModelProfile, type IAiCreationModelProfile } from '@/models/AiCreationModelProfile';
import { AiCreationTask, type IAiCreationTask } from '@/models/AiCreationTask';
import { AiGeneration, type IAiGeneration } from '@/models/AiGeneration';
import { AiPromptParameterTemplate } from '@/models/AiPromptParameterTemplate';
import { AiPromptSourceModel } from '@/models/AiPromptSourceModel';
import { AiPromptTemplate } from '@/models/AiPromptTemplate';
import { MediaAsset } from '@/models/MediaAsset';
import { ensureAiCreditAccount, getAiCreditPrice, serializeAiCreditAccount } from '@/lib/ai/credits';
import { executeGenerationImage, reconcileAiGeneration, releaseGenerationCredits } from '@/lib/ai/execution-service';
import { assertEnterpriseAiActionAllowed } from '@/lib/ai/enterprise-policy';
import { getMediaAssetImageUrl } from '@/lib/ai/media-assets';
import { getActivePromptLibraryRevision } from '@/lib/ai/prompt-library-import';

const DEFAULT_RATIOS = ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'];
const DEFAULT_SIZES = ['1K', '2K'];
const DEFAULT_QUALITIES = ['auto', 'high', 'medium', 'low'];

type ParameterSnapshot = {
  aspectRatio: string;
  size: string;
  quality: string;
  templateId?: string;
};

type ModelProfileLike = Pick<
  IAiCreationModelProfile,
  | '_id'
  | 'key'
  | 'name'
  | 'description'
  | 'sourceModelSourceIds'
  | 'generateLogicalModelKey'
  | 'editLogicalModelKey'
  | 'supportsReferenceImages'
  | 'maxReferenceImages'
  | 'aspectRatios'
  | 'sizes'
  | 'qualities'
  | 'defaultAspectRatio'
  | 'defaultSize'
  | 'defaultQuality'
  | 'enabled'
  | 'weight'
>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
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

function inferProfileOptions(parameterSources: unknown[]) {
  const ratios: string[] = [];
  const sizes: string[] = [];
  const qualities: string[] = [];
  for (const source of parameterSources) {
    const options = optionValues(source);
    for (const value of options.get('aspectRatio') || []) if (value !== 'auto') ratios.push(value);
    for (const value of options.get('size') || []) {
      if (value === 'auto') continue;
      sizes.push(value);
      const ratio = ratioFromDimensions(value);
      if (ratio) ratios.push(ratio);
    }
    sizes.push(...(options.get('imageSize') || []));
    qualities.push(...(options.get('quality') || []));
  }
  return {
    aspectRatios: unique(ratios).length ? unique(ratios) : DEFAULT_RATIOS,
    sizes: unique(sizes).length ? unique(sizes) : DEFAULT_SIZES,
    qualities: unique(qualities).length ? unique(qualities) : DEFAULT_QUALITIES,
  };
}

export async function ensureDefaultAiCreationModelProfiles() {
  const revision = await getActivePromptLibraryRevision();
  if (!revision) return [];
  const [sourceModels, parameterTemplates] = await Promise.all([
    AiPromptSourceModel.find({ importRevision: revision._id, enabled: true }).sort({ weight: -1, name: 1 }),
    AiPromptParameterTemplate.find({ importRevision: revision._id, enabled: true }).lean(),
  ]);
  const parameterById = new Map(parameterTemplates.map((item) => [item.sourceId, item]));
  const profiles: IAiCreationModelProfile[] = [];

  for (const sourceModel of sourceModels) {
    const payload = asRecord(sourceModel.sourcePayload);
    const modelType = String(payload.modelType || '').toLowerCase();
    if (modelType.includes('chat') || modelType.includes('聊天')) continue;
    const parameterIds = asStringArray(payload.modelParamTemplateIds);
    const parameterSources = parameterIds
      .map((id) => parameterById.get(id)?.parameters)
      .filter(Boolean);
    const options = inferProfileOptions(parameterSources);
    const maxReferenceImages = Math.min(10, Math.max(0, Number(payload.canUploadImageCount) || 0));
    const profile = await AiCreationModelProfile.findOneAndUpdate(
      { key: `roomi-${sourceModel.sourceId}` },
      {
        $set: {
          name: sourceModel.name,
          description: String(payload.modelIntro || payload.channelRemark || '').trim(),
          sourceModelSourceIds: [sourceModel.sourceId],
          generateLogicalModelKey: 'image.generate.standard',
          editLogicalModelKey: maxReferenceImages > 0 ? 'image.edit.standard' : undefined,
          supportsReferenceImages: maxReferenceImages > 0,
          maxReferenceImages,
          ...options,
          defaultAspectRatio: options.aspectRatios.includes('1:1') ? '1:1' : options.aspectRatios[0],
          defaultSize: options.sizes.includes('1K') ? '1K' : options.sizes[0],
          defaultQuality: options.qualities.includes('auto') ? 'auto' : options.qualities[0],
          enabled: true,
          weight: sourceModel.weight,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    if (profile) {
      profiles.push(profile);
      if (String(sourceModel.localModelProfileId || '') !== String(profile._id)) {
        sourceModel.localModelProfileId = profile._id;
        await sourceModel.save();
      }
    }
  }
  return profiles;
}

export function serializeCreationModelProfile(profile: ModelProfileLike) {
  return {
    id: String(profile._id),
    key: profile.key,
    name: profile.name,
    description: profile.description || '',
    sourceModelSourceIds: profile.sourceModelSourceIds || [],
    supportsReferenceImages: Boolean(profile.supportsReferenceImages),
    maxReferenceImages: Number(profile.maxReferenceImages || 0),
    aspectRatios: profile.aspectRatios || [],
    sizes: profile.sizes || [],
    qualities: profile.qualities || [],
    defaults: {
      aspectRatio: profile.defaultAspectRatio,
      size: profile.defaultSize,
      quality: profile.defaultQuality,
    },
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
  ]);
  const ratios = intersect(profile.aspectRatios || [], templateRatios);
  const sizes = intersect(profile.sizes || [], templateSizes);
  const qualities = intersect(profile.qualities || [], templateOptions.get('quality') || []);
  const allowedRatios = ratios.length ? ratios : profile.aspectRatios;
  const allowedSizes = sizes.length ? sizes : profile.sizes;
  const allowedQualities = qualities.length ? qualities : profile.qualities;
  const pick = (value: unknown, allowed: string[], fallback: string) => {
    const candidate = String(value || '');
    return allowed.includes(candidate) ? candidate : allowed.includes(fallback) ? fallback : allowed[0];
  };
  return {
    aspectRatio: pick(requested.aspectRatio, allowedRatios, profile.defaultAspectRatio),
    size: pick(requested.size, allowedSizes, profile.defaultSize),
    quality: pick(requested.quality, allowedQualities, profile.defaultQuality),
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
  const profile = await AiCreationModelProfile.findOne({ _id: input.modelProfileId, enabled: true });
  if (!profile) throw new Error('所选模型不可用');
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
  const template = input.templateId && mongoose.isValidObjectId(input.templateId)
    ? await AiPromptTemplate.findById(input.templateId).populate('parameterTemplateId', 'parameters').lean()
    : null;
  const templateParameters = template && asRecord(template.parameterTemplateId).parameters;
  const parameters = resolveCreationParameters(profile, {
    ...input.parameters,
    templateId: template ? String(template._id) : undefined,
  }, templateParameters);
  await assertEnterpriseAiActionAllowed(input.enterpriseId, 'image.free_create');
  const price = await getAiCreditPrice('image.free_create');
  const account = await ensureAiCreditAccount(input.enterpriseId);
  const requiredCredits = price.credits * count;
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
      outputSize: parameters.size,
      creationParameterSnapshot: parameters,
    },
    output: {},
    billing: { cycle: 0, actionKey: 'image.free_create', status: 'unbilled' },
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
        size: parameters.size,
        quality: parameters.quality,
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
