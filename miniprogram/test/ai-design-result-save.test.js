const test = require('node:test');
const assert = require('node:assert/strict');
const aiService = require('../utils/aiDesignService.js');

function loadPageDefinition() {
  let definition = null;
  global.Page = (config) => { definition = config; };
  const pagePath = require.resolve('../packages/ai-workflow/result/ai-design-result.js');
  delete require.cache[pagePath];
  require(pagePath);
  delete global.Page;
  return definition;
}

function createPage(definition) {
  return {
    ...definition,
    data: {
      ...definition.data,
      task: { resultImageUrl: 'https://example.com/result.jpg' },
    },
    setData(update) {
      Object.assign(this.data, update);
    },
  };
}

test('result saving waits for the album write and hides loading before success feedback', async () => {
  const originalWx = global.wx;
  const calls = [];
  global.wx = {
    showLoading() { calls.push('showLoading'); },
    downloadFile(options) {
      calls.push('downloadFile');
      options.success({ statusCode: 200, tempFilePath: 'wxfile://result.jpg' });
    },
    saveImageToPhotosAlbum(options) {
      calls.push('saveImageToPhotosAlbum');
      options.success();
    },
    hideLoading() { calls.push('hideLoading'); },
    showToast(options) { calls.push(`showToast:${options.title}`); },
  };

  try {
    const page = createPage(loadPageDefinition());
    await page.saveResult();

    assert.deepEqual(calls, [
      'showLoading',
      'downloadFile',
      'saveImageToPhotosAlbum',
      'hideLoading',
      'showToast:已保存到相册',
    ]);
    assert.equal(page.data.saving, false);
  } finally {
    global.wx = originalWx;
  }
});

test('result saving opens settings when photo album permission is denied', async () => {
  const originalWx = global.wx;
  const calls = [];
  global.wx = {
    showLoading() {},
    downloadFile(options) {
      options.success({ statusCode: 200, tempFilePath: 'wxfile://result.jpg' });
    },
    saveImageToPhotosAlbum(options) {
      options.fail({ errMsg: 'saveImageToPhotosAlbum:fail auth deny' });
    },
    hideLoading() { calls.push('hideLoading'); },
    showModal(options) {
      calls.push(`showModal:${options.title}`);
      options.success({ confirm: true });
    },
    openSetting() { calls.push('openSetting'); },
    showToast() { calls.push('showToast'); },
  };

  try {
    const page = createPage(loadPageDefinition());
    await page.saveResult();

    assert.deepEqual(calls, [
      'hideLoading',
      'showModal:需要相册权限',
      'openSetting',
    ]);
  } finally {
    global.wx = originalWx;
  }
});

test('reference recreation compares against the reference composition at its output ratio', async () => {
  const originalWx = global.wx;
  const originalGetTask = aiService.getTask;
  global.wx = { showToast() {} };
  aiService.getTask = async () => ({
    id: 'task-1',
    mode: 'reference_recreate',
    status: 'succeeded',
    outputAspectRatio: '16:9',
    controlImageUrl: 'https://example.com/control.png',
    referenceImageUrl: 'https://example.com/reference.jpg',
    spaceImageUrl: 'https://example.com/space.jpg',
    resultImageUrl: 'https://example.com/result.jpg',
  });

  try {
    const page = createPage(loadPageDefinition());
    page.data.id = 'task-1';
    await page.loadTask();

    assert.equal(page.data.task.sourceCompareImageUrl, 'https://example.com/reference.jpg');
    assert.equal(page.data.task.preserveComposition, true);
    assert.equal(page.data.task.floorPlanCompare, false);
    assert.equal(page.data.task.resultStageHeight, 422);
  } finally {
    aiService.getTask = originalGetTask;
    global.wx = originalWx;
  }
});

test('floor-plan generation shows a single result even when a control image exists', async () => {
  const originalWx = global.wx;
  const originalGetTask = aiService.getTask;
  global.wx = { showToast() {} };
  aiService.getTask = async () => ({
    id: 'task-floor-plan',
    mode: 'floor_plan_render',
    status: 'succeeded',
    controlImageUrl: 'https://example.com/floor-plan-control.png',
    spaceImageUrl: 'https://example.com/generated-space.png',
    resultImageUrl: 'https://example.com/result.jpg',
  });

  try {
    const page = createPage(loadPageDefinition());
    page.data.id = 'task-floor-plan';
    await page.loadTask();

    assert.equal(page.data.task.sourceCompareImageUrl, '');
    assert.equal(page.data.task.showComparison, false);
    assert.equal(page.data.task.floorPlanCompare, false);
  } finally {
    aiService.getTask = originalGetTask;
    global.wx = originalWx;
  }
});
