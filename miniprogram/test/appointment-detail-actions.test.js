const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('appointment detail is registered and exposes only server-backed lifecycle actions', () => {
  const config = JSON.parse(read('app.json'));
  const business = config.subPackages.find((item) => item.root === 'packages/business');
  const script = read('packages/business/appointment-detail/appointment-detail.js');
  const wxml = read('packages/business/appointment-detail/appointment-detail.wxml');
  const styles = read('packages/business/appointment-detail/appointment-detail.less');

  assert.ok(business.pages.includes('appointment-detail/appointment-detail'));
  assert.match(script, /\['designer', 'enterprise_admin'\]\.includes\(role\)/);
  assert.match(script, /\['measurer', 'enterprise_admin'\]\.includes\(role\)/);
  assert.doesNotMatch(script, /appointment-reschedule\/appointment-reschedule/);
  assert.match(script, /appointments\/availability/);
  assert.match(script, /customer-reschedule/);
  assert.match(script, /internal-reschedule/);
  assert.match(script, /appointmentSlotPicker/);
  assert.match(script, /formatConfirmRescheduleLabel/);
  assert.match(script, /confirmRescheduleLabel/);
  assert.match(script, /loadSlots/);
  assert.match(script, /chooseDate/);
  assert.match(script, /chooseSlot/);
  assert.match(script, /submitReschedule/);
  assert.match(script, /version:\s*this\.data\.appointment\.version|version:\s*appointment\.version/);
  assert.match(script, /updateStatus\('cancel'/);
  assert.match(script, /updateStatus\('complete'/);
  assert.match(script, /canUpdateAddress/);
  assert.match(script, /appointments\/\$\{appointment\.id\}\/address/);
  assert.match(script, /wx\.chooseLocation/);
  assert.match(script, /wx\.openLocation/);
  assert.match(script, /coordinateSystem: 'gcj02'/);
  assert.match(script, /onShareAppMessage\(\)/);
  assert.match(script, /const customerMode = options\.mode === 'customer'/);
  assert.match(script, /请填写取消原因/);
  assert.match(wxml, /schedule-guide\.png/);
  assert.match(script, /canStartSurvey/);
  assert.match(script, /startSurvey/);
  assert.match(script, /function resolveLeadLifecycle/);
  assert.match(script, /hasCompletedFormalSurvey/);
  assert.match(script, /\['converted', 'closed'\]/);
  assert.match(wxml, /wx:if="\{\{canStartSurvey\}\}"|wx:if="\{\{canStartSurvey && canReschedule\}\}"/);
  assert.match(wxml, /wx:if="\{\{canComplete\}\}"|wx:if="\{\{canComplete && canReschedule\}\}"|wx:elif="\{\{canComplete\}\}"/);
  assert.match(wxml, /wx:if="\{\{canReschedule\}\}"/);
  assert.match(wxml, /wx:if="\{\{canCancel\}\}"/);
  assert.match(wxml, /confirm-bar/);
  assert.match(wxml, /确认改期|confirmRescheduleLabel/);
  assert.match(wxml, /补充服务地址/);
  assert.match(wxml, /同步到客户小区/);
  assert.match(wxml, /一键导航至量房地点/);
  assert.match(script, /appointmentCommunitySync/);
  assert.match(script, /shouldOfferCommunitySync/);
  assert.match(script, /syncAddressToLeadCommunity/);
  assert.match(script, /同步到客户小区/);
  assert.match(wxml, /secondary-row[\s\S]*action-secondary[\s\S]*修改服务地址/);
  assert.match(wxml, /secondary-row[\s\S]*action-secondary[\s\S]*一键导航至量房地点/);
  assert.match(wxml, /canStartSurvey[\s\S]*📐/);
  assert.match(styles, /\.action-secondary\s*\{[^}]*background:\s*#f8faf9;/s);
  assert.match(styles, /\.secondary-row\s*\{[^}]*display:\s*flex;/s);
  assert.match(styles, /\.secondary-row\s*\{[^}]*gap:\s*16rpx;/s);
  assert.match(styles, /\.action-btn\s*\{[^}]*flex:\s*1 1 0;/s);
  assert.match(styles, /\.confirm-bar-row\s*\{[^}]*gap:\s*20rpx;/s);
  assert.match(styles, /\.sticky-cancel[^}]*flex:\s*0\.9 1 0/);
  assert.match(styles, /\.sticky-confirm[^}]*flex:\s*1\.3 1 0/);
  assert.doesNotMatch(styles, /flex:\s*0 0 240rpx/);
  assert.match(styles, /\.confirm-bar\s*\{[^}]*background:\s*rgba\(248,\s*250,\s*249/s);
  assert.match(styles, /\.confirm-bar\s*\{[^}]*padding:\s*20rpx 28rpx calc\(20rpx \+ env\(safe-area-inset-bottom\)\)/s);
  assert.match(styles, /\.confirm-bar \.primary\[disabled\][\s\S]*--action-disabled-bg/);
  assert.match(styles, /\.detail-page\s*\{[^}]*padding-bottom:\s*calc\(200rpx \+ env\(safe-area-inset-bottom\)\)/s);
  assert.match(styles, /\.confirm-bar/);
});

test('internal reschedule reuses real availability and keeps the audit reason optional', () => {
  const script = read('packages/business/appointment-detail/appointment-detail.js');
  const wxml = read('packages/business/appointment-detail/appointment-detail.wxml');
  assert.match(script, /internal-reschedule/);
  assert.match(script, /customer-reschedule/);
  assert.doesNotMatch(script, /请填写调整原因/);
  assert.match(wxml, /disabled="\{\{!selectedSlot \|\| rescheduleSubmitting\}\}"/);
  assert.match(wxml, /调整原因（选填）/);
  assert.match(wxml, /wx:if="\{\{!customerMode\}\}"/);
  assert.match(wxml, /bindinput="onReasonInput"/);
  assert.match(wxml, /bindtap="chooseDate"/);
  assert.match(wxml, /bindtap="chooseSlot"/);
  assert.match(wxml, /bindtap="submitReschedule"/);
});

test('appointment detail derives lifecycle actions from the signed staff role', async () => {
  const api = require('../utils/api.js');
  const originalRequest = api.request;
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  let definition;
  global.Page = (next) => { definition = next; };
  global.wx = {
    getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 24 }),
    getMenuButtonBoundingClientRect: () => ({ left: 280, top: 24, height: 32 }),
    navigateTo() {}
  };
  const requestUrls = [];
  api.request = async (url) => {
    requestUrls.push(url);
    if (String(url).startsWith('/leads/')) {
      return { data: { floorPlanIds: [], primaryFloorPlanId: null } };
    }
    return { data: [{
    id: 'appointment-1',
    leadId: 'lead-1',
    status: 'confirmed',
    version: 2,
    address: '测试小区',
    timeRange: '["2026-08-20T01:00:00.000Z","2026-08-20T03:00:00.000Z"]'
    }] };
  };

  try {
    for (const staffRole of ['designer', 'measurer']) {
      global.getApp = () => ({ globalData: { userInfo: { role: 'staff', staffRole } } });
      delete require.cache[require.resolve('../packages/business/appointment-detail/appointment-detail.js')];
      require('../packages/business/appointment-detail/appointment-detail.js');
      const context = {
        data: { ...definition.data },
        setData(next) { Object.assign(this.data, next); }
      };
      definition.onLoad.call(context, { appointmentId: 'appointment-1', leadId: 'lead-1' });
      await definition.load.call(context);
      assert.equal(context.data.canReschedule, staffRole === 'designer');
      assert.equal(context.data.canCancel, staffRole === 'designer');
      assert.equal(context.data.canComplete, false);
      assert.equal(context.data.canStartSurvey, staffRole === 'measurer');
      assert.equal(context.data.canUpdateAddress, true);
    }

    global.getApp = () => ({ globalData: { userInfo: { role: 'user', mode: 'customer' } } });
    delete require.cache[require.resolve('../packages/business/appointment-detail/appointment-detail.js')];
    require('../packages/business/appointment-detail/appointment-detail.js');
    const customerContext = {
      data: { ...definition.data },
      setData(next) { Object.assign(this.data, next); }
    };
    definition.onLoad.call(customerContext, { appointmentId: 'appointment-1', leadId: 'lead-1' });
    await definition.load.call(customerContext);
    assert.equal(customerContext.data.canReschedule, false);
    assert.equal(customerContext.data.canCancel, false);
    assert.equal(customerContext.data.canComplete, false);
    assert.equal(customerContext.data.canStartSurvey, false);
    assert.equal(customerContext.data.canUpdateAddress, false);
    assert.ok(requestUrls.some((url) => url.includes('appointmentId=appointment-1')));
    assert.ok(requestUrls.some((url) => url.startsWith('/leads/')));
  } finally {
    api.request = originalRequest;
    global.Page = originalPage;
    global.wx = originalWx;
    global.getApp = originalGetApp;
  }
});

test('appointment detail hides mutate actions when the linked lead is already converted', async () => {
  const api = require('../utils/api.js');
  const originalRequest = api.request;
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  let definition;
  global.Page = (next) => { definition = next; };
  global.wx = {
    getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 24 }),
    getMenuButtonBoundingClientRect: () => ({ left: 280, top: 24, height: 32 }),
    navigateTo() {}
  };
  api.request = async (url) => {
    if (String(url).startsWith('/leads/')) {
      return { data: { status: 'converted', floorPlanIds: [], primaryFloorPlanId: null } };
    }
    return { data: [{
      id: 'appointment-1',
      leadId: 'lead-1',
      status: 'expired',
      version: 2,
      address: '测试小区',
      timeRange: '["2026-08-10T01:00:00.000Z","2026-08-10T03:00:00.000Z"]'
    }] };
  };

  try {
    global.getApp = () => ({ globalData: { userInfo: { role: 'staff', staffRole: 'enterprise_admin' } } });
    delete require.cache[require.resolve('../packages/business/appointment-detail/appointment-detail.js')];
    require('../packages/business/appointment-detail/appointment-detail.js');
    const context = {
      data: { ...definition.data },
      setData(next) { Object.assign(this.data, next); }
    };
    definition.onLoad.call(context, { appointmentId: 'appointment-1', leadId: 'lead-1' });
    await definition.load.call(context);
    assert.equal(context.data.canReschedule, false);
    assert.equal(context.data.canCancel, false);
    assert.equal(context.data.canRebook, false);
    assert.equal(context.data.canUpdateAddress, false);
    assert.equal(context.data.canComplete, false);
    assert.equal(context.data.canStartSurvey, false);
  } finally {
    api.request = originalRequest;
    global.Page = originalPage;
    global.wx = originalWx;
    global.getApp = originalGetApp;
  }
});
