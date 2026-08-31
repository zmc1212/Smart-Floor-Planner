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
  context.promptInitialPasswordChange = definition.promptInitialPasswordChange;
  context.finishLogin = definition.finishLogin;
  return context;
}

test('Login page ships the approved Xiao K entry composition with live controls', () => {
  const wxml = fs.readFileSync(path.join(projectRoot, 'packages/business/login/login.wxml'), 'utf8');
  const less = fs.readFileSync(path.join(projectRoot, 'packages/business/login/login.less'), 'utf8');

  assert.match(wxml, /\/packages\/business\/assets\/login-v1\/hero-scene\.jpg/);
  assert.match(wxml, /家客来/);
  assert.match(wxml, /企业客户工作台/);
  assert.match(wxml, /open-type="getPhoneNumber"/);
  assert.match(wxml, /手机号授权登录/);
  assert.match(wxml, /手机号快捷登录/);
  assert.doesNotMatch(wxml, /微信授权登录/);
  assert.doesNotMatch(wxml, /login-v1\/wechat\.png/);
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

test('Login phone CTA sends encryptedData when WeChat omits the dynamic code', async () => {
  const {
    refreshWechatLoginCode,
    resetWechatLoginCodeForTests
  } = require('../utils/wechat-phone-auth.js');
  const definition = loadPage();
  const originalWx = global.wx;
  const originalPhoneLogin = api.phoneLogin;
  const payloads = [];
  const codes = ['pre-tap-code', 'next-code'];
  resetWechatLoginCodeForTests();
  global.wx = {
    ...(originalWx || {}),
    login(options) {
      const code = codes.shift();
      if (options.success) options.success({ code });
      if (options.complete) options.complete();
    }
  };
  api.phoneLogin = async (payload) => {
    payloads.push(payload);
    return { success: false, error: 'stop' };
  };
  try {
    await refreshWechatLoginCode();
    const context = createContext(definition, { agreed: true });
    context.performLogin = async (loginFn) => {
      await loginFn();
    };
    await definition.onGetPhoneNumber.call(context, {
      detail: {
        errMsg: 'getPhoneNumber:ok',
        encryptedData: 'cipher',
        iv: 'init-vector'
      }
    });
    assert.deepEqual(payloads, [{
      loginCode: 'pre-tap-code',
      encryptedData: 'cipher',
      iv: 'init-vector'
    }]);
  } finally {
    resetWechatLoginCodeForTests();
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

test('Password login requiring a password change bootstraps and reminds once without trapping the session', async () => {
  let hydrateCalls = 0;
  const launches = [];
  const navigations = [];
  const modals = [];
  const app = {
    globalData: {},
    hydrateStoredSession: async () => {
      hydrateCalls += 1;
    },
    syncProfessionalContext() {}
  };
  const definition = loadPage(app);
  const originalWx = global.wx;
  const originalPages = global.getCurrentPages;
  const originalSetTimeout = global.setTimeout;
  global.getCurrentPages = () => [{ route: 'packages/business/login/login' }];
  global.setTimeout = (callback) => {
    callback();
    return 1;
  };
  global.wx = {
    showLoading() {},
    hideLoading() {},
    setStorageSync() {},
    reLaunch(options) {
      launches.push(options.url);
    },
    navigateTo(options) {
      navigations.push(options.url);
    },
    showModal(options) {
      modals.push(options);
      if (options.success) options.success({ confirm: false });
    }
  };

  try {
    const context = createContext(definition);
    await definition.performLogin.call(context, async () => ({
      success: true,
      token: 'restricted-token',
      user: { id: '8', mode: 'staff', staffRole: 'designer' },
      requiresPasswordChange: true
    }));

    assert.equal(hydrateCalls, 1);
    assert.equal(modals.length, 1);
    assert.equal(modals[0].title, '建议修改初始密码');
    assert.equal(modals[0].confirmText, '去修改');
    assert.equal(modals[0].cancelText, '稍后');
    assert.deepEqual(launches, ['/pages/index/index']);
    assert.deepEqual(navigations, []);
    assert.doesNotMatch(source('packages/business/login/login.js'), /required=1/);
  } finally {
    global.wx = originalWx;
    global.getCurrentPages = originalPages;
    global.setTimeout = originalSetTimeout;
  }
});

test('Password-change reminder can open account security after entering the role landing', async () => {
  const launches = [];
  const navigations = [];
  const app = {
    globalData: {},
    hydrateStoredSession: async () => {},
    syncProfessionalContext() {}
  };
  const definition = loadPage(app);
  const originalWx = global.wx;
  const originalPages = global.getCurrentPages;
  const originalSetTimeout = global.setTimeout;
  global.getCurrentPages = () => [{ route: 'packages/business/login/login' }];
  global.setTimeout = (callback) => {
    callback();
    return 1;
  };
  global.wx = {
    showLoading() {},
    hideLoading() {},
    setStorageSync() {},
    reLaunch(options) {
      launches.push(options.url);
    },
    navigateTo(options) {
      navigations.push(options.url);
    },
    showModal(options) {
      if (options.success) options.success({ confirm: true });
    }
  };

  try {
    const context = createContext(definition);
    await definition.performLogin.call(context, async () => ({
      success: true,
      token: 'restricted-token',
      user: { id: '8', mode: 'staff', staffRole: 'designer' },
      requiresPasswordChange: true
    }));

    assert.deepEqual(launches, ['/pages/index/index']);
    assert.deepEqual(navigations, [
      '/packages/business/account-security/account-security'
    ]);
  } finally {
    global.wx = originalWx;
    global.getCurrentPages = originalPages;
    global.setTimeout = originalSetTimeout;
  }
});
