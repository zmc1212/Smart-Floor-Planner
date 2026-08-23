import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCreationSubmitRemoteModel, usesCatalogImageRemoteModel } from '@/lib/ai/postgres-creation-runtime';

test('free_create submits the catalog remoteModel even when the provider mapping differs', () => {
  assert.equal(usesCatalogImageRemoteModel('free_create'), true);
  assert.equal(resolveCreationSubmitRemoteModel({
    generationType: 'free_create',
    catalogRemoteModel: 'nano-banana-2',
    mappedRemoteModel: 'gpt-image-2',
  }), 'nano-banana-2');
});

test('scenario and recipe types still use the provider default mapping', () => {
  assert.equal(usesCatalogImageRemoteModel('scenario'), false);
  assert.equal(resolveCreationSubmitRemoteModel({
    generationType: 'scenario',
    catalogRemoteModel: 'nano-banana-2',
    mappedRemoteModel: 'gpt-image-2',
  }), 'gpt-image-2');
  assert.equal(resolveCreationSubmitRemoteModel({
    generationType: 'miniprogram',
    catalogRemoteModel: 'nano-banana-2',
    mappedRemoteModel: 'gpt-image-2',
  }), 'gpt-image-2');
});
