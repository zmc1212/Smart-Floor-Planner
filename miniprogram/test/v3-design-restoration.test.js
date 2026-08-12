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
  assert.match(aiHome, /class="plan-default-scene"/);
  assert.match(aiHome, /class="plan-hero-swiper"/);
  assert.match(aiHome, /\/images\/generated-hero-bleed-v2\.png/);
  assert.match(aiHome, /\/images\/mine-icons\/tab-measure-k\.png/);
  assert.doesNotMatch(aiHome, /\/images\/page-ip-v3\/ai-home\.png/);

  const references = [
    ['pages/mine/mine.wxml', 'images/page-ip-v3/mine.png', '89504e470d0a1a0a'],
    ['packages/business/lead-form/lead-form.wxml', 'packages/business/assets/leads/lead-form.png', '89504e470d0a1a0a'],
    ['packages/business/lead-detail/lead-detail.wxml', 'packages/business/assets/leads/lead-detail.png', '89504e470d0a1a0a'],
    ['packages/business/inspiration/inspiration.wxml', 'packages/business/assets/inspiration/inspiration.png', '89504e470d0a1a0a'],
    ['packages/ai-workflow/create/ai-design-create.wxml', 'packages/ai-workflow/assets/page-ip-v3/ai-create.jpg', 'ffd8ff'],
    ['packages/ai-workflow/result/ai-design-result.wxml', 'packages/ai-workflow/assets/page-ip-v3/ai-result.jpg', 'ffd8ff'],
    ['packages/ai-workflow/history/ai-design-history.wxml', 'packages/ai-workflow/assets/page-ip-v3/ai-history.jpg', 'ffd8ff'],
    ['packages/business/recommendations/index.wxml', 'packages/business/assets/recommendations/recommendations.png', '89504e470d0a1a0a'],
  ];

  for (const [sourcePath, assetPath, signature] of references) {
    assert.match(read(sourcePath), new RegExp(`/${assetPath.replace(/[.]/g, '\\.')}`));
    const asset = fs.readFileSync(path.join(miniRoot, assetPath));
    assert.equal(asset.subarray(0, signature.length / 2).toString('hex'), signature);
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
    const asset = fs.readFileSync(path.join(miniRoot, 'packages', 'ai-workflow', 'assets', 'page-ip-v3', assetName));
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

test('AI history V3 keeps time, status progress, local icons, and compact card geometry native', () => {
  const page = loadPageConfig('packages/ai-workflow/history/ai-design-history.js');
  const wxml = read('packages/ai-workflow/history/ai-design-history.wxml');
  const wxss = read('packages/ai-workflow/history/ai-design-history.wxss');

  assert.match(wxml, /\{\{item\.timeLabel\}\}/);
  assert.match(wxml, /\/images\/leads-v4\/map-pin\.png/);
  assert.match(wxml, /\/images\/leads-v4\/chevron-right\.png/);
  assert.match(wxml, /class="history-progress-track"/);
  assert.match(wxml, /class="history-image history-image-placeholder"/);
  assert.match(wxss, /min-height: 262rpx/);
  assert.match(wxss, /grid-template-columns: 264rpx minmax\(0, 1fr\)/);
  assert.match(wxss, /height: 66rpx/);

  const now = new Date(2026, 7, 11, 12, 0).getTime();
  assert.equal(page.formatHistoryTime(new Date(2026, 7, 11, 10, 21).toISOString(), now), '今天 10:21');
  assert.equal(page.formatHistoryTime(new Date(2026, 7, 10, 16, 48).toISOString(), now), '昨天 16:48');
  assert.equal(page.formatHistoryTime(new Date(2026, 4, 19, 15, 20).toISOString(), now), '05-19 15:20');

  const decorated = page.decorateHistoryItem({ status: 'processing', progress: 68, mode: 'style_transform', updatedAt: new Date(2026, 7, 11, 10, 21).toISOString() });
  assert.equal(decorated.modeTitle, '空间换风格');
  assert.equal(decorated.statusClass, 'processing');
  assert.equal(decorated.statusLabel, '生成中 68%');
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
  assert.equal(share.imageUrl, '/packages/business/assets/recommendations/share-preview.jpg');
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
