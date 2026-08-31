const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { refreshAccountSettingsState } = require('../utils/account-settings-state.js');

const projectRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function loadPage(relativePath, app = { globalData: {} }) {
  let definition = null;
  const originalPage = global.Page;
  const originalGetApp = global.getApp;
  global.Page = (config) => { definition = config; };
  global.getApp = () => app;
  const modulePath = require.resolve(path.join(projectRoot, relativePath));
  delete require.cache[modulePath];
  require(modulePath);
  delete require.cache[modulePath];
  global.Page = originalPage;
  global.getApp = originalGetApp;
  return definition;
}

function createPage(definition) {
  return {
    ...definition,
    data: { ...definition.data },
    setData(update) { Object.assign(this.data, update); }
  };
}

test('Mine hosts account settings inline and routes deep pages separately', () => {
  const appConfig = JSON.parse(read('app.json'));
  const business = appConfig.subPackages.find((item) => item.root === 'packages/business');
  const guides = appConfig.subPackages.find((item) => item.root === 'packages/guides');
  const mineWxml = read('pages/mine/mine.wxml');
  const mineJs = read('pages/mine/mine.js');
  const settingsJs = read('packages/business/settings/settings.js');

  assert.ok(business.pages.includes('profile-edit/profile-edit'));
  assert.ok(business.pages.includes('settings/settings'));
  assert.ok(business.pages.includes('account-security/account-security'));
  assert.ok(business.pages.includes('identity-switch/identity-switch'));
  assert.deepEqual(guides.pages, ['referrer-guide/referrer-guide', 'enterprise-owner-guide/enterprise-owner-guide', 'designer-guide/designer-guide', 'measurer-guide/measurer-guide']);
  assert.match(mineWxml, /account-section-title">账号[\s\S]*bindtap="onEditProfile"[\s\S]*编辑资料/);
  assert.doesNotMatch(mineWxml, /edit-profile-button|header-actions/);
  assert.doesNotMatch(mineWxml, /bindtap="onOpenSettings"/);
  assert.match(mineWxml, /mineAccountPanel/);
  assert.doesNotMatch(mineWxml, /bindtap="onEnableNotification"/);
  assert.doesNotMatch(mineWxml, /订阅任务通知/);
  assert.match(mineWxml, /account-section-title">权限</);
  assert.match(mineWxml, /bindtap="onOpenSystemSettings"/);
  assert.match(mineWxml, /微信权限管理/);
  assert.match(mineWxml, /bindtap="onOpenIdentitySwitch"/);
  assert.match(mineWxml, /当前身份/);
  assert.match(mineWxml, /在个人用户、员工和推荐人身份之间切换/);
  assert.match(mineWxml, /template is="mineAccountPanel" data="\{\{showRoleGuideEntry, showRegistrationCodeEntry, showReferrerNetworkEntry, referrerNetworkEntryLabel, referrerNetworkEntryHelper, roleGuideHelper\}\}"/);
  assert.match(mineWxml, /wx:if="\{\{showRoleGuideEntry\}\}"[\s\S]*bindtap="onOpenRoleGuide"/);
  assert.match(mineWxml, /角色使用引导/);
  assert.match(mineWxml, /roleGuideHelper/);
  assert.match(mineWxml, /wx:if="\{\{showReferrerNetworkEntry\}\}"[\s\S]*bindtap="onOpenReferrerNetwork"/);
  assert.match(mineJs, /referrerNetworkEntryForIdentity\(/);
  assert.match(mineJs, /onOpenReferrerNetwork\(\)[\s\S]*enterprise-referrers\/enterprise-referrers/);
  assert.match(mineJs, /mineRoleGuideEntry\(/);
  assert.match(mineJs, /onOpenRoleGuide\(\)[\s\S]*openMineRoleGuide\(/);
  assert.match(mineWxml, /账号与安全[\s\S]*onOpenAccountSecurity|onOpenAccountSecurity[\s\S]*账号与安全/);
  assert.match(mineJs, /onEditProfile\(\)[\s\S]*profile-edit\/profile-edit/);
  assert.match(mineJs, /onOpenAccountSecurity\(\)[\s\S]*account-security\/account-security/);
  assert.match(mineJs, /onOpenIdentitySwitch\(\)[\s\S]*identity-switch\/identity-switch/);
  assert.match(settingsJs, /switchTab\([\s\S]*pages\/mine\/mine/);
});

test('Account pages use the approved account-v1 scenes while keeping live controls native', () => {
  const heroPages = [
    {
      source: read('packages/business/profile-edit/profile-edit.wxml'),
      scene: 'profile-dossier-scene-v3.png'
    },
    {
      source: read('packages/business/account-security/account-security.wxml'),
      scene: 'security-guardian-scene-v3.png'
    }
  ];

  for (const { scene } of heroPages) {
    const scenePath = path.join(projectRoot, 'packages', 'business', 'assets', 'account-v1', scene);
    assert.ok(fs.existsSync(scenePath), `${scene} must be a local runtime asset`);
    assert.ok(fs.statSync(scenePath).size <= 200 * 1024, `${scene} must remain package-sized`);
    const bytes = fs.readFileSync(scenePath);
    assert.equal(bytes.toString('ascii', 1, 4), 'PNG');
    assert.equal(bytes[25], 6, `${scene} must retain an RGBA alpha channel`);
  }

  for (const { source, scene } of heroPages) {
    assert.match(source, new RegExp(scene.replace('.', '\\.')));
    assert.match(source, /<view class="account-hero-copy">/);
    assert.match(source, /<image class="account-hero-art"/);
    assert.doesNotMatch(source, /design-references/);
  }

  const mineWxml = read('pages/mine/mine.wxml');
  assert.match(heroPages[0].source, /<input class="field-input"/);
  assert.match(heroPages[0].source, /class="account-profile-card"/);
  assert.match(heroPages[0].source, /class="account-avatar-shell"/);
  assert.match(heroPages[0].source, /class="account-profile-avatar"[^>]*mode="aspectFill"/);
  assert.doesNotMatch(heroPages[0].source, /class="profile-card"/);
  assert.doesNotMatch(mineWxml, /bindtap="onEnableNotification"/);
  assert.match(mineWxml, /bindtap="onOpenSystemSettings"/);
  assert.match(mineWxml, /bindtap="onOpenIdentitySwitch"/);
  assert.doesNotMatch(mineWxml, /settings-guardian-scene-v3\.png/);
  assert.match(heroPages[2].source, /bindtap="onChangePassword"/);
});

test('Identity switch uses server contexts and refreshes the signed session', () => {
  const script = read('packages/business/identity-switch/identity-switch.js');
  const wxml = read('packages/business/identity-switch/identity-switch.wxml');
  const less = read('packages/business/identity-switch/identity-switch.less');
  assert.match(script, /\/miniprogram\/identity-contexts/);
  assert.match(script, /\/miniprogram\/identity-contexts\/switch/);
  assert.match(script, /type: 'refresh', token: switched\.token/);
  assert.match(script, /wx\.setStorageSync\('userInfo', refreshed\.user\)/);
  assert.match(script, /referrer-workbench\/referrer-workbench/);
  assert.doesNotMatch(wxml, /settings-guardian-scene-v3\.png/);
  assert.match(wxml, /selectedContext\.current/);
  assert.match(wxml, /contexts\.length > 1/);
  assert.match(wxml, /当前账号只有一个有效身份/);
  assert.match(wxml, /<button[\s\S]*wx:if="\{\{contexts\.length > 1\}\}"/);
  assert.match(script, /IDENTITY_ICONS/);
  assert.match(script, /customer: '个人用户'/);
  assert.match(script, /selectedContext/);
  assert.match(script, /confirmSelectedIdentity/);
  assert.match(script, /platform_admin: '\u5e73\u53f0\u7ba1\u7406\u5458'/);
  assert.match(wxml, /class="identity-intro"/);
  assert.doesNotMatch(wxml, /role-gallery-stage-v1\.png/);
  assert.doesNotMatch(wxml, /side-role/);
  assert.doesNotMatch(wxml, /选择你的角色/);
  assert.doesNotMatch(script, /resolveSideContexts/);
  assert.doesNotMatch(wxml, /role-rail|role-token/);
  assert.match(wxml, /class="role-grid"/);
  assert.match(wxml, /class="role-card-art"/);
  assert.match(wxml, /每张卡都会完整显示身份名称/);
  assert.match(script, /ROLE_CARD_ART/);
  assert.match(script, /ROLE_CARD_HELPERS/);
  assert.match(wxml, /confirmSelectedIdentity/);
  assert.match(less, /\.identity-confirm\[disabled\][\s\S]*background: #c8efd8 !important/);
  for (const icon of ['customer', 'referrer', 'enterprise-admin', 'designer', 'measurer', 'salesperson', 'platform-admin']) {
    const iconPath = path.join(projectRoot, 'packages', 'business', 'assets', 'identity-switch', `${icon}.png`);
    assert.ok(fs.existsSync(iconPath), `${icon} identity icon must be packaged`);
    assert.ok(fs.statSync(iconPath).size <= 300 * 1024, `${icon} identity icon must remain package-sized`);
    const bytes = fs.readFileSync(iconPath);
    assert.equal(bytes.toString('ascii', 1, 4), 'PNG');
    assert.equal(bytes[25], 6, `${icon} identity icon must retain an RGBA alpha channel`);
  }
  for (const asset of ['customer-service', 'designer-plan', 'measurer-laser', 'referrer-contact', 'enterprise-operations', 'sales-promotion', 'platform-console']) {
    const assetPath = path.join(projectRoot, 'packages', 'business', 'assets', 'identity-switch', 'role-cards', `${asset}.png`);
    assert.ok(fs.existsSync(assetPath), `${asset} role-card illustration must be packaged`);
    assert.ok(fs.statSync(assetPath).size <= 300 * 1024, `${asset} role-card illustration must remain package-sized`);
    const bytes = fs.readFileSync(assetPath);
    assert.equal(bytes.toString('ascii', 1, 4), 'PNG');
    assert.equal(bytes[25], 6, `${asset} role-card illustration must retain an RGBA alpha channel`);
  }
});

test('Profile save uploads a pending avatar, updates the nickname, and refreshes session data', async () => {
  const api = require('../utils/api.js');
  const originalRequest = api.request;
  const originalUpload = api.uploadProfileAvatar;
  const originalWx = global.wx;
  const app = { globalData: { userInfo: { role: 'staff' } } };
  const calls = [];
  global.wx = {
    getStorageSync() { return {}; },
    setStorageSync(key, value) { calls.push(['storage', key, value]); },
    showToast(options) { calls.push(['toast', options.title]); },
    navigateBack() { calls.push(['navigateBack']); }
  };
  api.uploadProfileAvatar = async (filePath) => {
    calls.push(['upload', filePath]);
    return { data: { avatar: 'https://example.com/new-avatar.webp' } };
  };
  api.request = async (url, method, data) => {
    calls.push(['request', url, method, data]);
    return {
      data: {
        name: '新昵称',
        avatar: 'https://example.com/signed-avatar.webp',
        role: 'designer',
        enterpriseName: '示例企业'
      }
    };
  };

  try {
    const page = createPage(loadPage('packages/business/profile-edit/profile-edit.js', app));
    page.data.nickname = ' 新昵称 ';
    page.data.pendingAvatarPath = 'wxfile://avatar.jpg';
    await page.onSave();

    assert.deepEqual(calls[0], ['upload', 'wxfile://avatar.jpg']);
    assert.deepEqual(calls[1], [
      'request',
      '/miniprogram/profile',
      'PATCH',
      { nickname: '新昵称' }
    ]);
    assert.equal(app.globalData.userInfo.nickname, '新昵称');
    assert.equal(app.globalData.userInfo.avatar, 'https://example.com/signed-avatar.webp');
    assert.equal(page.data.saving, false);
    await new Promise((resolve) => setTimeout(resolve, 550));
    assert.ok(calls.some((item) => item[0] === 'navigateBack'));
  } finally {
    api.request = originalRequest;
    api.uploadProfileAvatar = originalUpload;
    global.wx = originalWx;
  }
});

test('Account security validates password confirmation before calling the API', async () => {
  const api = require('../utils/api.js');
  const originalRequest = api.request;
  const originalWx = global.wx;
  const calls = [];
  global.wx = { showToast(options) { calls.push(options.title); } };
  api.request = async () => { throw new Error('API should not be called'); };

  try {
    const page = createPage(loadPage('packages/business/account-security/account-security.js'));
    page.data.currentPassword = 'old-pass';
    page.data.newPassword = 'new-pass';
    page.data.confirmPassword = 'different';
    await page.onChangePassword();
    assert.deepEqual(calls, ['两次输入的新密码不一致']);
    assert.equal(page.data.submitting, false);
  } finally {
    api.request = originalRequest;
    global.wx = originalWx;
  }
});

test('Successful password change clears the session and returns to login', async () => {
  const api = require('../utils/api.js');
  const session = require('../utils/session.js');
  const originalRequest = api.request;
  const originalClear = session.clearSession;
  const originalLogin = session.goToLogin;
  const originalWx = global.wx;
  const calls = [];
  api.request = async (url, method, data) => {
    calls.push(['request', url, method, data]);
    return { success: true, data: {} };
  };
  session.clearSession = () => calls.push(['clearSession']);
  session.goToLogin = () => calls.push(['goToLogin']);
  global.wx = {
    showToast() {},
    showModal(options) {
      calls.push(['modal', options.title]);
      options.success({ confirm: true });
    }
  };

  try {
    const page = createPage(loadPage('packages/business/account-security/account-security.js'));
    page.data.currentPassword = 'old-pass';
    page.data.newPassword = 'new-pass';
    page.data.confirmPassword = 'new-pass';
    await page.onChangePassword();
    assert.deepEqual(calls, [
      ['request', '/miniprogram/account/password', 'PUT', {
        currentPassword: 'old-pass',
        newPassword: 'new-pass'
      }],
      ['clearSession'],
      ['modal', '密码已修改'],
      ['goToLogin']
    ]);
  } finally {
    api.request = originalRequest;
    session.clearSession = originalClear;
    session.goToLogin = originalLogin;
    global.wx = originalWx;
  }
});

test('Mine opens WeChat settings without reading subscription status', async () => {
  const originalWx = global.wx;
  const calls = [];
  global.wx = {
    openSetting(options) {
      calls.push('openSetting');
      options.complete();
    }
  };

  try {
    const page = createPage(loadPage('pages/mine/mine.js'));
    await refreshAccountSettingsState(page);
    assert.equal(Object.prototype.hasOwnProperty.call(page.data, 'notificationStatus'), false);
    assert.match(page.data.identityLabel || '读取中', /当前身份|个人用户身份|推荐人身份|员工身份|读取/);
    await page.onOpenSystemSettings();
    assert.deepEqual(calls, ['openSetting']);
  } finally {
    global.wx = originalWx;
  }
});

test('Settings route redirects to the Mine tab for backward-compatible deep links', () => {
  const settingsJs = read('packages/business/settings/settings.js');
  assert.match(settingsJs, /switchTab\([\s\S]*\/pages\/mine\/mine/);
});

test('Shared session clear removes every persisted identity value', () => {
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const removed = [];
  const app = { globalData: { token: 'token', userInfo: {}, openid: 'openid', referral: {} } };
  global.getApp = () => app;
  global.wx = { removeStorageSync(key) { removed.push(key); } };
  const sessionPath = require.resolve('../utils/session.js');
  delete require.cache[sessionPath];
  const session = require(sessionPath);

  try {
    session.clearSession();
    assert.deepEqual(removed.sort(), ['lastValidIdentityContext', 'openid', 'token', 'userInfo']);
    assert.equal(app.globalData.token, null);
    assert.equal(app.globalData.userInfo, null);
    assert.deepEqual(app.globalData.referral, { enterpriseId: null, staffId: null });
  } finally {
    delete require.cache[sessionPath];
    global.wx = originalWx;
    global.getApp = originalGetApp;
  }
});
