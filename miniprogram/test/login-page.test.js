const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');

test('Login page ships the approved Xiao K entry composition with live controls', () => {
  const wxml = fs.readFileSync(path.join(projectRoot, 'pages/login/login.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(projectRoot, 'pages/login/login.wxss'), 'utf8');

  assert.match(wxml, /\/images\/login-v1\/hero-scene\.jpg/);
  assert.match(wxml, /家客来/);
  assert.match(wxml, /企业客户工作台/);
  assert.match(wxml, /open-type="getPhoneNumber"/);
  assert.match(wxml, /data-type="password"/);
  assert.match(wxml, /精准量房/);
  assert.match(wxml, /AI设计/);
  assert.match(wxml, /灵感图库/);
  assert.match(wxml, /返回首页/);

  assert.match(wxss, /\.hero-wrap\s*\{[\s\S]*height:\s*790rpx/);
  assert.match(wxss, /\.login-card\s*\{[\s\S]*margin:\s*-66rpx 26rpx 0/);
  assert.match(wxss, /\.feature-row\s*\{[\s\S]*height:\s*150rpx/);
  assert.doesNotMatch(wxss, /\.bubble|\.target-icon|\.image-mountain/);
});

test('Login visual assets are local, valid, and stay within the Mini Program budget', () => {
  const assetDir = path.join(projectRoot, 'images/login-v1');
  const pngNames = ['smartphone', 'measure', 'ai', 'images', 'chevron-right', 'wechat'];

  for (const name of pngNames) {
    const filePath = path.join(assetDir, `${name}.png`);
    const bytes = fs.readFileSync(filePath);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(bytes.length < 10 * 1024, `${name}.png exceeds the 10 KB icon budget`);
  }

  const heroPath = path.join(assetDir, 'hero-scene.jpg');
  const heroBytes = fs.readFileSync(heroPath);
  assert.equal(heroBytes[0], 0xff);
  assert.equal(heroBytes[1], 0xd8);
  assert.ok(heroBytes.length < 120 * 1024, 'hero-scene.jpg exceeds the 120 KB page budget');
});
