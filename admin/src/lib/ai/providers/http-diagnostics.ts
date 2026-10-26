import { createHash } from 'node:crypto';
import type { ProviderHttpDiagnostic } from '../provider-types';

const codes = new Set(['invalid_request_error', 'invalid_api_key', 'insufficient_quota', 'model_not_found',
  'unsupported_parameter', 'invalid_parameter', 'context_length_exceeded', 'rate_limit_exceeded',
  'invalid_value', 'invalid_type', 'missing_required_parameter', 'invalid_function_parameters', 'tool_use_failed']);
const types = new Set(['invalid_request_error', 'authentication_error', 'permission_error', 'not_found_error',
  'rate_limit_error', 'server_error', 'invalid_request', 'invalid_value', 'invalid_type']);
const fields = new Set(['model', 'messages', 'role', 'content', 'tool_calls', 'tool_call_id', 'tools', 'type',
  'function', 'name', 'description', 'parameters', 'properties', 'required', 'additionalProperties', 'tool_choice',
  'parallel_tool_calls', 'max_tokens', 'temperature', 'response_format', 'json_schema', 'enable_thinking',
  'thinking', 'thinking_budget', 'stream', 'n']);
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** An error may echo credentials, private URLs or whole prompts. Retain only
 * fixed categories, structural paths and hashes. Unknown prose is not saved. */
export function providerHttpDiagnostic(response: Response, body: string): ProviderHttpDiagnostic {
  let payload: Record<string, unknown> = {};
  if (Buffer.byteLength(body) <= 65536) {
    try { payload = object(JSON.parse(body)); } catch { /* Plain/HTML errors retain size/hash only. */ }
  }
  const error = Object.keys(object(payload.error)).length ? object(payload.error) : payload;
  const code = error.code;
  const providerCode = typeof code === 'number' && Number.isSafeInteger(code) && code >= 0 && code <= 99999999 ? code
    : typeof code === 'string' && (/^\d{1,8}$/.test(code) || codes.has(code)) ? code : null;
  const errorType = typeof error.type === 'string' && types.has(error.type) ? error.type : null;
  const param = typeof error.param === 'string' ? error.param : typeof error.parameter === 'string' ? error.parameter : '';
  const parameter = param.length <= 160 && param.split('.').every(part => fields.has(part) || /^\d{1,3}$/.test(part)) ? param || null : null;
  const message = typeof error.message === 'string' ? error.message.slice(0, 2000) : '';
  const reason: ProviderHttpDiagnostic['reason'] = /(?:function calling|tools?).{0,60}(?:not supported|unsupported)|does not support.{0,40}(?:tools?|function calling)/i.test(message)
    ? 'unsupported_tools' : /(?:invalid|unsupported).{0,30}(?:schema|function parameters)|schema.{0,30}(?:invalid|unsupported)/i.test(message)
      ? 'invalid_schema' : /context.{0,30}(?:length|limit)|maximum context/i.test(message) ? 'context_limit'
        : parameter?.startsWith('messages') ? 'invalid_messages' : 'unspecified';
  const trace = response.headers.get('x-siliconcloud-trace-id') || response.headers.get('x-request-id');
  const requestId = trace && /^[\w.:-]{1,200}$/.test(trace) && !/^(?:sk-|bearer|key-)/i.test(trace) ? trace : null;
  return { protocol: 'provider-http-diagnostic-v1', httpStatus: response.status, providerCode, errorType, parameter,
    reason, requestId, responseBytes: Buffer.byteLength(body), responseHash: createHash('sha256').update(body).digest('hex') };
}
