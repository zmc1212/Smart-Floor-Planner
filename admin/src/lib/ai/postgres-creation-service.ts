import crypto from 'node:crypto';
import {
  AiCreditRepository,
  AiCreationModelProfileRepository,
  AiCreationRepository,
  type AiCreationModelProfileRecord,
  type AiGenerationRecord,
} from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import {
  type PostgresTransaction,
  withPlatformTransaction,
  withTenantTransaction,
} from '@/db/transaction';
import { assertEnterpriseAiActionAllowed } from '@/lib/ai/enterprise-policy';
import { getPostgresImageModelPrice, serializePostgresCatalogProfile } from '@/lib/ai/image-model-catalog';
import { getPostgresMediaAssetImageUrl } from '@/lib/ai/postgres-media-assets';
import { getActivePromptTemplate } from '@/lib/ai/prompt-library-query';
import { resolveGrsImageParameters, type GrsResolutionTier } from '@/lib/ai/grs-image-models';
import { capabilityForLogicalModel, type AiLogicalModelKey } from '@/lib/ai/provider-types';

type CreationParameters = {
  aspectRatio: string;
  resolutionTier: GrsResolutionTier;
  width?: number;
  height?: number;
  templateId?: string;
};

type ParameterRequest = Partial<CreationParameters> & {
  size?: string;
  quality?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function withoutPostgresProviderPollLease(value: unknown): Record<string, unknown> {
  const task = { ...asRecord(value) };
  delete task.pollLeaseId;
  delete task.pollLeaseExpiresAt;
  delete task.pollClaimedAt;
  return task;
}

function assertPostgresProviderPollLease(generation: AiGenerationRecord, pollLeaseId?: string) {
  const requestedLeaseId = pollLeaseId?.trim();
  if (!requestedLeaseId) return;
  const externalTask = asRecord(generation.externalTask);
  const expiresAt = new Date(String(externalTask.pollLeaseExpiresAt || ''));
  if (
    externalTask.pollLeaseId !== requestedLeaseId
    || Number.isNaN(expiresAt.getTime())
    || expiresAt.getTime() <= Date.now()
  ) {
    throw new Error('供应商轮询租约已失效');
  }
}

function optionValues(parameterSource: unknown) {
  const params = Array.isArray(asRecord(parameterSource).modelParams)
    ? asRecord(parameterSource).modelParams as unknown[]
    : [];
  const result = new Map<string, string[]>();
  for (const raw of params) {
    const parameter = asRecord(raw);
    if (parameter.isEnable === false) continue;
    const field = String(parameter.paramField || '').trim();
    if (!field) continue;
    let values: unknown[] = [];
    try {
      const parsed = JSON.parse(String(parameter.paramValues || '[]'));
      values = Array.isArray(parsed) ? parsed : [];
    } catch {
      // Invalid legacy template options simply impose no additional constraint.
    }
    result.set(field, values.map((value) => String(asRecord(value).value || '').trim()).filter(Boolean));
  }
  return result;
}

function ratioFromDimensions(value: string) {
  const match = value.match(/^(\d+)x(\d+)$/i);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function intersect(preferred: string[], constraint: string[]) {
  if (!constraint.length) return preferred;
  const permitted = new Set(constraint);
  return preferred.filter((value) => permitted.has(value));
}

function choose(value: unknown, allowed: string[], fallback: string) {
  const candidate = String(value || '');
  return allowed.includes(candidate) ? candidate : allowed.includes(fallback) ? fallback : allowed[0];
}

function resolveParameters(
  profile: AiCreationModelProfileRecord,
  request: ParameterRequest,
  templateParameters?: unknown
): CreationParameters {
  const capabilities = profile.capabilities || {};
  const defaults = profile.defaults || {};
  const templateOptions = optionValues(templateParameters);
  const templateRatios = [
    ...(templateOptions.get('aspectRatio') || []).filter((value) => value !== 'auto'),
    ...(templateOptions.get('size') || []).map(ratioFromDimensions).filter((value): value is string => Boolean(value)),
  ];
  const templateTiers = [
    ...(templateOptions.get('size') || []).filter((value) => value !== 'auto'),
    ...(templateOptions.get('imageSize') || []),
  ].map((value) => value.toUpperCase());
  const profileRatios = (capabilities.aspectRatios || []) as string[];
  const profileTiers = (capabilities.resolutionTiers || []) as string[];
  const ratios = intersect(profileRatios, [...new Set(templateRatios)]);
  const tiers = intersect(profileTiers, [...new Set(templateTiers)]);
  const allowedRatios = ratios.length ? ratios : profileRatios;
  const allowedTiers = tiers.length ? tiers : profileTiers;
  const aspectRatio = choose(request.aspectRatio, allowedRatios, String(defaults.aspectRatio || '1:1'));
  const resolutionTier = choose(
    request.resolutionTier || request.size || request.quality?.toUpperCase(),
    allowedTiers,
    String(defaults.resolutionTier || defaults.size || '1K')
  ) as GrsResolutionTier;
  if (!profile.remoteModel) throw new Error('所选模型缺少可执行配置');
  resolveGrsImageParameters({
    model: profile.remoteModel,
    aspectRatio,
    resolutionTier,
    width: request.width,
    height: request.height,
    legacySize: request.size,
    legacyQuality: request.quality,
  });
  return {
    aspectRatio,
    resolutionTier,
    width: resolutionTier === 'CUSTOM' ? Number(request.width) : undefined,
    height: resolutionTier === 'CUSTOM' ? Number(request.height) : undefined,
    templateId: request.templateId,
  };
}

async function getEnabledCatalogProfile(id: bigint) {
  const profile = await withPlatformTransaction((transaction) =>
    new AiCreationModelProfileRepository(transaction).findEnabledCatalogProfile(id)
  );
  if (!profile || !profile.remoteModel || !profile.adapterType) {
    throw new Error('所选模型不可用或缺少可执行配置');
  }
  return profile;
}

export async function createPostgresCreationTask(input: {
  enterpriseId: string;
  operatorId: string;
  modelProfileId: string;
  title: string;
  prompt: string;
  referenceAssetIds?: string[];
}) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const operatorId = parsePostgresId(input.operatorId, 'operatorId');
  const modelProfileId = parsePostgresId(input.modelProfileId, 'modelProfileId');
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('请输入提示词');
  if (prompt.length > 12000) throw new Error('提示词不能超过 12000 个字符');
  await getEnabledCatalogProfile(modelProfileId);
  const referenceAssetIds = [...new Set((input.referenceAssetIds || []).map((id) => parsePostgresId(id, 'referenceAssetId')))];
  return withTenantTransaction(enterpriseId, async (transaction) => {
    const repository = new AiCreationRepository(transaction);
    if (await repository.countMediaAssets(referenceAssetIds) !== referenceAssetIds.length) {
      throw new Error('参考图不存在或无权访问');
    }
    return repository.createTask({
      enterpriseId,
      operatorId,
      modelProfileId,
      title: input.title.trim() || prompt.slice(0, 30) || '未命名创作',
      prompt,
      referenceAssetIds,
    });
  });
}

export async function preparePostgresCreationBatch(input: {
  enterpriseId: string;
  operatorId: string;
  taskId: string;
  prompt: string;
  negativePrompt?: string;
  referenceAssetIds?: string[];
  modelProfileId: string;
  parameters?: ParameterRequest;
  templateId?: string;
  count?: number;
}) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const operatorId = parsePostgresId(input.operatorId, 'operatorId');
  const taskId = parsePostgresId(input.taskId, 'taskId');
  const modelProfileId = parsePostgresId(input.modelProfileId, 'modelProfileId');
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('请输入提示词');
  if (prompt.length > 12000) throw new Error('提示词不能超过 12000 个字符');
  const count = Math.min(4, Math.max(1, Math.trunc(Number(input.count) || 1)));
  const [profile, template] = await Promise.all([
    getEnabledCatalogProfile(modelProfileId),
    input.templateId ? getActivePromptTemplate(input.templateId) : Promise.resolve(null),
  ]);
  const referenceAssetIds = [...new Set((input.referenceAssetIds || []).map((id) => parsePostgresId(id, 'referenceAssetId')))];
  const capabilities = profile.capabilities || {};
  const maxReferenceImages = Number(capabilities.maxReferenceImages || 0);
  if (referenceAssetIds.length > maxReferenceImages || (referenceAssetIds.length && !capabilities.supportsReferenceImages)) {
    throw new Error(`当前模型最多支持 ${maxReferenceImages} 张参考图`);
  }
  const parameters = resolveParameters(profile, {
    ...input.parameters,
    templateId: template?.id,
  }, template?.parameterTemplate?.parameters);
  await assertEnterpriseAiActionAllowed(enterpriseId.toString(), 'image.free_create');
  const price = await getPostgresImageModelPrice(profile.key, parameters.resolutionTier);
  const logicalModelKey = (referenceAssetIds.length
    ? profile.editLogicalModelKey
    : profile.generateLogicalModelKey) as 'image.generate.standard' | 'image.edit.standard' | null;
  if (!logicalModelKey) throw new Error('当前模型不支持参考图编辑');

  return withTenantTransaction(enterpriseId, async (transaction) => {
    const repository = new AiCreationRepository(transaction);
    const task = await repository.findTask(taskId);
    if (!task) throw new Error('创作任务不存在');
    if (await repository.countMediaAssets(referenceAssetIds) !== referenceAssetIds.length) {
      throw new Error('参考图不存在或无权访问');
    }
    const sequence = await repository.nextBatchSequence(taskId);
    const profileSnapshot = serializePostgresCatalogProfile(profile);
    const batch = await repository.createBatch({
      enterpriseId,
      operatorId,
      taskId,
      modelProfileId,
      sequence,
      prompt,
      negativePrompt: input.negativePrompt?.trim() || null,
      modelProfileSnapshot: profileSnapshot,
      parameterSnapshot: parameters,
      requestedCount: count,
      status: 'pending',
      creditsEstimate: price.credits * BigInt(count),
    }, referenceAssetIds);
    const billing = {
      cycle: 0,
      actionKey: 'image.free_create',
      price: price.credits.toString(),
      priceSnapshot: {
        actionKey: 'image.free_create',
        label: price.label,
        credits: price.credits.toString(),
        modelProfileKey: profile.key,
        remoteModel: profile.remoteModel,
        resolutionTier: parameters.resolutionTier,
        capturedAt: new Date().toISOString(),
      },
      status: 'unbilled',
    };
    const generations = await Promise.all(Array.from({ length: count }, () => repository.createGeneration({
      enterpriseId,
      operatorId,
      type: 'free_create',
      creationTaskId: taskId,
      creationBatchId: batch.id,
      creationModelProfileId: modelProfileId,
      actionKey: 'image.free_create',
      capability: referenceAssetIds.length ? 'image.edit' : 'image.generate',
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
      billing,
    })));
    await repository.updateTask(taskId, {
      prompt,
      modelProfileId,
      lastBatchId: batch.id,
      status: 'active',
    });
    return { taskId, batch, generations };
  });
}

function readPositiveBigInt(value: unknown, field: string) {
  try {
    const parsed = BigInt(String(value));
    if (parsed > BigInt(0)) return parsed;
  } catch {
    // Fall through to the domain error below.
  }
  throw new Error(`${field}必须是正整数`);
}

function derivePostgresCreationBatchStatus(statuses: string[]) {
  if (!statuses.length) return 'pending';
  const succeeded = statuses.filter((status) => status === 'succeeded').length;
  const failed = statuses.filter((status) => status === 'failed' || status === 'cancelled').length;
  if (succeeded === statuses.length) return 'succeeded';
  if (failed === statuses.length) return 'failed';
  if (succeeded + failed === statuses.length) return 'partial';
  return 'processing';
}

/**
 * Reconciles a PostgreSQL free-creation batch from its generation rows. The
 * transaction locks the batch before its ordered generations so terminal
 * settlements cannot leave a stale aggregate status behind.
 */
export async function refreshPostgresCreationBatchStatus(input: {
  enterpriseId: string;
  batchId: string;
}) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const batchId = parsePostgresId(input.batchId, 'batchId');
  return withTenantTransaction(enterpriseId, async (transaction) => {
    const creation = new AiCreationRepository(transaction);
    const batch = await creation.findBatchForUpdate(batchId);
    if (!batch) throw new Error('创作批次不存在');
    const generations = await creation.listBatchGenerationsForUpdate(batchId);
    if (generations.length !== batch.requestedCount) {
      throw new Error('创作批次生成记录不完整');
    }
    const status = derivePostgresCreationBatchStatus(generations.map((generation) => generation.status));
    if (batch.status === status) return { batch, generations, reused: true };
    const updatedBatch = await creation.updateBatch(batchId, { status });
    if (!updatedBatch) throw new Error('创作批次不存在');
    return { batch: updatedBatch, generations, reused: false };
  });
}

/**
 * Holds a prepared generation's snapshotted price and advances it to the
 * submission-ready state in one tenant transaction. Provider I/O deliberately
 * remains outside this boundary for the later execution cutover.
 */
export async function holdPostgresCreationGenerationCredits(input: {
  enterpriseId: string;
  generationId: string;
}) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const generationId = parsePostgresId(input.generationId, 'generationId');
  return withTenantTransaction(enterpriseId, async (transaction) => {
    const creation = new AiCreationRepository(transaction);
    const credits = new AiCreditRepository(transaction);
    const generation = await creation.findGeneration(generationId);
    if (!generation || generation.deletedAt || generation.type !== 'free_create') {
      throw new Error('创作生成任务不存在');
    }

    const billing = asRecord(generation.billing);
    const billingStatus = String(billing.status || '');
    const account = await credits.ensureAccount(enterpriseId);
    if (billingStatus === 'held' || billingStatus === 'consumed') {
      return { generation, account, ledger: null };
    }
    if (billingStatus && billingStatus !== 'unbilled') {
      throw new Error('创作生成任务的点数状态无法冻结');
    }

    const amount = readPositiveBigInt(billing.price, '创作生成任务点数价格');
    const cycle = Math.max(0, Math.trunc(Number(billing.cycle ?? generation.retryCount ?? 0)) || 0);
    const operationId = `${generation.id}:hold:${cycle}`;
    const claim = await credits.claimLedger({
      enterpriseId,
      generationId,
      operatorId: generation.operatorId,
      operationId,
      type: 'hold',
      amount,
      note: 'AI free-creation generation hold',
      metadata: { creationBatchId: generation.creationBatchId?.toString() },
    });

    let nextAccount = account;
    if (claim.claimed) {
      const updatedAccount = await credits.applyBalance({
        enterpriseId,
        balanceDelta: BigInt(0),
        frozenDelta: amount,
        requireAvailableAtLeast: amount,
      });
      if (!updatedAccount) {
        await credits.failLedger(claim.ledger.id);
        const error = new Error('当前企业 AI 点数不足，请联系平台管理员调整。');
        Object.assign(error, { status: 402 });
        throw error;
      }
      const completedLedger = await credits.completeLedger(claim.ledger.id, updatedAccount);
      if (!completedLedger) throw new Error('AI 点数流水无法完成');
      nextAccount = updatedAccount;
    } else {
      if (claim.ledger.enterpriseId !== enterpriseId || claim.ledger.status !== 'completed') {
        throw new Error('创作生成任务的点数冻结未完成');
      }
      const currentAccount = await credits.findAccount(enterpriseId);
      if (!currentAccount) throw new Error('AI 点数账户不存在');
      nextAccount = currentAccount;
    }

    const updatedGeneration = await creation.updateGeneration(generationId, {
      status: 'created',
      billing: {
        ...billing,
        cycle,
        status: 'held',
        holdOperationId: operationId,
      },
    });
    if (!updatedGeneration) throw new Error('创作生成任务不存在');
    return { generation: updatedGeneration, account: nextAccount, ledger: claim.ledger };
  });
}

async function releasePostgresCreationGenerationCreditsInTransaction(input: {
  transaction: PostgresTransaction;
  enterpriseId: bigint;
  generation: AiGenerationRecord;
  errorCode: string;
  errorMessage: string;
  externalTask?: Record<string, unknown>;
}) {
  const creation = new AiCreationRepository(input.transaction);
  const credits = new AiCreditRepository(input.transaction);
  const { enterpriseId, generation, errorCode, errorMessage } = input;
  const billing = asRecord(generation.billing);
  const billingStatus = String(billing.status || '');
  const account = await credits.ensureAccount(enterpriseId);
  if (billingStatus === 'released') {
    return { generation, account, ledger: null };
  }
  if (billingStatus !== 'held') throw new Error('创作生成任务没有可释放的冻结点数');

    const amount = readPositiveBigInt(billing.price, '创作生成任务点数价格');
    const cycle = Math.max(0, Math.trunc(Number(billing.cycle ?? generation.retryCount ?? 0)) || 0);
    const operationId = `${generation.id}:release:${cycle}`;
    const claim = await credits.claimLedger({
      enterpriseId,
      generationId: generation.id,
      operatorId: generation.operatorId,
      operationId,
      type: 'release',
      amount,
      note: errorMessage,
      metadata: { creationBatchId: generation.creationBatchId?.toString() },
    });
    let nextAccount = account;
    if (claim.claimed) {
      const updatedAccount = await credits.applyBalance({
        enterpriseId,
        balanceDelta: BigInt(0),
        frozenDelta: -amount,
        requireFrozenAtLeast: amount,
      });
      if (!updatedAccount) {
        await credits.failLedger(claim.ledger.id);
        throw new Error('创作生成任务的冻结点数记录不一致');
      }
      const completedLedger = await credits.completeLedger(claim.ledger.id, updatedAccount);
      if (!completedLedger) throw new Error('AI 点数流水无法完成');
      nextAccount = updatedAccount;
    } else {
      if (claim.ledger.enterpriseId !== enterpriseId || claim.ledger.status !== 'completed') {
        throw new Error('创作生成任务的点数释放未完成');
      }
      const currentAccount = await credits.findAccount(enterpriseId);
      if (!currentAccount) throw new Error('AI 点数账户不存在');
      nextAccount = currentAccount;
    }
    const updatedGeneration = await creation.updateGeneration(generation.id, {
      status: 'failed',
      errorCode,
      errorMessage,
      billing: { ...billing, cycle, status: 'released', releaseOperationId: operationId },
      ...(input.externalTask ? { externalTask: input.externalTask } : {}),
    });
    if (!updatedGeneration) throw new Error('创作生成任务不存在');
    return { generation: updatedGeneration, account: nextAccount, ledger: claim.ledger };
}

export async function releasePostgresCreationGenerationCredits(input: {
  enterpriseId: string;
  generationId: string;
  errorCode?: string;
  errorMessage: string;
}) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const generationId = parsePostgresId(input.generationId, 'generationId');
  const errorMessage = input.errorMessage.trim() || '创作生成任务已取消';
  return withTenantTransaction(enterpriseId, async (transaction) => {
    const creation = new AiCreationRepository(transaction);
    const generation = await creation.findGenerationForUpdate(generationId);
    if (!generation || generation.deletedAt || generation.type !== 'free_create') {
      throw new Error('创作生成任务不存在');
    }
    return releasePostgresCreationGenerationCreditsInTransaction({
      transaction,
      enterpriseId,
      generation,
      errorCode: input.errorCode?.trim() || 'GENERATION_CANCELLED',
      errorMessage,
    });
  });
}

async function consumePostgresCreationGenerationCreditsInTransaction(input: {
  transaction: PostgresTransaction;
  enterpriseId: bigint;
  generation: AiGenerationRecord;
}) {
  const creation = new AiCreationRepository(input.transaction);
  const credits = new AiCreditRepository(input.transaction);
  const { enterpriseId, generation } = input;
  const billing = asRecord(generation.billing);
  const billingStatus = String(billing.status || '');
  const account = await credits.ensureAccount(enterpriseId);
  if (billingStatus === 'consumed') {
    return { generation, account, ledger: null };
  }
  if (generation.status !== 'succeeded' || billingStatus !== 'held') {
    throw new Error('创作生成任务尚未成功，无法扣除冻结点数');
  }

  const amount = readPositiveBigInt(billing.price, '创作生成任务点数价格');
  const cycle = Math.max(0, Math.trunc(Number(billing.cycle ?? generation.retryCount ?? 0)) || 0);
  const operationId = `${generation.id}:consume:${cycle}`;
  const claim = await credits.claimLedger({
    enterpriseId,
    generationId: generation.id,
    operatorId: generation.operatorId,
    operationId,
    type: 'consume',
    amount: -amount,
    note: 'AI free-creation generation consumed',
    metadata: { creationBatchId: generation.creationBatchId?.toString() },
  });
  let nextAccount = account;
  if (claim.claimed) {
    const updatedAccount = await credits.applyBalance({
      enterpriseId,
      balanceDelta: -amount,
      frozenDelta: -amount,
      requireBalanceAtLeast: amount,
      requireFrozenAtLeast: amount,
    });
    if (!updatedAccount) {
      await credits.failLedger(claim.ledger.id);
      throw new Error('创作生成任务的冻结点数记录不一致');
    }
    const completedLedger = await credits.completeLedger(claim.ledger.id, updatedAccount);
    if (!completedLedger) throw new Error('AI 点数流水无法完成');
    nextAccount = updatedAccount;
  } else {
    if (claim.ledger.enterpriseId !== enterpriseId || claim.ledger.status !== 'completed') {
      throw new Error('创作生成任务的点数扣除未完成');
    }
    const currentAccount = await credits.findAccount(enterpriseId);
    if (!currentAccount) throw new Error('AI 点数账户不存在');
    nextAccount = currentAccount;
  }
  const updatedGeneration = await creation.updateGeneration(generation.id, {
    billing: { ...billing, cycle, status: 'consumed', consumeOperationId: operationId },
  });
  if (!updatedGeneration) throw new Error('创作生成任务不存在');
  return { generation: updatedGeneration, account: nextAccount, ledger: claim.ledger };
}

export async function consumePostgresCreationGenerationCredits(input: {
  enterpriseId: string;
  generationId: string;
}) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const generationId = parsePostgresId(input.generationId, 'generationId');
  return withTenantTransaction(enterpriseId, async (transaction) => {
    const generation = await new AiCreationRepository(transaction).findGenerationForUpdate(generationId);
    if (!generation || generation.deletedAt || generation.type !== 'free_create') {
      throw new Error('创作生成任务不存在');
    }
    return consumePostgresCreationGenerationCreditsInTransaction({ transaction, enterpriseId, generation });
  });
}

function isImageLogicalModelKey(value: unknown): value is 'image.generate.standard' | 'image.edit.standard' {
  return value === 'image.generate.standard' || value === 'image.edit.standard';
}

/**
 * Claims an already-funded PostgreSQL generation for a provider submission.
 * The caller performs provider network I/O after this short transaction, using
 * the persisted request snapshot and attempt ID for later reconciliation.
 */
export async function beginPostgresCreationProviderAttempt(input: {
  enterpriseId: string;
  generationId: string;
  providerConfigId: string;
  providerKey: string;
  adapterType: string;
  remoteModel: string;
  requestSnapshot: Record<string, unknown>;
  estimatedCost?: Record<string, unknown>;
}) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const generationId = parsePostgresId(input.generationId, 'generationId');
  const providerConfigId = parsePostgresId(input.providerConfigId, 'providerConfigId');
  const providerKey = input.providerKey.trim();
  const adapterType = input.adapterType.trim();
  const remoteModel = input.remoteModel.trim();
  if (!providerKey || !adapterType || !remoteModel) throw new Error('供应商尝试缺少执行配置');

  return withTenantTransaction(enterpriseId, async (transaction) => {
    const creation = new AiCreationRepository(transaction);
    const generation = await creation.findGeneration(generationId);
    if (!generation || generation.deletedAt || generation.type !== 'free_create') {
      throw new Error('创作生成任务不存在');
    }
    if (generation.status === 'processing' && generation.currentAttemptId) {
      const currentAttempt = await creation.findProviderAttempt(generation.currentAttemptId);
      if (currentAttempt && ['created', 'submitted', 'processing', 'unknown'].includes(currentAttempt.status)) {
        return { generation, attempt: currentAttempt, reused: true };
      }
    }
    if (generation.status !== 'created' || String(asRecord(generation.billing).status) !== 'held') {
      throw new Error('创作生成任务尚未完成点数冻结');
    }

    const logicalModelKey = generation.logicalModelKey;
    if (!isImageLogicalModelKey(logicalModelKey)) throw new Error('创作生成任务缺少图片模型能力');
    const parameterSnapshot = asRecord(asRecord(generation.input).creationParameterSnapshot);
    if (String(parameterSnapshot.remoteModel || '') !== remoteModel) {
      throw new Error('供应商模型与创作价格快照不一致');
    }
    const resolutionTier = String(parameterSnapshot.resolutionTier || '').trim() || null;
    const attempt = await creation.createProviderAttempt({
      enterpriseId,
      generationId,
      providerConfigId,
      providerKey,
      adapterType,
      capability: capabilityForLogicalModel(logicalModelKey as AiLogicalModelKey),
      logicalModelKey,
      remoteModel,
      resolutionTier,
      status: 'created',
      accepted: false,
      estimatedCost: input.estimatedCost,
      requestFingerprint: crypto.createHash('sha256').update(JSON.stringify(input.requestSnapshot)).digest('hex'),
      metadata: { modelProfileKey: parameterSnapshot.modelProfileKey },
    });
    const updatedGeneration = await creation.updateGeneration(generationId, {
      status: 'processing',
      provider: providerKey,
      capability: capabilityForLogicalModel(logicalModelKey as AiLogicalModelKey),
      logicalModelKey,
      currentAttemptId: attempt.id,
      input: {
        ...asRecord(generation.input),
        providerRequest: input.requestSnapshot,
      },
    });
    if (!updatedGeneration) throw new Error('创作生成任务不存在');
    return { generation: updatedGeneration, attempt, reused: false };
  });
}

/**
 * Persists the accepted asynchronous provider submission before polling starts.
 * A response may be delivered more than once, but it must always identify the
 * same remote task as the attempt that originally claimed the generation.
 */
export async function acknowledgePostgresCreationProviderAttempt(input: {
  enterpriseId: string;
  generationId: string;
  attemptId: string;
  remoteTaskId: string;
  remoteStatus?: string;
  status?: 'processing' | 'unknown';
  errorMessage?: string;
  nextPollAfterMs?: number;
}) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const generationId = parsePostgresId(input.generationId, 'generationId');
  const attemptId = parsePostgresId(input.attemptId, 'attemptId');
  const remoteTaskId = input.remoteTaskId.trim();
  if (!remoteTaskId) throw new Error('供应商提交响应缺少远端任务 ID');
  const status = input.status || 'processing';
  const remoteStatus = input.remoteStatus?.trim() || status;
  const pollDelay = Math.min(
    300_000,
    Math.max(1_000, Math.trunc(Number(input.nextPollAfterMs) || (status === 'unknown' ? 30_000 : 2_500)))
  );

  return withTenantTransaction(enterpriseId, async (transaction) => {
    const creation = new AiCreationRepository(transaction);
    const generation = await creation.findGenerationForUpdate(generationId);
    if (!generation || generation.deletedAt || generation.type !== 'free_create') {
      throw new Error('创作生成任务不存在');
    }
    if (generation.currentAttemptId !== attemptId || generation.status !== 'processing') {
      throw new Error('供应商提交响应不属于当前创作生成任务');
    }
    const attempt = await creation.findProviderAttempt(attemptId);
    if (!attempt || attempt.generationId !== generationId) {
      throw new Error('供应商尝试不存在或不属于当前创作生成任务');
    }
    if (attempt.remoteTaskId) {
      if (attempt.remoteTaskId !== remoteTaskId) {
        throw new Error('供应商提交响应的远端任务 ID 与已记录任务不一致');
      }
      return { generation, attempt, reused: true };
    }
    if (!['created', 'submitted', 'processing', 'unknown'].includes(attempt.status)) {
      throw new Error('供应商尝试已结束，无法记录提交响应');
    }

    const nextPollAt = new Date(Date.now() + pollDelay).toISOString();
    const errorMessage = status === 'unknown'
      ? input.errorMessage?.trim() || '供应商提交状态暂时未知'
      : null;
    const updatedAttempt = await creation.updateProviderAttempt(attemptId, {
      status,
      accepted: true,
      remoteTaskId,
      remoteStatus,
      errorCode: status === 'unknown' ? 'PROVIDER_STATUS_UNKNOWN' : null,
      errorMessage,
    });
    const updatedGeneration = await creation.updateGeneration(generationId, {
      externalTask: {
        status,
        remoteTaskId,
        remoteStatus,
        nextPollAt,
        lastPolledAt: new Date().toISOString(),
      },
      errorCode: status === 'unknown' ? 'PROVIDER_STATUS_UNKNOWN' : null,
      errorMessage,
    });
    if (!updatedAttempt || !updatedGeneration) throw new Error('供应商提交响应无法持久化');
    return { generation: updatedGeneration, attempt: updatedAttempt, reused: false };
  });
}

/**
 * Claims due provider polls in a short transaction, leaving network I/O to the
 * caller after commit. The lease prevents another worker from polling the same
 * accepted task until it expires or a guarded state update releases it.
 */
export async function claimPostgresCreationProviderPolls(input: {
  enterpriseId?: string;
  limit?: number;
  leaseMs?: number;
} = {}) {
  const enterpriseId = input.enterpriseId
    ? parsePostgresId(input.enterpriseId, 'enterpriseId')
    : undefined;
  const limit = Math.min(100, Math.max(1, Math.trunc(Number(input.limit) || 20)));
  const leaseMs = Math.min(
    300_000,
    Math.max(30_000, Math.trunc(Number(input.leaseMs) || 60_000))
  );
  const claimedAt = new Date();
  const leaseExpiresAt = new Date(claimedAt.getTime() + leaseMs);

  return withPlatformTransaction(async (transaction) => {
    const creation = new AiCreationRepository(transaction);
    const due = await creation.claimDueProviderPollGenerations({
      now: claimedAt,
      limit,
      enterpriseId,
    });
    const claims = [];
    for (const generation of due) {
      if (!generation.currentAttemptId) {
        throw new Error('供应商轮询任务缺少当前尝试');
      }
      const attempt = await creation.findProviderAttempt(generation.currentAttemptId);
      if (
        !attempt
        || attempt.generationId !== generation.id
        || attempt.enterpriseId !== generation.enterpriseId
        || !attempt.accepted
        || !attempt.remoteTaskId
        || !['submitted', 'processing', 'unknown'].includes(attempt.status)
      ) {
        throw new Error('供应商轮询任务的当前尝试无效');
      }
      const pollLeaseId = crypto.randomUUID();
      const updatedGeneration = await creation.updateGeneration(generation.id, {
        externalTask: {
          ...withoutPostgresProviderPollLease(generation.externalTask),
          pollLeaseId,
          pollLeaseExpiresAt: leaseExpiresAt.toISOString(),
          pollClaimedAt: claimedAt.toISOString(),
          nextPollAt: leaseExpiresAt.toISOString(),
        },
      });
      if (!updatedGeneration) {
        throw new Error('供应商轮询任务认领未能持久化');
      }
      claims.push({
        enterpriseId: updatedGeneration.enterpriseId.toString(),
        generationId: updatedGeneration.id.toString(),
        attemptId: attempt.id.toString(),
        remoteTaskId: attempt.remoteTaskId,
        providerKey: attempt.providerKey,
        adapterType: attempt.adapterType,
        remoteModel: attempt.remoteModel,
        pollLeaseId,
        leaseExpiresAt: leaseExpiresAt.toISOString(),
      });
    }
    return claims;
  });
}

/**
 * Records a non-terminal poll response for an already accepted asynchronous
 * task. Media persistence and terminal success/failure settlement remain in a
 * later execution boundary.
 */
export async function recordPostgresCreationProviderPollState(input: {
  enterpriseId: string;
  generationId: string;
  attemptId: string;
  remoteTaskId: string;
  status: 'processing' | 'unknown';
  remoteStatus?: string;
  errorMessage?: string;
  nextPollAfterMs?: number;
  pollLeaseId?: string;
}) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const generationId = parsePostgresId(input.generationId, 'generationId');
  const attemptId = parsePostgresId(input.attemptId, 'attemptId');
  const remoteTaskId = input.remoteTaskId.trim();
  if (!remoteTaskId) throw new Error('供应商轮询响应缺少远端任务 ID');
  const remoteStatus = input.remoteStatus?.trim() || input.status;
  const pollDelay = Math.min(
    300_000,
    Math.max(1_000, Math.trunc(Number(input.nextPollAfterMs) || (input.status === 'unknown' ? 30_000 : 2_500)))
  );

  return withTenantTransaction(enterpriseId, async (transaction) => {
    const creation = new AiCreationRepository(transaction);
    const generation = await creation.findGenerationForUpdate(generationId);
    if (!generation || generation.deletedAt || generation.type !== 'free_create') {
      throw new Error('创作生成任务不存在');
    }
    if (generation.currentAttemptId !== attemptId || generation.status !== 'processing') {
      throw new Error('供应商轮询响应不属于当前创作生成任务');
    }
    assertPostgresProviderPollLease(generation, input.pollLeaseId);
    const attempt = await creation.findProviderAttempt(attemptId);
    if (!attempt || attempt.generationId !== generationId || attempt.remoteTaskId !== remoteTaskId) {
      throw new Error('供应商轮询响应的远端任务 ID 与当前尝试不一致');
    }
    if (!['submitted', 'processing', 'unknown'].includes(attempt.status) || !attempt.accepted) {
      throw new Error('供应商尝试尚未受理或已结束，无法记录轮询响应');
    }

    const nextPollAt = new Date(Date.now() + pollDelay).toISOString();
    const errorMessage = input.status === 'unknown'
      ? input.errorMessage?.trim() || '供应商轮询状态暂时未知'
      : null;
    const durationMs = Math.max(0, Date.now() - attempt.createdAt.getTime());
    const updatedAttempt = await creation.updateProviderAttempt(attemptId, {
      status: input.status,
      accepted: true,
      remoteStatus,
      durationMs,
      errorCode: input.status === 'unknown' ? 'PROVIDER_STATUS_UNKNOWN' : null,
      errorMessage,
    });
    const updatedGeneration = await creation.updateGeneration(generationId, {
      externalTask: {
        status: input.status,
        remoteTaskId,
        remoteStatus,
        nextPollAt,
        lastPolledAt: new Date().toISOString(),
      },
      errorCode: input.status === 'unknown' ? 'PROVIDER_STATUS_UNKNOWN' : null,
      errorMessage,
    });
    if (!updatedAttempt || !updatedGeneration) throw new Error('供应商轮询响应无法持久化');
    return { generation: updatedGeneration, attempt: updatedAttempt };
  });
}

/**
 * Records a terminal provider success before result-media persistence. The
 * persisted output snapshot makes the held generation eligible for the
 * separate, idempotent credit-consumption boundary.
 */
export async function completePostgresCreationProviderAttempt(input: {
  enterpriseId: string;
  generationId: string;
  attemptId: string;
  remoteTaskId: string;
  remoteStatus?: string;
  output?: Record<string, unknown>;
  actualCost?: Record<string, unknown>;
  pollLeaseId?: string;
}) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const generationId = parsePostgresId(input.generationId, 'generationId');
  const attemptId = parsePostgresId(input.attemptId, 'attemptId');
  const remoteTaskId = input.remoteTaskId.trim();
  if (!remoteTaskId) throw new Error('供应商成功响应缺少远端任务 ID');
  const remoteStatus = input.remoteStatus?.trim() || 'succeeded';

  return withTenantTransaction(enterpriseId, async (transaction) => {
    const creation = new AiCreationRepository(transaction);
    const generation = await creation.findGenerationForUpdate(generationId);
    if (!generation || generation.deletedAt || generation.type !== 'free_create') {
      throw new Error('创作生成任务不存在');
    }
    if (generation.currentAttemptId !== attemptId) {
      throw new Error('供应商成功响应不属于当前创作生成任务');
    }
    const attempt = await creation.findProviderAttempt(attemptId);
    if (!attempt || attempt.generationId !== generationId || attempt.remoteTaskId !== remoteTaskId) {
      throw new Error('供应商成功响应的远端任务 ID 与当前尝试不一致');
    }
    if (generation.status === 'succeeded' && attempt.status === 'succeeded') {
      return { generation, attempt, reused: true };
    }
    assertPostgresProviderPollLease(generation, input.pollLeaseId);
    if (generation.status !== 'processing' || !attempt.accepted || !['submitted', 'processing', 'unknown'].includes(attempt.status)) {
      throw new Error('供应商尝试尚未受理或已结束，无法记录成功响应');
    }

    const completedAt = new Date();
    const durationMs = Math.max(0, completedAt.getTime() - attempt.createdAt.getTime());
    const updatedAttempt = await creation.updateProviderAttempt(attemptId, {
      status: 'succeeded',
      accepted: true,
      remoteStatus,
      actualCost: input.actualCost ?? attempt.actualCost,
      durationMs,
      errorCode: null,
      errorMessage: null,
    });
    const updatedGeneration = await creation.updateGeneration(generationId, {
      status: 'succeeded',
      output: {
        ...asRecord(generation.output),
        providerResult: input.output ?? {},
      },
      externalTask: {
        ...withoutPostgresProviderPollLease(generation.externalTask),
        status: 'succeeded',
        remoteTaskId,
        remoteStatus,
        lastPolledAt: completedAt.toISOString(),
        completedAt: completedAt.toISOString(),
      },
      errorCode: null,
      errorMessage: null,
      durationMs,
    });
    if (!updatedAttempt || !updatedGeneration) throw new Error('供应商成功响应无法持久化');
    return { generation: updatedGeneration, attempt: updatedAttempt, reused: false };
  });
}

/**
 * Attaches an already-persisted provider result asset to a terminal success.
 * Storage I/O stays outside the transaction; this boundary only validates and
 * atomically binds tenant-scoped PostgreSQL metadata.
 */
export async function attachPostgresCreationProviderResultAsset(input: {
  enterpriseId: string;
  generationId: string;
  attemptId: string;
  remoteTaskId: string;
  assetId: string;
}) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const generationId = parsePostgresId(input.generationId, 'generationId');
  const attemptId = parsePostgresId(input.attemptId, 'attemptId');
  const assetId = parsePostgresId(input.assetId, 'assetId');
  const remoteTaskId = input.remoteTaskId.trim();
  if (!remoteTaskId) throw new Error('供应商结果媒体缺少远端任务 ID');

  return withTenantTransaction(enterpriseId, async (transaction) => {
    const creation = new AiCreationRepository(transaction);
    const generation = await creation.findGenerationForUpdate(generationId);
    if (!generation || generation.deletedAt || generation.type !== 'free_create') {
      throw new Error('创作生成任务不存在');
    }
    if (generation.currentAttemptId !== attemptId || generation.status !== 'succeeded') {
      throw new Error('供应商结果媒体不属于已成功的当前创作生成任务');
    }
    const attempt = await creation.findProviderAttempt(attemptId);
    if (
      !attempt
      || attempt.generationId !== generationId
      || attempt.remoteTaskId !== remoteTaskId
      || attempt.status !== 'succeeded'
      || !attempt.accepted
    ) {
      throw new Error('供应商结果媒体的远端任务 ID 与当前尝试不一致');
    }
    const asset = await creation.findMediaAssetForUpdate(assetId);
    if (!asset || asset.ownerType !== 'ai_generation_output') {
      throw new Error('供应商结果媒体不存在或不可关联');
    }
    if (asset.ownerId && asset.ownerId !== generationId) {
      throw new Error('供应商结果媒体已属于另一生成任务');
    }

    const imageUrl = getPostgresMediaAssetImageUrl(asset.id);
    const output = asRecord(generation.output);
    if (typeof output.imageUrl === 'string' && output.imageUrl) {
      if (output.imageUrl === imageUrl) return { generation, asset, reused: true };
      throw new Error('创作生成任务已关联另一结果媒体');
    }

    const updatedAsset = asset.ownerId
      ? asset
      : await creation.updateMediaAsset(assetId, { ownerId: generationId });
    const updatedGeneration = await creation.updateGeneration(generationId, {
      output: { ...output, imageUrl },
    });
    if (!updatedAsset || !updatedGeneration) throw new Error('供应商结果媒体无法持久化关联');
    return { generation: updatedGeneration, asset: updatedAsset, reused: false };
  });
}

/**
 * Finalizes a persisted provider result after its storage I/O has completed.
 * It binds the tenant-owned output asset and consumes the held price in one
 * short RLS transaction, so a visible PostgreSQL result cannot be left with an
 * unclaimed successful charge. Workflow attachment stays explicit user action.
 */
export async function settlePostgresCreationProviderResult(input: {
  enterpriseId: string;
  generationId: string;
  attemptId: string;
  remoteTaskId: string;
  assetId: string;
}) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const generationId = parsePostgresId(input.generationId, 'generationId');
  const attemptId = parsePostgresId(input.attemptId, 'attemptId');
  const assetId = parsePostgresId(input.assetId, 'assetId');
  const remoteTaskId = input.remoteTaskId.trim();
  if (!remoteTaskId) throw new Error('供应商结果结算缺少远端任务 ID');

  return withTenantTransaction(enterpriseId, async (transaction) => {
    const creation = new AiCreationRepository(transaction);
    const generation = await creation.findGenerationForUpdate(generationId);
    if (!generation || generation.deletedAt || generation.type !== 'free_create') {
      throw new Error('创作生成任务不存在');
    }
    if (generation.currentAttemptId !== attemptId || generation.status !== 'succeeded') {
      throw new Error('供应商结果结算不属于已成功的当前创作生成任务');
    }
    const attempt = await creation.findProviderAttempt(attemptId);
    if (
      !attempt
      || attempt.generationId !== generationId
      || attempt.remoteTaskId !== remoteTaskId
      || attempt.status !== 'succeeded'
      || !attempt.accepted
    ) {
      throw new Error('供应商结果结算的远端任务 ID 与当前尝试不一致');
    }
    const asset = await creation.findMediaAssetForUpdate(assetId);
    if (!asset || asset.ownerType !== 'ai_generation_output') {
      throw new Error('供应商结果媒体不存在或不可关联');
    }
    if (asset.ownerId && asset.ownerId !== generationId) {
      throw new Error('供应商结果媒体已属于另一生成任务');
    }

    const imageUrl = getPostgresMediaAssetImageUrl(asset.id);
    const output = asRecord(generation.output);
    const hasAttachedResult = typeof output.imageUrl === 'string' && output.imageUrl.length > 0;
    if (hasAttachedResult && output.imageUrl !== imageUrl) {
      throw new Error('创作生成任务已关联另一结果媒体');
    }
    if (hasAttachedResult && asset.ownerId !== generationId) {
      throw new Error('创作生成任务的结果媒体归属不一致');
    }

    const updatedAsset = asset.ownerId
      ? asset
      : await creation.updateMediaAsset(assetId, { ownerId: generationId });
    const attachedGeneration = hasAttachedResult
      ? generation
      : await creation.updateGeneration(generationId, {
        output: { ...output, imageUrl },
      });
    if (!updatedAsset || !attachedGeneration) {
      throw new Error('供应商结果媒体无法持久化关联');
    }

    const billingStatus = String(asRecord(attachedGeneration.billing).status || '');
    const consumed = await consumePostgresCreationGenerationCreditsInTransaction({
      transaction,
      enterpriseId,
      generation: attachedGeneration,
    });
    return {
      ...consumed,
      asset: updatedAsset,
      reused: hasAttachedResult && billingStatus === 'consumed',
    };
  });
}

/**
 * Settles a terminal provider failure and releases the held generation credit
 * in one tenant transaction. Network polling remains outside this boundary.
 */
export async function failPostgresCreationProviderAttempt(input: {
  enterpriseId: string;
  generationId: string;
  attemptId: string;
  remoteTaskId: string;
  remoteStatus?: string;
  errorCode?: string;
  errorMessage?: string;
  actualCost?: Record<string, unknown>;
  pollLeaseId?: string;
}) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const generationId = parsePostgresId(input.generationId, 'generationId');
  const attemptId = parsePostgresId(input.attemptId, 'attemptId');
  const remoteTaskId = input.remoteTaskId.trim();
  if (!remoteTaskId) throw new Error('供应商失败响应缺少远端任务 ID');
  const remoteStatus = input.remoteStatus?.trim() || 'failed';
  const errorCode = input.errorCode?.trim() || 'PROVIDER_TASK_FAILED';
  const errorMessage = input.errorMessage?.trim() || '供应商任务执行失败';

  return withTenantTransaction(enterpriseId, async (transaction) => {
    const creation = new AiCreationRepository(transaction);
    const generation = await creation.findGenerationForUpdate(generationId);
    if (!generation || generation.deletedAt || generation.type !== 'free_create') {
      throw new Error('创作生成任务不存在');
    }
    if (generation.currentAttemptId !== attemptId) {
      throw new Error('供应商失败响应不属于当前创作生成任务');
    }
    const attempt = await creation.findProviderAttempt(attemptId);
    if (!attempt || attempt.generationId !== generationId || attempt.remoteTaskId !== remoteTaskId) {
      throw new Error('供应商失败响应的远端任务 ID 与当前尝试不一致');
    }

    const billingStatus = String(asRecord(generation.billing).status || '');
    if (generation.status === 'failed' && attempt.status === 'failed' && billingStatus === 'released') {
      const released = await releasePostgresCreationGenerationCreditsInTransaction({
        transaction,
        enterpriseId,
        generation,
        errorCode,
        errorMessage,
      });
      return { ...released, attempt, reused: true };
    }
    assertPostgresProviderPollLease(generation, input.pollLeaseId);
    if (
      generation.status !== 'processing'
      || !attempt.accepted
      || !['submitted', 'processing', 'unknown'].includes(attempt.status)
    ) {
      throw new Error('供应商尝试尚未受理或已结束，无法记录失败响应');
    }

    const completedAt = new Date();
    const durationMs = Math.max(0, completedAt.getTime() - attempt.createdAt.getTime());
    const updatedAttempt = await creation.updateProviderAttempt(attemptId, {
      status: 'failed',
      accepted: true,
      remoteStatus,
      actualCost: input.actualCost ?? attempt.actualCost,
      durationMs,
      errorCode,
      errorMessage,
    });
    if (!updatedAttempt) throw new Error('供应商失败响应无法持久化');
    const released = await releasePostgresCreationGenerationCreditsInTransaction({
      transaction,
      enterpriseId,
      generation,
      errorCode,
      errorMessage,
      externalTask: {
        status: 'failed',
        remoteTaskId,
        remoteStatus,
        lastPolledAt: completedAt.toISOString(),
        completedAt: completedAt.toISOString(),
      },
    });
    return { ...released, attempt: updatedAttempt, reused: false };
  });
}
