const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const notificationTemplates = [
  ['workflow_todo', '48Jvq7OjOKwRhshn8fyvtsjxAamLOakaNtiKcO11rOc'],
  ['lead_assignment', 'wltuS0LdggzpMWdSOlr6FBSKeRbOKUzqXVCqJDmLpmA'],
  ['new_lead', 'EEvg03Lsp4V0ASHWhLOMiTmDI79Z_T3Sjq4xest9GRc'],
  ['measurement_appointment', 'CtcuQ_NWF4GOpHvstgviDPmYRlSjyqTjnFAoeQR9-vl'],
];

function notificationConfig() {
  return {
    version: 2,
    templates: notificationTemplates.map(([type, templateId]) => ({ type, templateId, title: type }))
  };
}

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

test('Mine routes edit, settings, and security actions to separate real pages', () => {
  const appConfig = JSON.parse(read('app.json'));
  const business = appConfig.subPackages.find((item) => item.root === 'packages/business');
  const mineWxml = read('pages/mine/mine.wxml');
  const mineJs = read('pages/mine/mine.js');

  assert.ok(business.pages.includes('profile-edit/profile-edit'));
  assert.ok(business.pages.includes('settings/settings'));
  assert.ok(business.pages.includes('account-security/account-security'));
  assert.match(mineWxml, /编辑资料[\s\S]*bindtap="onEditProfile"|bindtap="onEditProfile"[\s\S]*编辑资料/);
  assert.match(mineWxml, /settings-button[^>]*bindtap="onOpenSettings"/);
  assert.match(mineWxml, /账号与安全[\s\S]*onOpenAccountSecurity|onOpenAccountSecurity[\s\S]*账号与安全/);
  assert.match(mineJs, /onEditProfile\(\)[\s\S]*profile-edit\/profile-edit/);
  assert.match(mineJs, /onOpenSettings\(\)[\s\S]*settings\/settings/);
  assert.match(mineJs, /onOpenAccountSecurity\(\)[\s\S]*account-security\/account-security/);
});

test('Account pages use the approved account-v1 scenes while keeping live controls native', () => {
  const sceneNames = [
    'profile-dossier-scene-v3.png',
    'settings-guardian-scene-v3.png',
    'security-guardian-scene-v3.png',
  ];
  const pageSources = [
    read('packages/business/profile-edit/profile-edit.wxml'),
    read('packages/business/settings/settings.wxml'),
    read('packages/business/account-security/account-security.wxml'),
  ];

  for (const sceneName of sceneNames) {
    const scenePath = path.join(projectRoot, 'packages', 'business', 'assets', 'account-v1', sceneName);
    assert.ok(fs.existsSync(scenePath), `${sceneName} must be a local runtime asset`);
    assert.ok(fs.statSync(scenePath).size <= 200 * 1024, `${sceneName} must remain package-sized`);
    const bytes = fs.readFileSync(scenePath);
    assert.equal(bytes.toString('ascii', 1, 4), 'PNG');
    assert.equal(bytes[25], 6, `${sceneName} must retain an RGBA alpha channel`);
  }

  for (const [index, source] of pageSources.entries()) {
    assert.match(source, new RegExp(sceneNames[index].replace('.', '\\.')));
    assert.match(source, /<view class="account-hero-copy">/);
    assert.match(source, /<image class="account-hero-art"/);
    assert.doesNotMatch(source, /design-references/);
  }

  assert.match(pageSources[0], /<input class="field-input"/);
  assert.match(pageSources[0], /class="account-profile-card"/);
  assert.match(pageSources[0], /class="account-avatar-shell"/);
  assert.match(pageSources[0], /class="account-profile-avatar"[^>]*mode="aspectFill"/);
  assert.doesNotMatch(pageSources[0], /class="profile-card"/);
  assert.match(pageSources[1], /bindtap="onEnableNotification"/);
  assert.match(pageSources[2], /bindtap="onChangePassword"/);
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

test('Settings reflects accepted subscription state and opens WeChat settings', async () => {
  const originalWx = global.wx;
  const api = require('../utils/api.js');
  const originalRequest = api.request;
  const calls = [];
  const config = notificationConfig();
  api.request = async () => ({ data: config });
  global.wx = {
    getStorageSync() { return config; },
    setStorageSync() {},
    getSetting(options) {
      options.success({
        subscriptionsSetting: {
          itemSettings: Object.fromEntries(notificationTemplates.map(([, id]) => [id, 'accept']))
        }
      });
    },
    openSetting(options) {
      calls.push('openSetting');
      options.complete();
    }
  };

  try {
    const page = createPage(loadPage('packages/business/settings/settings.js'));
    await page.onShow();
    assert.equal(page.data.notificationStatus, '已允许');
    assert.equal(page.data.notificationAccepted, true);
    await page.onOpenSystemSettings();
    assert.deepEqual(calls, ['openSetting']);
  } finally {
    api.request = originalRequest;
    global.wx = originalWx;
  }
});

test('Settings keeps rejected subscription state explicit', async () => {
  const originalWx = global.wx;
  const api = require('../utils/api.js');
  const originalRequest = api.request;
  const config = notificationConfig();
  api.request = async () => ({ data: config });
  global.wx = {
    getStorageSync() { return config; },
    setStorageSync() {},
    getSetting(options) {
      options.success({
        subscriptionsSetting: {
          itemSettings: Object.fromEntries(notificationTemplates.map(([, id]) => [id, 'reject']))
        }
      });
    }
  };
  try {
    const page = createPage(loadPage('packages/business/settings/settings.js'));
    await page.onShow();
    assert.equal(page.data.notificationStatus, '已拒绝');
    assert.equal(page.data.notificationAccepted, false);
  } finally {
    api.request = originalRequest;
    global.wx = originalWx;
  }
});

test('Settings shows a truthful partial subscription count', async () => {
  const originalWx = global.wx;
  const api = require('../utils/api.js');
  const originalRequest = api.request;
  const config = notificationConfig();
  api.request = async () => ({ data: config });
  global.wx = {
    getStorageSync() { return config; },
    setStorageSync() {},
    getSetting(options) {
      options.success({
        subscriptionsSetting: {
          itemSettings: {
            [notificationTemplates[0][1]]: 'accept',
            [notificationTemplates[1][1]]: 'accept',
            [notificationTemplates[2][1]]: 'reject',
            [notificationTemplates[3][1]]: 'reject'
          }
        }
      });
    }
  };
  try {
    const page = createPage(loadPage('packages/business/settings/settings.js'));
    await page.onShow();
    assert.equal(page.data.notificationStatus, '已允许 2/4');
    assert.equal(page.data.notificationAccepted, true);
  } finally {
    api.request = originalRequest;
    global.wx = originalWx;
  }
});

test('Settings gives the subscription main switch precedence over cached item grants', async () => {
  const originalWx = global.wx;
  const api = require('../utils/api.js');
  const originalRequest = api.request;
  const config = notificationConfig();
  api.request = async () => ({ data: config });
  global.wx = {
    getStorageSync() { return config; },
    setStorageSync() {},
    getSetting(options) {
      options.success({
        subscriptionsSetting: {
          mainSwitch: false,
          itemSettings: Object.fromEntries(notificationTemplates.map(([, id]) => [id, 'accept']))
        }
      });
    }
  };
  try {
    const page = createPage(loadPage('packages/business/settings/settings.js'));
    await page.onShow();
    assert.equal(page.data.notificationStatus, '已关闭');
    assert.equal(page.data.notificationAccepted, false);
  } finally {
    api.request = originalRequest;
    global.wx = originalWx;
  }
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
    assert.deepEqual(removed.sort(), ['openid', 'token', 'userInfo']);
    assert.equal(app.globalData.token, null);
    assert.equal(app.globalData.userInfo, null);
    assert.deepEqual(app.globalData.referral, { enterpriseId: null, staffId: null });
  } finally {
    delete require.cache[sessionPath];
    global.wx = originalWx;
    global.getApp = originalGetApp;
  }
});
