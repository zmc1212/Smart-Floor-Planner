const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const miniRoot = path.resolve(__dirname, '..');
const pageJs = fs.readFileSync(
  path.join(miniRoot, 'pages', 'promotion-records', 'promotion-records.js'),
  'utf8'
);
const pageWxml = fs.readFileSync(
  path.join(miniRoot, 'pages', 'promotion-records', 'promotion-records.wxml'),
  'utf8'
);
const pageWxss = fs.readFileSync(
  path.join(miniRoot, 'pages', 'promotion-records', 'promotion-records.wxss'),
  'utf8'
);

test('Promotion records ships the approved filing composition with live controls', () => {
  assert.match(pageWxml, /\/images\/promotion-records\/hero-scene\.jpg/);
  assert.match(pageWxml, /企业报备/);
  assert.match(pageWxml, /bindinput="onSearchInput"/);
  assert.match(pageWxml, /bindtap="onViewTap"/);
  assert.match(pageWxml, /catchtap="onClaimRecord"/);
  assert.match(pageWxml, /bindtap="onDockTap"/);
  assert.doesNotMatch(pageWxml, /[＋›]/);

  for (const label of ['我的报备', '待量房', '待设计', '已超时', '公海']) {
    assert.match(pageJs, new RegExp(`label: '${label}'`));
  }

  assert.match(pageJs, /businessStage=measuring/);
  assert.match(pageJs, /businessStage=designing/);
  assert.match(pageJs, /workbench\/todos\?view=overdue/);
  assert.match(pageJs, /poolStatus=in_pool/);
  assert.match(pageJs, /filterRecords\(this\.data\.records, searchText\)/);
  assert.match(pageJs, /openSurveyingEditor/);
});

test('Promotion records preserves the 390x844 list density and readable text floor', () => {
  assert.match(pageWxss, /\.hero\s*\{[^}]*height:\s*286rpx;/s);
  assert.match(pageWxss, /\.content-sheet\s*\{[^}]*border-radius:\s*42rpx 42rpx 0 0;/s);
  assert.match(pageWxss, /\.record-card\s*\{[^}]*min-height:\s*238rpx;/s);
  assert.match(pageWxss, /\.page-dock\s*\{[^}]*height:\s*116rpx;/s);
  assert.doesNotMatch(pageWxss, /font-size:\s*(?:1[0-9]|[0-9])rpx/);
});

test('Promotion records hero asset is local and package-sized', () => {
  const heroPath = path.join(miniRoot, 'images', 'promotion-records', 'hero-scene.jpg');
  const bytes = fs.readFileSync(heroPath);
  assert.equal(bytes[0], 0xff);
  assert.equal(bytes[1], 0xd8);
  assert.ok(bytes.length < 120 * 1024, 'hero-scene.jpg exceeds the 120 KB page budget');
});
