const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const api = require('../utils/api.js');

const projectRoot = path.resolve(__dirname, '..');

function source(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function loadPage(app = {
  globalData: {},
  hydrateStoredSession: async () => {}
}) {
  const pagePath = require.resolve('../packages/business/login/login.js');
  const originalPage = global.Page;
  const originalGetApp = global.getApp;
  let definition;
  global.Page = (next) => {
    definition = next;
  };
  global.getApp = () => app;
  delete require.cache[pagePath];
  require(pagePath);
  global.Page = originalPage;
  global.getApp = originalGetApp;
  return definition;
}

function createContext(definition, extraData = {}) {
  const context = {
    data: { ...definition.data, ...extraData },
    setData(next) {
      Object.assign(this.data, next);
    }
  };
  context.onToggleAgreement = definition.onToggleAgreement;
  context.onNeedAgreement = definition.onNeedAgreement;
  context.onGetPhoneNumber = definition.onGetPhoneNumber;
  context.performLogin = definition.performLogin;
  return context;
}

test('Login page ships the approved Xiao K entry composition with live controls', () => {
  const wxml = fs.readFileSync(path.join(projectRoot, 'packages/business/login/login.wxml'), 'utf8');
  const less = fs.readFileSync(path.join(projectRoot, 'packages/business/login/login.less'), 'utf8');

  assert.match(wxml, /\/packages\/business\/assets\/login-v1\/hero-scene\.jpg/);
  assert.match(wxml, /家客来/);
  assert.match(wxml, /企业客户工作台/);
  assert.match(wxml, /open-type="getPhoneNumber"/);
  assert.match(wxml, /data-type="password"/);
  assert.match(wxml, /精准量房/);
  assert.match(wxml, /AI设计/);
  assert.match(wxml, /灵感图库/);
  assert.match(wxml, /返回首页/);

  assert.match(wxml, /primary-inner/);
  assert.match(less, /\.primary-btn\s*\{[\s\S]*width:\s*auto/);
  assert.match(less, /\.primary-btn\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.match(less, /\.hero-wrap\s*\{[\s\S]*height:\s*790rpx/);
  assert.match(less, /\.login-card\s*\{[\s\S]*margin:\s*-66rpx 26rpx 0/);
  assert.match(less, /\.feature-row\s*\{[\s\S]*height:\s*150rpx/);
  assert.doesNotMatch(less, /\.bubble|\.target-icon|\.image-mountain/);
});

test('Login visual assets are local, valid, and stay within the Mini Program budget', () => {
  const assetDir = path.join(projectRoot, 'packages/business/assets/login-v1');
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

test('Login agreement row is tappable and gates WeChat phone login until checked', () => {
  const wxml = source('packages/business/login/login.wxml');
  const js = source('packages/business/login/login.js');
  const less = source('packages/business/login/login.less');

  assert.match(wxml, /class="agreement"[^>]*bindtap="onToggleAgreement"/);
  assert.match(wxml, /agreement-check \{\{agreed \? 'is-checked' : ''\}\}/);
  assert.match(
    wxml,
    /wx:if="\{\{agreed\}\}"[\s\S]*open-type="getPhoneNumber"[\s\S]*bindgetphonenumber="onGetPhoneNumber"/
  );
  assert.match(wxml, /wx:else[\s\S]*bindtap="onNeedAgreement"/);
  assert.doesNotMatch(
    wxml,
    /<button class="primary-btn" open-type="getPhoneNumber"/
  );

  assert.match(js, /agreed:\s*false/);
  assert.match(js, /onToggleAgreement\(/);
  assert.match(js, /onNeedAgreement\(/);
  assert.match(js, /请先勾选同意协议/);

  assert.match(less, /\.agreement\s*\{[\s\S]*padding:\s*20rpx 32rpx 24rpx/);
  assert.match(less, /\.agreement\s*\{[\s\S]*min-height:\s*72rpx/);
  assert.match(less, /\.agreement-check\.is-checked/);
  assert.match(wxml, /catchtap="onOpenLegalDoc"[\s\S]*data-kind="user"/);
  assert.match(wxml, /catchtap="onOpenLegalDoc"[\s\S]*data-kind="privacy"/);
  assert.match(wxml, /wx:if="\{\{!showDisclaimer\}\}"[\s\S]*和/);
  assert.match(wxml, /wx:if="\{\{showDisclaimer\}\}"[\s\S]*data-kind="disclaimer"[\s\S]*《免责协议》/);
  assert.match(js, /showDisclaimer:\s*false/);
  assert.match(js, /onOpenLegalDoc\(/);
  assert.match(less, /\.agreement\s*\{[\s\S]*flex-wrap:\s*wrap/);
  assert.doesNotMatch(less, /\.agreement\s*\{[^}]*white-space:\s*nowrap/);
});

test('Login agreement toggle and phone CTA refuse login until the row is checked', async () => {
  const definition = loadPage();
  const toasts = [];
  const originalWx = global.wx;
  const originalPhoneLogin = api.phoneLogin;
  let phoneLoginCalls = 0;
  global.wx = {
    ...(originalWx || {}),
    showToast(options) {
      toasts.push(options);
    }
  };
  api.phoneLogin = async () => {
    phoneLoginCalls += 1;
    return { success: false, error: 'should-not-run' };
  };

  try {
    const context = createContext(definition);
    assert.equal(context.data.agreed, false);

    definition.onToggleAgreement.call(context);
    assert.equal(context.data.agreed, true);
    definition.onToggleAgreement.call(context);
    assert.equal(context.data.agreed, false);

    definition.onNeedAgreement.call(context);
    assert.equal(toasts[0].title, '请先勾选同意协议');

    await definition.onGetPhoneNumber.call(context, {
      detail: { errMsg: 'getPhoneNumber:ok', code: 'phone-code' }
    });
    assert.equal(phoneLoginCalls, 0);
    assert.equal(toasts.at(-1).title, '请先勾选同意协议');
  } finally {
    global.wx = originalWx;
    api.phoneLogin = originalPhoneLogin;
  }
});

test('Login legal links open the webview without toggling the agreement checkbox', () => {
  const definition = loadPage();
  const toasts = [];
  const navigations = [];
  const originalWx = global.wx;
  global.wx = {
    ...(originalWx || {}),
    showToast(options) {
      toasts.push(options);
    },
    navigateTo(options) {
      navigations.push(options.url);
    }
  };

  try {
    const context = createContext(definition);
    assert.equal(context.data.agreed, false);
    assert.equal(context.data.showDisclaimer, false);
    definition.onOpenLegalDoc.call(context, {
      currentTarget: { dataset: { kind: 'user' } }
    });
    assert.equal(context.data.agreed, false);
    definition.onOpenLegalDoc.call(context, {
      currentTarget: { dataset: { kind: 'disclaimer' } }
    });
    assert.equal(context.data.agreed, false);
    if (navigations.length) {
      assert.match(navigations[0], /legal-webview\/legal-webview/);
      assert.match(navigations[0], /url=/);
      assert.doesNotMatch(navigations[0], /\?url=https:\/\//);
      assert.match(navigations.at(-1), /disclaimer\.html/);
    } else {
      assert.equal(toasts[0].title, '文档即将开放');
    }
  } finally {
    global.wx = originalWx;
  }
});

test('Password login requiring a password change opens account security without bootstrapping', async () => {
  let hydrateCalls = 0;
  const launches = [];
  const app = {
    globalData: {},
    hydrateStoredSession: async () => {
      hydrateCalls += 1;
    },
    syncProfessionalContext() {}
  };
  const definition = loadPage(app);
  const originalWx = global.wx;
  global.wx = {
    showLoading() {},
    hideLoading() {},
    setStorageSync() {},
    reLaunch(options) {
      launches.push(options.url);
    }
  };

  try {
    const context = createContext(definition);
    await definition.performLogin.call(context, async () => ({
      success: true,
      token: 'restricted-token',
      user: { id: '8' },
      requiresPasswordChange: true
    }));

    assert.equal(hydrateCalls, 0);
    assert.equal(app.globalData.sessionHydrated, true);
    assert.deepEqual(launches, [
      '/packages/business/account-security/account-security?required=1'
    ]);
  } finally {
    global.wx = originalWx;
  }
});
