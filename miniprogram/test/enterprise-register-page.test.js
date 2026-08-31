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
  const pagePath = require.resolve(
    '../packages/business/enterprise-register/enterprise-register.js'
  );
  const originalPage = global.Page;
  let definition;
  global.Page = (next) => {
    definition = next;
  };
  delete require.cache[pagePath];
  require(pagePath);
  global.Page = originalPage;
  return definition;
}

test('enterprise-register page is registered and restores er_ scene tokens', () => {
  const appConfig = JSON.parse(source('app.json'));
  const businessPackage = appConfig.subPackages.find(
    (item) => item.root === 'packages/business'
  );
  const js = source('packages/business/enterprise-register/enterprise-register.js');
  const wxml = source(
    'packages/business/enterprise-register/enterprise-register.wxml'
  );
  const less = source(
    'packages/business/enterprise-register/enterprise-register.less'
  );

  assert.ok(businessPackage.pages.includes('enterprise-register/enterprise-register'));
  assert.match(js, /`er_\$\{decoded\}`/);
  assert.match(js, /\/miniprogram\/codes\/resolve/);
  assert.match(js, /\/miniprogram\/enterprise-registration/);
  assert.doesNotMatch(js, /requestSubscribeKinds/);
  assert.doesNotMatch(js, /requestSubscribeMessage/);
  assert.match(js, /phone_mismatch/);
  assert.match(js, /pageState:\s*'recovery'/);
  assert.match(wxml, /open-type="getPhoneNumber"/);
  assert.match(wxml, /申请企业开户/);
  assert.match(wxml, /统一社会信用代码/);
  assert.match(wxml, /提交开户申请/);
  assert.match(wxml, /请输入联系人手机号/);
  assert.match(wxml, /授权手机号并提交/);
  assert.match(wxml, /可手动填写/);
  assert.match(wxml, /bindtap="onIncompleteSubmit"/);
  assert.match(wxml, /missingHint/);
  assert.match(wxml, /fieldErrors\.creditCode/);
  assert.match(wxml, /请填写统一社会信用代码/);
  assert.doesNotMatch(wxml, />授权手机号</);
  assert.doesNotMatch(wxml, /disabled="\{\{!canSubmit \|\| submitting\}\}"/);
  assert.match(wxml, /申请已提交/);
  assert.match(wxml, /初始密码为 123456/);
  assert.match(wxml, /已有账号，去登录/);
  assert.match(wxml, /bindtap="onBack"/);
  assert.match(wxml, /class="nav-back"/);
  assert.match(wxml, /class="back-chevron"/);
  assert.match(less, /\.nav-back/);
  assert.match(less, /\.back-chevron/);
  assert.match(js, /leaveScanLanding/);
  assert.match(wxml, /bindtap="onGoToLogin"/);
  assert.match(wxml, /<button[^>]*class="identity-link"/);
  assert.match(wxml, /该手机号已有账号/);
  assert.match(js, /mode=password/);
  assert.match(js, /formFieldsReady/);
  assert.match(js, /missingFormFields/);
  assert.match(js, /revealMissingFields/);
  assert.match(js, /confirmExistingAccountLeave/);
  assert.match(js, /wx\.showModal/);
  assert.doesNotMatch(js, /setTimeout\(\(\) => \{\s*if \(!this\.leaveIfWorkbenchSignedIn\(\)\) this\.onGoToLogin\(\);/);
  assert.match(js, /canSubmit/);
  assert.match(less, /identity-link/);
  assert.match(less, /\.form-field-error/);
  assert.match(less, /\.missing-hint/);
  assert.match(less, /#e45b3e/);
  assert.match(wxml, /navigationRight/);
  assert.match(wxml, /join-inner/);
  assert.match(less, /\.join-action\s*\{[\s\S]*width:\s*auto/);
  assert.match(less, /\.join-action\s*\{[\s\S]*min-width:\s*100%/);
  assert.match(less, /\.join-action\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.match(less, /safe-area-inset-bottom/);
  assert.match(less, /button\.join-action\[disabled\]/);
  assert.match(less, /\.join-action\.is-disabled[\s\S]*--action-disabled-bg/);
  assert.doesNotMatch(less, /\.join-action\.is-disabled\s*\{\s*opacity:\s*0\.72/);
  assert.doesNotMatch(less, /font-size:\s*(?:1[0-9]|[0-9])rpx/);
});

test('safeToken prefixes bare 32-char scenes with er_', () => {
  const definition = loadPage();
  const helpers = require('../packages/business/enterprise-register/enterprise-register.js');
  assert.equal(helpers.safeToken('A'.repeat(32)), `er_${'A'.repeat(32)}`);
  assert.equal(helpers.safeToken(`er_${'B'.repeat(32)}`), `er_${'B'.repeat(32)}`);
  assert.ok(definition);
});

test('enterprise-register resolves enterprise_registration before phone auth', async () => {
  const definition = loadPage();
  const originalRequest = api.request;
  api.request = async () => ({
    data: {
      kind: 'enterprise_registration',
      displayName: '家客来企业入驻',
      valid: true
    }
  });
  try {
    const context = {
      data: {
        ...definition.data,
        registrationToken: `er_${'C'.repeat(32)}`
      },
      setData(next) {
        Object.assign(this.data, next);
      }
    };
    await definition.resolveRegistrationCode.call(context);
    assert.equal(context.data.pageState, 'ready');
    assert.equal(context.data.platformLabel, '家客来企业入驻');
  } finally {
    api.request = originalRequest;
  }
});

test('formFieldsReady gates the CTA without requiring phone; formReady still needs phone', () => {
  loadPage();
  const {
    formFieldsReady,
    formReady,
    missingFormFields,
    formFeedback
  } = require('../packages/business/enterprise-register/enterprise-register.js');
  assert.equal(
    formFieldsReady({
      enterpriseName: '测试企业',
      creditCode: '91310000MA1KTEST01',
      contactName: '张三'
    }),
    true
  );
  assert.equal(
    formFieldsReady({
      enterpriseName: '测试企业',
      creditCode: '',
      contactName: '张三'
    }),
    false
  );
  assert.deepEqual(
    missingFormFields({
      enterpriseName: '测试企业',
      creditCode: '',
      contactName: '张三'
    }).map((field) => field.key),
    ['creditCode']
  );
  const incomplete = formFeedback(
    { enterpriseName: '测试企业', creditCode: '', contactName: '张三' },
    { showFieldErrors: true }
  );
  assert.equal(incomplete.canSubmit, false);
  assert.equal(incomplete.missingHint, '还需填写：统一社会信用代码');
  assert.equal(incomplete.fieldErrors.creditCode, '请填写统一社会信用代码');
  assert.equal(incomplete.fieldErrors.enterpriseName, '');
  assert.equal(
    formReady({
      enterpriseName: '测试企业',
      creditCode: '91310000MA1KTEST01',
      contactName: '张三',
      authorizedPhone: ''
    }),
    false
  );
  assert.equal(
    formReady({
      enterpriseName: '测试企业',
      creditCode: '91310000MA1KTEST01',
      contactName: '张三',
      authorizedPhone: '13800138000'
    }),
    true
  );
});

test('incomplete CTA and silent getPhoneNumber reveal the empty credit-code field', () => {
  const definition = loadPage();
  const originalWx = global.wx;
  const toasts = [];
  global.wx = {
    ...(originalWx || {}),
    showToast(options) {
      toasts.push(options);
    }
  };
  try {
    const context = {
      data: {
        ...definition.data,
        pageState: 'ready',
        enterpriseName: '测试企业',
        creditCode: '',
        contactName: '张三',
        canSubmit: false,
        showFieldErrors: false,
        fieldErrors: { enterpriseName: '', creditCode: '', contactName: '' },
        submitting: false
      },
      setData(next) {
        Object.assign(this.data, next);
      },
      revealMissingFields() {
        return definition.revealMissingFields.call(this);
      }
    };
    definition.onIncompleteSubmit.call(context);
    assert.equal(context.data.showFieldErrors, true);
    assert.equal(context.data.fieldErrors.creditCode, '请填写统一社会信用代码');
    assert.equal(context.data.missingHint, '还需填写：统一社会信用代码');
    assert.equal(toasts[0].title, '请填写统一社会信用代码');

    definition.syncFormPatch.call(context, { creditCode: '91310000MA1KTEST01' });
    assert.equal(context.data.canSubmit, true);
    assert.equal(context.data.missingHint, '');
    assert.equal(context.data.fieldErrors.creditCode, '');

    context.data.canSubmit = false;
    context.data.creditCode = '';
    context.data.showFieldErrors = false;
    context.data.fieldErrors.creditCode = '';
    definition.onGetPhoneNumber.call(context, {
      detail: { errMsg: 'getPhoneNumber:ok', code: 'phone-code' }
    });
    assert.equal(context.data.fieldErrors.creditCode, '请填写统一社会信用代码');
    assert.equal(toasts.length, 2);
  } finally {
    global.wx = originalWx;
  }
});

test('phone authorization auto-submits when form fields are ready', async () => {
  const definition = loadPage();
  const originalPhoneLogin = api.phoneLogin;
  const originalRequest = api.request;
  const requests = [];
  api.phoneLogin = async () => ({
    user: { mode: 'customer', phone: '13800138000', nickname: '' }
  });
  api.request = async (url, method, body) => {
    requests.push({ url, method, body });
    return { data: { ok: true } };
  };
  try {
    const context = {
      data: {
        ...definition.data,
        pageState: 'ready',
        canSubmit: true,
        registrationToken: `er_${'D'.repeat(32)}`,
        enterpriseName: '测试企业',
        creditCode: '91310000MA1KTEST01',
        contactName: '张三',
        contactEmail: '',
        authorizedPhone: '',
        submitting: false
      },
      setData(next) {
        Object.assign(this.data, next);
      },
      async submitRegistration() {
        return definition.submitRegistration.call(this);
      },
      leaveIfWorkbenchSignedIn() {
        return false;
      },
      onGoToLogin() {}
    };
    await definition.onGetPhoneNumber.call(context, {
      detail: { errMsg: 'getPhoneNumber:ok', code: 'phone-code' }
    });
    assert.equal(context.data.authorizedPhone, '13800138000');
    assert.equal(context.data.pageState, 'success');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/miniprogram/enterprise-registration');
    assert.equal(requests[0].body.contactPerson.phone, '13800138000');
  } finally {
    api.phoneLogin = originalPhoneLogin;
    api.request = originalRequest;
  }
});

test('open-account phone auth accepts encryptedData when WeChat omits the dynamic code', async () => {
  const {
    refreshWechatLoginCode,
    resetWechatLoginCodeForTests
  } = require('../utils/wechat-phone-auth.js');
  const definition = loadPage();
  const originalPhoneLogin = api.phoneLogin;
  const originalRequest = api.request;
  const originalWx = global.wx;
  const payloads = [];
  const codes = ['pre-tap-code', 'next-code'];
  resetWechatLoginCodeForTests();
  global.wx = {
    ...(originalWx || {}),
    showToast() {},
    showModal() {},
    login(options) {
      const code = codes.shift();
      if (options.success) options.success({ code });
      if (options.complete) options.complete();
    }
  };
  api.phoneLogin = async (payload) => {
    payloads.push(payload);
    return {
      user: { mode: 'customer', phone: '13800138000', nickname: '张三' }
    };
  };
  api.request = async () => ({ success: true });
  try {
    await refreshWechatLoginCode();
    const context = {
      data: {
        ...definition.data,
        pageState: 'ready',
        canSubmit: true,
        registrationToken: `er_${'D'.repeat(32)}`,
        enterpriseName: '测试企业',
        creditCode: '91310000MA1KTEST01',
        contactName: '张三',
        contactEmail: '',
        contactPhone: '13800138000',
        authorizedPhone: '',
        submitting: false
      },
      setData(next) {
        Object.assign(this.data, next);
      },
      async submitRegistration() {
        return definition.submitRegistration.call(this);
      },
      leaveIfWorkbenchSignedIn() {
        return false;
      },
      onGoToLogin() {}
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
    api.phoneLogin = originalPhoneLogin;
    api.request = originalRequest;
    global.wx = originalWx;
  }
});

test('contact phone accepts manual input and blocks auto-submit on authorization mismatch', async () => {
  const definition = loadPage();
  const originalPhoneLogin = api.phoneLogin;
  const originalWx = global.wx;
  const toasts = [];
  api.phoneLogin = async () => ({
    user: { mode: 'customer', phone: '13800138000', nickname: '' }
  });
  global.wx = { ...(originalWx || {}), showToast(options) { toasts.push(options); } };
  try {
    const context = {
      data: {
        ...definition.data,
        pageState: 'ready',
        canSubmit: true,
        enterpriseName: '测试企业',
        creditCode: '91310000MA1KTEST01',
        contactName: '张三',
        contactPhone: '13900139000',
        authorizedPhone: '',
        submitting: false
      },
      setData(next) { Object.assign(this.data, next); },
      revealMissingFields() { return definition.revealMissingFields.call(this); }
    };
    definition.onContactPhoneInput.call(context, { detail: { value: '13900139000' } });
    await definition.onGetPhoneNumber.call(context, {
      detail: { errMsg: 'getPhoneNumber:ok', code: 'phone-code' }
    });
    assert.equal(context.data.contactPhone, '13900139000');
    assert.equal(context.data.authorizedPhone, '');
    assert.match(context.data.phoneError, /一致/);
    assert.equal(context.data.submitting, false);
    assert.match(toasts[0].title, /不一致/);
  } finally {
    api.phoneLogin = originalPhoneLogin;
    global.wx = originalWx;
  }
});

test('formReady requires authorized phone and enterprise fields', () => {
  loadPage();
  const { formReady } = require('../packages/business/enterprise-register/enterprise-register.js');
  assert.equal(
    formReady({
      enterpriseName: '测试企业',
      creditCode: '91310000MA1KTEST01',
      contactName: '张三',
      authorizedPhone: ''
    }),
    false
  );
  assert.equal(
    formReady({
      enterpriseName: '测试企业',
      creditCode: '91310000MA1KTEST01',
      contactName: '张三',
      authorizedPhone: '13800138000'
    }),
    true
  );
});

test('fresh QR scan keeps a signed workbench identity on the open-account form', () => {
  const page = loadPage();
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const originalPages = global.getCurrentPages;
  const relaunched = [];
  global.getApp = () => ({
    globalData: {
      userInfo: { mode: 'staff', staffRole: 'enterprise_admin' },
      bootstrap: { current: { mode: 'staff', staffRole: 'enterprise_admin', role: 'enterprise_admin' } },
      launchOptions: { scene: 1089 }
    }
  });
  global.getCurrentPages = () => [{
    route: 'packages/business/enterprise-register/enterprise-register'
  }];
  global.wx = {
    getEnterOptionsSync() { return { scene: 1047 }; },
    reLaunch(options) { relaunched.push(options.url); },
    switchTab() {}
  };
  try {
    assert.equal(page.leaveIfStickyScanReopen(), false);
    assert.deepEqual(relaunched, []);

    global.wx.getEnterOptionsSync = () => ({ scene: 1089 });
    assert.equal(page.leaveIfStickyScanReopen(), true);
    assert.deepEqual(relaunched, ['/pages/index/index']);
  } finally {
    global.wx = originalWx;
    global.getApp = originalGetApp;
    global.getCurrentPages = originalPages;
  }
});

test('leaveRegistrationTarget sends workbench identities to role landing and others to password login', () => {
  loadPage();
  const {
    leaveRegistrationTarget
  } = require('../packages/business/enterprise-register/enterprise-register.js');
  assert.deepEqual(
    leaveRegistrationTarget({ mode: 'staff', staffRole: 'enterprise_admin' }),
    { action: 'role_landing', url: '/pages/index/index', clearSession: false }
  );
  assert.deepEqual(
    leaveRegistrationTarget({ mode: 'customer' }),
    {
      action: 'login',
      url: '/packages/business/login/login?mode=password',
      clearSession: true
    }
  );
  assert.deepEqual(
    leaveRegistrationTarget(null),
    {
      action: 'login',
      url: '/packages/business/login/login?mode=password',
      clearSession: true
    }
  );
});

test('ACCOUNT_CONFLICT after approval opens the already-account exit instead of retry-only error', () => {
  const definition = loadPage();
  const { applyFailure } = require('../packages/business/enterprise-register/enterprise-register.js');
  const context = {
    data: { ...definition.data, submitting: true, pageState: 'submitting' },
    setData(next) {
      Object.assign(this.data, next);
    }
  };
  applyFailure(context, { code: 'ACCOUNT_CONFLICT' });
  assert.equal(context.data.pageState, 'account');
  assert.match(context.data.errorMessage, /已注册/);
});

test('phone authorization after approval leaves the form instead of staying on ready', () => {
  loadPage();
  const {
    applyAuthorizedIdentity
  } = require('../packages/business/enterprise-register/enterprise-register.js');
  const context = {
    data: {
      pageState: 'ready',
      submitting: true,
      authorizedPhone: '',
      navTitle: '企业开户',
      errorMessage: ''
    },
    setData(next) {
      Object.assign(this.data, next);
    }
  };
  const customer = applyAuthorizedIdentity(context, {
    mode: 'customer',
    phone: '13800138000'
  });
  assert.equal(customer.leave, false);
  assert.equal(context.data.pageState, 'ready');

  const approved = applyAuthorizedIdentity(context, {
    mode: 'staff',
    staffRole: 'enterprise_admin',
    phone: '13800138000'
  });
  assert.equal(approved.leave, true);
  assert.equal(context.data.pageState, 'account');
  assert.match(context.data.errorMessage, /已开通|已有账号|直接登录/);
});

test('workbench phone auth confirms before leaving and stays when cancelled', async () => {
  const definition = loadPage();
  const originalPhoneLogin = api.phoneLogin;
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const modals = [];
  const leaves = [];
  const appData = { roleLandingRedirected: false };
  api.phoneLogin = async () => ({
    user: { mode: 'staff', staffRole: 'enterprise_admin', phone: '13800138000' }
  });
  global.getApp = () => ({ globalData: appData });
  global.wx = {
    ...(originalWx || {}),
    showModal(options) {
      modals.push(options);
    },
    showToast() {},
    reLaunch() {},
    switchTab() {}
  };
  try {
    const context = {
      data: {
        ...definition.data,
        pageState: 'ready',
        canSubmit: true,
        enterpriseName: '测试企业',
        creditCode: '91310000MA1KTEST01',
        contactName: '张三',
        authorizedPhone: '',
        submitting: false
      },
      setData(next) {
        Object.assign(this.data, next);
      },
      leaveIfWorkbenchSignedIn() {
        leaves.push('workbench');
        return true;
      },
      onGoToLogin() {
        leaves.push('login');
      }
    };
    await definition.onGetPhoneNumber.call(context, {
      detail: { errMsg: 'getPhoneNumber:ok', code: 'phone-code' }
    });
    assert.equal(context.data.pageState, 'account');
    assert.equal(appData.roleLandingRedirected, true);
    assert.equal(modals.length, 1);
    assert.equal(modals[0].title, '该手机号已有账号');
    assert.match(modals[0].content, /已开通企业账号/);
    assert.equal(modals[0].confirmText, '去登录');
    assert.equal(modals[0].cancelText, '留在此页');
    assert.ok(modals[0].confirmText.length <= 4);
    assert.ok(modals[0].cancelText.length <= 4);
    assert.deepEqual(leaves, []);

    modals[0].success({ confirm: false });
    assert.deepEqual(leaves, []);
    assert.equal(context.data.pageState, 'account');

    modals[0].success({ confirm: true });
    assert.deepEqual(leaves, ['workbench']);
  } finally {
    api.phoneLogin = originalPhoneLogin;
    global.wx = originalWx;
    global.getApp = originalGetApp;
  }
});

test('rate-limited phone auth stays on the form with a readable confirm', async () => {
  const definition = loadPage();
  const originalWx = global.wx;
  const modals = [];
  const toasts = [];
  global.wx = {
    ...(originalWx || {}),
    showModal(options) {
      modals.push(options);
    },
    showToast(options) {
      toasts.push(options);
    }
  };
  try {
    const context = {
      data: {
        ...definition.data,
        pageState: 'ready',
        canSubmit: true,
        submitting: false
      },
      setData(next) {
        Object.assign(this.data, next);
      }
    };
    await definition.onGetPhoneNumber.call(context, {
      detail: { errMsg: 'getPhoneNumber:fail 该手机号获取次数已达上限，请稍后再试' }
    });
    assert.equal(context.data.pageState, 'ready');
    assert.equal(toasts.length, 0);
    assert.equal(modals.length, 1);
    assert.equal(modals[0].showCancel, false);
    assert.equal(modals[0].confirmText, '知道了');
    assert.match(modals[0].content, /过于频繁|太快|稍后再试/);
  } finally {
    global.wx = originalWx;
  }
});

test('explainPhoneAuthFailure keeps user cancel as a short toast', () => {
  loadPage();
  const {
    explainPhoneAuthFailure
  } = require('../packages/business/enterprise-register/enterprise-register.js');
  assert.equal(
    explainPhoneAuthFailure({ errMsg: 'getPhoneNumber:fail user deny' }).mode,
    'toast'
  );
  assert.equal(
    explainPhoneAuthFailure({ errMsg: 'getPhoneNumber:fail 操作太快了' }).mode,
    'modal'
  );
});

test('onBack leaves the stack-root open-account page without clearing the signed session', () => {
  const page = loadPage();
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const originalPages = global.getCurrentPages;
  const relaunched = [];
  const switched = [];
  const removed = [];
  global.getApp = () => ({
    globalData: {
      userInfo: { mode: 'customer' },
      bootstrap: { current: { mode: 'customer', role: 'customer' } }
    }
  });
  global.getCurrentPages = () => [{
    route: 'packages/business/enterprise-register/enterprise-register'
  }];
  global.wx = {
    removeStorageSync(key) { removed.push(key); },
    navigateBack() {},
    reLaunch(options) { relaunched.push(options.url); },
    switchTab(options) { switched.push(options.url); }
  };
  try {
    page.onBack();
    assert.deepEqual(relaunched, ['/pages/index/index']);
    assert.deepEqual(switched, []);
    assert.deepEqual(removed, []);
  } finally {
    global.wx = originalWx;
    global.getApp = originalGetApp;
    global.getCurrentPages = originalPages;
  }
});

test('goToPasswordLogin always relaunches password login and falls back to Mine', () => {
  loadPage();
  const {
    goToPasswordLogin
  } = require('../packages/business/enterprise-register/enterprise-register.js');
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const relaunched = [];
  const switched = [];
  global.getApp = () => ({ globalData: {} });
  global.wx = {
    removeStorageSync() {},
    reLaunch(options) {
      relaunched.push(options.url);
      if (typeof options.fail === 'function') options.fail();
    },
    switchTab(options) {
      switched.push(options.url);
    }
  };
  try {
    goToPasswordLogin();
    assert.deepEqual(relaunched, ['/packages/business/login/login?mode=password']);
    assert.deepEqual(switched, ['/pages/mine/mine']);
  } finally {
    global.wx = originalWx;
    global.getApp = originalGetApp;
  }
});
