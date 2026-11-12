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
  parseBailianResponses, readBailianResponsesStream,
} from './bailian-responses';
import { collectNativeToolEvidence } from './bailian-responses-evidence';

export type BailianResponsesExecuteOptions = {
  /** Provider-side tools for this turn. Capability and pairing checks still apply. */
  nativeTools?: readonly NativeToolName[];
  /** Streaming is opt-in; the non-streaming response is the default contract. */
  stream?: boolean;
  /** Overrides the injected clock for deterministic evidence in tests. */
  now?: () => Date;
};

/** Single billable request. No transport retry, no model fallback and no
 * automatic replay: an unknown accepted request may already be charged. */
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

  const response = await providerFetch(binding.responsesUrl, {
    method: 'POST',
    headers: options.stream === true
      ? { ...bearerHeaders(runtime.apiKey), Accept: 'text/event-stream' }
      : bearerHeaders(runtime.apiKey),
    body: JSON.stringify(body),
  }, Math.min(runtime.timeoutMs, 120000), 'Bailian Responses', { redactErrorBody: true });

  const requestId = response.headers.get('x-request-id') || response.headers.get('x-dashscope-request-id');
  let payload: Record<string, unknown>;
  if (options.stream === true) payload = await readBailianResponsesStream(response);
  else payload = await parseJson(response, 'Bailian Responses');

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
      request: requestDiagnostic,
    },
  };
}

export type { BailianResponsesBinding };
