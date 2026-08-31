const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../utils/api.js');

const miniRoot = path.resolve(__dirname, '..');

function source(relativePath) {
  return fs.readFileSync(path.join(miniRoot, relativePath), 'utf8');
}

function loadPage() {
  const pagePath = require.resolve('../packages/business/onboarding/onboarding.js');
  const originalPage = global.Page;
  let definition;
  global.Page = (next) => { definition = next; };
  delete require.cache[pagePath];
  require(pagePath);
  global.Page = originalPage;
  return definition;
}

test('onboarding page resolves an enterprise code before collecting a phone authorization', () => {
  const appConfig = JSON.parse(source('app.json'));
  const businessPackage = appConfig.subPackages.find((item) => item.root === 'packages/business');
  const wxml = source('packages/business/onboarding/onboarding.wxml');
  const js = source('packages/business/onboarding/onboarding.js');
  const scanUtil = source('utils/onboardingScan.js');
  const less = source('packages/business/onboarding/onboarding.less');

  assert.ok(businessPackage.pages.includes('onboarding/onboarding'));
  assert.ok(businessPackage.pages.includes('onboarding-debug/onboarding-debug'));
  assert.match(wxml, /open-type="getPhoneNumber"/);
  assert.match(wxml, /欢迎加入服务团队/);
  assert.match(wxml, /入驻后，可在推广端查看/);
  assert.match(wxml, /欢迎加入/);
  assert.match(wxml, /推广团队/);
  assert.match(wxml, /立即加入推广团队/);
  assert.match(wxml, /加入后即可获取专属推广码/);
  const referrerHelper = wxml.match(/<view class="identity-link referrer-ready identity-link-v7">[\s\S]*?<\/view>/)?.[0];
  assert.ok(referrerHelper);
  assert.doesNotMatch(referrerHelper, /bindtap|aria-role|link-chevron/);
  assert.match(wxml, /images\/onboarding-referrer-v7\/xiao-k-promoter-hero-v7\.png/);
  assert.match(wxml, /images\/onboarding-referrer-v7\/enterprise-building-v7\.png/);
  assert.match(wxml, /专属服务码/);
  assert.match(wxml, /推广记录/);
  assert.match(wxml, /对应提成/);
  assert.match(wxml, /选择你的服务身份/);
  assert.match(wxml, /xiao-k-onboarding-welcome-complete\.png/);
  const welcomeAssetPath = path.join(
    miniRoot,
    'packages/business/assets/referral-service-v1/xiao-k-onboarding-welcome-complete.png'
  );
  assert.ok(fs.existsSync(welcomeAssetPath));
  const welcomeAsset = fs.readFileSync(welcomeAssetPath);
  assert.deepEqual([...welcomeAsset.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(welcomeAsset.byteLength <= 300 * 1024);
  for (const assetName of ['xiao-k-promoter-hero-v7.png', 'enterprise-building-v7.png']) {
    const asset = fs.readFileSync(path.join(miniRoot, 'images/onboarding-referrer-v7', assetName));
    assert.deepEqual([...asset.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(asset.byteLength <= 300 * 1024, `${assetName} exceeds the generated-artwork budget`);
  }
  for (const assetName of [
    'promotion-code-v7.png',
    'promotion-progress-v7.png',
    'promotion-commission-v7.png',
    'promotion-person-plus-v7.png',
    'promotion-cta-shield-v7.png'
  ]) {
    const asset = fs.readFileSync(path.join(miniRoot, 'packages/business/assets/onboarding-referrer-v7', assetName));
    assert.deepEqual([...asset.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(asset.byteLength <= 300 * 1024, `${assetName} exceeds the generated-artwork budget`);
  }
  assert.match(wxml, /promotion-person-plus-v7\.png/);
  assert.match(wxml, /promotion-progress-v7\.png/);
  assert.match(wxml, /promotion-commission-v7\.png/);
  assert.match(wxml, /promotion-code-v7\.png/);
  assert.match(wxml, /promotion-cta-shield-v7\.png/);
  assert.match(wxml, /step-title-row-v7/);
  assert.match(wxml, /xiao-k-onboarding-recovery\.png/);
  assert.match(wxml, /home-ip-v1\/brand-logo\.png/);
  assert.match(wxml, /当前邀请暂不可用/);
  assert.match(wxml, /扫描新邀请/);
  assert.match(wxml, /切换可用身份/);
  assert.match(wxml, /mine-icons\/scan\.png/);
  assert.match(wxml, /mine-icons\/users\.png/);
  assert.match(js, /\/miniprogram\/codes\/resolve/);
  assert.match(js, /\/miniprogram\/onboarding\/staff/);
  assert.match(js, /\/miniprogram\/onboarding\/referrer/);
  assert.doesNotMatch(js, /offerNotificationAuthorization/);
  assert.doesNotMatch(js, /resolveOnboardingSubscribeRole/);
  assert.match(scanUtil, /`ej_\$\{decoded\}`/);
  assert.match(js, /onboardingTokenFromScanResult/);
  assert.match(js, /applyOnboardingToken/);
  assert.match(js, /enterpriseName/);
  assert.match(js, /invitationDisplayName/);
  assert.match(js, /inviterDisplayName/);
  assert.match(wxml, /将加入：/);
  assert.match(wxml, /\{\{enterpriseName\}\}/);
  assert.match(wxml, /由企业员工/);
  assert.match(wxml, /inviterDisplayName/);
  assert.match(wxml, /设置推荐人姓名/);
  assert.match(js, /displayName/);
  assert.match(js, /onConfirmReferrerName/);
  assert.doesNotMatch(js, /debugOnboarding/);
  assert.match(js, /code_rotated/);
  assert.match(js, /pageState:\s*'recovery'/);
  assert.match(js, /onScanNewInvite/);
  assert.match(js, /onOpenIdentitySwitch/);
  assert.match(js, /leaveScanLanding/);
  assert.match(wxml, /bindtap="onBack"/);
  assert.match(wxml, /class="nav-back"/);
  assert.match(wxml, /class="back-chevron"/);
  assert.match(less, /\.nav-back/);
  assert.match(less, /\.back-chevron/);
  assert.match(wxml, /navigationRight/);
  assert.match(wxml, /join-inner/);
  assert.match(less, /\.join-inner\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.match(less, /\.join-action,\s*\.state-action\s*\{[\s\S]*width:\s*auto/);
  assert.match(less, /\.join-action,\s*\.state-action\s*\{[\s\S]*min-width:\s*100%/);
  assert.match(less, /\.join-action,\s*\.state-action\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.match(less, /\.onboarding-content \.join-action\s*\{[^}]*margin-top:\s*32rpx/);
  assert.match(less, /\.referrer-welcome-hero \.welcome-title\s*\{[^}]*font-size:\s*48rpx/);
  assert.match(less, /\.referrer-card \.section-title\s*\{[^}]*font-size:\s*36rpx/);
  assert.match(less, /\.referrer-card \.section-copy\s*\{[^}]*font-size:\s*28rpx/);
  assert.match(less, /\.onboarding-content \.join-action\.referrer-ready\s*\{[\s\S]*font-size:\s*34rpx/);
  assert.match(less, /safe-area-inset-bottom/);
  assert.doesNotMatch(less, /font-size:\s*(?:1[0-9]|[0-9])rpx/);
  assert.doesNotMatch(less, /transform:\s*scale\(/);
});

test('onboarding code resolution records the resolved enterprise name before phone authorization', async () => {
  const definition = loadPage();
  const originalRequest = api.request;
  api.request = async () => ({
    data: {
      kind: 'onboarding',
      codeType: 'referrer',
      enterpriseName: '嘉客来装饰',
      inviterDisplayName: '员工A'
    }
  });
  try {
    const context = {
      data: { ...definition.data, onboardingToken: 'ej_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456' },
      setData(next) { Object.assign(this.data, next); }
    };
    await definition.resolveOnboardingCode.call(context);
    assert.equal(context.data.pageState, 'ready');
    assert.equal(context.data.enterpriseName, '嘉客来装饰');
    assert.equal(context.data.inviterDisplayName, '员工A');
  } finally {
    api.request = originalRequest;
  }
});

test('onboarding role selection is limited to supported staff roles', () => {
  const definition = loadPage();
  const context = {
    data: { ...definition.data },
    setData(next) { Object.assign(this.data, next); }
  };

  definition.onChooseStaffRole.call(context, { currentTarget: { dataset: { role: 'measurer' } } });
  assert.equal(context.data.selectedStaffRole, 'measurer');
  definition.onChooseStaffRole.call(context, { currentTarget: { dataset: { role: 'enterprise_admin' } } });
  assert.equal(context.data.selectedStaffRole, 'measurer');
});

test('staff success CTA relaunches the designer workbench without subscribe prompts', () => {
  const definition = loadPage();
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  const launches = [];
  const toasts = [];
  const modals = [];
  global.getApp = () => ({ globalData: { userInfo: null, bootstrap: null } });
  global.wx = {
    ...(originalWx || {}),
    showToast: (options) => { toasts.push(options); },
    showModal: (options) => { modals.push(options); options.success({ confirm: false }); },
    reLaunch: (options) => { launches.push(options); }
  };
  try {
    const context = {
      data: { codeType: 'staff', selectedStaffRole: 'designer' },
      enterWorkbench: definition.enterWorkbench
    };
    definition.onContinue.call(context);
    assert.equal(modals.length, 0);
    assert.equal(launches[0].url, '/pages/index/index');
    assert.equal(toasts.length, 0);

    const invalid = {
      data: { codeType: 'staff', selectedStaffRole: 'unknown' },
      enterWorkbench: definition.enterWorkbench
    };
    definition.onContinue.call(invalid);
    assert.equal(launches.length, 1);
    assert.match(toasts[0].title, /暂时无法进入工作台/);
  } finally {
    global.getApp = originalGetApp;
    global.wx = originalWx;
  }
});

test('referrer success CTA enters the workbench without subscribe prompts', async () => {
  const definition = loadPage();
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  const launches = [];
  let modalCalled = false;
  global.getApp = () => ({
    globalData: {
      userInfo: { mode: 'referrer' },
      bootstrap: { current: { mode: 'referrer', landingPath: '/packages/business/referrer-workbench/referrer-workbench' } }
    }
  });
  global.wx = {
    ...(originalWx || {}),
    showToast() {},
    showModal(options) {
      modalCalled = true;
      options.success({ confirm: false });
    },
    requestSubscribeMessage(options) {
      options.success({});
    },
    reLaunch: (options) => { launches.push(options); }
  };
  try {
    const context = {
      data: { codeType: 'referrer' },
      enterWorkbench: definition.enterWorkbench
    };
    await definition.onContinue.call(context);
    assert.equal(modalCalled, false);
    assert.match(launches[0].url, /referrer-workbench/);
  } finally {
    global.getApp = originalGetApp;
    global.wx = originalWx;
  }
});

test('staff success CTA prefers hydrated bootstrap landingPath', () => {
  const definition = loadPage();
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  const launches = [];
  global.getApp = () => ({
    globalData: {
      userInfo: { mode: 'staff', staffRole: 'designer' },
      bootstrap: { current: { mode: 'staff', staffRole: 'designer', landingPath: '/pages/index/index' } }
    }
  });
  global.wx = {
    ...(originalWx || {}),
    showToast() {},
    showModal: (options) => { options.success({ confirm: false }); },
    reLaunch: (options) => { launches.push(options); }
  };
  try {
    const context = {
      data: { codeType: 'staff', selectedStaffRole: 'measurer' },
      enterWorkbench: definition.enterWorkbench
    };
    definition.onContinue.call(context);
    assert.equal(launches[0].url, '/pages/index/index');
  } finally {
    global.getApp = originalGetApp;
    global.wx = originalWx;
  }
});

test('referrer onboarding opens a name sheet after phone authorization and submits displayName', async () => {
  const definition = loadPage();
  const originalRequest = api.request;
  const originalPhoneLogin = api.phoneLogin;
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  const calls = [];
  const toasts = [];
  global.wx = {
    ...(originalWx || {}),
    showToast: (options) => { toasts.push(options); },
    setStorageSync() {},
    getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 24 }),
    getMenuButtonBoundingClientRect: () => ({ left: 296, top: 24, height: 32 })
  };
  global.getApp = () => ({
    globalData: { sessionRecovery: null },
    hydrateStoredSession: async () => {}
  });
  api.phoneLogin = async () => ({ success: true, token: 'phone', user: { nickname: '微信用户' } });
  api.request = async (path, _method, body) => {
    calls.push({ path, body });
    if (path === '/miniprogram/onboarding/referrer') return { token: 'onboard-jwt' };
    if (path === '/auth/miniprogram') return { user: { nickname: '王推荐' }, openid: 'o1' };
    throw new Error(path);
  };
  try {
    const context = {
      data: {
        ...definition.data,
        pageState: 'ready',
        codeType: 'referrer',
        onboardingToken: 'ej_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456'
      },
      setData(next) { Object.assign(this.data, next); },
      submitOnboarding: definition.submitOnboarding,
      persistOnboardingSession: definition.persistOnboardingSession
    };

    await definition.onGetPhoneNumber.call(context, {
      detail: { errMsg: 'getPhoneNumber:ok', code: 'phone-code' }
    });
    assert.equal(context.data.pageState, 'name');
    assert.equal(context.data.nameSheetVisible, true);
    assert.equal(context.data.displayName, '');
    assert.equal(calls.length, 0);

    await definition.onConfirmReferrerName.call(context);
    assert.equal(toasts[0].title, '请填写真实姓名');
    assert.equal(calls.length, 0);

    context.data.displayName = '王推荐';
    await definition.onConfirmReferrerName.call(context);
    assert.equal(calls[0].path, '/miniprogram/onboarding/referrer');
    assert.equal(calls[0].body.displayName, '王推荐');
    assert.equal(context.data.pageState, 'success');
    assert.equal(context.data.nameSheetVisible, false);
  } finally {
    api.request = originalRequest;
    api.phoneLogin = originalPhoneLogin;
    global.getApp = originalGetApp;
    global.wx = originalWx;
  }
});

test('referrer onboarding accepts encryptedData when WeChat omits the dynamic code', async () => {
  const {
    refreshWechatLoginCode,
    resetWechatLoginCodeForTests
  } = require('../utils/wechat-phone-auth.js');
  const definition = loadPage();
  const originalPhoneLogin = api.phoneLogin;
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  const payloads = [];
  const codes = ['pre-tap-code', 'next-code'];
  resetWechatLoginCodeForTests();
  global.wx = {
    ...(originalWx || {}),
    showToast() {},
    setStorageSync() {},
    getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 24 }),
    getMenuButtonBoundingClientRect: () => ({ left: 296, top: 24, height: 32 }),
    login(options) {
      const code = codes.shift();
      if (options.success) options.success({ code });
      if (options.complete) options.complete();
    }
  };
  global.getApp = () => ({
    globalData: { sessionRecovery: null },
    hydrateStoredSession: async () => {}
  });
  api.phoneLogin = async (payload) => {
    payloads.push(payload);
    return { success: true, token: 'phone', user: { nickname: '微信用户' } };
  };
  try {
    await refreshWechatLoginCode();
    const context = {
      data: {
        ...definition.data,
        pageState: 'ready',
        codeType: 'referrer',
        onboardingToken: 'ej_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456'
      },
      setData(next) { Object.assign(this.data, next); },
      submitOnboarding: definition.submitOnboarding,
      persistOnboardingSession: definition.persistOnboardingSession
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
    assert.equal(context.data.pageState, 'name');
  } finally {
    resetWechatLoginCodeForTests();
    api.phoneLogin = originalPhoneLogin;
    global.getApp = originalGetApp;
    global.wx = originalWx;
  }
});

test('recovery scan reapplies a WeChat mini-program code on the current onboarding page', () => {
  const definition = loadPage();
  const originalWx = global.wx;
  let scanOptions;
  const redirects = [];
  const toasts = [];
  const resolved = [];
  global.wx = {
    ...(originalWx || {}),
    scanCode(options) { scanOptions = options; },
    redirectTo(options) { redirects.push(options); },
    showToast(options) { toasts.push(options); }
  };

  try {
    const context = {
      data: {
        ...definition.data,
        pageState: 'recovery',
        onboardingToken: 'ej_oldtokenoldtokenoldtokenoldtok'
      },
      setData(next) { Object.assign(this.data, next); },
      resolveOnboardingCode() { resolved.push(this.data.onboardingToken); }
    };
    context.applyOnboardingToken = definition.applyOnboardingToken.bind(context);

    definition.onScanNewInvite.call(context);

    const scene = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
    scanOptions.success({
      path: `packages/business/onboarding/onboarding.html?scene=${scene}`,
      scanType: 'WX_CODE'
    });
    assert.equal(redirects.length, 0);
    assert.equal(context.data.onboardingToken, `ej_${scene}`);
    assert.equal(resolved[0], `ej_${scene}`);
    assert.equal(toasts.length, 0);

    scanOptions.success({
      result: 'https://example.com/packages/business/onboarding/onboarding.html?token=ej_NEWTOKENNEWTOKENNEWTOKENNEWTK12'
    });
    assert.equal(redirects.length, 0);
    assert.equal(context.data.onboardingToken, 'ej_NEWTOKENNEWTOKENNEWTOKENNEWTK12');
    assert.equal(resolved[1], 'ej_NEWTOKENNEWTOKENNEWTOKENNEWTK12');

    scanOptions.success({ path: 'pages/index/index.html?scene=ABC' });
    assert.match(toasts.at(-1).title, /企业提供的入驻码/);
    assert.equal(resolved.length, 2);
  } finally {
    global.wx = originalWx;
  }
});

test('onboarding reapplies a newer scene when WeChat reopens the current recovery page', () => {
  const definition = loadPage();
  const originalGetCurrentPages = global.getCurrentPages;
  const resolved = [];
  const scene = 'ZYXWVUTSRQPONMLKJIHGFEDCBA654321';
  const context = {
    data: {
      ...definition.data,
      pageState: 'recovery',
      onboardingToken: 'ej_oldtokenoldtokenoldtokenoldtok'
    },
    setData(next) { Object.assign(this.data, next); },
    resolveOnboardingCode() { resolved.push(this.data.onboardingToken); }
  };
  context._optionsToken = 'ej_oldtokenoldtokenoldtokenoldtok';
  context.applyOnboardingToken = definition.applyOnboardingToken.bind(context);
  global.getCurrentPages = () => [{ options: { scene } }];
  try {
    definition.onShow.call(context);
    assert.equal(context.data.onboardingToken, `ej_${scene}`);
    assert.equal(resolved[0], `ej_${scene}`);

    resolved.length = 0;
    definition.onShow.call(context);
    assert.equal(resolved.length, 0);
  } finally {
    global.getCurrentPages = originalGetCurrentPages;
  }
});

test('onboarding recovery copy covers membership and protection limits', async () => {
  const js = source('packages/business/onboarding/onboarding.js');
  const wxml = source('packages/business/onboarding/onboarding.wxml');
  assert.match(js, /referrer_protection_limit/);
  assert.match(js, /当前微信的推荐人企业数量已达上限，请先退出不再服务的企业。/);
  assert.match(js, /该企业已限制推广人同时服务其他企业的数量，暂时无法加入。/);
  assert.match(wxml, /class="recovery-subtitle">\{\{errorMessage/);
  assert.match(wxml, /当前邀请暂不可用/);
  assert.match(wxml, /扫描新邀请/);

  const definition = loadPage();
  const originalRequest = api.request;
  const originalWx = global.wx;
  global.wx = {
    ...(originalWx || {}),
    showToast() {}
  };

  async function submitReferrerOnboarding(code) {
    const context = {
      data: {
        ...definition.data,
        pageState: 'name',
        codeType: 'referrer',
        displayName: '测试推荐人',
        onboardingToken: 'ej_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456'
      },
      setData(next) { Object.assign(this.data, next); },
      async persistOnboardingSession() {},
      submitOnboarding: definition.submitOnboarding,
    };
    api.request = async () => {
      const error = new Error(code);
      error.code = code;
      throw error;
    };
    await definition.onConfirmReferrerName.call(context);
    return context;
  }

  try {
    const protection = await submitReferrerOnboarding('referrer_protection_limit');
    assert.equal(protection.data.pageState, 'recovery');
    assert.equal(
      protection.data.errorMessage,
      '该企业已限制推广人同时服务其他企业的数量，暂时无法加入。'
    );

    const membership = await submitReferrerOnboarding('membership_limit_reached');
    assert.equal(membership.data.pageState, 'recovery');
    assert.equal(
      membership.data.errorMessage,
      '当前微信的推荐人企业数量已达上限，请先退出不再服务的企业。'
    );
  } finally {
    api.request = originalRequest;
    global.wx = originalWx;
  }
});

test('recovery camera scan is not overwritten by the original page scene on show', () => {
  const definition = loadPage();
  const originalWx = global.wx;
  const originalGetCurrentPages = global.getCurrentPages;
  let scanOptions;
  const resolved = [];
  const originalScene = 'OLDTOKENOLDTOKENOLDTOKENOLDTOKEN';
  const scene = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
  global.wx = {
    ...(originalWx || {}),
    scanCode(options) { scanOptions = options; },
    redirectTo() {},
    showToast() {}
  };
  global.getCurrentPages = () => [{ options: { scene: originalScene } }];

  try {
    const context = {
      data: {
        ...definition.data,
        pageState: 'recovery',
        onboardingToken: `ej_${originalScene}`
      },
      setData(next) { Object.assign(this.data, next); },
      resolveOnboardingCode() { resolved.push(this.data.onboardingToken); }
    };
    context._optionsToken = `ej_${originalScene}`;
    context.applyOnboardingToken = definition.applyOnboardingToken.bind(context);

    definition.onScanNewInvite.call(context);
    scanOptions.success({
      path: `packages/business/onboarding/onboarding.html?scene=${scene}`,
      scanType: 'WX_CODE'
    });
    assert.equal(context.data.onboardingToken, `ej_${scene}`);

    resolved.length = 0;
    definition.onShow.call(context);
    assert.equal(context.data.onboardingToken, `ej_${scene}`);
    assert.equal(resolved.length, 0);
  } finally {
    global.wx = originalWx;
    global.getCurrentPages = originalGetCurrentPages;
  }
});
