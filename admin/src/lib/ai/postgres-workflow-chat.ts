import crypto from 'node:crypto';
import { executeAgentChat } from './providers/agent-chat';
import type { ModelTurnInput } from '@/lib/assistant/contracts/model';
import type { AgentConfig } from '@/lib/assistant/agent/config';
import type { InvocationOwner } from '@/lib/assistant/contracts';
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
export async function executePostgresText(input: {
  enterpriseId: bigint;
  owner: InvocationOwner;
  logicalModelKey: WorkflowChatModelKey;
  messages: AiChatMessage[];
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
  beforeProviderCall?: () => Promise<void>;
  agent?: { config: AgentConfig; input: Omit<ModelTurnInput, 'model' | 'enableThinking'> };
}) {
  if (input.owner.kind === 'knowledge_job') {
    throw new Error('Knowledge job invocation is unavailable until the knowledge domain is installed');
  }
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
    // Deployment-only assistant override. Never change the shared generation model
    // or silently fall back to a reasoning model after an ambiguous invocation.
    const remoteModel = input.owner.kind === 'assistant_run' && process.env.ASSISTANT_TEXT_MODEL?.trim()
      ? process.env.ASSISTANT_TEXT_MODEL.trim() : runtime.modelMappings[input.logicalModelKey];
    if (!remoteModel) continue;
    if (input.agent && (input.owner.kind !== 'assistant_run' || runtime.adapterType !== 'openai_compatible'
      || input.agent.config.model !== remoteModel || input.agent.config.providerKey !== (runtime.adapterConfig?.providerPreset || runtime.key))) {
      throw new Error('Agent provider capability probe no longer matches current configuration');
    }
    const enableThinking=input.owner.kind==='assistant_run' && process.env.ASSISTANT_TEXT_DISABLE_THINKING==='1'?false:undefined;
    if (enableThinking !== undefined && (runtime.adapterType !== 'openai_compatible'
      || !(runtime.adapterConfig?.providerPreset === 'siliconflow'
        || (runtime.adapterConfig?.providerPreset === 'deepseek' && new URL(runtime.baseUrl).origin === 'https://api.deepseek.com')))) {
      throw new Error('Assistant thinking override requires an approved SiliconFlow or official DeepSeek runtime');
    }
    const startedAt = Date.now();
    const attempt = await withTenantTransaction(input.enterpriseId, (transaction) =>
      new AiCreationRepository(transaction).createProviderAttempt({
        enterpriseId: input.enterpriseId,
        generationId: input.owner.kind === 'generation' ? input.owner.generationId : null,
        assistantRunId: input.owner.kind === 'assistant_run' ? input.owner.runId : null,
        knowledgeJobId: null,
        providerConfigId: BigInt(runtime.id),
        providerKey: runtime.key,
        adapterType: runtime.adapterType,
        capability,
        logicalModelKey: input.logicalModelKey,
        remoteModel,
        status: 'created',
        accepted: false,
        estimatedCost: resolveProviderCostEstimate(runtime, input.logicalModelKey, remoteModel),
        requestFingerprint: requestFingerprint(input.agent?.input || input.messages),
        metadata: input.owner.kind==='assistant_run'?{...input.metadata,assistantText:{enableThinking:enableThinking ?? null,maxTokens:input.maxTokens}}:input.metadata,
      })
    );

    let dispatched = false;
    try {
      await input.beforeProviderCall?.();
      dispatched = true;
      const callRuntime = input.owner.kind === 'generation' ? runtime : { ...runtime, timeoutMs: Math.min(runtime.timeoutMs, 90000) };
      const agentOutput = input.agent ? await executeAgentChat(callRuntime, { ...input.agent.input, model: remoteModel, enableThinking }) : undefined;
      const content = agentOutput?.text ?? await getAiProviderAdapter(runtime.adapterType).chat(callRuntime, {
        model: remoteModel,
        messages: input.messages,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        enableThinking,
      });
      await withTenantTransaction(input.enterpriseId, (transaction) =>
        new AiCreationRepository(transaction).updateProviderAttempt(attempt.id, {
          status: 'succeeded',
          accepted: true,
          actualCost: input.owner.kind === 'generation'
            ? resolveProviderCostEstimate(runtime, input.logicalModelKey, remoteModel)
            : { measurementKind: 'unavailable' },
          durationMs: Date.now() - startedAt,
        })
      );
      return { content, agentOutput, provider: runtime.key, model: remoteModel, attemptId: attempt.id };
    } catch (error) {
      lastError = error;
      const safeFallback = !dispatched || isSafeProviderFallback(error);
      await withTenantTransaction(input.enterpriseId, (transaction) =>
        new AiCreationRepository(transaction).updateProviderAttempt(attempt.id, {
          status: safeFallback ? 'failed' : 'unknown',
          accepted: !safeFallback,
          errorCode: error instanceof AiProviderError ? error.code : 'PROVIDER_ERROR',
          errorMessage: input.owner.kind === 'generation'
            ? (error instanceof Error ? error.message : String(error))
            : 'Assistant provider invocation failed',
          durationMs: Date.now() - startedAt,
        })
      );
      // Assistant calls conservatively keep one provider attempt. Unknown acceptance
      // must never trigger a second billable request, even on a different provider.
      if (!safeFallback || input.owner.kind !== 'generation') throw error;
    }
  }

  throw lastError || new Error('所有 AI 供应商均不可用');
}

/** Compatibility wrapper: existing workflow callers and return values stay unchanged. */
export function executePostgresWorkflowChat(input: {
  enterpriseId: bigint; generationId: bigint; logicalModelKey: WorkflowChatModelKey;
  messages: AiChatMessage[]; temperature?: number; maxTokens?: number; metadata?: Record<string, unknown>;
}) {
  return executePostgresText({ ...input, owner: { kind: 'generation', generationId: input.generationId } });
}
