import { createHash } from 'node:crypto';
import { getLines, getMessages } from '@langchain/core/utils/event_source_parse';
import { AiProviderError } from '../provider-types';
import {
  agentModelLimits, type ModelTool, type ModelTurnInput, type ModelTurnOutput,
} from '@/lib/assistant/contracts/model';
import type { NativeToolName } from '@/lib/assistant/contracts/native-tools';
import { assertToolPairs } from '@/lib/assistant/agent/tool-protocol';
import { bailianSchema } from './bailian-capabilities';

export const bailianResponsesProtocol = 'bailian-responses-wire-v1';

const invalid = (message = 'Invalid Responses API frame'): never =>
  { throw new AiProviderError(message, 'INVALID_PROVIDER_RESPONSE', 'unknown', 502); };

export type BailianResponsesRequestOptions = { nativeTools?: readonly NativeToolName[]; stream?: boolean };

const nativeToolTypes = new Set<string>(['web_search', 'web_extractor', 'code_interpreter']);

/**
 * Responses API request body. This is not the Chat Completions body: assistant
 * tool calls become `function_call` items and tool results become
 * `function_call_output` items, while native tools are provider-side entries.
 */
export function bailianResponsesBody(input: ModelTurnInput, options: BailianResponsesRequestOptions = {}) {
  assertToolPairs(input.messages);
  const maxOutputTokens = agentModelLimits.maxOutputTokens;
  if (!Number.isInteger(input.maxTokens) || input.maxTokens < 1 || input.maxTokens > maxOutputTokens) throw Error('agent_input_limit');

  const instructions: string[] = [];
  const items: Array<Record<string, unknown>> = [];
  let images = 0, textBytes = 0;

  for (const message of input.messages) {
    if (message.role === 'system') {
      if (message.content.some(part => part.type !== 'text')) throw Error('agent_image_limit');
      const text = message.content.map(part => part.type === 'text' ? part.text : '').join('\n');
      textBytes += Buffer.byteLength(text);
      if (text.trim()) instructions.push(text);
      continue;
    }
    if (message.role === 'tool') {
      textBytes += Buffer.byteLength(message.content);
      items.push({ type: 'function_call_output', call_id: message.callId, output: message.content });
      continue;
    }
    if (message.role === 'assistant') {
      textBytes += Buffer.byteLength(message.content);
      if (message.content) items.push({ type: 'assistant', content: [{ type: 'output_text', text: message.content }] });
      for (const call of message.toolCalls ?? []) {
        items.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments });
      }
      continue;
    }
    const content = message.content.map(part => {
      if (part.type === 'text') { textBytes += Buffer.byteLength(part.text); return { type: 'input_text', text: part.text }; }
      images++;
      if (!['image/jpeg', 'image/png'].includes(part.mimeType) || !/^[A-Za-z0-9+/]+={0,2}$/.test(part.data)
        || Buffer.byteLength(part.data, 'base64') > agentModelLimits.maxImageBytes) throw Error('agent_image_limit');
      return { type: 'input_image', image_url: `data:${part.mimeType};base64,${part.data}` };
    });
    items.push({ role: 'user', content });
  }
  if (!items.length) throw Error('agent_input_limit');
  if (images > agentModelLimits.maxImages || textBytes > agentModelLimits.maxTextBytes) throw Error('agent_input_limit');

  const nativeTools = [...new Set(options.nativeTools ?? [])];
  const nativeSet = new Set<string>(nativeTools);
  // web_extractor is documented as unusable without web_search in the same call.
  if (nativeSet.has('web_extractor') && !nativeSet.has('web_search')) throw Error('native_tool_pairing_invalid');

  const tools: Array<Record<string, unknown>> = [
    ...input.tools.map((tool: ModelTool) => ({
      type: 'function', name: tool.name, description: tool.description, parameters: bailianSchema(tool.parameters),
    })),
    ...nativeTools.map(type => ({ type })),
  ];

  const body: Record<string, unknown> = {
    model: input.model,
    input: items,
    max_output_tokens: input.maxTokens,
    // Nothing is retained provider-side; multi-turn context is rebuilt by the
    // runtime from its own checkpointed transcript.
    store: false,
    frequency_penalty: 0,
    presence_penalty: 0,
    top_p: 1,
  };
  if (instructions.length) body.instructions = instructions.join('\n\n');
  if (typeof input.temperature === 'number') body.temperature = input.temperature;
  if (input.enableThinking === true) body.enable_thinking = true;
  if (tools.length) {
    body.tools = tools;
    body.parallel_tool_calls = false;
    body.tool_choice = 'auto';
  }
  if (options.stream) body.stream = true;
  return body;
}

/** Metadata-only description of the outgoing contract: no prompts, no images,
 * no tool arguments, no credentials. */
export function bailianResponsesRequestDiagnostic(body: Record<string, unknown>) {
  const encoded = JSON.stringify(body);
  const items = Array.isArray(body.input) ? body.input as Array<Record<string, unknown>> : [];
  const tools = Array.isArray(body.tools) ? body.tools as Array<Record<string, unknown>> : [];
  return {
    protocol: 'responses-request-diagnostic-v1',
    payloadHash: createHash('sha256').update(encoded).digest('hex'),
    payloadBytes: Buffer.byteLength(encoded),
    fields: Object.keys(body).sort(),
    maxOutputTokens: typeof body.max_output_tokens === 'number' ? body.max_output_tokens : null,
    stream: body.stream === true,
    store: body.store === true,
    thinking: body.enable_thinking === true,
    instructionsBytes: typeof body.instructions === 'string' ? Buffer.byteLength(body.instructions) : 0,
    inputItems: items.map(item => ({ type: String(item.type ?? 'message'), role: typeof item.role === 'string' ? item.role : null,
      parts: Array.isArray(item.content) ? (item.content as Array<Record<string, unknown>>).map(part => String(part.type)) : [] })),
    tools: tools.map(tool => String(tool.type === 'function' ? tool.name : tool.type)),
    nativeTools: tools.filter(tool => nativeToolTypes.has(String(tool.type))).map(tool => String(tool.type)),
    toolSchemaHash: createHash('sha256').update(JSON.stringify(tools)).digest('hex'),
  };
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

/** Native usage carries input/output tokens; reasoning tokens are audited
 * separately and never added to the provider's own total. */
export function parseBailianResponsesUsage(payload: Record<string, unknown>): ModelTurnOutput['usage'] {
  const raw = payload.usage && typeof payload.usage === 'object' ? payload.usage as Record<string, unknown> : null;
  if (!raw) return null;
  const input = nonNegativeInteger(raw.input_tokens), output = nonNegativeInteger(raw.output_tokens);
  if (input === null && output === null) return null;
  if (input === null || output === null) return null;
  const usage: NonNullable<ModelTurnOutput['usage']> = { inputTokens: input, outputTokens: output };
  const details = raw.input_tokens_details && typeof raw.input_tokens_details === 'object'
    ? raw.input_tokens_details as Record<string, unknown> : {};
  for (const [key, item] of [['cachedInputTokens', details.cached_tokens],
    ['cacheWriteInputTokens', details.cache_write_tokens]] as const) {
    if (item === undefined || item === null) continue;
    const value = nonNegativeInteger(item);
    if (value === null || value > input) return null;
    Object.assign(usage, { [key]: value });
  }
  return usage;
}

export function parseBailianReasoningTokens(payload: Record<string, unknown>) {
  const usage = payload.usage && typeof payload.usage === 'object' ? payload.usage as Record<string, unknown> : {};
  const details = usage.output_tokens_details && typeof usage.output_tokens_details === 'object'
    ? usage.output_tokens_details as Record<string, unknown> : {};
  return nonNegativeInteger(details.reasoning_tokens);
}

/** Tool invocation counts as reported by the provider. Unreported tools stay
 * absent rather than being filled with zero. */
export function parseBailianToolCounts(payload: Record<string, unknown>): Partial<Record<string, number>> {
  const counts: Partial<Record<string, number>> = {};
  const usage = payload.usage && typeof payload.usage === 'object' ? payload.usage as Record<string, unknown> : {};
  const sources = [payload.tool_usage, usage.x_tools];
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const [name, value] of Object.entries(source as Record<string, unknown>)) {
      if (!nativeToolTypes.has(name) || !value || typeof value !== 'object') continue;
      const entry = value as Record<string, unknown>;
      const count = nonNegativeInteger(entry.count) ?? nonNegativeInteger(entry.num_requests);
      if (count !== null && counts[name] === undefined) counts[name] = count;
    }
  }
  return counts;
}

function markdownLogs(logs: string) {
  // Sandbox logs arrive as a fenced block; keep the inner payload only.
  const match = /^```[^\n]*\n([\s\S]*?)\n```\s*$/.exec(logs);
  return (match ? match[1] : logs).replace(/\s+$/, '');
}

export type BailianResponsesParseContext = { requestId: string | null; nativeTools: NativeToolName[] };

/** Parses the documented Responses object into the shared runtime contract.
 * Native tool items are preserved by the evidence collector, not flattened here. */
export function parseBailianResponses(payload: Record<string, unknown>, context: BailianResponsesParseContext): ModelTurnOutput {
  if (payload.object !== undefined && payload.object !== 'response') return invalid();
  const status = String(payload.status ?? '');
  if (!['completed', 'incomplete', 'failed'].includes(status)) return invalid();
  if (status === 'failed') {
    throw new AiProviderError('Responses API reported a failed response', 'PROVIDER_RESPONSE_FAILED', 'unknown', 502);
  }
  const output = Array.isArray(payload.output) ? payload.output : [];
  if (!output.length) return invalid();

  const texts: string[] = [];
  const toolCalls: ModelTurnOutput['toolCalls'] = [];
  const seen = new Set<string>();
  for (const raw of output) {
    if (!raw || typeof raw !== 'object') return invalid();
    const item = raw as Record<string, unknown>;
    if (item.type === 'message') {
      const content = Array.isArray(item.content) ? item.content : [];
      const parts: string[] = [];
      for (const part of content) {
        if (!part || typeof part !== 'object') return invalid();
        const value = part as Record<string, unknown>;
        if (value.type !== 'output_text' || typeof value.text !== 'string') continue;
        parts.push(value.text);
      }
      if (parts.length) texts.push(parts.join(''));
      continue;
    }
    if (item.type === 'function_call') {
      const name = item.name, args = item.arguments;
      const id = typeof item.call_id === 'string' ? item.call_id : typeof item.id === 'string' ? item.id : '';
      if (typeof name !== 'string' || !/^[\w-]{1,64}$/.test(name) || typeof args !== 'string' || args.length > 8000
        || !/^[\w-]{1,128}$/.test(id) || seen.has(id)) return invalid();
      try {
        const value = JSON.parse(args);
        if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
      } catch { return invalid(); }
      seen.add(id);
      toolCalls.push({ id, name, arguments: args });
    }
  }
  if (toolCalls.length > agentModelLimits.maxToolCalls) return invalid();

  const text = texts.join('\n');
  if ((!text.trim() && !toolCalls.length) || text.length > 16000) return invalid();

  const incomplete = status === 'incomplete';
  const finishReason = incomplete ? 'length' : toolCalls.length ? 'tool_calls' : 'stop';
  const responseId = typeof payload.id === 'string' ? payload.id.slice(0, 200) : null;
  return {
    text, toolCalls, finishReason,
    providerRequestId: (context.requestId ?? responseId)?.slice(0, 200) ?? null,
    usage: parseBailianResponsesUsage(payload),
  };
}

export function bailianResponsesResponseDiagnostic(payload: Record<string, unknown>, requestId: string | null) {
  const encoded = JSON.stringify(payload);
  const output = Array.isArray(payload.output) ? payload.output as Array<Record<string, unknown>> : [];
  const usage = payload.usage && typeof payload.usage === 'object' ? payload.usage as Record<string, unknown> : {};
  return {
    protocol: 'responses-response-diagnostic-v1',
    requestId: requestId?.slice(0, 200) ?? null,
    responseId: typeof payload.id === 'string' ? payload.id.slice(0, 200) : null,
    status: typeof payload.status === 'string' ? payload.status : null,
    responseHash: createHash('sha256').update(encoded).digest('hex'),
    responseBytes: Buffer.byteLength(encoded),
    outputTypes: output.map(item => String(item.type ?? 'unknown')),
    inputTokens: nonNegativeInteger(usage.input_tokens),
    outputTokens: nonNegativeInteger(usage.output_tokens),
    toolCounts: parseBailianToolCounts(payload),
  };
}

/** Minimal terminal state machine for the documented SSE events. The final
 * `response.completed` payload is authoritative; item events are a fallback. */
export async function readBailianResponsesStream(response: Response): Promise<Record<string, unknown>> {
  const contentType = response.headers.get('content-type') || '';
  if (!/^text\/event-stream(?:;|$)/i.test(contentType)) throw new AiProviderError(
    'Responses stream was not served as text/event-stream', 'INVALID_PROVIDER_RESPONSE', 'unknown', 502);
  if (!response.body) throw new AiProviderError('Responses stream has no body', 'PROVIDER_STREAM_INCOMPLETE', 'unknown', 504);

  const items = new Map<string, Record<string, unknown>>();
  const order: string[] = [];
  let final: Record<string, unknown> | null = null;
  let terminal = false, failure: string | null = null, bytes = 0;

  const parse = getLines(getMessages(message => {
    if (!message.data || message.data === '[DONE]') return;
    let value: Record<string, unknown>;
    try { value = JSON.parse(message.data) as Record<string, unknown>; } catch { throw invalid('Responses stream frame was not JSON'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('Responses stream frame was not an object');
    const type = String(value.type ?? '');
    if (type === 'error' || type === 'response.failed') {
      terminal = true;
      failure = type;
      return;
    }
    if (type === 'response.output_item.done') {
      const item = value.item && typeof value.item === 'object' ? value.item as Record<string, unknown> : null;
      if (item) {
        const id = String(item.id ?? `item_${order.length}`);
        if (!items.has(id)) order.push(id);
        items.set(id, item);
      }
      return;
    }
    if (type === 'response.completed' || type === 'response.incomplete') {
      terminal = true;
      const payload = value.response && typeof value.response === 'object' ? value.response as Record<string, unknown> : null;
      if (payload) final = { ...payload, status: payload.status ?? (type === 'response.incomplete' ? 'incomplete' : 'completed') };
      return;
    }
  }));

  const reader = response.body.getReader();
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) { parse(new Uint8Array(), true); break; }
      bytes += part.value.byteLength;
      if (bytes > 4_000_000) throw new AiProviderError('Responses stream exceeded the byte limit', 'INVALID_PROVIDER_RESPONSE', 'unknown', 502);
      parse(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); }

  if (failure) throw new AiProviderError('Responses stream reported an error event', 'PROVIDER_RESPONSE_FAILED', 'unknown', 502);
  if (!terminal) throw new AiProviderError('Responses stream ended without a terminal event', 'PROVIDER_STREAM_INCOMPLETE', 'unknown', 504);
  if (final) {
    const payload = final as Record<string, unknown>;
    if (!Array.isArray(payload.output) && order.length) {
      payload.output = order.map(id => items.get(id));
    }
    return payload;
  }
  const requestId = response.headers.get('x-request-id');
  return { object: 'response', status: 'completed', id: requestId, output: order.map(id => items.get(id)) };
}

export function bailianResponsesStreamingEnabled(env: Record<string, string | undefined> = process.env) {
  return env.ASSISTANT_RESPONSES_STREAM === '1';
}

/** Local helper for tests and diagnostics: the sandbox log payload only. */
export const bailianResponsesLogPayload = markdownLogs;
