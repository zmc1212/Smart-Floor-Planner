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
  const less = source('packages/business/onboarding/onboarding.less');

  assert.ok(businessPackage.pages.includes('onboarding/onboarding'));
  assert.ok(businessPackage.pages.includes('onboarding-debug/onboarding-debug'));
  assert.match(wxml, /open-type="getPhoneNumber"/);
  assert.match(wxml, /员工入驻/);
  assert.match(wxml, /推荐人入驻/);
  assert.match(wxml, /referral-service-v1\/thumbs-up-xiao-k\.png/);
  assert.match(js, /\/miniprogram\/codes\/resolve/);
  assert.match(js, /\/miniprogram\/onboarding\/staff/);
  assert.match(js, /\/miniprogram\/onboarding\/referrer/);
  assert.match(js, /`ej_\$\{decoded\}`/);
  assert.match(js, /enterpriseName/);
  assert.match(wxml, /正在加入企业/);
  assert.match(wxml, /\{\{enterpriseName\}\}/);
  assert.doesNotMatch(js, /debugOnboarding/);
  assert.match(js, /code_rotated/);
  assert.match(wxml, /navigationRight/);
  assert.match(less, /safe-area-inset-bottom/);
  assert.doesNotMatch(less, /font-size:\s*(?:1[0-9]|[0-9])rpx/);
  assert.doesNotMatch(less, /transform:\s*scale\(/);
});

test('onboarding code resolution records the resolved enterprise name before phone authorization', async () => {
  const definition = loadPage();
  const originalRequest = api.request;
  api.request = async () => ({
    data: { kind: 'onboarding', codeType: 'referrer', enterpriseName: '嘉客来装饰' }
  });
  try {
    const context = {
      data: { ...definition.data, onboardingToken: 'ej_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456' },
      setData(next) { Object.assign(this.data, next); }
    };
    await definition.resolveOnboardingCode.call(context);
    assert.equal(context.data.pageState, 'ready');
    assert.equal(context.data.enterpriseName, '嘉客来装饰');
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
