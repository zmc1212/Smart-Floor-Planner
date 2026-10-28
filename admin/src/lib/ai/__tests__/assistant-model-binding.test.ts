import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boundAssistantModel } from '../postgres-workflow-chat';

const runtime = { key: 'llm-settings-override', adapterType: 'openai_compatible' as const,
  adapterConfig: { providerPreset: 'siliconflow' }, modelMappings: { 'chat.general': 'THUDM/GLM-4-9B-0414' } };
const agent = { model: 'Qwen/Qwen3.5-4B', providerKey: 'siliconflow' };

test('enterprise Qwen binding survives a different global chatbot model without changing either configuration', () => {
  const before = JSON.stringify({ runtime, agent });
  assert.equal(boundAssistantModel(runtime, agent), 'Qwen/Qwen3.5-4B');
  assert.equal(boundAssistantModel(runtime, agent, ' Qwen/Qwen3.5-4B '), 'Qwen/Qwen3.5-4B');
  assert.equal(JSON.stringify({ runtime, agent }), before);
});

test('a mismatched provider, adapter or deployment override cannot bypass the capability binding', () => {
  for (const changed of [{ ...runtime, adapterConfig: { providerPreset: 'dashscope' } },
    { ...runtime, adapterType: 'grs' as const }, { ...runtime, adapterConfig: undefined }]) {
    assert.throws(() => boundAssistantModel(changed, agent), /capability probe/);
  }
  assert.throws(() => boundAssistantModel(runtime, agent, 'THUDM/GLM-4-9B-0414'), /capability probe/);
  assert.equal(boundAssistantModel({ ...runtime, key: 'siliconflow', adapterConfig: undefined }, agent), agent.model);
});
