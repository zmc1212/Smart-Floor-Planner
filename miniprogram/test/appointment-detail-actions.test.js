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

  assert.ok(business.pages.includes('appointment-detail/appointment-detail'));
  assert.match(script, /\['designer', 'enterprise_admin'\]\.includes\(role\)/);
  assert.match(script, /\['measurer', 'enterprise_admin'\]\.includes\(role\)/);
  assert.match(script, /appointment-reschedule\/appointment-reschedule\?mode=\$\{mode\}/);
  assert.match(script, /updateStatus\('cancel'/);
  assert.match(script, /updateStatus\('complete'/);
  assert.match(script, /onShareAppMessage\(\)/);
  assert.match(script, /const customerMode = options\.mode === 'customer'/);
  assert.match(script, /mode = this\.data\.customerMode \? 'customer' : 'internal'/);
  assert.match(script, /请填写取消原因/);
  assert.match(wxml, /schedule-guide\.png/);
  assert.match(wxml, /wx:if="\{\{canComplete\}\}"/);
  assert.match(wxml, /wx:if="\{\{canReschedule\}\}"/);
  assert.match(wxml, /wx:if="\{\{canCancel\}\}"/);
});

test('internal reschedule reuses real availability and requires an audit reason', () => {
  const script = read('packages/business/appointment-reschedule/appointment-reschedule.js');
  const wxml = read('packages/business/appointment-reschedule/appointment-reschedule.wxml');
  assert.match(script, /query\.mode === 'internal'/);
  assert.match(script, /internal-reschedule/);
  assert.match(script, /请填写调整原因/);
  assert.match(wxml, /wx:if="\{\{internalMode\}\}"/);
  assert.match(wxml, /bindinput="onReasonInput"/);
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
  api.request = async () => ({ data: [{
    id: 'appointment-1',
    status: 'confirmed',
    version: 2,
    address: '测试小区',
    timeRange: '["2026-08-20T01:00:00.000Z","2026-08-20T03:00:00.000Z"]'
  }] });

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
      assert.equal(context.data.canComplete, staffRole === 'measurer');
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
  } finally {
    api.request = originalRequest;
    global.Page = originalPage;
    global.wx = originalWx;
    global.getApp = originalGetApp;
  }
});
