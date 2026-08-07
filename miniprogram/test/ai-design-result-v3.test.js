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
  assert.match(wxml, /src="\/images\/page-ip-v3\/ai-result\.png"/);
  assert.match(wxml, /bindtap="previewResult"/);
  assert.match(wxml, /bindtap="saveResult"/);
  assert.match(wxml, /open-type="share"/);
  assert.match(wxml, /bindtap="handlePrimaryAction"/);
  assert.match(wxml, /bindtap="openHistory"/);
  assert.match(wxss, /\.delivery-bubble/);
  assert.match(wxss, /\.bottom-action:first-child/);
  assert.equal(config.navigationBarTitleText, '设计成果');
});
