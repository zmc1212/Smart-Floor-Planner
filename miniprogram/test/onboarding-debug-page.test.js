const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const miniRoot = path.resolve(__dirname, '..');

function source(relativePath) {
  return fs.readFileSync(path.join(miniRoot, relativePath), 'utf8');
}

function loadPage() {
  const pagePath = require.resolve('../packages/business/onboarding-debug/onboarding-debug.js');
  const originalPage = global.Page;
  let definition;
  global.Page = (next) => { definition = next; };
  delete require.cache[pagePath];
  require(pagePath);
  global.Page = originalPage;
  return definition;
}

test('onboarding debug page is development-only and uses the native scanner for a real onboarding code', () => {
  const js = source('packages/business/onboarding-debug/onboarding-debug.js');
  const wxml = source('packages/business/onboarding-debug/onboarding-debug.wxml');
  const less = source('packages/business/onboarding-debug/onboarding-debug.less');

  assert.match(js, /envVersion === 'develop'/);
  assert.match(js, /wx\.scanCode/);
  assert.match(js, /onlyFromCamera:\s*false/);
  assert.match(js, /scanType:\s*\['qrCode'\]/);
  assert.match(js, /scanResult && scanResult\.path/);
  assert.match(js, /packages\/business\/onboarding\/onboarding/);
  assert.match(wxml, /开发版专用/);
  assert.match(wxml, /从电脑选择小程序码/);
  assert.match(wxml, /请求当前本地服务端/);
  assert.match(less, /min-height:\s*92rpx/);
  assert.doesNotMatch(wxml, /open-type="getPhoneNumber"/);
});

test('onboarding debug page forwards a scanned onboarding path and rejects other Mini Program paths', () => {
  const definition = loadPage();
  const originalWx = global.wx;
  let scanOptions;
  let navigation;
  global.wx = {
    scanCode(options) { scanOptions = options; },
    navigateTo(options) { navigation = options; }
  };
  try {
    const context = {
      data: { isDevelopment: true, errorMessage: '' },
      setData(next) { Object.assign(this.data, next); }
    };
    definition.selectOnboardingCode.call(context);
    assert.equal(scanOptions.onlyFromCamera, false);
    scanOptions.success({ path: 'packages/business/onboarding/onboarding?scene=ABC' });
    assert.equal(navigation.url, '/packages/business/onboarding/onboarding?scene=ABC');

    navigation = null;
    scanOptions.success({ path: 'pages/index/index' });
    assert.equal(navigation, null);
    assert.match(context.data.errorMessage, /员工或推荐人入驻/);
  } finally {
    global.wx = originalWx;
  }
});
