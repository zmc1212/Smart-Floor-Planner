import crypto from 'node:crypto';
import { agentChatBody, executeAgentChat } from './providers/agent-chat';
import type { ModelTurnInput } from '@/lib/assistant/contracts/model';
import type { AgentConfig } from '@/lib/assistant/agent/config';
import { AssistantError, type InvocationOwner } from '@/lib/assistant/contracts';
import { AiCreationRepository } from '@/db/repositories/ai-creation-repository';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { resolveProviderCostEstimate } from '@/lib/ai/provider-cost';
import { getAiProviderAdapter } from '@/lib/ai/provider-registry';
import { workflowTextRuntimes, workflowTextModel, workflowTextThinking, type WorkflowChatModelKey } from './workflow-text-runtime';
import { assertPreviewTextConfiguration, type PreviewExecutionSnapshot } from '@/lib/assistant/core/execution-config';
import {
  capabilityForLogicalModel,
  AiProviderError,
  isSafeProviderFallback,
  type AiChatMessage,
} from '@/lib/ai/provider-types';

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
  /** Optional pinned preview dispatch: guard/start marker and attempt commit in one tenant transaction. */
  beforeProviderAttempt?: (tx: PostgresTransaction) => Promise<void>;
  expectedExecution?: PreviewExecutionSnapshot;
  agent?: { config: AgentConfig; input: Omit<ModelTurnInput, 'model' | 'enableThinking'> };
}) {
  if (input.owner.kind === 'knowledge_job') {
    throw new Error('Knowledge job invocation is unavailable until the knowledge domain is installed');
  }
  const capability = capabilityForLogicalModel(input.logicalModelKey);
  const runtimes = await workflowTextRuntimes(input.logicalModelKey);
  if (!runtimes.length) throw new Error(`没有可用的 AI 供应商支持 ${input.logicalModelKey}`);

  let lastError: unknown;
  for (const runtime of runtimes) {
    // Deployment-only assistant override. Never change the shared generation model
    // or silently fall back to a reasoning model after an ambiguous invocation.
    const remoteModel = workflowTextModel(runtime, input.logicalModelKey, input.owner.kind === 'assistant_run');
    if (!remoteModel) continue;
    if (input.agent && (input.owner.kind !== 'assistant_run' || runtime.adapterType !== 'openai_compatible'
      || input.agent.config.model !== remoteModel || input.agent.config.providerKey !== (runtime.adapterConfig?.providerPreset || runtime.key))) {
      throw new Error('Agent provider capability probe no longer matches current configuration');
    }
    const enableThinking = workflowTextThinking(runtime, input.owner.kind === 'assistant_run');
    if (input.expectedExecution) {
      if (input.owner.kind !== 'assistant_run' || input.logicalModelKey !== 'chat.general' || input.agent
        || !input.beforeProviderAttempt || input.beforeProviderCall) throw new AssistantError('context_changed', 409);
      assertPreviewTextConfiguration(input.expectedExecution, runtime, remoteModel, enableThinking, input);
    }
    // Local request validation must precede both the attempt and the caller's
    // provider-start checkpoint. A request that cannot be serialized was never
    // dispatched; it must not turn into an unknown remote outcome.
    if (input.agent) {
      try { agentChatBody({ ...input.agent.input, model: remoteModel, enableThinking }, runtime.baseUrl); }
      catch (error) {
        if (error instanceof Error && ['agent_input_limit', 'agent_image_limit', 'agent_output_limit'].includes(error.message))
          throw new AssistantError(error.message, 422);
        throw error;
      }
    }
    const startedAt = Date.now();
    const attempt = await withTenantTransaction(input.enterpriseId, async transaction => {
      await input.beforeProviderAttempt?.(transaction);
      return new AiCreationRepository(transaction).createProviderAttempt({
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
      });
    });

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
