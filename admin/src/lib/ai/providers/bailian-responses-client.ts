import { AiProviderError, type AiProviderRuntimeConfig } from '../provider-types';
import type { ModelTurnInput, ModelTurnOutput } from '@/lib/assistant/contracts/model';
import type { NativeToolName } from '@/lib/assistant/contracts/native-tools';
import { bearerHeaders, parseJson, providerFetch } from './http';
import { cacheObservation, modelPrefixObservation } from './model-observation';
import {
  bailianResponsesBinding, planBailianResponsesTools, type BailianResponsesBinding,
} from './bailian-responses-capabilities';
import {
  bailianResponsesBody, bailianResponsesRequestDiagnostic, bailianResponsesResponseDiagnostic,
  consumeBailianResponsesStream, parseBailianResponses, type BailianResponsesStreamOptions,
} from './bailian-responses';
import { collectNativeToolEvidence } from './bailian-responses-evidence';
import {
  bailianResponsesRetryDelay, bailianResponsesRetryPolicy, bailianResponsesRetrySleep,
  type BailianResponsesRetryPolicy,
} from './bailian-responses-retry';

export type BailianResponsesExecuteOptions = {
  /** Provider-side tools for this turn. Capability and pairing checks still apply. */
  nativeTools?: readonly NativeToolName[];
  /** Streaming is opt-in; the non-streaming response is the default contract. */
  stream?: boolean;
  /** Receives documented text deltas once each. Never used for retries. */
  onTextDelta?: (delta: string) => void;
  onToolItem?: BailianResponsesStreamOptions['onToolItem'];
  /** Overrides the injected clock for deterministic evidence in tests. */
  now?: () => Date;
  /** Deployment retry budget; defaults to ASSISTANT_RESPONSES_MAX_RETRIES. */
  retryPolicy?: BailianResponsesRetryPolicy;
  /** Deterministic delay injection for tests. */
  sleep?: (ms: number) => Promise<void>;
};

/** Single billable turn with a narrow retry window: only an explicit 429/503
 * pre-execution rejection is replayed. Timeouts, dropped connections and
 * interrupted streams stay unknown and are never re-sent, so a provider-side
 * tool is never charged twice by an automatic replay. */
export async function executeBailianResponses(
  runtime: AiProviderRuntimeConfig,
  input: ModelTurnInput,
  options: BailianResponsesExecuteOptions = {},
): Promise<ModelTurnOutput> {
  const binding = bailianResponsesBinding(runtime.baseUrl, input.model);
  if (!binding) throw new AiProviderError('Responses API binding mismatch', 'responses_binding_mismatch', 'definitive_failure', 422);

  const plan = planBailianResponsesTools(binding, options.nativeTools ?? [], { thinking: input.enableThinking === true });
  if (plan.rejected.length) {
    throw new AiProviderError(
      `Native tool not available for ${binding.model}: ${plan.rejected.map(item => `${item.tool}:${item.code}`).join(',')}`,
      'native_tool_capability_unavailable', 'definitive_failure', 422,
    );
  }

  let body: Record<string, unknown>;
  try { body = bailianResponsesBody(input, { nativeTools: plan.enabled, stream: options.stream === true }); }
  catch (error) {
    throw new AiProviderError(error instanceof Error ? error.message : 'Invalid Responses input',
      'responses_input_invalid', 'definitive_failure', 422);
  }
  const requestDiagnostic = bailianResponsesRequestDiagnostic(body);
  const started = Date.now();
  const now = options.now ?? (() => new Date());
  const policy = options.retryPolicy ?? bailianResponsesRetryPolicy();
  const sleep = options.sleep ?? bailianResponsesRetrySleep;

  let response: Response;
  let retries = 0;
  for (;;) {
    try {
      response = await providerFetch(binding.responsesUrl, {
        method: 'POST',
        headers: options.stream === true
          ? { ...bearerHeaders(runtime.apiKey), Accept: 'text/event-stream' }
          : bearerHeaders(runtime.apiKey),
        body: JSON.stringify(body),
      }, Math.min(runtime.timeoutMs, 120000), 'Bailian Responses', { redactErrorBody: true });
      break;
    } catch (error) {
      const delay = bailianResponsesRetryDelay(error, retries, policy);
      if (delay === null) throw error;
      retries++;
      await sleep(delay);
    }
  }

  const requestId = response.headers.get('x-request-id') || response.headers.get('x-dashscope-request-id');
  let payload: Record<string, unknown>;
  let streamedText: string | null = null;
  if (options.stream === true) {
    const streamed = await consumeBailianResponsesStream(response,
      { onTextDelta: options.onTextDelta, onToolItem: options.onToolItem });
    payload = streamed.payload;
    streamedText = streamed.streamedText;
  } else payload = await parseJson(response, 'Bailian Responses');

  let output: ModelTurnOutput;
  try {
    output = parseBailianResponses(payload, { requestId, nativeTools: plan.enabled });
  } catch (error) {
    if (!(error instanceof AiProviderError) || error.code !== 'INVALID_PROVIDER_RESPONSE') throw error;
    const encoded = JSON.stringify(payload);
    throw new AiProviderError(error.message, error.code, 'unknown', 502,
      bailianResponsesResponseDiagnostic(payload, requestId) as never,
      Buffer.byteLength(encoded) <= 64000 ? { protocol: 'invalid-responses-frame-v1', payload } : undefined);
  }

  const capturedAt = now().toISOString();
  const evidence = collectNativeToolEvidence(payload, { requestId, tools: plan.enabled, capturedAt });
  return {
    ...output,
    ...(evidence ? { nativeTools: evidence } : {}),
    observation: {
      latencyMs: Date.now() - started,
      cache: cacheObservation(output.usage),
      prefix: modelPrefixObservation(input.messages, body.tools ?? []),
      protocol: 'responses',
      request: { ...requestDiagnostic, stream: options.stream === true, streamedChars: streamedText?.length ?? 0 },
      ...(retries ? { retries } : {}),
    },
  };
}

export type { BailianResponsesBinding };
