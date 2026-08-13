import {
  AiCreationRepository,
  type AiCreationTaskView,
  type AiGenerationRecord,
  AiWorkflowRepository,
  LeadRepository,
} from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withTenantTransaction } from '@/db/transaction';
import {
  abandonPostgresCreationProviderAttempt,
  acknowledgePostgresCreationProviderAttempt,
  beginPostgresCreationProviderAttempt,
  claimPostgresCreationProviderPolls,
  completePostgresCreationProviderAttempt,
  failPostgresCreationProviderAttempt,
  holdPostgresCreationGenerationCredits,
  recordPostgresCreationProviderPollState,
  refreshPostgresCreationBatchStatus,
  releasePostgresCreationGenerationCredits,
  settlePostgresCreationProviderResult,
  settlePostgresCreationProviderUrlResult,
} from '@/lib/ai/postgres-creation-service';
import {
  readPostgresMediaAssetBuffer,
  getPostgresAssetIdFromImageUrl,
  storePostgresMediaBuffer,
} from '@/lib/ai/postgres-media-assets';
import {
  AiProviderError,
  capabilityForLogicalModel,
  isSafeProviderFallback,
  type AiImageProviderResult,
  type AiImageSubmitInput,
  type AiLogicalModelKey,
} from '@/lib/ai/provider-types';
import {
  getAiProviderAdapter,
  getProviderRuntimeById,
  listProviderRuntimes,
} from '@/lib/ai/provider-registry';
import { parseImageDataUri } from '@/lib/ai/postgres-media-assets';
import { resolveProviderCostEstimate } from '@/lib/ai/provider-cost';
import { renderMiniAiFloorPlanControlPng } from '@/lib/ai/mini-ai-floorplan';
import {
  getGrsAiOutputPersistenceEnabled,
  shouldKeepGrsAiOutputUrl,
} from '@/lib/media-storage/config-service';

type ProviderRequest = Omit<AiImageSubmitInput, 'model'> & {
  logicalModelKey: 'image.generate.standard' | 'image.edit.standard';
  modelProfileKey?: string;
  remoteModel: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toDtoGeneration(generation: AiGenerationRecord) {
  const output = asRecord(generation.output);
  const imageUrl = typeof output.imageUrl === 'string' && output.imageUrl
    ? output.imageUrl
    : undefined;
  return {
    id: generation.id.toString(),
    status: generation.status,
    // The persisted asset route is directly renderable and avoids a redirect
    // through the generation endpoint that browser content blockers may reject.
    imageUrl,
    error: generation.errorMessage,
    provider: generation.provider,
    retryCount: generation.retryCount,
    model: asRecord(generation.input).creationParameterSnapshot
      ? String(asRecord(asRecord(generation.input).creationParameterSnapshot).remoteModel || '') || undefined
      : undefined,
    workflowId: generation.workflowId?.toString(),
    createdAt: generation.createdAt,
    updatedAt: generation.updatedAt,
  };
}

/** Preserves the existing free-creation task DTO while IDs become bigint strings. */
export function serializePostgresCreationTask(task: AiCreationTaskView) {
  return {
    id: task.id.toString(),
    title: task.title,
    prompt: task.prompt,
    referenceAssetIds: task.referenceAssetIds.map(String),
    modelProfileId: task.modelProfileId.toString(),
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    batches: task.batches.map((batch) => ({
      id: batch.id.toString(),
      sequence: batch.sequence,
      prompt: batch.prompt,
      negativePrompt: batch.negativePrompt,
      referenceAssetIds: batch.referenceAssetIds.map(String),
      modelProfileId: batch.modelProfileId.toString(),
      modelProfileSnapshot: batch.modelProfileSnapshot,
      parameterSnapshot: batch.parameterSnapshot,
      requestedCount: batch.requestedCount,
      status: batch.status,
      creditsEstimate: Number(batch.creditsEstimate),
      createdAt: batch.createdAt,
      generations: batch.generations.map(toDtoGeneration),
    })),
  };
}

async function loadGenerationInput(enterpriseId: bigint, generationId: bigint) {
  return withTenantTransaction(enterpriseId, async (transaction) => {
    const repository = new AiCreationRepository(transaction);
    const generation = await repository.findGeneration(generationId);
    if (!generation || generation.deletedAt || ![
      'free_create',
      'scenario',
      'miniprogram',
      'soft_furnishing_render',
      'floor_plan_style',
      'furnishing_render',
    ].includes(generation.type)) {
      throw new Error('创作生成任务不存在');
    }
    if (generation.type === 'scenario') {
      if (!generation.workflowId) throw new Error('场景生成任务缺少方案会话');
      const workflows = new AiWorkflowRepository(transaction);
      const workflow = await workflows.findById(generation.workflowId);
      if (!workflow) throw new Error('方案会话不存在或无权访问');
      const lead = await new LeadRepository(transaction).findById(workflow.leadId);
      if (!lead) throw new Error('客户线索不存在或无权访问');
      const [parentGeneration, selectedGeneration] = await Promise.all([
        generation.parentGenerationId ? repository.findGeneration(generation.parentGenerationId) : null,
        workflow.selectedGenerationId ? repository.findGeneration(workflow.selectedGenerationId) : null,
      ]);
      return {
        generation,
        batch: null,
        assets: [],
        workflow,
        floorPlan: workflow.sourceFloorPlanId
          ? lead.floorPlanRecords.find((plan) => plan.id === workflow.sourceFloorPlanId) ?? null
          : null,
        parentGeneration,
        selectedGeneration,
      };
    }
    if (['miniprogram', 'soft_furnishing_render', 'floor_plan_style', 'furnishing_render'].includes(generation.type)) {
      const input = asRecord(generation.input);
      const imageUrls = generation.type === 'miniprogram'
        ? [input.controlImage, input.referenceImage, input.spaceImage]
        : [input.sourceImage];
      const validImageUrls = imageUrls.filter((value): value is string => typeof value === 'string' && value.length > 0);
      const assets = await Promise.all(validImageUrls.map(async (imageUrl) => {
        const assetId = getPostgresAssetIdFromImageUrl(imageUrl);
        if (!assetId) throw new Error('小程序 AI 任务图片来源无效');
        const asset = await repository.findMediaAsset(assetId);
        if (!asset) throw new Error('小程序 AI 任务图片不存在或无权访问');
        return asset;
      }));
      return { generation, batch: null, assets, workflow: null, floorPlan: null, parentGeneration: null, selectedGeneration: null };
    }
    const view = generation.creationTaskId
      ? await repository.loadTaskView(generation.creationTaskId)
      : null;
    const batch = view?.batches.find((item) => item.id === generation.creationBatchId);
    if (!batch) throw new Error('创作批次不存在');
    const assets = await repository.findMediaAssets(batch.referenceAssetIds);
    if (assets.length !== batch.referenceAssetIds.length) {
      throw new Error('参考图不存在或无权访问');
    }
    return { generation, batch, assets, workflow: null, floorPlan: null, parentGeneration: null, selectedGeneration: null };
  });
}

async function loadProviderAttempt(enterpriseId: bigint, attemptId: bigint) {
  return withTenantTransaction(enterpriseId, (transaction) =>
    new AiCreationRepository(transaction).findProviderAttempt(attemptId)
  );
}

async function toProviderDataUris(
  assets: Awaited<ReturnType<typeof loadGenerationInput>>['assets']
) {
  return Promise.all(assets.map(async (asset) =>
    `data:${asset.mimeType};base64,${(await readPostgresMediaAssetBuffer(asset)).toString('base64')}`
  ));
}

export async function resolvePostgresScenarioProviderImage(enterpriseId: bigint, image?: string | null) {
  const value = image?.trim();
  if (!value) return undefined;
  if (value.startsWith('data:image') || /^https?:\/\//i.test(value)) return value;
  const assetId = getPostgresAssetIdFromImageUrl(value);
  if (!assetId) throw new Error('场景生成任务包含无法读取的图片来源');
  const asset = await withTenantTransaction(enterpriseId, (transaction) =>
    new AiCreationRepository(transaction).findMediaAsset(assetId)
  );
  if (!asset) throw new Error('场景生成任务的图片来源不存在或无权访问');
  return `data:${asset.mimeType};base64,${(await readPostgresMediaAssetBuffer(asset)).toString('base64')}`;
}

async function loadScenarioProviderImages(
  enterpriseId: bigint,
  loaded: Awaited<ReturnType<typeof loadGenerationInput>>
) {
  const { generation, workflow, floorPlan, parentGeneration, selectedGeneration } = loaded;
  if (generation.type !== 'scenario' || !workflow) return [];
  const input = asRecord(generation.input);
  const usesFloorPlanControl = Boolean(floorPlan)
    && ['direction', 'base_render', 'perspective_upgrade'].includes(String(generation.stageKey));
  if (usesFloorPlanControl && floorPlan) {
    const existing = await resolvePostgresScenarioProviderImage(
      enterpriseId,
      typeof input.controlImage === 'string' ? input.controlImage : undefined
    );
    if (existing) return [existing];

    const controlBuffer = await renderMiniAiFloorPlanControlPng(floorPlan.layoutData);
    const control = await storePostgresMediaBuffer({
      enterpriseId,
      ownerType: 'ai_generation_input',
      ownerId: generation.id,
      mimeType: 'image/png',
      buffer: controlBuffer,
      storageProviderKey: 'local',
    });
    await withTenantTransaction(enterpriseId, async (transaction) => {
      const repository = new AiCreationRepository(transaction);
      const current = await repository.findGenerationForUpdate(generation.id);
      if (!current || current.status !== 'created') {
        throw new Error('场景生成任务已变更，无法附加正式户型控制图');
      }
      await repository.updateGeneration(generation.id, {
        input: { ...asRecord(current.input), controlImage: control.imageUrl },
      });
    });
    return [`data:image/png;base64,${controlBuffer.toString('base64')}`];
  }

  const source = [
    typeof input.styleReferenceImage === 'string' ? input.styleReferenceImage : undefined,
    typeof asRecord(parentGeneration?.output).imageUrl === 'string' ? String(asRecord(parentGeneration?.output).imageUrl) : undefined,
    typeof asRecord(selectedGeneration?.output).imageUrl === 'string' ? String(asRecord(selectedGeneration?.output).imageUrl) : undefined,
    workflow.sourceImage,
  ].find((value): value is string => Boolean(value));
  const resolved = await resolvePostgresScenarioProviderImage(enterpriseId, source);
  return resolved ? [resolved] : [];
}

function providerRequest(generation: AiGenerationRecord, images: string[]): ProviderRequest {
  const input = asRecord(generation.input);
  const logicalModelKey = generation.logicalModelKey;
  if (logicalModelKey !== 'image.generate.standard' && logicalModelKey !== 'image.edit.standard') {
    throw new Error('创作生成任务缺少图片模型能力');
  }
  if (['scenario', 'miniprogram', 'soft_furnishing_render', 'floor_plan_style', 'furnishing_render'].includes(generation.type)) {
    const preset = asRecord(input.presetSnapshot);
    const image = asRecord(preset.image);
    const requiresReferenceImage = image.mode !== 'generation';
    return {
      logicalModelKey,
      modelProfileKey: undefined,
      remoteModel: '',
      prompt: String(input.customPrompt || '').trim(),
      negativePrompt: typeof input.negativePrompt === 'string'
        ? input.negativePrompt
        : typeof preset.negativePrompt === 'string' ? preset.negativePrompt : undefined,
      size: typeof input.outputSize === 'string'
        ? input.outputSize
        : typeof image.size === 'string' ? image.size : '1024x1024',
      quality: typeof input.outputQuality === 'string'
        ? input.outputQuality
        : typeof image.quality === 'string' ? image.quality : 'medium',
      aspectRatio: typeof input.outputAspectRatio === 'string' ? input.outputAspectRatio : '1:1',
      user: generation.operatorId.toString(),
      images: requiresReferenceImage && images.length ? images : undefined,
    };
  }
  const parameters = asRecord(input.creationParameterSnapshot);
  const remoteModel = String(parameters.remoteModel || '').trim();
  const modelProfileKey = String(parameters.modelProfileKey || '').trim();
  if (!remoteModel || !modelProfileKey) throw new Error('创作生成任务缺少模型快照');
  return {
    logicalModelKey,
    modelProfileKey,
    remoteModel,
    prompt: String(input.customPrompt || '').trim(),
    negativePrompt: undefined,
    aspectRatio: String(parameters.aspectRatio || '1:1'),
    resolutionTier: String(parameters.resolutionTier || '1K') as ProviderRequest['resolutionTier'],
    width: parameters.width ? Number(parameters.width) : undefined,
    height: parameters.height ? Number(parameters.height) : undefined,
    user: generation.operatorId.toString(),
    images: images.length ? images : undefined,
  };
}

async function persistProviderResult(input: {
  enterpriseId: bigint;
  generationId: bigint;
  image: string;
}) {
  const image = input.image.trim();
  if (image.startsWith('data:image')) {
    const parsed = parseImageDataUri(image);
    return storePostgresMediaBuffer({
      enterpriseId: input.enterpriseId,
      ownerType: 'ai_generation_output',
      mimeType: parsed.mimeType,
      buffer: parsed.buffer,
      storageProviderKey: 'local',
    });
  }
  const response = await fetch(image, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to persist provider image (${response.status})`);
  const mimeType = response.headers.get('content-type')?.split(';')[0] || 'image/png';
  if (!mimeType.startsWith('image/')) throw new Error('Provider result is not an image');
  return storePostgresMediaBuffer({
    enterpriseId: input.enterpriseId,
    ownerType: 'ai_generation_output',
    mimeType,
    buffer: Buffer.from(await response.arrayBuffer()),
    originalUrl: image,
  });
}

async function handleProviderResult(input: {
  enterpriseId: bigint;
  generationId: bigint;
  attemptId: bigint;
  adapterType: string;
  result: AiImageProviderResult;
  pollLeaseId?: string;
}) {
  const remoteTaskId = input.result.remoteTaskId || `synchronous:${input.attemptId.toString()}`;
  if (input.result.status === 'succeeded') {
    await acknowledgePostgresCreationProviderAttempt({
      enterpriseId: input.enterpriseId.toString(), generationId: input.generationId.toString(),
      attemptId: input.attemptId.toString(), remoteTaskId,
      remoteStatus: input.result.remoteStatus || 'succeeded',
    });
    const keepProviderUrl = shouldKeepGrsAiOutputUrl({
      adapterType: input.adapterType,
      image: input.result.image,
      persistGrsAiOutputs: input.adapterType === 'grs'
        ? await getGrsAiOutputPersistenceEnabled()
        : true,
    });
    const stored = keepProviderUrl
      ? null
      : await persistProviderResult({
          enterpriseId: input.enterpriseId, generationId: input.generationId, image: input.result.image,
        });
    await completePostgresCreationProviderAttempt({
      enterpriseId: input.enterpriseId.toString(), generationId: input.generationId.toString(),
      attemptId: input.attemptId.toString(), remoteTaskId,
      remoteStatus: input.result.remoteStatus || 'succeeded', output: { providerImage: input.result.image },
      pollLeaseId: input.pollLeaseId,
    });
    if (keepProviderUrl) {
      return settlePostgresCreationProviderUrlResult({
        enterpriseId: input.enterpriseId.toString(), generationId: input.generationId.toString(),
        attemptId: input.attemptId.toString(), remoteTaskId, imageUrl: input.result.image,
      });
    }
    return settlePostgresCreationProviderResult({
      enterpriseId: input.enterpriseId.toString(), generationId: input.generationId.toString(),
      attemptId: input.attemptId.toString(), remoteTaskId, assetId: stored!.asset.id.toString(),
    });
  }
  if (input.result.status === 'processing' || input.result.status === 'unknown') {
    if (input.result.remoteTaskId) {
      const state = input.pollLeaseId
        ? recordPostgresCreationProviderPollState
        : acknowledgePostgresCreationProviderAttempt;
      return state({
        enterpriseId: input.enterpriseId.toString(), generationId: input.generationId.toString(),
        attemptId: input.attemptId.toString(), remoteTaskId,
        status: input.result.status, remoteStatus: input.result.remoteStatus,
        errorMessage: input.result.status === 'unknown' ? input.result.error : undefined,
        nextPollAfterMs: input.result.status === 'processing' ? input.result.nextPollMs : 30_000,
        ...(input.pollLeaseId ? { pollLeaseId: input.pollLeaseId } : {}),
      } as never);
    }
  }
  return failPostgresCreationProviderAttempt({
    enterpriseId: input.enterpriseId.toString(), generationId: input.generationId.toString(),
    attemptId: input.attemptId.toString(), remoteTaskId,
    remoteStatus: input.result.remoteStatus,
    errorMessage: 'error' in input.result ? input.result.error : '供应商任务执行失败',
    pollLeaseId: input.pollLeaseId,
  });
}

export async function submitPostgresCreationGeneration(input: { enterpriseId: string; generationId: string }) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const generationId = parsePostgresId(input.generationId, 'generationId');
  const held = await holdPostgresCreationGenerationCredits({ enterpriseId: enterpriseId.toString(), generationId: generationId.toString() });
  let loaded: Awaited<ReturnType<typeof loadGenerationInput>> | null = null;
  try {
    loaded = await loadGenerationInput(enterpriseId, generationId);
    const images = loaded.generation.type === 'scenario'
      ? await loadScenarioProviderImages(enterpriseId, loaded)
      : await toProviderDataUris(loaded.assets);
    const request = providerRequest(loaded.generation, images);
    const useDefaultImageRuntime = ['scenario', 'miniprogram', 'soft_furnishing_render', 'floor_plan_style', 'furnishing_render'].includes(loaded.generation.type);
    const runtimes = await listProviderRuntimes(
      capabilityForLogicalModel(request.logicalModelKey as AiLogicalModelKey),
      request.logicalModelKey
    );
    const candidates = useDefaultImageRuntime
      ? runtimes
      : runtimes.filter((item) => item.modelMappings[request.logicalModelKey] === request.remoteModel);
    if (!candidates.length) throw new Error('没有与创作模型快照匹配的可用 AI 供应商');

    let submitted = false;
    let lastError: unknown;
    for (const [index, runtime] of candidates.entries()) {
      const remoteModel = runtime.modelMappings[request.logicalModelKey];
      if (!remoteModel) continue;
      request.remoteModel = remoteModel;
      const begun = await beginPostgresCreationProviderAttempt({
        enterpriseId: enterpriseId.toString(), generationId: generationId.toString(), providerConfigId: runtime.id,
        providerKey: runtime.key, adapterType: runtime.adapterType, remoteModel,
        requestSnapshot: request,
        estimatedCost: resolveProviderCostEstimate(
          runtime, request.logicalModelKey, remoteModel, String(request.resolutionTier || '')
        ),
      });
      if (begun.reused && begun.attempt.remoteTaskId) return begun.generation;
      try {
        const result = await getAiProviderAdapter(runtime.adapterType).submitImage(runtime, { ...request, model: remoteModel });
        await handleProviderResult({
          enterpriseId,
          generationId,
          attemptId: begun.attempt.id,
          adapterType: runtime.adapterType,
          result,
        });
        submitted = true;
        break;
      } catch (error) {
        lastError = error;
        const safeUnacceptedFailure = isSafeProviderFallback(error);
        if (!safeUnacceptedFailure) throw error;
        await abandonPostgresCreationProviderAttempt({
          enterpriseId: enterpriseId.toString(),
          generationId: generationId.toString(),
          attemptId: begun.attempt.id.toString(),
          errorCode: error instanceof AiProviderError ? error.code : 'PROVIDER_UNAVAILABLE',
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        if (index >= candidates.length - 1) throw error;
      }
    }
    if (!submitted) throw lastError || new Error('供应商未配置所需的图片模型能力');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await releasePostgresCreationGenerationCredits({ enterpriseId: enterpriseId.toString(), generationId: generationId.toString(), errorMessage: message });
    throw error;
  } finally {
    if (loaded?.generation.creationBatchId) {
      await refreshPostgresCreationBatchStatus({ enterpriseId: enterpriseId.toString(), batchId: loaded.generation.creationBatchId.toString() });
    }
  }
  return held.generation;
}

/**
 * Reconciles due PostgreSQL provider tasks for either one tenant or the
 * platform scheduler. Provider I/O always occurs after the claim transaction.
 */
export async function reconcilePostgresCreationTasks(enterpriseId?: string, limit = 12) {
  const claims = await claimPostgresCreationProviderPolls({ enterpriseId, limit });
  await Promise.allSettled(claims.map(async (claim) => {
    const scopedEnterpriseId = parsePostgresId(claim.enterpriseId, 'enterpriseId');
    const generationId = parsePostgresId(claim.generationId, 'generationId');
    const attemptId = parsePostgresId(claim.attemptId, 'attemptId');
    const [loaded, attempt] = await Promise.all([
      loadGenerationInput(scopedEnterpriseId, generationId),
      loadProviderAttempt(scopedEnterpriseId, attemptId),
    ]);
    if (!attempt || attempt.generationId !== generationId || !attempt.remoteTaskId) {
      throw new Error('供应商轮询任务的当前尝试无效');
    }
    const runtime = await getProviderRuntimeById(attempt.providerConfigId.toString());
    try {
      const result = await getAiProviderAdapter(runtime.adapterType).pollImage(runtime, attempt.remoteTaskId);
      await handleProviderResult({
        enterpriseId: scopedEnterpriseId,
        generationId,
        attemptId,
        adapterType: runtime.adapterType,
        result,
        pollLeaseId: claim.pollLeaseId,
      });
    } catch (error) {
      await recordPostgresCreationProviderPollState({
        enterpriseId: scopedEnterpriseId.toString(),
        generationId: generationId.toString(),
        attemptId: attemptId.toString(),
        remoteTaskId: attempt.remoteTaskId,
        status: 'unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
        pollLeaseId: claim.pollLeaseId,
      });
    } finally {
      if (loaded.generation.creationBatchId) {
        await refreshPostgresCreationBatchStatus({
          enterpriseId: scopedEnterpriseId.toString(),
          batchId: loaded.generation.creationBatchId.toString(),
        });
      }
    }
  }));
  return claims.length;
}
