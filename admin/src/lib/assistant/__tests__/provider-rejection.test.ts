import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AiProviderError, type ProviderHttpDiagnostic } from '@/lib/ai/provider-types';
import { agentRejectionAudited, isDefiniteAgentRejection } from '../agent/provider-rejection';

const diagnostic: ProviderHttpDiagnostic = { protocol: 'provider-http-diagnostic-v1', httpStatus: 400,
  providerCode: 'invalid_type', errorType: 'invalid_request_error', parameter: 'messages.0.content',
  reason: 'invalid_messages', requestId: 'synthetic', responseBytes: 20, responseHash: 'a'.repeat(64) };
const rejection = () => new AiProviderError('Synthetic rejection', 'HTTP_400', 'safe_fallback', 400, diagnostic);
const dispatch = { status: 'running', input_summary: { turn: 0, purpose: 'answer' } };
const attempt = { status: 'failed', accepted: false, error_code: 'HTTP_400',
  metadata: { turn: 0, purpose: 'answer', providerFailure: diagnostic } };

test('a bound durable rejection establishes failure without adding usage or billing evidence', () => {
  const error = rejection(), before = JSON.stringify({ diagnostic, dispatch, attempt });
  assert.equal(isDefiniteAgentRejection(error), true);
  assert.equal(agentRejectionAudited(error, dispatch, [attempt]), true);
  assert.equal(JSON.stringify({ diagnostic, dispatch, attempt }), before);
  assert.equal('usage' in error, false); assert.equal('cost' in error, false);
});

test('transport ambiguity, late gateway errors and incomplete responses stay unknown', () => {
  for (const status of [408, 409, 499, 500, 502, 503, 504]) {
    const error = new AiProviderError('Synthetic', `HTTP_${status}`, 'safe_fallback', status, { ...diagnostic, httpStatus: status });
    assert.equal(isDefiniteAgentRejection(error), false);
  }
  for (const error of [new AiProviderError('timeout', 'PROVIDER_TIMEOUT', 'unknown', 504),
    new AiProviderError('connection', 'PROVIDER_CONNECTION_FAILED', 'safe_fallback', 502),
    new AiProviderError('bad JSON', 'INVALID_PROVIDER_RESPONSE', 'unknown', 502),
    new AiProviderError('missing audit', 'HTTP_400', 'safe_fallback', 400), new Error('HTTP_400')]) {
    assert.equal(agentRejectionAudited(error, dispatch, [attempt]), false);
  }
});

test('an old or missing dispatch audit never licenses recovery of another call', () => {
  for (const changed of [{ ...dispatch, status: 'succeeded' }, undefined,
    { ...dispatch, input_summary: { turn: 1, purpose: 'answer' } },
    { ...dispatch, input_summary: { turn: 0, purpose: 'summary' } },
    { ...dispatch, input_summary: null }]) assert.equal(agentRejectionAudited(rejection(), changed, [attempt]), false);
  assert.equal(agentRejectionAudited(rejection(), dispatch, []), false);
  for (const changed of [{ ...attempt, accepted: true }, { ...attempt, status: 'unknown' },
    { ...attempt, error_code: 'HTTP_503' }, { ...attempt, metadata: null },
    { ...attempt, metadata: { ...attempt.metadata, providerFailure: { ...diagnostic, responseHash: 'b'.repeat(64) } } },
    { ...attempt, metadata: { ...attempt.metadata, providerFailure: { ...diagnostic, httpStatus: 401 } } }]) {
    assert.equal(agentRejectionAudited(rejection(), dispatch, [changed]), false);
  }
});

test('a prior unresolved attempt stays blocking even after a later explicit rejection', () => {
  for (const prior of [{ status: 'created', accepted: false }, { status: 'unknown', accepted: true },
    { status: 'failed', accepted: false, error_code: 'PROVIDER_CONNECTION_FAILED' },
    { ...attempt, metadata: { turn: 0, purpose: 'answer' } }]) {
    assert.equal(agentRejectionAudited(rejection(), dispatch, [prior, attempt]), false);
  }
  assert.equal(agentRejectionAudited(rejection(), dispatch, [{ status: 'succeeded', accepted: true }, attempt]), true);
});
