const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mineStyles = fs.readFileSync(
  path.join(__dirname, '../pages/mine/mine.less'),
  'utf8'
);
const mineMarkup = fs.readFileSync(
  path.join(__dirname, '../pages/mine/mine.wxml'),
  'utf8'
);

test('Mine workbench keeps four columns on narrow real-device viewports', () => {
  const narrowViewportStyles = mineStyles.slice(
    mineStyles.indexOf('@media (max-width: 360px)')
  );

  assert.match(
    mineStyles,
    /\.tool-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/
  );
  assert.match(
    narrowViewportStyles,
    /\.tool-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/
  );
  assert.doesNotMatch(
    narrowViewportStyles,
    /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/
  );
});

test('Mine header stays above the profile card and role artwork', () => {
  assert.match(
    mineStyles,
    /\.mine-header\s*\{[\s\S]*?z-index:\s*5/
  );
  assert.match(
    mineStyles,
    /\.profile-card\s*\{[\s\S]*?z-index:\s*2/
  );
  assert.match(
    mineStyles,
    /\.mine-role-scene\s*\{[\s\S]*?z-index:\s*3/
  );
});

test('Mine profile card follows the safe header in normal flow', () => {
  const profileCardBlock = mineStyles.match(/\.profile-card\s*\{([\s\S]*?)\}/);

  assert.ok(profileCardBlock, 'profile-card rule should exist');
  assert.match(
    profileCardBlock[1],
    /position:\s*relative[\s\S]*?margin-top:\s*28rpx/
  );
  assert.match(
    mineStyles,
    /\.user-profile-hero\s*\{[\s\S]*?height:\s*400rpx/
  );
});

test('Mine visitor gateway uses the packaged JoveKore logo and keeps the full viewport', () => {
  assert.match(mineMarkup, /isLoggedIn \? 'sfp-tab-page' : 'guest-page'/);
  assert.match(mineMarkup, /images\/home-ip-v1\/brand-logo\.png/);
  assert.match(mineMarkup, /images\/home-ip-v1\/login-identity-portal-v2\.jpg/);
  assert.match(mineMarkup, /JoveKore[\s\S]*家客来/);
  assert.match(mineMarkup, /登录后，打开你的专属工作台/);
  assert.match(mineMarkup, /个人用户[\s\S]*员工[\s\S]*推荐人/);
  assert.match(mineMarkup, /登录后自动匹配身份/);
  assert.match(mineMarkup, /一个账号 · 多重身份 · 随时切换/);
  assert.doesNotMatch(mineMarkup, /SMART FLOOR PLANNER/);
  assert.doesNotMatch(mineMarkup, /智能量房大师/);
  assert.doesNotMatch(mineMarkup, /<text>客户<\/text>/);
  assert.match(mineStyles, /\.guest-page\s*\{[\s\S]*?height:\s*100vh/);
  assert.match(mineStyles, /\.login-visual\s*\{[\s\S]*?height:\s*700rpx/);
  assert.match(mineStyles, /\.login-panel\s*\{[\s\S]*?margin:\s*-34rpx 32rpx 0/);
  assert.match(mineStyles, /\.identity-options\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,/);
  assert.match(mineStyles, /\.login-trust-note\s*\{[\s\S]*?font-size:\s*22rpx/);
});

test('Mine visitor gateway packages the dense hero and coherent identity icon family', () => {
  const heroBytes = fs.readFileSync(
    path.join(__dirname, '../images/home-ip-v1/login-identity-portal-v2.jpg')
  );
  assert.equal(heroBytes[0], 0xff);
  assert.equal(heroBytes[1], 0xd8);
  assert.ok(heroBytes.length <= 300 * 1024, 'visitor hero exceeds the 300 KB runtime limit');

  for (const name of ['identity-personal-user', 'identity-staff', 'identity-referrer']) {
    const bytes = fs.readFileSync(path.join(__dirname, `../images/mine-icons/${name}.png`));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(bytes.length < 10 * 1024, `${name}.png exceeds the 10 KB icon budget`);
  }
});
