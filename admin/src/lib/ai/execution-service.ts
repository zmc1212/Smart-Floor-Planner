import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { AiGeneration, type IAiGeneration } from '@/models/AiGeneration';
import { AiProviderAttempt, type IAiProviderAttempt } from '@/models/AiProviderAttempt';
import { persistImageReference, resolveAiProviderImageInput } from '@/lib/ai/media-assets';
import {
  getGrsAiOutputPersistenceEnabled,
  shouldKeepGrsAiOutputUrl,
} from '@/lib/media-storage/config-service';
import { syncSuccessfulGenerationToWorkflow } from '@/lib/ai/workflow-baseline';
import {
  consumeHeldAiCredits,
  getAiCreditPrice,
  holdAiCredits,
  releaseHeldAiCredits,
  toSafeCreditAmount,
} from '@/lib/ai/credits';
import { getImageModelPrice } from '@/lib/ai/image-model-catalog';
import {
  getAiProviderAdapter,
  getProviderRuntimeById,
  listProviderRuntimes,
  listProviderRuntimesByAdapter,
} from '@/lib/ai/provider-registry';
import { assertEnterpriseAiActionAllowed } from '@/lib/ai/enterprise-policy';
import {
  AiProviderError,
  actionKeyForGenerationType,
  capabilityForLogicalModel,
  classifyImageSubmissionError,
  isSafeProviderFallback,
  type AiActionKey,
  type AiChatMessage,
  type AiImageProviderResult,
  type AiImageSubmitInput,
  type AiLogicalModelKey,
  type AiProviderRuntimeConfig,
} from '@/lib/ai/provider-types';

type GenerationDocument = IAiGeneration & { _id: mongoose.Types.ObjectId };

function fingerprint(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function resolveProviderCostEstimate(
  runtime: AiProviderRuntimeConfig,
  logicalModelKey: AiLogicalModelKey,
  remoteModel?: string,
  resolutionTier?: string
) {
  const rules = runtime.costRules || [];
  const rule = rules.find((item) =>
    item.logicalModelKey === logicalModelKey
    && item.remoteModel === remoteModel
    && item.resolutionTier === resolutionTier
  ) || rules.find((item) =>
    item.logicalModelKey === logicalModelKey
    && item.remoteModel === remoteModel
    && !item.resolutionTier
  ) || rules.find((item) =>
    item.logicalModelKey === logicalModelKey
    && !item.remoteModel
    && item.resolutionTier === resolutionTier
  ) || rules.find((item) =>
    item.logicalModelKey === logicalModelKey
    && !item.remoteModel
    && !item.resolutionTier
  );
  return rule ? { currency: rule.currency, micros: rule.estimatedMicros } : undefined;
}

function nextPollDate(delayMs = 5000) {
  return new Date(Date.now() + Math.max(1000, delayMs));
}

async function createAttempt(input: {
  enterpriseId: mongoose.Types.ObjectId | string;
  generationId?: mongoose.Types.ObjectId | string;
  runtime: AiProviderRuntimeConfig;
  logicalModelKey: AiLogicalModelKey;
  remoteModel?: string;
  resolutionTier?: string;
  payload: unknown;
}) {
  const remoteModel = input.remoteModel || input.runtime.modelMappings[input.logicalModelKey];
  if (!remoteModel) throw new Error(`供应商 ${input.runtime.name} 未配置逻辑模型 ${input.logicalModelKey}`);
  return AiProviderAttempt.create({
    enterpriseId: input.enterpriseId,
    generationId: input.generationId,
    providerConfigId: input.runtime.id,
    providerKey: input.runtime.key,
    adapterType: input.runtime.adapterType,
    capability: capabilityForLogicalModel(input.logicalModelKey),
    logicalModelKey: input.logicalModelKey,
    remoteModel,
    resolutionTier: input.resolutionTier,
    status: 'created',
    accepted: false,
    estimatedCost: resolveProviderCostEstimate(input.runtime, input.logicalModelKey, remoteModel, input.resolutionTier),
    requestFingerprint: fingerprint(input.payload),
  });
}

async function markAttemptError(
  attempt: IAiProviderAttempt,
  error: unknown,
  status: 'failed' | 'unknown',
  accepted: boolean,
  startedAt: number
) {
  attempt.status = status;
  attempt.accepted = accepted;
  attempt.errorCode = error instanceof AiProviderError ? error.code : 'PROVIDER_ERROR';
  attempt.errorMessage = error instanceof Error ? error.message : String(error);
  attempt.durationMs = Date.now() - startedAt;
  await attempt.save();
}

export async function executeAiChat(input: {
  enterpriseId: string | mongoose.Types.ObjectId;
  generationId?: string | mongoose.Types.ObjectId;
  logicalModelKey: 'chat.general' | 'vision.reference_analysis';
  messages: AiChatMessage[];
  temperature?: number;
  maxTokens?: number;
}) {
  const capability = capabilityForLogicalModel(input.logicalModelKey);
  const runtimes = await listProviderRuntimes(capability, input.logicalModelKey);
  if (!runtimes.length) throw new Error(`没有可用的 AI 供应商支持 ${input.logicalModelKey}`);

  let lastError: unknown;
  for (const runtime of runtimes) {
    const model = runtime.modelMappings[input.logicalModelKey];
    if (!model) continue;
    const startedAt = Date.now();
    const attempt = await createAttempt({ ...input, runtime, payload: input.messages });
    try {
      const content = await getAiProviderAdapter(runtime.adapterType).chat(runtime, {
        model,
        messages: input.messages,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
      });
      attempt.status = 'succeeded';
      attempt.accepted = true;
      attempt.durationMs = Date.now() - startedAt;
      attempt.actualCost = attempt.estimatedCost;
      await attempt.save();
      return { content, provider: runtime.key, model, attemptId: String(attempt._id) };
    } catch (error) {
      lastError = error;
      const safe = isSafeProviderFallback(error);
      await markAttemptError(attempt, error, safe ? 'failed' : 'unknown', !safe, startedAt);
      if (!safe) throw error;
    }
  }
  throw lastError || new Error('所有 AI 供应商均不可用');
}

export async function ensureGenerationCreditHold(generation: GenerationDocument, actionKey?: AiActionKey) {
  if (generation.billing?.status === 'held' || generation.billing?.status === 'consumed') return generation;
  const resolvedActionKey = actionKey || generation.actionKey || actionKeyForGenerationType(generation.type);
  await assertEnterpriseAiActionAllowed(generation.enterpriseId, resolvedActionKey);
  const parameterSnapshot = generation.input?.creationParameterSnapshot as {
    modelProfileKey?: string;
    resolutionTier?: '1K' | '2K' | '4K' | 'CUSTOM';
    remoteModel?: string;
  } | undefined;
  const modelPrice = resolvedActionKey === 'image.free_create'
    && parameterSnapshot?.modelProfileKey
    && parameterSnapshot?.resolutionTier
    ? await getImageModelPrice(parameterSnapshot.modelProfileKey, parameterSnapshot.resolutionTier)
    : undefined;
  const price = modelPrice || await getAiCreditPrice(resolvedActionKey);
  const priceCredits = toSafeCreditAmount(price.credits);
  const cycle = Number(generation.billing?.cycle ?? generation.retryCount ?? 0);
  const operationId = `${generation._id}:hold:${cycle}`;
  if (priceCredits > 0) {
    await holdAiCredits({
      enterpriseId: generation.enterpriseId,
      generationId: generation._id,
      operatorId: generation.operatorId,
      amount: priceCredits,
      operationId,
    });
  }
  generation.actionKey = resolvedActionKey;
  generation.billing = {
    ...generation.billing,
    cycle,
    actionKey: resolvedActionKey,
    price: priceCredits,
    priceSnapshot: {
      actionKey: resolvedActionKey,
      label: price.label,
      credits: priceCredits,
      modelProfileKey: parameterSnapshot?.modelProfileKey,
      remoteModel: parameterSnapshot?.remoteModel,
      resolutionTier: parameterSnapshot?.resolutionTier,
      capturedAt: new Date(),
    },
    status: priceCredits > 0 ? 'held' : 'consumed',
    holdOperationId: priceCredits > 0 ? operationId : undefined,
  };
  await generation.save();
  return generation;
}

export async function consumeGenerationCredits(generation: GenerationDocument) {
  if (generation.billing?.status !== 'held') return;
  const amount = Number(generation.billing.price || 0);
  const cycle = Number(generation.billing.cycle || 0);
  const operationId = `${generation._id}:consume:${cycle}`;
  await consumeHeldAiCredits({
    enterpriseId: generation.enterpriseId,
    generationId: generation._id,
    operatorId: generation.operatorId,
    amount,
    operationId,
  });
  generation.billing.status = 'consumed';
  generation.billing.consumeOperationId = operationId;
}

export async function releaseGenerationCredits(generation: GenerationDocument, note: string) {
  if (generation.billing?.status !== 'held') return;
  const amount = Number(generation.billing.price || 0);
  const cycle = Number(generation.billing.cycle || 0);
  const operationId = `${generation._id}:release:${cycle}`;
  await releaseHeldAiCredits({
    enterpriseId: generation.enterpriseId,
    generationId: generation._id,
    operatorId: generation.operatorId,
    amount,
    operationId,
    note,
  });
  generation.billing.status = 'released';
  generation.billing.releaseOperationId = operationId;
}

async function persistFailedGeneration(
  generation: GenerationDocument,
  input: {
    errorCode: string;
    errorMessage: string;
    remoteTaskId?: string;
    remoteStatus?: string;
  }
) {
  generation.status = 'failed';
  generation.errorCode = input.errorCode;
  generation.errorMessage = input.errorMessage;
  generation.externalTask = {
    status: 'failed',
    remoteTaskId: input.remoteTaskId,
    remoteStatus: input.remoteStatus || 'failed',
    lastPolledAt: new Date(),
  };
  try {
    await releaseGenerationCredits(generation, input.errorMessage);
  } finally {
    await generation.save();
  }
  return generation;
}

async function persistSuccess(
  generation: GenerationDocument,
  attempt: IAiProviderAttempt,
  result: Extract<AiImageProviderResult, { status: 'succeeded' }>,
  startedAt: number
) {
  try {
    const persistGrsAiOutputs = await getGrsAiOutputPersistenceEnabled();
    const imageUrl = shouldKeepGrsAiOutputUrl({
      adapterType: attempt.adapterType,
      image: result.image,
      persistGrsAiOutputs,
    })
      ? result.image
      : await persistImageReference({
          enterpriseId: generation.enterpriseId,
          ownerType: 'ai_generation_output',
          ownerId: generation._id,
          image: result.image,
          storageProviderKey: generation.type === 'free_create' ? 'local' : undefined,
        });
    if (!imageUrl) throw new Error('供应商未返回可持久化图片');
    generation.output.imageUrl = imageUrl;
    generation.status = 'succeeded';
    generation.externalTask = {
      status: 'succeeded',
      remoteTaskId: result.remoteTaskId || attempt.remoteTaskId,
      remoteStatus: result.remoteStatus || 'succeeded',
      lastPolledAt: new Date(),
    };
    generation.durationMs = Date.now() - startedAt;
    attempt.status = 'succeeded';
    attempt.accepted = true;
    attempt.remoteStatus = result.remoteStatus || 'succeeded';
    attempt.durationMs = generation.durationMs;
    attempt.actualCost = attempt.estimatedCost;
    await consumeGenerationCredits(generation);
    await Promise.all([attempt.save(), generation.save()]);
    await syncSuccessfulGenerationToWorkflow(generation).catch((error) => {
      console.error('[AI Workflow Sync]', error);
    });
    return generation;
  } catch (error) {
    attempt.status = 'failed';
    attempt.accepted = true;
    attempt.errorCode = 'OUTPUT_PERSIST_FAILED';
    attempt.errorMessage = error instanceof Error ? error.message : String(error);
    attempt.actualCost = attempt.estimatedCost;
    generation.status = 'failed';
    generation.errorCode = 'OUTPUT_PERSIST_FAILED';
    generation.errorMessage = '上游任务已完成，但结果图片持久化失败';
    await releaseGenerationCredits(generation, generation.errorMessage);
    await Promise.all([attempt.save(), generation.save()]);
    throw error;
  }
}

async function applyPendingResult(
  generation: GenerationDocument,
  attempt: IAiProviderAttempt,
  result: Extract<AiImageProviderResult, { status: 'processing' | 'unknown' }>,
  startedAt: number
) {
  attempt.status = result.status;
  attempt.accepted = true;
  attempt.remoteTaskId = result.remoteTaskId || attempt.remoteTaskId;
  attempt.remoteStatus = result.remoteStatus || result.status;
  attempt.durationMs = Date.now() - startedAt;
  if (result.status === 'unknown') {
    attempt.errorCode = 'PROVIDER_STATUS_UNKNOWN';
    attempt.errorMessage = result.error;
  }
  generation.status = 'processing';
  generation.externalTask = {
    status: result.status,
    remoteTaskId: attempt.remoteTaskId,
    remoteStatus: attempt.remoteStatus,
    nextPollAt: nextPollDate(result.status === 'processing' ? result.nextPollMs : 30000),
    lastPolledAt: new Date(),
  };
  await Promise.all([attempt.save(), generation.save()]);
  return generation;
}

export async function executeGenerationImage(
  generation: GenerationDocument,
  input: Omit<AiImageSubmitInput, 'model'> & {
    logicalModelKey?: 'image.generate.standard' | 'image.edit.standard';
    excludeProviderConfigIds?: string[];
    modelOverride?: {
      adapterType: 'grs';
      remoteModel: string;
      modelProfileKey: string;
    };
  }
) {
  const logicalModelKey = input.logicalModelKey || (input.images?.length ? 'image.edit.standard' : 'image.generate.standard');
  const excludedProviderIds = new Set(input.excludeProviderConfigIds || []);
  await ensureGenerationCreditHold(generation);
  if (process.env.MOCK_AI === 'true') {
    const buffer = await fs.readFile(path.join(process.cwd(), 'public', 'soft-furnishing-result.png'));
    const imageUrl = await persistImageReference({
      enterpriseId: generation.enterpriseId,
      ownerType: 'ai_generation_output',
      ownerId: generation._id,
      image: `data:image/png;base64,${buffer.toString('base64')}`,
      storageProviderKey: generation.type === 'free_create' ? 'local' : undefined,
    });
    generation.output.imageUrl = imageUrl;
    generation.output.promptUsed = input.prompt;
    generation.provider = 'mock';
    generation.remoteModel = 'mock';
    generation.status = 'succeeded';
    await consumeGenerationCredits(generation);
    await generation.save();
    await syncSuccessfulGenerationToWorkflow(generation).catch((error) => {
      console.error('[AI Workflow Sync]', error);
    });
    return generation;
  }
  const persistedImages = input.images?.length
      ? await Promise.all(input.images.map((image) => persistImageReference({
        enterpriseId: generation.enterpriseId,
        ownerType: 'ai_generation_input',
        ownerId: generation._id,
        image,
        storageProviderKey: generation.type === 'free_create' ? 'local' : undefined,
      })))
    : undefined;
  const imageRefs = persistedImages?.filter((image): image is string => Boolean(image));
  const resolvedImages = imageRefs?.length
    ? await Promise.all(imageRefs.map((image) => resolveAiProviderImageInput(image, generation.enterpriseId)))
    : undefined;
  const payload = {
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    size: input.size,
    aspectRatio: input.aspectRatio,
    quality: input.quality,
    resolutionTier: input.resolutionTier,
    width: input.width,
    height: input.height,
    user: input.user,
    images: resolvedImages,
  };
  generation.input.providerImages = imageRefs;
  generation.input.providerRequest = {
    logicalModelKey,
    modelProfileKey: input.modelOverride?.modelProfileKey,
    remoteModel: input.modelOverride?.remoteModel,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    size: input.size,
    aspectRatio: input.aspectRatio,
    quality: input.quality,
    resolutionTier: input.resolutionTier,
    width: input.width,
    height: input.height,
    user: input.user,
    images: imageRefs,
  };
  await generation.save();
  const runtimes = (input.modelOverride
    ? await listProviderRuntimesByAdapter(
        capabilityForLogicalModel(logicalModelKey),
        input.modelOverride.adapterType
      )
    : await listProviderRuntimes(capabilityForLogicalModel(logicalModelKey), logicalModelKey))
    .filter((runtime) => !excludedProviderIds.has(runtime.id));
  if (!runtimes.length) {
    await releaseGenerationCredits(generation, '没有已启用且支持该能力的 AI 供应商');
    generation.status = 'failed';
    generation.errorCode = 'NO_PROVIDER_AVAILABLE';
    generation.errorMessage = '没有已启用且支持该能力的 AI 供应商';
    await generation.save();
    throw new Error(generation.errorMessage);
  }

  let lastError: unknown;
  for (const runtime of runtimes) {
    const remoteModel = input.modelOverride?.remoteModel || runtime.modelMappings[logicalModelKey];
    if (!remoteModel) continue;
    const startedAt = Date.now();
    const attempt = await createAttempt({
      enterpriseId: generation.enterpriseId,
      generationId: generation._id,
      runtime,
      logicalModelKey,
      remoteModel,
      resolutionTier: input.resolutionTier,
      payload,
    });
    generation.provider = runtime.key;
    generation.capability = capabilityForLogicalModel(logicalModelKey);
    generation.logicalModelKey = logicalModelKey;
    generation.remoteModel = remoteModel;
    generation.currentAttemptId = attempt._id;
    generation.status = 'processing';
    await generation.save();

    try {
      const result = await getAiProviderAdapter(runtime.adapterType).submitImage(runtime, {
        ...payload,
        model: remoteModel,
      });
      if (result.status === 'succeeded') return persistSuccess(generation, attempt, result, startedAt);
      if (result.status === 'processing' || result.status === 'unknown') {
        return applyPendingResult(generation, attempt, result, startedAt);
      }
      await markAttemptError(attempt, new Error(result.error), 'failed', Boolean(result.remoteTaskId) || result.refunded !== undefined, startedAt);
      attempt.actualCost = result.refunded && attempt.estimatedCost
        ? { currency: attempt.estimatedCost.currency, micros: 0 }
        : attempt.estimatedCost;
      await attempt.save();
      if (!result.refunded) {
        return persistFailedGeneration(generation, {
          errorCode: 'PROVIDER_TASK_FAILED',
          errorMessage: result.error,
          remoteTaskId: result.remoteTaskId,
          remoteStatus: result.remoteStatus,
        });
      }
      lastError = new Error(result.error);
    } catch (error) {
      lastError = error;
      const resolution = classifyImageSubmissionError(error, attempt.remoteTaskId);
      await markAttemptError(attempt, error, resolution.attemptStatus, resolution.accepted, startedAt);
      if (resolution.action === 'fail_untrackable') {
        return persistFailedGeneration(generation, {
          errorCode: 'PROVIDER_SUBMISSION_UNTRACKABLE',
          errorMessage: `供应商提交响应不可追踪，未返回任务 ID：${attempt.errorMessage || '未知错误'}`,
          remoteStatus: 'untrackable',
        });
      }
      if (resolution.action === 'wait') {
        generation.status = 'processing';
        generation.errorCode = 'PROVIDER_STATUS_UNKNOWN';
        generation.errorMessage = error instanceof Error ? error.message : String(error);
        generation.externalTask = {
          status: 'unknown',
          remoteTaskId: attempt.remoteTaskId,
          remoteStatus: 'unknown',
          nextPollAt: nextPollDate(30000),
          lastPolledAt: new Date(),
        };
        await generation.save();
        return generation;
      }
    }
  }

  const finalError = lastError instanceof Error ? lastError.message : '所有供应商均未受理任务';
  await persistFailedGeneration(generation, {
    errorCode: 'ALL_PROVIDERS_REJECTED',
    errorMessage: finalError,
  });
  throw lastError || new Error(generation.errorMessage);
}

export async function reconcileAiGeneration(
  generationOrId: GenerationDocument | string,
  options: { force?: boolean } = {}
) {
  const generation = typeof generationOrId === 'string'
    ? await AiGeneration.findById(generationOrId)
    : generationOrId;
  if (!generation) throw new Error('AI 任务不存在');
  if (generation.status !== 'processing' || !generation.currentAttemptId) return generation;
  if (!options.force && generation.externalTask?.nextPollAt && generation.externalTask.nextPollAt.getTime() > Date.now()) return generation;

  const attempt = await AiProviderAttempt.findById(generation.currentAttemptId);
  if (!attempt) return generation;
  if (!attempt.remoteTaskId) {
    const untrackable = attempt.status === 'unknown';
    if (untrackable) {
      attempt.status = 'failed';
      attempt.accepted = false;
      attempt.remoteStatus = 'untrackable';
      await attempt.save();
    }
    return persistFailedGeneration(generation, {
      errorCode: untrackable ? 'PROVIDER_SUBMISSION_UNTRACKABLE' : attempt.errorCode || 'ALL_PROVIDERS_REJECTED',
      errorMessage: untrackable
        ? `供应商提交响应不可追踪，未返回任务 ID：${attempt.errorMessage || '未知错误'}`
        : attempt.errorMessage || '供应商未受理任务',
      remoteStatus: attempt.remoteStatus || (untrackable ? 'untrackable' : 'failed'),
    });
  }
  const runtime = await getProviderRuntimeById(String(attempt.providerConfigId));
  const startedAt = Date.now();
  try {
    const result = await getAiProviderAdapter(runtime.adapterType).pollImage(runtime, attempt.remoteTaskId);
    if (result.status === 'succeeded') return persistSuccess(generation, attempt, result, startedAt);
    if (result.status === 'processing' || result.status === 'unknown') return applyPendingResult(generation, attempt, result, startedAt);
    attempt.status = 'failed';
    attempt.accepted = true;
    attempt.remoteStatus = result.remoteStatus || 'failed';
    attempt.errorMessage = result.error;
    attempt.actualCost = result.refunded && attempt.estimatedCost
      ? { currency: attempt.estimatedCost.currency, micros: 0 }
      : attempt.estimatedCost;
    if (result.refunded) {
      await attempt.save();
      const snapshot = generation.input.providerRequest as (Omit<AiImageSubmitInput, 'model'> & {
        logicalModelKey?: 'image.generate.standard' | 'image.edit.standard';
      }) | undefined;
      if (snapshot?.prompt) {
        const attemptedProviderIds = await AiProviderAttempt.distinct('providerConfigId', { generationId: generation._id });
        return executeGenerationImage(generation, {
          ...snapshot,
          excludeProviderConfigIds: attemptedProviderIds.map(String),
        });
      }
    }
    await attempt.save();
    return persistFailedGeneration(generation, {
      errorCode: 'PROVIDER_TASK_FAILED',
      errorMessage: result.error,
      remoteTaskId: attempt.remoteTaskId,
      remoteStatus: attempt.remoteStatus,
    });
  } catch (error) {
    await markAttemptError(attempt, error, 'unknown', true, startedAt);
    generation.externalTask = {
      status: 'unknown',
      remoteTaskId: attempt.remoteTaskId,
      remoteStatus: 'unknown',
      nextPollAt: nextPollDate(30000),
      lastPolledAt: new Date(),
    };
    generation.errorCode = 'PROVIDER_STATUS_UNKNOWN';
    generation.errorMessage = error instanceof Error ? error.message : String(error);
    await generation.save();
    return generation;
  }
}

export async function reconcileDueAiGenerations(limit = 20) {
  const normalizedLimit = Math.max(1, Math.min(limit, 100));
  const pendingTtlMs = Math.max(60000, Number(process.env.AI_PENDING_TASK_TTL_MS || 30 * 60 * 1000));
  const stalePending = await AiGeneration.find({
    status: { $in: ['created', 'pending'] },
    'billing.status': 'held',
    currentAttemptId: { $exists: false },
    updatedAt: { $lte: new Date(Date.now() - pendingTtlMs) },
  }).limit(normalizedLimit);
  const results: GenerationDocument[] = [];
  for (const generation of stalePending) {
    await releaseGenerationCredits(generation, '任务在提交上游前超时');
    generation.status = 'failed';
    generation.errorCode = 'TASK_SUBMISSION_EXPIRED';
    generation.errorMessage = '任务在提交上游前超时，已释放冻结点数';
    await generation.save();
    results.push(generation);
  }

  const remaining = normalizedLimit - results.length;
  const generations = remaining > 0
    ? await AiGeneration.find({
        status: 'processing',
        currentAttemptId: { $exists: true },
        $or: [
          { 'externalTask.nextPollAt': { $lte: new Date() } },
          { 'externalTask.nextPollAt': { $exists: false } },
        ],
      }).sort({ 'externalTask.nextPollAt': 1 }).limit(remaining)
    : [];
  for (const generation of generations) {
    results.push(await reconcileAiGeneration(generation));
  }
  return results;
}
