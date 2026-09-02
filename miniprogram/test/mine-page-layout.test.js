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

test('Mine visitor gateway uses the packaged JoveKore logo and docks above the customer TabBar', () => {
  assert.match(mineMarkup, /isLoggedIn \? 'sfp-tab-page' : 'guest-page sfp-tab-page'/);
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
  assert.match(mineStyles, /\.guest-page\s*\{[\s\S]*?height:\s*100%/);
  assert.match(mineStyles, /\.login-visual\s*\{[\s\S]*?height:\s*700rpx/);
  assert.match(mineStyles, /\.login-panel\s*\{[\s\S]*?margin:\s*-34rpx 32rpx 0/);
  assert.match(mineStyles, /\.identity-options\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,/);
  assert.match(mineStyles, /\.identity-icon-shell image\s*\{[\s\S]*?width:\s*70rpx;[\s\S]*?height:\s*70rpx/);
  assert.match(mineStyles, /\.login-button\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*none/);
  assert.match(mineStyles, /\.login-trust-note\s*\{[\s\S]*?font-size:\s*22rpx/);
  assert.match(mineMarkup, /class="login-trust-mark"[\s\S]*?images\/mine-icons\/shield-check\.png/);
  assert.doesNotMatch(mineStyles, /\.login-trust-mark::after/);

  const narrowViewportStyles = mineStyles.slice(
    mineStyles.indexOf('@media (max-width: 360px)')
  );
  assert.doesNotMatch(narrowViewportStyles, /\.guest-brand-lockup/);
  assert.doesNotMatch(narrowViewportStyles, /\.login-visual/);
  assert.doesNotMatch(narrowViewportStyles, /\.login-panel/);
  assert.doesNotMatch(narrowViewportStyles, /\.login-title/);
  assert.doesNotMatch(narrowViewportStyles, /\.identity-icon-shell/);
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

  const trustIconBytes = fs.readFileSync(
    path.join(__dirname, '../images/mine-icons/shield-check.png')
  );
  assert.deepEqual([...trustIconBytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(trustIconBytes.length < 10 * 1024, 'shield-check.png exceeds the 10 KB icon budget');
});

test('Mine account panel exposes the role-scoped referrer network entry', () => {
  assert.match(
    mineMarkup,
    /wx:if="\{\{showReferrerNetworkEntry\}\}"[\s\S]*bindtap="onOpenReferrerNetwork"/
  );
  assert.match(mineMarkup, /referrer-network-v2\.png/);
  assert.match(mineMarkup, /images\/mine-icons\/permission-management-v2\.png/);
  assert.doesNotMatch(mineMarkup, /user-round-plus\.png|images\/mine-icons\/settings\.png|images\/mine-v6\/settings\.png/);
  assert.match(mineMarkup, /\{\{referrerNetworkEntryLabel\}\}/);
  assert.match(mineMarkup, /\{\{referrerNetworkEntryHelper\}\}/);
  assert.match(
    mineMarkup,
    /template is="mineAccountPanel" data="\{\{showRoleGuideEntry, showRegistrationCodeEntry, showReferrerNetworkEntry, referrerNetworkEntryLabel, referrerNetworkEntryHelper, roleGuideHelper, updateStatusLabel\}\}"/
  );
});

test('Mine account panel exposes the official mini program update check entry', () => {
  assert.match(mineMarkup, /bindtap="onCheckVersion"/);
  assert.match(mineMarkup, /检查当前版本/);
  assert.match(mineMarkup, /\{\{updateStatusLabel\}\}/);
  assert.match(mineMarkup, /version-check-v2\.png/);
  assert.doesNotMatch(mineMarkup, /search\.png/);
  assert.match(mineMarkup, /updateStatusLabel/);
});

test('Mine permission, referrer, and version icons use small transparent PNG assets from the account icon family', () => {
  for (const name of ['permission-management-v2', 'referrer-network-v2', 'version-check-v2']) {
    const bytes = fs.readFileSync(path.join(__dirname, `../images/mine-icons/${name}.png`));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(bytes.length < 10 * 1024, `${name}.png exceeds the 10 KB icon budget`);
  }
});
