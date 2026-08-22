const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const api = require('../utils/api.js');

function loadPage() {
  const pagePath = require.resolve('../packages/business/measurer-calendar/measurer-calendar.js');
  const originalPage = global.Page;
  let definition;
  global.Page = (next) => { definition = next; };
  delete require.cache[pagePath];
  require(pagePath);
  global.Page = originalPage;
  return definition;
}

test('measurer calendar buckets a postgres tstzrange onto the selected Shanghai visit day', async () => {
  const definition = loadPage();
  const originalRequest = api.request;
  const originalWx = global.wx;
  api.request = async () => ({
    data: [{
      id: '118',
      leadId: '1191',
      timeRange: '["2026-08-23 01:00:00+00","2026-08-23 03:00:00+00")',
      status: 'confirmed',
      address: '湖北省宜昌市西陵区西湖路32号',
      customerName: '高容海推荐人',
      customerPhone: '15997671595',
    }],
  });
  global.wx = {
    getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 24 }),
    getMenuButtonBoundingClientRect: () => ({ left: 280, top: 24, height: 32 }),
  };
  const context = {
    data: {
      ...definition.data,
      todayDateKey: '2026-08-22',
      selectedDateKey: '2026-08-23',
    },
    setData(next) { Object.assign(this.data, next); },
    buildWeekDays: definition.buildWeekDays,
  };

  try {
    await definition.load.call(context);
    assert.equal(context.data.selectedAppointments.length, 1);
    assert.equal(context.data.selectedAppointments[0].dateKey, '2026-08-23');
    assert.equal(context.data.weekCount, 1);
    assert.equal(context.data.todayCount, 0);
  } finally {
    api.request = originalRequest;
    global.wx = originalWx;
  }
});

test('measurer calendar retains the assigned customer name and phone from the appointment API', async () => {
  const definition = loadPage();
  const originalRequest = api.request;
  const originalWx = global.wx;
  const phoneCalls = [];
  api.request = async () => ({
    data: [{
      id: 'appointment-1',
      leadId: 'lead-1',
      timeRange: '["2026-08-20T01:00:00.000Z","2026-08-20T02:00:00.000Z")',
      status: 'confirmed',
      address: '111',
      customerName: '微信客户',
      customerPhone: '15997671595',
    }],
  });
  global.wx = {
    makePhoneCall({ phoneNumber }) { phoneCalls.push(phoneNumber); },
    showToast() {},
  };
  const context = {
    data: {
      ...definition.data,
      todayDateKey: '2026-08-20',
      selectedDateKey: '2026-08-20',
    },
    setData(next) { Object.assign(this.data, next); },
    buildWeekDays: definition.buildWeekDays,
  };

  try {
    await definition.load.call(context);
    const appointment = context.data.allAppointments[0];
    assert.equal(appointment.customerName, '微信客户');
    assert.equal(appointment.customerPhone, '15997671595');
    const template = fs.readFileSync(path.join(__dirname, '..', 'packages', 'business', 'measurer-calendar', 'measurer-calendar.wxml'), 'utf8');
    assert.match(template, /客户: \{\{item\.customerName\}\}[\s\S]*item\.customerPhone/);
    assert.match(template, /action-phone sfp-icon-action[\s\S]*\/images\/leads-v4\/phone\.png[\s\S]*电话联系/);
    assert.match(template, /action-nav sfp-icon-action[\s\S]*\/images\/leads-v4\/map-pin\.png[\s\S]*导航/);
    assert.match(template, /action-start[\s\S]*\/images\/leads-v4\/ruler-green\.png[\s\S]*开始量房/);
    assert.doesNotMatch(template, /btn-icon">[📞📍📐✏️]/);
    definition.callCustomer.call(context, { currentTarget: { dataset: { item: appointment } } });
    assert.deepEqual(phoneCalls, ['15997671595']);
  } finally {
    api.request = originalRequest;
    global.wx = originalWx;
  }
});

test('measurer calendar opens native navigation only for an appointment with coordinates', () => {
  const definition = loadPage();
  const originalWx = global.wx;
  const openCalls = [];
  global.wx = {
    openLocation(options) { openCalls.push(options); },
    showToast() {},
  };
  try {
    definition.openNavigation.call({}, {
      currentTarget: { dataset: { item: {
        address: '阳光花园 1 栋 201', locationName: '阳光花园', latitude: 23.1291, longitude: 113.2644,
      } } },
    });
    assert.deepEqual(openCalls, [{
      latitude: 23.1291, longitude: 113.2644, name: '阳光花园', address: '阳光花园 1 栋 201', scale: 18,
    }]);
  } finally {
    global.wx = originalWx;
  }
});
