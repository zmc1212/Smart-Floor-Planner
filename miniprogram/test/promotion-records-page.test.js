const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const miniRoot = path.resolve(__dirname, '..');
const pageJs = fs.readFileSync(
  path.join(miniRoot, 'packages', 'business', 'promotion-records', 'promotion-records.js'),
  'utf8'
);
const pageWxml = fs.readFileSync(
  path.join(miniRoot, 'packages', 'business', 'promotion-records', 'promotion-records.wxml'),
  'utf8'
);
const pageWxss = fs.readFileSync(
  path.join(miniRoot, 'packages', 'business', 'promotion-records', 'promotion-records.less'),
  'utf8'
);
const appConfig = JSON.parse(fs.readFileSync(path.join(miniRoot, 'app.json'), 'utf8'));

test('Promotion records ships the approved filing composition with live controls', () => {
  assert.match(pageWxml, /\/packages\/business\/assets\/promotion-records\/hero-scene\.jpg/);
  assert.match(pageWxml, /\/images\/leads-ip-v1\/plus-white\.png/);
  assert.match(pageWxml, /<view wx:if="\{\{view === 'my'\}\}" class="create-btn" role="button"/);
  assert.match(pageWxml, /class="view-tab-pill"/);
  assert.match(pageWxml, /企业报备/);
  assert.match(pageWxml, /bindinput="onSearchInput"/);
  assert.match(pageWxml, /bindtap="onViewTap"/);
  assert.match(pageWxml, /catchtap="onClaimRecord"/);
  assert.doesNotMatch(pageWxml, /[＋›]/);
  assert.doesNotMatch(pageWxml, /page-dock|onDockTap/);
  assert.doesNotMatch(pageJs, /DOCK_ITEMS|onDockTap|openSurveyingEditor/);

  for (const label of ['我的报备', '待量房', '待设计', '已超时', '公海']) {
    assert.match(pageJs, new RegExp(`label: '${label}'`));
  }

  assert.match(pageJs, /businessStage=measuring/);
  assert.match(pageJs, /businessStage=designing/);
  assert.match(pageJs, /workbench\/todos\?view=overdue/);
  assert.match(pageJs, /poolStatus=in_pool/);
  assert.match(pageJs, /filterRecords\(this\.data\.records, searchText\)/);
});

test('Promotion records preserves the 390x844 list density without a local TabBar', () => {
  assert.match(pageWxss, /\.hero\s*\{[^}]*height:\s*280rpx;/s);
  assert.match(pageWxss, /\.hero\s*\{[^}]*background:\s*#fdfcf8;/s);
  assert.doesNotMatch(pageWxss, /\.hero::after/);
  assert.match(pageWxss, /\.create-btn\s*\{[^}]*width:\s*252rpx;/s);
  assert.match(pageWxss, /\.create-btn\s*\{[^}]*align-self:\s*flex-start;/s);
  assert.match(pageWxss, /\.view-tabs\s*\{[^}]*height:\s*76rpx;/s);
  assert.match(pageWxss, /\.content-sheet\s*\{[^}]*border-radius:\s*42rpx 42rpx 0 0;/s);
  assert.match(pageWxss, /\.view-tabs-inner\s*\{[^}]*height:\s*76rpx;/s);
  assert.match(pageWxss, /\.view-tab\s*\{[^}]*height:\s*76rpx;/s);
  assert.match(pageWxss, /\.view-tab-pill\s*\{[^}]*height:\s*52rpx;/s);
  assert.match(pageWxss, /\.tab-indicator\s*\{[^}]*background:\s*#18ad50;/s);
  assert.match(pageWxss, /\.tab-indicator\s*\{[^}]*bottom:\s*0;/s);
  assert.match(pageWxss, /\.record-card\s*\{[^}]*min-height:\s*244rpx;/s);
  assert.match(pageWxss, /\.status-badge\s*\{[^}]*top:\s*14rpx;/s);
  assert.match(pageWxss, /\.record-list,[\s\S]*padding:\s*24rpx 4rpx 0;/);
  assert.doesNotMatch(pageWxss, /\.page-dock|\.dock-item|\.center-icon-wrap/);
  assert.doesNotMatch(pageWxss, /font-size:\s*(?:1[0-9]|[0-9])rpx/);
});

test('Promotion records translates legacy English creation entries for the list', () => {
  assert.match(pageJs, /report_created:\s*'已创建企业报备'/);
  assert.match(pageJs, /'Promotion report created':\s*'已创建企业报备'/);
  assert.match(pageJs, /localizeTimelineCopy\(latestFollowUp\.content, latestFollowUp\.type\)/);
});

test('Only the five primary routes own the shared custom TabBar', () => {
  assert.deepEqual(
    appConfig.tabBar.list.map((item) => item.pagePath),
    [
      'pages/index/index',
      'pages/enterprise-operations/enterprise-operations',
      'pages/leads-management/leads-management',
      'pages/ai-design/ai-design',
      'pages/mine/mine',
    ]
  );
  assert.ok(!appConfig.tabBar.list.some((item) => item.pagePath === 'pages/promotion-records/promotion-records'));
});

test('Promotion records hero asset is local and package-sized', () => {
  const heroPath = path.join(miniRoot, 'packages', 'business', 'assets', 'promotion-records', 'hero-scene.jpg');
  const bytes = fs.readFileSync(heroPath);
  assert.equal(bytes[0], 0xff);
  assert.equal(bytes[1], 0xd8);
  assert.ok(bytes.length < 120 * 1024, 'hero-scene.jpg exceeds the 120 KB page budget');
});
