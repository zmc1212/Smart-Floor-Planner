import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { executeAgentChat, agentChatBody, agentChatRequestDiagnostic, responsesWireSelected } from './providers/agent-chat';
import { bailianBinding, bailianExplicitCacheCapable, bailianThinkingCapable } from './providers/bailian-capabilities';
import { isQiniuConatusModel } from './providers/qiniu';
import { consultationProfile } from '@/lib/assistant/contracts/consultation';
import type { ModelTurnInput } from '@/lib/assistant/contracts/model';
import type { AgentConfig } from '@/lib/assistant/agent/config';
import { conversationImageProtocol, nativeImageFinalProjection } from '@/lib/assistant/agent/image-context';
import { specialistModel } from '@/lib/assistant/specialists/registry';
import { bailianResponsesBinding } from './providers/bailian-responses-capabilities';
import type { InvocationOwner } from '@/lib/assistant/contracts';
import { AssistantError } from '@/lib/assistant/contracts';
import { reportBodyFinalProtocol, reportNativeFinalProtocol } from '@/lib/assistant/agent/report-native-final';
import { reportFinalOutputTokenLimit } from '@/lib/assistant/contracts/model';
import { nativeFinalProjection } from '@/lib/assistant/agent/native-final';
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
  type AiProviderRuntimeConfig,
} from '@/lib/ai/provider-types';

type WorkflowChatModelKey = Extract<AiLogicalModelKey, 'chat.general' | 'vision.reference_analysis'>;

function configurationFailure(code: string, message: string): never {
  const error = new AssistantError(code, 503);
  error.message = message;
  throw error;
}

export function boundAssistantModel(runtime: Pick<AiProviderRuntimeConfig, 'key' | 'adapterType' | 'adapterConfig'>,
  config: Pick<AgentConfig, 'model' | 'providerKey'>, deploymentOverride?: string) {
  if (runtime.adapterType !== 'openai_compatible' || config.providerKey !== (runtime.adapterConfig?.providerPreset || runtime.key)
    || (deploymentOverride?.trim() && deploymentOverride.trim() !== config.model)) {
    configurationFailure('assistant_model_configuration_invalid', 'Agent provider capability probe no longer matches current configuration');
  }
  // A persisted enterprise capability probe binds the Agent model. The global
  // chatbot's model choice must not replace it when reusing that provider's credentials.
  return config.model;
}

export function assistantThinkingOverrideAllowed(runtime: Pick<AiProviderRuntimeConfig, 'adapterType' | 'adapterConfig' | 'baseUrl'>,
  model: string, consultationRuntime: boolean) {
  const preset = runtime.adapterConfig?.providerPreset;
  // DashScope evidence is limited to the Beijing compatible-mode binding, so
  // only that binding and a model whose table documents thinking control pass.
  return runtime.adapterType === 'openai_compatible' && (preset === 'siliconflow'
    || preset === 'deepseek' && new URL(runtime.baseUrl).origin === 'https://api.deepseek.com' || consultationRuntime
    || preset === 'qiniu' && isQiniuConatusModel(runtime.baseUrl, model)
    || (preset === 'dashscope' || preset === 'bailian') && bailianBinding(runtime.baseUrl, model, false)?.region === 'cn-beijing'
      && bailianThinkingCapable(model));
}

/** Shared by dispatch and zero-call readiness checks, before an attempt exists. */
export function assertAssistantThinkingOverride(runtime: Pick<AiProviderRuntimeConfig, 'adapterType' | 'adapterConfig' | 'baseUrl'>,
  model: string, enableThinking: boolean | undefined, consultationRuntime = false) {
  if (enableThinking !== undefined && !assistantThinkingOverrideAllowed(runtime, model, consultationRuntime)) {
    configurationFailure('assistant_thinking_configuration_invalid', 'Assistant thinking override requires a verified provider/model binding');
  }
}

function requestFingerprint(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Retain an already-returned invalid frame only in the existing run-private
 * checkpoint. This neither settles usage nor changes unknown/fallback rules.
 * Native report finals previously retained only shape/usage diagnostics. */
export function privateAgentFailureFrame(owner: InvocationOwner, metadata: Record<string, unknown> | undefined, error: unknown) {
  if (owner.kind !== 'assistant_run' || !Number.isInteger(metadata?.turn)
    || !(error instanceof AiProviderError) || error.privateResponse?.protocol !== 'invalid-provider-frame-v1') return null;
  const explanation = metadata?.sourceAnswerMode === 'reviewed-knowledge-explanation-v1';
  const dialogue = metadata?.probeVersion === 'minimal-dialogue-v3' && metadata.purpose === 'answer'
    && Number(metadata.turn) >= 0 && Number(metadata.turn) < 4;
  const report = metadata?.reportNativeFinal === reportNativeFinalProtocol && metadata.purpose === 'answer'
    && [nativeFinalProjection, nativeImageFinalProjection].includes(String(metadata.nativeFinalProjection))
    && Number(metadata.turn) >= 0 && Number(metadata.turn) < 4;
  const body = metadata?.reportBodyFinal === reportBodyFinalProtocol && metadata.purpose === 'answer'
    && metadata.maxOutputTokens === reportFinalOutputTokenLimit && metadata.turn === 0;
  if (!explanation && !dialogue && !report && !body) return null;
  try { return Buffer.byteLength(JSON.stringify(error.privateResponse)) <= 64000 ? error.privateResponse : null; }
  catch { return null; }
}

/** Explicit caching stays opt-in. The marker is only valid for a DashScope
 * binding whose model table documents explicit cache and a text-only leading
 * system block; every other runtime keeps the provider's implicit behaviour. */
export function explicitCacheControl(runtime: Pick<AiProviderRuntimeConfig, 'baseUrl'>, remoteModel: string,
  enableThinking: boolean | undefined, agentInput: Pick<ModelTurnInput, 'messages'> | undefined, consultation: boolean) {
  if (!agentInput || consultation || process.env.ASSISTANT_TEXT_EXPLICIT_CACHE !== '1') return undefined;
  const binding = bailianBinding(runtime.baseUrl, remoteModel, enableThinking);
  if (!binding || !bailianExplicitCacheCapable(binding.model)) return undefined;
  const leading = agentInput.messages[0];
  return leading?.role === 'system' && leading.content.length > 0 && leading.content.every(part => part.type === 'text')
    ? 'ephemeral_system' as const : undefined;
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
    ? await getPlatformLlmOverrideRuntime(input.logicalModelKey === 'vision.reference_analysis' ? 'vision' : 'chat')
    : null;
  const runtimes = llmOverride
    ? [llmOverride]
    : await listProviderRuntimes(capability, input.logicalModelKey);
  if (!runtimes.length) throw new Error(`没有可用的 AI 供应商支持 ${input.logicalModelKey}`);

  let lastError: unknown;
  for (const runtime of runtimes) {
    // Deployment-only assistant override. Never change the shared generation model
    // or silently fall back to a reasoning model after an ambiguous invocation.
    const remoteModel = input.owner.kind === 'assistant_run' && input.agent
      ? boundAssistantModel(runtime, input.agent.config, process.env.ASSISTANT_TEXT_MODEL)
      : input.owner.kind === 'assistant_run' && process.env.ASSISTANT_TEXT_MODEL?.trim()
        ? process.env.ASSISTANT_TEXT_MODEL.trim() : runtime.modelMappings[input.logicalModelKey];
    if (!remoteModel) continue;
    if (input.agent && (input.owner.kind !== 'assistant_run' || runtime.adapterType !== 'openai_compatible'
      || input.agent.config.model !== remoteModel || input.agent.config.providerKey !== (runtime.adapterConfig?.providerPreset || runtime.key))) {
      configurationFailure('assistant_model_configuration_invalid', 'Agent provider capability probe no longer matches current configuration');
    }
    if (input.agent?.config.providerKey === specialistModel.providerKey && remoteModel === specialistModel.model
      && input.agent.config.imageContext === conversationImageProtocol
      && input.agent.input.messages.some(message => message.role === 'user' && message.content.some(part => part.type === 'image'))
      && bailianResponsesBinding(runtime.baseUrl, remoteModel)?.region !== 'cn-beijing') {
      configurationFailure('assistant_model_configuration_invalid', 'Specialist image input requires the verified Beijing endpoint');
    }
    const consultation = input.agent?.config.consultation;
    const consultationRuntime = consultation && runtime.adapterType === 'openai_compatible'
      && new URL(runtime.baseUrl).origin === 'https://dashscope.aliyuncs.com' && remoteModel === consultationProfile(consultation.profile)?.model;
    if (consultation && (!consultationRuntime || input.agent!.input.profile !== consultation.profile)) configurationFailure('assistant_model_configuration_invalid', 'Consultation profile does not match the configured runtime');
    const enableThinking=consultation ? false : input.owner.kind==='assistant_run' && process.env.ASSISTANT_TEXT_DISABLE_THINKING==='1'?false:undefined;
    assertAssistantThinkingOverride(runtime, remoteModel, enableThinking, !!consultationRuntime);
    const cacheControl = input.owner.kind === 'assistant_run' && input.agent
      ? input.agent.input.cacheControl ?? explicitCacheControl(runtime, remoteModel, enableThinking, input.agent.input, !!consultation)
      : undefined;
    // The Responses wire carries its own metadata-only request diagnostic in
    // observation; a Chat Completions body is never built or recorded for it.
    const responsesWire = input.agent
      ? responsesWireSelected(runtime, { ...input.agent.input, model: remoteModel, enableThinking })
      : false;
    const agentBody = input.agent && !responsesWire
      ? agentChatBody({ ...input.agent.input, model: remoteModel, enableThinking, cacheControl }, runtime.baseUrl) : null;
    const attemptMetadata = input.owner.kind === 'assistant_run' ? { ...input.metadata,
      assistantText: { enableThinking: enableThinking ?? null, maxTokens: input.maxTokens, cacheControl: cacheControl ?? null },
      ...(agentBody ? { assistantRequest: agentChatRequestDiagnostic(agentBody) } : {}),
      ...(responsesWire ? { assistantWire: 'responses' as const } : {}),
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
          ...(agentOutput ? { metadata: { ...attemptMetadata, assistantResponse: {
            usage: agentOutput.usage, providerRequestId: agentOutput.providerRequestId,
            ...(agentOutput.providerModel ? { providerModel: agentOutput.providerModel } : {}),
            finishReason: agentOutput.finishReason, observation: agentOutput.observation ?? null,
            // Native tool evidence is provider-side only; business tools keep
            // their own dispatcher records.
            ...(agentOutput.nativeTools ? { nativeTools: agentOutput.nativeTools } : {}),
          } } } : {}),
        })
      );
      return { content, agentOutput, provider: runtime.key, model: remoteModel, attemptId: attempt.id };
    } catch (error) {
      lastError = error;
      // The new semantic-review discriminator must retain its actual failed
      // frame, rather than repeatedly sampling a shape-only mystery. Reuse the
      // run's private checkpoint/retention path, never public provider metadata.
      const privateFrame = privateAgentFailureFrame(input.owner, input.metadata, error);
      if (privateFrame && input.owner.kind === 'assistant_run' && error instanceof AiProviderError) {
        await withTenantTransaction(input.enterpriseId, tx => tx.execute(sql`insert into app.assistant_run_steps
          (enterprise_id,run_id,step_seq,kind,status,provider_attempt_id,private_checkpoint,input_summary)
          values(${input.enterpriseId},${String(input.owner.kind === 'assistant_run' ? input.owner.runId : '')},${1900 + Number(input.metadata!.turn)},
            'agent_invalid_provider_frame','failed',${String(attempt.id)},${JSON.stringify(privateFrame)}::jsonb,
            ${JSON.stringify({ protocol: 'invalid-provider-frame-v1', attemptId: String(attempt.id), diagnostic: error.diagnostic })}::jsonb)
          on conflict do nothing`)).catch(() => { /* Preserve the original failure/billing audit even if private-frame storage fails. */ });
      }
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
