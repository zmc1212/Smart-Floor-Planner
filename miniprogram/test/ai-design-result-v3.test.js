const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('AI design result restores the V3 delivery layout with only live actions', () => {
  const wxml = read('packages/ai-workflow/result/ai-design-result.wxml');
  const wxss = read('packages/ai-workflow/result/ai-design-result.wxss');
  const config = JSON.parse(read('packages/ai-workflow/result/ai-design-result.json'));

  assert.match(wxml, /方案已生成，看看效果如何吧！/);
  assert.match(wxml, /src="\/packages\/ai-workflow\/assets\/page-ip-v3\/ai-result\.jpg"/);
  assert.match(wxml, /bindtap="previewResult"/);
  assert.match(wxml, /bindtap="saveResult"/);
  assert.match(wxml, /open-type="share"/);
  assert.match(wxml, /result-icons\/share\.png/);
  assert.match(wxml, /bindtap="handlePrimaryAction"/);
  assert.match(wxml, /bindtap="openHistory"/);
  assert.match(wxml, /class="result-delivery-character"/);
  assert.match(wxml, /wx:if="\{\{task\.showComparison\}\}"/);
  assert.match(wxss, /\.delivery-bubble/);
  assert.match(wxss, /\.result-delivery-character/);
  assert.match(wxss, /\.before-label \{ left: 28rpx; background:/);
  assert.match(wxss, /\.after-label \{ right: 28rpx; background:/);
  assert.match(wxss, /min-height: 146rpx/);
  assert.match(wxss, /min-height: 100rpx/);
  assert.match(wxss, /\.summary-workflow-value/);
  assert.match(wxss, /\.bottom-action:first-child/);
  assert.match(wxss, /min-height: 64rpx/);
  assert.match(wxss, /height: 84rpx/);
  assert.equal(config.navigationBarTitleText, '设计成果');
});

test('AI design result keeps generated artwork inside the approved near-square delivery window', () => {
  const script = read('packages/ai-workflow/result/ai-design-result.js');
  const wxml = read('packages/ai-workflow/result/ai-design-result.wxml');

  assert.match(script, /resultImageMode: ratio < 0\.85 \|\| ratio > 1\.25 \? 'aspectFit' : 'aspectFill'/);
  assert.match(script, /resultStageHeight: Math\.max\(720, Math\.min\(760, ratioAwareHeight\)\)/);
  assert.match(wxml, /mode="\{\{task\.resultImageMode\}\}"/);
  assert.match(wxml, /<text class="summary-label">当前空间<\/text>[\s\S]*<text class="summary-label">生成模式<\/text>/);
  assert.doesNotMatch(wxml, /候选版本|当前定稿/);
});
