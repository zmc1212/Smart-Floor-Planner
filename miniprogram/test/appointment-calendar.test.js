const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const api = require('../utils/api.js');
const miniRoot = path.resolve(__dirname, '..');

function source(relativePath) {
  return fs.readFileSync(path.join(miniRoot, relativePath), 'utf8');
}

function loadDetailPage() {
  const pagePath = require.resolve('../packages/business/appointment-detail/appointment-detail.js');
  const originalPage = global.Page;
  let definition;
  global.Page = (next) => { definition = next; };
  delete require.cache[pagePath];
  require(pagePath);
  global.Page = originalPage;
  return definition;
}

test('detail inline reschedule honours the server appointment horizon and retains the selected slot identity', async () => {
  const definition = loadDetailPage();
  assert.equal(typeof definition.loadSlots, 'function');
  assert.equal(typeof definition.chooseSlot, 'function');
  const originalRequest = api.request;
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  global.wx = {
    getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 24 }),
    getMenuButtonBoundingClientRect: () => ({ left: 280, top: 24, height: 32 }),
  };
  global.getApp = () => ({ globalData: { userInfo: { role: 'staff', staffRole: 'designer' } } });
  const slot = { startAt: '2026-08-20T01:00:00.000Z', endAt: '2026-08-20T03:00:00.000Z' };
  api.request = async (url) => {
    if (String(url).includes('/appointments/availability')) {
      return { data: { maxAdvanceDays: 7, slots: [slot] } };
    }
    return { data: [] };
  };
  const context = {
    data: {
      ...definition.data,
      leadId: '1',
      selectedDate: '2026-08-20',
      dateOffset: 0,
      maxAdvanceDays: 30,
      canReschedule: true,
    },
    setData(next) { Object.assign(this.data, next); },
  };
  try {
    await definition.loadSlots.call(context);
    assert.equal(context.data.maxAdvanceDays, 7);
    assert.equal(context.data.dates.length, 5);
    assert.equal(context.data.slots[0].label, '09:00 - 11:00');
    definition.chooseSlot.call(context, { currentTarget: { dataset: { slot: context.data.slots[0] } } });
    assert.equal(context.data.selectedSlotStart, slot.startAt);
    assert.match(context.data.confirmRescheduleLabel || '', /^确认改期至/);
  } finally {
    api.request = originalRequest;
    global.wx = originalWx;
    global.getApp = originalGetApp;
  }
});

test('phase-5 custom-navigation pages reserve the native capsule lane; reschedule is a redirect shell', () => {
  const pages = [
    'packages/business/customer-project/customer-project',
    'packages/business/appointment-detail/appointment-detail',
    'packages/business/measurer-calendar/measurer-calendar',
    'packages/business/measurer-unavailability/measurer-unavailability',
  ];
  for (const page of pages) {
    assert.match(source(`${page}.js`), /getMenuButtonBoundingClientRect/);
    assert.match(source(`${page}.wxml`), /padding-right: \{\{navigationRight\}\}px/);
    assert.match(source(`${page}.wxml`), /bindtap="onBack"/);
  }

  const shell = source('packages/business/appointment-reschedule/appointment-reschedule.js');
  assert.match(shell, /redirectTo/);
  assert.match(shell, /appointment-detail\/appointment-detail/);
  assert.match(shell, /mode !== 'internal'|mode === 'internal'/);
  assert.match(shell, /mode=customer/);
  assert.match(shell, /预约信息不完整|缺少预约/);
  assert.doesNotMatch(shell, /loadSlots/);
  assert.doesNotMatch(shell, /previousDates/);
  assert.doesNotMatch(source('packages/business/appointment-reschedule/appointment-reschedule.wxml'), /confirm-bar/);
});
