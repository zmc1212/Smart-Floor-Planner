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
