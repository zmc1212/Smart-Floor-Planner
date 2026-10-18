import type { PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, type Row } from '@/db/repositories/assistant-repository';
import type { AiChatMessage, AiProviderRuntimeConfig } from '@/lib/ai/provider-types';
import { workflowTextModel, workflowTextRuntimes, workflowTextThinking } from '@/lib/ai/workflow-text-runtime';
import { fail, fingerprint, type ActorContext } from '../contracts';
import { answerMessages } from '../knowledge/answer';
import { activeProfile } from '../knowledge/service';
import { retrievalConfiguration } from '../knowledge/retrieval';

export type PreviewTextConfiguration = {
  providerConfigId: string; providerKey: string; adapterType: string; providerPreset: string | null;
  endpointHash: string; model: string; modelRevision: null; timeoutMs: number;
  enableThinking: false | 'provider_default'; temperature: number; maxTokens: number; promptHash: string;
};
export type PreviewExecutionSnapshot = {
  version: 1; mode: 'knowledge_preview'; revision: string;
  text: PreviewTextConfiguration;
  index: { profileId: string; profileHash: string; knowledgeEpoch: number; policyVersion: number };
  scope: { audience: 'customer_public'; draftVersionIds: string[] };
  retrievalHash: string;
};

/** Whitelist effective chat inputs. No API key, auth/query credentials or private runtime is retained. */
export function previewTextConfiguration(runtime: AiProviderRuntimeConfig, model: string, thinking: false | undefined,
  input: { messages: AiChatMessage[]; temperature: number; maxTokens: number }): PreviewTextConfiguration {
  const endpoint = new URL(runtime.baseUrl);
  const apiVersion = endpoint.searchParams.get('api-version');
  const endpointIdentity = { origin: endpoint.origin, path: endpoint.pathname, apiVersion };
  return {
    providerConfigId: runtime.id, providerKey: runtime.key, adapterType: runtime.adapterType,
    providerPreset: typeof runtime.adapterConfig?.providerPreset === 'string' ? runtime.adapterConfig.providerPreset : null,
    endpointHash: fingerprint(endpointIdentity), model, modelRevision: null,
    timeoutMs: Math.min(runtime.timeoutMs, 90000), enableThinking: thinking ?? 'provider_default',
    temperature: input.temperature, maxTokens: input.maxTokens,
    promptHash: fingerprint(input.messages.filter(message => message.role === 'system').map(message => message.content)),
  };
}

export function readPreviewExecution(value: unknown): PreviewExecutionSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('context_changed');
  const v = value as PreviewExecutionSnapshot;
  const { revision, ...body } = v;
  if (v.version !== 1 || v.mode !== 'knowledge_preview' || !/^[a-f0-9]{64}$/.test(revision)
    || !v.text || !v.index || v.scope?.audience !== 'customer_public' || !Array.isArray(v.scope.draftVersionIds) || v.scope.draftVersionIds.length !== 0
    || !/^[a-f0-9]{64}$/.test(v.retrievalHash) || fingerprint(body) !== revision) fail('context_changed');
  return v;
}

export async function resolvePreviewExecution(tx: PostgresTransaction, actor: ActorContext): Promise<PreviewExecutionSnapshot> {
  if (actor.principal.kind !== 'admin' || !actor.capabilities.includes('assistant.preview.self')) fail('assistant_capability_forbidden', 403);
  const settings = (await new AssistantRepository(tx, actor).settings(true))!;
  const profile = await activeProfile(tx, actor.enterpriseId, settings);
  const runtimes = await workflowTextRuntimes('chat.general');
  const runtime = runtimes.find(candidate => workflowTextModel(candidate, 'chat.general', true));
  if (!runtime) fail('assistant_disabled', 403);
  const text = previewTextConfiguration(runtime, workflowTextModel(runtime, 'chat.general', true)!, workflowTextThinking(runtime, true), {
    messages: answerMessages('', [], []), temperature: 0, maxTokens: 2048,
  });
  const body = {
    version: 1 as const, mode: 'knowledge_preview' as const, text,
    index: { profileId: String(profile.id), profileHash: fingerprint(profile.configuration),
      knowledgeEpoch: Number(settings.knowledge_epoch), policyVersion: Number(settings.policy_version) },
    scope: { audience: 'customer_public' as const, draftVersionIds: [] as string[] }, retrievalHash: fingerprint(retrievalConfiguration),
  };
  return { ...body, revision: fingerprint(body) };
}

/** Validate the resolved runtime and actual prompt/body, not a stored model name or caller-supplied revision. */
export function assertPreviewTextConfiguration(snapshot: PreviewExecutionSnapshot, runtime: AiProviderRuntimeConfig, model: string,
  thinking: false | undefined, input: { messages: AiChatMessage[]; temperature?: number; maxTokens?: number }) {
  const expected = readPreviewExecution(snapshot);
  if (input.temperature !== 0 || input.maxTokens !== 2048 || expected.retrievalHash !== fingerprint(retrievalConfiguration)
    || fingerprint(expected.text) !== fingerprint(previewTextConfiguration(runtime, model, thinking, {
      messages: input.messages, temperature: input.temperature, maxTokens: input.maxTokens,
    }))) fail('context_changed');
}

export function previewExecutionFromPolicy(policy: Row): PreviewExecutionSnapshot | null {
  return policy.execution === undefined ? null : readPreviewExecution(policy.execution);
}
