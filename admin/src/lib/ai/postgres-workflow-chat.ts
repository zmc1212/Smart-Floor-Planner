import crypto from 'node:crypto';
import { AiCreationRepository } from '@/db/repositories/ai-creation-repository';
import { withTenantTransaction } from '@/db/transaction';
import { resolveProviderCostEstimate } from '@/lib/ai/provider-cost';
import { getAiProviderAdapter, listProviderRuntimes } from '@/lib/ai/provider-registry';
import {
  getPlatformLlmOverrideRuntime,
  isPlatformLlmOverrideModelKey,
} from '@/lib/platform-llm-config';
import {
  capabilityForLogicalModel,
  AiProviderError,
  isSafeProviderFallback,
  type AiChatMessage,
  type AiLogicalModelKey,
} from '@/lib/ai/provider-types';

type WorkflowChatModelKey = Extract<AiLogicalModelKey, 'chat.general' | 'vision.reference_analysis'>;

function requestFingerprint(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Runs a synchronous workflow chat call while preserving the PostgreSQL provider
 * attempt audit used by image generations. The caller owns the generation state.
 */
export async function executePostgresWorkflowChat(input: {
  enterpriseId: bigint;
  generationId: bigint;
  logicalModelKey: WorkflowChatModelKey;
  messages: AiChatMessage[];
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
}) {
  const capability = capabilityForLogicalModel(input.logicalModelKey);
  const llmOverride = isPlatformLlmOverrideModelKey(input.logicalModelKey)
    ? await getPlatformLlmOverrideRuntime()
    : null;
  const runtimes = llmOverride
    ? [llmOverride]
    : await listProviderRuntimes(capability, input.logicalModelKey);
  if (!runtimes.length) throw new Error(`没有可用的 AI 供应商支持 ${input.logicalModelKey}`);

  let lastError: unknown;
  for (const runtime of runtimes) {
    const remoteModel = runtime.modelMappings[input.logicalModelKey];
    if (!remoteModel) continue;
    const startedAt = Date.now();
    const attempt = await withTenantTransaction(input.enterpriseId, (transaction) =>
      new AiCreationRepository(transaction).createProviderAttempt({
        enterpriseId: input.enterpriseId,
        generationId: input.generationId,
        providerConfigId: BigInt(runtime.id),
        providerKey: runtime.key,
        adapterType: runtime.adapterType,
        capability,
        logicalModelKey: input.logicalModelKey,
        remoteModel,
        status: 'created',
        accepted: false,
        estimatedCost: resolveProviderCostEstimate(runtime, input.logicalModelKey, remoteModel),
        requestFingerprint: requestFingerprint(input.messages),
        metadata: input.metadata,
      })
    );

    try {
      const content = await getAiProviderAdapter(runtime.adapterType).chat(runtime, {
        model: remoteModel,
        messages: input.messages,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
      });
      await withTenantTransaction(input.enterpriseId, (transaction) =>
        new AiCreationRepository(transaction).updateProviderAttempt(attempt.id, {
          status: 'succeeded',
          accepted: true,
          actualCost: resolveProviderCostEstimate(runtime, input.logicalModelKey, remoteModel),
          durationMs: Date.now() - startedAt,
        })
      );
      return { content, provider: runtime.key, model: remoteModel, attemptId: attempt.id };
    } catch (error) {
      lastError = error;
      const safeFallback = isSafeProviderFallback(error);
      await withTenantTransaction(input.enterpriseId, (transaction) =>
        new AiCreationRepository(transaction).updateProviderAttempt(attempt.id, {
          status: safeFallback ? 'failed' : 'unknown',
          accepted: !safeFallback,
          errorCode: error instanceof AiProviderError ? error.code : 'PROVIDER_ERROR',
          errorMessage: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startedAt,
        })
      );
      if (!safeFallback) throw error;
    }
  }

  throw lastError || new Error('所有 AI 供应商均不可用');
}
