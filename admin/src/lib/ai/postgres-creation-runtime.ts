import {
  AiCreationRepository,
  type AiCreationTaskView,
  type AiGenerationRecord,
} from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withTenantTransaction } from '@/db/transaction';
import {
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
} from '@/lib/ai/postgres-creation-service';
import {
  readPostgresMediaAssetBuffer,
  storePostgresMediaBuffer,
} from '@/lib/ai/postgres-media-assets';
import {
  capabilityForLogicalModel,
  type AiImageProviderResult,
  type AiImageSubmitInput,
  type AiLogicalModelKey,
} from '@/lib/ai/provider-types';
import {
  getAiProviderAdapter,
  getProviderRuntimeById,
  listProviderRuntimesByAdapter,
} from '@/lib/ai/provider-registry';
import { parseImageDataUri } from '@/lib/ai/media-assets';
import { resolveProviderCostEstimate } from '@/lib/ai/execution-service';

type ProviderRequest = Omit<AiImageSubmitInput, 'model'> & {
  logicalModelKey: 'image.generate.standard' | 'image.edit.standard';
  modelProfileKey: string;
  remoteModel: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toDtoGeneration(generation: AiGenerationRecord) {
  const output = asRecord(generation.output);
  return {
    id: generation.id.toString(),
    status: generation.status,
    imageUrl: typeof output.imageUrl === 'string' && output.imageUrl
      ? `/api/ai/generations/${generation.id.toString()}/image`
      : undefined,
    error: generation.errorMessage,
    provider: generation.provider,
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
    if (!generation || generation.deletedAt || generation.type !== 'free_create') {
      throw new Error('创作生成任务不存在');
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
    return { generation, batch, assets };
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

function providerRequest(generation: AiGenerationRecord, images: string[]): ProviderRequest {
  const input = asRecord(generation.input);
  const parameters = asRecord(input.creationParameterSnapshot);
  const logicalModelKey = generation.logicalModelKey;
  if (logicalModelKey !== 'image.generate.standard' && logicalModelKey !== 'image.edit.standard') {
    throw new Error('创作生成任务缺少图片模型能力');
  }
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
    storageProviderKey: 'local',
  });
}

async function handleProviderResult(input: {
  enterpriseId: bigint;
  generationId: bigint;
  attemptId: bigint;
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
    const stored = await persistProviderResult({
      enterpriseId: input.enterpriseId, generationId: input.generationId, image: input.result.image,
    });
    await completePostgresCreationProviderAttempt({
      enterpriseId: input.enterpriseId.toString(), generationId: input.generationId.toString(),
      attemptId: input.attemptId.toString(), remoteTaskId,
      remoteStatus: input.result.remoteStatus || 'succeeded', output: { providerImage: input.result.image },
      pollLeaseId: input.pollLeaseId,
    });
    return settlePostgresCreationProviderResult({
      enterpriseId: input.enterpriseId.toString(), generationId: input.generationId.toString(),
      attemptId: input.attemptId.toString(), remoteTaskId, assetId: stored.asset.id.toString(),
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
  const loaded = await loadGenerationInput(enterpriseId, generationId);
  const request = providerRequest(loaded.generation, await toProviderDataUris(loaded.assets));
  const profile = asRecord(loaded.batch.modelProfileSnapshot);
  const adapterType = String(profile.adapterType || '').trim();
  const runtimes = await listProviderRuntimesByAdapter(
    capabilityForLogicalModel(request.logicalModelKey as AiLogicalModelKey), adapterType
  );
  const runtime = runtimes.find((item) => item.modelMappings[request.logicalModelKey] === request.remoteModel);
  if (!runtime) {
    await releasePostgresCreationGenerationCredits({ enterpriseId: enterpriseId.toString(), generationId: generationId.toString(), errorMessage: '没有与创作模型快照匹配的可用 AI 供应商' });
    throw new Error('没有与创作模型快照匹配的可用 AI 供应商');
  }
  const begun = await beginPostgresCreationProviderAttempt({
    enterpriseId: enterpriseId.toString(), generationId: generationId.toString(), providerConfigId: runtime.id,
    providerKey: runtime.key, adapterType: runtime.adapterType, remoteModel: request.remoteModel,
    requestSnapshot: request,
    estimatedCost: resolveProviderCostEstimate(
      runtime, request.logicalModelKey, request.remoteModel, String(request.resolutionTier || '')
    ),
  });
  if (begun.reused && begun.attempt.remoteTaskId) return begun.generation;
  try {
    const result = await getAiProviderAdapter(runtime.adapterType).submitImage(runtime, { ...request, model: request.remoteModel });
    await handleProviderResult({ enterpriseId, generationId, attemptId: begun.attempt.id, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await releasePostgresCreationGenerationCredits({ enterpriseId: enterpriseId.toString(), generationId: generationId.toString(), errorMessage: message });
    throw error;
  } finally {
    if (loaded.generation.creationBatchId) {
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
