import { withTenantTransaction } from '@/db/transaction';
import { AiCreationRepository } from '@/db/repositories/ai-creation-repository';
import { getPlatformLlmOverrideRuntime } from '@/lib/platform-llm-config';
import { listProviderRuntimes } from '@/lib/ai/provider-registry';
import { resolveProviderCostEstimate } from '@/lib/ai/provider-cost';
import { bailianBinding, bailianSearchBinding, type BailianSearchBinding } from '@/lib/ai/providers/bailian-capabilities';
import { bailianOfflineTransport, bailianPublicSearch, nativeSearchUsage, definitiveCapabilityRejection } from '@/lib/ai/providers/bailian-offline';
import { cacheObservation } from '@/lib/ai/providers/model-observation';
import { AiProviderError, type AiProviderRuntimeConfig } from '@/lib/ai/provider-types';
import { fingerprint } from '../contracts';
import type { AgentConfig } from './config';
import { searchWeb, type WebQuery, type WebSearchSnapshot } from './web';

export const nativeSearchProtocol = 'bailian-native-main-path-v1';
export type NativeSearchRuntime = { runtime: AiProviderRuntimeConfig; binding: BailianSearchBinding };
type SearchAgentConfig = Pick<AgentConfig, 'model' | 'providerKey' | 'consultation'>;

/** Source-bearing search is a separate documented DashScope API. The main path
 * may dispatch it only for the exact runtime the Agent text calls are bound to;
 * no model-name inference, alternate region or cross-provider fallback. */
export function nativeSearchBindingFor(runtime: AiProviderRuntimeConfig, config: Pick<SearchAgentConfig, 'model' | 'providerKey'>,
  deploymentOverride?: string): BailianSearchBinding | null {
  if (runtime.adapterType !== 'openai_compatible'
    || config.providerKey !== (runtime.adapterConfig?.providerPreset || runtime.key)
    || runtime.adapterConfig?.providerPreset !== 'dashscope'
    || (deploymentOverride?.trim() && deploymentOverride.trim() !== config.model)) return null;
  const model = runtime.modelMappings['chat.general'];
  if (!model || model !== config.model) return null;
  const chat = bailianBinding(runtime.baseUrl, model, false);
  return chat ? bailianSearchBinding(chat) : null;
}

/** Resolve through the same platform override and provider order as the text
 * call, so search cannot run on a runtime the Agent does not use. */
export async function resolveNativeSearch(config: SearchAgentConfig): Promise<NativeSearchRuntime | null> {
  // Consultation read_web depends on discovery candidate IDs from the private
  // research flow; injecting this provider would break that contract.
  if (config.consultation) return null;
  const override = await getPlatformLlmOverrideRuntime('chat');
  const runtimes = override ? [override] : await listProviderRuntimes('chat', 'chat.general');
  for (const runtime of runtimes) {
    const binding = nativeSearchBindingFor(runtime, config, process.env.ASSISTANT_TEXT_MODEL);
    if (binding) return { runtime, binding };
  }
  return null;
}

/** An explicit provider choice never falls back. Unset prefers the exact-bound
 * native provider and otherwise keeps the existing SearXNG configuration. */
export async function selectedNativeSearch(config: SearchAgentConfig): Promise<NativeSearchRuntime | null> {
  const selected = process.env.ASSISTANT_WEB_SEARCH_PROVIDER?.trim();
  if (selected && selected !== 'bailian-native') return null;
  return resolveNativeSearch(config);
}

function nativeSearchMetadata(query: WebQuery, binding: BailianSearchBinding) {
  return { nativeSearch: { protocol: nativeSearchProtocol, provider: 'bailian-native',
    queryHash: fingerprint(query), domains: query.domains, region: binding.region, remoteModel: binding.model } };
}

export function nativeSearchAttemptValues(input: { enterpriseId: bigint; runId: bigint;
  runtime: AiProviderRuntimeConfig; binding: BailianSearchBinding; query: WebQuery }) {
  return {
    enterpriseId: input.enterpriseId,
    generationId: null,
    assistantRunId: input.runId,
    knowledgeJobId: null,
    providerConfigId: BigInt(input.runtime.id),
    providerKey: input.runtime.key,
    adapterType: input.runtime.adapterType,
    capability: 'chat',
    logicalModelKey: 'chat.general' as const,
    remoteModel: input.binding.model,
    status: 'created',
    accepted: false,
    estimatedCost: resolveProviderCostEstimate(input.runtime, 'chat.general', input.binding.model),
    requestFingerprint: fingerprint({ kind: 'native_search', query: input.query, binding: input.binding }),
    metadata: nativeSearchMetadata(input.query, input.binding),
  };
}

/** Provider acceptance is recorded before pages are read. A malformed page or
 * unreadable site does not undo the billable search. */
export function nativeSearchSucceeded(input: { query: WebQuery; binding: BailianSearchBinding;
  payload: Record<string, unknown>; requestId: string | null; durationMs: number }) {
  let usage: ReturnType<typeof nativeSearchUsage> = null;
  try { usage = nativeSearchUsage(input.payload); } catch { usage = null; }
  return {
    status: 'succeeded' as const,
    accepted: true,
    actualCost: { measurementKind: 'unavailable' },
    durationMs: input.durationMs,
    metadata: { ...nativeSearchMetadata(input.query, input.binding),
      requestId: input.requestId, usage, cache: cacheObservation(usage) },
  };
}

/** A 4xx (except 408) is a definite rejection. Stream truncation, timeouts and
 * malformed frames remain unknown: the request may already be billable and is
 * never silently retried or sent to another provider. */
export function nativeSearchFailure(input: { query: WebQuery; binding: BailianSearchBinding;
  error: unknown; durationMs: number }) {
  const definitive = definitiveCapabilityRejection(input.error);
  return {
    status: definitive ? 'failed' as const : 'unknown' as const,
    accepted: !definitive,
    errorCode: input.error instanceof AiProviderError ? input.error.code : 'PROVIDER_ERROR',
    errorMessage: definitive ? 'Native search provider rejected the request' : 'Native search provider outcome unknown',
    durationMs: input.durationMs,
    metadata: nativeSearchMetadata(input.query, input.binding),
  };
}

/** Each native search is its own audited provider attempt on the existing run,
 * then delegates candidate validation and public page reading to searchWeb. */
export function nativeSearchDependency(input: { enterpriseId: bigint | number | string; runId: bigint | string;
  search: NativeSearchRuntime }) {
  const runtime = input.search.runtime, binding = input.search.binding;
  const transport = bailianOfflineTransport(runtime, binding);
  const enterpriseId = BigInt(String(input.enterpriseId)), runId = BigInt(String(input.runId));
  const provider = bailianPublicSearch(async query => {
    const startedAt = Date.now();
    const attempt = await withTenantTransaction(enterpriseId, transaction => new AiCreationRepository(transaction)
      .createProviderAttempt(nativeSearchAttemptValues({ enterpriseId, runId, runtime, binding, query })));
    let response: Awaited<ReturnType<typeof transport.search>>;
    try { response = await transport.search(query); }
    catch (error) {
      await withTenantTransaction(enterpriseId, transaction => new AiCreationRepository(transaction)
        .updateProviderAttempt(attempt.id, nativeSearchFailure({ query, binding, error, durationMs: Date.now() - startedAt })));
      throw error;
    }
    await withTenantTransaction(enterpriseId, transaction => new AiCreationRepository(transaction)
      .updateProviderAttempt(attempt.id, nativeSearchSucceeded({ query, binding, payload: response.payload,
        requestId: response.requestId, durationMs: Date.now() - startedAt })));
    return response.payload;
  });
  return (query: WebQuery): Promise<WebSearchSnapshot> => searchWeb(query, provider);
}
