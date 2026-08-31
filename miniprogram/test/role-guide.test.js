const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const miniRoot = path.resolve(__dirname, '..');

function source(relativePath) {
  return fs.readFileSync(path.join(miniRoot, relativePath), 'utf8');
}

function assertTransparentGuidePng(bytes, file) {
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  assert.ok(
    bytes.includes(Buffer.from('tRNS')) || [4, 6].includes(bytes[25]),
    `${file} must retain transparency`
  );
  assert.ok(bytes.length <= 300 * 1024, `${file} exceeds the 300KB generated-artwork limit`);
}

function loadGuidePage(app, relativePath = 'referrer-guide/referrer-guide') {
  const pagePath = require.resolve(`../packages/guides/${relativePath}.js`);
  const originalPage = global.Page;
  const originalGetApp = global.getApp;
  let definition;
  global.Page = (next) => { definition = next; };
  global.getApp = () => app;
  delete require.cache[pagePath];
  require(pagePath);
  delete require.cache[pagePath];
  global.Page = originalPage;
  global.getApp = originalGetApp;
  return definition;
}

function createPage(definition) {
  return {
    ...definition,
    data: { ...definition.data },
    setData(next) { Object.assign(this.data, next); }
  };
}

function assertCarouselMarkup(wxml) {
  assert.match(wxml, /<swiper[\s\S]*current="\{\{currentStep\}\}"/);
  assert.match(wxml, /autoplay="\{\{false\}\}"/);
  assert.match(wxml, /circular="\{\{false\}\}"/);
  assert.match(wxml, /bindchange="onSwiperChange"/);
  assert.match(wxml, /\{\{item\.title\}\}/);
  assert.match(wxml, /\{\{item\.description\}\}/);
}

test('custom guide navigation keeps the title in its capsule-left lane', () => {
  for (const guide of [
    'customer-guide/customer-guide',
    'referrer-guide/referrer-guide',
    'enterprise-owner-guide/enterprise-owner-guide',
    'designer-guide/designer-guide',
    'measurer-guide/measurer-guide',
  ]) {
    const less = source(`packages/guides/${guide}.less`);
    const wxml = source(`packages/guides/${guide}.wxml`);
    assert.match(less, /\.guide-nav\s*\{[^}]*box-sizing:\s*border-box/s, `${guide} nav must include capsule padding inside its width`);
    assert.match(less, /\.guide-nav-title\s*\{[^}]*white-space:\s*nowrap/s, `${guide} title must not wrap`);
    assert.match(wxml, /min-height: \{\{navigationTop \+ navigationHeight\}\}px/, `${guide} nav height must reserve the capsule lane`);
    assert.match(wxml, /padding-right: \{\{navigationRight\}\}px/, `${guide} must reserve the native capsule lane`);
    assert.doesNotMatch(wxml, /class="guide-nav"[\s\S]*skip-action[\s\S]*class="guide-content"/, `${guide} skip must not stay in the nav`);
    assert.match(wxml, /class="primary-action"[\s\S]*?class="skip-action"/, `${guide} skip must follow the primary CTA`);
    assert.match(less, /\.skip-action\s*\{[^}]*margin:\s*16rpx auto 0/s, `${guide} skip must sit below the primary CTA`);
  }
});

test('approved role guides are registered and automatic display is versioned per account', () => {
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const storage = new Map();
  const navigations = [];
  global.getApp = () => ({ globalData: { openid: 'openid-referrer-1', userInfo: { id: 'user-1' } } });
  global.wx = {
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    navigateTo(options) { navigations.push(options.url); }
  };
  const modulePath = require.resolve('../utils/roleGuide.js');
  delete require.cache[modulePath];
  const guide = require(modulePath);

  try {
    assert.equal(guide.hasRoleGuide('referrer'), true);
    assert.equal(guide.hasRoleGuide('enterprise_admin'), true);
    assert.equal(guide.hasRoleGuide('designer'), true);
    assert.equal(guide.hasRoleGuide('measurer'), true);
    assert.equal(guide.hasRoleGuide('customer'), false);
    assert.equal(guide.openRoleGuide('customer', { automatic: true }), false);
    assert.equal(guide.openRoleGuide('referrer', {
      automatic: true,
      source: 'first-entry',
      membershipId: 'membership-1'
    }), true);
    assert.deepEqual(navigations, [
      '/packages/guides/referrer-guide/referrer-guide?source=first-entry&membershipId=membership-1'
    ]);

    assert.equal(guide.markRoleGuideSeen('referrer'), true);
    assert.equal(guide.hasSeenRoleGuide('referrer'), true);
    assert.equal(guide.openRoleGuide('referrer', { automatic: true }), false);
    assert.equal(guide.openRoleGuide('referrer', { source: 'mine' }), true);
    assert.equal(navigations.at(-1), '/packages/guides/referrer-guide/referrer-guide?source=mine');
    assert.match([...storage.keys()][0], /^roleGuideSeen:referrer:v1:openid-referrer-1$/);
    assert.match(guide.roleGuideUrl('enterprise_admin', { source: 'first-entry' }), /enterprise-owner-guide\/enterprise-owner-guide\?source=first-entry$/);
    assert.match(guide.roleGuideUrl('designer', { source: 'first-entry' }), /designer-guide\/designer-guide\?source=first-entry$/);
    assert.match(guide.roleGuideUrl('measurer', { source: 'first-entry' }), /measurer-guide\/measurer-guide\?source=first-entry$/);
    assert.equal(guide.clampGuideStep(-1, 3), 0);
    assert.equal(guide.clampGuideStep('9', 3), 2);
    assert.equal(guide.guideSlideState([{ title: 'a' }, { title: 'b' }], '1').currentStep, 1);
    assert.equal(guide.guideSlideState([{ title: 'a' }, { title: 'b' }], '1').activeSlide.title, 'b');
  } finally {
    delete require.cache[modulePath];
    global.wx = originalWx;
    global.getApp = originalGetApp;
  }
});

test('Mine replays held work-identity guides even while signed as customer', () => {
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const navigations = [];
  const sheets = [];
  global.getApp = () => ({ globalData: { openid: 'openid-multi-1' } });
  global.wx = {
    navigateTo(options) { navigations.push(options.url); },
    showActionSheet(options) { sheets.push(options.itemList); }
  };
  const modulePath = require.resolve('../utils/roleGuide.js');
  delete require.cache[modulePath];
  const guide = require(modulePath);

  try {
    assert.equal(guide.mineRoleGuideEntry('customer').showRoleGuideEntry, false);
    assert.equal(guide.mineRoleGuideEntry('customer', {
      roles: [{ role: 'designer' }]
    }).showRoleGuideEntry, true);
    assert.equal(guide.mineRoleGuideEntry('customer', {
      roles: [{ role: 'designer' }]
    }).roleGuideHelper, '回看已有身份的工作方法');
    assert.deepEqual(guide.guidedRolesFromAccount('customer', {
      roles: [{ role: 'customer' }, { role: 'designer' }, { role: 'designer' }]
    }, [{ mode: 'staff', staffRole: 'measurer' }]), ['designer', 'measurer']);
    assert.equal(guide.openMineRoleGuide({
      activeRole: 'customer',
      bootstrap: { roles: [{ role: 'designer' }] }
    }), true);
    assert.match(navigations.at(-1), /designer-guide\/designer-guide\?source=mine/);
    assert.equal(guide.openMineRoleGuide({
      activeRole: 'customer',
      bootstrap: { roles: [{ role: 'designer' }, { role: 'measurer' }] }
    }), true);
    assert.deepEqual(sheets[0], ['家装设计顾问使用引导', '家装现场顾问使用引导']);
    assert.equal(guide.openMineRoleGuide({
      activeRole: 'designer',
      bootstrap: { roles: [{ role: 'designer' }, { role: 'measurer' }] }
    }), true);
    assert.match(navigations.at(-1), /designer-guide\/designer-guide\?source=mine/);
    assert.match(
      source('pages/mine/mine.wxml'),
      /template is="mineAccountPanel" data="\{\{showRoleGuideEntry, showRegistrationCodeEntry, showReferrerNetworkEntry, referrerNetworkEntryLabel, referrerNetworkEntryHelper, roleGuideHelper\}\}"/
    );
  } finally {
    delete require.cache[modulePath];
    global.wx = originalWx;
    global.getApp = originalGetApp;
  }
});

test('enterprise owner guide advances through three steps and ends at activity-code sharing', () => {
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const storage = new Map();
  const navigations = [];
  const app = { globalData: { openid: 'openid-enterprise-1' } };
  global.getApp = () => app;
  global.wx = {
    getWindowInfo() { return { windowWidth: 390, statusBarHeight: 47 }; },
    getMenuButtonBoundingClientRect() { return { top: 51, left: 295, height: 32 }; },
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    redirectTo(options) { navigations.push(['redirectTo', options.url]); },
    reLaunch(options) { navigations.push(['reLaunch', options.url]); },
    navigateBack(options) { navigations.push(['navigateBack', options.delta]); }
  };
  try {
    const page = createPage(loadGuidePage(app, 'enterprise-owner-guide/enterprise-owner-guide'));
    page.onLoad({ source: 'mine' });
    assert.equal(page.data.totalSteps, 3);
    assert.match(page.data.activeSlide.title, /活动码/);
    page.onPrimary();
    assert.match(page.data.activeSlide.title, /服务团队/);
    page.onSwiperChange({ detail: { current: 0, source: 'touch' } });
    assert.equal(page.data.currentStep, 0);
    assert.match(page.data.activeSlide.title, /活动码/);
    page.onDotTap({ currentTarget: { dataset: { index: 2 } } });
    assert.equal(page.data.currentStep, 2);
    assert.match(page.data.activeSlide.title, /异常优先/);
    page.onPrimary();
    assert.deepEqual(navigations.at(-1), ['redirectTo', '/packages/business/staff-activity-code/staff-activity-code']);
    page.onSkip();
    assert.deepEqual(navigations.at(-1), ['navigateBack', 1]);
  } finally {
    global.wx = originalWx;
    global.getApp = originalGetApp;
  }
});

test('referrer guide advances through three native steps and ends at the selected service code', () => {
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const storage = new Map();
  const navigations = [];
  const app = {
    globalData: {
      openid: 'openid-referrer-2',
      bootstrap: { current: { context: { referrerMembershipId: 'membership-bootstrap' } } }
    }
  };
  global.getApp = () => app;
  global.wx = {
    getWindowInfo() { return { windowWidth: 390, statusBarHeight: 47 }; },
    getMenuButtonBoundingClientRect() { return { top: 51, left: 295, height: 32 }; },
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    redirectTo(options) { navigations.push(['redirectTo', options.url]); },
    reLaunch(options) { navigations.push(['reLaunch', options.url]); },
    navigateBack(options) { navigations.push(['navigateBack', options.delta]); }
  };

  try {
    const page = createPage(loadGuidePage(app));
    page.onLoad({ membershipId: 'membership-query', source: 'mine' });
    assert.equal(page.data.membershipId, 'membership-query');
    assert.equal(page.data.navigationRight, 105);
    assert.match(page.data.activeSlide.title, /服务码/);

    page.onPrimary();
    assert.equal(page.data.currentStep, 1);
    assert.match(page.data.activeSlide.title, /服务进展/);
    page.onSwiperChange({ detail: { current: 0, source: 'touch' } });
    assert.equal(page.data.currentStep, 0);
    page.onDotTap({ currentTarget: { dataset: { index: 2 } } });
    assert.equal(page.data.currentStep, 2);
    assert.match(page.data.activeSlide.title, /收益/);
    page.onPrimary();
    assert.deepEqual(navigations.at(-1), [
      'redirectTo',
      '/packages/business/promotion-service-code/promotion-service-code?membershipId=membership-query'
    ]);

    page.onSkip();
    assert.deepEqual(navigations.at(-1), ['navigateBack', 1]);
  } finally {
    global.wx = originalWx;
    global.getApp = originalGetApp;
  }
});

test('referrer guide uses native copy and keeps generated art transparent and package-sized', () => {
  const wxml = source('packages/guides/referrer-guide/referrer-guide.wxml');
  const less = source('packages/guides/referrer-guide/referrer-guide.less');
  const workbench = source('packages/business/referrer-workbench/referrer-workbench.js');
  assert.match(wxml, /推广人使用引导/);
  assert.match(wxml, /\{\{item\.title\}\}/);
  assert.match(wxml, /\{\{item\.description\}\}/);
  assert.match(wxml, /去出示服务码/);
  assertCarouselMarkup(wxml);
  assert.doesNotMatch(wxml, /<image[^>]+design-references\//);
  assert.doesNotMatch(less, /height:\s*100%|min-height:\s*100vh|flex-grow:\s*1|flex:\s*1/);
  assert.match(less, /\.guide-nav-title\s*\{[^}]*font-size:\s*32rpx/s);
  assert.match(less, /\.guide-title\s*\{[^}]*font-size:\s*40rpx/s);
  assert.match(less, /\.guide-description\s*\{[^}]*font-size:\s*24rpx/s);
  assert.match(less, /\.primary-action\s*\{[^}]*font-size:\s*28rpx/s);
  assert.match(workbench, /openRoleGuide\('referrer',[\s\S]*automatic:\s*true/);
  assert.match(workbench, /membershipId:\s*this\.data\.selectedMembershipId/);

  for (const file of ['service-code.png', 'progress.png', 'earnings.png']) {
    const assetPath = path.join(miniRoot, 'packages', 'guides', 'assets', 'referrer-v1', file);
    assertTransparentGuidePng(fs.readFileSync(assetPath), file);
  }
});

test('enterprise owner guide uses approved native copy, standalone assets, and automatic home trigger', () => {
  const wxml = source('packages/guides/enterprise-owner-guide/enterprise-owner-guide.wxml');
  const less = source('packages/guides/enterprise-owner-guide/enterprise-owner-guide.less');
  const workbench = source('components/role-workbench/role-workbench.js');
  assert.match(wxml, /企业负责人使用引导/);
  assert.match(wxml, /去分享活动码/);
  assert.match(wxml, /item\.description/);
  assertCarouselMarkup(wxml);
  assert.doesNotMatch(wxml, /src="[^\"]*design-references\//);
  assert.doesNotMatch(less, /height:\s*100%|min-height:\s*100vh|flex-grow:\s*1|flex:\s*1/);
  assert.match(workbench, /openRoleGuide\('enterprise_admin',/);
  assert.match(workbench, /scheduleEnterpriseRoleGuide/);
  for (const file of ['activity-code.png', 'team-onboarding.png', 'operations-priority.png']) {
    assertTransparentGuidePng(fs.readFileSync(path.join(miniRoot, 'packages', 'guides', 'assets', 'enterprise-owner-v1', file)), file);
  }
});

test('designer guide advances through three workflow steps and ends at staff earnings', () => {
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const storage = new Map();
  const navigations = [];
  const app = { globalData: { openid: 'openid-designer-1' } };
  global.getApp = () => app;
  global.wx = {
    getWindowInfo() { return { windowWidth: 390, statusBarHeight: 47 }; },
    getMenuButtonBoundingClientRect() { return { top: 51, left: 295, height: 32 }; },
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    redirectTo(options) { navigations.push(['redirectTo', options.url]); },
    reLaunch(options) { navigations.push(['reLaunch', options.url]); },
    navigateBack(options) { navigations.push(['navigateBack', options.delta]); }
  };
  try {
    const page = createPage(loadGuidePage(app, 'designer-guide/designer-guide'));
    page.onLoad({ source: 'first-entry' });
    assert.equal(page.data.totalSteps, 3);
    assert.match(page.data.activeSlide.title, /合适的客户/);
    page.onPrimary();
    assert.match(page.data.activeSlide.title, /量房资料/);
    page.onSwiperChange({ detail: { current: 0, source: 'touch' } });
    assert.equal(page.data.currentStep, 0);
    page.onDotTap({ currentTarget: { dataset: { index: 2 } } });
    assert.match(page.data.activeSlide.title, /方案交付/);
    page.onPrimary();
    assert.deepEqual(navigations.at(-1), ['redirectTo', '/packages/business/staff-earnings/staff-earnings']);
    page.onSkip();
    assert.deepEqual(navigations.at(-1), ['navigateBack', 1]);

    app.globalData.bootstrap = {
      current: { role: 'customer', capabilities: ['account'] },
      roles: [{ role: 'designer', capabilities: ['staff.leads'] }]
    };
    page.onLoad({ source: 'mine' });
    page.onDotTap({ currentTarget: { dataset: { index: 2 } } });
    page.onPrimary();
    assert.deepEqual(navigations.at(-1), ['navigateBack', 1]);
  } finally {
    global.wx = originalWx;
    global.getApp = originalGetApp;
  }
});

test('designer guide uses native copy, role-specific transparent art, and readable floors', () => {
  const wxml = source('packages/guides/designer-guide/designer-guide.wxml');
  const less = source('packages/guides/designer-guide/designer-guide.less');
  const workbench = source('components/role-workbench/role-workbench.js');
  assert.match(wxml, /家装设计顾问使用引导/);
  assert.match(wxml, /去看我的收益/);
  assert.match(wxml, /item\.description/);
  assertCarouselMarkup(wxml);
  assert.doesNotMatch(wxml, /src="[^\"]*design-references\//);
  assert.doesNotMatch(less, /height:\s*100%|min-height:\s*100vh|flex-grow:\s*1|flex:\s*1/);
  assert.match(less, /\.guide-nav-title\s*\{[^}]*font-size:\s*32rpx/s);
  assert.match(less, /\.guide-title\s*\{[^}]*font-size:\s*40rpx/s);
  assert.match(less, /\.guide-description\s*\{[^}]*font-size:\s*24rpx/s);
  assert.match(less, /\.primary-action\s*\{[^}]*font-size:\s*28rpx/s);
  assert.match(workbench, /scheduleDesignerRoleGuide/);
  for (const file of ['lead-claim.png', 'survey-sync.png', 'scheme-delivery.png']) {
    const assetPath = path.join(miniRoot, 'packages', 'guides', 'assets', 'designer-advisor-v1', file);
    assertTransparentGuidePng(fs.readFileSync(assetPath), file);
  }
});

test('measurer guide advances through the approved path steps and returns to today tasks', () => {
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const storage = new Map();
  const navigations = [];
  const app = { globalData: { openid: 'openid-measurer-1' } };
  global.getApp = () => app;
  global.wx = {
    getWindowInfo() { return { windowWidth: 390, statusBarHeight: 47 }; },
    getMenuButtonBoundingClientRect() { return { top: 51, left: 295, height: 32 }; },
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    redirectTo(options) { navigations.push(['redirectTo', options.url]); },
    reLaunch(options) { navigations.push(['reLaunch', options.url]); },
    navigateBack(options) { navigations.push(['navigateBack', options.delta]); }
  };
  try {
    const page = createPage(loadGuidePage(app, 'measurer-guide/measurer-guide'));
    page.onLoad({ source: 'first-entry' });
    assert.equal(page.data.totalSteps, 3);
    assert.match(page.data.activeSlide.title, /连接测距仪/);
    page.onPrimary();
    assert.match(page.data.activeSlide.title, /沿着墙线量/);
    page.onSwiperChange({ detail: { current: 0, source: 'touch' } });
    assert.equal(page.data.currentStep, 0);
    page.onDotTap({ currentTarget: { dataset: { index: 2 } } });
    assert.match(page.data.activeSlide.title, /量房完成，资料可交付/);
    page.onPrimary();
    assert.deepEqual(navigations.at(-1), ['navigateBack', 1]);
    page.onSkip();
    assert.deepEqual(navigations.at(-1), ['navigateBack', 1]);
  } finally {
    global.wx = originalWx;
    global.getApp = originalGetApp;
  }
});

test('measurer guide uses approved native copy, path artwork, and custom navigation', () => {
  const wxml = source('packages/guides/measurer-guide/measurer-guide.wxml');
  const less = source('packages/guides/measurer-guide/measurer-guide.less');
  const pageJson = JSON.parse(source('packages/guides/measurer-guide/measurer-guide.json'));
  const designerJson = JSON.parse(source('packages/guides/designer-guide/designer-guide.json'));
  const workbench = source('components/role-workbench/role-workbench.js');
  assert.match(wxml, /家装现场顾问使用引导/);
  assert.match(wxml, /去看今日任务/);
  assert.match(wxml, /item\.description/);
  assert.match(wxml, /index < currentStep \? 'complete'/);
  assertCarouselMarkup(wxml);
  assert.doesNotMatch(wxml, /src="[^\"]*design-references\//);
  assert.doesNotMatch(less, /height:\s*100%|min-height:\s*100vh|flex-grow:\s*1|flex:\s*1/);
  assert.match(less, /\.guide-nav-title\s*\{[^}]*font-size:\s*32rpx/s);
  assert.match(less, /\.guide-title\s*\{[^}]*font-size:\s*40rpx/s);
  assert.match(less, /\.guide-description\s*\{[^}]*font-size:\s*24rpx/s);
  assert.match(less, /\.primary-action\s*\{[^}]*font-size:\s*28rpx/s);
  assert.equal(pageJson.navigationStyle, 'custom');
  assert.equal(designerJson.navigationStyle, 'custom');
  assert.match(workbench, /scheduleMeasurerRoleGuide/);
  for (const file of ['measurement-bench.png', 'measurement-path.png', 'measurement-complete.png']) {
    const assetPath = path.join(miniRoot, 'packages', 'guides', 'assets', 'measurer-v1', file);
    assertTransparentGuidePng(fs.readFileSync(assetPath), file);
  }
});
