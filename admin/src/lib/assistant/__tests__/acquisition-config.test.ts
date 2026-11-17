import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  acquisitionBrand,
  acquisitionEntryView,
  configuredAcquisition,
  defaultAcquisitionConfig,
  validateAcquisitionConfig
} from '../acquisition/config';

test('anonymous acquisition entries never expose the service enterprise', () => {
  const enterprise = { name: '某某装饰公司', logo: 'https://cdn.example/logo.png' };
  assert.deepEqual(acquisitionBrand(defaultAcquisitionConfig, enterprise), {
    brandMode: 'anonymous',
    brandName: null,
    brandLogo: null
  });
  const view = acquisitionEntryView(defaultAcquisitionConfig, enterprise, 7);
  assert.equal(view.version, 7);
  assert.equal(view.brandName, null);
  assert.equal(view.brandLogo, null);
  assert.equal(view.opening, defaultAcquisitionConfig.opening);
});

test('branded acquisition entries use the real enterprise identity', () => {
  const config = { ...defaultAcquisitionConfig, brandMode: 'branded' as const };
  assert.deepEqual(acquisitionBrand(config, { name: '精艺智家', logo: 'https://cdn.example/logo.png' }), {
    brandMode: 'branded',
    brandName: '精艺智家',
    brandLogo: 'https://cdn.example/logo.png'
  });
});

test('acquisition config rejects unknown keys, invalid modes and overlong prompts', () => {
  assert.throws(() => validateAcquisitionConfig({ ...defaultAcquisitionConfig, extra: true }));
  assert.throws(() => validateAcquisitionConfig({ ...defaultAcquisitionConfig, brandMode: 'sometimes' }));
  assert.throws(() => validateAcquisitionConfig({
    ...defaultAcquisitionConfig,
    prompts: [{ title: '这是一个超过十二个字的话题标题', text: '正常问句' }]
  }));
  assert.throws(() => validateAcquisitionConfig({
    ...defaultAcquisitionConfig,
    prompts: [{ title: '重复', text: '一' }, { title: '重复', text: '二' }]
  }));
});

test('invalid stored acquisition config falls back to the anonymous default', () => {
  const fallback = configuredAcquisition({ brandMode: 'branded' });
  assert.equal(fallback.brandMode, 'anonymous');
  assert.equal(fallback.prompts.length, defaultAcquisitionConfig.prompts.length);
});
