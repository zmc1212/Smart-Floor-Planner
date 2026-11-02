import { createHash } from 'node:crypto';
import { AiProviderError, type AiProviderRuntimeConfig, type ProviderResponseDiagnostic } from '../provider-types';
import { agentModelLimits, reportFinalOutputTokenLimit, type ModelMessage, type ModelTurnInput, type ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { consultationProfile } from '@/lib/assistant/contracts/consultation';
import { bearerHeaders, parseJson, providerFetch, providerUrl, asObject } from './http';
import { thinkingBody } from './thinking';
import { consultationFinalSchema } from './consultation-final-schema';
import { assertToolPairs, toolSchemaIssue } from '@/lib/assistant/agent/tool-protocol';
import { bailianBinding, bailianExplicitCacheCapable, bailianFinalFormat } from './bailian-capabilities';
import { cacheObservation, modelPrefixObservation } from './model-observation';

const invalid = () => { throw new AiProviderError('Invalid Agent model response', 'INVALID_PROVIDER_RESPONSE', 'unknown', 502); };
export const agentChatProtocolVersion = 'native-final-cache-tools-v3';
export const qwenSystemProtocolVersion = 'qwen35-leading-system-v1';
function leadingSystems(messages: ModelMessage[]): ModelMessage[] {
  const systems = messages.flatMap(message => message.role === 'system' ? [message] : []);
  if (!systems.length || (systems.length === 1 && messages[0].role === 'system')) return messages;
  // Only trusted system-role messages move. Original user/tool/assistant data,
  // call pairs and application checkpoints retain their order and identity.
  return [{ role: 'system', content: systems.flatMap((message, index) => [
    ...(index ? [{ type: 'text' as const, text: '\n\n' }] : []), ...message.content,
  ]) }, ...messages.filter(message => message.role !== 'system')];
}
export function agentChatBody(input: ModelTurnInput, baseUrl = 'https://api.siliconflow.cn') {
  assertToolPairs(input.messages);
  const endpoint = new URL(baseUrl);
  const consultation = input.profile !== undefined;
  const profile = consultationProfile(input.profile);
  if (consultation && (!profile || input.model !== profile.model
    || endpoint.origin !== 'https://dashscope.aliyuncs.com' || !/^\/compatible-mode(?:\/v1)?\/?$/.test(endpoint.pathname)
    || input.enableThinking !== false)) throw Error('agent_profile_mismatch');
  const reportFinal = input.reportFinalOutputTokens !== undefined;
  if (reportFinal && (input.reportFinalOutputTokens !== reportFinalOutputTokenLimit || consultation
    || !['json_schema', 'function_call'].includes(input.outputMode || '') || input.maxTokens !== reportFinalOutputTokenLimit
    || endpoint.origin !== 'https://dashscope.aliyuncs.com' || !/^\/compatible-mode(?:\/v1)?\/?$/.test(endpoint.pathname)
    || input.outputMode !== 'function_call' && !bailianFinalFormat(input, baseUrl)
    || input.tools.length !== 1 || input.tools[0].name !== 'final_response' || input.requireTool !== true)) throw Error('agent_input_limit');
  const maxOutputTokens = reportFinal ? reportFinalOutputTokenLimit : profile ? profile.maxOutputTokens : agentModelLimits.maxOutputTokens;
  if (!Number.isInteger(input.maxTokens) || input.maxTokens < 1 || input.maxTokens > maxOutputTokens) throw Error('agent_input_limit');
  let images = 0, textBytes = 0;
  // Verified SiliconFlow Qwen3.5 template rejects any later system message.
  // This wire-only compatibility rule does not rewrite the runtime's trusted
  // repair control/draft adjacency or promote retrieved data into instructions.
  const qwen = new URL(baseUrl).origin === 'https://api.siliconflow.cn' && input.model === 'Qwen/Qwen3.5-4B';
  const messages = (qwen ? leadingSystems(input.messages) : input.messages).map(message => {
    if (message.role === 'system' && (qwen || new URL(baseUrl).origin === 'https://api.deepseek.com')) {
      if (message.content.some(part => part.type !== 'text')) throw Error('agent_image_limit');
      const content = message.content.map(part => part.type === 'text' ? part.text : '').join(qwen ? '' : '\n');
      textBytes += Buffer.byteLength(content);
      return { role: 'system', content };
    }
    if (message.role === 'tool') { textBytes += Buffer.byteLength(message.content); return { role: 'tool', tool_call_id: message.callId, content: message.content }; }
    if (message.role === 'assistant') {
      textBytes += Buffer.byteLength(message.content);
      return { role: message.role, content: message.content || null, ...(message.toolCalls?.length ? {
        tool_calls: message.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })),
      } : {}) };
    }
    return { role: message.role, content: message.content.map(part => {
      if (part.type === 'text') { textBytes += Buffer.byteLength(part.text); return { type: 'text', text: part.text }; }
      images++;
      if (!['image/jpeg', 'image/png'].includes(part.mimeType) || !/^[A-Za-z0-9+/]+={0,2}$/.test(part.data)
        || Buffer.byteLength(part.data, 'base64') > agentModelLimits.maxImageBytes) throw Error('agent_image_limit');
      return { type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${part.data}`, detail: 'auto' } };
    }) };
  });
  if (images > agentModelLimits.maxImages || textBytes > agentModelLimits.maxTextBytes) throw Error('agent_input_limit');
  const finalSchema = consultationFinalSchema(input) || bailianFinalFormat(input, baseUrl);
  if (input.cacheControl === 'ephemeral_system') {
    const cacheBinding = bailianBinding(baseUrl, input.model, input.enableThinking);
    if (!cacheBinding || !bailianExplicitCacheCapable(cacheBinding.model) || !messages.length || messages[0].role !== 'system') throw Error('cache_control_not_applicable');
    // Mark only the trusted leading system block; never a customer/tool fact.
    const content = messages[0].content;
    if (!Array.isArray(content) || !content.length || content.some(part => part.type !== 'text')) throw Error('cache_control_not_applicable');
    Object.assign(content[content.length - 1], { cache_control: { type: 'ephemeral' } });
  }
  if (finalSchema?.type === 'json_object' && !JSON.stringify(messages).toLowerCase().includes('json')) throw Error('json_keyword_required');
  const formatBody: {response_format?: {type:string;json_schema?:unknown}} = finalSchema ? {response_format:finalSchema}
    : input.jsonOutput ? {response_format:{type:'json_object'}} : {};
  return { model: input.model, messages, temperature: 0, max_tokens: input.maxTokens,
    ...formatBody,
    ...thinkingBody(baseUrl, input.enableThinking),
    ...(input.tools.length && !finalSchema ? { tools: input.tools.map(tool => ({ type: 'function', function: tool })),
      // A final-only dispatch must select that function explicitly. Some
      // providers still emit a previous, removed tool when given "required".
      // The runtime independently rejects anything outside its active list.
      tool_choice: input.requireTool
        ? input.tools.length === 1 && input.tools[0].name === 'final_response'
          ? { type: 'function', function: { name: 'final_response' } } : 'required'
        : 'auto', parallel_tool_calls: false } : {}) };
}

/** Bind the outgoing contract without retaining user text, images, arguments
 * or headers. A request description is never proof of provider acceptance. */
export function agentChatRequestDiagnostic(body: ReturnType<typeof agentChatBody>) {
  const encoded = JSON.stringify(body);
  return {
    protocol: 'agent-request-diagnostic-v1', payloadHash: createHash('sha256').update(encoded).digest('hex'),
    payloadBytes: Buffer.byteLength(encoded), fields: Object.keys(body).sort(),
    maxTokens: body.max_tokens, thinking: 'enable_thinking' in body ? body.enable_thinking : 'thinking' in body ? body.thinking : null,
    messages: body.messages.map(message => ({ role: message.role,
      contentType: message.content === null ? 'null' : Array.isArray(message.content) ? 'array' : 'string',
      parts: Array.isArray(message.content) ? message.content.map(part => part.type) : [],
      toolCallCount: 'tool_calls' in message ? message.tool_calls?.length || 0 : 0 })),
    tools: body.tools?.map(tool => tool.function.name) || [],
    toolSchemaHash: createHash('sha256').update(JSON.stringify(body.tools || [])).digest('hex'),
    responseFormat: body.response_format?.type ?? null,
    nativeOutputSchemaHash: body.response_format ? createHash('sha256').update(JSON.stringify(body.response_format)).digest('hex') : null,
    toolChoice: body.tool_choice === undefined ? null : typeof body.tool_choice === 'string' ? body.tool_choice : 'named_function',
  };
}

export function parseAgentUsage(value: unknown):ModelTurnOutput['usage'] {
  const rawUsage = asObject(value);
  const input = rawUsage.prompt_tokens, output = rawUsage.completion_tokens;
  const usage = input === undefined && output === undefined ? null :
    Number.isSafeInteger(input) && Number.isSafeInteger(output) && Number(input) >= 0 && Number(output) >= 0
      ? { inputTokens: Number(input), outputTokens: Number(output) } : invalid();
  if (usage) {
    const cached = asObject(rawUsage.prompt_tokens_details).cached_tokens;
    const written = asObject(rawUsage.prompt_tokens_details).cache_creation_input_tokens ?? rawUsage.cache_creation_input_tokens;
    for (const [key, item] of [['cachedInputTokens', cached], ['cacheWriteInputTokens', written]] as const) {
      if (item === undefined || item === null) continue;
      if (!Number.isSafeInteger(item) || Number(item) < 0 || Number(item) > usage.inputTokens) return invalid();
      Object.assign(usage, { [key]: Number(item) });
    }
  }
  return usage;
}
export function parseAgentChat(payload: Record<string, unknown>, requestId: string | null = null): ModelTurnOutput {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  if (choices.length !== 1) return invalid();
  const choice = asObject(choices[0]), message = asObject(choice.message);
  // Compatible chat responses may explicitly encode the absence of calls as
  // null. This does not create a call or excuse an empty/truncated response.
  const rawCalls = message.tool_calls == null ? [] : message.tool_calls;
  if (!Array.isArray(rawCalls) || rawCalls.length > agentModelLimits.maxToolCalls) return invalid();
  const seen = new Set<string>();
  const toolCalls = rawCalls.map(raw => {
    const call = asObject(raw), fn = asObject(call.function);
    if (call.type !== 'function' || typeof call.id !== 'string' || !/^[\w-]{1,128}$/.test(call.id) || seen.has(call.id)
      || typeof fn.name !== 'string' || !/^[\w-]{1,64}$/.test(fn.name) || typeof fn.arguments !== 'string' || fn.arguments.length > 8000) return invalid();
    seen.add(call.id);
    try { const value = JSON.parse(fn.arguments); if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(); } catch { return invalid(); }
    return { id: call.id, name: fn.name, arguments: fn.arguments };
  });
  const text = typeof message.content === 'string' ? message.content : '';
  if ((!text.trim() && !toolCalls.length) || text.length > 16000 || !['stop', 'tool_calls'].includes(String(choice.finish_reason))) return invalid();
  const usage = parseAgentUsage(payload.usage);
  return { text, toolCalls, finishReason: String(choice.finish_reason), usage,
    providerRequestId: requestId?.slice(0, 200) || (typeof payload.id === 'string' ? payload.id.slice(0, 200) : null) };
}

export function agentResponseDiagnostic(payload: Record<string, unknown>, requestId: string | null = null): ProviderResponseDiagnostic {
  const encoded = JSON.stringify(payload), choices = Array.isArray(payload.choices) ? payload.choices : [];
  const choice = asObject(choices[0]), message = asObject(choice.message), usage = asObject(payload.usage), details = asObject(usage.prompt_tokens_details);
  const number = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
  return { protocol: 'provider-response-diagnostic-v1', requestId: requestId?.slice(0, 200) || null,
    responseHash: createHash('sha256').update(encoded).digest('hex'), responseBytes: Buffer.byteLength(encoded),
    choices: Array.isArray(payload.choices) ? choices.length : null,
    finishReason: typeof choice.finish_reason === 'string' && /^[\w-]{1,32}$/.test(choice.finish_reason) ? choice.finish_reason : null,
    contentType: message.content === null ? 'null' : Array.isArray(message.content) ? 'array' : typeof message.content,
    contentChars: typeof message.content === 'string' ? message.content.length : 0,
    calls: (Array.isArray(message.tool_calls) ? message.tool_calls : []).slice(0, 5).map(raw => {
      const call = asObject(raw), fn = asObject(call.function); let argumentsObject = false;
      if (typeof fn.arguments === 'string') try { const value = JSON.parse(fn.arguments); argumentsObject = !!value && typeof value === 'object' && !Array.isArray(value); } catch { /* Shape only. */ }
      return { idValid: typeof call.id === 'string' && /^[\w-]{1,128}$/.test(call.id), type: call.type === 'function' ? 'function' : 'other',
        nameValid: typeof fn.name === 'string' && /^[\w-]{1,64}$/.test(fn.name), argumentsType: typeof fn.arguments,
        argumentsBytes: typeof fn.arguments === 'string' ? Buffer.byteLength(fn.arguments) : 0, argumentsObject };
    }), usage: { input: number(usage.prompt_tokens), output: number(usage.completion_tokens), cached: number(details.cached_tokens),
      written: number(details.cache_creation_input_tokens ?? usage.cache_creation_input_tokens) },
  };
}

/** Saved1608 contains a complete JSON object followed by one unmatched closing
 * brace. Strip only that exact, value-preserving surface; never complete a
 * truncated object, repair a token, extract prose or touch quoted strings. */
export function completeJsonBeforeExtraBrace(raw: string): string | null {
  if (raw.length > 8000) return null;
  const text = raw.trim(); if (!text.startsWith('{')) return null;
  const stack: string[] = []; let quoted = false, escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') { quoted = true; continue; }
    if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' || char === ']') {
      if (stack.pop() !== (char === '}' ? '{' : '[')) return null;
      if (!stack.length) {
        const original = text.slice(0, index + 1);
        if (text.slice(index + 1).trim() !== '}') return null;
        try { const value = JSON.parse(original); return value && typeof value === 'object' && !Array.isArray(value) ? original : null; }
        catch { return null; }
      }
    }
  }
  return null;
}

/** No transport retries or provider fallback: an unknown accepted request may already be billable. */
export async function executeAgentChat(runtime: AiProviderRuntimeConfig, input: ModelTurnInput): Promise<ModelTurnOutput> {
  const body = agentChatBody(input, runtime.baseUrl);
  const started = Date.now();
  const response = await providerFetch(providerUrl(runtime.baseUrl, '/v1/chat/completions'), {
    method: 'POST', headers: bearerHeaders(runtime.apiKey), body: JSON.stringify(body),
  }, Math.min(runtime.timeoutMs, 90000), 'Assistant model', { redactErrorBody: true });
  const payload = await parseJson(response, 'Assistant model');
  const requestId = response.headers.get('x-siliconcloud-trace-id') || response.headers.get('x-request-id');
  let decodePayload = payload, wireNormalization: ModelTurnOutput['wireNormalization'];
  // Exact observed model/official transport/final channel only. All business
  // tools retain their strict wire grammar and existing schema/permission gate.
  if (input.outputMode !== 'function_call' && input.model === 'qwen3.7-flash' && bailianBinding(runtime.baseUrl, input.model, input.enableThinking)
    && input.tools.length === 1 && input.tools[0].name === 'final_response'
    && Array.isArray(payload.choices) && payload.choices.length === 1) {
    const message = asObject(asObject(payload.choices[0]).message), calls = message.tool_calls;
    if (Array.isArray(calls) && calls.length === 1) {
      const fn = asObject(asObject(calls[0]).function);
      const normalized = fn.name === 'final_response' && typeof fn.arguments === 'string' ? completeJsonBeforeExtraBrace(fn.arguments) : null;
      if (normalized) {
        decodePayload = structuredClone(payload);
        const cloned = asObject(asObject((decodePayload.choices as unknown[])[0]).message);
        asObject(asObject((cloned.tool_calls as unknown[])[0]).function).arguments = normalized;
        wireNormalization = { protocol: 'qwen37-final-trailing-brace-v1', rawArguments: fn.arguments as string,
          normalizedHash: createHash('sha256').update(normalized).digest('hex') };
      }
    }
  }
  let output: ModelTurnOutput;
  try { output = parseAgentChat(decodePayload, requestId); }
  catch (error) {
    if (!(error instanceof AiProviderError) || error.code !== 'INVALID_PROVIDER_RESPONSE') throw error;
    const encoded = JSON.stringify(payload);
    throw new AiProviderError(error.message, error.code, error.disposition, error.status, agentResponseDiagnostic(payload, requestId),
      Buffer.byteLength(encoded) <= 64000 ? { protocol: 'invalid-provider-frame-v1', payload } : undefined);
  }
  let format: NonNullable<ModelTurnOutput['observation']>['format'];
  if(body.response_format) {
    let jsonValid=false,objectValid=false;
    try {const value=JSON.parse(output.text);jsonValid=true;objectValid=!!value&&typeof value==='object'&&!Array.isArray(value);} catch { /* Raw text and usage remain auditable. */ }
    const definition=input.tools.length===1&&input.tools[0].name==='final_response'?input.tools[0]:null;
    format={mode:body.response_format.type,jsonValid,schemaValid:!objectValid||output.toolCalls.length?false
      :definition?!await toolSchemaIssue(definition,output.text):null};
  } else if (input.outputMode === 'function_call') {
    // The function is a terminal response carrier, never a business dispatch.
    // Keep its raw packet; the existing final projection unwraps it only after
    // this same LangChain schema check. No provider JSON-Schema claim or repair.
    const call = output.toolCalls.length === 1 && output.toolCalls[0].name === 'final_response' ? output.toolCalls[0] : null;
    format = { mode: 'function_call', jsonValid: !!call,
      schemaValid: !!call && !await toolSchemaIssue(input.tools[0], call.arguments), schemaValidation: 'application' };
  }
  return { ...output, ...(wireNormalization ? { wireNormalization } : {}), observation: { latencyMs: Date.now() - started, cache: cacheObservation(output.usage),
    prefix: modelPrefixObservation(input.messages, input.tools),...(format?{format}:{}) } };
}
