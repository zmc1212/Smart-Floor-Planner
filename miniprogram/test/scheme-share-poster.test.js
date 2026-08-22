const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const componentRoot = path.join(root, 'components', 'scheme-share-poster');

test('scheme-share-poster is a branded image poster without mini-program share card', () => {
  const js = fs.readFileSync(path.join(componentRoot, 'scheme-share-poster.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(componentRoot, 'scheme-share-poster.wxml'), 'utf8');
  const json = JSON.parse(fs.readFileSync(path.join(componentRoot, 'scheme-share-poster.json'), 'utf8'));
  const less = fs.readFileSync(path.join(componentRoot, 'scheme-share-poster.less'), 'utf8');

  assert.equal(json.component, true);
  assert.match(js, /properties:\s*\{[\s\S]*visible:[\s\S]*imagePath:[\s\S]*schemeTitle:/);
  assert.match(js, /home-ip-v1\/brand-logo\.png/);
  assert.match(js, /家客来/);
  assert.match(js, /saveImageToPhotosAlbum/);
  assert.match(js, /showShareImageMenu/);
  assert.match(js, /openSheet|sheetMotion/);
  assert.match(js, /canvasToTempFilePath/);
  assert.doesNotMatch(js, /小程序码|量房大师|onShareAppMessage/);
  assert.doesNotMatch(wxml, /open-type="share"/);
  assert.match(wxml, /保存后分享图片/);
  assert.match(wxml, /保存到相册/);
  assert.match(wxml, /保存后可发给家人或发朋友圈/);
  assert.match(wxml, /schemePosterCanvas/);
  assert.match(less, /translateY\(100%\)/);
  assert.match(less, /opacity 240ms/);
  assert.match(less, /transform 240ms/);
  assert.match(less, /button\.ssp-save\[disabled\][\s\S]*--action-disabled-bg/);
});
