import assert from 'node:assert/strict';
import { test } from 'node:test';
import { privateAgentFailureFrame } from '@/lib/ai/postgres-workflow-chat';
import { AiProviderError, isSafeProviderFallback } from '@/lib/ai/provider-types';
import { agentResponseDiagnostic, parseAgentChat } from '@/lib/ai/providers/agent-chat';
import { reportNativeFinalProtocol } from '../agent/report-native-final';
import { nativeFinalProjection } from '../agent/native-final';
import { nativeImageFinalProjection } from '../agent/image-context';
import type { InvocationOwner } from '../contracts';

const owner: InvocationOwner = { kind: 'assistant_run', runId: 1n };
const metadata = { turn: 2, purpose: 'answer', reportNativeFinal: reportNativeFinalProtocol, nativeFinalProjection: nativeImageFinalProjection };
const payload = { choices: [{ finish_reason: 'length', message: { content: '{"kind":"report_answer","answers":', tool_calls: null } }],
  usage: { prompt_tokens: 5165, completion_tokens: 2048 } };
const frame = { protocol: 'invalid-provider-frame-v1', payload };
const error = new AiProviderError('Invalid Agent model response', 'INVALID_PROVIDER_RESPONSE', 'unknown', 502, agentResponseDiagnostic(payload), frame);

test('truncated report native frames retain exact private evidence while invalid/unknown/no-fallback behavior stays intact', () => {
  assert.throws(() => parseAgentChat(payload), /Invalid Agent model response/);
  assert.equal(privateAgentFailureFrame(owner, metadata, error), frame);
  assert.equal(privateAgentFailureFrame(owner, { ...metadata, nativeFinalProjection }, error), frame);
  assert.deepEqual(error.diagnostic?.protocol, 'provider-response-diagnostic-v1');
  assert.equal(error.disposition, 'unknown'); assert.equal(isSafeProviderFallback(error), false);
  assert.equal(JSON.stringify(error).includes('report_answer'), false);
  assert.equal(JSON.stringify(error).includes('privateResponse'), false);
});

test('ordinary, wrong-purpose, wrong-protocol and out-of-range calls cannot opt into report frame retention', () => {
  for (const changed of [{ reportNativeFinal: undefined }, { reportNativeFinal: 'unknown' }, { purpose: 'summary' },
    { nativeFinalProjection: 'unknown' }, { turn: -1 }, { turn: 4 }, { turn: 2.5 }])
    assert.equal(privateAgentFailureFrame(owner, { ...metadata, ...changed }, error), null);
  assert.equal(privateAgentFailureFrame({ kind: 'knowledge_job', jobId: 1n }, metadata, error), null);
  assert.equal(privateAgentFailureFrame({ kind: 'generation', generationId: 1n }, metadata, error), null);
  assert.equal(privateAgentFailureFrame(owner, metadata, new Error('transport failed')), null);
});

test('original knowledge-explanation private frames remain supported; malformed/oversize data stays out of checkpoints', () => {
  assert.equal(privateAgentFailureFrame(owner, { turn: -3, sourceAnswerMode: 'reviewed-knowledge-explanation-v1' }, error), frame);
  for (const raw of [{ protocol: 'unknown', payload }, { ...frame, padding: 'x'.repeat(64000) }])
    assert.equal(privateAgentFailureFrame(owner, metadata, new AiProviderError('invalid', 'INVALID_PROVIDER_RESPONSE', 'unknown', 502, undefined, raw)), null);
  assert.equal(privateAgentFailureFrame(owner, metadata, new AiProviderError('invalid', 'INVALID_PROVIDER_RESPONSE', 'unknown')), null);
});
