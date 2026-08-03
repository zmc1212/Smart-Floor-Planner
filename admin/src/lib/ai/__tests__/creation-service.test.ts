import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveCreationBatchStatus, resolveCreationParameters } from '@/lib/ai/creation-service';
import { toSafeCreditAmount } from '@/lib/ai/credits';
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
    sizes: ['1K', '2K'],
    qualities: [],
    resolutionTiers: ['1K', '2K'],
    supportsCustomSize: false,
    defaultAspectRatio: '1:1',
    defaultSize: '1K',
    defaultQuality: '',
    defaultResolutionTier: '1K',
    enabled: true,
    weight: 1,
    ...overrides,
  } as unknown as IAiCreationModelProfile;
}

test('template parameters are intersected with the selected local model profile', () => {
  const resolved = resolveCreationParameters(
    profile(),
    { aspectRatio: '16:9', resolutionTier: '4K', templateId: 'template-1' },
    {
      modelParams: [
        { paramField: 'aspectRatio', isEnable: true, paramValues: JSON.stringify([{ value: '4:3' }, { value: '16:9' }]) },
        { paramField: 'imageSize', isEnable: true, paramValues: JSON.stringify([{ value: '2K' }, { value: '4K' }]) },
      ],
    }
  );

  assert.deepEqual(resolved, {
    aspectRatio: '16:9',
    resolutionTier: '2K',
    width: undefined,
    height: undefined,
    templateId: 'template-1',
  });
});

test('invalid requested values fall back to profile defaults', () => {
  const resolved = resolveCreationParameters(profile(), {
    aspectRatio: '21:9',
    resolutionTier: '4K',
  });
  assert.equal(resolved.aspectRatio, '1:1');
  assert.equal(resolved.resolutionTier, '1K');
});

test('batch status reports success, failure, partial and processing states', () => {
  assert.equal(deriveCreationBatchStatus([]), 'pending');
  assert.equal(deriveCreationBatchStatus(['succeeded', 'succeeded']), 'succeeded');
  assert.equal(deriveCreationBatchStatus(['failed', 'cancelled']), 'failed');
  assert.equal(deriveCreationBatchStatus(['succeeded', 'failed']), 'partial');
  assert.equal(deriveCreationBatchStatus(['succeeded', 'processing']), 'processing');
});

test('PostgreSQL credit prices must fit the legacy numeric billing boundary', () => {
  assert.equal(toSafeCreditAmount(BigInt(25)), 25);
  assert.throws(() => toSafeCreditAmount(BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1)));
  assert.throws(() => toSafeCreditAmount(0));
});
