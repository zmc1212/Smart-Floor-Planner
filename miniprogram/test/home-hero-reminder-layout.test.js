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
  const wxss = fs.readFileSync(path.join(pageRoot, 'index.wxss'), 'utf8');
  const script = fs.readFileSync(pageScriptPath, 'utf8');

  assert.match(wxml, /hero-scene-wechat-safe-overscan\.png/);
  assert.match(wxml, /city-control--nav/);
  assert.match(wxml, /measure-reminder-badge/);
  assert.match(wxml, /measure-reminder-bell/);
  assert.doesNotMatch(wxml, /hero-reminder/);
  assert.match(wxml, /<text>把空间一步步<\/text>/);
  assert.match(wxml, /<text>变成家<\/text>/);
  assert.doesNotMatch(script, /reminderTop/);
  assert.match(wxss, /height: 516rpx/);
  assert.match(wxss, /top: -40rpx/);
  assert.match(wxss, /height: 685rpx/);
  assert.match(wxss, /font-size: 60rpx/);
  assert.match(wxss, /\.measure-reminder-badge/);
  assert.doesNotMatch(wxss, /hero-reminder/);
  assert.ok(fs.statSync(assetPath).size < 1024 * 1024, 'Hero asset stays under 1 MB');
});
