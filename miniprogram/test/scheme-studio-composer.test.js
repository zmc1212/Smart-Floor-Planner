const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyModelDefaults,
  buildComposerViewState,
  buildTemplateCategoryChips,
  buildTemplateListParams,
  createDefaultDraft,
  flattenPromptCategories,
  maxUserReferenceImages,
  parseTemplateListPayload,
  resolvePreferredTemplateCategoryId,
} = require('../components/ai-scheme-composer/ai-scheme-composer-model.js');

const bootstrap = {
  account: { availableBalance: 100 },
  provider: { actionEnabled: true, supportsEdit: true },
  models: [{
    id: 'model-a',
    name: '模型 A',
    maxReferenceImages: 4,
    defaults: { aspectRatio: '4:3', resolutionTier: '2K' },
    aspectRatios: ['1:1', '4:3'],
    resolutionTiers: ['1K', '2K'],
    prices: [
      { resolutionTier: '1K', credits: 2 },
      { resolutionTier: '2K', credits: 4 },
    ],
  }],
};

test('maxUserReferenceImages reserves one slot for floor-plan control image', () => {
  assert.equal(maxUserReferenceImages(4), 3);
  assert.equal(maxUserReferenceImages(1), 0);
});

test('applyModelDefaults follows model catalog defaults', () => {
  const draft = applyModelDefaults(createDefaultDraft(bootstrap), bootstrap.models[0]);
  assert.equal(draft.modelProfileId, 'model-a');
  assert.equal(draft.aspectRatio, '4:3');
  assert.equal(draft.resolutionTier, '2K');
});

test('buildComposerViewState enables submit when draft and balance are valid', () => {
  const draft = {
    ...createDefaultDraft(bootstrap),
    prompt: '奶油风客厅，自然光',
    count: 1,
  };
  const view = buildComposerViewState(draft, bootstrap);
  assert.equal(view.canSubmit, true);
  assert.equal(view.estimatedCredits, 4);
  assert.equal(view.canAddReference, true);
});

test('flattenPromptCategories keeps depth-first order for nested categories', () => {
  const flat = flattenPromptCategories([
    { sourceId: 'root-a', name: '空间', level: 1 },
    { sourceId: 'child-a', parentSourceId: 'root-a', name: '客厅', level: 2 },
    { sourceId: 'root-b', name: '热门必备', level: 1 },
  ]);
  assert.deepEqual(flat.map((item) => item.sourceId), ['root-a', 'child-a', 'root-b']);
});

test('resolvePreferredTemplateCategoryId prefers 热门必备', () => {
  assert.equal(resolvePreferredTemplateCategoryId([
    { sourceId: 'space', name: '空间', level: 1 },
    { sourceId: 'hot', name: '热门必备', level: 1 },
  ]), 'hot');
  assert.equal(resolvePreferredTemplateCategoryId([{ sourceId: 'space', name: '空间', level: 1 }]), '');
});

test('buildTemplateCategoryChips prepends 全部 and marks active category', () => {
  const chips = buildTemplateCategoryChips(
    [{ sourceId: 'hot', name: '热门必备', level: 1 }],
    'hot',
  );
  assert.equal(chips[0].id, '__all__');
  assert.equal(chips[0].active, false);
  assert.equal(chips[1].id, 'hot');
  assert.equal(chips[1].active, true);
});

test('buildTemplateListParams sends category only when query is empty', () => {
  assert.deepEqual(buildTemplateListParams({ categoryId: 'hot', query: '', page: 1, limit: 40 }), {
    page: 1,
    limit: 40,
    categorySourceId: 'hot',
  });
  assert.deepEqual(buildTemplateListParams({ categoryId: 'hot', query: ' 奶油 ', page: 2, limit: 40 }), {
    page: 2,
    limit: 40,
    q: '奶油',
  });
});

test('parseTemplateListPayload normalizes items and pagination', () => {
  const parsed = parseTemplateListPayload({
    items: [{ id: 't1', name: '原木奶油客厅' }],
    pagination: { page: 1, total: 12 },
  });
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.total, 12);
  assert.equal(parsed.page, 1);
});
