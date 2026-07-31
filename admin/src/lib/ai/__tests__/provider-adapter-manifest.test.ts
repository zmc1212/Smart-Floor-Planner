import assert from 'node:assert/strict';
import test from 'node:test';
import { AI_PROVIDER_ADAPTER_MANIFESTS, validateProviderAdapterConfig } from '@/lib/ai/provider-adapter-manifest';
import { validateProviderPayload } from '@/lib/ai/provider-admin';

test('every supported adapter exposes one API key credential through the shared manifest', () => {
  for (const manifest of Object.values(AI_PROVIDER_ADAPTER_MANIFESTS)) {
    assert.equal(manifest.credentialFields.some((field) => field.key === 'apiKey' && field.required), true);
    assert.equal(manifest.defaultCapabilities.length > 0, true);
  }
});

test('adapter config rejects fields that are not declared by the adapter', () => {
  assert.deepEqual(validateProviderAdapterConfig('grs', {}), {});
  assert.throws(() => validateProviderAdapterConfig('grs', { unsupported: 'value' }), /不支持配置项/);
});

test('partial adapter config updates use the persisted adapter type', () => {
  assert.deepEqual(
    validateProviderPayload({ adapterConfig: {} }, true, 'grs'),
    { adapterConfig: {} }
  );
});
