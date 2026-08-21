import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeTemplateReferenceAsset,
  planPromptTemplateReferenceAttach,
  promptTemplateCoverClonePath,
  promptTemplatePreviewSrc,
  templateReferenceFileName,
} from '@/lib/ai/prompt-template-reference';

test('template preview prefers the authenticated local cover over a remote source URL', () => {
  assert.equal(promptTemplatePreviewSrc({}), '');
  assert.equal(
    promptTemplatePreviewSrc({
      previewUrl: 'https://cdn.example.com/cover.jpg',
      localPreviewUrl: '/api/ai/creation/prompt-templates/9/preview',
    }),
    '/api/ai/creation/prompt-templates/9/preview',
  );
  assert.equal(
    promptTemplatePreviewSrc({ previewUrl: 'https://cdn.example.com/cover.jpg' }),
    'https://cdn.example.com/cover.jpg',
  );
});

test('applying a template cover replaces the previous template reference and keeps other user refs', () => {
  const plan = planPromptTemplateReferenceAttach({
    previewSrc: '/api/ai/creation/prompt-templates/9/preview',
    maxUserRefs: 3,
    currentAssetIds: ['old-cover', 'user-1'],
    previousTemplateAssetId: 'old-cover',
  });
  assert.equal(plan.canAttach, true);
  assert.deepEqual(plan.keptAssetIds, ['user-1']);
  assert.equal(plan.previewSrc, '/api/ai/creation/prompt-templates/9/preview');
  assert.deepEqual(
    mergeTemplateReferenceAsset(
      plan.keptAssetIds.map((id) => ({ id })),
      { id: 'new-cover' },
    ).map((item) => item.id),
    ['new-cover', 'user-1'],
  );
});

test('template cover is skipped when the composer has no remaining user reference slots', () => {
  const noPreview = planPromptTemplateReferenceAttach({
    previewSrc: '',
    maxUserRefs: 3,
    currentAssetIds: [],
  });
  assert.equal(noPreview.canAttach, false);
  assert.equal(noPreview.reason, 'no_preview');

  const noSlots = planPromptTemplateReferenceAttach({
    previewSrc: '/preview',
    maxUserRefs: 0,
    currentAssetIds: [],
  });
  assert.equal(noSlots.canAttach, false);
  assert.equal(noSlots.reason, 'no_slots');

  const full = planPromptTemplateReferenceAttach({
    previewSrc: '/preview',
    maxUserRefs: 2,
    currentAssetIds: ['a', 'b'],
  });
  assert.equal(full.canAttach, false);
  assert.equal(full.reason, 'no_capacity');
  assert.deepEqual(full.keptAssetIds, ['a', 'b']);
});

test('template cover upload uses a jpeg or png filename from the image mime type', () => {
  assert.equal(templateReferenceFileName('9', 'image/jpeg'), 'prompt-template-9.jpg');
  assert.equal(templateReferenceFileName('9', 'image/png'), 'prompt-template-9.png');
});

test('template cover clone uses a same-origin POST instead of fetching the preview redirect', () => {
  assert.equal(
    promptTemplateCoverClonePath('9'),
    '/api/ai/creation/prompt-templates/9/reference',
  );
  assert.equal(promptTemplateCoverClonePath('  '), '');
});
