const test = require('node:test');
const assert = require('node:assert/strict');
const aiService = require('../utils/aiDesignService.js');

function loadPageDefinition() {
  let definition = null;
  global.Page = (config) => { definition = config; };
  const pagePath = require.resolve('../packages/ai-workflow/create/ai-design-create.js');
  delete require.cache[pagePath];
  require(pagePath);
  delete global.Page;
  return definition;
}

function createPage(definition) {
  return {
    ...definition,
    data: { ...definition.data },
    setData(update) {
      Object.assign(this.data, update);
    },
  };
}

test('AI image upload keeps the local preview on success and failure', async () => {
  const originalUploadAsset = aiService.uploadAsset;
  const originalWx = global.wx;
  const feedbackCalls = [];
  global.wx = {
    showLoading() { feedbackCalls.push('showLoading'); },
    hideLoading() { feedbackCalls.push('hideLoading'); },
    showToast(options) { feedbackCalls.push(`showToast:${options.title}`); },
  };

  try {
    const page = createPage(loadPageDefinition());
    page.setData({ sourceResultTaskId: 'kitchen-result', autoSourceLabel: '厨房方案基准图' });
    aiService.uploadAsset = async () => ({ id: 'asset-1', previewUrl: 'https://example.com/signed-preview' });
    await page.uploadImage('space', 'wxfile://space-photo.jpg');

    assert.equal(page.data.spaceAssetId, 'asset-1');
    assert.equal(page.data.sourceResultTaskId, '');
    assert.equal(page.data.autoSourceLabel, '');
    assert.equal(page.data.spaceImagePath, 'wxfile://space-photo.jpg');
    assert.equal(page.data.uploadErrorRole, '');
    assert.deepEqual(feedbackCalls.slice(-3), ['showLoading', 'hideLoading', 'showToast:图片已上传']);

    aiService.uploadAsset = async () => { throw { error: 'network failed' }; };
    await page.uploadImage('space', 'wxfile://replacement.jpg');

    assert.equal(page.data.spaceAssetId, '');
    assert.equal(page.data.spaceImagePath, 'wxfile://replacement.jpg');
    assert.equal(page.data.uploadErrorRole, 'space');
    assert.deepEqual(feedbackCalls.slice(-3), ['showLoading', 'hideLoading', 'showToast:network failed']);

    aiService.uploadAsset = async () => ({ id: 'asset-2' });
    await page.retryImage({ currentTarget: { dataset: { role: 'space' } } });

    assert.equal(page.data.spaceAssetId, 'asset-2');
    assert.equal(page.data.spaceImagePath, 'wxfile://replacement.jpg');
    assert.equal(page.data.uploadErrorRole, '');
  } finally {
    aiService.uploadAsset = originalUploadAsset;
    global.wx = originalWx;
  }
});

test('AI create readiness follows the active mode, required inputs, styles, and credits', () => {
  const page = createPage(loadPageDefinition());
  const base = {
    ...page.data,
    loading: false,
    modeAvailable: true,
    modeUnavailableReason: '',
    hasEnoughCredits: true,
    styles: [{ key: 'modern', name: '现代简约' }],
    selectedStyleKey: 'modern',
  };

  assert.deepEqual(
    page.deriveSubmitState({ ...base, mode: 'reference_recreate' }),
    { canSubmit: false, submitBlockedReason: '请上传空间图' }
  );
  assert.deepEqual(
    page.deriveSubmitState({
      ...base,
      mode: 'reference_recreate',
      spaceAssetId: 'space',
    }),
    { canSubmit: false, submitBlockedReason: '请上传参考图' }
  );
  assert.deepEqual(
    page.deriveSubmitState({
      ...base,
      mode: 'reference_recreate',
      spaceAssetId: 'space',
      referenceAssetId: 'reference',
    }),
    { canSubmit: true, submitBlockedReason: '' }
  );
  assert.deepEqual(
    page.deriveSubmitState({
      ...base,
      mode: 'reference_recreate',
      floorPlanId: 'plan',
      referenceAssetId: 'reference',
    }),
    { canSubmit: true, submitBlockedReason: '' }
  );
  assert.deepEqual(
    page.deriveSubmitState({
      ...base,
      mode: 'style_transform',
      spaceAssetId: '',
    }),
    { canSubmit: false, submitBlockedReason: '请上传空间图' }
  );
  assert.deepEqual(
    page.deriveSubmitState({
      ...base,
      mode: 'style_transform',
      spaceAssetId: 'space',
      hasEnoughCredits: false,
    }),
    { canSubmit: false, submitBlockedReason: 'AI 点数不足' }
  );
});

test('AI create explains the real recovery path when enterprise credits are insufficient', async () => {
  const page = createPage(loadPageDefinition());
  const originalWx = global.wx;
  let modal = null;
  global.wx = {
    showModal(options) { modal = options; },
  };

  try {
    page.setData({
      canSubmit: false,
      submitBlockedReason: 'AI 点数不足',
      price: 10,
    });
    await page.submit();
    assert.equal(modal.title, 'AI 点数不足');
    assert.match(modal.content, /联系企业管理员补充 AI 点数/);
    assert.equal(modal.showCancel, false);
  } finally {
    global.wx = originalWx;
  }
});

test('AI create restores the requested workflow source instead of using the first list item', async () => {
  const originals = {
    loadCapabilities: aiService.loadCapabilities,
    loadSources: aiService.loadSources,
    loadWorkflows: aiService.loadWorkflows,
  };
  const originalWx = global.wx;
  global.wx = { showToast() {} };
  aiService.loadCapabilities = async () => ({
    account: { availableBalance: 50 },
    modes: [{ key: 'style_transform', credits: 10, enabled: true }],
    styles: [{ key: 'modern', name: '现代简约' }],
    provider: {},
  });
  aiService.loadSources = async () => [{
    floorPlanId: '157',
    floorPlanName: '客户正式户型',
    closedRoomCount: 1,
    rooms: [],
  }];
  aiService.loadWorkflows = async () => [{ id: 'other-workflow' }, {
    id: '234',
    title: '客户方案',
    currentStageLabel: '风格方案',
    lead: { id: '388', name: '测试客户' },
    sourceFloorPlanId: '157',
    targetContext: {
      sourceTask: {
        id: '846',
        resultImageUrl: 'https://example.com/baseline.png',
        styleKey: 'modern',
      },
    },
  }];

  try {
    const page = createPage(loadPageDefinition());
    page.setData({
      mode: 'style_transform',
      floorPlanId: '157',
      leadId: '388',
      targetScope: 'whole_floor_plan',
      workflowId: '234',
      requestedSourceResultTaskId: '846',
    });
    await page.loadInitialData();

    assert.equal(page.data.loadError, '');
    assert.equal(page.data.workflowId, '234');
    assert.equal(page.data.sourceResultTaskId, '846');
    assert.equal(page.data.spaceImagePath, 'https://example.com/baseline.png');
    assert.equal(page.data.canSubmit, true);
  } finally {
    Object.assign(aiService, originals);
    global.wx = originalWx;
  }
});

test('AI create exposes a stale workflow source error instead of a generic config failure', async () => {
  const originals = {
    loadCapabilities: aiService.loadCapabilities,
    loadSources: aiService.loadSources,
    loadWorkflows: aiService.loadWorkflows,
  };
  const originalWx = global.wx;
  let toastTitle = '';
  global.wx = { showToast(options) { toastTitle = options.title; } };
  aiService.loadCapabilities = async () => ({
    account: { availableBalance: 50 },
    modes: [{ key: 'style_transform', credits: 10, enabled: true }],
    styles: [{ key: 'modern', name: '现代简约' }],
    provider: {},
  });
  aiService.loadSources = async () => [];
  aiService.loadWorkflows = async () => [{
    id: '234',
    targetContext: { sourceTask: { id: 'new-baseline' } },
  }];

  try {
    const page = createPage(loadPageDefinition());
    page.setData({
      mode: 'style_transform',
      floorPlanId: '157',
      targetScope: 'whole_floor_plan',
      workflowId: '234',
      requestedSourceResultTaskId: '846',
    });
    await page.loadInitialData();

    assert.equal(page.data.loadError, '当前空间基准图已变化，请返回后重试');
    assert.equal(toastTitle, page.data.loadError);
  } finally {
    Object.assign(aiService, originals);
    global.wx = originalWx;
  }
});
