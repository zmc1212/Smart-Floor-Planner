const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pageRoot = path.join(__dirname, '..', 'pages', 'index');
const pageScriptPath = path.join(pageRoot, 'index.js');
const assetPath = path.join(
  __dirname,
  '..',
  'images',
  'home-ip-v1',
  'hero-scene-wechat-safe-overscan.png'
);

test('Home moves the current-plan reminder into its measurement card', () => {
  const wxml = fs.readFileSync(path.join(pageRoot, 'index.wxml'), 'utf8');
  const less = fs.readFileSync(path.join(pageRoot, 'index.less'), 'utf8');
  const script = fs.readFileSync(pageScriptPath, 'utf8');

  assert.match(wxml, /hero-scene-wechat-safe-overscan\.png/);
  assert.match(wxml, /city-control--nav/);
  assert.match(wxml, /measure-reminder-badge/);
  assert.match(wxml, /measure-reminder-bell/);
  assert.doesNotMatch(wxml, /hero-reminder/);
  assert.match(wxml, /<text>把空间一步步<\/text>/);
  assert.match(wxml, /<text>变成家<\/text>/);
  assert.doesNotMatch(script, /reminderTop/);
  assert.match(less, /height: 516rpx/);
  assert.match(less, /top: -40rpx/);
  assert.match(less, /height: 685rpx/);
  assert.match(less, /font-size: 60rpx/);
  assert.match(less, /\.measure-reminder-badge/);
  assert.doesNotMatch(less, /hero-reminder/);
  assert.ok(fs.statSync(assetPath).size < 1024 * 1024, 'Hero asset stays under 1 MB');
});
