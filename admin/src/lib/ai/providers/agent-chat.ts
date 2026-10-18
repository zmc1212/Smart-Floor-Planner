import { AiProviderError, type AiProviderRuntimeConfig } from '../provider-types';
import { agentModelLimits, type ModelTurnInput, type ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { bearerHeaders, parseJson, providerFetch, providerUrl, asObject } from './http';
import { thinkingBody } from './thinking';

const invalid = () => { throw new AiProviderError('Invalid Agent model response', 'INVALID_PROVIDER_RESPONSE', 'unknown', 502); };
export function agentChatBody(input: ModelTurnInput, baseUrl = 'https://api.siliconflow.cn') {
  if (!Number.isInteger(input.maxTokens) || input.maxTokens < 1 || input.maxTokens > agentModelLimits.maxOutputTokens) throw Error('agent_input_limit');
  let images = 0, textBytes = 0;
  const messages = input.messages.map(message => {
    if (message.role === 'system' && new URL(baseUrl).origin === 'https://api.deepseek.com') {
      if (message.content.some(part => part.type !== 'text')) throw Error('agent_image_limit');
      const content = message.content.map(part => part.type === 'text' ? part.text : '').join('\n');
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
  return { model: input.model, messages, temperature: 0, max_tokens: input.maxTokens,
    ...(input.jsonOutput ? { response_format: { type: 'json_object' } } : {}),
    ...thinkingBody(baseUrl, input.enableThinking),
    ...(input.tools.length ? { tools: input.tools.map(tool => ({ type: 'function', function: tool })), tool_choice: input.requireTool ? 'required' : 'auto', parallel_tool_calls: false } : {}) };
}

export function parseAgentChat(payload: Record<string, unknown>, requestId: string | null = null): ModelTurnOutput {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  if (choices.length !== 1) return invalid();
  const choice = asObject(choices[0]), message = asObject(choice.message);
  const rawCalls = message.tool_calls === undefined ? [] : message.tool_calls;
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
  const rawUsage = asObject(payload.usage);
  const input = rawUsage.prompt_tokens, output = rawUsage.completion_tokens;
  const usage = input === undefined && output === undefined ? null :
    Number.isSafeInteger(input) && Number.isSafeInteger(output) && Number(input) >= 0 && Number(output) >= 0
      ? { inputTokens: Number(input), outputTokens: Number(output) } : invalid();
  return { text, toolCalls, finishReason: String(choice.finish_reason), usage,
    providerRequestId: requestId?.slice(0, 200) || (typeof payload.id === 'string' ? payload.id.slice(0, 200) : null) };
}

/** No transport retries or provider fallback: an unknown accepted request may already be billable. */
export async function executeAgentChat(runtime: AiProviderRuntimeConfig, input: ModelTurnInput): Promise<ModelTurnOutput> {
  const body = agentChatBody(input, runtime.baseUrl);
  const response = await providerFetch(providerUrl(runtime.baseUrl, '/v1/chat/completions'), {
    method: 'POST', headers: bearerHeaders(runtime.apiKey), body: JSON.stringify(body),
  }, Math.min(runtime.timeoutMs, 90000), 'Assistant model');
  return parseAgentChat(await parseJson(response, 'Assistant model'), response.headers.get('x-siliconcloud-trace-id') || response.headers.get('x-request-id'));
}
