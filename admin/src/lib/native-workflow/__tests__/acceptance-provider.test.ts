import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluateAcceptanceProviderReadiness,
  type AcceptancePlatformConfig,
  type AcceptanceProviderRow,
} from '../live/acceptance-provider';

const PROVIDER: AcceptanceProviderRow = {
  key: 'llm-settings-override',
  enabled: true,
  adapter_type: 'openai_compatible',
  base_url: 'https://dashscope.aliyuncs.com/compatible-mode',
  api_key_masked: 'sk-ws***mDW9',
};

const PLATFORM: AcceptancePlatformConfig = {
  enabled: true,
  providerKey: 'dashscope',
  model: 'qwen3.7-flash',
  apiKeyMasked: 'sk-ws***mDW9',
};

test('an enabled B provider and platform are reused without a copy', () => {
  const readiness = evaluateAcceptanceProviderReadiness({ provider: PROVIDER, platform: PLATFORM });
  assert.equal(readiness.ok, true);
  if (!readiness.ok) return;
  assert.equal(readiness.provider.key, 'llm-settings-override');
  assert.equal(readiness.provider.enabled, true);
  assert.equal(readiness.platform.enabled, true);
});

test('a missing B provider stops before any copy or report enqueue', () => {
  const readiness = evaluateAcceptanceProviderReadiness({ provider: null, platform: PLATFORM });
  assert.equal(readiness.ok, false);
  if (readiness.ok) return;
  assert.match(readiness.error, /llm-settings-override provider is missing/u);
  assert.match(readiness.error, /separate step/u);
});

test('a disabled B provider is rejected instead of being replaced', () => {
  const readiness = evaluateAcceptanceProviderReadiness({
    provider: { ...PROVIDER, enabled: false },
    platform: PLATFORM,
  });
  assert.equal(readiness.ok, false);
  if (readiness.ok) return;
  assert.match(readiness.error, /provider is disabled/u);
});

test('a missing platform override stops before report enqueue', () => {
  const readiness = evaluateAcceptanceProviderReadiness({ provider: PROVIDER, platform: null });
  assert.equal(readiness.ok, false);
  if (readiness.ok) return;
  assert.match(readiness.error, /platform LLM override is missing/u);
});

test('a disabled platform override is rejected', () => {
  const readiness = evaluateAcceptanceProviderReadiness({
    provider: PROVIDER,
    platform: { ...PLATFORM, enabled: false },
  });
  assert.equal(readiness.ok, false);
  if (readiness.ok) return;
  assert.match(readiness.error, /platform LLM override is disabled/u);
});

test('a provider row without an explicit enabled flag is rejected', () => {
  const readiness = evaluateAcceptanceProviderReadiness({
    provider: { ...PROVIDER, enabled: null },
    platform: PLATFORM,
  });
  assert.equal(readiness.ok, false);
  if (readiness.ok) return;
  assert.match(readiness.error, /provider is disabled/u);
});
