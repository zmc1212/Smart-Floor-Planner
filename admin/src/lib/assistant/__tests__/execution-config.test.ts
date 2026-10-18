import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capabilityForLogicalModel, type AiProviderRuntimeConfig } from '@/lib/ai/provider-types';
import { workflowTextModel, workflowTextThinking } from '@/lib/ai/workflow-text-runtime';
import { AssistantError, fingerprint } from '../contracts';
import { answerMessages } from '../knowledge/answer';
import { retrievalConfiguration } from '../knowledge/retrieval';
import { assertPreviewTextConfiguration, previewTextConfiguration, readPreviewExecution, type PreviewExecutionSnapshot } from '../core/execution-config';

const runtime: AiProviderRuntimeConfig = { id: '5', key: 'synthetic-config', name: 'Synthetic only', adapterType: 'openai_compatible',
  baseUrl: 'https://api.deepseek.com/v1', apiKey: 'synthetic-no-real-credential', adapterConfig: { providerPreset: 'deepseek' },
  capabilities: [capabilityForLogicalModel('chat.general')], modelMappings: { 'chat.general': 'synthetic-model' }, timeoutMs: 120000 };
const input = () => ({ messages: answerMessages('', [], []), temperature: 0, maxTokens: 2048 });
function snapshot(): PreviewExecutionSnapshot {
  const body = { version: 1 as const, mode: 'knowledge_preview' as const, text: previewTextConfiguration(runtime, 'synthetic-model', false, input()),
    index: { profileId: '7', profileHash: 'a'.repeat(64), knowledgeEpoch: 2, policyVersion: 1 },
    scope: { audience: 'customer_public' as const, draftVersionIds: [] as string[] }, retrievalHash: fingerprint(retrievalConfiguration) };
  return { ...body, revision: fingerprint(body) };
}
const contextChanged = (error: unknown) => error instanceof AssistantError && error.code === 'context_changed';

test('effective deployment model and thinking settings use the actual invocation resolver', t => {
  const previousModel = process.env.ASSISTANT_TEXT_MODEL, previousThinking = process.env.ASSISTANT_TEXT_DISABLE_THINKING;
  t.after(() => {
    if (previousModel === undefined) delete process.env.ASSISTANT_TEXT_MODEL; else process.env.ASSISTANT_TEXT_MODEL = previousModel;
    if (previousThinking === undefined) delete process.env.ASSISTANT_TEXT_DISABLE_THINKING; else process.env.ASSISTANT_TEXT_DISABLE_THINKING = previousThinking;
  });
  process.env.ASSISTANT_TEXT_MODEL = ' synthetic-deployed-model ';
  process.env.ASSISTANT_TEXT_DISABLE_THINKING = '1';
  assert.equal(workflowTextModel(runtime, 'chat.general', true), 'synthetic-deployed-model');
  assert.equal(workflowTextModel({ ...runtime, modelMappings: { 'chat.general': 'different-stored-model' } }, 'chat.general', true), 'synthetic-deployed-model');
  assert.equal(workflowTextModel(runtime, 'chat.general', false), 'synthetic-model');
  assert.equal(workflowTextThinking(runtime, true), false);
  assert.throws(() => workflowTextThinking({ ...runtime, baseUrl: 'https://unapproved.invalid' }, true));
});

test('revision inputs exclude credentials, display names and non-chat adapter values', () => {
  const original = previewTextConfiguration(runtime, 'synthetic-model', false, input());
  const rotated = previewTextConfiguration({ ...runtime, apiKey: 'different-synthetic-secret', name: 'Renamed',
    baseUrl: 'https://user:password@api.deepseek.com/v1?api_key=synthetic-query-secret',
    adapterConfig: { providerPreset: 'deepseek', apiKey: 'synthetic-adapter-secret', imageOnly: true } }, 'synthetic-model', false, input());
  assert.deepEqual(rotated, original);
  const serialized = JSON.stringify(rotated);
  for (const token of ['password', 'synthetic-query-secret', 'synthetic-adapter-secret', 'different-synthetic-secret']) assert.ok(!serialized.includes(token));
  assert.equal(rotated.modelRevision, null, 'Do not invent an immutable vendor model revision');
});

test('actual model, provider, endpoint, thinking, prompt and generation drift reject the pinned dispatch', () => {
  const pinned = snapshot();
  assert.doesNotThrow(() => assertPreviewTextConfiguration(pinned, runtime, 'synthetic-model', false, input()));
  const checks = [
    () => assertPreviewTextConfiguration(pinned, runtime, 'different-actual-model', false, input()),
    () => assertPreviewTextConfiguration(pinned, { ...runtime, id: '6' }, 'synthetic-model', false, input()),
    () => assertPreviewTextConfiguration(pinned, { ...runtime, baseUrl: 'https://api.deepseek.com/another-path' }, 'synthetic-model', false, input()),
    () => assertPreviewTextConfiguration(pinned, runtime, 'synthetic-model', undefined, input()),
    () => assertPreviewTextConfiguration(pinned, runtime, 'synthetic-model', false, { ...input(), temperature: 1 }),
    () => assertPreviewTextConfiguration(pinned, runtime, 'synthetic-model', false, { ...input(), maxTokens: 4096 }),
    () => assertPreviewTextConfiguration(pinned, runtime, 'synthetic-model', false, { ...input(), messages: [{ role: 'system' as const, content: 'different actual prompt' }] }),
  ];
  for (const check of checks) assert.throws(check, contextChanged);
});

test('public API version is part of endpoint identity while auth query parameters are excluded', () => {
  const plain = previewTextConfiguration(runtime, 'synthetic-model', false, input());
  const versioned = previewTextConfiguration({ ...runtime, baseUrl: runtime.baseUrl + '?api-version=2026-01-01&token=synthetic' }, 'synthetic-model', false, input());
  assert.notEqual(plain.endpointHash, versioned.endpointHash);
});

test('persisted execution snapshots validate their whole revision and explicit preview scope', () => {
  const valid = snapshot();
  assert.deepEqual(readPreviewExecution(JSON.parse(JSON.stringify(valid))), valid);
  assert.throws(() => readPreviewExecution({ ...valid, index: { ...valid.index, knowledgeEpoch: 3 } }), contextChanged);
  const body = { ...valid }; Reflect.deleteProperty(body, 'revision');
  const wrongMode = { ...body, mode: 'agent' };
  assert.throws(() => readPreviewExecution({ ...wrongMode, revision: fingerprint(wrongMode) }), contextChanged);
  const wrongScope = { ...body, scope: { audience: 'customer_public', draftVersionIds: { length: 0 } } };
  assert.throws(() => readPreviewExecution({ ...wrongScope, revision: fingerprint(wrongScope) }), contextChanged);
  const changedRetrieval = { ...body, retrievalHash: 'f'.repeat(64) };
  assert.throws(() => assertPreviewTextConfiguration({ ...changedRetrieval, revision: fingerprint(changedRetrieval) }, runtime, 'synthetic-model', false, input()), contextChanged);
});
