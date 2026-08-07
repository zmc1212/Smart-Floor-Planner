const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const miniRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(miniRoot, relativePath), 'utf8');
}

function loadPageConfig(relativePath) {
  const modulePath = path.join(miniRoot, relativePath);
  const previousPage = global.Page;
  let pageConfig;
  global.Page = (config) => {
    pageConfig = config;
  };
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  global.Page = previousPage;
  return pageConfig;
}

test('V3 page-role assets remain native artwork instead of flattened page screenshots', () => {
  const aiHome = read('pages/ai-design/ai-design.wxml');
  assert.match(aiHome, /class="plan-graph"/);
  assert.match(aiHome, /\/images\/mine-icons\/tab-measure-k\.png/);
  assert.doesNotMatch(aiHome, /\/images\/page-ip-v3\/ai-home\.png/);

  const references = [
    ['pages/mine/mine.wxml', 'mine.png'],
    ['packages/business/lead-form/lead-form.wxml', 'lead-form.png'],
    ['packages/business/lead-detail/lead-detail.wxml', 'lead-detail.png'],
    ['packages/business/inspiration/inspiration.wxml', 'inspiration.png'],
    ['packages/ai-workflow/create/ai-design-create.wxml', 'ai-create.png'],
    ['packages/ai-workflow/result/ai-design-result.wxml', 'ai-result.png'],
    ['packages/ai-workflow/history/ai-design-history.wxml', 'ai-history.png'],
    ['packages/business/recommendations/index.wxml', 'recommendations.png'],
  ];

  for (const [sourcePath, assetName] of references) {
    assert.match(read(sourcePath), new RegExp(`/images/page-ip-v3/${assetName.replace('.', '\\.')}`));
    const asset = fs.readFileSync(path.join(miniRoot, 'images', 'page-ip-v3', assetName));
    assert.equal(asset.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
});

test('AI design create V3 keeps production data and actions native', () => {
  const wxml = read('packages/ai-workflow/create/ai-design-create.wxml');
  const source = read('packages/ai-workflow/create/ai-design-create.js');
  const wxss = read('packages/ai-workflow/create/ai-design-create.wxss');

  assert.match(wxml, /class="create-step-track"/);
  assert.match(wxml, /bindtap="selectImage"/);
  assert.match(wxml, /wx:for="\{\{styles\}\}"/);
  assert.match(wxml, /\{\{creditStatusText\}\}/);
  assert.match(wxml, /bindtap="retryLoad"/);
  assert.match(wxml, /bindtap="submit"/);
  assert.match(wxml, /添加参考图/);
  assert.match(wxml, /aria-checked="\{\{selectedStyleKey === item\.key\}\}"/);
  assert.match(wxml, /aria-disabled="\{\{submitting \|\| uploadingRole \|\| !canSubmit \? true : false\}\}"/);
  assert.match(wxml, /\{\{modeTitle\}\}/);
  assert.match(wxml, /class="scope-summary"/);
  assert.doesNotMatch(wxml, /class="scope-marker"/);
  assert.doesNotMatch(wxml, /bindtap="selectScope"/);
  assert.doesNotMatch(wxml, /14-ai-design-create-v3\.png/);
  assert.match(source, /STYLE_PREVIEW_IMAGES/);
  assert.match(source, /previewImage: STYLE_PREVIEW_IMAGES\[style\.key\] \|\| ''/);
  assert.doesNotMatch(source, /index\s*%\s*3/);
  assert.match(source, /submitBlockedReason: 'AI 点数不足'/);
  assert.match(source, /function deriveSubmitState/);
  assert.match(source, /请上传空间图/);
  assert.match(source, /availableBalance >= price/);
  assert.match(wxss, /\.generate-button\.blocked/);
  assert.match(wxss, /\.create-action-zone/);
  assert.match(wxss, /\.scope-summary/);
  assert.match(wxss, /height: 88rpx/);
  assert.match(wxss, /@media \(max-width: 360px\)/);

  for (const assetName of [
    'ai-create-style-modern.jpg',
    'ai-create-style-cream.jpg',
    'ai-create-style-chinese.jpg',
  ]) {
    const asset = fs.readFileSync(path.join(miniRoot, 'images', 'page-ip-v3', assetName));
    assert.equal(asset.subarray(0, 3).toString('hex'), 'ffd8ff');
  }
});

test('AI history status filters preserve all processing states and exact terminal states', () => {
  const page = loadPageConfig('packages/ai-workflow/history/ai-design-history.js');
  const items = [
    { id: '1', status: 'created' },
    { id: '2', status: 'pending' },
    { id: '3', status: 'processing' },
    { id: '4', status: 'succeeded' },
    { id: '5', status: 'failed' },
  ];

  assert.deepEqual(page.filterHistoryItems(items, 'all'), items);
  assert.deepEqual(
    page.filterHistoryItems(items, 'processing').map((item) => item.id),
    ['1', '2', '3']
  );
  assert.deepEqual(
    page.filterHistoryItems(items, 'succeeded').map((item) => item.id),
    ['4']
  );
  assert.deepEqual(
    page.filterHistoryItems(items, 'failed').map((item) => item.id),
    ['5']
  );

  let update;
  page.selectHistoryFilter.call({
    data: { items },
    filterHistoryItems: page.filterHistoryItems,
    setData(value) {
      update = value;
    },
  }, {
    currentTarget: { dataset: { value: 'processing' } },
  });
  assert.equal(update.activeFilter, 'processing');
  assert.equal(update.filteredItems.length, 3);
});

test('recommendations expose only the native share path after a real local selection', () => {
  const source = read('packages/business/recommendations/index.js');
  const wxml = read('packages/business/recommendations/index.wxml');
  const page = loadPageConfig('packages/business/recommendations/index.js');

  assert.match(wxml, /open-type="share"/);
  assert.match(wxml, /wx:if="\{\{selectedStyle\}\}"/);
  assert.doesNotMatch(source, /onDownloadPdf|pdf_download|正在生成PDF|PDF下载成功/);
  assert.doesNotMatch(source, /showActionSheet|保存方案海报|trackUserInteraction/);

  const share = page.onShareAppMessage.call({
    data: { selectedStyle: 'cream-style' },
    getStyleName: page.getStyleName,
  });
  assert.equal(share.title, '我选择了奶油风风格，你也来试试');
  assert.equal(share.path, '/packages/business/recommendations/index?selected=cream-style');
  assert.equal(share.imageUrl, '/images/share-preview.jpg');
});

test('lead detail keeps every measurement action on the formal surveying entry', () => {
  const source = read('packages/business/lead-detail/lead-detail.js');
  const wxml = read('packages/business/lead-detail/lead-detail.wxml');

  assert.match(source, /openSurveyingEditor\(\{/);
  assert.match(source, /floorPlanId: plan && plan\._id/);
  assert.match(source, /startNewSurvey: true/);
  assert.match(source, /api\.request\(`\/floorplans\/\$\{plan\._id\}`, 'DELETE'\)/);
  assert.match(wxml, /bindtap="onStartMeasure"/);
  assert.match(wxml, /bindtap="onStartNewMeasure"/);
  assert.match(wxml, /bindtap="onContinueMeasure"/);
  assert.match(wxml, /bindtap="onDeleteMeasure"/);
  assert.doesNotMatch(source + wxml, /pages\/editor\/editor|restoreFloorPlan/);
});
