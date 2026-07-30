import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveCreationBatchStatus, resolveCreationParameters } from '@/lib/ai/creation-service';
import type { IAiCreationModelProfile } from '@/models/AiCreationModelProfile';

function profile(overrides: Partial<IAiCreationModelProfile> = {}) {
  return {
    _id: 'profile-1',
    key: 'test-profile',
    name: 'Test Model',
    description: '',
    sourceModelSourceIds: ['source-1'],
    generateLogicalModelKey: 'image.generate.standard',
    editLogicalModelKey: 'image.edit.standard',
    supportsReferenceImages: true,
    maxReferenceImages: 4,
    aspectRatios: ['1:1', '4:3', '16:9'],
    sizes: ['1K', '2K', '1024x1024', '1280x960'],
    qualities: ['auto', 'high', 'low'],
    defaultAspectRatio: '1:1',
    defaultSize: '1K',
    defaultQuality: 'auto',
    enabled: true,
    weight: 1,
    ...overrides,
  } as unknown as IAiCreationModelProfile;
}

test('template parameters are intersected with the selected local model profile', () => {
  const resolved = resolveCreationParameters(
    profile(),
    { aspectRatio: '16:9', size: '4K', quality: 'high', templateId: 'template-1' },
    {
      modelParams: [
        { paramField: 'aspectRatio', isEnable: true, paramValues: JSON.stringify([{ value: '4:3' }, { value: '16:9' }]) },
        { paramField: 'imageSize', isEnable: true, paramValues: JSON.stringify([{ value: '2K' }, { value: '4K' }]) },
        { paramField: 'quality', isEnable: true, paramValues: JSON.stringify([{ value: 'high' }]) },
      ],
    }
  );

  assert.deepEqual(resolved, {
    aspectRatio: '16:9',
    size: '2K',
    quality: 'high',
    templateId: 'template-1',
  });
});

test('invalid requested values fall back to profile defaults', () => {
  const resolved = resolveCreationParameters(profile(), {
    aspectRatio: '21:9',
    size: '8K',
    quality: 'ultra',
  });
  assert.equal(resolved.aspectRatio, '1:1');
  assert.equal(resolved.size, '1K');
  assert.equal(resolved.quality, 'auto');
});

test('batch status reports success, failure, partial and processing states', () => {
  assert.equal(deriveCreationBatchStatus([]), 'pending');
  assert.equal(deriveCreationBatchStatus(['succeeded', 'succeeded']), 'succeeded');
  assert.equal(deriveCreationBatchStatus(['failed', 'cancelled']), 'failed');
  assert.equal(deriveCreationBatchStatus(['succeeded', 'failed']), 'partial');
  assert.equal(deriveCreationBatchStatus(['succeeded', 'processing']), 'processing');
});
