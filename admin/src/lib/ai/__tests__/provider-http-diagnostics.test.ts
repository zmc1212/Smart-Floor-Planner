import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { AiProviderError } from '../provider-types';
import { providerFetch } from '../providers/http';
import { providerHttpDiagnostic } from '../providers/http-diagnostics';
import { agentChatBody, agentChatRequestDiagnostic } from '../providers/agent-chat';

test('HTTP rejection retains safe upstream code, parameter and trace without echoing private prose', async () => {
  const previous = globalThis.fetch;
  let dispatches = 0;
  const privateText = 'synthetic-private-customer-body';
  const body = JSON.stringify({ error: { code: 'invalid_type', type: 'invalid_request_error', param: 'messages.0.content',
    message: `Expected a string; received ${privateText} and sk-synthetic-never-save`, data: { prompt: privateText } } });
  globalThis.fetch = async () => { dispatches++; return new Response(body, { status: 400, headers: { 'x-request-id': 'trace-synthetic-400' } }); };
  try {
    await assert.rejects(providerFetch('https://fixture.invalid', {}, 1000, 'Assistant model', { redactErrorBody: true }), error => {
      assert.ok(error instanceof AiProviderError);
      assert.equal(error.code, 'HTTP_400'); assert.equal(error.status, 400); assert.equal(error.disposition, 'safe_fallback');
      assert.deepEqual(error.diagnostic, { protocol: 'provider-http-diagnostic-v1', httpStatus: 400,
        providerCode: 'invalid_type', errorType: 'invalid_request_error', parameter: 'messages.0.content',
        reason: 'invalid_messages', requestId: 'trace-synthetic-400', responseBytes: Buffer.byteLength(body),
        responseHash: createHash('sha256').update(body).digest('hex') });
      assert.ok(!JSON.stringify(error.diagnostic).includes(privateText));
      assert.ok(!JSON.stringify(error.diagnostic).includes('sk-synthetic'));
      assert.ok(!error.message.includes(privateText)); assert.ok(!error.message.includes('sk-synthetic'));
      return true;
    });
    assert.equal(dispatches, 1, 'No automatic retry after a known rejection');
  } finally { globalThis.fetch = previous; }
});

test('untrusted fields, HTML, oversized bodies and secret-shaped traces retain no arbitrary values', () => {
  const privateText = 'sk-synthetic-secret';
  for (const body of [JSON.stringify({ error: { code: privateText, type: privateText, param: `messages.${privateText}`, message: privateText } }),
    `<html>${privateText}</html>`, 'x'.repeat(65537) + privateText]) {
    const d = providerHttpDiagnostic(new Response(body, { status: 400, headers: { 'x-request-id': privateText } }), body);
    assert.equal(d.providerCode, null); assert.equal(d.parameter, null); assert.equal(d.errorType, null); assert.equal(d.requestId, null);
    assert.equal(d.reason, 'unspecified'); assert.ok(!JSON.stringify(d).includes(privateText));
  }
});

test('provider categories remain bounded and do not turn a diagnosis into billing evidence', () => {
  for (const [message, reason] of [['This model does not support tools.', 'unsupported_tools'],
    ['Invalid function parameters schema', 'invalid_schema'], ['Maximum context length exceeded', 'context_limit'], ['unknown upstream error', 'unspecified']]) {
    const body = JSON.stringify({ code: 20012, message });
    const d = providerHttpDiagnostic(new Response(body, { status: 400 }), body);
    assert.equal(d.providerCode, 20012); assert.equal(d.reason, reason);
    assert.equal('accepted' in d, false); assert.equal('cost' in d, false); assert.equal('usage' in d, false);
  }
});

test('exact Agent wire shape is bound without text, image data or tool arguments', () => {
  const body = agentChatBody({ model: 'fixture', maxTokens: 128, tools: [{ name: 'final_response', description: 'synthetic-private-description', parameters: { type: 'object' } }],
    messages: [{ role: 'system', content: [{ type: 'text', text: 'synthetic-private-system' }] },
      { role: 'user', content: [{ type: 'text', text: 'synthetic-private-question' }, { type: 'image', mediaId: '1', hash: 'fixture', mimeType: 'image/png', data: 'c3ludGhldGlj' }] },
      { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'final_response', arguments: '{"private":"synthetic-private-arguments"}' }] },
      { role: 'tool', callId: 'call-1', content: 'synthetic-private-receipt' }], requireTool: true });
  const before = JSON.stringify(body), d = agentChatRequestDiagnostic(body);
  assert.equal(d.payloadHash, createHash('sha256').update(before).digest('hex'));
  assert.equal(d.payloadBytes, Buffer.byteLength(before)); assert.equal(d.toolChoice, 'named_function');
  assert.deepEqual(d.messages.map(m => [m.role, m.contentType, m.parts, m.toolCallCount]), [
    ['system', 'array', ['text'], 0], ['user', 'array', ['text', 'image_url'], 0], ['assistant', 'null', [], 1], ['tool', 'string', [], 0],
  ]);
  assert.ok(!JSON.stringify(d).includes('synthetic-private')); assert.ok(!JSON.stringify(d).includes('c3ludGhldGlj'));
  assert.equal(JSON.stringify(body), before, 'Diagnostics must not alter the outgoing request');
});

test('ambiguous transport failures retain their unknown disposition and never gain HTTP rejection evidence', async () => {
  const previous = globalThis.fetch;
  let dispatches = 0;
  globalThis.fetch = async () => { dispatches++; throw new DOMException('synthetic timeout', 'TimeoutError'); };
  try {
    await assert.rejects(providerFetch('https://fixture.invalid', {}, 1000, 'Assistant model'), error => {
      assert.ok(error instanceof AiProviderError); assert.equal(error.code, 'PROVIDER_TIMEOUT');
      assert.equal(error.disposition, 'unknown'); assert.equal(error.diagnostic, undefined); return true;
    });
    assert.equal(dispatches, 1);
  } finally { globalThis.fetch = previous; }
});
