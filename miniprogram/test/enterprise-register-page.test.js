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
  assert.match(js, /phone_mismatch/);
  assert.match(js, /pageState:\s*'recovery'/);
  assert.match(wxml, /open-type="getPhoneNumber"/);
  assert.match(wxml, /申请企业开户/);
  assert.match(wxml, /统一社会信用代码/);
  assert.match(wxml, /授权手机号/);
  assert.match(wxml, /提交开户申请/);
  assert.match(wxml, /申请已提交/);
  assert.match(wxml, /初始密码为 123456/);
  assert.match(wxml, /已有账号，去登录/);
  assert.match(wxml, /bindtap="onGoToLogin"/);
  assert.match(wxml, /该手机号已有账号/);
  assert.match(js, /mode=password/);
  assert.match(less, /identity-link/);
  assert.match(wxml, /navigationRight/);
  assert.match(less, /safe-area-inset-bottom/);
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
