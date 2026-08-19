const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const miniRoot = path.resolve(__dirname, '..');
const pageDir = path.join(miniRoot, 'packages', 'business', 'promotion-record-detail');
const pageJs = fs.readFileSync(path.join(pageDir, 'promotion-record-detail.js'), 'utf8');
const pageWxml = fs.readFileSync(path.join(pageDir, 'promotion-record-detail.wxml'), 'utf8');
const pageWxss = fs.readFileSync(path.join(pageDir, 'promotion-record-detail.less'), 'utf8');

test('Enterprise report create mode matches the approved work-order structure', () => {
  assert.match(pageWxml, /packages\/business\/assets\/promotion-create\/hero-scene\.jpg/);
  assert.match(pageWxml, /class="create-form-card"/);
  assert.match(pageWxml, />企业信息</);
  assert.match(pageWxml, />联系人</);
  assert.match(pageWxml, /class="create-location-button"/);
  assert.match(pageWxml, /class="create-submit-button"/);
  assert.match(pageWxml, /联系人 <text class="required-mark">\*<\/text>/);
});

test('Enterprise report create controls keep real picker and submission behavior', () => {
  assert.match(pageWxml, /mode="selector"[^>]*bindchange="onIndustryChange"/);
  assert.match(pageWxml, /mode="region"[^>]*bindchange="onRegionChange"/);
  assert.match(pageWxml, /disabled="\{\{submitting\}\}"/);
  assert.match(pageJs, /title: options\.mode === 'create' \? '新建企业报备'/);
  assert.match(pageJs, /onIndustryChange\(e\)/);
  assert.match(pageJs, /onRegionChange\(e\)/);
  assert.match(pageJs, /if \(this\.data\.submitting\) return;/);
  assert.match(pageJs, /api\.request\('\/promotion-records', 'POST'/);
});

test('Enterprise report create visual anchors preserve the 390x844 composition', () => {
  assert.match(pageWxss, /\.create-page\s*\{[^}]*padding:\s*16rpx 26rpx/s);
  assert.match(pageWxss, /\.create-hero\s*\{[^}]*height:\s*302rpx/s);
  assert.match(pageWxss, /\.create-form-row\s*\{[^}]*height:\s*64rpx/s);
  assert.match(pageWxss, /\.create-location-button\s*\{[^}]*height:\s*68rpx/s);
  assert.match(pageWxss, /\.create-submit-button\s*\{[^}]*height:\s*92rpx/s);
});

test('Enterprise report create assets are local and compact', () => {
  const assetDir = path.join(miniRoot, 'packages', 'business', 'assets', 'promotion-create');
  const icons = [
    'building-2.png',
    'badge-check.png',
    'layers-3.png',
    'map-pin.png',
    'map.png',
    'user-round.png',
    'smartphone.png',
    'notebook-text.png',
    'shield-check.png',
    'location-pin.png',
    'chevron-right.png'
  ];

  for (const filename of icons) {
    const file = path.join(assetDir, filename);
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.ok(bytes.length <= 10 * 1024, `${filename} exceeds the 10KB icon budget`);
  }

  assert.ok(fs.statSync(path.join(assetDir, 'hero-scene.jpg')).size > 0);
});
