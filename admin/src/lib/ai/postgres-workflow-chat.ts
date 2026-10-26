import crypto from 'node:crypto';
import { executeAgentChat, agentChatBody, agentChatRequestDiagnostic } from './providers/agent-chat';
import { consultationProfile } from '@/lib/assistant/contracts/consultation';
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
    const consultation = input.agent?.config.consultation;
    const consultationRuntime = consultation && runtime.adapterType === 'openai_compatible'
      && new URL(runtime.baseUrl).origin === 'https://dashscope.aliyuncs.com' && remoteModel === consultationProfile(consultation.profile)?.model;
    if (consultation && (!consultationRuntime || input.agent!.input.profile !== consultation.profile)) throw new Error('Consultation profile does not match the configured runtime');
    const enableThinking=consultation ? false : input.owner.kind==='assistant_run' && process.env.ASSISTANT_TEXT_DISABLE_THINKING==='1'?false:undefined;
    if (enableThinking !== undefined && (runtime.adapterType !== 'openai_compatible'
      || !(runtime.adapterConfig?.providerPreset === 'siliconflow'
        || (runtime.adapterConfig?.providerPreset === 'deepseek' && new URL(runtime.baseUrl).origin === 'https://api.deepseek.com') || consultationRuntime))) {
      throw new Error('Assistant thinking override requires an approved SiliconFlow or official DeepSeek runtime');
    }
    const agentBody = input.agent ? agentChatBody({ ...input.agent.input, model: remoteModel, enableThinking }, runtime.baseUrl) : null;
    const attemptMetadata = input.owner.kind === 'assistant_run' ? { ...input.metadata,
      assistantText: { enableThinking: enableThinking ?? null, maxTokens: input.maxTokens },
      ...(agentBody ? { assistantRequest: agentChatRequestDiagnostic(agentBody) } : {}),
    } : input.metadata;
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
        metadata: attemptMetadata,
      })
    );

    let dispatched = false;
    try {
      await input.beforeProviderCall?.();
      const remainingMs = consultation ? Number(input.agent!.input.deadlineAt) - Date.now() : 90000;
      if (consultation && (!Number.isFinite(remainingMs) || remainingMs < 1)) throw new Error('agent_deadline_exceeded');
      dispatched = true;
      const callRuntime = input.owner.kind === 'generation' ? runtime : { ...runtime, timeoutMs: Math.min(runtime.timeoutMs, 90000, remainingMs) };
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
          ...(input.owner.kind === 'assistant_run' && error instanceof AiProviderError && error.diagnostic
            ? { metadata: { ...attemptMetadata, providerFailure: error.diagnostic } } : {}),
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
